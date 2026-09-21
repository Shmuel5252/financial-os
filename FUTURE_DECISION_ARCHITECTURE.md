# Future decision architecture — approved planning only

Owner-approved 2026-09-22 (ADR-075). Phases 21–25 are future capability gates, NOT implemented, accepted, or authorized for implementation. Phases 18–20 retain their scope, order and acceptance criteria. Phase 18 continues at notification recovery/replay prevention; Phase 19 cannot start before Phase 18 acceptance. No present refactor or change to financial semantics follows from this plan.

## Reuse and authority

Reuse existing financial snapshots/engine, budgets, goals, purchase simulations, transaction intelligence, forecasts/scenarios, debt strategies, notifications and minimized AI adapters. Add contracts/orchestration in the existing modular architecture before considering another engine or service. No competing canonical financial state, parallel forecast truth or mandatory multi-agent/microservice design.

Confirmed financial evidence -> deterministic engines -> authorized decision evidence and simulation -> explanation/proposal. The LLM can reason, propose, plan and explain; it cannot manufacture balances, confidence, success, permissions or risk policy. Deterministic calculations do not themselves prove that inputs are complete, fresh or mutually consistent. Existing parallel snapshot reads are not automatically an atomic point-in-time guarantee.

## Decision Case

A versioned case binds purpose/problem, explicit user objectives, authorized resource scope, source references/versions/as-of times, evidence quality, assumptions, candidate actions, simulation results, rejection reasons and the do-nothing alternative. Do nothing is always a legitimate candidate, not automatically the safest choice. Insufficient evidence permits and may require abstention. Conflicting objectives must be exposed, not secretly reduced to a model-selected financial score.

Recommendation, authorization, execution, settlement verification and outcome evaluation are separate lifecycle states/records. Capture evaluation evidence from the first recommendation, including rejected/ignored proposals where purpose and retention allow. Store reproducible evidence, not hidden chain-of-thought or raw prompt dumps. Explanations reference supplied evidence and assumptions; unsupported causal claims are not facts.

Uncertainty includes source reliability, coverage, freshness, cross-source consistency, forecast uncertainty, sensitivity to assumptions and execution/settlement uncertainty. Keep confirmed, estimated and hypothetical information distinct. Existing categorical confidence is not a numerical probability of safe execution. Stress/adverse scenarios, provenance gaps and reasons for abstention belong in decisions and approval presentations.

## Capability-scoped authority and execution

OBSERVE / ADVISE / APPROVE / AUTOPILOT are product vocabulary only. Server-enforced authority is scoped by action, accounts/resources, beneficiary, amount/currency, cumulative caps, frequency, expiry, freshness and preconditions. Household viewing permission never implies financial execution authority. Operators retain metadata-only privileges; no cross-user finance access. The model cannot grant/expand permissions or promote its own policy/model version.

Bind explicit approval to the exact action/terms, resource and policy/evidence versions and expiry. Revalidate permission and financial state immediately before execution; material changes invalidate approval. Assess planned/pending actions together and reserve capacity appropriately so independently safe actions cannot consume the same funds twice. Include fees, settlement delays and dependent actions; do not infer execution capability from a simulated option.

Use durable workflows with scoped idempotency, concurrency control, recovery checkpoints and provider-specific reconciliation. Design typed events/outbox/inbox semantics as needed; no global event-sourcing rewrite is mandated. Timeout or unknown result is NOT retry authorization. Represent UNKNOWN / RECONCILIATION_REQUIRED explicitly; provider acceptance is not settlement. Verification must use authoritative evidence independent of the proposal. Compensating action is not a guaranteed rollback of external money movement. Revocation/kill switches stop new work without erasing uncertain in-flight outcomes.

Require explicit approval for new credit/leverage/guarantees, investment trades or risk increases, a new beneficiary or transfer outside a standing mandate, cancellation of essential services/insurance/material obligations, and changes to agent authority. Bounded automation is a revocable per-capability mandate, not trust earned through successful runs. Any expansion requires a separate reviewed product/security/legal gate, not silent graduation.

Open Banking read access is not execution authority. Future real actions require actual provider capabilities, appropriate legal review, credentials, sandbox and production acceptance, fees and error/settlement contracts. Existing Financy staged read/sync/lifecycle acceptance proves none of these future payment capabilities.

## Evaluation, learning and privacy

Separate preference learning, forecast calibration and decision/outcome quality. Acceptance rate, clicks or engagement are not financial benefit. Distinguish forecast error, execution failure, exogenous events and decision quality; observed improvement does not establish causality. Historical replay must use information available at decision time, avoiding future-data leakage and selection bias. Compare against do-nothing and simple deterministic baselines; evaluate false positives, missed risks, adverse outcomes and notification burden.

No RL or experimentation on real money. Risk policy, Safety Margin and permissions never adapt automatically from behavior. Policy/model changes require offline evaluation, shadow mode, explicit promotion and rollback criteria. Advanced causal/uncertainty models are optional future capabilities and must expose identification assumptions and validation limits, not fabricate causal certainty.

Audit/evidence and learning/personalization have separate purposes, access and retention lifecycles, preserving ADR-074 deletion/anti-resurrection rules. Memory is not indefinite raw financial history. Model routing/versioning uses task-specific privacy/capability/evaluation contracts; a stronger model never gains broader authority by substitution.

An Investment Copilot integration receives only explicitly authorized, minimized, dated liquidity/constraint evidence through a versioned contract. Liquidity need is neither a trade instruction nor justification for increased investment risk. No shared credentials, implicit delegation, unrestricted memory or cross-system privilege escalation.

## Future phase gates (not a ceiling)

| Phase | Scope and dependency | Required exit evidence before later capability |
| --- | --- | --- |
| 21 — Decision Foundation & Evaluation | After existing roadmap gates: reusable Decision Case/evidence/uncertainty/objective contracts; evaluation instrumentation and historical replay from day one | Reproducibility, no future-data leakage, permission isolation, abstention and deterministic baseline comparisons; no external execution |
| 22 — Proactive Decision Support | Reuse detection/forecast/scenario engines; prioritize, generate options, simulate and explain | Shadow evaluation, false-positive/missed-risk/notification burden measurement, uncertainty and do-nothing comparison; recommendations only |
| 23 — Human-Approved Execution | Small explicitly selected action catalog, provider/legal gates, scoped approvals, capacity coordination and durable execution | Real provider sandbox/action-specific acceptance, stale/revoked approval denial, duplicate/unknown/partial result recovery and settlement verification; no blanket automation |
| 24 — Outcome Calibration & Personalization | Build on evaluation captured since Phase 21, not delayed collection of history | Separate preference/prediction/decision outcomes; offline/shadow evaluated updates, privacy/deletion and bias checks; no autonomous policy/permission change |
| 25 — Bounded Automation | Only individually proven capabilities and explicitly granted mandates | Cumulative limits, adverse/concurrent cases, revocation, recovery, monitoring, independent outcome verification and safe abstention; not unrestricted autonomy |

Phases 21–25 are a foundation, not a maximum intelligence level. Versioned proposals, simulators, evidence, uncertainty, evaluation and action contracts may later support richer multi-step planning, robust optimization, personalization and new models. New components cannot bypass authority, truth, privacy or execution gates. No particular model, optimizer, numerical risk threshold, provider or legal conclusion is preselected here; material choices require later approval and evidence. No present architectural dead-end was established requiring changes to Phases 18–20.
