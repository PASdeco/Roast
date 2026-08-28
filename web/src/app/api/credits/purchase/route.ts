import { NextResponse } from "next/server";
import {
  creditVerifiedPurchase,
} from "@/server/ledger";
import { verifyPurchaseTransaction } from "@/server/payment-verification";
import { findPackage } from "@/server/credit-config";
import { readPurchaseFromPayments } from "@/server/genlayer-service";
import { sessionUserFromRequest } from "@/server/session";

/**
 * Purchase verification endpoint (blueprint §9/§26/§32).
 * The frontend submits { txHash, purchaseId, packageId } under an existing
 * authenticated session. The server binds the grant to both the finalized
 * transaction and the contract's own purchase record.
 * Server verifies the on-chain transaction, checks the credited amount
 * matches the package, enforces idempotency (tx hash + purchase id are
 * primary keys), and only then credits the ledger.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    txHash?: string;
    purchaseId?: string;
    packageId?: string;
  } | null;

  if (
    !body?.txHash ||
    !body.purchaseId ||
    !body.packageId
  ) {
    return NextResponse.json(
      {
        error:
          "txHash, purchaseId and packageId are required.",
      },
      { status: 400 },
    );
  }

  if (!/^[A-Za-z0-9_-]{8,64}$/.test(body.purchaseId)) {
    return NextResponse.json({ error: "Invalid purchase ID." }, { status: 400 });
  }

  // 1. Durable session authentication. Polling a pending transaction must
  // never consume a one-time wallet challenge.
  const user = await sessionUserFromRequest(request);
  if (!user) {
    return NextResponse.json(
      { error: "Sign in with your wallet before claiming a purchase." },
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

  // 3. On-chain verification — never trust the frontend.
  const verification = await verifyPurchaseTransaction({
    txHash: body.txHash,
    expectedSender: user.wallet_address,
    expectedRecipient: paymentsContract,
    purchaseId: body.purchaseId,
  });

  if (!verification.ok) {
    return NextResponse.json(
      { error: verification.reason },
      { status: 400 },
    );
  }

  // 4. The on-chain registry is the authoritative binding between this
  // transaction, the submitted purchase id, the buyer and the amount.
  let onChainPurchase;
  try {
    onChainPurchase = await readPurchaseFromPayments(body.purchaseId);
  } catch {
    return NextResponse.json(
      { error: "Could not read the on-chain purchase record yet. Try again shortly." },
      { status: 503 },
    );
  }
  let onChainAmount: bigint;
  try {
    onChainAmount = BigInt(onChainPurchase.amount_wei);
  } catch {
    return NextResponse.json({ error: "On-chain purchase amount is malformed." }, { status: 400 });
  }
  if (
    !onChainPurchase.found ||
    onChainPurchase.purchase_id !== body.purchaseId ||
    onChainPurchase.buyer.toLowerCase() !== user.wallet_address.toLowerCase() ||
    onChainAmount !== verification.amountWei
  ) {
    return NextResponse.json(
      { error: "On-chain purchase record does not match this transaction." },
      { status: 400 },
    );
  }

  // 5. A credit package has a precise on-chain price: do not silently accept
  // an overpayment for a smaller package or an underpayment for a larger one.
  if (verification.amountWei !== pkg.genWei) {
    return NextResponse.json(
      { error: "Transaction amount does not match the selected package price." },
      { status: 400 },
    );
  }

  // 6. One SQL transaction binds the transaction hash to exactly one grant.
  const credited = await creditVerifiedPurchase({
    userId: user.id,
    txHash: body.txHash,
    purchaseId: body.purchaseId,
    walletAddress: user.wallet_address,
    amountWei: verification.amountWei.toString(),
    credits: pkg.credits,
    packageId: pkg.id,
  });

  if (credited.kind === "conflict") {
    return NextResponse.json(
      {
        error: "This transaction hash or purchase ID was already used.",
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    credited: pkg.credits,
    balance: credited.balance,
    txHash: body.txHash.toLowerCase(),
    alreadyCredited: credited.kind === "already_credited",
  });
}
