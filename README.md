# Financial OS

Financial OS is being built phase by phase from the requirements in `MASTER_PLAN.md`. Phase 0 establishes the secure application and engineering foundation only; it intentionally contains no financial profile, dashboard, or Safe to Spend implementation.

## Local setup

1. Install Node.js 20.9 or newer and run `npm install`.
2. Copy `.env.example` to `.env.local` and replace placeholders with real development credentials. Never commit that file.
3. Configure a Google OAuth web client callback for `/api/auth/callback/google` and a least-privilege MongoDB database user.
4. Run `npm run dev`.

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
