import "server-only";
import { isCanonicalBuyCreditsCalldata } from "@/lib/roast-payments-abi";

/**
 * On-chain payment verification (blueprint §9/§32). The backend NEVER
 * trusts the frontend's claim of payment: it fetches the transaction via
 * RPC and checks (a) it FINALIZED successfully, (b) the recipient is the
 * RoastPayments contract, (c) the sender matches the claiming wallet,
 * (d) it carried GEN.
 *
 * NOTE on RPC shape: GenLayer nodes return GenLayer-style transaction
 * objects (from_address / to_address / integer value / status string),
 * NOT EVM-style (from / to / hex value). We query with a raw JSON-RPC
 * call and read those fields directly, so this works on every network.
 */

function rpcUrl(): string {
  return process.env.GENLAYER_RPC || "https://studio.genlayer.com/api";
}

interface GenLayerTx {
  hash?: string;
  from_address?: string;
  to_address?: string;
  value?: number | string;
  status?: string | number;
  result?: string | number;
  data?: unknown;
  input?: unknown;
  txData?: unknown;
  tx_data?: unknown;
  txExecutionResultName?: string | number;
  tx_execution_result_name?: string | number;
}

type CalldataBinding = "matched" | "mismatched" | "unavailable";

function transactionStatusName(status: GenLayerTx["status"]): string {
  if (typeof status === "number") {
    // GenLayer TransactionStatus: ACCEPTED = 5, FINALIZED = 7.
    return status === 5 ? "ACCEPTED" : status === 7 ? "FINALIZED" : String(status);
  }
  return (status || "").toUpperCase();
}

function executionResultName(tx: GenLayerTx): string {
  const result = tx.txExecutionResultName ?? tx.tx_execution_result_name ?? tx.result;
  if (typeof result === "number") {
    // GenLayer ExecutionResult: FINISHED_WITH_RETURN = 1, FINISHED_WITH_ERROR = 2.
    return result === 1
      ? "FINISHED_WITH_RETURN"
      : result === 2
        ? "FINISHED_WITH_ERROR"
        : String(result);
  }
  return (result || "").toUpperCase();
}

function transactionCalldata(tx: GenLayerTx): string | null {
  const candidates = [tx.input, tx.txData, tx.tx_data, tx.data];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && /^0x[0-9a-fA-F]*$/.test(candidate)) {
      return candidate;
    }
    if (candidate && typeof candidate === "object") {
      const record = candidate as Record<string, unknown>;
      for (const key of ["data", "input", "txData", "tx_data"]) {
        const value = record[key];
        if (typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value)) return value;
      }
    }
  }
  return null;
}

function decodedCalldataBinding(tx: GenLayerTx, purchaseId: string): CalldataBinding {
  const data = tx.data;
  if (!data || typeof data !== "object") return "unavailable";
  const calldata = (data as Record<string, unknown>).calldata;
  if (!calldata || typeof calldata !== "object") return "unavailable";
  const readable = (calldata as Record<string, unknown>).readable;
  if (typeof readable !== "string") return "unavailable";
  try {
    const decoded = JSON.parse(readable) as { method?: unknown; args?: unknown };
    if (decoded.method !== "buy_credits" || !Array.isArray(decoded.args)) {
      return "mismatched";
    }
    return decoded.args.length === 1 && decoded.args[0] === purchaseId
      ? "matched"
      : "mismatched";
  } catch {
    return "unavailable";
  }
}

async function fetchTx(txHash: string): Promise<GenLayerTx | null> {
  const response = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getTransactionByHash",
      params: [txHash],
    }),
    cache: "no-store",
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { result?: GenLayerTx | null };
  return data.result ?? null;
}

export async function verifyPurchaseTransaction(params: {
  txHash: string;
  expectedSender: string;
  expectedRecipient: string;
  purchaseId: string;
}): Promise<{ ok: true; amountWei: bigint } | { ok: false; reason: string }> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(params.txHash)) {
    return { ok: false, reason: "Invalid transaction hash format." };
  }
  if (!params.expectedRecipient) {
    return {
      ok: false,
      reason:
        "Payments contract not configured yet (deployment pending). Purchase cannot be verified on-chain.",
    };
  }

  let tx: GenLayerTx | null;
  try {
    tx = await fetchTx(params.txHash);
  } catch {
    return { ok: false, reason: "Could not reach the GenLayer network." };
  }

  if (!tx || !tx.from_address) {
    return { ok: false, reason: "Transaction not found on-chain." };
  }

  const recipient = (tx.to_address || "").toLowerCase();
  if (recipient !== params.expectedRecipient.toLowerCase()) {
    return {
      ok: false,
      reason: "Transaction recipient is not the RoastPayments contract.",
    };
  }

  const sender = (tx.from_address || "").toLowerCase();
  if (sender !== params.expectedSender.toLowerCase()) {
    return { ok: false, reason: "Transaction sender does not match your wallet." };
  }

  let value: bigint;
  try {
    value = BigInt(tx.value ?? 0);
  } catch {
    return { ok: false, reason: "Transaction amount is malformed." };
  }
  if (value <= 0n) {
    return { ok: false, reason: "Transaction carried no GEN." };
  }

  // Finalized (or accepted) with a success result. result codes:
  // the tx only finalizes as successful if buy_credits() did not revert —
  // a reverted buy_credits (duplicate id, below minimum) never finalizes
  // with a success status.
  const status = transactionStatusName(tx.status);
  if (status !== "FINALIZED" && status !== "ACCEPTED") {
    return {
      ok: false,
      reason: `Transaction is still ${status || "PENDING"} — try claiming again in a moment.`,
    };
  }

  const executionResult = executionResultName(tx);
  if (executionResult === "FINISHED_WITH_ERROR") {
    return { ok: false, reason: "buy_credits reverted on-chain." };
  }

  // Some RPC variants expose raw EVM calldata and some expose only decoded
  // GenLayer transaction data. When raw calldata is available it must be the
  // canonical buy_credits(purchaseId) encoding; the route always additionally
  // verifies the authoritative contract purchase record.
  const calldata = transactionCalldata(tx);
  if (calldata && !isCanonicalBuyCreditsCalldata(calldata, params.purchaseId)) {
    return { ok: false, reason: "Transaction calldata is not buy_credits for this purchase." };
  }
  if (!calldata && decodedCalldataBinding(tx, params.purchaseId) === "mismatched") {
    return { ok: false, reason: "Transaction calldata is not buy_credits for this purchase." };
  }

  return { ok: true, amountWei: value };
}
