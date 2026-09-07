# Focused management UX cleanup — 2026-09-07

## Scope and root causes

The owner requested a focused fix after manual QA, preserving the working authenticated onboarding/persistence/dashboard/forecast flows. Baseline: clean main at `78e0e434383e9e9bb9d09c1b062dd5740dcf5862`. No Phase 18 implementation, remote deployment, provider mutation, credential change or database migration is included.

1. Authenticated pages duplicated inconsistent navigation and linked to the public landing page. They now use one collapsed grouped navigation component, with explicit dashboard and financial-data destinations.
2. Completed profiles could revisit onboarding sections/review as though still onboarding. Completed section requests now route to management; first-time onboarding keeps its guarded sequential workflow. The hub includes profile and Safety Margin management without duplicate data.
3. Saved records exposed only a name and the first money field although full validated fields were available. Accessible disclosure panels now show safe financial details, localized enums, dates, exact amounts, version and timestamps. Manual editing submits existing expected-version PUT commands; provider data stays read-only. Goal financial edits and transaction category corrections stay in their dedicated evidence-preserving workflows.
4. Seven distinct manual goal types shared ambiguous generic labels. Each now has type-specific target/baseline/current labels and explanatory copy. Reported debt and overdraft magnitudes are positive, while actual accounts retain signed balances. Emergency-fund engine configuration shows only the chosen target basis and fund source.
5. Numeric zero defaults were not selected on focus. Numeric/decimal controls now select a zero for normal replacement typing without clearing zero or changing server validation.

## Goal steps: intentional non-change

No twelve-step goal plan exists in the repository's persistence or presentation. Phase 6 has percentage milestones, versioned financial definitions and immutable progress evidence; Phase 17 projects this evidence into journeys. There is no arbitrary task-completion flag that can safely be moved backward. The UI now explains this and directs users to source-data correction and explicit evaluation, or a material definition revision. Current regression/reopening and historical completion remain separate. Add/remove/skip of discretionary task steps is **not implemented**; it would require a separately defined task-plan model, not relabeling financial evidence. If the deployed UI shows an actual 7/12 step control, obtain the exact route/screenshot and deployed revision in a separate pass.

## Verification

Final selected regression: **71 files passed, 361 tests passed; 1 file / 1 test explicitly skipped** (`phase-nine-reconnection.integration.test.ts`, which requires the real-provider opt-in flag). Type-check passed. Zero-warning lint passed. Final production build passed. Official npm dependency audit returned **0 vulnerabilities**. `git diff --check` passed; a limited high-confidence secret-pattern scan of tracked changes and new files found no matches (not a claim of exhaustive secret detection). `.env.local` and runtime logs are ignored, and `.env.local` is untracked. The running server was restarted only on port 3001 with the final build; final-browser spot-check confirmed the updated record detail label, shared navigation and RTL, with zero captured console errors.

The initial targeted UI/routing/localization run passed 4 files / 33 tests. An initial new MongoDB assertion used an incorrect audit field name; it was corrected to the actual `auditTrail` field and the profile collection assertion now explicitly rejects a missing profile. A build-time route-config reexport was corrected to a literal `dynamic` export. Neither correction weakened application logic or acceptance assertions.

Reproduction (the local ignored environment file supplies test access without printing its values):

```powershell
node --env-file=.env.local node_modules/vitest/vitest.mjs run tests/unit tests/integration --maxWorkers=1 --exclude '**/phase-eight-anthropic.integration.test.ts' --exclude '**/phase-sixteen-anthropic.integration.test.ts' --exclude '**/phase-fifteen-resend.integration.test.ts' --exclude '**/phase-nine-financy.integration.test.ts' --exclude '**/phase-nine-identity-evidence.integration.test.ts' --exclude '**/phase-nine-development-cutover.operations.test.ts' --reporter=dot
npm run typecheck
npm run lint
npm run build
npm audit --audit-level=high
git diff --check
```

The complete selected regression includes all unit tests and real MongoDB integration suites. External Anthropic/Resend/Financy acceptance files, the real identity inventory and destructive development cutover operation are excluded because this maintenance does not modify their implementations or authorize new external acceptance actions. The real reconnection suite remains explicitly skipped without its opt-in flag. These are **not** reported as fresh provider verification.

Production-browser acceptance uses the actual existing authenticated session on `http://localhost:3001`, not fabricated cookies or a bypass. Verified: Hebrew/RTL root, grouped navigation; all seven goal type label sets; zero selected then ordinary typing producing `5000` (not `05000`); negative reported goal value invalid and zero valid; saved expense details and populated valid editor; goal editor limited to title/priority; cancelling edits; back-to-hub; completed onboarding account/Safety Margin/review redirects; management profile; dashboard/forecast/goals/progress rendering without navigation to sign-in; 390-pixel mobile menu without horizontal overflow. Browser console error count was zero. Temporary viewport override was reset. No real financial form was saved, no data deleted and no new Google login was performed; browser-save persistence was instead exercised via the same update payload and real isolated MongoDB application service.

## Changed files

- Shared navigation: `src/components/navigation/app-navigation.tsx`; page headers for dashboard, budgets, copilot, debt-strategies, financial-data, forecasts, goals, households, net-worth, notifications, open-banking, progress, purchase-simulation, reports and transaction-intelligence.
- Routing/management: `src/app/financial-data/[section]/page.tsx`, `src/app/financial-data/profile/page.tsx`, `src/app/onboarding/[section]/page.tsx`, `src/app/onboarding/profile/page.tsx`, `src/app/onboarding/review/page.tsx`, `src/lib/financial-data/sections.ts`.
- Forms/details: `src/components/onboarding/manual-section-form.tsx`, `src/components/onboarding/profile-form.tsx`, `src/lib/financial-data/record-presentation.ts`.
- Goal/progress presentation: `src/components/goals/goal-center.tsx`, `src/components/progress-journeys/progress-journey-center.tsx`.
- Numeric input and localization: `src/components/forms/numeric-focus-boundary.tsx`, `src/app/layout.tsx`, `src/lib/i18n/hebrew.ts`.
- Tests: `tests/unit/management-ux.test.tsx`, `tests/unit/management-routing.test.tsx`, `tests/unit/goal-ui.test.tsx`, `tests/integration/phase-two-financial-data.integration.test.ts`.
- Records: this report, `ARCHITECTURE.md`, `DECISIONS.md`, `PROGRESS.md`.

## Preserved boundaries and remaining work

No changes to server authorization, Auth.js configuration, money parsing/BSON int64, Financial/Forecast/Goal engines, immutable evidence repositories, provider adapters, shared household access, or AI authority. Real MongoDB verifies exact values above Number's safe-integer range, optimistic conflicts, entity audit, ownership isolation, reloaded saved data and unchanged completed profile/account records.

The owner subsequently authorized a single release/checkpoint commit and push, with no additional product changes. The release rerun passed 71 files / 361 tests, with the same explicitly skipped real reconnection test and six excluded files listed above. Type-check, zero-warning lint and production build passed again; the official dependency audit again returned 0 vulnerabilities. Existing authenticated Hebrew/RTL production-browser evidence remains applicable because no product code changed during checkpoint preparation.

This checkpoint is identified by the commit containing this report, with message `fix(ux): unify financial management navigation and forms`. Its exact SHA and post-push synchronization result are recorded in the release handoff, avoiding a self-referential commit hash in the file. The running local server uses port 3001 only. Vercel staging must be validated against this new commit before treating the deployed cleanup as verified; neither automatic deployment completion nor staging acceptance is inferred from a Git push. Additional discretionary goal-task planning and any deployment-specific discrepancy belong in a separate pass. No next phase is authorized by this checkpoint.
