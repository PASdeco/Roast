"use client";

import { Coins, Wallet } from "lucide-react";
import { useState } from "react";
import { SiteNavbar } from "@/components/site-navbar";
import { useCredits } from "@/components/credits/credit-provider";
import { useWallet } from "@/components/wallet/wallet-provider";
import {
  CreditPurchaseModal,
} from "@/components/credits/credit-purchase-modal";

const PACKAGES = [
  { id: "starter", gen: "1 GEN", credits: 10 },
  { id: "double", gen: "2 GEN", credits: 20 },
  { id: "jury", gen: "5 GEN", credits: 50 },
];

export default function CreditsPage() {
  const { balance, authenticated, roastCost } = useCredits();
  const { address } = useWallet();
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteNavbar />
      <main className="container-shell max-w-3xl flex-1 py-14">
        <p className="eyebrow">
          <Coins size={13} strokeWidth={2.4} /> Credits
        </p>
        <h1 className="display-title mt-4 text-[32px] sm:text-[44px]">
          Stock up on roasts.
        </h1>

        <div className="card mt-8 flex flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div>
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--copy-muted)]">
              Your balance
            </p>
            <p className="mt-1 font-display text-[30px] font-bold leading-none text-[var(--ink)]">
              {authenticated ? balance : "—"}
            </p>
          </div>
          <p className="max-w-56 text-[12.5px] leading-relaxed text-[var(--copy-muted)]">
            One roast costs {roastCost} credits. Credits live in your
            app account — roasts never touch your wallet.
          </p>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {PACKAGES.map((pkg) => (
            <div key={pkg.id} className="card px-6 py-6">
              <p className="font-display text-[22px] font-bold text-[var(--ink)]">
                {pkg.gen}
              </p>
              <p className="mt-1 font-mono text-[12px] uppercase tracking-[0.12em] text-[var(--accent)]">
                {pkg.credits} credits
              </p>
            </div>
          ))}
        </div>

        <button
          type="button"
          className="btn-primary mt-8 w-full sm:w-auto"
          onClick={() => setModalOpen(true)}
        >
          {address ? (
            "Buy credits"
          ) : (
            <>
              <Wallet size={16} /> Connect wallet to buy credits
            </>
          )}
        </button>

        <p className="field-help mt-6">
          Package pricing is server-side configuration. Every purchase is
          verified on-chain before credits are added — a transaction that
          failed, went to the wrong place, or was already used earns nothing.
        </p>
      </main>

      {modalOpen && <CreditPurchaseModal onClose={() => setModalOpen(false)} />}
    </div>
  );
}
