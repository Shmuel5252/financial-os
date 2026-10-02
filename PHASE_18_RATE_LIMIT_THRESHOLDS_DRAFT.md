# Phase 18 row 18-05: rate-limit thresholds and capacity — DRAFT / NOT ADOPTED

**Status: DRAFT / NOT ADOPTED.**
- None of these values is Owner-approved, implemented or deployed.
- Current behaviour is in `PHASE_18_RATE_LIMIT_REVIEW.md` and is unchanged.
- Adopting any line below needs an explicit Owner decision, followed by separate build → evidence → review work.
- The values are starting points for a single-owner G1 deployment (one household, a few members). They are not measured against Atlas or Vercel; that measurement is residual work for after S10.

## 1. Current behaviour (for comparison, not a proposal)

| Policy | Limit | Key | Where |
|---|---|---|---|
| mutation | 30 per fixed 60 s | scope + sha256(userId) + window | 58 route methods, 68 effective scopes |
| ai | 10 per fixed hour | "ai-copilot" + sha256(userId) | POST api/ai/conversations only |
| none | – | – | 24 route methods, 26 pages |
| authjs | – | – | Auth.js GET/POST, sign-in and sign-out actions |

## 2. Proposed thresholds (DRAFT)

| # | Surface | Proposal | Rationale | Finding |
|---|---|---|---|---|
| T1 | POST report-summaries | Also consume the AI policy (shares the copilot's 10/h). Check idempotency before calling the provider | Same paid provider as the copilot | F-01 |
| T2 | POST open-banking/refresh | 1 per 15 min per binding, plus at most 6 per day, alongside the mutation budget | Each call costs ~20 credits; the provider data cannot change faster than its own refresh | F-02 |
| T3 | POST open-banking/sync | 6 per hour per user, with the kill switch extended to sync | ≤41 provider calls per request | F-10 |
| T4 | POST open-banking/claim | 5 per hour per user; check the binding before calling the provider | A one-time action | F-10 |
| T5 | POST notifications/evaluate | 6 per hour per user; status refresh at most once per 10 min and under the e-mail kill switch | ≤20 sends + 50 status reads per request | F-09 |
| T6 | Heavy GETs: reports, search, households, households/[id], reports/[id], report-summaries | A shared "heavy-read" budget of 60/min per user | ≈1 per second covers interactive use and blocks scripted loops | F-05 |
| T7 | Heavy page loaders: dashboard, purchase-simulation, budgets, households, reports | The same heavy-read budget, consumed in the loader (needs a server-component-safe limiter call) | Same | F-05 |
| T8 | All mutations, per user | A global cap of 120/min across scopes, alongside the per-scope 30/min | Closes the ~2,040/min aggregate | F-04 |
| T9 | Anonymous: /api/auth/*, sign-in action | An edge/IP limit, e.g. 20/min per IP. A Vercel firewall rule is a tier/architecture decision | No app-level key exists for anonymous callers | F-06, F-08 |
| T10 | Budget month input | Accept only the current year ±100 | Prevents the RangeError and the CPU amplification | F-12 |
| T11 | Window algorithm | Keep the fixed window, and accept the 2× burst explicitly. A sliding window is optional | Simplicity; the bounds above already include 2× headroom | F-03 |

## 3. Capacity estimate (DRAFT, unmeasured)

- **Limiter cost per limited request:** one `createIndex` (until F-07 is fixed) plus one `findOneAndUpdate` on a document of about 100 bytes. Counters live at most 2 windows; the peak is about (active users × scopes used per window × 2) documents. For G1 that is under 1,000 documents.
- **Steady-state worst cases per user under the current limits:**

  | Path | Worst case per hour |
  |---|---|
  | Anthropic, via F-01 | ≈1,800 calls |
  | Financy refresh | ≈1,800 calls (~36k credits) |
  | Financy sync | ≈73,800 logical calls |
  | Resend status reads | ≈90,000 |
  | Heavy reads | unbounded |

- **Under T1–T8:**

  | Path | Worst case per hour |
  |---|---|
  | Anthropic | ≤10 (+ copilot share) |
  | Refresh | ≤4 (≤6/day) |
  | Sync | ≤6 × 41 = 246 logical calls |
  | Resend status reads | ≤6 × 50 = 300 |
  | Heavy reads | ≤3,600 (≈1 per second) |

- **Atlas RU/latency and Vercel concurrency are not measured.** The proposed numbers must be validated against measurements before adoption.

## 4. Owner decisions required

1. Adopt, revise or reject each of T1–T11.
2. Decide on an edge/IP control (T9). This may involve a Vercel plan/firewall decision, and no paid resource is proposed here.
3. Approve post-S10 measurement work (deployed limiter, Atlas RU, Auth.js flood behaviour).
