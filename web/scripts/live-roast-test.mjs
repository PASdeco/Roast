/**
 * End-to-end live test: submit a real roast through the DEPLOYED
 * RoastJury contract using the backend wallet. This is the real thing:
 * validators fetch the X profile, run the five judges, deliberate, and
 * reach consensus on-chain.
 *
 * Run: node scripts/live-roast-test.mjs <handle>
 */
import { readFileSync } from "node:fs";
import { createAccount, createClient } from "genlayer-js";
import { localnet, studionet, testnetAsimov, testnetBradbury } from "genlayer-js/chains";

const chainMap = { localnet, studionet, testnetAsimov, testnetBradbury };
for (const line of readFileSync("../.env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const handle = process.argv[2] || "XDevelopers";
const chainName = process.env.GENLAYER_NETWORK || "studionet";
const chain = chainMap[chainName] ?? studionet;
const account = createAccount(process.env.BACKEND_PRIVATE_KEY);
const client = createClient({ chain, account });

console.log(`network: ${chainName}`);
console.log(`submitting roast for @${handle} …`);

const txHash = await client.writeContract({
  address: process.env.ROAST_JURY_CONTRACT_ADDRESS,
  functionName: "submit_roast",
  args: [handle],
  value: 0n,
});
console.log("tx:", txHash);

const receipt = await client.waitForTransactionReceipt({
  hash: txHash,
  status: "ACCEPTED",
  interval: 3000,
  retries: 300,
});
console.log("execution:", receipt?.txExecutionResultName);
if (receipt?.txExecutionResultName === "FINISHED_WITH_ERROR") {
  console.error("revert:", receipt?.revert_reason);
  process.exit(1);
}

// Give finalization a beat, then read the stored result back.
await new Promise((r) => setTimeout(r, 8000));
const result = await client.readContract({
  address: process.env.ROAST_JURY_CONTRACT_ADDRESS,
  functionName: "get_roast",
  args: [handle],
});

console.log("\n=== LIVE JURY VERDICT ===");
console.log(JSON.stringify(result, (k, v) => (typeof v === "bigint" ? String(v) : v), 2).slice(0, 4000));
