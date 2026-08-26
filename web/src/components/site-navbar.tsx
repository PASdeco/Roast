"use client";

import Link from "next/link";
import { Flame, Coins } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { WalletButton } from "@/components/wallet/wallet-button";
import { useWallet } from "@/components/wallet/wallet-provider";
import { useCredits } from "@/components/credits/credit-provider";

const NAV_LINKS = [
  { href: "/roast", label: "Roast" },
  { href: "/history", label: "History" },
  { href: "/credits", label: "Credits" },
];

export function SiteNavbar() {
  const { address } = useWallet();
  const { balance, authenticated } = useCredits();

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--page)_88%,transparent)] backdrop-blur">
      <div className="container-shell flex h-14 items-center justify-between gap-2 overflow-hidden">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--roast)] text-white">
            <Flame size={15} strokeWidth={2.4} />
          </span>
          <span className="font-display text-[15px] font-bold tracking-tight text-[var(--ink)]">
            Roast My X
          </span>
        </Link>

        <nav className="flex min-w-0 items-center gap-0.5 sm:gap-2">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="whitespace-nowrap rounded-lg px-2 py-1.5 text-[12.5px] font-semibold text-[var(--copy-muted)] transition-colors hover:text-[var(--ink)] sm:px-2.5 sm:text-[13px]"
            >
              {link.label}
            </Link>
          ))}
          {address && authenticated && (
            <span
              className="hidden items-center gap-1.5 rounded-lg border border-[var(--accent-line)] bg-[var(--accent-soft)] px-2.5 py-1.5 font-mono text-[12px] font-bold text-[var(--accent)] sm:inline-flex"
              title="Your roast credit balance"
            >
              <Coins size={13} />
              {balance}
            </span>
          )}
          <span className="shrink-0">
            <WalletButton />
          </span>
          <span className="shrink-0">
            <ThemeToggle />
          </span>
        </nav>
      </div>
    </header>
  );
}
