# Temporary dependency-audit exception: GHSA-vfj7-8cjw-p6xm (`braces`)

| Field | Value |
|---|---|
| Advisory | GHSA-vfj7-8cjw-p6xm / CVE-2026-93687: stack-exhaustion denial of service through deeply nested brace patterns (CWE-674; CVSS 3.1 7.5, availability only) |
| Affected package | `braces` ≤ 3.0.3. **No patched version is published**; 3.0.3 is the latest release |
| Installed path (the only copy, dev-only) | `eslint-config-next@16.3.8` (root devDependency) → `@next/eslint-plugin-next@16.3.8` → `fast-glob@3.3.1` (pinned exactly by the plugin) → `micromatch@4.0.8` → `braces@3.0.3` |
| Owner approval | 2026-10-04, Option A ("single-advisory gate with expiry, upstream-fix detection and exposure guard") |
| Hard expiry | **2026-11-03 00:00 UTC.** From that instant the gate fails CI. No automatic renewal: an extension needs a new Owner decision on fresh evidence |
| Enforcement | `scripts/audit-gate.mjs`, run in CI as `npm run -s security:audit`. Tests: `tests/unit/audit-gate.test.ts`, a required security module (9 tests) |

## Exposure analysis (read-only investigation, 2026-10-04)

- **Dev/lint tooling only.**
  - `npm audit --omit=dev` reports 0 vulnerabilities, and the lockfile marks every package in the chain `dev: true`.
  - Next.js ships no `braces`. Its `dist/compiled` contains its own `picomatch` and `glob`, which the advisory does not cover.
  - `next build` (Next 16) does not run ESLint, and there is no `vercel.json`. On the build machine the package is installed but neither executed nor bundled.
- **Loaded, never called.**
  - The plugin's only glob call is `getRootDirs`, which runs `fast-glob` only when ESLint `settings.next.rootDir` is configured. This repository configures no `settings`.
  - A load/call trace of the full `npm run lint` showed `braces` loaded (a module-level `require`) with **0 calls**. vitest never loads it.
  - A positive control (a direct `fast-glob` brace pattern) was detected by the same trace.
- **Exploit precondition.** An attacker would have to get a crafted pattern into `braces`. Here that means committing an ESLint config with `next.rootDir`, which requires repository write access. The worst case is a crashed lint process on a developer machine or a throwaway CI runner: CI goes red rather than passing. No production, network or data path reaches it.
- **No compatible fix.**
  - The latest and canary `@next/eslint-plugin-next` both pin `fast-glob@3.3.1`.
  - The latest `fast-glob` (3.3.3) and `micromatch` (4.0.8) still depend on `braces@^3.0.3`.
  - npm's suggested "fix" (`eslint-config-next@14.2.35`) is a semver-major downgrade requiring ESLint 7/8, while this repository runs ESLint 9 with flat config, so it is not applicable.
  - Any override, fork or substitute would be unsupported forcing.

## What the gate allows, and how it fails closed

It runs `npm audit --json` over **all** dependencies, dev included, and passes only if **every** condition below holds. Otherwise it fails CI.

1. **Exactly the approved entries.** The only high/critical entries are the five investigated ones (`braces`, `micromatch`, `fast-glob`, `@next/eslint-plugin-next`, `eslint-config-next`). Each must match the recorded entry exactly: advisory, ranges, nodes, effects and the pinned non-applicable `fixAvailable`. The metadata must show exactly 5 high and 0 critical. **Any other high/critical advisory anywhere fails**, as does a second advisory on an approved package. Moderate and low findings behave as under the previous `--audit-level=high` gate.
2. **Exact installed state.** Each chain package is installed exactly once, at the investigated version, `dev: true`. Each is required only by its parent in the chain, and the root declares `eslint-config-next` only in `devDependencies`.
3. **No fix upstream.** No fix is reported: any other `fixAvailable` value fails. The published `braces` version list must equal the recorded list and `latest` must still be 3.0.3. Any new release fails, patched or not.
4. **Exposure guard.** The only ESLint config is `eslint.config.mjs` (no `.eslintrc*`, no other `eslint.config.*`, no `package.json#eslintConfig`), and it contains no `settings`/`rootDir`. No repository source imports or requires `braces`, `micromatch` or `fast-glob` directly.
5. **Before expiry.** The current time is before 2026-11-03 00:00 UTC.
6. **Well-formed input.** The npm audit, npm registry and lockfile output must be well-formed. Empty, non-JSON, `error` or unexpected-shape output fails, so does an unreachable registry, and so does running the gate without npm (`npm_execpath`).
7. **Still needed.** If the advisory is no longer reported, the gate also fails, so the exception is deleted rather than left dormant.

## Removal

When the gate fails because a patched release exists, a fix is reported, the advisory disappears or the expiry passes, delete:
- `scripts/audit-gate.mjs` and `scripts/audit-gate.d.mts`;
- the test file `tests/unit/audit-gate.test.ts` and its fixtures `tests/fixtures/npm-audit-ghsa-vfj7-8cjw-p6xm.json` and `tests/fixtures/npm-view-braces.json`;
- the required-module entry and the logging-matrix entries.

Then restore `security:audit` to `npm audit --audit-level=high`, and update the dependency if a fix exists. An extension instead requires a new Owner decision.
