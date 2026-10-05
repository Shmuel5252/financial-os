import { createHmac } from "node:crypto";
import type { Db } from "mongodb";

// Phase 18 row 18-13: TEST/REHEARSAL-ONLY prototype of the restore preflight described in PHASE_18_KEY_CONTINUITY_DESIGN.md.
// It is deliberately NOT wired into runtime code, recovery scripts or restore tooling (DESIGN / NOT ADOPTED). Read-only: it only runs
// find/countDocuments with projections. It returns COUNTS only - never key material, aliases, user ids or document contents.
//
// Question it answers before a restore is released: "under which candidate secret does the restored data stay reachable?"
// Raw provider identifiers are never stored, so the only alias that can be recomputed offline is the configured provider subject's
// (OPEN_FINANCE_USER_ID). A binding that matches no candidate is orphaned: every alias-bearing record of its owner is at risk.

const PROVIDER = "financy";
/** Collections holding AUTH_SECRET-derived aliases per owner (tests/security/secret-derivation-inventory.ts keyedFields). */
const ALIAS_BEARING: Readonly<Record<string, Record<string, unknown>>> = {
  bankConnections: {}, bankRecordRevisions: {}, bankAccountReconciliations: {},
  accounts: { "source.kind": "open_banking" }, transactions: { "source.kind": "open_banking" },
};

export type PreflightCandidate = Readonly<{ label: string; material: string }>;
export type PreflightReport = Readonly<{
  bindings: number;
  /** candidate label -> bindings whose subjectAlias equals HMAC(candidate, financy:subject:<configured subject>) */
  matchingBindings: Readonly<Record<string, number>>;
  /** bindings matching no candidate (release barrier) */
  orphanedBindings: number;
  /** per collection: alias-bearing documents owned by users of orphaned bindings */
  documentsAtRisk: Readonly<Record<string, number>>;
}>;

const subjectAlias = (material: string, subject: string) => createHmac("sha256", material).update(`${PROVIDER}:subject:${subject}`, "utf8").digest("hex");

export async function keyContinuityPreflight(db: Db, input: Readonly<{ subjectExternalId: string; candidates: readonly PreflightCandidate[] }>): Promise<PreflightReport> {
  const bindings = await db.collection("bankProviderBindings").find({ provider: PROVIDER }, { projection: { _id: 0, subjectAlias: 1, userId: 1 } }).toArray();
  const expected = new Map(input.candidates.map((candidate) => [candidate.label, subjectAlias(candidate.material, input.subjectExternalId)]));
  const matchingBindings = Object.fromEntries([...expected].map(([label, alias]) => [label, bindings.filter((binding) => binding.subjectAlias === alias).length]));
  const orphaned = bindings.filter((binding) => ![...expected.values()].includes(binding.subjectAlias as string));
  const owners = orphaned.map((binding) => binding.userId);
  const documentsAtRisk = Object.fromEntries(await Promise.all(Object.entries(ALIAS_BEARING).map(async ([name, filter]) =>
    [name, owners.length === 0 ? 0 : await db.collection(name).countDocuments({ ...filter, userId: { $in: owners } })] as const)));
  return { bindings: bindings.length, matchingBindings, orphanedBindings: orphaned.length, documentsAtRisk };
}
