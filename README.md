# Roast My X

> Your profile isn't as good as you think.

**Roast My X** is a GenLayer-powered evaluation machine. Paste your X (Twitter) profile, and a jury of **five independent AI judges** — executed on-chain by a deployed Intelligent Contract — evaluates it, roasts it, reaches validator consensus on the verdicts, and hands you one unified thesis with concrete fixes.

No mercy. No fabricated data. Real consensus.

🔗 **Live app:** https://roastcheck.vercel.app

---

## The problem it solves

Creators and builders rarely get honest feedback about how their X profile actually reads. Friends are polite. Analytics tools give metrics without judgment. Yet profiles that fail to communicate identity, credibility, or value silently cost followers, opportunities, and trust.

Roast My X delivers what friends won't: specific, evidence-based, brutally honest evaluation — followed by actionable fixes.

## How it works

```
User pastes X profile URL
        ↓
Backend validates + reserves credits (atomic, idempotent)
        ↓
RoastJury Intelligent Contract (on studionet)
        ↓  gl.nondet.web.get — live public profile fetch
        ↓  gl.nondet.exec_prompt × 5 judges + 1 moderator
        ↓
Validator consensus (equivalence principle):
independent validators re-run the ENTIRE pipeline; weighted
verdict-band agreement ≥ 2.5/5 required, else UNDETERMINED
        ↓
Unified thesis · headline roast · 3-5 concrete fixes
        ↓
Stored on-chain → read back to the user
```

### The five judges

| Judge | Question |
|---|---|
| Recruiter | Would I take this person seriously professionally? |
| Growth Critic | Would I follow this account? |
| Content Critic | Is this person actually saying anything? |
| Profile Critic | Does this profile communicate who they are? |
| Roast Judge | What's the funniest, most obvious weakness here? *(choose violence)* |

Four judges stay analytical; the Roast Judge is unfiltered Gen-Z internet energy. All roasts target the **profile** (positioning, writing, branding) — never protected personal traits.

### Honest evidence policy

Judges only evaluate what is publicly accessible (display name, bio, avatar). Follower counts and recent posts are not retrievable anonymously — so the contract explicitly instructs judges to exclude them rather than invent them. Every result includes an "evidence" list of what was actually evaluated.

## Architecture

```
web/                     Next.js 16 App Router (UI + API routes)
├─ src/app/              pages: / · /roast · /history · /credits
├─ src/app/api/          auth · credits · roast · history endpoints
├─ src/server/           ledger (Postgres) · payment verification
│                        X-profile provider · GenLayer service
└─ src/components/       wallet · credits · roast UI · design system

contracts/
├─ roast_jury.py         five-judge evaluation engine (GenVM)
└─ roast_payments.py     on-chain purchase registry + treasury

tests/direct/            gltest direct-mode suites (33 tests)

scripts/                 deploy · verify · lint · genskill driver
```

**Separation of concerns (blueprint-enforced):**

- **On-chain:** evaluation logic + purchase registry. The contract knows nothing about users or balances.
- **Off-chain:** credit ledger, wallet auth, history, orchestration.
- **GenLayer service module:** all contract interaction isolated behind `src/server/genlayer-service.ts`.

## The two Intelligent Contracts

### RoastJury (`contracts/roast_jury.py`)

- `submit_roast(username)` — normalizes the handle, fetches `https://x.com/<handle>` via `gl.nondet.web.get`, runs five judges via `gl.nondet.exec_prompt`, deliberates via moderator, then requires validator agreement through `gl.vm.run_nondet_unsafe`.
- **Weighted verdict-band consensus:** validators re-run everything independently. Agreement scored exact match = 1pt, adjacent band = 0.5pt; ≥ 2.5/5 required. Genuine disagreement still fails honestly (→ backend refunds).
- Partial judge failures degrade to `UNCLEAR` without killing the roast; moderation failure blocks storage entirely.
- `get_roast` / `has_roast` / `get_roast_count` views.

### RoastPayments (`contracts/roast_payments.py`)

- `buy_credits(purchase_id)` `@gl.public.write.payable` — records buyer, amount, timestamp under a unique id. Duplicate ids revert (replay protection); minimum purchase enforced.
- `get_purchase(id)` / `has_purchase(id)` — on-chain proof the backend verifies before awarding credits.
- `withdraw` / `withdraw_all` — owner-only treasury sweep.

**Deployment (studionet, live):**
- RoastJury: `0x382E939C2C9fc42F7b08888641DF6d3Ab804B70c`
- RoastPayments: `0xF45DD9f8c8AB2239A8368272eb565dcD35dc8B3D`
- Previous Jury (kept for history): `0xE8C69DAD65AEC5CFED3245464D176a4f5203C294`

## Credit economy

| Package | Price | Credits |
|---|---|---|
| Starter | 1 GEN | 10 |
| Double | 2 GEN | 20 |
| Jury | 5 GEN | 50 |

One roast = **5 credits**. Wallet connects for identity; buying credits is the only wallet-signing moment. The backend verifies every purchase on-chain (recipient, sender, success status) before crediting — the frontend can never self-declare a payment. Spends are atomic with idempotency keys; failed roasts auto-refund after one retry.

## Getting started

```bash
git clone <repo-url> && cd RoastMyX/web
npm install
cp ../.env.example ../.env        # fill in your values (see below)
npm run dev                       # http://localhost:3000
```

### Environment variables (root `.env`)

```bash
GENLAYER_NETWORK=studionet
GENLAYER_RPC=https://studio.genlayer.com/api
BACKEND_PRIVATE_KEY=0x...          # funds contract calls — server-side ONLY
TREASURY_WALLET_ADDRESS=0x...      # receives withdrawn GEN
ROAST_PAYMENTS_CONTRACT_ADDRESS=0x...
ROAST_JURY_CONTRACT_ADDRESS=0x...
CREDIT_PACKAGES_JSON={"packages":[...]}
ROAST_COST_CREDITS=5
SESSION_SECRET=...
# production:
DATABASE_URL=postgres://...        # Neon / any Postgres
```

Never commit `.env`. Never expose `BACKEND_PRIVATE_KEY` client-side.

## Testing

```bash
pip install genlayer-test          # Python 3.14 recommended
python3.14 -m pytest tests/direct/ -v   # 33 tests, mocked web+LLM
```

Coverage: purchase recording & replay rejection, zero/below-minimum value handling, owner-only withdrawal guards, full 5-judge flow, handle normalization, invalid-input rejection, missing-profile detection, duplicate roasts, partial judge failure degradation, and four consensus-semantics tests (exact agreement, single dissent, divergent verdicts, fully-shifted bands).

## Deployment

- **Frontend + API:** Vercel (`roastcheck.vercel.app`)
- **Ledger:** Neon Postgres (`DATABASE_URL`)
- **Contracts:** GenLayer studionet via `node scripts/deploy-contracts.mjs`, verified with `scripts/verify-deployment.mjs`

The app auto-switches wallets to studionet (chainId 61999) before any payment — mainnet ETH cannot be sent by mistake.

## Security notes

- Backend private key never leaves the server; all contract calls are backend-funded.
- Wallet ownership proven by signed challenges (`personal_sign`) — raw addresses are never trusted.
- On-chain payment verification gates every credit grant; idempotency keys prevent double-crediting and double-spending.
- Profile content is treated as untrusted data inside prompts (prompt-injection resistant).

## Tech stack

Next.js 16 · React 19 · Tailwind v4 · TypeScript · genlayer-js · viem · Neon Postgres · better-sqlite3 (dev) · GenVM Python contracts · gltest · Vercel

---

Built on [GenLayer](https://genlayer.com) — the adjudication layer where AI validators reach consensus on subjective questions.

*The jury is watching.*
