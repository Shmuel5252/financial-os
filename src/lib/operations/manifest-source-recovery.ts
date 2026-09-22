/** Canonical manual-source metadata matching in quarantine, not historical reconstruction. */
import "server-only";
import type { Document } from "mongodb";
import { sectionCollections } from "@/lib/onboarding/manual-record-repository";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";
import { projectRecoveryFinancialSnapshot } from "@/lib/operations/financial-snapshot-recovery";

const fail = (): never => { throw new Error("Manifest source recovery requires review"); };
export function inspectManifestRecoverySources(
  snapshots: readonly Document[], records: Readonly<Record<string, readonly Document[]>>,
) {
  try {
    const allowed = new Set(Object.values(sectionCollections));
    const index = new Map<string, Document>();
    for (const [collection, rows] of Object.entries(records)) {
      if (!allowed.has(collection)) return fail();
      const adapter = initialRecoverySchemas[collection];
      if (!adapter || adapter.version !== "manual-v2") return fail();
      for (const input of rows) {
        const row = adapter.project(input); const key = `${collection}:${row._id.toHexString()}`;
        if (index.has(key) || !Number.isSafeInteger(row.version)) return fail();
        index.set(key, row);
      }
    }
    const seen = new Set<string>(); let matched = 0;
    const unresolved = { missing: 0, changed: 0, inactive: 0 };
    for (const input of snapshots) {
      const row = projectRecoveryFinancialSnapshot(input); const key = row._id.toHexString();
      if (seen.has(key)) return fail(); seen.add(key);
      if (row.kind !== "source_manifest") continue;
      for (const source of row.sources) {
        const collection = sectionCollections[source.section as keyof typeof sectionCollections];
        for (const reference of source.records) {
          const target = index.get(`${collection}:${reference.id.toLowerCase()}`);
          if (!target) { unresolved.missing++; continue; }
          if (!target.userId.equals(row.userId)) return fail();
          if (target.deletedAt !== null) { unresolved.inactive++; continue; }
          if (target.version !== reference.version || target.updatedAt.getTime() !== reference.updatedAt.getTime()) {
            unresolved.changed++; continue;
          }
          matched++;
        }
      }
    }
    // Matching metadata alone cannot establish original capture completeness or reconstruct old inputs.
    return { policy: "manifest-recovery-sources-v1" as const, releaseAllowed: false as const, matched, unresolved };
  } catch { return fail(); }
}
