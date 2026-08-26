"use client";

import { X, Coins, LoaderCircle, CheckCircle2, AlertTriangle } from "lucide-react";
import { useCallback, useState } from "react";
import { useCredits } from "./credit-provider";
import { useWallet } from "@/components/wallet/wallet-provider";
import { ensureStudionet } from "@/components/wallet/network-guard";

interface Package {
  id: string;
  label: string;
  credits: number;
}

const PACKAGES: Package[] = [
  { id: "starter", label: "1 GEN", credits: 10 },
  { id: "double", label: "2 GEN", credits: 20 },
  { id: "jury", label: "5 GEN", credits: 50 },
];

type Stage = "idle" | "signing" | "waiting" | "verifying" | "done" | "error";

/**
 * Credit purchase modal (blueprint §25/§26). Wallet signature = auth,
 * GEN payment goes to the treasury, backend verifies the tx on-chain
 * before credits appear. The frontend never declares success on its own.
 */
export function CreditPurchaseModal({ onClose }: { onClose: () => void }) {
  const { refresh } = useCredits();
  const { address, connect } = useWallet();
  const [selected, setSelected] = useState<Package>(PACKAGES[1]);
  const [stage, setStage] = useState<Stage>("idle");
  const [message, setMessage] = useState("");

  const handleBuy = useCallback(async () => {
    let wallet: string | undefined = address ?? undefined;
    if (!wallet) {
      setStage("signing");
      try {
        await connect();
        wallet = window.ethereum
          ? ((await window.ethereum.request({ method: "eth_accounts" })) as string[])[0]
          : undefined;
      } catch {
        setStage("error");
        setMessage("Wallet connection was not completed.");
        return;
      }
    }
    if (!wallet) {
      setStage("error");
      setMessage("No wallet account available.");
      return;
    }

    try {
      setStage("signing");
      const provider = window.ethereum;
      if (!provider) throw new Error("No wallet installed.");

      // CRITICAL SAFETY: force the wallet onto GenLayer studionet BEFORE
      // any payment. Prevents real ETH being sent on mainnet (chainId
      // mismatch = the app must refuse to proceed).
      try {
        await ensureStudionet();
      } catch (switchError) {
        throw switchError instanceof Error
          ? switchError
          : new Error("Network switch to GenLayer studionet failed.");
      }

      // 1. Auth challenge + signature (proves ownership for the purchase).
      const challengeResponse = await fetch("/api/auth/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: wallet }),
      });
      const { message: challenge } = (await challengeResponse.json()) as {
        message?: string;
      };
      if (!challenge) throw new Error("Could not start purchase session.");
      const authSignature = (await provider.request({
        method: "personal_sign",
        params: [challenge, wallet],
      })) as string;

      // 2. Payment transaction: call buy_credits(purchaseId) on the
      //    deployed RoastPayments contract. Contract address + package
      //    pricing come from the backend config endpoint.
      const configResponse = await fetch("/api/credits/config");
      const config = (await configResponse.json()) as {
        paymentsContractAddress?: string;
        packages?: Record<string, { genWei: string }>;
      };
      const paymentsContract = config.paymentsContractAddress;
      if (!paymentsContract) {
        throw new Error(
          "Payments are not configured yet — the contract address is being set up.",
        );
      }
      const genWei = config.packages?.[selected.id]?.genWei;
      if (!genWei) throw new Error("Unknown package.");

      const purchaseId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const data = toBuyCreditsCalldata(purchaseId);

      setStage("waiting");
      const txHash = (await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: wallet,
            to: paymentsContract,
            value: toHexWei(genWei),
            data,
          },
        ],
      })) as string;

      // 3. Backend verifies on-chain; frontend never self-declares success.
      setStage("verifying");
      const verifyResponse = await fetch("/api/credits/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          txHash,
          purchaseId,
          packageId: selected.id,
          walletAddress: wallet,
          authMessage: challenge,
          authSignature,
        }),
      });
      const result = (await verifyResponse.json()) as {
        credited?: number;
        balance?: number;
        error?: string;
      };
      if (!verifyResponse.ok) {
        throw new Error(result.error || "Payment verification failed.");
      }

      setStage("done");
      setMessage(`+${result.credited} credits added.`);
      await refresh();
    } catch (caught) {
      setStage("error");
      setMessage(
        caught instanceof Error ? caught.message : "Purchase did not complete.",
      );
    }
  }, [address, connect, refresh, selected]);

  const busy = stage === "signing" || stage === "waiting" || stage === "verifying";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Buy credits"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="card w-full max-w-md rounded-b-none sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-6 py-4">
          <p className="eyebrow">
            <Coins size={13} strokeWidth={2.4} /> Buy credits
          </p>
          <button
            type="button"
            aria-label="Close"
            className="btn-ghost !min-h-8 !rounded-lg !px-2"
            onClick={onClose}
            disabled={busy}
          >
            <X size={15} />
          </button>
        </div>

        <div className="px-6 py-5">
          <div className="grid grid-cols-3 gap-2">
            {PACKAGES.map((pkg) => (
              <button
                key={pkg.id}
                type="button"
                disabled={busy}
                onClick={() => setSelected(pkg)}
                className={`rounded-xl border px-2 py-3 text-center transition-colors ${
                  selected.id === pkg.id
                    ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                    : "border-[var(--line)] hover:border-[var(--line-strong)]"
                }`}
              >
                <span className="block font-display text-[15px] font-bold text-[var(--ink)]">
                  {pkg.label}
                </span>
                <span className="mt-0.5 block font-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--accent)]">
                  {pkg.credits} cr
                </span>
              </button>
            ))}
          </div>

          <dl className="card-sunken mt-4 space-y-1.5 px-4 py-3 text-[13px]">
            <div className="flex justify-between">
              <dt className="text-[var(--copy-muted)]">Purchasing</dt>
              <dd className="font-semibold text-[var(--ink)]">
                {selected.credits} Roast Credits
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--copy-muted)]">Cost</dt>
              <dd className="font-semibold text-[var(--ink)]">{selected.label}</dd>
            </div>
          </dl>

          {stage === "done" && (
            <p className="mt-4 flex items-center gap-2 rounded-lg bg-[color-mix(in_srgb,var(--good)_9%,transparent)] px-3 py-2.5 text-[13px] font-semibold text-[var(--good)]">
              <CheckCircle2 size={16} /> Payment confirmed. {message}
            </p>
          )}
          {stage === "error" && (
            <p className="mt-4 flex items-start gap-2 rounded-lg bg-[var(--roast-soft)] px-3 py-2.5 text-[13px] font-medium text-[var(--roast)]">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {message}
            </p>
          )}
          {stage === "waiting" && (
            <p className="mt-4 flex items-center gap-2 text-[13px] font-medium text-[var(--copy-muted)]">
              <LoaderCircle size={15} className="animate-spin" /> Waiting for transaction…
            </p>
          )}
          {stage === "verifying" && (
            <p className="mt-4 flex items-center gap-2 text-[13px] font-medium text-[var(--copy-muted)]">
              <LoaderCircle size={15} className="animate-spin" /> Verifying payment on-chain…
            </p>
          )}

          <button
            type="button"
            className="btn-primary mt-5 w-full"
            onClick={() => void handleBuy()}
            disabled={busy || stage === "done"}
          >
            {busy && <LoaderCircle size={16} className="animate-spin" />}
            {stage === "done" ? "Purchase complete" : "Confirm purchase"}
          </button>

          <p className="field-help mt-3">
            You sign twice: once to prove your wallet, once to send GEN. The
            backend verifies your payment on-chain before credits appear.
          </p>
        </div>
      </div>
    </div>
  );
}

/** eth_sendTransaction wants hex quantity values. */
function toHexWei(genWei: string): string {
  return "0x" + BigInt(genWei).toString(16);
}

/**
 * Encodes buy_credits(string) calldata: selector 0xdd219a64
 * (keccak("buy_credits(string)")[:4], verified against viem), then
 * ABI-encoded string offset/length/data.
 */
function toBuyCreditsCalldata(purchaseId: string): string {
  const selector = "0xdd219a64";
  const encoder = new TextEncoder();
  const bytes = encoder.encode(purchaseId);
  // word 0: offset to string data (0x20), word 1: string length, words 2+: data
  const words: number[] = [0x20, bytes.length];
  for (let i = 0; i < bytes.length; i += 32) {
    let word = 0;
    for (let j = 0; j < 32; j++) {
      if (i + j < bytes.length) word = word * 256 + bytes[i + j];
      else word = word * 256;
    }
    words.push(word);
  }
  return (
    selector +
    words
      .map((word) => word.toString(16).padStart(64, "0"))
      .join("")
  );
}
