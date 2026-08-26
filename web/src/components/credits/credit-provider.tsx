"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * Client-side session: balance + auth actions against the backend.
 * The wallet address is only trusted server-side after signature
 * verification (see server/wallet-auth.ts); this context just mirrors
 * what the backend has confirmed.
 */
interface SessionValue {
  balance: number;
  roastCost: number;
  authenticated: boolean;
  walletAddress: string | null;
  refresh: () => Promise<void>;
  signIn: (walletAddress: string) => Promise<boolean>;
  signOut: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function CreditProvider({ children }: { children: ReactNode }) {
  const [balance, setBalance] = useState(0);
  const [roastCost, setRoastCost] = useState(5);
  const [authenticated, setAuthenticated] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/credits/balance");
      const data = (await response.json()) as {
        authenticated: boolean;
        balance: number;
        roastCost: number;
      };
      setAuthenticated(data.authenticated);
      setBalance(data.balance);
      setRoastCost(data.roastCost);
    } catch {
      // keep last known values
    }
  }, []);

  const signIn = useCallback(async (address: string) => {
    const provider = window.ethereum;
    if (!provider) return false;

    // 1. Ask backend for a challenge.
    const challengeResponse = await fetch("/api/auth/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress: address }),
    });
    const { message } = (await challengeResponse.json()) as { message?: string };
    if (!message) return false;

    // 2. Sign it with the wallet.
    let signature: string;
    try {
      signature = (await provider.request({
        method: "personal_sign",
        params: [message, address],
      })) as string;
    } catch {
      return false;
    }

    // 3. Backend verifies and opens the session.
    const verifyResponse = await fetch("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        walletAddress: address,
        message,
        signature,
      }),
    });
    if (!verifyResponse.ok) return false;

    setWalletAddress(address);
    await refresh();
    return true;
  }, [refresh]);

  const signOut = useCallback(() => {
    setAuthenticated(false);
    setWalletAddress(null);
    setBalance(0);
  }, []);

  // Auto sign-in when the wallet connects; sign out when it disconnects.
  useEffect(() => {
    const provider = window.ethereum;
    if (!provider) return;

    const onAccounts = (...args: unknown[]) => {
      const accounts = args[0] as string[] | undefined;
      if (accounts && accounts.length > 0) {
        void signIn(accounts[0]);
      } else {
        signOut();
      }
    };
    provider.on?.("accountsChanged", onAccounts);
    return () => provider.removeListener?.("accountsChanged", onAccounts);
  }, [signIn, signOut]);

  return (
    <SessionContext.Provider
      value={{ balance, roastCost, authenticated, walletAddress, refresh, signIn, signOut }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useCredits() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useCredits must be used inside CreditProvider.");
  return context;
}
