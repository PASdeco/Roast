"use client";

import { Wallet } from "lucide-react";
import { useWallet, shortenAddress } from "./wallet-provider";

export function WalletButton() {
  const { address, connecting, connect, disconnect } = useWallet();

  if (address) {
    return (
      <button
        type="button"
        className="btn-ghost !min-h-9 !rounded-lg !px-3 font-mono !text-[12.5px]"
        onClick={disconnect}
        title="Disconnect wallet"
      >
        <span className="h-2 w-2 rounded-full bg-[var(--good)]" aria-hidden />
        {shortenAddress(address)}
      </button>
    );
  }

  return (
    <button
      type="button"
      className="btn-primary !min-h-9 !rounded-lg !px-3 !text-[13px]"
      onClick={() => void connect()}
      disabled={connecting}
    >
      <Wallet size={15} />
      {connecting ? "Connecting…" : "Connect"}
    </button>
  );
}
