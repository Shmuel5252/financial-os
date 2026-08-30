import { describe, expect, it } from "vitest";

import {
  financialOsAuthCollections,
  financialOsMongoAdapterOptions,
} from "@/lib/auth/persistence";

describe("Auth.js MongoDB persistence", () => {
  it("uses the configured Financial OS database", () => {
    expect(financialOsMongoAdapterOptions("financial_os_test").databaseName).toBe(
      "financial_os_test",
    );
  });

  it("namespaces every Auth.js collection away from financial collections", () => {
    const names = Object.values(financialOsAuthCollections);

    expect(new Set(names).size).toBe(4);
    expect(names).not.toContain("accounts");
    expect(names).not.toContain("users");
    expect(names).not.toContain("sessions");
    expect(names.every((name) => name.startsWith("auth"))).toBe(true);
  });
});
