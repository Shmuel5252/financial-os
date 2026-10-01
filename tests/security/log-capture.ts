import { randomBytes } from "node:crypto";
import { inspect } from "node:util";
import { expect, vi } from "vitest";

// Sentinel helpers for the 18-07/18-20 logging tests. Values are synthetic and generated per run (never committed literals, so
// the secret scanner has nothing to match and a stale value cannot make a test pass).
const hex = (bytes: number) => randomBytes(bytes).toString("hex");

export function sentinels() {
  const id = hex(4);
  const values = {
    anthropicKey: ["sk", "ant", "api03", hex(24)].join("-"),
    resendKey: `re_${hex(16)}`,
    bearer: `ya29.${hex(24)}`,
    sessionToken: `${hex(8)}-${hex(4)}-${hex(4)}`,
    jwt: [Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url"), Buffer.from(JSON.stringify({ sub: hex(8) })).toString("base64url"), hex(16)].join("."),
    email: `sentinel.${id}@example.test`,
    userId: hex(12),
    resourceId: hex(12),
    householdId: hex(12),
    amountMinor: `${7_000_000_000 + Number.parseInt(hex(3), 16)}`,
    amountText: `₪${Number.parseInt(hex(3), 16)},${Number.parseInt(hex(1), 16)}9.37`,
    merchant: `Sentinel Merchant ${id}`,
    hebrewNote: `הערה פיננסית רגישה ${id}`,
    providerMessageId: `msg-${hex(10)}`,
  };
  const url = `https://api.example.test/v1/emails/${values.providerMessageId}?token=${values.bearer}&email=${encodeURIComponent(values.email)}&amount=${values.amountMinor}`;
  return { ...values, url, list: Object.values(values) };
}
export type Sentinels = ReturnType<typeof sentinels>;

/** A hostile value that hides every sentinel in nested objects, arrays, an Error (message, cause, stack, extra props), a URL and headers. */
export function hostile(s: Sentinels): Record<string, unknown> {
  const cause = Object.assign(new Error(`cause ${s.email} ${s.anthropicKey}`), { keyValue: { email: s.email }, errmsg: `E11000 duplicate key { email: "${s.email}" }` });
  const error = Object.assign(new Error(`failed for ${s.userId} amount ${s.amountMinor} at ${s.url}`, { cause }), {
    response: { headers: { authorization: `Bearer ${s.bearer}` }, body: `{"merchant":"${s.merchant}"}` }, config: { url: s.url },
  });
  error.stack = `Error: ${s.hebrewNote}\n    at ${s.url}`;
  return {
    message: s.merchant, email: s.email, userId: s.userId, nested: { deeper: { deepest: [s.resourceId, { amount: s.amountText, note: s.hebrewNote }] } },
    list: [s.jwt, [s.sessionToken, s.householdId]], error, url: new URL(s.url), headers: new Headers({ authorization: `Bearer ${s.bearer}`, cookie: `authjs.session-token=${s.sessionToken}`, "x-api-key": s.resendKey }),
    map: new Map([[s.email, s.amountMinor]]), toString: () => s.anthropicKey, toJSON: () => ({ key: s.anthropicKey, providerMessageId: s.providerMessageId }),
  };
}

/** Deep text of everything that was handed to an output (inspect with hidden properties, unlimited depth, plus JSON). */
export function dump(values: readonly unknown[]): string {
  return values.map((value) => {
    if (typeof value === "string") return value;
    if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
    let json = ""; try { json = JSON.stringify(value) ?? ""; } catch { /* circular or BigInt: inspect below still sees everything */ }
    return `${inspect(value, { depth: Infinity, showHidden: true, getters: true, maxArrayLength: Infinity, maxStringLength: Infinity })}\n${json}`;
  }).join("\n");
}

/** Every recognisable form of each sentinel: raw, URL-encoded, JSON-escaped, base64/base64url, hex; case-insensitive; and, for long
 * values, their distinctive tail (a truncated leak still fails). */
export function expectNoSentinel(text: string, s: Sentinels, where: string) {
  const haystack = text.toLowerCase();
  for (const value of s.list) {
    const bytes = Buffer.from(value, "utf8");
    const forms = new Set([value, encodeURIComponent(value), JSON.stringify(value).slice(1, -1), bytes.toString("base64").replace(/=+$/, ""),
      bytes.toString("base64url"), bytes.toString("hex"), ...(value.length >= 20 ? [value.slice(-12)] : [])]);
    for (const form of forms) expect(haystack.includes(form.toLowerCase()), `${where}: leaked ${form.slice(0, 12)}...`).toBe(false);
  }
}

/** Captures every console method and both process streams for the duration of a test (restored by vitest's restoreMocks). */
export function captureOutput(): unknown[][] {
  const calls: unknown[][] = [];
  const target = console as unknown as Record<string, (...args: unknown[]) => void>;
  for (const level of Object.keys(target)) {
    if (typeof target[level] !== "function") continue;
    vi.spyOn(target, level).mockImplementation((...args: unknown[]) => { calls.push([level, ...args]); });
  }
  for (const stream of [process.stdout, process.stderr]) {
    vi.spyOn(stream, "write").mockImplementation(((chunk: unknown) => { calls.push(["stream", chunk]); return true; }) as typeof stream.write);
  }
  return calls;
}
