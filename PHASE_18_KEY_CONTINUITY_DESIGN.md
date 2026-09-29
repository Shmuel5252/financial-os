# Phase 18 — Financy identity-key continuity design (F)

2026-09-29. **Design only**, owner-approved as such. No key is provisioned, rotated or copied; no credential, Vercel/Atlas setting or runtime code path changes. The prototype `src/lib/open-banking/identity-keyring.ts` is deliberately unreferenced by runtime code; `tests/unit/identity-keyring.test.ts` proves its properties with synthetic values. Refines the approved direction in `PHASE_18_HARDENING_PACKAGE.md` ("Secret-key separation design") and DECISIONS.md ("Key boundary").

## Problem

Every provider alias is `HMAC-SHA256(AUTH_SECRET, "financy:<kind>:<value>")`, computed in two places (`bankAlias` in `account-identity.ts`, `alias` in `open-banking-service.ts`). Kinds in stored data: `subject`, `connection`, `institution`, `account`, `transaction`, `financy-account-identity-v1` (account reference digest), and reconciliation request/command/row/view keys. Consequences:
- Rotating `AUTH_SECRET` (an authentication secret) silently changes every alias: bindings no longer match, sync reimports under new aliases (duplicate canonical records blocked only by reconnection guards), reconciliation and retired-alias suppression break.
- A restore under a different `AUTH_SECRET` orphans all provider evidence.
- Deletion-receipt provider markers (ADR-076 C3) are keyed on the subject alias, so they inherit the same coupling.

## Design: two separate steps

**Step 1 — decouple (no alias changes).** Introduce a server-only Financy identity keyring `{ activeVersion, keys: [{ version, material }] }`, whose v1 material is a copy of the *current* `AUTH_SECRET` value. The derivation is unchanged, so every stored alias stays byte-identical (proven for every kind by the prototype test). Code then reads the keyring instead of `AUTH_SECRET`; afterwards `AUTH_SECRET` can rotate for authentication purposes alone, without touching provider identity (also proven by test).
- Wiring: replace the two HMAC entry points by one keyring-backed function; `getServerEnv` validates the keyring at startup (fail closed on missing v1 when provider data exists).
- Suggested configuration: `FINANCY_IDENTITY_KEY_V1` (≥32 characters, identical bytes to current `AUTH_SECRET`), `FINANCY_IDENTITY_ACTIVE_VERSION=1`. Names are proposals; values are never logged, compared in reports, or placed in artifacts.
- Owner actions when approved: create the new secret in the platform secret store for each environment (copying the value privately, never through chat/Git), then deploy the wiring. Verification: a bounded bindings/readiness check that the configured subject alias still matches the stored binding, without printing either.

**Step 2 — rotate the identity key itself (only if required, e.g. suspected key exposure).** Aliases are pseudonymization, not authentication; rotation is not routine. If needed:
1. Add v2 to the keyring as active; keep v1 readable.
2. Dual read: every lookup (binding, connection/account/transaction record, retired aliases, reconciliation, deletion markers) resolves `readableAliases` across versions, newest first; writes use v2.
3. Record the alias version with new stored aliases (additive field; absent = v1) so no hash is ever guessed from another.
4. Re-observation migrates naturally: on the next sync, records seen again are linked from their v1 alias to their v2 alias through an immutable alias-link event on the same canonical ID (never a new canonical record). Records never seen again keep v1 aliases permanently.
5. v1 may leave the keyring only when an inventory proves no stored alias, marker or retained backup still depends on it (backup history window plus margin, as for ledger retention).
Raw provider identifiers are deliberately not stored, so old aliases can never be recomputed offline; continuity comes only from re-observation or retaining v1.

## Recovery compatibility

- The keyring is recovered from secret management, never from a backup package; package manifests record key *versions*, never material.
- Restore preflight: compute the configured subject's alias under each readable version and compare with restored bindings (count only). Mismatch is a release barrier (already reported as `unverifiedKeyContinuity` by `inspectBankControlRecovery`).
- Deletion markers: the restore check must test all readable alias versions of a subject (`readableAliases`) before concluding it is not marked.

## Rollback

- Step 1 rollback is safe while `AUTH_SECRET` still equals v1: old and new code derive identical aliases. After `AUTH_SECRET` has been rotated, the pre-decoupling build is no longer a valid rollback target; record this in the deployment rollback register.
- Step 2 rollback: set `activeVersion` back to 1 with v2 still readable (prototype test). Any v2-only records written meanwhile stay resolvable because v2 remains in the keyring; never remove a version that stored data uses.

## Tests

Synthetic (done, prototype): byte-identical v1 derivation for all stored alias kinds; decoupling survives `AUTH_SECRET` rotation; dual-read ordering; premature v1 removal makes legacy aliases unresolvable; rollback reproduces pre-rotation aliases; malformed keyrings fail without reflecting material.
When wiring is approved (planned): real-Mongo sync/reconnect/reconciliation/retired-alias/restore rehearsals under a v1-only keyring and under a v1+v2 dual-read keyring, verifying zero duplicate canonical records, stable idempotency, and restore preflight counts.

## Open owner decisions

1. Approve Step 1 wiring (repository change) and, separately, the private creation of the new secret per environment.
2. Whether Step 2 is ever needed; default: no rotation without an exposure event.
