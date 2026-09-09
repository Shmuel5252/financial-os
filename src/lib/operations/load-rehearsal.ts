/** Offline/injected harness. There is deliberately no HTTP client, cookie loader,
 * mutation payload builder or staging adapter in this module. */
export const loadWorkload = ["dashboard", "financial-read", "reports", "search", "synthetic-write", "readiness"] as const;
type Operation = typeof loadWorkload[number];
type Sample = Readonly<{ durationMs: number; outcome: "ok" | "failure" | "timeout"; phase: "cold" | "warm" }>;
export type LoadTarget = Readonly<{ origin: string; environment: "isolated-local"; syntheticUsers: number; durationMs: number; operatorApprovedFixture: boolean }>;
export function validateLoadTarget(target: LoadTarget): void {
  const url = new URL(target.origin);
  if (url.origin !== "http://localhost:3001" || url.href !== "http://localhost:3001/" || target.environment !== "isolated-local" || target.operatorApprovedFixture !== true || target.syntheticUsers !== 10 || target.durationMs !== 30 * 60_000) throw new Error("Load target is not approved isolated synthetic scope");
}
export function summarizeLoad(samples: readonly Sample[]) {
  const valid = samples.filter(sample => Number.isFinite(sample.durationMs) && sample.durationMs >= 0);
  const values = valid.map(sample => sample.durationMs).sort((a, b) => a - b);
  const percentile = (fraction: number) => values.length ? values[Math.max(0, Math.ceil(values.length * fraction) - 1)]! : null;
  return { requests: samples.length, invalidMeasurements: samples.length - valid.length,
    p50: percentile(.5), p95: percentile(.95), p99: percentile(.99),
    errorRate: samples.length ? samples.filter(sample => sample.outcome !== "ok").length / samples.length : null,
    timeouts: samples.filter(sample => sample.outcome === "timeout").length,
    cold: samples.filter(sample => sample.phase === "cold").length, warm: samples.filter(sample => sample.phase === "warm").length,
    mongoTiming: "requires-instrumented-adapter", resources: "requires-operator-observation" };
}
/** Ten sequential user loops, bounded requests and think time. An approved
 * fixture-aware executor is required; no real/staging execution is implemented. */
export async function rehearseLoad(target: LoadTarget, dependencies: {
  execute: (userIndex: number, operation: Operation, signal: AbortSignal) => Promise<Sample>;
  now: () => number;
  pause: (ms: number) => Promise<void>;
}) {
  validateLoadTarget(target);
  const started = dependencies.now();
  const samples: Sample[] = [];
  await Promise.all(Array.from({ length: 10 }, async (_, user) => {
    for (let iteration = 0; iteration < 1_800 && dependencies.now() - started < target.durationMs; iteration++) {
      // Never repeatedly mutate at a rate above normal product policy.
      const operation = loadWorkload[iteration % loadWorkload.length]!;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const fallback: Sample = { durationMs: 10_000, outcome: "timeout", phase: iteration === 0 ? "cold" : "warm" };
      let sample: Sample;
      try {
        sample = await Promise.race([
          Promise.resolve().then(() => dependencies.execute(user, operation, controller.signal)).catch(() => ({ ...fallback, outcome: "failure" as const })),
          new Promise<Sample>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(fallback); }, 10_000); }),
        ]);
      } finally { if (timer !== undefined) clearTimeout(timer); }
      samples.push(sample);
      if (sample.outcome === "timeout") break; // Never pile work onto an unresponsive executor.
      await dependencies.pause(1_000);
    }
  }));
  return summarizeLoad(samples);
}
