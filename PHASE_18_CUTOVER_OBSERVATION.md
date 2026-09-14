# Phase 18 least-privilege cutover — technically successful / observation incomplete

## Current owner-approved disposition — 2026-09-14

Status: **technically successful / observation incomplete**. This is neither full PASS nor FAIL. Owner explicitly approved checkpointing these documentation-only findings and stopping; no further observation window is authorized now. This disposition supersedes earlier pending-status wording below without rewriting historical evidence.

- Owner-verified deployed cutover evidence: Google login, minimized public session/session persistence, existing financial reads, UI write surviving refresh, logout and re-login; liveness, readiness and bounded bindings checks were healthy.
- Agent evidence independently supports authenticated reads/refresh/session preservation and successful health/readiness/bindings HTTP statuses. JSON body visibility was limited by client-side browser blocking; previous owner body verification and source-contract interpretation remain explicitly distinct from direct agent capture. No secret values or private financial data are recorded here.
- No new Mongo authentication/authorization/connection, Auth.js or HTTP 5xx failures were seen in the retained samples from the latest window. This is not exhaustive clearance of the unobserved interval, and does not resolve historical InvalidCheck incidents.
- Latest window started at 06:16:45 Asia/Jerusalem (03:16:45 UTC). Last absolute timestamp captured in that run was 06:33:22 (03:33:22 UTC); the last retained server request was readiness 200 at 06:31:14.999. Later reports UI verification lacked an absolute timestamp. Thirty continuous minutes were not proved.
- Cold connection, index creation and controlled two-user isolation are separate Phase 18 checks, not additional conditions for this bounded cutover disposition.

Keep the old Atlas user active and unchanged until separate explicit owner authorization. No infrastructure, credential, environment, network, code or financial-domain change is part of this checkpoint. Phase 18 remains not fully accepted; Phase 19 remains unopened. Stop after documentation commit/push; further Phase 18 work requires approval.

## Audit of the 06:16:45 local window — 2026-09-14

Owner confirmed the previous 01:11 window was not manually continued and must not pass. The subsequent window began 03:16:45 UTC / 06:16:45 Asia/Jerusalem; minimum qualifying end was 03:46:45 UTC / 06:46:45 local. This audit does not start another window.

Saved same-deployment evidence: readiness 200 at 03:17:03.279 and 03:31:14.999 UTC; health 200 at 03:24:12.328; bindings 200 at 03:25:17.055; forecasts 200 at 03:28:04.222 and 03:30:00.428. Authenticated dashboard/management/forecast reads and refreshes succeeded. The last saved runtime request is readiness at 06:31:14.999 local. The last absolute clock reading during that run is 06:33:22 local, which timestamps the agent's work, not a new server request.

Work DID continue after the approximately-17-minute update: the agent opened reports, observed /reports with authenticated navigation and no application error, then completed a 50-second wait. Those later tool results lack an absolute timestamp; their durations must not be turned into an invented exact end time. There is no captured evidence at or after 06:46:45. No new Mongo/Auth/5xx appeared in the saved log samples; no exhaustive clearance of the missing interval is claimed. No sign-out or write was performed in this window.

At 11:15:54 UTC / 14:15:54 local, the owner requested a historical audit only. The existing Vercel log tab still held its 06:02–06:32 query and readiness row at 06:31:14.999. Attempting the original date's 06:16–07:00 local range through the read-only time filter returned Outside of allowed range. This is unavailable historical evidence, not evidence of zero requests/errors. No retention setting was changed and no new staging request was generated for this audit.

Conclusion: INCOMPLETE evidence, not PASS and not a demonstrated cutover failure. Missing: a qualifying healthy endpoint/normal-use observation at or after 06:46:45 and coverage of the intervening runtime failure check. Cold/index/two-user checks are explicitly NOT blockers for this bounded decision. No new window, commit/push, infrastructure/credential mutation or Phase 19. Old Atlas user remains unchanged.

## Latest bounded cutover criterion and observation — 2026-09-14 local date

Owner explicitly narrowed cutover acceptance to 30 actual continuous minutes of normal authenticated operation, readiness remaining ready, and no new Mongo/Auth/5xx failures. Cold connection, index creation and controlled two-user isolation remain separate Phase 18 checks, NOT conditions for this bounded cutover PASS. A reversible write is optional where safe. This direction supersedes the broader acceptance prerequisites in earlier observation notes without changing their historical outcomes.

New formal start: 2026-09-13 22:11:36 UTC / 2026-09-14 01:11:36 Asia/Jerusalem. Earliest eligible end would have been 22:41:36 UTC / 01:41:36 local. Authenticated dashboard, financial-data, forecasts and reports opened successfully; full management and forecast refreshes preserved session. No sign-out or financial write was performed in this window.

Deployment-filtered runtime samples for dpl_7bdVBeapJUx9AF4rvGrKRT5R88zS showed readiness 200 at 22:11:02.361 (baseline), 22:22:19.922 and 22:30:50.402 UTC; bindings 200 at 22:17:28.956; health 200 at 22:29:53.584; forecasts 200 at 22:20:01.444 and reports 200 at 22:26:18.529. Inspected samples contained no displayed new Mongo/Auth error or 5xx. Prefetch requests are not counted as completed UI journeys. JSON bodies were blocked by the client; readiness 200 maps to ready after authorized successful Mongo ping in the reviewed same-revision route contract, not a claimed directly captured response body. Bindings 200 does not independently establish every assertion's value.

Before the eligible end, browser action approval was denied with a usage-limit message. No alternate browser/network mechanism was used to bypass the denial. The last captured request evidence is 22:30:50.402 UTC (19 minutes 14 seconds after start); subsequent log inspection occurred before the denied refresh, but an exact stop timestamp was not captured. A continuation at 2026-09-14 03:12:09 UTC does not fill that unattended gap. Thirty continuous minutes were NOT verified. Result remains INCOMPLETE, not a staging failure and not PASS. No commit/push is authorized by the conditional PASS rule yet. Old Atlas user remains untouched; Phase 18 unaccepted, Phase 19 unopened. Historical InvalidCheck remains unexplained, not a newly observed failure in this window.

## Addendum: 2026-09-13 resumed observation, incomplete

This addendum preserves the September 10 incident below; it does not explain or close InvalidCheck. Owner authorized a new observation after manually obtaining ready. Agent also read the already-open readiness page showing ready before beginning.

- New formal start: 2026-09-13 17:49:44 UTC (20:49:44 Asia/Jerusalem). Vercel overview showed the same deployment Ready on main, revision 86c74b4, mapped to the canonical staging domain.
- Runtime table: health 200 at 17:50:09.971; dashboard 200 at 17:50:16.505 and 17:50:22.840; financial-data 200 at 17:50:25.426; accounts 200 at 17:52:54.977; forecasts 200 at 17:54:13.870; readiness 200 at 17:56:04.907 UTC. Agent navigated management, accounts, forecasts and goals and verified authenticated navigation without an application error. A full goals reload preserved authenticated access.
- Menu opening caused framework prefetch requests for additional routes. Those HTTP 200 rows are not claimed as complete UI verification of those screens. Browser automation blocked direct JSON navigation with ERR_BLOCKED_BY_CLIENT even where the server table showed 200; status alone does not prove the response body.
- During navigation after reload, a reused element index invoked sign-out rather than the intended menu. Sign-out was within authorized lifecycle scope, but this was not the intended navigation action. The app returned to its public page. Agent followed the normal sign-in button and handed Google authentication to the owner; no session/token was extracted or authentication bypassed.
- Owner completed Google login. Callback 302 at 18:03:18.814 was followed by onboarding/profile 200 at 18:03:21.357 UTC; agent observed authenticated navigation on onboarding/profile. No Configuration error was visible. Because this differed from the earlier dashboard context, identity continuity and operator status were NOT inferred. No onboarding data was entered. This is not a controlled two-user isolation test.
- Inspected log samples contained no displayed 5xx, Mongo authorization/connection error, or Authentication failure/InvalidCheck. This is sampled visible-log evidence, not exhaustive error clearance or resolution of the historical incident.
- A readiness reload was attempted after re-login, but its resulting body/status was not captured before interruption. Last captured runtime sample includes requests through 18:03:22.451 UTC. Thus there is no verified 30-minute end check.
- On continuation at 22:05:05 UTC (2026-09-14 01:05:05 Asia/Jerusalem), the browser session had changed and no staging/Vercel tabs remained. Direct readiness navigation was again client-blocked. The multi-hour gap is NOT observation time and must not be added to the roughly 14 minutes of captured samples.

Result: observation INCOMPLETE, not PASS. No new server failure is demonstrated by these samples. Synthetic CRUD, controlled two-user isolation, new Mongo connection/index creation, final ready/deployment check and old-credential consumer inventory remain unverified in this run. Prior owner read/write/auth evidence remains distinct. No financial data mutation beyond normal authentication lifecycle, infrastructure change, rollback, credential retirement, commit or push was performed. Keep the old credential available. A complete uninterrupted observation and outstanding cutover checks are still needed; Phase 18 remains unaccepted and Phase 19 unopened.

2026-09-10. Local documentation only. No PASS, commit/push, rollback, credential/user/role/environment/network change, migration, backup/restore or Phase 19.

## Target and owner evidence

Owner reports the staging Production MONGODB_URI has been replaced with a dedicated Atlas principal restricted to readWrite on financial_os_staging. Owner reports real Google login, minimized public session, existing financial reads, UI write surviving refresh, logout/re-login, health 200/ok, readiness 200/ready and bounded bindings matches/presence. This is owner evidence; the agent did not inspect secret values or independently attest the principal or grants.

Agent inspected Vercel deployment dpl_7bdVBeapJUx9AF4rvGrKRT5R88zS: Ready, Current Production scope, canonical staging domain financial-os-staging-nine.vercel.app; revision 86c74b4f13db579e59a609b24ed08be0f9e55673. The dashboard reported creation on 2026-09-10 at 14:27:02 GMT+3. No new deployment initiated.

## Observation timeline and outcomes

- Initial access checks began 12:15:34 UTC (15:15:34 Asia/Jerusalem). These setup checks are not counted as the soak window.
- 12:17:34 UTC: existing authenticated Chrome session successfully displayed /dashboard. Only route/boolean evidence was emitted, not financial values. Vercel request table confirmed /dashboard and /financial-data GET 200 around 12:17:28–34 UTC.
- Formal intended 30-minute observation start: 12:17:46 UTC / 15:17:46 Asia/Jerusalem.
- Direct automated /api/ops/readiness navigation was blocked by the browser client with ERR_BLOCKED_BY_CLIENT. Vercel logs nevertheless show GET /api/ops/readiness 200 at 12:16:50.552 UTC. Do not interpret the client navigation error as a server outage or claim the agent read the ready response body.
- Vercel log UI initially displayed a stale timeline/retention warning. Using its timeline reset and reloading produced current deployment-filtered request rows. No logging configuration or retention settings changed.
- Current-deployment runtime evidence: /api/auth/callback/google at 12:13:10.830 UTC / 15:13:10.830 local returned 302 and logged Authentication failure, category InvalidCheck, redactionVersion auth-log-v1. This occurred BEFORE the formal observation window, not during agent-driven login. It was discovered during the observation's baseline log review. No raw OAuth query, token or secret was captured in documentation.
- Supporting recent rows: health GET 200 at 12:12:17.998 and 12:13:22.991 UTC; readiness GET 200 at 12:12:35.477 UTC; bindings GET 200 at 12:12:50.741 UTC. Their bodies are owner-verified, not inferred from status alone. Earlier callback 302 at 12:12:09.023 UTC had no displayed failure and was followed by protected-page requests; do not infer all subsequent callbacks succeeded.
- Stop timestamp: 12:18:51 UTC / 15:18:51 Asia/Jerusalem. Formal window completed only 65 seconds, NOT 30 minutes. Stop on discovery of unexplained authentication failure in the current cutover deployment. No further synthetic mutation, logout, provider action or automatic rollback performed.

## Acceptance classification

| Check | Result / evidence |
| --- | --- |
| Deployment Ready/current/revision | PASS at initial inspection; no end-of-30-minute observation exists |
| Authenticated dashboard/current reads | PASS for inspected existing session and corresponding HTTP 200 rows |
| Write persistence, logout/re-login, minimized session | Owner reports PASS; not repeated by agent |
| Health/readiness/bindings | Recent HTTP 200 rows observed and owner reports expected bodies; automated readiness body unavailable |
| Clean authentication runtime | BLOCKED: current deployment InvalidCheck, root cause unresolved |
| Thirty-minute soak | NOT COMPLETED, not PASS |
| Actual cold/new Mongo connection and index creation | NOT VERIFIED; warm HTTP success does not establish these |
| Fresh two-user isolation after cutover | NOT VERIFIED in this observation; earlier accepted gates remain historical |
| Absence of Mongo authorization/connection errors | None visible in inspected rows; not comprehensive time-window clearance |
| Cutover final acceptance / old credential retirement | PENDING, not authorized by these partial results |

## Next action and rollback judgment

Investigate the same deployment's InvalidCheck with bounded diagnostic evidence before restarting a clean 30-minute window. It is not proved to be caused by the DB principal change, PKCE expiry, absent cookies, a callback retry or key mismatch. Preserve the earlier historical incident; this is a newly observed recurrence category, not a proven shared root cause. Functional existing-session reads and readiness successes do not resolve failed fresh authentication.

Immediate credential rollback is not recommended solely from this category because there is no demonstrated Mongo authorization/connectivity regression. If fresh login continues to fail or required core operations fail, evaluate the approved rollback plan with the owner. Do not weaken OAuth checks or expand DB grants. Keep the old credential active and privately recoverable: other consumers and retirement criteria remain unproved.

After resolving or explaining the incident with evidence, restart the full 30-minute observation, capture readiness and final Ready status, validate cold/warm evidence and applicable two-user checks. No Phase 18 full acceptance or Phase 19 progression. This interrupted run does not qualify for the user-authorized documentation push following PASS.
