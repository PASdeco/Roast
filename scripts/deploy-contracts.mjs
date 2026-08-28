/**
 * Deploys RoastPayments and RoastJury to the configured GenLayer network
 * using the backend wallet from .env. Sequential on purpose: each deploy
 * waits for its receipt before the next starts (testnet nonce discipline).
 *
 * Run: node scripts/deploy-contracts.mjs
 */
import { readFileSync } from "node:fs";
import { createAccount, createClient } from "genlayer-js";
import {
  localnet,
  studionet,
  testnetAsimov,
  testnetBradbury,
} from "genlayer-js/chains";

const chainMap = { localnet, studionet, testnetAsimov, testnetBradbury };

process.loadEnvFile(".env");

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
  const result = await client.waitForTransactionReceipt({
    hash: txHash,
    status: "ACCEPTED",
    interval: 3_000,
    retries: 100,
    fullTransaction: true,
  });
  const address =
    result?.contract_address ??
    result?.contractAddress ??
    result?.data?.contract_address ??
    result?.data?.contractAddress ??
    result?.address;
  const status = result?.statusName ?? result?.status;
  console.log(`${name}: tx=${txHash} address=${address} status=${status}`);
  if (!address) {
    console.error("full result:", JSON.stringify(result, null, 2).slice(0, 2000));
    throw new Error(`${name} deploy returned no address`);
  }
  return { address, result };
}

const target = process.env.DEPLOY_TARGET || "all";
if (target !== "all" && target !== "payments" && target !== "jury") {
  throw new Error("DEPLOY_TARGET must be all, payments, or jury.");
}

const payments = target === "jury" ? null : await deploy("RoastPayments", "contracts/roast_payments.py");
const jury = target === "payments" ? null : await deploy("RoastJury", "contracts/roast_jury.py");

console.log("\n=== ADD THESE TO .env ===");
if (payments) console.log(`ROAST_PAYMENTS_CONTRACT_ADDRESS=${payments.address}`);
if (jury) console.log(`ROAST_JURY_CONTRACT_ADDRESS=${jury.address}`);
