import { ObjectId, type Document } from "mongodb";
import { progressRecoveryFixture } from "./progress-recovery-fixture";
import { calculateFinancialEngine } from "@/lib/domain/financial-engine/financial-engine";
import { calculateFinancialReport } from "@/lib/domain/reports/report-engine";
import { calculateGoalProgress } from "@/lib/domain/goals/goal-engine";
import { money } from "@/lib/domain/money/money";
import { toStoredDomainValue } from "@/lib/db/domain-value-mapper";
import { GOAL_ENGINE_VERSION, GOAL_POLICY_VERSION } from "@/lib/goals/goal";
import { reportPayloadHash } from "@/lib/reports/report-repository";

export function progressSourceFixture(kind: "engine_snapshot" | "financial_report" | "goal_progress") {
  const { event } = progressRecoveryFixture(); const owner = event.userId; const at = event.createdAt;
  const zero = money(0n, "ILS"); const high = money(9007199254740993n, "ILS"); const id = new ObjectId();
  const common = { _id: id, userId: owner, idempotencyKeyHash: "a".repeat(64), schemaVersion: 1 };
  let row: Document; let version: string;
  if (kind === "engine_snapshot") {
    const result = calculateFinancialEngine({ accountBalance: high, availableCash: high, actualMonthlyExpenses: zero, actualMonthlyIncome: zero,
      asOf: at.toISOString(), creditLimit: zero, creditUsed: zero, currency: "ILS", debtBalance: zero, events: [], horizonDays: 30,
      monthlyConfirmedIncomeBasis: [], safetyMargin: { amount: zero, kind: "fixed" }, savingsBalance: zero, timeZone: "Asia/Jerusalem" });
    row = { ...common, kind: "engine_result", calculatedAt: at, engineVersion: result.engineVersion, policyVersion: result.policyVersion,
      inputHash: "b".repeat(64), sourceManifestId: new ObjectId(), result: toStoredDomainValue(result),
      auditTrail: [{ action: "calculated", actorUserId: owner, at, changedFields: ["inputHash", "result", "sourceManifestId"], revision: 1, source: "financial_engine" }] };
    version = `${row.engineVersion}/${row.policyVersion}/${row.inputHash}/fresh`;
  } else if (kind === "financial_report") {
    const report = calculateFinancialReport({ accounts: [], budget: [], goals: [], liabilities: [], netWorth: [], savings: [], subscriptions: [], transactions: [],
      generatedAt: at.toISOString(), timeZone: "Asia/Jerusalem", period: { kind: "month", value: "2026-08" }, scope: { kind: "personal" } });
    row = { ...common, createdAt: at, hiddenAt: null, authorizationFingerprint: null, idempotencyPayloadHash: "b".repeat(64),
      payloadHash: reportPayloadHash(report, 1, null, null), report: toStoredDomainValue(report), reportVersion: 1,
      restatementReason: null, rootReportId: id, scope: { kind: "personal" }, status: "closed", supersedesId: null, version: 1,
      auditTrail: [{ action: "closed", actorUserId: owner, at, revision: 1 }] };
    version = `1/${report.engineVersion}/${report.policyVersion}/${report.sourceFingerprint}`;
  } else {
    row = { ...common, goalId: new ObjectId(), goalDefinitionId: new ObjectId(), goalVersion: 1, createdAt: at, evaluatedAt: at,
      evaluationDate: "2026-09-28", timeZone: "Asia/Jerusalem", engineVersion: GOAL_ENGINE_VERSION, policyVersion: GOAL_POLICY_VERSION,
      evidenceHash: "b".repeat(64), milestonesCrossed: [], reason: "baseline_established", sourceReferences: [], metricFacts: [],
      result: toStoredDomainValue(calculateGoalProgress({ baselineValue: zero, currentValue: zero, targetValue: high, direction: "increase",
        evaluationDate: "2026-09-28", previous: null, sustainedSuccessDays: 1, verification: "manual_unverified" })) };
    version = `1/${GOAL_ENGINE_VERSION}/${GOAL_POLICY_VERSION}`;
  }
  event.sourceReferences = [{ kind, sourceId: id.toHexString(), version }];
  return { event, row, input: { events: [event], budgets: [] as Document[],
    snapshots: kind === "engine_snapshot" ? [row] : [], reports: kind === "financial_report" ? [row] : [], goals: kind === "goal_progress" ? [row] : [] } };
}
