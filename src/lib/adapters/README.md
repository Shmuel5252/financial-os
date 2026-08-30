# External adapter boundary

External providers are server-only dependencies of application services. Provider payloads must be validated and normalized here before entering the domain.

Phase 0 intentionally contains no provider implementation. Future adapters must preserve these rules:

- Open Banking never receives or stores bank usernames/passwords in Financial OS. Tokens remain encrypted and server-side; manual and provider data share one normalized domain.
- Claude receives only an authorized, redacted, structured engine snapshot. It never calculates or mutates financial truth.
- Notification adapters receive provider-neutral commands and minimized content.
- Monitoring and analytics exclude raw financial data and credentials by default.

An interface should be introduced with the first real use case, rather than guessing provider contracts in Phase 0.
