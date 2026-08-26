import "server-only";

/**
 * Credit ledger (blueprint §28) — PostgreSQL edition for Vercel.
 *
 * Every balance change is an auditable credit_transactions row; the
 * balance is derived (SUM), never overwritten. Idempotency is enforced
 * by UNIQUE constraints on reference columns, and spends are atomic via
 * transaction-level balance checks.
 *
 * Connection: DATABASE_URL (Neon/Postgres) is required in production.
 * Falls back to an error at query time if unset — routes report honest
 * "storage not configured" failures rather than silently losing data.
 */
import { Pool, type PoolClient } from "pg";

let pool: Pool | null = null;
let schemaReady = false;

function getPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured (storage backend missing).");
  }
  pool = new Pool({
    connectionString,
    ssl:
      connectionString.includes("localhost") || connectionString.includes("127.0.0.1")
        ? false
        : { rejectUnauthorized: false },
    max: 5,
  });
  return pool;
}

async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  const client = getPool();
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      wallet_address TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS'))
    );
    CREATE TABLE IF NOT EXISTS credit_transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL CHECK (type IN ('purchase','spend','refund')),
      amount INTEGER NOT NULL,
      reference TEXT NOT NULL UNIQUE,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS'))
    );
    CREATE TABLE IF NOT EXISTS purchases (
      tx_hash TEXT PRIMARY KEY,
      purchase_id TEXT NOT NULL UNIQUE,
      wallet_address TEXT NOT NULL,
      amount_wei TEXT NOT NULL,
      credits INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','credited','rejected')),
      reject_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')),
      credited_at TEXT
    );
    CREATE TABLE IF NOT EXISTS roasts (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      profile TEXT NOT NULL,
      cost INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'processing'
        CHECK (status IN ('processing','completed','failed','refunded')),
      thesis TEXT,
      result_json TEXT,
      roast_request_id TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')),
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tx_user ON credit_transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_roasts_user ON roasts(user_id);
  `);
  schemaReady = true;
}

/** Runs a callback with a client, ensuring schema exists first. */
async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = getPool();
  const c = await client.connect();
  try {
    await ensureSchema();
    return await fn(c);
  } finally {
    c.release();
  }
}

export interface LedgerUser {
  id: number;
  wallet_address: string;
}

export async function getOrCreateUser(walletAddress: string): Promise<LedgerUser> {
  const normalized = walletAddress.toLowerCase();
  return withClient(async (db) => {
    const existing = await db.query(
      "SELECT id, wallet_address FROM users WHERE wallet_address = $1",
      [normalized],
    );
    if (existing.rows.length > 0) return existing.rows[0] as LedgerUser;
    const inserted = await db.query(
      "INSERT INTO users (wallet_address) VALUES ($1) RETURNING id, wallet_address",
      [normalized],
    );
    return inserted.rows[0] as LedgerUser;
  });
}

export async function getBalance(userId: number): Promise<number> {
  return withClient(async (db) => {
    const row = await db.query(
      "SELECT COALESCE(SUM(amount), 0) AS balance FROM credit_transactions WHERE user_id = $1",
      [userId],
    );
    return Number(row.rows[0].balance);
  });
}

/**
 * Atomically append a credit transaction. UNIQUE(reference) is the
 * idempotency guard. Returns false if the reference was already used.
 */
export async function recordTransaction(params: {
  userId: number;
  type: "purchase" | "spend" | "refund";
  amount: number;
  reference: string;
  metadata?: Record<string, unknown>;
}): Promise<boolean> {
  return withClient(async (db) => {
    try {
      await db.query(
        `INSERT INTO credit_transactions (user_id, type, amount, reference, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          params.userId,
          params.type,
          params.amount,
          params.reference,
          JSON.stringify(params.metadata ?? {}),
        ],
      );
      return true;
    } catch (error) {
      if (error instanceof Error && error.message.includes("duplicate key")) {
        return false;
      }
      throw error;
    }
  });
}

/**
 * Atomic spend: balance check + insert in ONE SQL transaction with a
 * row-level guard, so concurrent requests can never double-spend.
 */
export async function trySpendCredits(params: {
  userId: number;
  amount: number;
  reference: string;
  metadata?: Record<string, unknown>;
}): Promise<{ ok: true; balance: number } | { ok: false; reason: "insufficient" | "duplicate" }> {
  return withClient(async (db) => {
    try {
      await db.query("BEGIN");
      // Lock the USER row (not the aggregate) to serialize concurrent
      // spends by the same wallet. Postgres forbids FOR UPDATE on
      // aggregates; row-locking the user achieves the same guard.
      await db.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [
        params.userId,
      ]);
      const balRow = await db.query(
        "SELECT COALESCE(SUM(amount), 0) AS balance FROM credit_transactions WHERE user_id = $1",
        [params.userId],
      );
      const balance = Number(balRow.rows[0].balance);
      if (balance < params.amount) {
        await db.query("ROLLBACK");
        return { ok: false, reason: "insufficient" as const };
      }
      try {
        await db.query(
          `INSERT INTO credit_transactions (user_id, type, amount, reference, metadata)
           VALUES ($1, 'spend', $2, $3, $4)`,
          [
            params.userId,
            -params.amount,
            params.reference,
            JSON.stringify(params.metadata ?? {}),
          ],
        );
      } catch (error) {
        await db.query("ROLLBACK");
        if (error instanceof Error && error.message.includes("duplicate key")) {
          return { ok: false, reason: "duplicate" as const };
        }
        throw error;
      }
      const after = await db.query(
        "SELECT COALESCE(SUM(amount), 0) AS balance FROM credit_transactions WHERE user_id = $1",
        [params.userId],
      );
      await db.query("COMMIT");
      return { ok: true, balance: Number(after.rows[0].balance) };
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      throw error;
    }
  });
}

export async function recordPurchaseAttempt(params: {
  txHash: string;
  purchaseId: string;
  walletAddress: string;
  amountWei: string;
  credits: number;
}): Promise<void> {
  await withClient(async (db) => {
    await db.query(
      `INSERT INTO purchases (tx_hash, purchase_id, wallet_address, amount_wei, credits)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (tx_hash) DO NOTHING`,
      [
        params.txHash,
        params.purchaseId,
        params.walletAddress.toLowerCase(),
        params.amountWei,
        params.credits,
      ],
    );
  });
}

export async function markPurchaseCredited(txHash: string): Promise<void> {
  await withClient(async (db) => {
    await db.query(
      "UPDATE purchases SET status = 'credited', credited_at = to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') WHERE tx_hash = $1",
      [txHash],
    );
  });
}

export async function markPurchaseRejected(txHash: string, reason: string): Promise<void> {
  await withClient(async (db) => {
    await db.query(
      "UPDATE purchases SET status = 'rejected', reject_reason = $2 WHERE tx_hash = $1",
      [txHash, reason],
    );
  });
}

export async function getPurchase(txHash: string):
  Promise<{
    tx_hash: string;
    purchase_id: string;
    wallet_address: string;
    amount_wei: string;
    credits: number;
    status: string;
  } | undefined> {
  return withClient(async (db) => {
    const row = await db.query("SELECT * FROM purchases WHERE tx_hash = $1", [txHash]);
    return row.rows[0] ?? undefined;
  });
}

// ----------------------------------------------------------------------
// Roast history (blueprint §30)
// ----------------------------------------------------------------------

export interface StoredRoast {
  id: string;
  profile: string;
  status: "processing" | "completed" | "failed" | "refunded";
  thesis: string | null;
  created_at: string;
  result_json: string | null;
}

export async function saveRoastResult(params: {
  userId: number;
  profile: string;
  cost: number;
  requestId: string;
  result: unknown;
}): Promise<void> {
  const result = params.result as { thesis?: string } | null;
  await withClient(async (db) => {
    await db.query(
      `INSERT INTO roasts (id, user_id, profile, cost, status, thesis, result_json, roast_request_id, completed_at)
       VALUES ($1, $2, $3, $4, 'completed', $5, $6, $7, to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS'))
       ON CONFLICT (id) DO NOTHING`,
      [
        params.requestId,
        params.userId,
        params.profile,
        params.cost,
        result && typeof result.thesis === "string" ? result.thesis : null,
        JSON.stringify(params.result),
        params.requestId,
      ],
    );
  });
}

export async function markRoastFailed(requestId: string, refunded: boolean): Promise<void> {
  await withClient(async (db) => {
    await db.query(
      `INSERT INTO roasts (id, user_id, profile, cost, status, roast_request_id)
       SELECT $1, user_id, profile, cost, $2, roast_request_id FROM roasts WHERE roast_request_id = $3
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`,
      [requestId, refunded ? "refunded" : "failed", requestId],
    );
  });
}

export async function listUserRoasts(userId: number, limit = 50): Promise<StoredRoast[]> {
  return withClient(async (db) => {
    const rows = await db.query(
      `SELECT id, profile, status, thesis, created_at, result_json
       FROM roasts WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, limit],
    );
    return rows.rows as StoredRoast[];
  });
}

export async function getRoastResult(userId: number, roastId: string):
  Promise<{ profile: string; result: unknown; created_at: string } | undefined> {
  return withClient(async (db) => {
    const row = await db.query(
      "SELECT profile, result_json, created_at FROM roasts WHERE user_id = $1 AND id = $2 AND status = 'completed'",
      [userId, roastId],
    );
    const r = row.rows[0];
    if (!r) return undefined;
    return { profile: r.profile, result: JSON.parse(r.result_json), created_at: r.created_at };
  });
}
