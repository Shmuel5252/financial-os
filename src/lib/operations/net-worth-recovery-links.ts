/** Quarantined direct source metadata; never historical valuation proof or release authority. */
import "server-only";
import type { Document } from "mongodb";
import { projectRecoveryNetWorthSnapshot } from "@/lib/operations/net-worth-recovery";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";

const collections = { account: "accounts", credit_card: "creditCards", loan: "loans", net_worth_item: "netWorthItems", savings: "savings" } as const;
const fail = (): never => { throw new Error("Net worth recovery links require review"); };
export function inspectNetWorthRecoveryLinks(snapshots: readonly Document[], records: Readonly<Record<string, readonly Document[]>>) {
  try {
    const allowed = new Set<string>(Object.values(collections)); const sources = new Map<string, Document>();
    const unique = new Set<string>();
    const once = (key: string) => { if (unique.has(key)) return fail(); unique.add(key); };
    for (const [collection, rows] of Object.entries(records)) {
      if (!allowed.has(collection)) return fail();
      for (const input of rows) {
        const row = initialRecoverySchemas[collection]!.project(input); const key = `${collection}:${row._id.toHexString()}`;
        once(key); sources.set(key, row);
        if (typeof row.idempotencyKeyHash === "string") once(`${collection}:retry:${row.userId.toHexString()}:${row.idempotencyKeyHash}`);
      }
    }
    let matched = 0;
    const unresolved = { missing: 0, changed: 0, inactive: 0, unversioned: 0, historicalStatements: 0 };
    const inspect = (owner: Document["userId"], collection: string, id: string, version?: number) => {
      if (!/^[a-f0-9]{24}$/i.test(id)) return fail();
      const target = sources.get(`${collection}:${id.toLowerCase()}`);
      if (!target) { unresolved.missing++; return; }
      if (!target.userId.equals(owner)) return fail();
      if (target.deletedAt !== null) unresolved.inactive++;
      else if (version === undefined) unresolved.unversioned++;
      else if (target.version !== version) unresolved.changed++;
      else matched++;
    };
    for (const input of snapshots) {
      const row = projectRecoveryNetWorthSnapshot(input); const owner = row.userId.toHexString();
      once(`snapshot:${row._id.toHexString()}`); once(`snapshot:state:${owner}:${row.stateFingerprint}`);
      if (row.automaticDate !== undefined) once(`snapshot:day:${owner}:${row.automaticDate}`);
      unresolved.historicalStatements++;
      const components = [...row.statement.included, ...row.statement.excluded.map((entry: Document) => entry.component)];
      for (const component of components) {
        inspect(row.userId, collections[component.sourceKind as keyof typeof collections], component.sourceId, component.sourceVersion);
      }
    }
    for (const item of records.netWorthItems ?? []) {
      const relationship = item.fields.relationship;
      if (relationship.kind === "account_detail") inspect(item.userId, "accounts", relationship.accountId);
      else if (relationship.kind === "liability_evidence") {
        inspect(item.userId, collections[relationship.recordKind as "loan" | "credit_card"], relationship.recordId);
      }
    }
    return { policy: "net-worth-recovery-links-v1" as const, releaseAllowed: false as const, matched, unresolved };
  } catch { return fail(); }
}
