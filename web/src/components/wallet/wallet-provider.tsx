"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface WalletContextValue {
  address: `0x${string}` | null;
  provider: EthereumProvider | null;
  connecting: boolean;
  error: string;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

function firstAddress(value: unknown): `0x${string}` | null {
  if (!Array.isArray(value) || typeof value[0] !== "string") return null;
  return value[0] as `0x${string}`;
}

/**
 * Wallet = payment + identity only (blueprint §7). Roasts never trigger
 * wallet signatures — the backend funds GenLayer execution.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [provider, setProvider] = useState<EthereumProvider | null>(
    () => (typeof window === "undefined" ? null : window.ethereum ?? null),
  );
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  // Restore an already-authorized account and follow account switches.
  useEffect(() => {
    const injected = provider;
    if (!injected) return;

    void injected
      .request({ method: "eth_accounts" })
      .then((accounts) => setAddress(firstAddress(accounts)));
    const onAccounts = (...args: unknown[]) => setAddress(firstAddress(args[0]));
    injected.on?.("accountsChanged", onAccounts);
    return () => injected.removeListener?.("accountsChanged", onAccounts);
  }, [provider]);

  const connect = useCallback(async () => {
    setError("");
    setConnecting(true);
    try {
      const injected = window.ethereum;
      if (!injected)
        throw new Error("Install a MetaMask-compatible wallet to continue.");
      const accounts = await injected.request({ method: "eth_requestAccounts" });
      const selected = firstAddress(accounts);
      if (!selected) throw new Error("The wallet did not return an account.");
      setProvider(injected);
      setAddress(selected);
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "Wallet connection was not completed.";
      setError(message);
      throw caught;
    } finally {
      setConnecting(false);
    }
  }, []);

  const value = useMemo(
    () => ({
      address,
      provider,
      connecting,
      error,
      connect,
      disconnect: () => setAddress(null),
    }),
    [address, provider, connecting, error, connect],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used inside WalletProvider.");
  return context;
}

export function shortenAddress(address: string): string {
  if (address.length < 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
