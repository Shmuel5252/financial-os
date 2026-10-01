// Phase 18 row 18-14: authorization/isolation matrix for every API route method and server-action module. Enforced by
// tests/unit/route-authorization-inventory.test.ts (no unclassified/stale entry; every ownership boundary names a negative test
// that exists). "authentication" says who may call at all; "authorization"/"ownership" say whose data the call may touch - a
// session alone is never treated as proof of ownership. Enforcement references are file:line at commit time of this matrix.
export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type Authentication = "public" | "auth-protocol" | "session" | "session+operator-allowlist";
export type Ownership = "none" | "actor" | "actor+household" | "household-role" | "provider-subject-binding" | "operator";
export type IdentifierSource = "path" | "query" | "body" | "nested-body" | "derived";
export type Identifier = Readonly<{ name: string; source: IdentifierSource; enforcement: string }>;
export type RouteEntry = Readonly<{ route: string; method: Method; authentication: Authentication; ownership: Ownership; authorization: string;
  identifiers: readonly Identifier[]; negativeTests: readonly string[] }>;
export type ServerActionEntry = Readonly<{ file: string; authentication: Authentication; ownership: Ownership; authorization: string;
  identifiers: readonly Identifier[]; negativeTests: readonly string[] }>;

const id = (name: string, source: IdentifierSource, enforcement: string): Identifier => ({ name, source, enforcement });
const S = "session"; const U = "iso-unauthenticated"; // every session route is also covered by the anonymous sweep
const cursor = (file: string) => id("cursor (raw 24-hex _id)", "query", `${file}: {_id:{$lt:cursor}, userId} - a foreign id only bounds the actor's own page`);
const actorOnly = "Actor-scoped: every read and write is filtered by the session actor's userId; no client identifier selects another user's data.";
const r = (route: string, method: Method, ownership: Ownership, authorization: string, identifiers: readonly Identifier[], negativeTests: readonly string[],
  authentication: Authentication = S): RouteEntry => ({ route: `api/${route}`, method, authentication, ownership, authorization, identifiers, negativeTests });

export const routeMatrix: readonly RouteEntry[] = [
  // Public and protocol surfaces
  r("health", "GET", "none", "Public static liveness; no database access, no identifiers, no data.", [], [], "public"),
  r("auth/[...nextauth]", "GET", "none", "Auth.js protocol endpoint (session, csrf, providers, callback); session read returns only the caller's own allowlisted fields.",
    [id("session cookie", "derived", "@auth/core getSessionAndUser by sessionToken; src/lib/auth/config.ts session allowlist")], ["iso-session-signout"], "auth-protocol"),
  r("auth/[...nextauth]", "POST", "none", "Auth.js protocol endpoint (sign-in, sign-out with CSRF); sign-out deletes only the caller's session row.",
    [id("session cookie + csrf token", "derived", "@auth/core signout -> adapter.deleteSession(sessionToken); double-submit CSRF")], ["iso-session-signout"], "auth-protocol"),
  // Operator
  r("ops/readiness", "GET", "operator", "Signed-in AND in OPERATIONS_OPERATOR_USER_IDS (read per request); non-operators 403 before any probe; metadata only.",
    [], [U, "iso-operator"], "session+operator-allowlist"),
  r("ops/bindings", "GET", "operator", "Signed-in AND in OPERATIONS_OPERATOR_USER_IDS; fixed binding enums only, never values.", [], [U, "iso-operator"], "session+operator-allowlist"),
  // Profile and self-scoped preferences
  r("profile", "GET", "actor", actorOnly, [], [U, "iso-self-scoped"]),
  r("profile", "PUT", "actor", `${actorOnly} Optimistic version filter {userId, version}.`, [], [U, "iso-self-scoped", "iso-mutation-origin"]),
  r("onboarding/progress", "POST", "actor", "Profile filter {onboarding.currentStep, status, userId, version} (profile-repository.ts:229-234).", [], [U, "iso-self-scoped"]),
  r("notification-preferences", "PUT", "actor", "Filter {userId, version}; insert unique on userId (notification-repository.ts:218-219).", [], [U, "iso-self-scoped"]),
  r("progress-journey-preferences", "PUT", "actor", "Filter {userId, version} (progress-journey-repository.ts:199-226).", [], [U, "iso-self-scoped"]),
  r("progress-journeys", "GET", "actor", actorOnly, [], [U, "iso-self-scoped"]),
  r("progress-journeys", "POST", "actor", `${actorOnly} Sources (goals, budgets, engine, personal monthly reports) are all actor-scoped.`, [], [U, "iso-self-scoped"]),
  r("notifications", "GET", "actor", "listForActor {userId} (notification-repository.ts:232).", [], [U, "iso-self-scoped"]),
  r("notifications", "PATCH", "actor", "Update filter {_id, userId, version}; a foreign id is 404 (notification-repository.ts:349-350).",
    [id("id", "body", "notification-repository.ts:349-350 {_id, userId, version}")], [U, "iso-self-scoped"]),
  r("notifications/evaluate", "POST", "actor", "Loaders take only the actor; recipient e-mail is the actor's server-side authUsers e-mail.", [], [U, "iso-self-scoped"]),
  // Manual records (financial-data and onboarding share manual-record-service/repository)
  ...(["financial-data/[section]", "onboarding/[section]"] as const).flatMap((route) => {
    const test = route.startsWith("financial") ? "iso-financial-data" : "iso-onboarding";
    const section = id("section", "path", "enum parse (manual-record.ts:512-520); selects a collection, never an owner");
    return [
      r(route, "GET", "actor", "List filter {deletedAt:null, userId} (manual-record-repository.ts:284-315).", [section, cursor("manual-record-repository.ts:284-315")], [U, test]),
      r(route, "POST", "actor", "Insert carries the actor's userId; referenced records must be the actor's own.", [section,
        id("fields.accountId / fields.destinationAccountId", "nested-body", "manual-record-service.ts:97-123 existsForActor {_id, deletedAt:null, userId} -> 400"),
        id("fields.refundOfTransactionId", "nested-body", "manual-record-service.ts:126-160 findForActor (owned expense) -> 400")], [U, test, "iso-financial-data"]),
      r(route, "PUT", "actor", "Write filter {_id, deletedAt:null, source manual, userId, version} -> 409 for another user's id.", [section,
        id("id", "body", "manual-record-repository.ts:451-483"), id("fields.* references", "nested-body", "as POST (manual-record-service.ts)")], [U, test]),
      r(route, "DELETE", "actor", "Soft-delete filter {_id, deletedAt:null, source manual, userId, version} -> 409.", [section,
        id("id", "body", "manual-record-repository.ts:489-524")], [U, test]),
    ];
  }),
  r("financial-data/export", "GET", "actor", "Every exported source is read with {userId} (financial-data-export-service.ts:144-207).", [], [U, "iso-export"]),
  r("financial-data/snapshots", "GET", "actor", "{_id:{$lt}?, kind:source_manifest, userId} (financial-snapshot-repository.ts:171-185).",
    [cursor("financial-snapshot-repository.ts:171-185")], [U, "iso-snapshots"]),
  r("financial-data/snapshots", "POST", "actor", "Sources from actor-scoped lists; idempotency {hash, kind, userId}.", [], [U, "iso-snapshots"]),
  r("financial-engine/snapshots", "GET", "actor", "{_id:{$lt}?, kind:engine_result, userId} (financial-engine-snapshot-repository.ts:241-245).",
    [cursor("financial-engine-snapshot-repository.ts:241-245")], [U, "iso-snapshots"]),
  r("financial-engine/snapshots", "POST", "actor", "Sources actor-scoped; manifest re-checked {_id, kind, userId} (repository :147-159).",
    [id("sourceManifestId", "derived", "financial-engine-snapshot-repository.ts:147-159 countDocuments {_id, kind:source_manifest, userId} -> 409")], [U, "iso-snapshots"]),
  // Budgets
  r("budgets/categories", "POST", "actor", "Insert carries userId; limit and idempotency keyed by {userId}.", [], [U, "iso-budgets"]),
  r("budgets/categories", "PUT", "actor", "findCategoryForActor {categoryId, userId} -> 409; update {categoryId, userId, version}.",
    [id("categoryId", "body", "budget-service.ts:578-584, budget-repository.ts:345-348 and 456-507")], [U, "iso-budgets"]),
  r("budgets/periods", "PUT", "actor", "Allocation categories must be in the actor's own category list -> 400; period filters include userId.",
    [id("allocations[].categoryId", "nested-body", "budget-service.ts:618-627 listCategoriesForActor {userId}"),
      id("calendarMonth", "body", "budget-repository.ts:535-622 {calendarMonth, userId[, status, version]}")], [U, "iso-budgets"]),
  r("budgets/periods", "POST", "actor", "Close filter {calendarMonth, status:open, userId, version} -> 409.",
    [id("calendarMonth", "body", "budget-repository.ts:662-677")], [U, "iso-budgets"]),
  r("budgets/corrections", "POST", "actor", "Transaction and target category must be the actor's own -> 400; corrections keyed by userId.",
    [id("transactionId", "body", "budget-service.ts:773-781 findForActor {_id, deletedAt:null, userId}"),
      id("toCategoryId", "body", "budget-service.ts:794-806 findCategoryForActor"), id("refundOfTransactionId", "derived", "budget-service.ts:817-824 findForActor")],
    [U, "iso-budgets"]),
  r("budgets/scenarios", "POST", "actor", "Uses only the actor's latest engine snapshot {kind:engine_result, userId}; no identifiers.", [], [U, "iso-budgets"]),
  // Debt strategies
  r("debt-strategies/evaluate", "POST", "actor", "Every debtTerms[].loanId must be in the actor's own loans -> 404; customPriority must match them.",
    [id("debtTerms[].loanId", "nested-body", "debt-strategy-service.ts:65-74 listAllForActor(loans) {deletedAt:null, userId}"),
      id("customPriority[]", "nested-body", "debt-strategy-engine.ts:336-339 must equal the owned debt ids")], [U, "iso-debt-strategies"]),
  r("debt-strategies", "GET", "actor", "{_id:{$lt}?, userId} (debt-strategy-repository.ts:183-187).", [cursor("debt-strategy-repository.ts:183-187")], [U, "iso-debt-strategies"]),
  r("debt-strategies", "POST", "actor", "As evaluate, plus a versioned re-check of every loan {_id, version, deletedAt:null, userId} -> 409.",
    [id("debtTerms[].loanId", "nested-body", "debt-strategy-service.ts:65-74 and debt-strategy-repository.ts:139-145")], [U, "iso-debt-strategies"]),
  // Forecasts
  r("forecasts", "GET", "actor", "listForecasts/listScenariosForActor {userId} (forecast-repository.ts:306-316).", [], [U, "iso-forecasts"]),
  r("forecasts", "POST", "actor", "Baseline engine, manifest, intelligence run and review decisions are actor-scoped and re-checked (forecast-repository.ts:191-206).",
    [id("baseline engine / run ids", "derived", "forecast-repository.ts:191-206 {_id, kind, userId} -> 409")], [U, "iso-forecasts"]),
  r("forecast-scenarios", "POST", "actor", "forecastId must be the actor's own -> 404; repository re-check -> 409.",
    [id("forecastId", "body", "forecast-service.ts:188-189 findForecastForActor {_id, userId}; forecast-repository.ts:252-253")], [U, "iso-forecasts"]),
  // Goals
  r("goals/definitions", "POST", "actor", "Goal record and every scoped record id must be the actor's own (409/400); category ids only filter the actor's budget data.",
    [id("goalId", "body", "goal-service.ts:537-539 goals.findForActor -> 409"),
      id("configuration.{liabilityIds,accountIds,cardIds,fundScope.recordIds}", "nested-body", "goal-service.ts:105-117 scopedRecords vs listAllForActor -> 400"),
      id("configuration.{essentialCategoryIds,categoryIds}", "nested-body", "goal-service.ts:245-248, 362-372: filter only the actor's own budget lines")],
    [U, "iso-goals"]),
  r("goals/evaluations", "POST", "actor", "Latest definition {goalId, userId} -> 409; stored scope re-checked at evaluation.",
    [id("goalId", "body", "goal-service.ts:597-598, goal-repository.ts:278-284")], [U, "iso-goals"]),
  // Net worth
  r("net-worth/items", "GET", "actor", "All sources {deletedAt:null, userId} (net-worth repository :251-256); household shares never appear.", [], [U, "iso-net-worth"]),
  r("net-worth/items", "POST", "actor", "relationship.accountId / recordId must be the actor's own -> 404.",
    [id("fields.relationship.accountId", "nested-body", "net-worth-repository.ts:169-179 accounts {_id, deletedAt:null, userId}"),
      id("fields.relationship.recordId", "nested-body", "net-worth-repository.ts:169-179 loans/creditCards {_id, deletedAt:null, userId}")], [U, "iso-net-worth"]),
  r("net-worth/items", "PATCH", "actor", "Relationships re-checked; update filter {_id, deletedAt:null, userId, version} -> 409.",
    [id("id", "body", "net-worth-repository.ts:225"), id("fields.relationship.*", "nested-body", "net-worth-repository.ts:169-179")], [U, "iso-net-worth"]),
  r("net-worth/items", "DELETE", "actor", "Filter {_id, deletedAt:null, userId, version} -> 409.", [id("id", "body", "net-worth-repository.ts:241")], [U, "iso-net-worth"]),
  r("net-worth/snapshots", "GET", "actor", "{_id:{$lt}?, userId} (net-worth-repository.ts:297-300).", [cursor("net-worth-repository.ts:297-300")], [U, "iso-net-worth"]),
  r("net-worth/snapshots", "POST", "actor", "Captures the actor's own statement only.", [], [U, "iso-net-worth"]),
  // Purchase simulations
  r("purchase-simulations/evaluate", "POST", "actor", "sourceSnapshotId must be the actor's engine result -> 404; budget period derived by {calendarMonth, userId}.",
    [id("sourceSnapshotId", "body", "purchase-simulation-service.ts:157-163, financial-engine-snapshot-repository.ts:262-271"),
      id("budget period", "derived", "findPeriodForActor {calendarMonth, userId}")], [U, "iso-purchase-simulations"]),
  r("purchase-simulations", "GET", "actor", "{_id:{$lt}?, userId} (purchase-simulation-repository.ts:279-281).", [cursor("purchase-simulation-repository.ts:279-281")],
    [U, "iso-purchase-simulations"]),
  r("purchase-simulations", "POST", "actor", "As evaluate plus repository re-checks {_id, kind, userId} and {_id, calendarMonth, userId, version} -> 409.",
    [id("sourceSnapshotId", "body", "purchase-simulation-repository.ts:152-190")], [U, "iso-purchase-simulations"]),
  // Transaction intelligence
  r("transaction-intelligence/runs", "GET", "actor", "latestRunForActor {userId}.", [], [U, "iso-transaction-intelligence"]),
  r("transaction-intelligence/runs", "POST", "actor", "Inputs are the actor's own transactions; idempotency {hash, userId}.", [], [U, "iso-transaction-intelligence"]),
  r("transaction-intelligence/reviews", "POST", "actor", "runId must be the actor's run (400 'signal unavailable'); signalId must belong to that run.",
    [id("runId", "body", "transaction-intelligence-repository.ts:439-447 findRunForActor {_id, userId}"),
      id("signalId", "body", "transaction-intelligence-service.ts:243 inside the actor's run only"),
      id("signal.transactionId", "derived", "createBudgetCorrection -> findForActor (actor-scoped)")], [U, "iso-transaction-intelligence"]),
  // AI
  r("ai/conversations", "GET", "actor", "listForActor {userId} (ai-conversation-repository.ts:178-185).", [], [U, "iso-ai"]),
  r("ai/conversations", "POST", "actor", "Continuing requires the actor's conversation {_id, userId} -> 404 before any context build or provider call.",
    [id("conversationId", "body", "ai-service.ts:84, ai-conversation-repository.ts:170-176 and append filter :152-158"),
      id("engine/purchase/goal/budget context", "derived", "ai context loaders, all actor-scoped")], [U, "iso-ai"]),
  r("ai/conversations/[conversationId]", "DELETE", "actor", "Filter {_id, userId, version} -> 404.",
    [id("conversationId", "path", "ai-service.ts:175-178, ai-conversation-repository.ts:192-197")], [U, "iso-ai"]),
  // Reports, summaries, search
  r("reports", "GET", "actor+household", "Personal: actor-scoped sources. Household: CURRENT principal (owner or active member) and CURRENT shares only -> 404 for outsiders/removed.",
    [id("householdId (scopeKind=household)", "query", "report-service.ts:102-115 -> loadHouseholdCenter -> requirePrincipal (household-service.ts:100-111)"),
      id("saved report list", "derived", "report-service.ts:143-150 re-authorizes every item")], [U, "iso-reports", "iso-household-outsider", "iso-household-removal"]),
  r("reports", "POST", "actor+household", "Close/restate: household scope authorized before write; supersedesId must be the actor's authorized report -> 404.",
    [id("scope.householdId", "nested-body", "report-service.ts build -> loadHouseholdCenter"), id("supersedesId", "body", "findSavedReport {_id, hiddenAt:null, userId} + authorization")],
    [U, "iso-reports", "iso-household-outsider"]),
  r("reports/[reportId]", "GET", "actor+household", "{_id, hiddenAt:null, userId} plus re-authorization of household scope and share fingerprint on every read -> 404.",
    [id("reportId", "path", "report-service.ts:130-141, report-repository.ts:139-142")], [U, "iso-reports", "iso-household-unshare", "iso-household-removal"]),
  r("reports/[reportId]", "DELETE", "actor", "findSavedReport, then hide {_id, hiddenAt:null, userId, version}.", [id("reportId", "path", "report-repository.ts:149-156")],
    [U, "iso-reports"]),
  r("reports/export", "GET", "actor+household", "snapshotId through findSavedReport (re-authorized) or a current report with the same household authorization.",
    [id("snapshotId", "query", "report-service.ts findSavedReport"), id("householdId (scopeKind=household)", "query", "loadHouseholdCenter")],
    [U, "iso-reports", "iso-household-outsider", "iso-household-unshare", "iso-household-removal"]),
  r("report-summaries", "GET", "actor", "findSavedReport (404) then {deletedAt:null, reportId, userId}.", [id("reportId", "query", "report-summary-service.ts listReportAiSummaries")],
    [U, "iso-report-summaries"]),
  r("report-summaries", "POST", "actor", "findSavedReport (404) before any provider call; summary keyed by userId.", [id("reportId", "body", "report-summary-service.ts:45")],
    [U, "iso-report-summaries"]),
  r("report-summaries/[summaryId]", "DELETE", "actor", "Parent report authorized (404), summary must be in the actor's list for it (409), delete {_id, userId, version}.",
    [id("summaryId", "path", "report-summary-service.ts:58-61"), id("reportId", "query", "findSavedReport")], [U, "iso-report-summaries"]),
  r("search", "GET", "actor+household", "Personal: actor's own index {userId} plus per-hit re-validation (ai_summary hits: see finding F-18-14-01). Household: current principal + shares.",
    [id("cursor (signed to the query)", "query", "search-service.ts:28-35"), id("householdId (scopeKind=household)", "query", "loadHouseholdCenter")],
    [U, "iso-search", "iso-household-outsider", "iso-household-removal"]),
  r("search", "POST", "actor", "Rebuild reads only the actor's data and authorized reports; deleteMany/insertMany by {userId}.", [], [U, "iso-search"]),
  // Households
  r("households", "GET", "household-role", "Lists only households where the actor is owner or ACTIVE member (household-repository.ts:417-439).", [], [U, "iso-household-outsider", "iso-household-removal"]),
  r("households", "POST", "actor", "Creates a household owned by the actor; idempotency keyed by owner.", [], [U]),
  r("households/[householdId]", "GET", "household-role", "requirePrincipal(view): owner or ACTIVE member of an ACTIVE household, checked per request -> 404.",
    [id("householdId", "path", "household-service.ts:100-111, household-repository.ts:441-468"), id("shared resources", "derived", "household-service.ts:236-311 current shares + epoch")],
    [U, "iso-household-outsider", "iso-household-member-role", "iso-household-unshare", "iso-household-removal", "iso-household-dissolve"]),
  r("households/[householdId]", "PATCH", "household-role", "Owner only (manage_settings) -> 404; filter {_id, ownerUserId, status, version}.",
    [id("householdId", "path", "household-service.ts:360, household-repository.ts:478-483")], [U, "iso-household-outsider", "iso-household-member-role"]),
  r("households/[householdId]", "DELETE", "household-role", "Owner only (dissolve) -> 404; filter {_id, ownerUserId, status, version}.",
    [id("householdId", "path", "household-service.ts:380, household-repository.ts:511-516")], [U, "iso-household-outsider", "iso-household-member-role", "iso-household-dissolve"]),
  r("households/[householdId]/invitations", "POST", "household-role", "Owner only (invite) -> 404.", [id("householdId", "path", "household-service.ts:391")],
    [U, "iso-household-outsider", "iso-household-member-role"]),
  r("households/[householdId]/invitations/[invitationId]", "DELETE", "household-role", "Owner only; filter {_id, householdId, status:pending, version}.",
    [id("householdId", "path", "requirePrincipal(revoke_invitation)"), id("invitationId", "path", "household-repository.ts revokeInvitation {_id, householdId, status:pending}")],
    [U, "iso-household-outsider", "iso-household-member-role"]),
  r("households/[householdId]/members/[membershipId]", "DELETE", "household-role", "Owner only; membership must belong to this household and be active.",
    [id("householdId", "path", "requirePrincipal(remove_member)"), id("membershipId", "path", "household-repository.ts:567-570 {_id, householdId}")],
    [U, "iso-household-outsider", "iso-household-member-role", "iso-household-removal"]),
  r("households/[householdId]/leave", "POST", "household-role", "Active member only (owner/outsider -> 404); membership {householdId, status:active, userId}.",
    [id("householdId", "path", "household-service.ts:518-522")], [U, "iso-household-outsider", "iso-household-rejoin-left"]),
  r("households/[householdId]/shares", "POST", "household-role", "Principal required; the resource must be the ACTOR's own (account/goal) -> 404; share owner check -> 409.",
    [id("householdId", "path", "requirePrincipal(share_own_resource)"),
      id("resourceId + resourceKind", "body", "household-service.ts:533-547 validateOwnedResource {_id, deletedAt:null, userId}; repository setShare ownerUserId")],
    [U, "iso-household-outsider", "iso-household-member-role", "iso-household-removal"]),
  r("households/invitations/accept", "POST", "household-role", "Token bound to the invitee's e-mail; pending and unexpired; an ACCEPTED token can never restore an ended membership (W1, fixed).",
    [id("token", "body", "household-service.ts:418-470 (tokenHash lookup, email binding, expiry, spent-token rule)"),
      id("invitation.householdId", "derived", "household must be active; activateMembership atomic per invitation (household-repository.ts:643-645)")],
    [U, "iso-household-outsider", "iso-household-rejoin-removed", "iso-household-rejoin-left", "iso-household-rejoin-older-token",
      "iso-household-rejoin-race", "iso-household-reaccept-active", "iso-household-accept-recovery"]),
  // Open banking (single configured provider subject)
  r("open-banking", "GET", "actor", "Center filtered by {userId, provider}; does not require a binding and shows only the actor's history.", [], [U, "iso-open-banking"]),
  r("open-banking/claim", "POST", "provider-subject-binding", "Binds the configured provider subject to the FIRST claimant only (unique); others 403 (design: finding F-18-14-02).",
    [id("configured subject alias", "derived", "open-banking-service.ts:77-85; open-banking-repository.ts:315-338 claimBinding")], [U, "iso-open-banking"]),
  r("open-banking/sync", "POST", "provider-subject-binding", "assertBinding {provider, subjectAlias, userId} -> 403 before any provider call; writes by userId.",
    [id("binding", "derived", "open-banking-repository.ts:345-352")], [U, "iso-open-banking"]),
  r("open-banking/refresh", "POST", "provider-subject-binding", "Capability control, then assertBinding -> 403.", [id("binding", "derived", "open-banking-repository.ts:345-352")],
    [U, "iso-open-banking"]),
  r("open-banking/disconnect", "POST", "provider-subject-binding", "assertBinding -> 403; connectionId {_id, userId, provider} -> 404.",
    [id("connectionId", "body", "open-banking-repository.ts:779 connectionById"), id("binding", "derived", "open-banking-repository.ts:345-352")], [U, "iso-open-banking"]),
  r("open-banking/reconciliation", "GET", "provider-subject-binding", "assertBinding before any provider read; legacy data {userId}.", [id("binding", "derived", "account-reconciliation service :31-32")],
    [U, "iso-open-banking"]),
  r("open-banking/reconciliation", "POST", "provider-subject-binding", "assertBinding; legacyKey is an HMAC of the actor's own legacy row; recordDecision re-reads {_id, userId, version}.",
    [id("legacyKey / candidateKey / reviewToken", "body", "account reconciliation service and repository :124-128"), id("binding", "derived", "assertBinding")],
    [U, "iso-open-banking"]),
];

export const serverActionMatrix: readonly ServerActionEntry[] = [
  { file: "src/app/sign-in/page.tsx", authentication: "auth-protocol", ownership: "none", identifiers: [], negativeTests: [],
    authorization: "Inline server action without input: starts Google sign-in (Auth.js) when authentication is configured; acts on no stored data." },
  { file: "src/lib/auth/actions.ts", authentication: "auth-protocol", ownership: "none", identifiers: [id("session cookie", "derived", "Auth.js signOut -> adapter.deleteSession")],
    negativeTests: ["iso-session-signout"], authorization: "signOutAction: Auth.js signOut deletes only the caller's own session row (src/lib/auth/actions.ts:5-7)." },
];
