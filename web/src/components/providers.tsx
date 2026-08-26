"use client";

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { WalletProvider } from "@/components/wallet/wallet-provider";
import { CreditProvider } from "@/components/credits/credit-provider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem>
      <WalletProvider>
        <CreditProvider>{children}</CreditProvider>
      </WalletProvider>
    </ThemeProvider>
  );
}
