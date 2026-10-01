// Phase 18 row 18-14: pages (server components) are an authorization surface too - they read identifiers from params and
// searchParams and authenticate with auth() + actorFromSession. Every page.tsx found on disk is rendered as two other signed-in
// users (onboarding complete / in progress) with the victim's identifiers in params and searchParams; the rendered element tree
// must contain nothing of the victim. Real services and repositories on an isolated loopback MongoDB (synthetic data); only the
// Auth.js session lookup (auth()) is replaced by a synthetic session for the chosen user. New pages are included automatically.
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { call, marker, newActor, openHarness, type Called, type Harness } from "../security/route-harness";

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

function pages(): string[] {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name); return statSync(path).isDirectory() ? walk(path) : /[\\/]page\.(tsx|ts|jsx|js)$/.test(path) ? [path] : [];
  });
  return walk("src/app").map((path) => relative("src/app", path).split(sep).join("/")).sort();
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
const allowedThrow = (error: unknown) => {
  const digest = (error as { digest?: unknown }).digest;
  return (typeof digest === "string" && /^(NEXT_REDIRECT|NEXT_HTTP_ERROR_FALLBACK|NEXT_NOT_FOUND)/.test(digest))
    || (error as { code?: unknown }).code === "NOT_FOUND";
};

(uri ? describe : describe.skip)("page isolation through real server components (18-14)", () => {
  let h: Harness;
  const victim = newActor(); const settled = newActor(); const onboarding = newActor();
  const m = { account: marker("v-page-account"), merchant: marker("v-page-merchant"), goal: marker("v-page-goal"), category: marker("v-page-category"),
    household: marker("v-page-household") };
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
    await post("transactions", { accountId: account, amount: ils("12.00"), category: "food", confidenceBps: 10_000, date: "2026-09-05",
      destinationAccountId: null, merchant: m.merchant, notes: null, recurring: false, type: "expense" });
    await post("goals", { currentValue: ils("1.00"), priority: 1, startingValue: ils("0.00"), targetAmount: ils("50.00"), targetDate: "2027-06-30", title: m.goal, type: "custom" });
    const category = ok(await call("budgets/categories", "POST", { body: { idempotencyKey: randomUUID(), label: m.category, rolloverPolicy: "reset" } }), 201).category.categoryId;
    ok(await call("budgets/periods", "PUT", { body: { allocations: [{ amount: ils("5.00"), categoryId: category }], calendarMonth: "2020-01", expectedVersion: null } }));
    ok(await call("financial-engine/snapshots", "POST", { body: { idempotencyKey: randomUUID(), horizonDays: 90 } }), 201);
    householdId = ok(await call("households", "POST", { body: { idempotencyKey: randomUUID(), name: m.household } }), 201).household.id;
    ok(await call("households/[householdId]/shares", "POST", { params: { householdId }, body: { action: "share", expectedVersion: null, resourceId: account, resourceKind: "account" } }));
    ok(await call("reports", "POST", { body: { action: "close", idempotencyKey: randomUUID(), period: { kind: "month", value: "2026-09" }, scope: { kind: "personal" } } }), 201);
  }, 120_000);
  afterAll(async () => { session.userId = ""; await h?.dispose(); });

  async function render(file: string, params: Record<string, string>, searchParams: Record<string, string>): Promise<{ text?: string; threw?: unknown }> {
    const page = (await import(/* @vite-ignore */ `@/app/${file.replace(/\.(tsx|ts|jsx|js)$/, "")}`)) as { default: (props: unknown) => unknown };
    try { return { text: texts(await page.default({ params: Promise.resolve(params), searchParams: Promise.resolve(searchParams) })) }; }
    catch (error) { return { threw: error }; }
  }

  it("[iso-page-sweep] no page renders anything of another user, whatever identifiers are put in params or searchParams", async () => {
    const files = pages();
    expect(files.length).toBeGreaterThan(20);
    const forbidden = [...Object.values(m), victim.userId];
    const variants = [{}, { household: householdId }, { scope: householdId, periodKind: "month", periodValue: "2026-09" }, { month: "2020-01" }];
    let rendered = 0;
    for (const file of files) {
      const sections = file.includes("[section]") ? SECTIONS : [""];
      for (const actor of [settled, onboarding]) for (const section of sections) for (const searchParams of variants) {
        as(actor);
        const result = await render(file, section === "" ? {} : { section }, searchParams);
        if (result.threw !== undefined) {
          if (!allowedThrow(result.threw)) throw new Error(`${file} (${JSON.stringify(searchParams)}) threw: ${(result.threw as Error).message}`);
          continue;
        }
        rendered += 1;
        for (const value of forbidden) if (result.text!.includes(value)) throw new Error(`${file} disclosed victim data (${value.slice(0, 8)}…) for ${JSON.stringify(searchParams)}`);
      }
    }
    expect(rendered).toBeGreaterThan(files.length); // most pages really rendered (not only redirects)
  }, 300_000);

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
