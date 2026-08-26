import "server-only";

/**
 * GenLayer service isolation (blueprint §33/§49): ALL contract interaction
 * lives here. When ROAST_JURY_CONTRACT_ADDRESS is unset, the service runs
 * in an explicit "unconfigured" state — it never fakes results.
 */
import { createAccount, createClient } from "genlayer-js";
import {
  localnet,
  studionet,
  testnetAsimov,
  testnetBradbury,
} from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const chainMap = {
  localnet,
  studionet,
  testnetAsimov,
  testnetBradbury,
} as const;

export function juryConfigured(): boolean {
  return Boolean(
    process.env.ROAST_JURY_CONTRACT_ADDRESS &&
      process.env.GENLAYER_NETWORK &&
      process.env.BACKEND_PRIVATE_KEY,
  );
}

function getClient() {
  const chainName = (process.env.GENLAYER_NETWORK || "studionet") as
    | keyof typeof chainMap;
  const chain = chainMap[chainName] ?? studionet;
  const privateKey = process.env.BACKEND_PRIVATE_KEY;
  if (!privateKey) throw new Error("BACKEND_PRIVATE_KEY is not configured.");

  return createClient({
    chain,
    account: createAccount(privateKey as `0x${string}`),
  });
}

export interface JuryResult {
  username: string;
  display_name: string;
  bio: string;
  avatar_url: string;
  thesis: string;
  roast: string;
  improvements: { area: string; issue: string; recommendation: string }[];
  disagreement: string;
  evidence: string[];
  data_available: string[];
  judges: {
    role: string;
    label: string;
    verdict: string;
    summary: string;
    reasoning: string;
  }[];
  created_at: number;
}

/**
 * Submits a roast to the deployed RoastJury contract using the
 * backend-funded wallet (blueprint Rule 12: users never sign for roasts).
 * Waits for finality, then reads back the stored result.
 */
export async function submitRoastToJury(handle: string): Promise<JuryResult> {
  if (!juryConfigured()) {
    throw new Error(
      "The jury is not deployed yet. GenLayer contract configuration pending.",
    );
  }

  const client = getClient();
  const contractAddress = process.env
    .ROAST_JURY_CONTRACT_ADDRESS as `0x${string}`;

  const txHash = await client.writeContract({
    address: contractAddress,
    functionName: "submit_roast",
    args: [handle],
    value: 0n,
  });

  // The jury runs five LLM evaluations plus validator re-runs on-chain —
  // this routinely takes 5-10 minutes on studionet. Wait accordingly:
  // 3s interval x 300 attempts = 15 minutes ceiling.
  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    status: TransactionStatus.ACCEPTED,
    interval: 3_000,
    retries: 300,
  });

  if (receipt.txExecutionResultName === "FINISHED_WITH_ERROR") {
    // Distinguish profile-not-found from system failure via revert reason.
    const reason = String(
      (receipt as { revert_reason?: string }).revert_reason || "",
    );
    if (reason.includes("could not be found")) {
      throw new ProfileNotFoundError(handle);
    }
    if (reason.includes("already roasted")) {
      // Read the existing result instead of failing.
      return readRoastFromJury(handle);
    }
    throw new Error("The jury could not complete this evaluation.");
  }

  return readRoastFromJury(handle);
}

export class ProfileNotFoundError extends Error {
  constructor(handle: string) {
    super(`X profile could not be found: @${handle}`);
    this.name = "ProfileNotFoundError";
  }
}

export async function readRoastFromJury(handle: string): Promise<JuryResult> {
  if (!process.env.ROAST_JURY_CONTRACT_ADDRESS) {
    throw new Error("The jury is not deployed yet.");
  }
  const client = getClient();
  const contractAddress = process.env
    .ROAST_JURY_CONTRACT_ADDRESS as `0x${string}`;

  const result = (await client.readContract({
    address: contractAddress,
    functionName: "get_roast",
    args: [handle],
  })) as unknown as JuryResult;

  return result;
}

export async function juryHasRoast(handle: string): Promise<boolean> {
  if (!process.env.ROAST_JURY_CONTRACT_ADDRESS) return false;
  const client = getClient();
  const result = (await client.readContract({
    address: process.env.ROAST_JURY_CONTRACT_ADDRESS as `0x${string}`,
    functionName: "has_roast",
    args: [handle],
  })) as boolean;
  return result === true;
}
