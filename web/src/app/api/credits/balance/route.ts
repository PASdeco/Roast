import { NextResponse } from "next/server";
import { getOrCreateUser, getBalance } from "@/server/ledger";
import { ROAST_COST_CREDITS } from "@/server/credit-config";

function userIdFromCookie(request: Request): number | null {
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("roast_session="));
  if (!cookie) return null;
  const raw = cookie.split("=")[1] || "";
  const id = Number.parseInt(raw.split(":")[0], 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(request: Request) {
  const userId = userIdFromCookie(request);
  if (!userId) {
    return NextResponse.json(
      { authenticated: false, balance: 0, roastCost: ROAST_COST_CREDITS },
    );
  }

  const balance = await getBalance(userId);
  return NextResponse.json({
    authenticated: true,
    balance,
    roastCost: ROAST_COST_CREDITS,
  });
}

export async function POST(request: Request) {
  // Balance lookup by freshly verified wallet (used right after login).
  const body = (await request.json().catch(() => null)) as {
    walletAddress?: string;
  } | null;
  if (!body?.walletAddress) {
    return NextResponse.json({ error: "walletAddress required." }, { status: 400 });
  }
  const user = await getOrCreateUser(body.walletAddress);
  return NextResponse.json({ balance: await getBalance(user.id) });
}
