"use client";

/**
 * Wallet network guard (client-side).
 * Ensures the injected wallet is on the GenLayer studionet (chainId
 * 61999) before any payment flow. Switches automatically; adds the
 * chain to the wallet first if it is missing.
 */
export const STUDIONET_CHAIN_ID = 61999;

const STUDIONET_PARAMS = {
  chainId: "0xf22f", // 61999
  chainName: "GenLayer Studio Network",
  nativeCurrency: { name: "GEN Token", symbol: "GEN", decimals: 18 },
  rpcUrls: ["https://studio.genlayer.com/api"],
  blockExplorerUrls: ["https://studio.genlayer.com/explorer"],
};

function getProvider(): EthereumProvider | null {
  return typeof window === "undefined" ? null : window.ethereum ?? null;
}

export async function getWalletChainId(): Promise<string | null> {
  const provider = getProvider();
  if (!provider) return null;
  try {
    return (await provider.request({ method: "eth_chainId" })) as string;
  } catch {
    return null;
  }
}

/**
 * Ensures the wallet is on studionet. Returns true when on the correct
 * chain; throws a user-friendly Error when the user rejects the switch.
 */
export async function ensureStudionet(): Promise<boolean> {
  const provider = getProvider();
  if (!provider) throw new Error("No wallet installed.");

  const chainId = await getWalletChainId();
  if (chainId?.toLowerCase() === STUDIONET_PARAMS.chainId) return true;

  try {
    // Try switching first.
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: STUDIONET_PARAMS.chainId }],
    });
    return true;
  } catch (error) {
    const code = (error as { code?: number }).code;
    // 4902 = chain not added to the wallet yet.
    if (code === 4902 || (error instanceof Error && error.message.includes("Unrecognized chain"))) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [STUDIONET_PARAMS],
      });
      // After adding, switch.
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: STUDIONET_PARAMS.chainId }],
      });
      return true;
    }
    if (code === 4001) {
      throw new Error("You rejected the network switch. GenLayer studionet is required to buy credits — the payment is testnet GEN, not real ETH.");
    }
    throw new Error("Could not switch your wallet to GenLayer studionet.");
  }
}
