// Phase 18 row 18-14: negative authorization/isolation tests through the REAL route handlers, services and repositories on an
// isolated loopback MongoDB database (synthetic data only). A refused attempt must disclose nothing of the victim and change no
// state (database fingerprint identical apart from rate-limit counters); an allowed request by another user must disclose
// nothing of the victim and leave every victim-owned document unchanged. Test ids in [brackets] are referenced by
// tests/security/route-authorization-matrix.ts and enforced by tests/unit/route-authorization-inventory.test.ts.
import { randomBytes, randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, call, expectIsolated, expectRefused, marker, newActor, openHarness, type Called, type Harness } from "../security/route-harness";

vi.mock("@/lib/auth/actor", async () => (await import("../security/route-harness")).mockedActorModule());

const uri = process.env.MONGODB_TEST_URI;
const profile = { countryCode: "IL", displayName: "Synthetic", expectedVersion: null, householdType: "single", primaryCurrency: "ILS", timeZone: "Asia/Jerusalem" };
const ils = (amount: string) => ({ amount, currency: "ILS" });
const hex64 = () => randomBytes(32).toString("hex");
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- parsed test-response JSON, navigated by the assertions below
const ok = (response: Called, status = 200) => { expect(response.status, response.text.slice(0, 300)).toBe(status); return response.json as Record<string, any>; };
const debtTerm = (loanId: string) => ({ allocationOrder: null, fees: [], feesKnown: false, feesProvenance: null, firstPaymentDate: "2026-11-01",
  interest: { kind: "unknown" }, loanId, minimumPayment: { kind: "unknown" }, prepayment: { kind: "unknown" } });

(uri ? describe : describe.skip)("authorization and isolation through real routes (18-14)", () => {
  let h: Harness;
  const victim = newActor(); const attacker = newActor();
  const m = { account: marker("v-account"), merchant: marker("v-merchant"), loan: marker("v-loan"), goal: marker("v-goal"),
    category: marker("v-category"), item: marker("v-networth"), debt: marker("v-debt"), purchase: marker("v-purchase"),
    question: marker("v-question"), summary: marker("v-summary"), notification: marker("v-notification") };
  const markers = () => Object.values(m);
  type Seeded = "account" | "transaction" | "loan" | "goal" | "category" | "engine" | "manifest" | "forecast" | "item" | "run" | "conversation" | "report" | "summary" | "notification";
  const v = {} as Record<Seeded, string>;

  beforeAll(async () => {
    h = await openHarness(uri!);
    for (const actor of [victim, attacker]) { actAs(actor); ok(await call("profile", "PUT", { body: profile })); }
    actAs(victim);
    const post = async (section: string, fields: unknown) =>
      ok(await call("financial-data/[section]", "POST", { params: { section }, body: { idempotencyKey: randomUUID(), fields } }), 201).record.id as string;
    v.account = await post("accounts", { balance: ils("5000.00"), name: m.account, type: "bank" });
    v.transaction = await post("transactions", { accountId: v.account, amount: ils("120.00"), category: "food", confidenceBps: 10_000, date: "2026-09-05",
      destinationAccountId: null, merchant: m.merchant, notes: null, recurring: false, type: "expense" });
    await post("transactions", { accountId: v.account, amount: ils("120.00"), category: "food", confidenceBps: 10_000, date: "2026-09-05",
      destinationAccountId: null, merchant: m.merchant, notes: null, recurring: false, type: "expense" }); // duplicate: gives the victim's run a real signal
    v.loan = await post("loans", { annualInterestRateBps: 500, endDate: null, monthlyPayment: ils("100.00"), name: m.loan, nextPaymentDate: "2026-11-01",
      originalAmount: ils("1000.00"), remainingBalance: ils("800.00") });
    v.goal = await post("goals", { currentValue: ils("10.00"), priority: 1, startingValue: ils("0.00"), targetAmount: ils("100.00"), targetDate: "2027-06-30",
      title: m.goal, type: "custom" });
    v.category = ok(await call("budgets/categories", "POST", { body: { idempotencyKey: randomUUID(), label: m.category, rolloverPolicy: "reset" } }), 201).category.categoryId;
    ok(await call("budgets/periods", "PUT", { body: { allocations: [{ amount: ils("50.00"), categoryId: v.category }], calendarMonth: "2020-01", expectedVersion: null } }));
    v.engine = ok(await call("financial-engine/snapshots", "POST", { body: { idempotencyKey: randomUUID(), horizonDays: 366 } }), 201).snapshot.id;
    v.manifest = ok(await call("financial-data/snapshots", "POST", { body: { idempotencyKey: randomUUID() } }), 201).snapshot.id;
    v.forecast = ok(await call("forecasts", "POST", { body: { horizonDays: 30, idempotencyKey: randomUUID() } }), 201).forecast.id;
    v.item = ok(await call("net-worth/items", "POST", { body: { idempotencyKey: randomUUID(), fields: { amount: ils("300.00"), category: "other_asset",
      effectiveAt: "2026-09-01T00:00:00.000Z", label: m.item, provenanceNote: null, relationship: { kind: "standalone" }, side: "asset", valuationType: "user_estimate" } } }), 201).item.id;
    ok(await call("debt-strategies", "POST", { body: { customPriority: [v.loan], debtTerms: [debtTerm(v.loan)], extraPayment: ils("10.00"), extraPaymentStartDate: "2026-11-01",
      idempotencyKey: randomUUID(), name: m.debt } }), 201);
    ok(await call("purchase-simulations", "POST", { body: { charges: [], idempotencyKey: randomUUID(), inputMode: "one_time", installmentCount: 1,
      name: m.purchase, proposedDate: "2026-10-15", sourceSnapshotId: v.engine, totalPurchasePrice: ils("40.00") } }), 201);
    v.run = ok(await call("transaction-intelligence/runs", "POST", { body: { idempotencyKey: randomUUID() } }), 201).run.id;
  }, 120_000);
  afterAll(async () => { actAs(null); await h?.dispose(); });

  // Batch 2 seeds: an AI conversation and a report summary created through the real services with a fake provider (no network),
  // a closed personal report, and the victim's search index.
  const fakeProvider = (refs: readonly string[]) => ({ generate: async () => ({ model: "synthetic-model", provider: "anthropic" as const,
    response: { fact: [{ evidenceRefs: [refs[0]!], text: m.summary }], insight: [], recommendation: [] }, usage: { inputTokens: 1, outputTokens: 1 } }) });
  beforeAll(async () => {
    actAs(victim);
    const { sendAiMessage } = await import("@/lib/ai/ai-service");
    v.conversation = (await sendAiMessage(victim, { focus: "safe_to_spend", includeRecentHistory: false, question: m.question },
      { provider: fakeProvider(["engine.safe_to_spend"]) as never })).id;
    v.report = ok(await call("reports", "POST", { body: { action: "close", idempotencyKey: randomUUID(), period: { kind: "month", value: "2026-09" },
      scope: { kind: "personal" } } }), 201).report.id;
    const { generateReportAiSummary } = await import("@/lib/reports/report-summary-service");
    v.summary = (await generateReportAiSummary(victim, { expectedSummaryVersion: null, idempotencyKey: randomUUID(), reportId: v.report },
      { provider: fakeProvider(["report.fact.1"]) as never })).id;
    ok(await call("search", "POST", { body: { confirm: true } }));
    const { notificationRepositoryForDatabase } = await import("@/lib/notifications/notification-repository");
    v.notification = (await notificationRepositoryForDatabase(h.db).createForActor(victim, { allowQuietHoursBypass: false, conditionFingerprint: hex64(),
      cooldownKey: hex64(), deduplicationKey: hex64(), messageKey: "budget_deficit", policyVersion: "notification-policy-v1", severity: "WARNING",
      severityVersion: "notification-severity-v1", sourceKind: "budget", sourceReference: m.notification, sourceVersion: "1", targetPath: "/budgets", trigger: "budget_deficit" },
      { notBeforeAt: null, state: "not_requested" })).notification.id;
  }, 120_000);

  it("[iso-financial-data] manual records: lists, cursors, update, delete and nested account/refund references stay with their owner", async () => {
    actAs(attacker);
    for (const section of ["accounts", "transactions", "loans", "goals"]) {
      await expectIsolated(h.db, () => call("financial-data/[section]", "GET", { params: { section } }), victim.userId, markers());
      await expectIsolated(h.db, () => call("financial-data/[section]", "GET", { params: { section }, query: { cursor: "f".repeat(24) } }), victim.userId, markers());
    }
    await expectRefused(h.db, () => call("financial-data/[section]", "PUT", { params: { section: "accounts" },
      body: { id: v.account, expectedVersion: 1, fields: { balance: ils("1.00"), name: "taken", type: "bank" } } }), markers());
    await expectRefused(h.db, () => call("financial-data/[section]", "DELETE", { params: { section: "accounts" }, body: { id: v.account, expectedVersion: 1 } }), markers());
    const own = ok(await call("financial-data/[section]", "POST", { params: { section: "accounts" },
      body: { idempotencyKey: randomUUID(), fields: { balance: ils("1.00"), name: "attacker account", type: "bank" } } }), 201).record.id as string;
    const tx = (extra: Record<string, unknown>) => ({ accountId: own, amount: ils("1.00"), category: "food", confidenceBps: 10_000, date: "2026-09-06",
      destinationAccountId: null, merchant: null, notes: null, recurring: false, type: "expense", ...extra });
    await expectRefused(h.db, () => call("financial-data/[section]", "POST", { params: { section: "transactions" },
      body: { idempotencyKey: randomUUID(), fields: tx({ accountId: v.account }) } }), markers(), [400]);
    await expectRefused(h.db, () => call("financial-data/[section]", "POST", { params: { section: "transactions" },
      body: { idempotencyKey: randomUUID(), fields: tx({ refundOfTransactionId: v.transaction, type: "refund" }) } }), markers(), [400]);
    await expectRefused(h.db, () => call("financial-data/[section]", "POST", { params: { section: "transactions" },
      body: { idempotencyKey: randomUUID(), fields: tx({ destinationAccountId: v.account, type: "transfer", category: "transfer" }) } }), markers(), [400]);
  });

  it("[iso-onboarding] onboarding sections read and change only the actor's own records", async () => {
    actAs(attacker);
    await expectIsolated(h.db, () => call("onboarding/[section]", "GET", { params: { section: "accounts" } }), victim.userId, markers());
    await expectRefused(h.db, () => call("onboarding/[section]", "PUT", { params: { section: "accounts" },
      body: { id: v.account, expectedVersion: 1, fields: { balance: ils("1.00"), name: "taken", type: "bank" } } }), markers());
    await expectRefused(h.db, () => call("onboarding/[section]", "DELETE", { params: { section: "accounts" }, body: { id: v.account, expectedVersion: 1 } }), markers());
    await expectIsolated(h.db, () => call("onboarding/[section]", "POST", { params: { section: "accounts" },
      body: { idempotencyKey: randomUUID(), fields: { balance: ils("2.00"), name: "attacker onboarding", type: "bank" } } }), victim.userId, markers());
  });

  it("[iso-export] the full data export contains only the actor's data", async () => {
    actAs(attacker);
    const exported = await expectIsolated(h.db, () => call("financial-data/export", "GET"), victim.userId, markers());
    for (const id of Object.values(v)) expect(exported.text).not.toContain(id);
  });

  it("[iso-snapshots] source manifests and engine results: lists, cursors and new captures use only the actor's sources", async () => {
    actAs(attacker);
    for (const route of ["financial-data/snapshots", "financial-engine/snapshots"]) {
      const listed = await expectIsolated(h.db, () => call(route, "GET"), victim.userId, markers());
      expect(listed.text).not.toContain(v.engine); expect(listed.text).not.toContain(v.manifest);
      await expectIsolated(h.db, () => call(route, "GET", { query: { cursor: "f".repeat(24) } }), victim.userId, markers());
    }
    const manifest = await expectIsolated(h.db, () => call("financial-data/snapshots", "POST", { body: { idempotencyKey: randomUUID() } }), victim.userId, markers());
    expect(manifest.text).not.toContain(v.account);
    await expectIsolated(h.db, () => call("financial-engine/snapshots", "POST", { body: { idempotencyKey: randomUUID(), horizonDays: 30 } }), victim.userId, markers());
  });

  it("[iso-budgets] budget categories, periods, closes, corrections and scenarios never reach another user's records", async () => {
    actAs(attacker);
    await expectRefused(h.db, () => call("budgets/categories", "PUT", { body: { categoryId: v.category, expectedVersion: 1, hidden: true, label: "taken",
      rolloverPolicy: "carry", sortOrder: 1 } }), markers());
    await expectRefused(h.db, () => call("budgets/periods", "PUT", { body: { allocations: [{ amount: ils("1.00"), categoryId: v.category }],
      calendarMonth: "2020-02", expectedVersion: null } }), markers(), [400]);
    await expectRefused(h.db, () => call("budgets/periods", "POST", { body: { calendarMonth: "2020-01", expectedVersion: 1 } }), markers());
    await expectRefused(h.db, () => call("budgets/corrections", "POST", { body: { idempotencyKey: randomUUID(), reason: "taking it", toCategoryId: "system:food",
      transactionId: v.transaction } }), markers(), [400]);
    // A valid scenario runs on the attacker's OWN latest engine snapshot (created earlier in this suite), never the victim's.
    const scenario = await expectIsolated(h.db, () => call("budgets/scenarios", "POST", { body: { additionalExpense: ils("0.00"), additionalIncome: ils("0.00"),
      expenseReduction: ils("0.00"), investmentProceeds: ils("0.00"), targetBalance: null, uncertainIncome: ils("0.00") } }), victim.userId, markers());
    expect(scenario.text).not.toContain(v.engine);
    await expectIsolated(h.db, () => call("budgets/categories", "POST", { body: { idempotencyKey: randomUUID(), label: "attacker category", rolloverPolicy: "reset" } }),
      victim.userId, markers());
  });

  it("[iso-debt-strategies] loans named in debt terms must be the actor's own; saved strategies stay private", async () => {
    actAs(attacker);
    const body = { customPriority: [v.loan], debtTerms: [debtTerm(v.loan)], extraPayment: ils("1.00"), extraPaymentStartDate: "2026-11-01" };
    await expectRefused(h.db, () => call("debt-strategies/evaluate", "POST", { body }), markers(), [404]);
    await expectRefused(h.db, () => call("debt-strategies", "POST", { body: { ...body, idempotencyKey: randomUUID(), name: "taken" } }), markers(), [404]);
    await expectIsolated(h.db, () => call("debt-strategies", "GET"), victim.userId, markers());
    await expectIsolated(h.db, () => call("debt-strategies", "GET", { query: { cursor: "f".repeat(24) } }), victim.userId, markers());
  });

  it("[iso-forecasts] forecasts list only the actor's; a scenario cannot be built on another user's forecast", async () => {
    actAs(attacker);
    const center = await expectIsolated(h.db, () => call("forecasts", "GET"), victim.userId, markers());
    expect(center.text).not.toContain(v.forecast);
    await expectRefused(h.db, () => call("forecast-scenarios", "POST", { body: { adjustments: [{ amount: ils("1.00"), calendarDate: "2026-10-20",
      kind: "additional_expense" }], forecastId: v.forecast, idempotencyKey: randomUUID(), name: "taken", note: null } }), markers(), [404]);
    // The attacker's own forecast (built on the attacker's own engine snapshot) must not reference the victim's sources.
    const own = await expectIsolated(h.db, () => call("forecasts", "POST", { body: { horizonDays: 30, idempotencyKey: randomUUID() } }), victim.userId, markers());
    for (const id of [v.engine, v.forecast, v.run]) expect(own.text).not.toContain(id);
  });

  it("[iso-goals] goal definitions and evaluations cannot target another user's goal", async () => {
    actAs(attacker);
    await expectRefused(h.db, () => call("goals/definitions", "POST", { body: { configuration: { direction: "increase", kind: "custom", metricLabel: "taken",
      targetAmount: ils("100.00") }, expectedDefinitionVersion: null, expectedGoalRecordVersion: 1, goalId: v.goal, idempotencyKey: randomUUID(), targetDate: "2027-06-30" } }),
      markers());
    await expectRefused(h.db, () => call("goals/evaluations", "POST", { body: { goalId: v.goal, idempotencyKey: randomUUID() } }), markers());
  });

  it("[iso-net-worth] net-worth items, relationships and snapshots stay with their owner", async () => {
    actAs(attacker);
    const center = await expectIsolated(h.db, () => call("net-worth/items", "GET"), victim.userId, markers());
    expect(center.text).not.toContain(v.item);
    const fields = (relationship: unknown, extra: Record<string, unknown> = {}) => ({ amount: ils("1.00"), category: "investment", effectiveAt: "2026-09-02T00:00:00.000Z",
      label: "taken", provenanceNote: null, relationship, side: "asset", valuationType: "market_value", ...extra });
    await expectRefused(h.db, () => call("net-worth/items", "POST", { body: { idempotencyKey: randomUUID(),
      fields: fields({ accountId: v.account, aggregationMode: "detail_authoritative", kind: "account_detail" }) } }), markers(), [404]);
    await expectRefused(h.db, () => call("net-worth/items", "POST", { body: { idempotencyKey: randomUUID(), fields: fields({ kind: "liability_evidence", recordId: v.loan,
      recordKind: "loan" }, { category: "loan", side: "liability", valuationType: "outstanding_balance" }) } }), markers(), [404]);
    await expectRefused(h.db, () => call("net-worth/items", "PATCH", { body: { id: v.item, expectedVersion: 1, fields: fields({ kind: "standalone" },
      { category: "other_asset", valuationType: "user_estimate" }) } }), markers());
    await expectRefused(h.db, () => call("net-worth/items", "DELETE", { body: { id: v.item, expectedVersion: 1 } }), markers());
    await expectIsolated(h.db, () => call("net-worth/snapshots", "GET"), victim.userId, markers());
    await expectIsolated(h.db, () => call("net-worth/snapshots", "GET", { query: { cursor: "f".repeat(24) } }), victim.userId, markers());
    await expectIsolated(h.db, () => call("net-worth/snapshots", "POST", { body: {} }), victim.userId, markers());
  });

  it("[iso-purchase-simulations] a purchase cannot be evaluated or saved on another user's engine snapshot", async () => {
    actAs(attacker);
    const body = { charges: [], inputMode: "one_time", installmentCount: 1, proposedDate: "2026-10-15", sourceSnapshotId: v.engine, totalPurchasePrice: ils("1.00") };
    await expectRefused(h.db, () => call("purchase-simulations/evaluate", "POST", { body }), markers(), [404]);
    await expectRefused(h.db, () => call("purchase-simulations", "POST", { body: { ...body, idempotencyKey: randomUUID(), name: "taken" } }), markers(), [404]);
    await expectIsolated(h.db, () => call("purchase-simulations", "GET"), victim.userId, markers());
    await expectIsolated(h.db, () => call("purchase-simulations", "GET", { query: { cursor: "f".repeat(24) } }), victim.userId, markers());
  });

  it("[iso-transaction-intelligence] runs are private and a review cannot target another user's run", async () => {
    actAs(attacker);
    const latest = await expectIsolated(h.db, () => call("transaction-intelligence/runs", "GET"), victim.userId, markers());
    expect(latest.text).not.toContain(v.run);
    // A REAL signal of the victim's run, so the refusal can only come from the run's ownership check (not a missing signal).
    const victimRun = await h.db.collection("transactionIntelligenceRuns").findOne({ _id: new ObjectId(v.run) });
    const signal = (victimRun?.signals as { id: string }[] | undefined)?.[0];
    expect(signal, "the victim's run must contain a signal for this test to be meaningful").toBeDefined();
    await expectRefused(h.db, () => call("transaction-intelligence/reviews", "POST", { body: { decision: "dismissed", expectedDecision: null,
      idempotencyKey: randomUUID(), runId: v.run, signalId: signal!.id } }), markers(), [400]);
    await expectIsolated(h.db, () => call("transaction-intelligence/runs", "POST", { body: { idempotencyKey: randomUUID() } }), victim.userId, markers());
  });

  it("[iso-self-scoped] profile, onboarding progress, notifications, preferences and progress journeys act only on the actor", async () => {
    actAs(attacker);
    for (const [route, method, body] of [
      ["profile", "GET", undefined], ["notifications", "GET", undefined], ["progress-journeys", "GET", undefined],
      ["notification-preferences", "PUT", { emailEnabled: false, expectedVersion: null, inAppEnabled: true, quietHours: { enabled: false, endHour: 7, startHour: 22 } }],
      ["progress-journey-preferences", "PUT", { celebrationsEnabled: true, expectedVersion: null, progressNotificationsEnabled: true, streaksEnabled: true }],
      ["progress-journeys", "POST", { origin: "live" }], ["notifications/evaluate", "POST", {}],
    ] as const) await expectIsolated(h.db, () => call(route, method, body === undefined ? {} : { body }), victim.userId, markers());
    await expectRefused(h.db, () => call("notifications", "PATCH", { body: { expectedVersion: 1, id: v.notification, inAppState: "read" } }), markers(), [404]);
    await expectRefused(h.db, () => call("onboarding/progress", "POST", { body: { expectedVersion: 99, step: "income" } }), markers());
  });

  it("[iso-ai] AI conversations: list, continue and delete never reach another user's conversation", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-not-a-key-0000000000000000"); // the ownership refusal happens before any provider call
    actAs(attacker);
    await expectIsolated(h.db, () => call("ai/conversations", "GET"), victim.userId, markers());
    await expectRefused(h.db, () => call("ai/conversations", "POST", { body: { conversationId: v.conversation, expectedVersion: 1, focus: "safe_to_spend",
      includeRecentHistory: true, question: "continue" } }), markers(), [404]);
    await expectRefused(h.db, () => call("ai/conversations/[conversationId]", "DELETE", { params: { conversationId: v.conversation }, body: { expectedVersion: 1 } }),
      markers(), [404]);
  });

  it("[iso-reports] saved reports, exports, restatements and current reports stay with their owner", async () => {
    actAs(attacker);
    const current = await expectIsolated(h.db, () => call("reports", "GET", { query: { periodKind: "month", periodValue: "2026-09", scopeKind: "personal" } }),
      victim.userId, markers());
    expect(current.text).not.toContain(v.report);
    await expectRefused(h.db, () => call("reports/[reportId]", "GET", { params: { reportId: v.report } }), markers(), [404]);
    await expectRefused(h.db, () => call("reports/[reportId]", "DELETE", { params: { reportId: v.report }, body: { expectedVersion: 1 } }), markers(), [404]);
    await expectRefused(h.db, () => call("reports/export", "GET", { query: { format: "json", snapshotId: v.report } }), markers(), [404]);
    await expectRefused(h.db, () => call("reports/export", "GET", { query: { format: "csv", snapshotId: v.report } }), markers(), [404]);
    await expectRefused(h.db, () => call("reports", "POST", { body: { action: "restate", idempotencyKey: randomUUID(), period: { kind: "month", value: "2026-09" },
      reason: "taking it over", scope: { kind: "personal" }, supersedesId: v.report } }), markers(), [404]);
  });

  it("[iso-report-summaries] report summaries cannot be listed, generated or deleted through another user's report or summary", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-not-a-key-0000000000000000");
    actAs(attacker);
    await expectRefused(h.db, () => call("report-summaries", "GET", { query: { reportId: v.report } }), markers(), [404]);
    await expectRefused(h.db, () => call("report-summaries", "POST", { body: { expectedSummaryVersion: 1, idempotencyKey: randomUUID(), reportId: v.report } }),
      markers(), [404]);
    await expectRefused(h.db, () => call("report-summaries/[summaryId]", "DELETE", { params: { summaryId: v.summary }, query: { reportId: v.report },
      body: { expectedVersion: 1 } }), markers(), [404]);
    const own = ok(await call("reports", "POST", { body: { action: "close", idempotencyKey: randomUUID(), period: { kind: "month", value: "2026-08" },
      scope: { kind: "personal" } } }), 201).report.id as string;
    await expectRefused(h.db, () => call("report-summaries/[summaryId]", "DELETE", { params: { summaryId: v.summary }, query: { reportId: own },
      body: { expectedVersion: 1 } }), markers(), [404, 409]);
  });

  it("[iso-search] search reads and rebuilds only the actor's own index", async () => {
    actAs(attacker);
    for (const query of [m.merchant.slice(0, 20), m.account.slice(0, 20), m.summary.slice(0, 20)]) {
      await expectIsolated(h.db, () => call("search", "GET", { query: { query } }), victim.userId, markers());
    }
    await expectIsolated(h.db, () => call("search", "POST", { body: { confirm: true } }), victim.userId, markers());
    await expectIsolated(h.db, () => call("search", "GET", { query: { query: m.merchant.slice(0, 20) } }), victim.userId, markers());
    actAs(victim);
    expect((await call("search", "GET", { query: { query: m.merchant.slice(0, 20) } })).text).toContain(m.merchant); // the oracle can see a hit
  });
});
