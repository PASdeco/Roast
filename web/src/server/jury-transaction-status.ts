export interface JuryTransactionStatus {
  status: string;
  consensusResult: string;
  executionResult: string;
}

const TERMINAL_FAILURE_STATUSES = new Set([
  "UNDETERMINED",
  "CANCELED",
  "VALIDATORS_TIMEOUT",
  "LEADER_TIMEOUT",
]);

const TERMINAL_FAILURE_RESULTS = new Set([
  "DISAGREE",
  "TIMEOUT",
  "DETERMINISTIC_VIOLATION",
  "NO_MAJORITY",
  "MAJORITY_DISAGREE",
]);

function normalized(value: string): string {
  return value.toUpperCase();
}

export function juryTransactionFailed(tx: JuryTransactionStatus): boolean {
  return (
    TERMINAL_FAILURE_STATUSES.has(normalized(tx.status)) ||
    TERMINAL_FAILURE_RESULTS.has(normalized(tx.consensusResult)) ||
    normalized(tx.executionResult) === "FINISHED_WITH_ERROR"
  );
}

/**
 * Studio's lookup response can omit `txExecutionResultName` for finalized
 * transactions. MAJORITY_AGREE means the stored contract state is safe to
 * attempt reading; an absent result still leaves the job pending.
 */
export function juryResultMayBeReadable(tx: JuryTransactionStatus): boolean {
  return (
    normalized(tx.executionResult) === "FINISHED_WITH_RETURN" ||
    (normalized(tx.status) === "FINALIZED" &&
      normalized(tx.consensusResult) === "MAJORITY_AGREE")
  );
}
