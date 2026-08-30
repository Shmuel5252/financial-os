import { describe, expect, it } from "vitest";

import {
  assertTrustedMutationOrigin,
  readJsonBody,
} from "@/lib/http/request-guards";

describe("mutation request guards", () => {
  it("accepts the exact configured origin", () => {
    process.env.AUTH_URL = "http://localhost:3000";

    expect(() =>
      assertTrustedMutationOrigin(
        new Request("http://localhost:3000/api/profile", {
          headers: {
            Origin: "http://localhost:3000",
          },
          method: "PUT",
        }),
      ),
    ).not.toThrow();
  });

  it("rejects missing and cross-origin mutation requests", () => {
    process.env.AUTH_URL = "http://localhost:3000";

    expect(() =>
      assertTrustedMutationOrigin(
        new Request("http://localhost:3000/api/profile", {
          method: "PUT",
        }),
      ),
    ).toThrow(/origin/);

    expect(() =>
      assertTrustedMutationOrigin(
        new Request("http://localhost:3000/api/profile", {
          headers: {
            Origin: "https://attacker.example",
          },
          method: "PUT",
        }),
      ),
    ).toThrow(/origin/);
  });

  it("accepts bounded JSON and rejects other content types", async () => {
    await expect(
      readJsonBody(
        new Request("http://localhost:3000/api/profile", {
          body: JSON.stringify({ displayName: "Dana" }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "PUT",
        }),
      ),
    ).resolves.toEqual({ displayName: "Dana" });

    await expect(
      readJsonBody(
        new Request("http://localhost:3000/api/profile", {
          body: "displayName=Dana",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          method: "PUT",
        }),
      ),
    ).rejects.toThrow(/invalid/i);
  });

  it("rejects oversized JSON without relying on content-length", async () => {
    const body = JSON.stringify({ value: "a".repeat(16_384) });

    await expect(
      readJsonBody(
        new Request("http://localhost:3000/api/profile", {
          body,
          headers: {
            "Content-Type": "application/json",
          },
          method: "PUT",
        }),
      ),
    ).rejects.toMatchObject({
      issues: [{ field: "body", message: "Request body is too large." }],
    });
  });
});
