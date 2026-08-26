import { NextResponse } from "next/server";
import {
  getOrCreateUser,
  getBalance,
  recordPurchaseAttempt,
  recordTransaction,
  markPurchaseCredited,
  markPurchaseRejected,
  getPurchase,
} from "@/server/ledger";
import { verifyChallenge } from "@/server/wallet-auth";
import { verifyPurchaseTransaction } from "@/server/payment-verification";
import { findPackage } from "@/server/credit-config";

/**
 * Purchase verification endpoint (blueprint §9/§26/§32).
 * The frontend submits { txHash, purchaseId, packageId, wallet auth }.
 * Server verifies the on-chain transaction, checks the credited amount
 * matches the package, enforces idempotency (tx hash + purchase id are
 * primary keys), and only then credits the ledger.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    txHash?: string;
    purchaseId?: string;
    packageId?: string;
    walletAddress?: string;
    authMessage?: string;
    authSignature?: string;
  } | null;

  if (
    !body?.txHash ||
    !body.purchaseId ||
    !body.packageId ||
    !body.walletAddress ||
    !body.authMessage ||
    !body.authSignature
  ) {
    return NextResponse.json(
      {
        error:
          "txHash, purchaseId, packageId, walletAddress, authMessage and authSignature are required.",
      },
      { status: 400 },
    );
  }

  // 1. Wallet ownership proof.
  const verifiedWallet = await verifyChallenge({
    walletAddress: body.walletAddress,
    message: body.authMessage,
    signature: body.authSignature,
  });
  if (!verifiedWallet) {
    return NextResponse.json(
      { error: "Wallet signature verification failed." },
      { status: 401 },
    );
  }

  // 2. Package must exist.
  const pkg = findPackage(body.packageId);
  if (!pkg) {
    return NextResponse.json({ error: "Unknown credit package." }, { status: 400 });
  }

  const paymentsContract =
    process.env.ROAST_PAYMENTS_CONTRACT_ADDRESS || "";

  // 3. Record the attempt first (idempotency anchor), then verify.
  await recordPurchaseAttempt({
    txHash: body.txHash,
    purchaseId: body.purchaseId,
    walletAddress: body.walletAddress,
    amountWei: pkg.genWei.toString(),
    credits: pkg.credits,
  });

  // 4. On-chain verification — never trust the frontend.
  const verification = await verifyPurchaseTransaction({
    txHash: body.txHash,
    expectedSender: body.walletAddress,
    expectedRecipient: paymentsContract,
  });

  if (!verification.ok) {
    await markPurchaseRejected(body.txHash, verification.reason);
    return NextResponse.json(
      { error: verification.reason },
      { status: 400 },
    );
  }

  // 5. Amount must match the package price exactly (no underpayment).
  if (verification.amountWei < pkg.genWei) {
    await markPurchaseRejected(body.txHash, "Underpaid: amount below package price.");
    return NextResponse.json(
      { error: "Transaction amount is less than the package price." },
      { status: 400 },
    );
  }

  // 6. Credit the ledger — UNIQUE reference guards double-crediting.
  const user = await getOrCreateUser(body.walletAddress);
  const credited = await recordTransaction({
    userId: user.id,
    type: "purchase",
    amount: pkg.credits,
    reference: `purchase:${body.purchaseId}`,
    metadata: { txHash: body.txHash, packageId: pkg.id },
  });

  if (!credited) {
    const existing = await getPurchase(body.txHash);
    return NextResponse.json(
      {
        error:
          existing?.status === "credited"
            ? "This transaction was already credited."
            : "This purchase reference was already used.",
      },
      { status: 409 },
    );
  }

  await markPurchaseCredited(body.txHash);
  const balance = await getBalance(user.id);

  return NextResponse.json({
    credited: pkg.credits,
    balance,
    txHash: body.txHash,
  });
}
