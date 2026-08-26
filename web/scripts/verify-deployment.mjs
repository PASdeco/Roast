/**
 * Post-deployment verification: reads live state from both contracts to
 * prove construction succeeded and the contracts are functional.
 * Read-only — spends nothing.
 *
 * Run: node scripts/verify-deployment.mjs
 */
import { readFileSync } from "node:fs";
import { createAccount, createClient } from "genlayer-js";
import { localnet, studionet, testnetAsimov, testnetBradbury } from "genlayer-js/chains";

const chainMap = { localnet, studionet, testnetAsimov, testnetBradbury };
for (const line of readFileSync("../.env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const chainName = process.env.GENLAYER_NETWORK || "studionet";
const chain = chainMap[chainName] ?? studionet;
const account = createAccount(process.env.BACKEND_PRIVATE_KEY);
const client = createClient({ chain, account });

const PAYMENTS = process.env.ROAST_PAYMENTS_CONTRACT_ADDRESS;
const JURY = process.env.ROAST_JURY_CONTRACT_ADDRESS;

console.log(`network: ${chainName}\n`);

async function read(contract, functionName, args = []) {
  return client.readContract({ address: contract, functionName, args });
}

console.log("== RoastPayments ==");
console.log("owner:", await read(PAYMENTS, "get_owner"));
console.log("total_raised:", String(await read(PAYMENTS, "get_total_raised")));
console.log("purchase_count:", String(await read(PAYMENTS, "get_purchase_count")));
const unknownPurchase = await read(PAYMENTS, "get_purchase", ["verify-probe-001"]);
console.log("get_purchase(unknown).found:", unknownPurchase?.found ?? unknownPurchase);
const hasUnknown = await read(PAYMENTS, "has_purchase", ["verify-probe-001"]);
console.log("has_purchase(unknown):", hasUnknown);

console.log("\n== RoastJury ==");
console.log("roast_count:", String(await read(JURY, "get_roast_count")));
console.log("last_username:", JSON.stringify(await read(JURY, "get_last_username")));
const hasRoast = await read(JURY, "has_roast", ["nobody_probes_this"]);
console.log("has_roast(probe):", hasRoast);

console.log("\nBoth contracts are live and responding.");
