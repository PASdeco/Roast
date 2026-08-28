import { NextResponse } from "next/server";
import {
  getRoastResult,
  listUserRoasts,
} from "@/server/ledger";
import { sessionUserFromRequest } from "@/server/session";

/** History list (blueprint §30): the user's own roasts, newest first. */
export async function GET(request: Request) {
  const user = await sessionUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ authenticated: false, roasts: [] });
  }

  const stored = await listUserRoasts(user.id);
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
  const body = (await request.json().catch(() => null)) as { roastId?: string } | null;

  if (!body?.roastId) {
    return NextResponse.json({ error: "roastId is required." }, { status: 400 });
  }

  const user = await sessionUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Sign in with your wallet to view history." }, { status: 401 });
  }

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
