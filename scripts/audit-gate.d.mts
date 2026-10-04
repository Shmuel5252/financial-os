export const EXCEPTION: Readonly<{ advisory: string; approved: string; expiresAt: string; chain: readonly (readonly [string, string])[]; bracesVersions: readonly string[]; bracesLatest: string }>;
export function evaluateAuditGate(input: { auditText: string; registryText: string; lock: unknown; eslintConfigs: { path: string; text: string }[]; directImports: string[]; now: Date }): string[];
export function collectRepoGuards(root?: string): { eslintConfigs: { path: string; text: string }[]; directImports: string[] };
export function runAuditGate(): boolean;
