import { BSON, ObjectId, type Document } from "mongodb";
import { describe, expect, it } from "vitest";
import { aiHistoryRecoveryFixture } from "../helpers/ai-history-recovery-fixture";
import { progressSourceFixture } from "../helpers/progress-source-fixture";
import { inspectAiHistoryRecoveryLinks as inspect } from "@/lib/operations/ai-history-recovery-links";
import { calculateFinancialEngine } from "@/lib/domain/financial-engine/financial-engine";
import { calculatePurchaseSimulation } from "@/lib/domain/purchase-simulations/purchase-simulation-engine";
import { money } from "@/lib/domain/money/money";
import { toStoredDomainValue } from "@/lib/db/domain-value-mapper";

function fixture(kind: "engine_snapshot" | "goal_progress" | "financial_report") {
  const source = progressSourceFixture(kind).row; const history = aiHistoryRecoveryFixture(source.userId);
  const input = { conversations: [] as Document[], summaries: [] as Document[], budgets: [] as Document[],
    snapshots: [] as Document[], goals: [] as Document[], purchases: [] as Document[], reports: [] as Document[] };
  if (kind === "financial_report") {
    history.summary.reportId = source._id; history.summary.reportSourceFingerprint = source.report.sourceFingerprint;
    input.summaries = [history.summary]; input.reports = [source];
  } else {
    const engine = kind === "engine_snapshot";
    history.conversation.messages[1].sourceReferences = [{ alias: "synthetic-source", kind: engine ? "financial_engine_snapshot" : "goal_progress",
      sourceId: source._id.toHexString(), version: `${source.engineVersion}/${source.policyVersion}${engine ? "" : `/goal-${source.goalVersion}`}` }];
    input.conversations = [history.conversation]; if (engine) input.snapshots = [source]; else input.goals = [source];
  }
  return { source, history, input };
}
describe.each(["engine_snapshot", "goal_progress", "financial_report"] as const)("AI history %s direct links", kind => {
  it("matches source metadata only, preserving original BSON and unresolved history/deletion state", () => {
    const { input } = fixture(kind); const before = BSON.serialize(input);
    expect(inspect(input)).toMatchObject({ releaseAllowed: false, matched: 1,
      unresolved: { missing: 0, changed: 0, historicalResponses: 1, currentHistoryDeletion: 1 } });
    expect(BSON.serialize(input)).toEqual(before);
  });
  it("refuses a foreign source before comparing metadata, with no private value in its error", () => {
    const { source, input, history } = fixture(kind); source.userId = new ObjectId();
    if (source.auditTrail) source.auditTrail[0].actorUserId = source.userId;
    if (kind === "financial_report") history.summary.reportSourceFingerprint = "c".repeat(64);
    else history.conversation.messages[1].sourceReferences[0].version = "different";
    expect(() => inspect(input)).toThrow("AI history recovery links require review");
  });
  it("keeps missing or changed sources unresolved instead of inventing source continuity", () => {
    const { input, history } = fixture(kind);
    if (kind === "financial_report") history.summary.reportSourceFingerprint = "c".repeat(64);
    else history.conversation.messages[1].sourceReferences[0].version = "different";
    expect(inspect(input)).toMatchObject({ matched: 0, unresolved: { changed: 1 } });
    input.snapshots = []; input.goals = []; input.reports = [];
    expect(inspect(input)).toMatchObject({ matched: 0, unresolved: { missing: 1 } });
  });
});
it("rejects duplicate history IDs, summary retry keys and report-version identities", () => {
  const { input, history } = fixture("financial_report");
  expect(() => inspect({ ...input, summaries: [history.summary, history.summary] })).toThrow();
  expect(() => inspect({ ...input, summaries: [history.summary, { ...history.summary, _id: new ObjectId(), version: 2 }] })).toThrow();
  expect(() => inspect({ ...input, summaries: [history.summary, { ...history.summary, _id: new ObjectId(), idempotencyKeyHash: "c".repeat(64) }] })).toThrow();
});
it("keeps hidden report or summary history unavailable without erasing provenance", () => {
  const { input, source, history } = fixture("financial_report"); source.hiddenAt = source.createdAt; history.summary.deletedAt = history.summary.createdAt;
  expect(inspect(input)).toMatchObject({ releaseAllowed: false, matched: 1, unresolved: { hiddenSources: 1, hiddenHistory: 1 } });
});

it("uses the budget-period revision contract without reconstructing historical monthly spending", () => {
  const { input, history } = fixture("engine_snapshot"); input.snapshots = [];
  const at = history.conversation.createdAt; const owner = history.conversation.userId; const id = new ObjectId();
  input.budgets = [{ _id: id, userId: owner, allocations: [], carryIn: [], calendarMonth: "2026-09", currency: "ILS", closedAt: null,
    closingSnapshot: null, createdAt: at, updatedAt: at, status: "open", version: 1,
    auditTrail: [{ action: "created", actorUserId: owner, allocationsAfter: [], allocationsBefore: null, at, revision: 1 }] }];
  history.conversation.messages[1].sourceReferences = [{ alias: "budget.current_period", kind: "budget_period", sourceId: id.toHexString(), version: "budget-period/1" }];
  expect(inspect(input)).toMatchObject({ matched: 1, releaseAllowed: false, unresolved: { historicalResponses: 1 } });
  history.conversation.messages[1].sourceReferences[0].version = "budget-period/2";
  expect(inspect(input)).toMatchObject({ matched: 0, unresolved: { changed: 1 } });
  const foreign = new ObjectId(); input.budgets[0]!.userId = foreign; input.budgets[0]!.auditTrail[0].actorUserId = foreign;
  expect(() => inspect(input)).toThrow("AI history recovery links require review");
});

it("checks purchase engine/policy metadata without treating the saved simulation as real financial truth", () => {
  const { input, history } = fixture("engine_snapshot"); input.snapshots = [];
  const at = history.conversation.createdAt; const owner = history.conversation.userId; const snapshot = new ObjectId(); const id = new ObjectId();
  const zero = money(0n, "ILS"); const balance = money(9007199254740993n, "ILS");
  const baseline = calculateFinancialEngine({ accountBalance: balance, availableCash: balance, actualMonthlyExpenses: zero, actualMonthlyIncome: zero,
    asOf: at.toISOString(), creditLimit: zero, creditUsed: zero, currency: "ILS", debtBalance: zero, events: [], horizonDays: 210,
    monthlyConfirmedIncomeBasis: [], safetyMargin: { amount: zero, kind: "fixed" }, savingsBalance: zero, timeZone: "Asia/Jerusalem" });
  const parameters = { charges: [], inputMode: "one_time" as const, installmentCount: 1, installmentFrequency: "monthly" as const,
    proposedDate: "2026-09-29", sourceSnapshotId: snapshot.toHexString(), totalPurchasePrice: money(100n, "ILS") };
  const result = calculatePurchaseSimulation({ ...parameters, baseline, evaluationHorizonDays: 120, saferDateSearchDays: 90 });
  input.purchases = [{ _id: id, userId: owner, sourceSnapshotId: snapshot, createdAt: at, schemaVersion: 1, idempotencyKeyHash: "c".repeat(64),
    inputHash: "d".repeat(64), name: null, note: null, input: toStoredDomainValue(parameters),
    evaluation: toStoredDomainValue({ budgetPeriodReference: null, dataFreshness: "STALE", freshnessReasons: ["new_calendar_day"], result,
      sourceSnapshot: { id: snapshot.toHexString(), calculatedAt: at, engineVersion: baseline.engineVersion, policyVersion: baseline.policyVersion,
        inputHash: "a".repeat(64), sourceManifestId: new ObjectId().toHexString() }, timeZone: "Asia/Jerusalem" }),
    auditTrail: [{ action: "saved", actorUserId: owner, at, changedFields: ["input", "evaluation", "name", "note"], revision: 1, source: "purchase_simulation" }] }];
  history.conversation.messages[1].sourceReferences = [{ alias: "purchase.latest_saved", kind: "purchase_simulation", sourceId: id.toHexString(),
    version: `${result.engineVersion}/${result.policyVersion}` }];
  expect(inspect(input)).toMatchObject({ matched: 1, releaseAllowed: false, unresolved: { historicalResponses: 1 } });
  const foreign = new ObjectId(); input.purchases[0]!.userId = foreign; input.purchases[0]!.auditTrail[0].actorUserId = foreign;
  expect(() => inspect(input)).toThrow("AI history recovery links require review");
});
