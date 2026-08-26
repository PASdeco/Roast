"use client";

import { Archive, ChevronRight, Flame } from "lucide-react";
import { useEffect, useState } from "react";
import { SiteNavbar } from "@/components/site-navbar";
import { useWallet } from "@/components/wallet/wallet-provider";

interface HistoryItem {
  id: string;
  profile: string;
  status: "processing" | "completed" | "failed" | "refunded";
  thesis: string | null;
  createdAt: string;
}

const STATUS_LABEL: Record<HistoryItem["status"], string> = {
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
  refunded: "Refunded",
};

function formatDate(iso: string): string {
  const date = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function HistoryPage() {
  const { address } = useWallet();
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const needsFetch = Boolean(address) && loadedFor !== address;

  useEffect(() => {
    if (!address || loadedFor === address) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/history?wallet=${encodeURIComponent(address)}`);
        const data = (await response.json()) as { roasts?: HistoryItem[] };
        if (!cancelled) {
          setItems(data.roasts ?? []);
          setLoadedFor(address);
        }
      } catch {
        if (!cancelled) {
          setItems([]);
          setLoadedFor(address);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address, loadedFor]);

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteNavbar />
      <main className="container-shell max-w-2xl flex-1 py-14">
        <p className="eyebrow">
          <Archive size={13} strokeWidth={2.4} /> The archive
        </p>
        <h1 className="display-title mt-4 text-[32px] sm:text-[44px]">
          Your past roasts.
        </h1>

        {!address && (
          <p className="mt-8 text-[14px] text-[var(--copy-muted)]">
            Connect your wallet to see your roast history.
          </p>
        )}

        {needsFetch && (
          <p className="mt-8 text-[14px] text-[var(--copy-muted)]">Loading…</p>
        )}

        {!address || (items !== null && items.length === 0) && (
          <div className="card-sunken mt-8 flex flex-col items-center px-6 py-12 text-center">
            <Flame size={22} className="text-[var(--roast)]" aria-hidden />
            <p className="mt-3 font-display text-[17px] font-bold text-[var(--ink)]">
              No roasts yet.
            </p>
            <p className="mt-1 text-[13.5px] text-[var(--copy-muted)]">
              The jury is waiting. Your evaluations will collect here.
            </p>
          </div>
        )}

        {items !== null && items.length > 0 && (
          <ul className="mt-8 space-y-3">
            {items.map((item) => (
              <li key={item.id} className="card px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-display text-[15px] font-bold text-[var(--ink)]">
                        @{item.profile}
                      </span>
                      <span
                        className={`verdict-pill ${
                          item.status === "completed" ? "verdict-solid" : ""
                        }`}
                      >
                        {STATUS_LABEL[item.status]}
                      </span>
                    </p>
                    <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--copy-muted)]">
                      {formatDate(item.createdAt)}
                    </p>
                    {item.thesis && (
                      <p className="mt-2 line-clamp-2 text-[13.5px] leading-relaxed text-[var(--copy)]">
                        “{item.thesis}”
                      </p>
                    )}
                  </div>
                  <ChevronRight
                    size={17}
                    className="mt-1 shrink-0 text-[var(--copy-muted)]"
                    aria-hidden
                  />
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="field-help mt-8">
          Viewing past results is always free — credits are only spent on new
          roasts.
        </p>
      </main>
    </div>
  );
}
