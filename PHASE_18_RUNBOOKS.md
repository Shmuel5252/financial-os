# Phase 18 operational runbooks — prepared, not executed

2026-09-09. Owner approval is required before live settings/credentials/network changes, backup/restore, destructive drills or paid actions. No secrets, payloads, cookies, account IDs or raw URLs with auth queries in incident records. Record only environment, exact revision, bounded category, time/window, impact and non-user-derived correlation where available. Gates A/B remain pending.

## Common entry and recovery proof

1. Confirm target is Financial OS staging, not local/production or another app; record deployed revision without exposing configuration values.
2. Compare public liveness and authorized readiness. A 403 operator response is not a database outage. A healthy liveness response is not authenticated financial readiness.
3. Correlate sanitized application/platform categories and recent approved changes. Do not dump environment, headers, driver topology or financial records for debugging.
4. Apply only a separately approved remedy. After recovery, validate real login/readiness plus synthetic financial read/write, idempotency, two-user isolation and no unexpected provider actions. End incident only with objective evidence; retain uncertainty explicitly.

## Mongo outage

Look for bounded DEPENDENCY_UNAVAILABLE/readiness 503 while health remains 200. Owner privately inspects actual Atlas tier/status/network/credential scope and correct namespace; Compass connectivity alone does not prove Vercel connectivity. Distinguish cold discovery latency from bad grants/URI/network without printing them. Do not expand network access or swap credentials speculatively. Existing production selection 30s and readiness 5s response have different purposes. After approved remedy, test cold/warm auth and financial reads/writes with isolated synthetic records. Do not retry non-idempotent mutations manually.

## Authentication failure

Record exact revision/time and safe category (InvalidCheck/AdapterError/etc.), not callback query/cookies. Verify Gate A, environment-specific origin/callback, session projection and stable deployment secret privately. Compare same invocation's DB failure; do not assume stale cookies or disable PKCE. No authSecret rotation until Financy coupling resolved. Real sign-in/persistence/sign-out/re-login must pass; a Google redirect or callback 302 alone is not success.

## Provider outage

Separate AI/email/Financy status from core manual operation. Inspect only bounded actual-operation metadata. If owner approves, deploy relevant optional disable flag; record ticket/revision/reason/boolean and rollback. Do not trigger a paid refresh as a probe, replay a disconnect, send arbitrary email or claim unknown receipt failed. Preserve provider idempotency receipts and current canonical finance. After approved re-enable, verify one authorized safe operation and absence of duplicates. Flags cannot cancel in-flight requests; unknown provider outcome requires reconciliation, not blind replay.

## Failed deployment

Confirm failed vs Ready build and actual domain mapping. Build success does not prove DB/Auth. Inspect redacted build status/dependency failures, compare committed package/lock/config. Keep last known safe revision serving; do not overwrite unrelated work. A rollback target with known session disclosure is not safe. Escalate if only an insecure/incompatible rollback exists; prefer reviewed forward fix.

## Vercel rollback (owner action, NOT executed)

In the staging project, open Deployments and identify the exact previously successful Production deployment and SHA. Check plan eligibility (Hobby generally immediately previous production deployment), database/index compatibility, legacy/current Financy keys and credential validity, and ensure it includes the public-session fix. Select the target deployment's Instant Rollback action, review the target/domain, and confirm only with owner approval. Verify the staging primary domain now serves that exact revision, then real auth/readiness and synthetic financial smoke. Do not equate Git HEAD with serving revision.

Rollback reassigns domains to an existing build; its original environment/configuration remains relevant. It does not roll back Mongo data, erasures, index changes, keys or provider actions. A revoked old credential can make rollback fail; retain it only for the explicitly approved rollback window. Review duplicate/idempotency and schema/key compatibility before any replay. Do not delete deployment history. Sources: [Vercel Instant Rollback](https://vercel.com/docs/instant-rollback), [environment variables](https://vercel.com/docs/environment-variables). Current project eligibility and a real rollback drill remain unverified.

## Suspected credential/session exposure

Do not paste token/session/headers into logs or chat. Contain affected surface with a reviewed safe deployment, preserve minimal category/time/revision evidence and identify scope privately. Distinguish synthetic code-path exposure from actual compromise. Owner chooses incident review, targeted session revocation/provider rotation and disclosure obligations. No mass sign-out, deletion or rotation automatically. AUTH_SECRET rotation can alter Financy aliases; follow the versioned separation design before key replacement. Verify containment and real auth/provider continuity before closing.

## Backup failure

Current Free Atlas has no verified active backup. Do not report a missing backup as healthy. Once approved backup exists, measure age of last validated consistent recovery point; alert before RPO24h is breached. Inspect sanitized job/storage/manifest status; never log records/decryption keys. Do not extend retention silently or copy unfiltered auth data as a quick fix. Require approved retry and prove consistency/history/expiry; a successful file upload is not restore proof.

## Restore

Use PHASE_18_OFFLINE_PREPARATION.md's sequence and recoveryPlan's barriers. New isolated namespace, no ingress/jobs/provider egress, verified manifest/keys/current deletion ledger, secret exclusions, reviewed filtered records, canonical IDs and BSON types preserved. Replay current deletions/revocations before derived rebuild and again under final write fence. Recreate indexes, verify reference/ownership/money/provenance and synthetic auth, then owner release. Never overwrite staging, resurrect erased subjects or resend pending notifications. Record full incident-to-validated-recovery time for RTO4h. Planner is non-executable; policy and actual capture/restore mechanism remain unresolved.

## Deletion request

Do not invoke nonexistent full-erasure workflow or manually drop user collections. Authenticate request privately and obtain approved full-erasure/immutable/shared/ledger policy. Record minimal request metadata, not finance. Future workflow must write durable suppression before revocation/erase, preserve other owners, track provider revocation separately and verify all 52 classes/copies before claiming complete. Exports outside application control need truthful limits. Backups expire on policy and current ledger prevents resurrection. Pending policy is a real gate, not permission for indefinite retention.

## Rate-limit incident

Confirm legitimate 429 vs abuse vs dependency503 using route/scope categories only. Fixed windows can burst/reset and actor/scope quotas do not equal global DoS defense. Do not clear limiter collections or expose hash keys to users. Wait documented window; confirm another actor/scope is unaffected. Persistent legitimate export pressure requires measured threshold review, not disabling ownership/limits. Edge/auth route protection changes require approval and protocol-safe tests.

## Monitoring/readiness alert

Check monitor authorization expiry/allowlist first, then real dependency categories. Never treat no traffic or stale provider status as successful SLO evidence. Exclude synthetic/admin/health from core-request SLI; retain coverage/unknown counts. Escalate to the named on-call owner (not yet configured) with bounded status only. Test alert delivery and acknowledgment before calling monitoring operational. No public bearer bypass or financial admin browsing.

## Future staging failure drill checklist

After Gates A/B and explicit scoped approval: inventory synthetic fixture owners, expected revision/namespace, intact rollback and stop conditions; collect baseline liveness/readiness/core timings. Use isolated dependency fault injection, not real network/user deletion: Mongo delay/unavailable, optional-provider timeout/reject, interrupted idempotent mutation, stale concurrent write, expired monitor session. Measure bounded response, safe Hebrew error/fallback, zero unintended mutations/duplicates/notifications, two-user isolation and recovery. Stop on uncertain financial ownership or unknown paid receipt. Restore connections only through approved operator steps; never touch port3000. Record actual recovery and cleanup evidence. No drill executed here.
