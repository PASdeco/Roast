import "server-only";

import {
  claimRoastSubmission,
  getRoastJob,
  recordRoastSubmission,
  refundRoast,
  releaseRoastSubmission,
  resetRoastForRetry,
  saveRoastResult,
} from "@/server/ledger";
import {
  getJuryTransaction,
  juryHasRoast,
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
    // If the handle is already roasted on-chain (e.g. a previous probe or a
    // concurrent request succeeded), don't fire a duplicate transaction that
    // will inevitably revert with "already roasted" and burn a second tx.
    // Just read the stored result and complete.
    try {
      if (await juryHasRoast(claimed.profile)) {
        const result = await readRoastFromJury(claimed.profile);
        await saveRoastResult({ requestId, result });
        return;
      }
    } catch {
      // has_roast/read failures are transient — fall through to normal submit.
    }
    try {
      const txHash = await submitRoastTransaction(claimed.profile);
      await recordRoastSubmission(requestId, txHash);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // "already roasted" is not a failure — the result exists, so deliver it.
      if (/already roasted/i.test(msg)) {
        try {
          const result = await readRoastFromJury(claimed.profile);
          await saveRoastResult({ requestId, result });
          return;
        } catch {}
      }
      await releaseRoastSubmission(requestId, msg);
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

  // Fast-path duplicate guard: if the roast is already stored on-chain (e.g.
  // a concurrent request for the same handle won the race), deliver it
  // immediately without waiting for this tx to finalize. This prevents the
  // second concurrent tx — which will inevitably revert as "already roasted"
  // — from being misclassified as a refundable failure.
  try {
    if (await juryHasRoast(current.profile)) {
      const result = await readRoastFromJury(current.profile);
      if (result && typeof (result as { username?: string }).username === "string") {
        await saveRoastResult({ requestId, result });
        return;
      }
    }
  } catch {
    // has_roast/read transient — fall through to normal tx polling.
  }

  try {
    const tx = await getJuryTransaction(current.chain_tx_hash);
    // Never treat intermediate consensus states as failures — they just mean
    // the validators haven't finished. Early refunds on PENDING/PROPOSING were
    // the exact cause of the "double transaction + adjourned" you saw:
    // we retried while the first tx was still PENDING, which produced a
    // duplicate "already roasted" second tx and then refunded the job even
    // though the first tx later FINALIZED successfully.
    const statusUpper = (tx.status || "").toString().toUpperCase();
    const isIntermediate =
      statusUpper === "PENDING" ||
      statusUpper === "PROPOSING" ||
      statusUpper === "COMMITTING" ||
      statusUpper === "ACCEPTED" ||
      statusUpper === "5" ||
      statusUpper === "6";
    if (isIntermediate && !juryTransactionFailed(tx)) {
      return; // still deliberating — keep polling, don't retry or refund
    }
    if (juryTransactionFailed(tx)) {
      // Duplicate roast is not a failure — the result already lives on-chain.
      // Try to read the stored roast (e.g. "already roasted" revert) before
      // refunding, so a second request for the same handle still delivers.
      try {
        const result = await readRoastFromJury(current.profile);
        if (result && typeof (result as { username?: string }).username === "string") {
          await saveRoastResult({ requestId, result });
          return;
        }
      } catch {
        // No stored roast yet — fall through to refund logic.
      }
      // Transient LLM / moderation hiccups deserve one retry before we give up.
      // Studionet LLMs are nondeterministic; a single bad sample shouldn't
      // burn the user's credits when a second try often converges.
      const reason = `${tx.status || ""} ${tx.consensusResult || ""} ${tx.executionResult || ""}`.toUpperCase();
      const transient = /LLM_ERROR|UNDETERMINED|CANCELED|NO_MAJORITY|MAJORITY_DISAGREE|TIMEOUT|DISAGREE/.test(reason);
      if (transient && current.attempts < 2) {
        // Directly reset to queued for a clean retry; releaseRoastSubmission
        // would leave it in 'submitting' which blocks re-claim.
        await resetRoastForRetry(requestId);
        return;
      }
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
