import { NextResponse } from "next/server";
import {
  getOrCreateUser,
  getBalance,
  getRoastResult,
  trySpendCredits,
  saveRoastResult,
  markRoastFailed,
} from "@/server/ledger";
import { verifyChallenge } from "@/server/wallet-auth";
import { ROAST_COST_CREDITS } from "@/server/credit-config";
import { fetchXProfile, normalizeHandle } from "@/server/x-profile";
import {
  submitRoastToJury,
  ProfileNotFoundError,
  juryConfigured,
} from "@/server/genlayer-service";
import { randomUUID } from "node:crypto";

/**
 * Roast submission (blueprint §27/§53): validates, reserves credits,
 * KICKS OFF the jury run in the background and returns the roast id
 * immediately. The client polls GET /api/roast/status?id=... — jury
 * runs take 5-15 minutes, far beyond serverless HTTP limits, so the
 * result is NEVER delivered through this request.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    profile?: string;
    walletAddress?: string;
    authMessage?: string;
    authSignature?: string;
  } | null;

  if (!body?.profile || !body.walletAddress || !body.authMessage || !body.authSignature) {
    return NextResponse.json(
      { error: "profile, walletAddress, authMessage and authSignature are required." },
      { status: 400 },
    );
  }

  const verified = await verifyChallenge({
    walletAddress: body.walletAddress,
    message: body.authMessage,
    signature: body.authSignature,
  });
  if (!verified) {
    return NextResponse.json({ error: "Signature verification failed." }, { status: 401 });
  }

  const handle = normalizeHandle(body.profile);
  if (!handle) {
    return NextResponse.json(
      { error: "We couldn't recognize that profile." },
      { status: 400 },
    );
  }

  // Fail fast on missing profile — costs nothing.
  const profile = await fetchXProfile(handle);
  if (profile.status === "not_found") {
    return NextResponse.json(
      { error: "We couldn't find that X profile.", code: "not_found" },
      { status: 404 },
    );
  }
  if (!profile.found) {
    return NextResponse.json(
      {
        error: "X isn't giving us enough public data right now. Try again later.",
        code: "unavailable",
      },
      { status: 503 },
    );
  }

  if (!juryConfigured()) {
    return NextResponse.json(
      {
        error:
          "The jury hasn't been deployed yet. Roasting will unlock once the GenLayer contract goes live.",
        code: "jury_not_configured",
      },
      { status: 503 },
    );
  }

  // Atomic, idempotent credit reservation.
  const user = await getOrCreateUser(body.walletAddress);
  const roastRequestId = randomUUID();
  const spend = await trySpendCredits({
    userId: user.id,
    amount: ROAST_COST_CREDITS,
    reference: `roast:${roastRequestId}`,
    metadata: { profile: handle },
  });

  if (!spend.ok) {
    if (spend.reason === "duplicate") {
      return NextResponse.json(
        { error: "This roast request was already submitted." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        error: `You need ${ROAST_COST_CREDITS} credits to roast this profile.`,
        code: "insufficient_credits",
        balance: await getBalance(user.id),
      },
      { status: 402 },
    );
  }

  // Fire-and-track: the jury runs in the background; the client polls
  // /api/roast/status. Errors here are recorded against the roast id.
  void submitRoastToJury(handle)
    .then((result) => {
      void saveRoastResult({
        userId: user.id,
        profile: handle,
        cost: ROAST_COST_CREDITS,
        requestId: roastRequestId,
        result,
      });
    })
    .catch(async (error) => {
      if (error instanceof ProfileNotFoundError) {
        await markRoastFailed(roastRequestId, false).catch(() => {});
        return;
      }
      // Refund the reserved credits and record the failed attempt.
      const { recordTransaction } = await import("@/server/ledger");
      await recordTransaction({
        userId: user.id,
        type: "refund",
        amount: ROAST_COST_CREDITS,
        reference: `refund:${roastRequestId}`,
        metadata: { profile: handle, reason: "jury_execution_failed" },
      }).catch(() => {});
      await markRoastFailed(roastRequestId, true).catch(() => {});
    });

  return NextResponse.json({
    roastId: roastRequestId,
    profile: handle,
    balance: spend.balance,
    pollAfterSeconds: 15,
  });
}
