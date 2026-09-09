import { readFileSync } from "node:fs";
import { BSON, Long, ObjectId } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { errorResponse } from "@/lib/http/route-response";
import { recoveryCollections, recoveryPlan, projectAuthLink, bsonIntegrity, validateBsonIntegrity, isExactMoney } from "@/lib/operations/recovery-plan";
import config from "../../next.config";

describe("Phase 18 safe hardening", () => {
  it("never logs mutable exception names, messages or causes", async () => {
    const marker = "SYNTHETIC_PRIVATE_MARKER";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error(marker, { cause: { token: marker } }); error.name = marker;
    const response = errorResponse(error);
    expect(response.status).toBe(500);
    expect(JSON.stringify(spy.mock.calls)).not.toContain(marker);
    expect(JSON.stringify(await response.json())).not.toContain(marker);
    spy.mockRestore();
  });
  it("covers exactly the 52 inventory collections and blocks execution", () => {
    const text = readFileSync("PHASE_18_BACKUP_BOUNDARY.md", "utf8");
    const names = [...text.matchAll(/^\| `([A-Za-z]+)` \|/gm)].map(match => match[1]!);
    expect([...recoveryCollections].sort()).toEqual(names.sort());
    const plan = recoveryPlan(names);
    expect(plan.executable).toBe(false); expect(plan.releaseAllowed).toBe(false);
    for (const name of ["authSessions", "authVerificationTokens"]) expect(plan.collections.find(item => item.name === name)?.action).toBe("exclude");
    expect(() => recoveryPlan(["unknown"])).toThrow("Unreviewed");
    expect(() => recoveryPlan(["profiles", "profiles"])).toThrow("Unreviewed");
  });
  it("projects identity linkage without any token or unknown field", () => {
    const input = { _id: new ObjectId(), userId: new ObjectId(), provider: "google", providerAccountId: "synthetic", type: "oauth", access_token: "SYNTHETIC_SECRET", refresh_token: "SYNTHETIC_SECRET", id_token: "SYNTHETIC_SECRET", unknown: "SYNTHETIC_SECRET" };
    expect(Object.keys(projectAuthLink(input))).toEqual(["_id", "userId", "provider", "providerAccountId", "type"]);
    expect(JSON.stringify(projectAuthLink(input))).not.toContain("SYNTHETIC_SECRET");
  });
  it("preserves signed BSON int64 and rejects tampered bytes", () => {
    const bytes = BSON.serialize({ amount: Long.fromString("-9007199254740993") });
    const digest = bsonIntegrity(bytes);
    expect(validateBsonIntegrity(bytes, digest)).toBe(true);
    const value = BSON.deserialize(bytes, { promoteLongs: false }).amount;
    expect(isExactMoney(value)).toBe(true); expect(value.toString()).toBe("-9007199254740993");
    const altered = bytes.slice(); altered[8] = altered[8]! ^ 1;
    expect(validateBsonIntegrity(altered, digest)).toBe(false);
  });
  it("blocks inline event handlers without breaking Next inline hydration allowance", async () => {
    const headers = (await config.headers!())[0]!.headers;
    const csp = headers.find(header => header.key === "Content-Security-Policy")!.value;
    expect(csp).toContain("script-src-attr 'none'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(headers.find(header => header.key === "Referrer-Policy")?.value).toBe("no-referrer");
    expect(csp).toContain("frame-ancestors 'none'");
  });
  it("keeps visible focus, reduced motion and LTR isolation", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain(":focus-visible"); expect(css).toContain("prefers-reduced-motion"); expect(css).toContain("unicode-bidi: isolate");
  });
});
