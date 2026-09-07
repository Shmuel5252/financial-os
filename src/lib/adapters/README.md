# External adapter boundary

External providers are server-only dependencies of application services. Provider payloads must be validated and normalized here before entering the domain.

Adapters must preserve these rules:

- Open Banking never receives or stores bank usernames/passwords in Financial OS. Tokens remain encrypted and server-side; manual and provider data share one normalized domain.
- Claude receives only an authorized, redacted, structured engine snapshot. It never calculates or mutates financial truth.
- Notification adapters receive provider-neutral commands and minimized content.
- Monitoring and analytics exclude raw financial data and credentials by default.

Phase 9 implements the first real use case through a provider-neutral Open Banking port and server-only Financy adapter. It validates provider responses, parses financial JSON number lexemes without floating point, aliases external identifiers before persistence, caches the short-lived bearer token only in process memory, and exposes no payment operation. Operational recovery and lifecycle procedures are in `OPEN_BANKING_RUNBOOK.md`.
