import { after, NextResponse } from "next/server";
import {
  createUserSession,
  getOrCreateUser,
  getBalance,
  reserveRoast,
} from "@/server/ledger";
import { verifyChallenge } from "@/server/wallet-auth";
import { ROAST_COST_CREDITS } from "@/server/credit-config";
import { fetchXProfile, normalizeHandle } from "@/server/x-profile";
import { juryConfigured } from "@/server/genlayer-service";
import { processRoastJob } from "@/server/roast-worker";
import { randomBytes, randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

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

  // Atomically reserve credits AND persist a durable processing job before
  // handing anything to asynchronous execution.
  const user = await getOrCreateUser(body.walletAddress);
  const roastRequestId = randomUUID();
  const spend = await reserveRoast({
    userId: user.id,
    amount: ROAST_COST_CREDITS,
    requestId: roastRequestId,
    profile: handle,
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

  // The initial submit is bounded. Later status polls and the scheduled
  // recovery route advance the same persisted job, so a function shutdown
  // cannot strand a refunded failure as permanently pending.
  after(() => processRoastJob(roastRequestId));

  const sessionToken = randomBytes(24).toString("hex");
  await createUserSession({
    userId: user.id,
    token: sessionToken,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  const response = NextResponse.json({
    roastId: roastRequestId,
    profile: handle,
    balance: spend.balance,
    pollAfterSeconds: 15,
  });
  response.cookies.set("roast_session", sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
