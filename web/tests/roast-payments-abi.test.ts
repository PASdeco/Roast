import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeBuyCreditsCalldata,
  isCanonicalBuyCreditsCalldata,
} from "../src/lib/roast-payments-abi.ts";

test("buy_credits calldata is encoded and bound to its purchase id", () => {
  const purchaseId = "web-1720000000000-secureid";
  const calldata = encodeBuyCreditsCalldata(purchaseId);

  assert.match(calldata, /^0x[0-9a-f]+$/i);
  assert.equal(isCanonicalBuyCreditsCalldata(calldata, purchaseId), true);
  assert.equal(isCanonicalBuyCreditsCalldata(calldata, "web-1720000000000-otherid"), false);
});

test("non-buy_credits payloads never pass purchase verification", () => {
  const purchaseId = "web-1720000000000-secureid";
  assert.equal(isCanonicalBuyCreditsCalldata("0x", purchaseId), false);
  assert.equal(isCanonicalBuyCreditsCalldata("0xdeadbeef", purchaseId), false);
});
