/**
 * Deploys RoastPayments and RoastJury to the configured GenLayer network
 * using the backend wallet from .env. Sequential on purpose: each deploy
 * waits for its receipt before the next starts (testnet nonce discipline).
 *
 * Run: node scripts/deploy-contracts.mjs
 */
import { readFileSync as _rf } from "node:fs";
try {
  for (const line of _rf("../.env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch {}
import { readFileSync } from "node:fs";
import { createAccount, createClient } from "genlayer-js";
import {
  localnet,
  studionet,
  testnetAsimov,
  testnetBradbury,
} from "genlayer-js/chains";

const chainMap = { localnet, studionet, testnetAsimov, testnetBradbury };

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

const chainName = process.env.GENLAYER_NETWORK || "studionet";
const chain = chainMap[chainName] ?? studionet;
const account = createAccount(requireEnv("BACKEND_PRIVATE_KEY"));

const client = createClient({ chain, account });

console.log(`network: ${chainName}`);
console.log(`deployer: ${account.address}`);

async function deploy(name, filePath) {
  const code = readFileSync(filePath, "utf8");
  console.log(`\ndeploying ${name}…`);
  const txHash = await client.deployContract({ code });
  console.log(`${name} tx: ${txHash}`);
  const receipt = await client.waitForTransactionReceipt({ hash: txHash });
  const resultName = receipt?.txExecutionResultName;
  console.log(`${name} result: ${resultName}`);
  if (resultName === "FINISHED_WITH_ERROR") {
    console.error("revert:", receipt?.revert_reason);
    throw new Error(`${name} construction failed`);
  }
  // Contract address: derive from the receipt's contract_address field if
  // present, else from the deploy receipt data.
  const address =
    receipt?.contract_address ??
    receipt?.data?.contract_address ??
    receipt?.receipt?.contract_address;
  if (!address) {
    console.error("receipt keys:", Object.keys(receipt ?? {}));
    console.error("receipt:", JSON.stringify(receipt, (k, v) => typeof v === "bigint" ? String(v) : v, 2).slice(0, 2500));
    throw new Error(`${name}: could not extract contract address from receipt`);
  }
  return { address, receipt };
}

const payments = await deploy("RoastPayments", "../contracts/roast_payments.py");
const jury = await deploy("RoastJury", "../contracts/roast_jury.py");

console.log("\n=== ADD THESE TO .env ===");
console.log(`ROAST_PAYMENTS_CONTRACT_ADDRESS=${payments.address}`);
console.log(`ROAST_JURY_CONTRACT_ADDRESS=${jury.address}`);
