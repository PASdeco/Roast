import { NextResponse } from "next/server";
import { getRoastResult, getBalance, getOrCreateUser } from "@/server/ledger";

/**
 * Roast status polling (blueprint §53): the client asks for the result
 * of a submitted jury run. States: pending (still on-chain), completed
 * (full verdict), failed/refunded (credits returned).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const roastId = url.searchParams.get("id") || "";
  const walletAddress = url.searchParams.get("wallet") || "";

  if (!/^[\w-]{36}$/.test(roastId) || !/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) {
    return NextResponse.json({ error: "Valid id and wallet required." }, { status: 400 });
  }

  const user = await getOrCreateUser(walletAddress);
  const record = await getRoastResult(user.id, roastId);

  if (record) {
    return NextResponse.json({
      state: "completed",
      roast: record.result,
      balance: await getBalance(user.id),
    });
  }

  // Not completed yet — check whether it failed/refunded.
  const { listUserRoasts } = await import("@/server/ledger");
  const all = await listUserRoasts(user.id, 200);
  const mine = all.find((r) => r.id === roastId);

  if (mine && (mine.status === "refunded" || mine.status === "failed")) {
    return NextResponse.json({
      state: "failed",
      refunded: mine.status === "refunded",
      error:
        "The jury couldn't reach a usable evaluation this time." +
        (mine.status === "refunded" ? " Your credits were refunded." : ""),
      balance: await getBalance(user.id),
    });
  }

  return NextResponse.json({ state: "pending" });
}
