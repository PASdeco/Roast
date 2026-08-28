import "server-only";

/**
 * Wallet authentication (blueprint §31): the frontend proves wallet
 * ownership by signing a challenge; the backend verifies the signature
 * before touching the user's ledger. A raw address from the frontend is
 * never trusted.
 *
 * Challenge = "Roast My X\nWallet: 0x…\nNonce: <random>" signed with
 * personal_sign. Verified with viem's verifyMessage.
 */
import { randomBytes } from "node:crypto";
import { verifyMessage } from "viem";
import { consumeAuthChallenge, createAuthChallenge } from "@/server/ledger";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export async function createChallenge(walletAddress: string): Promise<string> {
  const normalized = walletAddress.toLowerCase();
  const nonce = randomBytes(16).toString("hex");
  await createAuthChallenge({
    walletAddress: normalized,
    nonce,
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
  });

  return `Roast My X\nWallet: ${normalized}\nNonce: ${nonce}`;
}

export async function verifyChallenge(params: {
  walletAddress: string;
  message: string;
  signature: string;
}): Promise<boolean> {
  const normalized = params.walletAddress.toLowerCase();
  const match = params.message.match(/^Roast My X\nWallet: (0x[0-9a-f]{40})\nNonce: ([a-f0-9]{32})$/i);
  if (!match || match[1].toLowerCase() !== normalized) return false;

  try {
      const valid = await verifyMessage({
      address: params.walletAddress as `0x${string}`,
      message: params.message,
      signature: params.signature as `0x${string}`,
    });
    if (!valid) return false;
    return consumeAuthChallenge({ walletAddress: normalized, nonce: match[2] });
  } catch {
    return false;
  }
}
