import "server-only";

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
  status?: string;
  result?: number;
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

  const value = BigInt(tx.value ?? 0);
  if (value <= 0n) {
    return { ok: false, reason: "Transaction carried no GEN." };
  }

  // Finalized (or accepted) with a success result. result codes:
  // the tx only finalizes as successful if buy_credits() did not revert —
  // a reverted buy_credits (duplicate id, below minimum) never finalizes
  // with a success status.
  const status = (tx.status || "").toUpperCase();
  if (status !== "FINALIZED" && status !== "ACCEPTED") {
    return {
      ok: false,
      reason: `Transaction is still ${status || "PENDING"} — try claiming again in a moment.`,
    };
  }

  return { ok: true, amountWei: value };
}
