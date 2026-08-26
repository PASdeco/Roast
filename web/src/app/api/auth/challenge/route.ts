import { NextResponse } from "next/server";
import { createChallenge } from "@/server/wallet-auth";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    walletAddress?: string;
  } | null;

  if (!body?.walletAddress || !/^0x[0-9a-fA-F]{40}$/.test(body.walletAddress)) {
    return NextResponse.json({ error: "Valid wallet address required." }, { status: 400 });
  }

  const message = createChallenge(body.walletAddress);
  return NextResponse.json({ message });
}
