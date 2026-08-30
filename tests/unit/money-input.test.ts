import { Long } from "mongodb";
import { describe, expect, it } from "vitest";

import {
  fromStoredMoney,
  toStoredMoney,
} from "@/lib/db/money-mapper";
import {
  currencyMinorUnitDigits,
  parseMajorMoney,
} from "@/lib/domain/money/money-input";

describe("money input and persistence boundaries", () => {
  it.each([
    ["ILS", "123.45", 12_345n],
    ["JPY", "123", 123n],
    ["KWD", "123.456", 123_456n],
    ["USD", "-0.01", -1n],
  ])("parses %s %s without floating-point arithmetic", (currency, amount, expected) => {
    expect(parseMajorMoney({ amount, currency }).amountMinor).toBe(expected);
  });

  it("rejects grouping, exponent notation, and excess currency precision", () => {
    expect(() => parseMajorMoney({ amount: "1,000.00", currency: "ILS" })).toThrow();
    expect(() => parseMajorMoney({ amount: "1e3", currency: "ILS" })).toThrow();
    expect(() => parseMajorMoney({ amount: "1.001", currency: "ILS" })).toThrow(
      /at most 2/,
    );
    expect(() => parseMajorMoney({ amount: "1.0", currency: "JPY" })).toThrow(
      /at most 0/,
    );
    expect(() => parseMajorMoney({ amount: "1.00", currency: "ZZZ" })).toThrow(
      /supported ISO 4217/,
    );
  });

  it("uses runtime ISO currency metadata for known minor-unit precision", () => {
    expect(currencyMinorUnitDigits("ILS")).toBe(2);
    expect(currencyMinorUnitDigits("JPY")).toBe(0);
    expect(currencyMinorUnitDigits("KWD")).toBe(3);
  });

  it("round-trips exact BSON int64 values", () => {
    const original = parseMajorMoney({
      amount: "92233720368547758.07",
      currency: "ILS",
    });
    const stored = toStoredMoney(original);

    expect(stored.amountMinor).toBeInstanceOf(Long);
    expect(fromStoredMoney(stored)).toEqual(original);
  });
});
