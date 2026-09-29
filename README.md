# Financial OS

Financial OS is being built phase by phase from `MASTER_PLAN.md`. Phases 0–17 have recorded acceptance (Phase 9 at its documented staged-provider boundary); Phase 18 remains in progress and unaccepted. New builders must start with [DEVELOPER_HANDOFF.md](DEVELOPER_HANDOFF.md) for the current checkpoint, preserved uncommitted work, evidence limitations and continuation instructions.

## Local setup

1. Install Node.js 20.9 or newer and use `npm ci` with the committed lockfile when dependencies need installing.
2. For a new checkout only, configure `.env.local` privately from `.env.example`. Preserve an existing file; never overwrite, print or commit it. Missing credentials are an explicit gate, not permission to copy staging secrets.
3. Configure a Google OAuth web client callback for `/api/auth/callback/google` and a least-privilege MongoDB database user.
4. Run `npm run dev -- --port 3001`. Do not use or disturb port 3000, which belongs to an unrelated application.

Without credentials, the application still lints, tests, type-checks, and builds. Auth requests return an explicit unavailable response; no fake user or fake database is used.

## Verification commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run security:audit`

A real MongoDB isolation check runs only when `MONGODB_TEST_URI` points to an isolated test database. A missing value is reported as a skipped credential-dependent integration test, not as a successful live integration.

## Documentation

- `MASTER_PLAN.md` — authoritative Product & Engineering Master Plan
- `ARCHITECTURE.md` — system boundaries and invariants
- `IMPLEMENTATION_PLAN.md` — Phase 0 through Phase 20 roadmap
- `DECISIONS.md` — durable architecture/product decisions
- `PROGRESS.md` — verified milestone record
