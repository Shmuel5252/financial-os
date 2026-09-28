import { ObjectId, type Document } from "mongodb";
import { calculateNetWorth } from "@/lib/domain/net-worth/net-worth-engine";
import { money } from "@/lib/domain/money/money";
import { toStoredDomainValue } from "@/lib/db/domain-value-mapper";
import { netWorthStateFingerprint } from "@/lib/net-worth/net-worth-repository";

export function netWorthSnapshotFixture(owner = new ObjectId(), source = new ObjectId()): Document {
  const at = new Date("2026-09-28T00:00:00Z");
  const statement = calculateNetWorth({ asOf: at.toISOString(), timeZone: "Asia/Jerusalem", components: [
    { id: `item:${source.toHexString()}`, sourceId: source.toHexString(), sourceKind: "net_worth_item", sourceVersion: 1,
      label: "Synthetic item", amount: money(9007199254740993n, "ILS"), category: "other_asset", side: "asset",
      effectiveAt: at.toISOString(), liquidity: "non_cash", provenance: { kind: "user_entered", note: null },
      aggregation: { kind: "independent" }, valuationType: "user_estimate" },
    { id: "synthetic-usd", sourceId: new ObjectId().toHexString(), sourceKind: "account", sourceVersion: 1,
      label: "Synthetic second currency", amount: money(7n, "USD"), category: "cash", side: "asset",
      effectiveAt: at.toISOString(), liquidity: "cash", provenance: { kind: "user_entered", note: null },
      aggregation: { kind: "independent" }, valuationType: "cash_balance" },
  ] });
  return { _id: new ObjectId(), userId: owner, createdAt: at, schemaVersion: 1, trigger: "explicit",
    stateFingerprint: netWorthStateFingerprint(statement), statement: toStoredDomainValue(statement),
    auditTrail: [{ action: "captured", actorUserId: owner, at, changedFields: ["statement", "trigger"], revision: 1, source: "net_worth_snapshot" }] };
}
