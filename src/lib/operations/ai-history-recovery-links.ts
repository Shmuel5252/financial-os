/** Quarantined direct source metadata, not historical AI correctness or release authority. */
import "server-only";
import type { Document } from "mongodb";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";

const fail = (): never => { throw new Error("AI history recovery links require review"); };
export function inspectAiHistoryRecoveryLinks(input: Readonly<{ conversations: readonly Document[]; summaries: readonly Document[];
  budgets: readonly Document[]; snapshots: readonly Document[]; goals: readonly Document[]; purchases: readonly Document[]; reports: readonly Document[] }>) {
  try {
    const index = (collection: string, values: readonly Document[]) => {
      const rows = new Map<string, Document>(); const unique = new Set<string>();
      for (const value of values) {
        const row = initialRecoverySchemas[collection]!.project(value); const id = row._id.toHexString();
        if (rows.has(id)) return fail(); rows.set(id, row);
        const keys: string[] = [];
        if (row.idempotencyKeyHash !== undefined) keys.push(`retry:${row.idempotencyKeyHash}`);
        if (collection === "budgetPeriods") keys.push(`month:${row.calendarMonth}`);
        if (collection === "reportAiSummaries") keys.push(`summary:${row.reportId.toHexString()}:${row.version}`);
        for (const key of keys) {
          const scoped = `${row.userId.toHexString()}:${key}`; if (unique.has(scoped)) return fail(); unique.add(scoped);
        }
      }
      return rows;
    };
    const conversations = index("aiConversations", input.conversations); const summaries = index("reportAiSummaries", input.summaries);
    const budgets = index("budgetPeriods", input.budgets); const snapshots = index("financialSnapshots", input.snapshots);
    const goals = index("goalProgress", input.goals); const purchases = index("purchaseSimulations", input.purchases);
    const reports = index("financialReports", input.reports);
    let matched = 0;
    const unresolved = { missing: 0, changed: 0, hiddenSources: 0, hiddenHistory: 0, historicalResponses: summaries.size,
      currentHistoryDeletion: conversations.size + summaries.size };
    for (const conversation of conversations.values()) {
      for (const message of conversation.messages) {
        if (message.role !== "assistant") continue; unresolved.historicalResponses++;
        for (const reference of message.sourceReferences) {
          const sources = reference.kind === "budget_period" ? budgets : reference.kind === "financial_engine_snapshot" ? snapshots
            : reference.kind === "goal_progress" ? goals : purchases;
          const source = sources.get(reference.sourceId.toLowerCase());
          if (!source) { unresolved.missing++; continue; }
          if (!source.userId.equals(conversation.userId)) return fail();
          let version: string;
          if (reference.kind === "budget_period") version = `budget-period/${source.version}`;
          else if (reference.kind === "financial_engine_snapshot") {
            if (source.kind !== "engine_result") return fail(); version = `${source.engineVersion}/${source.policyVersion}`;
          } else if (reference.kind === "goal_progress") version = `${source.engineVersion}/${source.policyVersion}/goal-${source.goalVersion}`;
          else version = `${source.evaluation.result.engineVersion}/${source.evaluation.result.policyVersion}`;
          if (version === reference.version) matched++; else unresolved.changed++;
        }
      }
    }
    for (const summary of summaries.values()) {
      if (summary.deletedAt !== null) unresolved.hiddenHistory++;
      const report = reports.get(summary.reportId.toHexString());
      if (!report) { unresolved.missing++; continue; }
      if (!report.userId.equals(summary.userId)) return fail();
      if (report.hiddenAt !== null) unresolved.hiddenSources++;
      if (report.report.sourceFingerprint === summary.reportSourceFingerprint) matched++; else unresolved.changed++;
    }
    // No reconstructed prompt/evidence arithmetic/current advice or proof of deletion since capture.
    return { policy: "ai-history-recovery-links-v1" as const, releaseAllowed: false as const, matched, unresolved };
  } catch { return fail(); }
}
