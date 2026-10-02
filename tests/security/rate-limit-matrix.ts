// Phase 18 row 18-05 (repository portion): the rate-limit / abuse-control decision for EVERY API route method, page/layout render
// and server action. Enforced by tests/unit/rate-limit-inventory.test.ts against the source (tests/security/rate-limit-sites.ts):
// a new, stale, missing or wrongly classified entry fails CI. This records CURRENT behaviour; it changes no limit.
//
// policy   mutation = consumeMutationRateLimit(actor, scope): 30 per fixed 60 s window per (scope, sha256(userId))
//          ai       = consumeAiRequestRateLimit(actor): 10 per fixed hour, scope "ai-copilot"
//          authjs   = Auth.js protocol surface (no application limiter can run before Auth.js handles it)
//          none     = an EXPLICIT decision that the surface is not throttled today; `rationale` says why, and a heavy/provider
//                     `none` must cite the finding that records the gap (findings are not remediated by this row).
// identity what keys (or would key) the caller: actor = signed-in user id (hashed into the counter key), operator = signed-in user
//          on OPERATIONS_OPERATOR_USER_IDS, anonymous = no identity (no limiter key exists for anonymous callers anywhere),
//          authjs = Auth.js session cookie / OAuth state only.
// cost     per request, worst case from code bounds (PHASE_18_RATE_LIMIT_REVIEW.md has file:line evidence):
//          static   = no database or network I/O
//          light    = a few queries, <= ~250 documents
//          moderate = <= ~100 queries and <= ~10,000 documents
//          heavy    = more than that (whole-collection loads, N+1 fan-out, sequential per-item loops)
//          provider = calls an external provider (Anthropic, Financy, Resend, Google)
export type Policy = "mutation" | "ai" | "authjs" | "none";
export type Identity = "actor" | "operator" | "anonymous" | "authjs";
export type Cost = "static" | "light" | "moderate" | "heavy" | "provider";
export type RateLimitEntry = Readonly<{ policy: Policy; scope?: string; identity: Identity; cost: Cost; rationale: string; findings: readonly string[] }>;

/** Open 18-05 findings (PHASE_18_RATE_LIMIT_REVIEW.md). Reported, not remediated: each needs a separate Owner decision. */
export const rateLimitFindings: Readonly<Record<string, string>> = {
  "F-18-05-01": "AI report summaries call Anthropic under the generic 30/min mutation budget, not the 10/hour AI policy; concurrent, replayed and post-delete requests each pay the provider (post-delete ones then fail with 500)",
  "F-18-05-02": "Paid open-banking refresh has no cooldown beyond the 30/min mutation budget (one paid refresh per new idempotency key)",
  "F-18-05-03": "Fixed window: up to 2x the limit passes across a window boundary",
  "F-18-05-04": "Budgets are per scope (68 mutation scopes; templated per section): no per-user global cap across scopes",
  "F-18-05-05": "Expensive reads (pages and GET routes) are unthrottled",
  "F-18-05-06": "No anonymous / IP / global key: limits are per account only, so each new account is a fresh budget",
  "F-18-05-07": "createIndex runs on every request (limiter and repositories), including requests the limiter refuses",
  "F-18-05-08": "Auth.js endpoints and the sign-in server action are unthrottled (outbound Google calls, session lookups)",
  "F-18-05-09": "Notification evaluation fans out to up to 20 Resend sends and 50 delivery-status reads per request; the e-mail kill switch does not stop the status reads",
  "F-18-05-10": "Open-banking claim/sync call Financy before the binding / idempotency checks; sync makes up to 41 logical calls per request and has no kill switch",
  "F-18-05-11": "Search index rebuild loads ~52,650 documents before its 15,000 cap and rewrites the index non-atomically (concurrent rebuilds 500 with a partial index)",
  "F-18-05-12": "A far-future budget month (schema accepts years to 9999) makes recurring expansion throw: PUT saves the period then returns 500; the page renders the error view",
  "F-18-05-13": "No index on authSessions.sessionToken (or authAccounts provider keys) is created by the app: every session lookup, including forged cookies, may scan the collection",
};

const NONE = (identity: Identity, cost: Cost, rationale: string, findings: readonly string[] = []): RateLimitEntry => ({ policy: "none", identity, cost, rationale, findings });
const M = (scope: string, cost: Cost, findings: readonly string[] = [], rationale = ""): RateLimitEntry => ({ policy: "mutation", scope, identity: "actor", cost, rationale, findings });
const AUTHJS = (rationale: string): RateLimitEntry => ({ policy: "authjs", identity: "authjs", cost: "provider", rationale, findings: ["F-18-05-08"] });
const actorRead = "Authenticated read of the actor's own data only (401 before any query for anonymous callers)";
const paged = (max: number) => `${actorRead}; a page of at most ${max} documents (zod-capped limit) plus one cursor probe.`;
const household = "loadHouseholdCenter: up to ~150 queries across 50 households, then for the selected household up to ~1,500 sequential share lookups and an invitation-expiry write";
const sections = (route: string, count: number) => `${route} with a templated scope: ${count} sections -> ${count} independent 30/min budgets`;

export const rateLimitMatrix: Readonly<Record<string, RateLimitEntry>> = {
  // ---- Public, protocol and operator surfaces
  "GET api/health": NONE("anonymous", "static", "Public liveness: returns a constant JSON body; no session, database or network I/O, so there is nothing to amplify."),
  "GET api/auth/[...nextauth]": AUTHJS("Auth.js session/csrf/providers/callback: a forged cookie costs one sessions lookup; the OAuth callback makes a Google token request."),
  "POST api/auth/[...nextauth]": AUTHJS("Auth.js sign-in/sign-out: sign-in performs Google OIDC discovery and redirects; sign-out deletes only the caller's session."),
  "GET api/ops/readiness": NONE("operator", "moderate", "Operator-only: non-allowlisted users are refused before the probe runs; the probe is bounded by a 5 s deadline and returns only a category."),
  "GET api/ops/bindings": NONE("operator", "moderate", "Operator-only: non-allowlisted users are refused before inspection; bounded by a 5 s deadline; returns fixed binding enums, never values."),
  // ---- Profile, preferences, notifications, progress
  "GET api/profile": NONE("actor", "light", `${actorRead}: one profile findOne (plus one createIndex).`),
  "PUT api/profile": M("profile-write", "light"),
  "POST api/onboarding/progress": M("onboarding-progress", "light"),
  "PUT api/notification-preferences": M("notification-preferences", "light"),
  "PUT api/progress-journey-preferences": M("progress-journey-preferences", "light"),
  "GET api/progress-journeys": NONE("actor", "moderate", `${actorRead}: preferences + up to 5,001 progress events (more throws), ~28 createIndex; no evaluation or write.`, ["F-18-05-05"]),
  "POST api/progress-journeys": M("progress-journey-evaluate", "heavy"),
  "GET api/notifications": NONE("actor", "light", `${actorRead}: preferences + at most 100 notifications; no evaluation and no Resend call on GET.`),
  "PATCH api/notifications": M("notification-state", "light"),
  "POST api/notifications/evaluate": M("notification-evaluation", "provider", ["F-18-05-09"]),
  // ---- Manual records
  "GET api/financial-data/[section]": NONE("actor", "light", `${paged(50)} [section] is validated before authentication.`),
  "POST api/financial-data/[section]": M("`financial-data-${section}`", "light", ["F-18-05-04"], sections("financial-data", 10)),
  "PUT api/financial-data/[section]": M("`financial-data-${section}`", "light", ["F-18-05-04"], sections("financial-data", 10)),
  "DELETE api/financial-data/[section]": M("`financial-data-${section}`", "light", ["F-18-05-04"], sections("financial-data", 10)),
  "GET api/onboarding/[section]": NONE("actor", "light", `${actorRead}: one section list of at most 101 records; [section] is validated before authentication.`),
  "POST api/onboarding/[section]": M("`onboarding-${section}`", "light", ["F-18-05-04"], sections("onboarding", 7)),
  "PUT api/onboarding/[section]": M("`onboarding-${section}`", "light", ["F-18-05-04"], sections("onboarding", 7)),
  "DELETE api/onboarding/[section]": M("`onboarding-${section}`", "light", ["F-18-05-04"], sections("onboarding", 7)),
  "GET api/financial-data/export": M("financial-data-export", "heavy", [], "Whole-account export: limited (actor -> limiter, no origin check on GET)."),
  "GET api/financial-data/snapshots": NONE("actor", "moderate", `${paged(20)} Each snapshot carries a source manifest that grows with the record count.`),
  "POST api/financial-data/snapshots": M("financial-snapshot", "heavy"),
  // ---- Engine, budgets, goals, forecasts, simulations, debt
  "GET api/financial-engine/snapshots": NONE("actor", "moderate", `${paged(20)} Engine snapshots carry stored timelines; no engine run on GET.`),
  "POST api/financial-engine/snapshots": M("financial-engine-snapshot", "heavy"),
  "POST api/budgets/categories": M("budget-categories", "light", [], "Shares its budget with PUT (same scope)."),
  "PUT api/budgets/categories": M("budget-categories", "light", [], "Shares its budget with POST (same scope)."),
  "POST api/budgets/corrections": M("budget-corrections", "light"),
  "POST api/budgets/periods": M("budget-periods-close", "heavy"),
  "PUT api/budgets/periods": M("budget-periods", "moderate", ["F-18-05-12"]),
  "POST api/budgets/scenarios": M("budget-scenarios", "heavy"),
  "POST api/goals/definitions": M("goal-definitions", "light"),
  "POST api/goals/evaluations": M("goal-evaluations", "heavy"),
  "GET api/forecasts": NONE("actor", "light", `${actorRead}: two stored-forecast lists (limit 10 and 20); no forecast computation on GET.`),
  "POST api/forecasts": M("forecast-calculation", "heavy"),
  "POST api/forecast-scenarios": M("forecast-scenario-calculation", "heavy"),
  "GET api/purchase-simulations": NONE("actor", "light", paged(20)),
  "POST api/purchase-simulations": M("purchase-simulation-save", "light"),
  "POST api/purchase-simulations/evaluate": M("purchase-simulation-evaluate", "heavy"),
  "GET api/debt-strategies": NONE("actor", "light", paged(20)),
  "POST api/debt-strategies": M("debt-strategy-save", "light"),
  "POST api/debt-strategies/evaluate": M("debt-strategy-evaluate", "heavy"),
  // ---- Net worth
  "GET api/net-worth/items": NONE("actor", "moderate", `${actorRead}: loadNetWorthCenter - 4 lists capped at 1,001, up to 5,001 goal definitions, ~48 createIndex; no capture on GET.`, ["F-18-05-05"]),
  "POST api/net-worth/items": M("net-worth-item-create", "light"),
  "PATCH api/net-worth/items": M("net-worth-item-update", "light"),
  "DELETE api/net-worth/items": M("net-worth-item-delete", "light"),
  "GET api/net-worth/snapshots": NONE("actor", "light", paged(20)),
  "POST api/net-worth/snapshots": M("net-worth-snapshot-create", "moderate"),
  // ---- Reports, AI
  "GET api/reports": NONE("actor", "heavy", `${actorRead}, but the heaviest read: a full current report (up to 10,000 source records, goal and net-worth centers) plus up to 50 saved reports, each household report loading the household center sequentially.`, ["F-18-05-05"]),
  "POST api/reports": M("report-close", "heavy"),
  "GET api/reports/[reportId]": NONE("actor", "heavy", `${actorRead}: one saved report; a household-scoped report re-checks membership through ${household}.`, ["F-18-05-05"]),
  "DELETE api/reports/[reportId]": M("report-hide", "light"),
  "GET api/reports/export": M("report-export", "heavy", [], "Report export: limited (actor -> limiter, no origin check on GET)."),
  "GET api/report-summaries": NONE("actor", "heavy", `${actorRead}: findSavedReport (household reports go through ${household}) + at most 50 summaries.`, ["F-18-05-05"]),
  "POST api/report-summaries": M("report-ai-summary", "provider", ["F-18-05-01"]),
  "DELETE api/report-summaries/[summaryId]": M("report-ai-summary-delete", "light"),
  "GET api/ai/conversations": NONE("actor", "light", `${actorRead}: at most 20 conversations of at most 24 messages; no provider call.`),
  "POST api/ai/conversations": { policy: "ai", scope: "ai-copilot", identity: "actor", cost: "provider", rationale: "The only route on the AI policy (10/hour).", findings: [] },
  "DELETE api/ai/conversations/[conversationId]": M("ai-conversation-delete", "light"),
  // ---- Search
  "GET api/search": NONE("actor", "heavy", `${actorRead}: up to 100 candidates validated in parallel, each building a repository (createIndex) and re-reading its source - notification candidates reload the notification center, household scope runs ${household}.`, ["F-18-05-05"]),
  "POST api/search": M("search-index-rebuild", "heavy", ["F-18-05-11"]),
  // ---- Transaction intelligence
  "GET api/transaction-intelligence/runs": NONE("actor", "moderate", `${actorRead}: the latest run + at most 1,000 reviews; no analysis on GET.`),
  "POST api/transaction-intelligence/runs": M("transaction-intelligence-analysis", "heavy"),
  "POST api/transaction-intelligence/reviews": M("transaction-intelligence-review", "light"),
  // ---- Households
  "GET api/households": NONE("actor", "heavy", `${actorRead} or households the actor is an active member of: ${household}.`, ["F-18-05-05"]),
  "POST api/households": M("household-create", "light"),
  "GET api/households/[householdId]": NONE("actor", "heavy", `Owner/active member only (requirePrincipal -> 404): ${household}.`, ["F-18-05-05"]),
  "PATCH api/households/[householdId]": M("household-settings", "light"),
  "DELETE api/households/[householdId]": M("household-dissolve", "moderate"),
  "POST api/households/[householdId]/invitations": M("household-invitation-create", "light"),
  "DELETE api/households/[householdId]/invitations/[invitationId]": M("household-invitation-revoke", "light"),
  "POST api/households/[householdId]/leave": M("household-leave", "moderate"),
  "DELETE api/households/[householdId]/members/[membershipId]": M("household-member-remove", "moderate"),
  "POST api/households/[householdId]/shares": M("household-resource-share", "light"),
  "POST api/households/invitations/accept": M("household-invitation-accept", "light"),
  // ---- Open banking
  "GET api/open-banking": NONE("actor", "moderate", `${actorRead}: the stored center (unbounded connection list, up to 2,000 account revisions, 9 createIndex); never calls Financy on GET.`),
  "POST api/open-banking/claim": M("open-banking-claim", "provider", ["F-18-05-10"]),
  "POST api/open-banking/sync": M("open-banking-sync", "provider", ["F-18-05-10"]),
  "POST api/open-banking/refresh": M("open-banking-refresh", "provider", ["F-18-05-02"]),
  "POST api/open-banking/disconnect": M("open-banking-disconnect", "provider", [], "Binding-gated; one listConnections + one deleteConnection per request."),
  "GET api/open-banking/reconciliation": M("bank-account-review-read", "provider", [], "Binding-gated GET that reads Financy (connections + up to 20 account pages): limited (actor -> limiter)."),
  "POST api/open-banking/reconciliation": M("bank-account-review-decision", "provider", [], "Binding-gated decision that re-reads the Financy review state (connections + up to 20 account pages) before recording."),

  // ---- Pages and layouts (GET renders: server components cannot use the route limiter; all `none` today)
  "PAGE src/app/layout.tsx": NONE("anonymous", "static", "Root layout: static shell; no session, database or network I/O."),
  "PAGE src/app/page.tsx": NONE("anonymous", "static", "Landing page: static content; no session, database or network I/O."),
  "PAGE src/app/not-found.tsx": NONE("anonymous", "static", "Static not-found view: no session, database or network I/O."),
  "PAGE src/app/error.tsx": NONE("anonymous", "static", "Client error boundary; renders only on the client, no server I/O."),
  "PAGE src/app/sign-in/page.tsx": NONE("anonymous", "static", "The GET render only parses configuration (no auth(), database or network); its server action is a separate ACTION entry."),
  "PAGE src/app/copilot/page.tsx": NONE("actor", "light", "Session + profile, then at most 10 stored conversations; checks AI configuration but never calls Anthropic."),
  "PAGE src/app/forecasts/page.tsx": NONE("actor", "light", "Session + profile, then two stored-forecast lists (limit 10 / 20); no forecast computation."),
  "PAGE src/app/notifications/page.tsx": NONE("actor", "light", "Session + profile, then preferences + at most 100 notifications; no evaluation or Resend call."),
  "PAGE src/app/financial-data/[section]/page.tsx": NONE("actor", "light", "Section validated before auth; one page of 20 records (+ up to 101 accounts/transactions for linked sections)."),
  "PAGE src/app/financial-data/profile/page.tsx": NONE("actor", "light", "Re-exports onboarding/profile: session + one profile read."),
  "PAGE src/app/onboarding/profile/page.tsx": NONE("actor", "light", "Session lookup + one profile findOne; nothing else is loaded."),
  "PAGE src/app/onboarding/[section]/page.tsx": NONE("actor", "light", "Section validated before auth; one section list of at most 101 records."),
  "PAGE src/app/open-banking/reconciliation/page.tsx": NONE("actor", "light", "Session + profile only; the review loads on a button click through the LIMITED GET api/open-banking/reconciliation."),
  "PAGE src/app/financial-data/page.tsx": NONE("actor", "moderate", "Session + profile, then the latest snapshot manifest (grows with record count)."),
  "PAGE src/app/debt-strategies/page.tsx": NONE("actor", "moderate", "Session + profile, loans capped at 1,001 and 10 stored strategies; no engine evaluation."),
  "PAGE src/app/goals/page.tsx": NONE("actor", "moderate", "Goal center: 5 lists capped at 50, up to 2,501 definitions, and an N+1 of up to 50 progress lists; ~33 createIndex; no evaluation."),
  "PAGE src/app/net-worth/page.tsx": NONE("actor", "moderate", "Net-worth center (as GET api/net-worth/items): ~9,000 documents worst case; no capture on render.", ["F-18-05-05"]),
  "PAGE src/app/onboarding/review/page.tsx": NONE("actor", "moderate", "Seven section lists of at most 101 records (~22 createIndex), loaded even when the user is then redirected."),
  "PAGE src/app/open-banking/page.tsx": NONE("actor", "moderate", "Stored open-banking center (as GET api/open-banking); never calls Financy on render."),
  "PAGE src/app/progress/page.tsx": NONE("actor", "moderate", "Progress journey (as GET api/progress-journeys): up to 5,001 events; no evaluation.", ["F-18-05-05"]),
  "PAGE src/app/transaction-intelligence/page.tsx": NONE("actor", "moderate", "Categories (200) + latest run + up to 1,000 reviews; no analysis on render."),
  "PAGE src/app/budgets/page.tsx": NONE("actor", "heavy", "Budget view: 5 whole-section loads (up to 10,001 each), corrections over up to 10,000 ids, and recurring-schedule expansion for ?month.", ["F-18-05-05", "F-18-05-12"]),
  "PAGE src/app/dashboard/page.tsx": NONE("actor", "heavy", "Dashboard: goals (up to 10,001) + engine snapshots + freshness check loading 9 whole sections - up to ~100,000 documents validated per render.", ["F-18-05-05"]),
  "PAGE src/app/purchase-simulation/page.tsx": NONE("actor", "heavy", "Simulation center: the same 9-section freshness check as the dashboard (~90,000 documents) and an unindexed horizon query.", ["F-18-05-05"]),
  "PAGE src/app/households/page.tsx": NONE("actor", "heavy", `Household center: ${household}.`, ["F-18-05-05"]),
  "PAGE src/app/reports/page.tsx": NONE("actor", "heavy", "Heaviest page: household center + full current report (goal and net-worth centers) + saved reports with sequential household loads + summaries.", ["F-18-05-05"]),

  // ---- Server actions (POST to the page; the route limiter cannot be applied before Auth.js)
  "ACTION src/app/sign-in/page.tsx": { policy: "authjs", identity: "anonymous", cost: "provider",
    rationale: "Input-free Auth.js signIn('google'): any anonymous POST performs Google OIDC discovery and returns a redirect.", findings: ["F-18-05-08"] },
  "ACTION src/lib/auth/actions.ts": { policy: "authjs", identity: "authjs", cost: "light",
    rationale: "signOutAction: Auth.js deletes only the caller's own session row; at most one delete per request.", findings: [] },
};
