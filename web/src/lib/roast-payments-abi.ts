import { decodeFunctionData, encodeFunctionData, type Hex } from "viem";

export const roastPaymentsAbi = [
  {
    type: "function",
    name: "buy_credits",
    stateMutability: "payable",
    inputs: [{ name: "purchase_id", type: "string" }],
    outputs: [],
  },
] as const;

export function encodeBuyCreditsCalldata(purchaseId: string): Hex {
  return encodeFunctionData({
    abi: roastPaymentsAbi,
    functionName: "buy_credits",
    args: [purchaseId],
  });
}

export function isCanonicalBuyCreditsCalldata(data: string, purchaseId: string): boolean {
  if (!/^0x[0-9a-fA-F]*$/.test(data)) return false;
  try {
    const decoded = decodeFunctionData({
      abi: roastPaymentsAbi,
      data: data as Hex,
    });
    return (
      decoded.functionName === "buy_credits" &&
      decoded.args?.[0] === purchaseId &&
      data.toLowerCase() === encodeBuyCreditsCalldata(purchaseId).toLowerCase()
    );
  } catch {
    return false;
  }
}
