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

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

interface StoredChallenge {
  nonce: string;
  createdAt: number;
}

// In-memory challenge store. For multi-instance production deployments,
// move this to the shared database or Redis.
const challenges = new Map<string, StoredChallenge>();

export function createChallenge(walletAddress: string): string {
  const normalized = walletAddress.toLowerCase();
  const nonce = randomBytes(16).toString("hex");
  challenges.set(normalized, { nonce, createdAt: Date.now() });

  // Opportunistic cleanup of expired challenges.
  const now = Date.now();
  for (const [key, value] of challenges) {
    if (now - value.createdAt > CHALLENGE_TTL_MS) challenges.delete(key);
  }

  return `Roast My X\nWallet: ${normalized}\nNonce: ${nonce}`;
}

export async function verifyChallenge(params: {
  walletAddress: string;
  message: string;
  signature: string;
}): Promise<boolean> {
  const normalized = params.walletAddress.toLowerCase();
  const stored = challenges.get(normalized);
  if (!stored) return false;
  challenges.delete(normalized);

  if (Date.now() - stored.createdAt > CHALLENGE_TTL_MS) return false;
  if (!params.message.includes(`Nonce: ${stored.nonce}`)) return false;

  try {
    const valid = await verifyMessage({
      address: params.walletAddress as `0x${string}`,
      message: params.message,
      signature: params.signature as `0x${string}`,
    });
    return valid === true;
  } catch {
    return false;
  }
}
