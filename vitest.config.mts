import { fileURLToPath } from "node:url";

// The .mts extension keeps Vite configuration loading unambiguously ESM.
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./tests/setup/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    passWithNoTests: false,
    restoreMocks: true,
    // Phase 18 (18-07/18-14/18-20): every test must execute at least one assertion, and CI (REQUIRE_SECURITY_TESTS=1) fails unless
    // every required security test id ran and passed (tests/security/required-tests-reporter.ts).
    expect: { requireAssertions: true },
    reporters: ["default", "./tests/security/required-tests-reporter.ts"],
  },
});
