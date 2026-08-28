import { NextResponse } from "next/server";
import { listActiveRoastJobIds } from "@/server/ledger";
import { processRoastJob } from "@/server/roast-worker";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const ids = await listActiveRoastJobIds(20);
  await Promise.all(ids.map((id) => processRoastJob(id)));
  return NextResponse.json({ processed: ids.length });
}
