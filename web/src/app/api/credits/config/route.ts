import { NextResponse } from "next/server";
import { CREDIT_PACKAGES } from "@/server/credit-config";

/**
 * Public purchase config: treasury address + package pricing as hex wei.
 * Only public values are exposed — never keys.
 */
export async function GET() {
  const treasury = process.env.TREASURY_WALLET_ADDRESS || "";

  const packages: Record<string, { genWei: string; credits: number }> = {};
  for (const pkg of CREDIT_PACKAGES) {
    packages[pkg.id] = {
      genWei: "0x" + pkg.genWei.toString(16),
      credits: pkg.credits,
    };
  }

  return NextResponse.json({
    treasuryAddress: treasury, // where withdrawn GEN ends up (display only)
    paymentsContractAddress: process.env.ROAST_PAYMENTS_CONTRACT_ADDRESS || "",
    packages,
  });
}
