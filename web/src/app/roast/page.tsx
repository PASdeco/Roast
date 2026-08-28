"use client";

import { Flame, Coins, RefreshCw, Share2, AlertTriangle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { SiteNavbar } from "@/components/site-navbar";
import { JuryLoader } from "@/components/roast/jury-loader";
import { RoastResultView, type RoastResult } from "@/components/roast/roast-result-view";
import { CreditPurchaseModal } from "@/components/credits/credit-purchase-modal";
import { useCredits } from "@/components/credits/credit-provider";
import { useWallet } from "@/components/wallet/wallet-provider";
import { ensureStudionet } from "@/components/wallet/network-guard";

type Phase = "input" | "loading" | "result" | "error";

const COST = 5;

function RoastFlow() {
  const searchParams = useSearchParams();
  const prefill = searchParams.get("profile");
  const initialHandle = (prefill ?? "").replace(/^@/, "");

  const { balance, refresh } = useCredits();
  const { address } = useWallet();

  const [profileInput] = useState(initialHandle);
  const [handle] = useState(initialHandle);
  const [phase, setPhase] = useState<Phase>("input");
  const [result, setResult] = useState<RoastResult | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [buyOpen, setBuyOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  // Synchronous in-flight guard — prevents double POST when the user
  // double-clicks or when the auto-run timer fires while a manual click
  // is already in flight. React state (starting) alone is async and
  // cannot serialize two calls that start within the same tick.
  const inFlightRef = useRef(false);

  const startRoast = useCallback(async () => {
    if (inFlightRef.current) return;
    setError(null);
    const provider = window.ethereum;

    try {
      if (!provider) throw new Error("Install a MetaMask-compatible wallet to continue.");
      const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
      const wallet = accounts[0];
      if (!wallet) throw new Error("Connect your wallet first.");

      if (balance < COST) {
        setBuyOpen(true);
        return;
      }

      // Lock synchronously before any await so a second concurrent call bails.
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setStarting(true);

      // Auth challenge for the roast request.
      // Safety: ensure wallet is on GenLayer studionet before signing.
      await ensureStudionet();

      const challengeResponse = await fetch("/api/auth/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: wallet }),
      });
      const { message } = (await challengeResponse.json()) as { message?: string };
      if (!message) throw new Error("Could not start the roast session.");
      const signature = (await provider.request({
        method: "personal_sign",
        params: [message, wallet],
      })) as string;

      setPhase("loading");

      const response = await fetch("/api/roast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: profileInput,
          walletAddress: wallet,
          authMessage: message,
          authSignature: signature,
        }),
      });
      const data = (await response.json()) as {
        roastId?: string;
        balance?: number;
        error?: string;
        code?: string;
      };

      if (!response.ok) {
        setPhase("error");
        setError({ message: data.error || "Something went wrong.", code: data.code });
        return;
      }

      if (!data.roastId) {
        setPhase("error");
        setError({ message: "The roast did not start." });
        return;
      }

      // Poll for the verdict — jury runs take 5-15 minutes on studionet.
      const roastId = data.roastId;
      const deadline = Date.now() + 25 * 60 * 1000; // 25 min ceiling
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 15000));
        let statusResponse: Response;
        try {
          statusResponse = await fetch(
            `/api/roast/status?id=${encodeURIComponent(roastId)}&wallet=${encodeURIComponent(wallet)}`,
          );
        } catch {
          continue; // transient network blip — keep polling
        }
        if (!statusResponse.ok) continue;
        const status = (await statusResponse.json()) as {
          state: "pending" | "completed" | "failed";
          roast?: RoastResult;
          error?: string;
          balance?: number;
        };
        if (status.state === "completed" && status.roast) {
          setResult(status.roast);
          setPhase("result");
          await refresh();
          return;
        }
        if (status.state === "failed") {
          setPhase("error");
          setError({ message: status.error || "The jury could not complete." });
          await refresh();
          return;
        }
      }

      setPhase("error");
      setError({
        message:
          "The jury is still deliberating on-chain. Your credits are reserved — check History in a few minutes; you will not be charged twice.",
      });
    } catch (caught) {
      setPhase("error");
      setError({
        message: caught instanceof Error ? caught.message : "The roast did not start.",
      });
    } finally {
      inFlightRef.current = false;
      setStarting(false);
    }
  }, [balance, profileInput, refresh]);

  // Auto-run when handed a profile from the landing page.
  // The guard inside the timer (not just at scheduling time) prevents the
  // exact double you saw: user clicks "Roast my profile" within 400ms of
  // the landing-page redirect, so both the manual click and the timer would
  // fire. The inFlightRef serializes them; the phase checks inside the
  // callback avoid stale-closure races.
  useEffect(() => {
    if (!initialHandle) return;
    if (phase !== "input" || result || error) return;
    if (inFlightRef.current || starting) return;
    const timer = setTimeout(() => {
      if (phase !== "input" || inFlightRef.current || starting) return;
      void startRoast();
    }, 400);
    return () => clearTimeout(timer);
  }, [initialHandle, phase, starting, result, error, startRoast]);

  const remaining = Math.max(0, balance - COST);

  // ----- Loading -----
  if (phase === "loading") {
    return (
      <div className="flex min-h-dvh flex-col">
        <SiteNavbar />
        <main className="container-shell flex-1">
          <JuryLoader handle={handle || profileInput.replace(/^@/, "")} />
        </main>
      </div>
    );
  }

  // ----- Result -----
  if (phase === "result" && result) {
    return (
      <div className="flex min-h-dvh flex-col">
        <main className="flex-1">
          <RoastResultView result={result} />
          <div className="container-shell max-w-4xl flex flex-wrap gap-3 pb-16">
            <button
              type="button"
              className="btn-roast"
              onClick={() => {
                setResult(null);
                setPhase("input");
                setError(null);
              }}
            >
              <RefreshCw size={16} /> Roast it again
            </button>
            <button type="button" className="btn-primary" disabled title="Slice 9">
              <Share2 size={16} /> Share my roast
            </button>
          </div>
        </main>
      </div>
    );
  }

  // ----- Error -----
  if (phase === "error" && error) {
    return (
      <div className="flex min-h-dvh flex-col">
        <SiteNavbar />
        <main className="container-shell flex max-w-lg flex-1 flex-col items-center justify-center py-16 text-center">
          <p className="eyebrow eyebrow-roast justify-center">
            <AlertTriangle size={13} strokeWidth={2.4} /> The jury adjourned
          </p>
          <h1 className="display-title mt-4 text-[26px] sm:text-[32px]">
            {error.code === "not_found"
              ? "We couldn't find that profile."
              : error.code === "insufficient_credits"
                ? "You're out of credits."
                : "That didn't go through."}
          </h1>
          <p className="mt-3 text-[14px] leading-relaxed text-[var(--copy-muted)]">
            {error.message}
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            {/* Retry the same handle — most "adjourned" failures are transient LLM/consensus hiccups that succeed on retry */}
            <button
              type="button"
              className="btn-roast"
              disabled={starting}
              onClick={() => {
                setError(null);
                setPhase("input");
                // Defer to next tick so state settles before the guarded startRoast runs
                setTimeout(() => void startRoast(), 0);
              }}
            >
              <RefreshCw size={16} /> Retry this profile
            </button>
            <button type="button" className="btn-ghost" onClick={() => { setPhase("input"); setError(null); }}>
              Try another profile
            </button>
            {error.code === "insufficient_credits" && (
              <button type="button" className="btn-primary" onClick={() => setBuyOpen(true)}>
                <Coins size={16} /> Buy credits
              </button>
            )}
          </div>
          {buyOpen && <CreditPurchaseModal onClose={() => setBuyOpen(false)} />}
        </main>
      </div>
    );
  }

  // ----- Input / confirm -----
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteNavbar />
      <main className="container-shell flex max-w-xl flex-1 flex-col justify-center py-16">
        <p className="eyebrow eyebrow-roast justify-center">
          <Flame size={13} strokeWidth={2.4} /> One roast incoming
        </p>
        <h1 className="display-title mt-4 text-center text-[30px] sm:text-[38px]">
          @{handle || "…"}
        </h1>

        <div className="card-sunken mt-8 space-y-2 px-5 py-4 text-[13.5px]">
          <div className="flex justify-between">
            <span className="text-[var(--copy-muted)]">Cost</span>
            <span className="font-semibold text-[var(--ink)]">{COST} credits</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--copy-muted)]">Your balance</span>
            <span className="font-semibold text-[var(--ink)]">{balance} credits</span>
          </div>
          <div className="flex justify-between border-t border-[var(--line)] pt-2">
            <span className="text-[var(--copy-muted)]">Remaining after roast</span>
            <span className="font-semibold text-[var(--ink)]">{remaining} credits</span>
          </div>
        </div>

        {!address && (
          <p className="mt-4 text-center text-[13px] font-medium text-[var(--warn)]">
            Connect your wallet to continue — it identifies your credit account.
          </p>
        )}

        <button
          type="button"
          className="btn-roast mt-6 w-full"
          onClick={() => void startRoast()}
          disabled={starting || !address}
        >
          <Flame size={17} strokeWidth={2.4} />
          {balance < COST ? "Buy credits to roast" : "Roast my profile"}
        </button>

        <p className="field-help mt-3 text-center">
          No wallet signature needed for the roast itself — credits cover it.
          All five judges run together; you get one unified verdict.
        </p>
      </main>

      {buyOpen && <CreditPurchaseModal onClose={() => setBuyOpen(false)} />}
    </div>
  );
}

export default function RoastPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh flex-col">
          <SiteNavbar />
          <main className="container-shell flex flex-1 items-center justify-center">
            <p className="text-[14px] text-[var(--copy-muted)]">Loading…</p>
          </main>
        </div>
      }
    >
      <RoastFlow />
    </Suspense>
  );
}
