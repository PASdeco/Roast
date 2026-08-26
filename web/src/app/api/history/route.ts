import { NextResponse } from "next/server";
import {
  getOrCreateUser,
  getRoastResult,
  listUserRoasts,
} from "@/server/ledger";
import { verifyChallenge } from "@/server/wallet-auth";

function sessionUserId(request: Request): number | null {
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("roast_session="));
  if (!cookie) return null;
  const id = Number.parseInt((cookie.split("=")[1] || "").split(":")[0], 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** History list (blueprint §30): the user's own roasts, newest first. */
export async function GET(request: Request) {
  const userId = sessionUserId(request);
  const url = new URL(request.url);
  const walletAddress = url.searchParams.get("wallet");
  const message = url.searchParams.get("message");
  const signature = url.searchParams.get("signature");

  // Prefer an authenticated session; fall back to signed proof.
  let resolved = userId;
  if (!resolved && walletAddress && message && signature) {
    const verified = await verifyChallenge({
      walletAddress,
      message,
      signature,
    });
    if (verified) {
      const user = await getOrCreateUser(walletAddress);
      resolved = user.id;
    }
  }

  if (!resolved) {
    return NextResponse.json({ authenticated: false, roasts: [] });
  }

  const stored = await listUserRoasts(resolved);
  const roasts = stored.map((roast) => ({
    id: roast.id,
    profile: roast.profile,
    status: roast.status,
    thesis: roast.thesis,
    createdAt: roast.created_at,
  }));

  return NextResponse.json({ authenticated: true, roasts });
}

/** Full stored result for one roast — viewing never costs credits. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    roastId?: string;
    walletAddress?: string;
    authMessage?: string;
    authSignature?: string;
  } | null;

  if (!body?.roastId || !body.walletAddress || !body.authMessage || !body.authSignature) {
    return NextResponse.json({ error: "roastId, walletAddress, authMessage and authSignature are required." }, { status: 400 });
  }

  const verified = await verifyChallenge({
    walletAddress: body.walletAddress,
    message: body.authMessage,
    signature: body.authSignature,
  });
  if (!verified) {
    return NextResponse.json({ error: "Signature verification failed." }, { status: 401 });
  }

  const user = await getOrCreateUser(body.walletAddress);
  const record = await getRoastResult(user.id, body.roastId);
  if (!record) {
    return NextResponse.json({ error: "Roast not found." }, { status: 404 });
  }

  return NextResponse.json({
    profile: record.profile,
    roast: record.result,
    createdAt: record.created_at,
  });
}
