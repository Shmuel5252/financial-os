import { readFileSync, writeFileSync } from "node:fs";
import { files } from "./live-test-ids";
import type { Reporter, TestModule } from "vitest/node";
import { sinkMatrix } from "./logging-sink-matrix";
import { pageMatrix, routeMatrix, serverActionMatrix } from "./route-authorization-matrix";

// Phase 18 rows 18-07/18-14/18-20: a RUN-TIME check, enforced when REQUIRE_SECURITY_TESTS=1 (CI's full `npm test` run):
// 1. every required security test id was registered, ran and passed - not skipped (it.skip, describe.skipIf, a beforeEach/ctx
//    skip), not missing (never registered, empty .each, removed file), not failed;
// 2. every test titled with an `[id]` that did run passed (no skipped/failed security test hides behind a non-required id);
// 3. every test in the security inventory modules (whose tests carry no id) was registered and passed - none skipped or removed;
// 4. the verdict is written to SECURITY_TESTS_MARKER, which a separate CI step requires: a run in which this reporter did not run
//    at all (e.g. a `--reporter` flag replacing the configured reporters) leaves no marker and fails CI.
// Together with `expect.requireAssertions` (vitest.config.mts), every passed test also executed at least one assertion.
export const REQUIRED_SECURITY_TEST_IDS: readonly string[] = [...new Set([
  ...Object.values(sinkMatrix).flatMap((entry) => entry.sentinelTests),
  ...[...routeMatrix, ...pageMatrix, ...serverActionMatrix].flatMap((entry) => entry.negativeTests),
  // Every `[iso-…]` / `[log-…]` id written in any test title (live or not): a security test cited in the evidence cannot drop out.
  ...files("tests", (path) => /\.test\.(ts|tsx)$/.test(path))
    .flatMap((path) => [...readFileSync(path, "utf8").matchAll(/["'`]\[((?:iso|log)-[a-z0-9-]+)\]/g)].map((match) => match[1]!)),
])].sort();

/** Inventory modules (tests without ids) -> exact number of tests that must run and pass. Update deliberately when adding tests. */
export const REQUIRED_SECURITY_MODULES: Readonly<Record<string, number>> = {
  "tests/unit/data-classification.test.ts": 12,
  "tests/unit/logging-sink-inventory.test.ts": 9,
  "tests/unit/logging-sentinels.test.ts": 11,
  "tests/unit/route-authorization-inventory.test.ts": 6,
  "tests/unit/phase-eighteen-inventory.test.ts": 2,
};

export default class RequiredSecurityTestsReporter implements Reporter {
  onTestRunEnd(testModules: ReadonlyArray<TestModule>): void {
    if (process.env.REQUIRE_SECURITY_TESTS !== "1") return;
    const states = new Map<string, string[]>();
    const modules = new Map<string, string[]>();
    for (const testModule of testModules) {
      const file = testModule.moduleId.replaceAll("\\", "/").replace(/^.*?(?=tests\/)/, "");
      for (const test of testModule.children.allTests()) {
        const state = test.result().state;
        modules.set(file, [...(modules.get(file) ?? []), state]);
        const id = /^\[([a-z0-9-]+)\]/.exec(test.name)?.[1];
        if (id) states.set(id, [...(states.get(id) ?? []), state]);
      }
    }
    const problems = [
      ...REQUIRED_SECURITY_TEST_IDS.filter((id) => !states.has(id)).map((id) => `[${id}] was not registered`),
      ...[...states].filter(([, seen]) => !seen.every((state) => state === "passed")).map(([id, seen]) => `[${id}] ${seen.join("/")}`),
      ...Object.entries(REQUIRED_SECURITY_MODULES).flatMap(([file, count]) => {
        const seen = modules.get(file) ?? [];
        const passed = seen.filter((state) => state === "passed").length;
        return passed === count && seen.length === count ? [] : [`${file}: ${passed}/${seen.length} passed, ${count} required`];
      }),
    ];
    if (process.env.SECURITY_TESTS_MARKER) {
      writeFileSync(process.env.SECURITY_TESTS_MARKER, JSON.stringify({ ok: problems.length === 0, required: REQUIRED_SECURITY_TEST_IDS.length, problems }));
    }
    if (problems.length > 0) {
      process.exitCode = 1;
      throw new Error(`Required security tests did not all pass:\n${problems.join("\n")}`);
    }
  }
}
