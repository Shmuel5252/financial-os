/** Immutable goal evidence adapters only; no evaluation, command replay or release authority. */
import "server-only";
import { ObjectId, type Document } from "mongodb";
import { z } from "zod";
import { GOAL_ENGINE_VERSION, GOAL_POLICY_VERSION, goalDefinitionConfigurationDomainSchema } from "@/lib/goals/goal";
import { storedGoalProgressResultSchema, storedGoalReportedEvidenceSchema, storedGoalMetricFactSchema, storedGoalSourceReferenceSchema } from "@/lib/goals/goal-repository";
import { calendarDateSchema, ianaTimeZoneSchema } from "@/lib/domain/time/financial-time";
import { fromStoredDomainValue, stableSerializableDomainValue, toStoredDomainValue } from "@/lib/db/domain-value-mapper";
import { assertRecoveryContent } from "@/lib/operations/recovery-content";

const id = z.instanceof(ObjectId); const hash = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const stored = z.record(z.string(), z.unknown());
const common = { _id: id, userId: id, createdAt: z.date(), idempotencyKeyHash: hash, schemaVersion: z.literal(1) };
const definitionSchema = z.object({ ...common, configuration: stored, definitionHash: hash, goalId: id,
  reportedEvidence: stored, targetDate: calendarDateSchema.nullable(), version: revision }).strict();
const progressSchema = z.object({ ...common, engineVersion: z.literal(GOAL_ENGINE_VERSION), policyVersion: z.literal(GOAL_POLICY_VERSION),
  evaluatedAt: z.date(), evaluationDate: calendarDateSchema, evidenceHash: hash, goalDefinitionId: id, goalId: id, goalVersion: revision,
  metricFacts: z.array(stored), milestonesCrossed: z.array(z.number().int().positive().max(10000)),
  reason: z.enum(["baseline_established", "evaluation", "material_version_created"]), result: stored,
  sourceReferences: z.array(storedGoalSourceReferenceSchema.strict()), timeZone: ianaTimeZoneSchema }).strict();
const receiptSchema = z.object({ ...common, commandKind: z.enum(["definition", "progress"]), payloadHash: hash, recordId: id }).strict();
const fail = (): never => { throw new Error("Goal recovery requires review"); };
const stable = (value: unknown) => JSON.stringify(stableSerializableDomainValue(value));
function checkedDomain<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.parse(fromStoredDomainValue(value));
  if (stable(toStoredDomainValue(parsed)) !== stable(value)) return fail();
  return parsed;
}
function checkCurrency(value: unknown, currency: string): void {
  if (Array.isArray(value)) { for (const item of value) checkCurrency(item, currency); return; }
  if (typeof value !== "object" || value === null) return;
  if ("amountMinor" in value && "currency" in value) { if (value.currency !== currency) return fail(); return; }
  for (const item of Object.values(value)) checkCurrency(item, currency);
}
export function projectRecoveryGoalDefinition(input: Document): Document {
  try {
    assertRecoveryContent(input); const row = definitionSchema.parse(input);
    const configuration = checkedDomain(goalDefinitionConfigurationDomainSchema, row.configuration);
    const evidence = checkedDomain(storedGoalReportedEvidenceSchema, row.reportedEvidence);
    checkCurrency([configuration, evidence], evidence.currentValue.currency);
    return input;
  } catch { return fail(); }
}
export function projectRecoveryGoalProgress(input: Document): Document {
  try {
    assertRecoveryContent(input); const row = progressSchema.parse(input);
    const result = checkedDomain(storedGoalProgressResultSchema, row.result);
    const facts = checkedDomain(z.array(storedGoalMetricFactSchema), row.metricFacts);
    checkCurrency([result, facts], result.currentValue.currency);
    if (new Set(row.milestonesCrossed).size !== row.milestonesCrossed.length) return fail();
    for (const date of [result.completedAt, result.qualifiedSince]) if (date !== null) calendarDateSchema.parse(date);
    // Evidence hashes/references remain historical; source closure and calculation verification are separate gates.
    return input;
  } catch { return fail(); }
}
export function projectRecoveryGoalReceipt(input: Document): Document {
  try { assertRecoveryContent(input); receiptSchema.parse(input); return input; } catch { return fail(); }
}
