import type { Reporter, TestModule } from "vitest/node";
import { sinkMatrix } from "./logging-sink-matrix";
import { pageMatrix, routeMatrix, serverActionMatrix } from "./route-authorization-matrix";

// Phase 18 rows 18-07/18-14/18-20: a RUN-TIME check that every security test the inventories rely on was registered, ran and
// passed in this run - not skipped (it.skip, describe.skipIf, a beforeEach/ctx skip), not missing (never registered, empty .each),
// not failed. Together with `expect.requireAssertions` (vitest.config.mts) a passed test also executed at least one assertion.
// Enforced when REQUIRE_SECURITY_TESTS=1 (CI's full `npm test` run); partial local runs are not affected.
export const REQUIRED_SECURITY_TEST_IDS: readonly string[] = [...new Set([
  ...Object.values(sinkMatrix).flatMap((entry) => entry.sentinelTests),
  "log-auth-config", "log-operator-scripts", "log-capture-self-test", "log-validation-key-echo",
  ...[...routeMatrix, ...pageMatrix, ...serverActionMatrix].flatMap((entry) => entry.negativeTests),
])].sort();

export default class RequiredSecurityTestsReporter implements Reporter {
  onTestRunEnd(testModules: ReadonlyArray<TestModule>): void {
    if (process.env.REQUIRE_SECURITY_TESTS !== "1") return;
    const states = new Map<string, string[]>();
    for (const testModule of testModules) {
      for (const test of testModule.children.allTests()) {
        const id = /^\[([a-z0-9-]+)\]/.exec(test.name)?.[1];
        if (id) states.set(id, [...(states.get(id) ?? []), test.result().state]);
      }
    }
    const problems = REQUIRED_SECURITY_TEST_IDS.flatMap((id) => {
      const seen = states.get(id);
      if (!seen) return [`[${id}] was not registered`];
      return seen.every((state) => state === "passed") ? [] : [`[${id}] ${seen.join("/")}`];
    });
    if (problems.length > 0) {
      process.exitCode = 1;
      throw new Error(`Required security tests did not all pass:\n${problems.join("\n")}`);
    }
  }
}
