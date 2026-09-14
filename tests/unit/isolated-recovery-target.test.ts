import { describe, expect, it } from "vitest";
import { validateRecoveryLoopback } from "@/lib/operations/isolated-recovery-target";

describe("isolated recovery target guard", () => {
  it("accepts only bare loopback Mongo endpoints", () => {
    for (const value of ["mongodb://localhost:27017", "mongodb://127.0.0.1:27017", "mongodb://[::1]:27017"])
      expect(() => validateRecoveryLoopback(value)).not.toThrow();
  });
  it("rejects staging/production namespaces, external hosts, credentials, options and application ports", () => {
    for (const value of ["mongodb://localhost/financial_os_staging", "mongodb://localhost/production", "mongodb://example.invalid", "mongodb+srv://example.invalid", "mongodb://localhost:3000", "mongodb://localhost:3001", "mongodb://localhost?replicaSet=x", "mongodb://synthetic:placeholder@localhost", "mongodb://localhost,example.invalid"])
      expect(() => validateRecoveryLoopback(value)).toThrow("Isolated recovery target required");
  });
});
