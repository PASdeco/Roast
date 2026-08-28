import assert from "node:assert/strict";
import test from "node:test";
import {
  juryResultMayBeReadable,
  juryTransactionFailed,
} from "../src/server/jury-transaction-status.ts";

test("finalized majority agreement is readable when Studio omits execution metadata", () => {
  const tx = {
    status: "FINALIZED",
    consensusResult: "MAJORITY_AGREE",
    executionResult: "",
  };

  assert.equal(juryTransactionFailed(tx), false);
  assert.equal(juryResultMayBeReadable(tx), true);
});

test("execution and consensus failures remain refundable", () => {
  assert.equal(
    juryTransactionFailed({
      status: "FINALIZED",
      consensusResult: "MAJORITY_AGREE",
      executionResult: "FINISHED_WITH_ERROR",
    }),
    true,
  );
  assert.equal(
    juryTransactionFailed({
      status: "FINALIZED",
      consensusResult: "NO_MAJORITY",
      executionResult: "",
    }),
    true,
  );
});
