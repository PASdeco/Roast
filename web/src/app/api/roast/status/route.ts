import { NextResponse } from "next/server";
import { getRoastResult, getBalance, getRoastStatus } from "@/server/ledger";
import { sessionUserFromRequest } from "@/server/session";
import { processRoastJob } from "@/server/roast-worker";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Maps a persisted failure reason onto a specific, honest user message. */
function juryFailureMessage(failureReason: string | null | undefined): string {
  const reason = (failureReason || "").toUpperCase();
  if (reason.includes("VALIDATORS_TIMEOUT") || reason.includes("LEADER_TIMEOUT")) {
    return "The jury ran out of time before reaching consensus.";
  }
  if (reason.includes("NO_MAJORITY") || reason.includes("MAJORITY_DISAGREE") || reason.includes("DISAGREE")) {
    return "The validators couldn't agree on an evaluation this time.";
  }
  if (reason.includes("UNDETERMINED")) {
    return "The jury couldn't determine this profile reliably this time.";
  }
  if (reason.includes("LLM_ERROR") || reason.includes("CANCELED")) {
    return "The evaluation pipeline failed midway.";
  }
  if (reason.includes("DEADLINE") || reason.includes("EXCEEDED")) {
    return "The jury took longer than allowed for this profile.";
  }
  return "The jury couldn't reach a usable evaluation this time.";
}

/**
 * Roast status polling (blueprint §53): the client asks for the result
 * of a submitted jury run. States: pending (still on-chain), completed
 * (full verdict), failed/refunded (credits returned).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const roastId = url.searchParams.get("id") || "";

  if (!/^[\w-]{36}$/.test(roastId)) {
    return NextResponse.json({ error: "Valid roast id required." }, { status: 400 });
  }

  const user = await sessionUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Sign in with your wallet to view roast status." }, { status: 401 });
  }

  const initial = await getRoastStatus(user.id, roastId);
  if (!initial) {
    return NextResponse.json({ error: "Roast not found." }, { status: 404 });
  }

  if (initial.status === "processing") await processRoastJob(roastId);
  const record = await getRoastResult(user.id, roastId);

  if (record) {
    return NextResponse.json({
      state: "completed",
      roast: record.result,
      balance: await getBalance(user.id),
    });
  }

  // Not completed yet — check whether it failed/refunded.
  const mine = await getRoastStatus(user.id, roastId);

  if (mine && (mine.status === "refunded" || mine.status === "failed")) {
    return NextResponse.json({
      state: "failed",
      refunded: mine.status === "refunded",
      error:
        juryFailureMessage(mine.failure_reason) +
        (mine.status === "refunded" ? " Your credits were refunded." : ""),
      balance: await getBalance(user.id),
    });
  }

  return NextResponse.json({ state: "pending" });
}
