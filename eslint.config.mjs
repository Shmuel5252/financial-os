import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  { rules: { "no-eval": "error", "no-implied-eval": "error", "no-new-func": "error" } },
  globalIgnores([
    ".next/**",
    "coverage/**",
    "node_modules/**",
    "out/**",
    "next-env.d.ts",
  ]),
]);
