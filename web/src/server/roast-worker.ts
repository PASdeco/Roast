import "server-only";

import {
  claimRoastSubmission,
  getRoastJob,
  recordRoastSubmission,
  refundRoast,
  releaseRoastSubmission,
  saveRoastResult,
} from "@/server/ledger";
import {
  getJuryTransaction,
  readRoastFromJury,
  submitRoastTransaction,
} from "@/server/genlayer-service";
import {
  juryResultMayBeReadable,
  juryTransactionFailed,
} from "@/server/jury-transaction-status";

/**
 * Advances a persisted roast job by at most one bounded unit of work. It is
 * deliberately safe to call from `after`, a status poll, or a cron recovery.
 */
export async function processRoastJob(requestId: string): Promise<void> {
  const current = await getRoastJob(requestId);
  if (!current || current.status !== "processing") return;

  if (current.deadline_at && new Date(current.deadline_at).getTime() <= Date.now()) {
    if (current.execution_state === "submitting") {
      try {
        const result = await readRoastFromJury(current.profile);
        await saveRoastResult({ requestId, result });
        return;
      } catch {
        // A submission with no returned hash is intentionally never resent.
        // At the deadline, absence of a stored result is a refundable failure.
      }
    }
    await refundRoast(requestId, "Jury execution exceeded the 30 minute processing deadline.");
    return;
  }

  if (current.execution_state === "queued") {
    const claimed = await claimRoastSubmission(requestId);
    if (!claimed) return;
    try {
      const txHash = await submitRoastTransaction(claimed.profile);
      await recordRoastSubmission(requestId, txHash);
    } catch (error) {
      await releaseRoastSubmission(
        requestId,
        error instanceof Error ? error.message : "Could not submit jury transaction.",
      );
    }
    return;
  }

  if (current.execution_state === "submitting") {
    try {
      const result = await readRoastFromJury(current.profile);
      await saveRoastResult({ requestId, result });
    } catch {
      // The chain may still be accepting the request; wait for another poll or
      // the persisted deadline instead of risking a duplicate submission.
    }
    return;
  }

  if (current.execution_state !== "submitted" || !current.chain_tx_hash) return;

  try {
    const tx = await getJuryTransaction(current.chain_tx_hash);
    if (juryTransactionFailed(tx)) {
      await refundRoast(
        requestId,
        `Jury transaction ended with ${tx.status || tx.consensusResult || tx.executionResult}.`,
      );
      return;
    }
    if (!juryResultMayBeReadable(tx)) return;

    try {
      const result = await readRoastFromJury(current.profile);
      await saveRoastResult({ requestId, result });
    } catch {
      // The receipt can become visible just before the read replica has the
      // stored result. Leave the durable job active for a later poll/retry.
    }
  } catch {
    // RPC outages are transient. The persisted deadline is the hard failure
    // boundary, so a temporary read error must not create a false refund.
  }
}
