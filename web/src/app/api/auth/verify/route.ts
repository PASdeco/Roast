import { NextResponse } from "next/server";
import {
  getOrCreateUser,
  getBalance,
} from "@/server/ledger";
import { verifyChallenge } from "@/server/wallet-auth";
import { randomBytes } from "node:crypto";

/**
 * Signed login: proves wallet ownership, then returns the user's credit
 * balance. Issues an opaque session token bound to the wallet (stored in
 * an httpOnly cookie). For the MVP the token is a signed nonce kept in
 * memory-persisted DB users table; production hardening in Slice 10.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    walletAddress?: string;
    message?: string;
    signature?: string;
  } | null;

  if (
    !body?.walletAddress ||
    !/^0x[0-9a-fA-F]{40}$/.test(body.walletAddress) ||
    !body.message ||
    !body.signature
  ) {
    return NextResponse.json(
      { error: "walletAddress, message and signature are required." },
      { status: 400 },
    );
  }

  const verified = await verifyChallenge({
    walletAddress: body.walletAddress,
    message: body.message,
    signature: body.signature,
  });

  if (!verified) {
    return NextResponse.json(
      { error: "Signature verification failed." },
      { status: 401 },
    );
  }

  const user = await getOrCreateUser(body.walletAddress);
  const balance = await getBalance(user.id);
  const sessionToken = randomBytes(24).toString("hex");

  const response = NextResponse.json({
    walletAddress: user.wallet_address,
    balance,
    sessionToken,
  });

  response.cookies.set("roast_session", `${user.id}:${sessionToken}`, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return response;
}
