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
  },
});
