import "server-only";
import { createHash } from "node:crypto";

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
    CREATE TABLE IF NOT EXISTS auth_challenges (
      wallet_address TEXT PRIMARY KEY,
      nonce TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
    ALTER TABLE roasts ADD COLUMN IF NOT EXISTS failure_reason TEXT;
    ALTER TABLE roasts ADD COLUMN IF NOT EXISTS execution_state TEXT NOT NULL DEFAULT 'queued';
    ALTER TABLE roasts ADD COLUMN IF NOT EXISTS chain_tx_hash TEXT;
    ALTER TABLE roasts ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE roasts ADD COLUMN IF NOT EXISTS lease_until TIMESTAMPTZ;
    ALTER TABLE roasts ADD COLUMN IF NOT EXISTS last_error TEXT;
    ALTER TABLE roasts ADD COLUMN IF NOT EXISTS submitted_at TEXT;
    ALTER TABLE roasts ADD COLUMN IF NOT EXISTS deadline_at TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS idx_tx_user ON credit_transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_roasts_user ON roasts(user_id);
    CREATE INDEX IF NOT EXISTS idx_roasts_execution ON roasts(status, execution_state, lease_until);
    CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON user_sessions(expires_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_tx_hash_lower ON purchases ((LOWER(tx_hash)));
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

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createAuthChallenge(params: {
  walletAddress: string;
  nonce: string;
  expiresAt: Date;
}): Promise<void> {
  await withClient(async (db) => {
    await db.query(
      `INSERT INTO auth_challenges (wallet_address, nonce, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (wallet_address) DO UPDATE
       SET nonce = EXCLUDED.nonce, expires_at = EXCLUDED.expires_at`,
      [params.walletAddress.toLowerCase(), params.nonce, params.expiresAt],
    );
  });
}

export async function consumeAuthChallenge(params: {
  walletAddress: string;
  nonce: string;
}): Promise<boolean> {
  return withClient(async (db) => {
    const deleted = await db.query(
      `DELETE FROM auth_challenges
       WHERE wallet_address = $1 AND nonce = $2 AND expires_at > now()`,
      [params.walletAddress.toLowerCase(), params.nonce],
    );
    return deleted.rowCount === 1;
  });
}

export async function createUserSession(params: {
  userId: number;
  token: string;
  expiresAt: Date;
}): Promise<void> {
  await withClient(async (db) => {
    await db.query(
      "INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
      [hashSessionToken(params.token), params.userId, params.expiresAt],
    );
  });
}

export async function getSessionUser(token: string): Promise<LedgerUser | undefined> {
  if (!token || token.length < 32) return undefined;
  return withClient(async (db) => {
    const result = await db.query(
      `SELECT users.id, users.wallet_address
       FROM user_sessions
       JOIN users ON users.id = user_sessions.user_id
       WHERE user_sessions.token_hash = $1 AND user_sessions.expires_at > now()`,
      [hashSessionToken(token)],
    );
    return result.rows[0] as LedgerUser | undefined;
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

export type PurchaseCreditResult =
  | { kind: "credited"; balance: number }
  | { kind: "already_credited"; balance: number }
  | { kind: "conflict" };

/**
 * Records the verified purchase and its credit grant as one transaction.
 * A finalized transaction hash can produce at most one ledger grant.
 */
export async function creditVerifiedPurchase(params: {
  userId: number;
  txHash: string;
  purchaseId: string;
  walletAddress: string;
  amountWei: string;
  credits: number;
  packageId: string;
}): Promise<PurchaseCreditResult> {
  const txHash = params.txHash.toLowerCase();
  const walletAddress = params.walletAddress.toLowerCase();
  return withClient(async (db) => {
    try {
      await db.query("BEGIN");
      const existingTx = await db.query(
        "SELECT * FROM purchases WHERE LOWER(tx_hash) = $1 FOR UPDATE",
        [txHash],
      );
      if (existingTx.rows.length > 0) {
        const existing = existingTx.rows[0] as {
          purchase_id: string;
          wallet_address: string;
          amount_wei: string;
          credits: number;
          status: string;
        };
        const matches =
          existing.purchase_id === params.purchaseId &&
          existing.wallet_address === walletAddress &&
          existing.amount_wei === params.amountWei &&
          Number(existing.credits) === params.credits;
        if (!matches) {
          await db.query("ROLLBACK");
          return { kind: "conflict" };
        }
        if (existing.status !== "credited") {
          const repaired = await db.query(
            `INSERT INTO credit_transactions (user_id, type, amount, reference, metadata)
             VALUES ($1, 'purchase', $2, $3, $4)
             ON CONFLICT (reference) DO NOTHING`,
            [
              params.userId,
              params.credits,
              `purchase:${txHash}`,
              JSON.stringify({
                txHash,
                purchaseId: params.purchaseId,
                packageId: params.packageId,
              }),
            ],
          );
          await db.query(
            `UPDATE purchases
             SET status = 'credited', reject_reason = NULL,
                 credited_at = to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')
             WHERE LOWER(tx_hash) = $1`,
            [txHash],
          );
          const balance = await db.query(
            "SELECT COALESCE(SUM(amount), 0) AS balance FROM credit_transactions WHERE user_id = $1",
            [params.userId],
          );
          await db.query("COMMIT");
          return {
            kind: repaired.rowCount === 1 ? "credited" : "already_credited",
            balance: Number(balance.rows[0].balance),
          };
        }
        const balance = await db.query(
          "SELECT COALESCE(SUM(amount), 0) AS balance FROM credit_transactions WHERE user_id = $1",
          [params.userId],
        );
        await db.query("COMMIT");
        return { kind: "already_credited", balance: Number(balance.rows[0].balance) };
      }

      const existingPurchaseId = await db.query(
        "SELECT tx_hash FROM purchases WHERE purchase_id = $1 FOR UPDATE",
        [params.purchaseId],
      );
      if (existingPurchaseId.rows.length > 0) {
        await db.query("ROLLBACK");
        return { kind: "conflict" };
      }

      await db.query(
        `INSERT INTO purchases (tx_hash, purchase_id, wallet_address, amount_wei, credits, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')`,
        [txHash, params.purchaseId, walletAddress, params.amountWei, params.credits],
      );
      await db.query(
        `INSERT INTO credit_transactions (user_id, type, amount, reference, metadata)
         VALUES ($1, 'purchase', $2, $3, $4)`,
        [
          params.userId,
          params.credits,
          `purchase:${txHash}`,
          JSON.stringify({
            txHash,
            purchaseId: params.purchaseId,
            packageId: params.packageId,
          }),
        ],
      );
      await db.query(
        `UPDATE purchases
         SET status = 'credited', credited_at = to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')
         WHERE LOWER(tx_hash) = $1`,
        [txHash],
      );
      const balance = await db.query(
        "SELECT COALESCE(SUM(amount), 0) AS balance FROM credit_transactions WHERE user_id = $1",
        [params.userId],
      );
      await db.query("COMMIT");
      return { kind: "credited", balance: Number(balance.rows[0].balance) };
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      if (error instanceof Error && error.message.includes("duplicate key")) {
        return { kind: "conflict" };
      }
      throw error;
    }
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
  failure_reason?: string | null;
}

export interface RoastJob {
  id: string;
  user_id: number;
  profile: string;
  cost: number;
  status: "processing" | "completed" | "failed" | "refunded";
  execution_state: "queued" | "submitting" | "submitted" | "completed" | "refunded";
  chain_tx_hash: string | null;
  attempts: number;
  deadline_at: string | null;
  lease_until: string | null;
}

export async function reserveRoast(params: {
  userId: number;
  amount: number;
  requestId: string;
  profile: string;
}): Promise<{ ok: true; balance: number } | { ok: false; reason: "insufficient" | "duplicate" }> {
  return withClient(async (db) => {
    try {
      await db.query("BEGIN");
      await db.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [params.userId]);
      const balanceRow = await db.query(
        "SELECT COALESCE(SUM(amount), 0) AS balance FROM credit_transactions WHERE user_id = $1",
        [params.userId],
      );
      if (Number(balanceRow.rows[0].balance) < params.amount) {
        await db.query("ROLLBACK");
        return { ok: false, reason: "insufficient" };
      }
      await db.query(
        `INSERT INTO credit_transactions (user_id, type, amount, reference, metadata)
         VALUES ($1, 'spend', $2, $3, $4)`,
        [
          params.userId,
          -params.amount,
          `roast:${params.requestId}`,
          JSON.stringify({ profile: params.profile }),
        ],
      );
      await db.query(
        `INSERT INTO roasts
          (id, user_id, profile, cost, status, roast_request_id, execution_state, deadline_at)
         VALUES
          ($1, $2, $3, $4, 'processing', $1, 'queued', now() + interval '30 minutes')`,
        [params.requestId, params.userId, params.profile, params.amount],
      );
      const after = await db.query(
        "SELECT COALESCE(SUM(amount), 0) AS balance FROM credit_transactions WHERE user_id = $1",
        [params.userId],
      );
      await db.query("COMMIT");
      return { ok: true, balance: Number(after.rows[0].balance) };
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      if (error instanceof Error && error.message.includes("duplicate key")) {
        return { ok: false, reason: "duplicate" };
      }
      throw error;
    }
  });
}

export async function getRoastJob(requestId: string): Promise<RoastJob | undefined> {
  return withClient(async (db) => {
    const result = await db.query(
      `SELECT id, user_id, profile, cost, status, execution_state, chain_tx_hash,
              attempts, deadline_at, lease_until
       FROM roasts WHERE id = $1`,
      [requestId],
    );
    return result.rows[0] as RoastJob | undefined;
  });
}

/** Claims an unsent job before the asynchronous contract submission begins. */
export async function claimRoastSubmission(requestId: string): Promise<RoastJob | undefined> {
  return withClient(async (db) => {
    try {
      await db.query("BEGIN");
      const result = await db.query(
        `SELECT id, user_id, profile, cost, status, execution_state, chain_tx_hash,
                attempts, deadline_at, lease_until
         FROM roasts WHERE id = $1 FOR UPDATE`,
        [requestId],
      );
      const job = result.rows[0] as RoastJob | undefined;
      if (
        !job ||
        job.status !== "processing" ||
        job.execution_state !== "queued"
      ) {
        await db.query("ROLLBACK");
        return undefined;
      }
      const claimed = await db.query(
        `UPDATE roasts
         SET execution_state = 'submitting', attempts = attempts + 1,
             lease_until = now() + interval '2 minutes'
         WHERE id = $1
         RETURNING id, user_id, profile, cost, status, execution_state, chain_tx_hash,
                   attempts, deadline_at, lease_until`,
        [requestId],
      );
      await db.query("COMMIT");
      return claimed.rows[0] as RoastJob;
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      throw error;
    }
  });
}

export async function recordRoastSubmission(requestId: string, txHash: string): Promise<void> {
  await withClient(async (db) => {
    await db.query(
      `UPDATE roasts
       SET execution_state = 'submitted', chain_tx_hash = $2, lease_until = NULL,
           submitted_at = to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')
       WHERE id = $1 AND status = 'processing'`,
      [requestId, txHash.toLowerCase()],
    );
  });
}

export async function releaseRoastSubmission(requestId: string, reason: string): Promise<void> {
  await withClient(async (db) => {
    await db.query(
      `UPDATE roasts
       SET execution_state = 'submitting', lease_until = NULL, last_error = $2
       WHERE id = $1 AND status = 'processing'`,
      [requestId, reason.slice(0, 1000)],
    );
  });
}

export async function saveRoastResult(params: { requestId: string; result: unknown }): Promise<void> {
  const result = params.result as { thesis?: string } | null;
  await withClient(async (db) => {
    await db.query(
      `UPDATE roasts
       SET status = 'completed', execution_state = 'completed',
           thesis = $2, result_json = $3,
           completed_at = to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS'),
           lease_until = NULL, failure_reason = NULL
       WHERE id = $1 AND status = 'processing'`,
      [
        params.requestId,
        result && typeof result.thesis === "string" ? result.thesis : null,
        JSON.stringify(params.result),
      ],
    );
  });
}

/** Refund and terminal-state transition commit together or not at all. */
export async function refundRoast(requestId: string, reason: string): Promise<void> {
  await withClient(async (db) => {
    try {
      await db.query("BEGIN");
      const result = await db.query(
        "SELECT user_id, profile, cost, status FROM roasts WHERE id = $1 FOR UPDATE",
        [requestId],
      );
      const roast = result.rows[0] as
        | { user_id: number; profile: string; cost: number; status: string }
        | undefined;
      if (!roast || roast.status !== "processing") {
        await db.query("ROLLBACK");
        return;
      }
      await db.query(
        `INSERT INTO credit_transactions (user_id, type, amount, reference, metadata)
         VALUES ($1, 'refund', $2, $3, $4)
         ON CONFLICT (reference) DO NOTHING`,
        [
          roast.user_id,
          roast.cost,
          `refund:${requestId}`,
          JSON.stringify({ profile: roast.profile, reason: reason.slice(0, 500) }),
        ],
      );
      await db.query(
        `UPDATE roasts
         SET status = 'refunded', execution_state = 'refunded',
             failure_reason = $2, last_error = $2, lease_until = NULL
         WHERE id = $1`,
        [requestId, reason.slice(0, 1000)],
      );
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      throw error;
    }
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

export async function getRoastStatus(userId: number, roastId: string): Promise<StoredRoast | undefined> {
  return withClient(async (db) => {
    const result = await db.query(
      `SELECT id, profile, status, thesis, created_at, result_json, failure_reason
       FROM roasts WHERE user_id = $1 AND id = $2`,
      [userId, roastId],
    );
    return result.rows[0] as StoredRoast | undefined;
  });
}

export async function listActiveRoastJobIds(limit = 20): Promise<string[]> {
  return withClient(async (db) => {
    const result = await db.query(
      `SELECT id FROM roasts
       WHERE status = 'processing'
       ORDER BY created_at ASC
       LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => String(row.id));
  });
}

export async function findProcessingRoastForProfile(userId: number, profile: string): Promise<StoredRoast | undefined> {
  return withClient(async (db) => {
    const result = await db.query(
      `SELECT id, profile, status, thesis, created_at, result_json, failure_reason
       FROM roasts
       WHERE user_id = $1 AND LOWER(profile) = LOWER($2) AND status = 'processing'
       ORDER BY created_at DESC LIMIT 1`,
      [userId, profile],
    );
    return result.rows[0] as StoredRoast | undefined;
  });
}

export async function resetRoastForRetry(requestId: string): Promise<void> {
  await withClient(async (db) => {
    await db.query(
      `UPDATE roasts
       SET execution_state = 'queued', lease_until = NULL, last_error = 'retry queued',
           chain_tx_hash = NULL
       WHERE id = $1 AND status = 'processing'`,
      [requestId],
    );
  });
}
