// Phase 18 row 18-14: pages and layouts (server components) are an authorization surface too - they read identifiers from params
// and searchParams and authenticate with auth() + actorFromSession. Every server-component page/layout found on disk is rendered as
// two other signed-in users. params and searchParams are RECORDING proxies: every property a page reads is answered with a real
// victim id (account, transaction, loan, goal, budget category, report, household, engine snapshot - rotated across renders), so a
// lookup by id that misses an ownership check renders the victim's data and fails; and every property read must be classified in
// pageMatrix (path / query identifiers), so a new identifier cannot appear unreviewed. The victim's documents must be unchanged.
// Real services and repositories on an isolated loopback MongoDB (synthetic data); only auth() is replaced by a synthetic session.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { call, fingerprint, marker, newActor, openHarness, type Called, type Harness } from "../security/route-harness";
import { pageMatrix } from "../security/route-authorization-matrix";

const session = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/auth", () => ({
  auth: async () => session.userId === "" ? null : { expires: new Date(Date.now() + 3_600_000).toISOString(), user: { id: session.userId } },
  signIn: async () => undefined, signOut: async () => undefined,
}));

const uri = process.env.MONGODB_TEST_URI;
const profile = { countryCode: "IL", displayName: "Synthetic", expectedVersion: null, householdType: "family", primaryCurrency: "ILS", timeZone: "Asia/Jerusalem" };
const ils = (amount: string) => ({ amount, currency: "ILS" });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- parsed test-response JSON
const ok = (response: Called, status = 200) => { expect(response.status, response.text.slice(0, 300)).toBe(status); return response.json as Record<string, any>; };
const SECTIONS = ["accounts", "transactions", "loans", "goals", "income", "cards", "expenses", "safety_margin", "savings", "recurring_transactions"];
const IGNORED_KEYS = new Set(["then", "toJSON", "constructor", "valueOf", "toString", "$$typeof", "asymmetricMatch", "nodeType", "tagName"]);

/** Server-component pages and layouts on disk (client components cannot read server data and are classified separately). */
function serverComponents(): string[] {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name); return statSync(path).isDirectory() ? walk(path) : /[\\/](page|layout)\.[a-z]+$/.test(path) ? [path] : [];
  });
  return walk("src/app").filter((path) => !/^\s*["']use client["']/m.test(readFileSync(path, "utf8")))
    .map((path) => relative("src/app", path).split(sep).join("/")).sort();
}
/** Every string/number reachable in a rendered element tree (props, children, nested server-component props). */
function texts(value: unknown): string {
  const seen = new WeakSet<object>(); const parts: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string") { parts.push(v); return; }
    if (typeof v === "number" || typeof v === "bigint") { parts.push(String(v)); return; }
    if (typeof v !== "object" || v === null || seen.has(v)) return;
    seen.add(v);
    for (const key of Object.keys(v)) if (key !== "_owner" && key !== "_store") walk((v as Record<string, unknown>)[key]);
  };
  walk(value); return parts.join("\n");
}
/** An object whose every read is recorded and, unless given, answered with `fallback` (a victim id). */
function recording(base: Record<string, string>, fallback: string, reads: Set<string>): Record<string, string> {
  return new Proxy({ ...base }, {
    get(target, key) {
      if (typeof key !== "string" || IGNORED_KEYS.has(key)) return Reflect.get(target, key);
      reads.add(key); return key in target ? target[key] : fallback;
    },
  });
}
const allowedThrow = (error: unknown) => {
  const digest = (error as { digest?: unknown }).digest; const code = (error as { code?: unknown }).code;
  return (typeof digest === "string" && /^(NEXT_REDIRECT|NEXT_HTTP_ERROR_FALLBACK|NEXT_NOT_FOUND)/.test(digest)) || code === "NOT_FOUND" || code === "INVALID_INPUT";
};
const classifiedNames = (file: string, source: "path" | "query") =>
  new Set(pageMatrix.find((e) => e.file === `src/app/${file}`)?.identifiers.filter((i) => i.source === source).flatMap((i) => i.name.split(/[^A-Za-z0-9_]+/)).filter(Boolean) ?? []);

(uri ? describe : describe.skip)("page isolation through real server components (18-14)", () => {
  let h: Harness;
  const victim = newActor(); const settled = newActor(); const onboarding = newActor();
  const m = { account: marker("v-page-account"), merchant: marker("v-page-merchant"), goal: marker("v-page-goal"), category: marker("v-page-category"),
    household: marker("v-page-household"), loan: marker("v-page-loan") };
  const victimIds: string[] = [];
  let householdId = "";
  const as = (actor: { userId: string }) => { session.userId = actor.userId; };

  beforeAll(async () => {
    h = await openHarness(uri!);
    vi.stubEnv("GOOGLE_CLIENT_ID", "synthetic-client"); vi.stubEnv("GOOGLE_CLIENT_SECRET", "synthetic-secret");
    for (const [actor, email] of [[victim, "victim@example.invalid"], [settled, "settled@example.invalid"], [onboarding, "onboarding@example.invalid"]] as const) {
      await h.db.collection("authUsers").insertOne({ _id: new ObjectId(actor.userId), email, name: email.split("@")[0] });
      as(actor); ok(await call("profile", "PUT", { body: profile }));
    }
    for (const actor of [victim, settled]) {
      await h.db.collection("profiles").updateOne({ userId: new ObjectId(actor.userId) }, { $set: { "onboarding.status": "complete", "onboarding.completedAt": new Date() } });
    }
    as(victim);
    const post = async (section: string, fields: unknown) =>
      ok(await call("financial-data/[section]", "POST", { params: { section }, body: { idempotencyKey: randomUUID(), fields } }), 201).record.id as string;
    const account = await post("accounts", { balance: ils("900.00"), name: m.account, type: "bank" });
    const transaction = await post("transactions", { accountId: account, amount: ils("12.00"), category: "food", confidenceBps: 10_000, date: "2026-09-05",
      destinationAccountId: null, merchant: m.merchant, notes: null, recurring: false, type: "expense" });
    const loan = await post("loans", { annualInterestRateBps: 300, endDate: null, monthlyPayment: ils("10.00"), name: m.loan, nextPaymentDate: "2026-11-01",
      originalAmount: ils("100.00"), remainingBalance: ils("90.00") });
    const goal = await post("goals", { currentValue: ils("1.00"), priority: 1, startingValue: ils("0.00"), targetAmount: ils("50.00"), targetDate: "2027-06-30", title: m.goal, type: "custom" });
    const category = ok(await call("budgets/categories", "POST", { body: { idempotencyKey: randomUUID(), label: m.category, rolloverPolicy: "reset" } }), 201).category.categoryId as string;
    ok(await call("budgets/periods", "PUT", { body: { allocations: [{ amount: ils("5.00"), categoryId: category }], calendarMonth: "2020-01", expectedVersion: null } }));
    const engine = ok(await call("financial-engine/snapshots", "POST", { body: { idempotencyKey: randomUUID(), horizonDays: 90 } }), 201).snapshot.id as string;
    householdId = ok(await call("households", "POST", { body: { idempotencyKey: randomUUID(), name: m.household } }), 201).household.id;
    ok(await call("households/[householdId]/shares", "POST", { params: { householdId }, body: { action: "share", expectedVersion: null, resourceId: account, resourceKind: "account" } }));
    const report = ok(await call("reports", "POST", { body: { action: "close", idempotencyKey: randomUUID(), period: { kind: "month", value: "2026-09" }, scope: { kind: "personal" } } }), 201).report.id as string;
    victimIds.push(account, transaction, loan, goal, category, report, householdId, engine);
  }, 120_000);
  afterAll(async () => { session.userId = ""; await h?.dispose(); });

  async function render(file: string, params: Record<string, string>, searchParams: Record<string, string>): Promise<{ text?: string; threw?: unknown }> {
    const component = (await import(/* @vite-ignore */ `@/app/${file.replace(/\.[a-z]+$/, "")}`)) as { default: (props: unknown) => unknown };
    try { return { text: texts(await component.default({ children: null, params: Promise.resolve(params), searchParams: Promise.resolve(searchParams) })) }; }
    catch (error) { return { threw: error }; }
  }

  it("[iso-page-sweep] no page or layout renders anything of another user, whatever victim ids it reads from params or searchParams", async () => {
    const files = serverComponents();
    expect(files.length).toBeGreaterThan(20);
    const forbidden = [...Object.values(m), victim.userId];
    const victimBefore = await fingerprint(h.db, victim.userId);
    let rendered = 0;
    for (const file of files) {
      const paramReads = new Set<string>(); const queryReads = new Set<string>();
      const segments = [...file.matchAll(/\[(?:\.\.\.)?([A-Za-z]+)\]/g)].map(([, name]) => name!);
      const pathNames = classifiedNames(file, "path"); const queryNames = classifiedNames(file, "query");
      for (const segment of segments) expect(pathNames.has(segment), `${file}: dynamic segment [${segment}] must be classified`).toBe(true);
      const sectionValues = segments.includes("section") ? SECTIONS : [undefined];
      for (const actor of [settled, onboarding]) for (const section of sectionValues) for (const fallback of victimIds)
        for (const base of [{}, { periodKind: "month", periodValue: "2026-09" }, { month: "2020-01" }]) {
          as(actor);
          const params = recording(section === undefined ? {} : { section }, fallback, paramReads);
          const result = await render(file, params, recording(base, fallback, queryReads));
          if (result.threw !== undefined) {
            if (!allowedThrow(result.threw)) throw new Error(`${file} threw: ${(result.threw as Error).message}`);
            continue;
          }
          rendered += 1;
          for (const value of forbidden) if (result.text!.includes(value)) throw new Error(`${file} disclosed victim data (${value.slice(0, 10)}…) reading victim id ${fallback}`);
        }
      for (const key of paramReads) expect(pathNames.has(key), `${file}: reads params.${key} - classify it in pageMatrix`).toBe(true);
      for (const key of queryReads) expect(queryNames.has(key), `${file}: reads searchParams.${key} - classify it in pageMatrix`).toBe(true);
    }
    expect(rendered).toBeGreaterThan(files.length * 10); // most renders really rendered (not only redirects/refusals)
    expect(await fingerprint(h.db, victim.userId)).toEqual(victimBefore); // rendering pages as other users changed nothing of the victim's
  }, 600_000);

  it("[iso-page-household] the households page refuses another household's id; the oracle sees the owner's data", async () => {
    as(settled);
    const foreign = await render("households/page.tsx", {}, { household: householdId });
    expect(allowedThrow(foreign.threw)).toBe(true);
    expect((foreign.threw as { code?: string }).code).toBe("NOT_FOUND");
    as(victim);
    expect((await render("households/page.tsx", {}, { household: householdId })).text).toContain(m.account); // positive control
    expect((await render("financial-data/[section]/page.tsx", { section: "accounts" }, {})).text).toContain(m.account); // positive control
  });
});
