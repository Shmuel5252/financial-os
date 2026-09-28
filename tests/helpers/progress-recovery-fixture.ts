import { ObjectId, type Document } from "mongodb";
import { progressEventDraft } from "@/lib/domain/progress-journeys/progress-journey-engine";
import type { ProgressObservation } from "@/lib/progress-journeys/progress-journey";

export function progressRecoveryFixture(owner = new ObjectId()) {
  const at = new Date("2026-09-28T00:00:00Z");
  const observation: ProgressObservation = { dimension: "within_budget", evaluationDate: "2026-08-31", origin: "backfill",
    outcome: "achieved", period: { kind: "month", value: "2026-08" }, ruleId: "closed-budget-without-deficit",
    seriesKey: "personal-budget", sourceReferences: [{ kind: "budget_period", sourceId: new ObjectId().toHexString(), version: "1" }],
    subjectKey: "2026-08", subjectLabel: "Synthetic period", value: null };
  const draft = progressEventDraft(observation, null);
  const event: Document = { _id: new ObjectId(), userId: owner, createdAt: at, schemaVersion: 1, ...draft, supersedesId: null,
    auditTrail: [{ action: "appended", actorUserId: owner, at, revision: 1 }] };
  const settings = { celebrationsEnabled: false, progressNotificationsEnabled: false, streaksEnabled: false };
  const preference: Document = { _id: new ObjectId(), userId: owner, createdAt: at, updatedAt: at, schemaVersion: 1, version: 1, ...settings,
    auditTrail: [{ action: "created", actorUserId: owner, at, revision: 1, changedFields: Object.keys(settings) }] };
  return { event, preference, observation, draft, settings };
}
