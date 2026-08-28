import { NextResponse } from "next/server";
import { getOrCreateUser, getBalance } from "@/server/ledger";
import { ROAST_COST_CREDITS } from "@/server/credit-config";
import { sessionUserFromRequest } from "@/server/session";

export async function GET(request: Request) {
  const user = await sessionUserFromRequest(request);
  if (!user) {
    return NextResponse.json(
      { authenticated: false, balance: 0, roastCost: ROAST_COST_CREDITS },
    );
  }

  const balance = await getBalance(user.id);
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
