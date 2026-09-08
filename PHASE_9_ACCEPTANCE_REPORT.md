# Phase 9 engineering acceptance — 2026-09-07

**Result: all Phase 9 acceptance gates passed; accepted at the documented local/staged Financy boundary and ADR-066 development-baseline exception.** This is not a production-launch or general multi-user hosted-onboarding claim.

## Final verified evidence

- The one newly approved real paid refresh was submitted once through the authenticated production application on port 3001 at **2026-09-07 04:25:57.028 UTC**. Its MongoDB lifecycle receipt became **`completed / accepted` at 04:25:59.621 UTC**. The Hebrew browser displayed the asynchronous acceptance message. No second paid attempt, disconnect, payment, subscription, or billing-plan operation occurred.
- The provider's documented refresh cost is **20 credits**. Its response confirms acceptance, not an independently inspected billing-ledger debit; no billing endpoint was called. ADR-067 disables automatic POST/DELETE retries and failed-refresh-key replay. All 18 focused adapter/real-Mongo tests passed, including transport/401/503 single-attempt cases and unchanged failed receipts.
- Real connection evidence advanced from `lastFetchedAt=2026-09-06T07:17:11.121Z`, data date `2026-09-06`, to **`2026-09-07T04:26:15.147Z`, data date `2026-09-07`, status `ACTIVE`**. This verifies newer financial data, not merely a fetch-attempt timestamp.
- The first authenticated post-refresh ordinary sync completed at **04:27:39.044 UTC** with 8 product observations and 1,140 transaction observations. It legitimately changed 5 canonical account projections and added/updated 7 canonical transactions. Current totals: **5 canonical provider accounts, 462 canonical provider transactions, 1,178 immutable observations**. Products, currencies and noncanonical observations remain distinct.
- The second authenticated ordinary sync completed at **04:30:14.703 UTC**, with **0 canonical account changes and 0 canonical transaction changes**. Canonical and observation BSON digests were individually identical before/after; duplicate canonical alias groups were **0 / 0**.
- All **1,653 archive payloads remain hash-valid**, with **0 retired IDs in live collections** and **0 manual reconciliation decisions**. All 99 original protected documents other than the expected active Auth.js-session metadata and explicitly refreshed provider binding remain byte-equivalent. The two metadata documents changed during normal session renewal and the approved refresh; all manual/non-Financy financial data, other owners, budgets, goals, forecasts, reviews/corrections, household and AI records remain unchanged. The original migration's 101/101 preservation proof remains valid for its recorded time.
- The original `failed/schema` refresh receipt is preserved, not relabelled. The earlier real `completed/disconnected` receipt and provider `TERMINATED_BY_USER` evidence remain intact. Reconnection and the approved new baseline are verified; no additional disconnect is required.
- **Full regression: 74 files / 340 tests passed**, with real MongoDB, real Financy isolated import/current-identity reads, real Anthropic Phase 8/16 and Resend official test-mode regression. No skips within the selected suite. The separately executed destructive development operation and superseded legacy-identity diagnostic remain excluded from routine regression; neither is a fake acceptance substitute.
- **Type-check, zero-warning lint, optimized production build and dependency audit passed (0 vulnerabilities)**. Initial build attempt hit an open server-log lock; after stopping only the verified port-3001 process the build passed. The final production server runs on port 3001 with ignored logs outside the build output. Port 3000 was untouched.
- **Authenticated Hebrew/RTL browser acceptance passed:** real refresh and both syncs, visible new status/freshness, 47 LTR isolates, one main/H1, no horizontal overflow, unchecked/disabled paid and destructive controls after completion, and 0 console warnings/errors. Real read-only reconciliation reload shows zero legacy rows and no false transaction gate; its RTL layout was visually inspected.
- Live unauthenticated Open Banking/reconciliation GETs return **401/no-store**, with frame denial and nosniff headers. A foreign-origin ordinary-sync POST returns **403**. Existing real-Mongo tests cover two-user denial, immutable evidence, owner binding, optimistic/idempotent conflicts, exact BSON int64 money, no manual overwrite and source/parent/institution validation.
- Final post-documentation scans covered **316 source candidates, 33 production client assets and 2 server logs**, with **0 configured credential matches** and an empty server error log. Master Plan copies are byte-identical and `git diff --check` passes. The only initial whole-environment literal match was a previously documented credential-free loopback MongoDB URI, not a secret; it is explicitly excluded from credential findings. `.env.local` remains ignored/untracked and is never staged. Staged content is checked again before commit.

## Verification commands and commit handoff

The focused run used `node --env-file=.env.local node_modules/vitest/vitest.mjs run tests/unit/financy-open-banking-provider.test.ts tests/integration/phase-nine-open-banking.integration.test.ts --maxWorkers=1 --reporter=dot`.

The full run enabled `RUN_REAL_ANTHROPIC_TESTS`, `RUN_REAL_RESEND_TESTS`, `RUN_REAL_OPEN_FINANCE_TESTS`, and `RUN_REAL_OPEN_FINANCE_RECONNECTION_TESTS`, then ran `node --env-file=.env.local node_modules/vitest/vitest.mjs run tests/unit tests/integration --maxWorkers=1 --exclude '**/phase-nine-identity-evidence.integration.test.ts' --exclude '**/phase-nine-development-cutover.operations.test.ts' --reporter=dot`. Loading the ignored environment did not print its contents. Separate gates were `npm run typecheck`, `npm run lint`, `npm run build`, `npm run security:audit`, `git diff --check`, read-only MongoDB integrity inspections, and the real authenticated browser journey.

This report is included in the Phase 9 acceptance commit. Its exact hash, successful push, fresh remote equality and clean-tree result must be reported after the commit exists; no commit hash or push success is invented here. The prior accepted base is `a7b60ed95ebfc1177bc5ddac3ff51920ae40cd47`.

## Next-phase boundary

**Historical handoff below, superseded on 2026-09-08:** The owner has since verified Vercel staging, deployed Atlas and real Google/Auth.js login after `812b280`. See PHASE_18_ENTRY_REVIEW.md for current evidence classes and remaining operational/privacy gates. This note updates the handoff, not the Phase 9 results or its staged Financy acceptance boundary.

The newest owner authority permits Phase 18 after the clean Phase 9 checkpoint. Its documented prerequisite is chosen production infrastructure. Only local loopback MongoDB/Auth configuration is verified here; there is no linked Vercel project or supplied hosted production environment. Production resource/access selection, operational SLO/backup-retention/restore targets, audit-retention versus full-erasure policy, and general multi-user provider onboarding remain explicit infrastructure/product gates. Do not fabricate hosted verification, purchase/provision consequential infrastructure, weaken privacy policy, or self-accept Phase 18. No Phase 18 implementation has been performed in this Phase 9 change.

## Historical checkpoint — 2026-09-06 (superseded by the evidence above)

**Result: development baseline migration verified; Phase 9 NOT yet accepted.**

## Verified work

| Gate | Actual evidence |
| --- | --- |
| Exact retirement scope | 5 obsolete Financy accounts, 460 transactions, 1 connection, 1,187 revisions; source/owner/ended-connection audit and recursive/composite reference checks |
| Recoverability | All 1,653 documents copied as BSON into an owner-scoped archive and individually hash-verified before exact unchanged originals were retired; no live retired IDs remain |
| Unrelated data preservation | All 101 pre-existing non-target documents retain their exact digests, including both owners' manual data, budgets, goals, forecasts, corrections/reviews, household and AI history, auth data, provider binding and lifecycle receipts |
| Product separation | 8 distinct products: 4 loans, 2 checking products and 2 cards; all retain minimized stable-identity evidence |
| Real current provider import | 1 ACTIVE connection, 8 account observations and 1,139 transaction observations; 1,148 total immutable observations |
| Conservative canonical projection | 5 eligible primary-currency accounts and 455 eligible BOOKED transactions; foreign-currency, pending, unavailable-balance and unsupported/unknown-currency data remain separate provider evidence |
| Idempotency | Second real sync: zero changed canonical accounts/transactions and identical canonical/observation BSON digest; actual authenticated browser sync also completes with zero changes |
| Isolation/security | Existing Auth.js actor/provider binding; explicit provider-subject and parent/institution scope checks; real-Mongo two-owner denial, no manual overwrite, immutable evidence and conflicting-write rejection |
| Regression | Final selected full suite: **74 files / 335 tests passed**, real MongoDB, real Financy import/current-baseline read, Anthropic Phase 8/16 and Resend official test-mode paths |
| Production/browser | Type-check, zero-warning lint and optimized build pass. Authenticated Hebrew/RTL sync, 47 LTR isolates, one main/H1, no overflow, unchecked destructive/paid controls, zero console warnings/errors; final empty reconciliation review has zero legacy rows, no false sync-block warning and verified RTL screenshot |
| Dependencies/secrets | Registry audit: **0 vulnerabilities**. Configured-private-value scans: 316 final source candidates, 33 production client assets and local server logs, zero matches. Server error log empty. `.env.local` ignored and untracked; Master Plan copies identical; `git diff --check` passes |

The routine suite deliberately excludes the separately executed destructive development operation and the superseded legacy-missing-identity diagnostic. The former actually passed against the existing development database; the latter describes retired test data and is retained as an opt-in historical diagnostic. The passing current-baseline identity read proves the current 5/455 canonical identities are present, not that old external IDs survived reconnect. Production reconciliation and manual attestation safeguards remain implemented and fail closed for future unknown reconnects.

## Exact remaining acceptance gate

The previous real paid refresh started **2026-09-05 21:45:19 UTC**. The provider returned HTTP 200 `accepted`, but the application persisted **`failed` / `schema`** because its response parser expected another shape. The parser has been corrected and tested, but a real successful application refresh receipt through that corrected path has not been observed.

Archived provider connection evidence shows `lastFetchedAt` advancing from 05:10:29 UTC to 21:45:43 UTC while `lastFetchedDataDate` stays 2026-09-05. This verifies an advancing fetch-attempt timestamp, not independently successful new financial data or the exact credit debit. Later reconnection/import cannot retroactively establish the failed application's refresh receipt. The failed receipt remains unchanged.

Finishing that gate requires a **new explicitly authorized refresh at the provider's documented cost of 20 credits**, followed by ordinary read synchronization and verification of the actual receipt, provider state, failure/freshness behavior and idempotency. Do not submit the old command again implicitly, silently spend credits, manufacture a receipt or call this complete based on a fixture. If provider completion remains unverifiable after an approved request, stop and report it rather than repeatedly charging refresh.

The previous disconnect at **2026-09-05 21:53:58 UTC** has a `completed/disconnected` receipt and real `TERMINATED_BY_USER` provider evidence. **No new disconnect or bank reconnection is required or authorized.** This migration called no paid refresh, provider delete, payment, subscription or billing endpoint.

## Repository / handoff

- Local `main` and a fresh read of remote `refs/heads/main` both point to **`a7b60ed95ebfc1177bc5ddac3ff51920ae40cd47`** (accepted Phase 17).
- All valid Phase 9 work is preserved uncommitted; nothing staged, committed or pushed at this pending gate. The working tree is intentionally not clean.
- Financial OS is running the final production build on **port 3001**. Port 3000 was not stopped or modified.
- Source-of-truth policy/implementation records are updated. **No Phase 9 self-acceptance and no Phase 18.**
- Next user action: explicitly approve or decline the additional 20-credit refresh. The current new baseline needs no manual legacy-account confirmations.
