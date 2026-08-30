import { describe, expect, it } from "vitest";

import {
  addMoney,
  compareMoney,
  deserializeMoney,
  money,
  multiplyMoneyByRatio,
  roundRatioHalfEven,
  serializeMoney,
  subtractMoney,
} from "@/lib/domain/money/money";

describe("money", () => {
  it("stores and serializes exact integer minor units", () => {
    const value = money(12_345n, "ILS");

    expect(serializeMoney(value)).toEqual({
      amountMinor: "12345",
      currency: "ILS",
    });
    expect(deserializeMoney(serializeMoney(value))).toEqual(value);
  });

  it("adds and subtracts matching currencies without number arithmetic", () => {
    expect(addMoney(money(10n, "USD"), money(5n, "USD")).amountMinor).toBe(15n);
    expect(subtractMoney(money(10n, "USD"), money(15n, "USD")).amountMinor).toBe(
      -5n,
    );
  });

  it("rejects arithmetic across currencies", () => {
    expect(() => addMoney(money(1n, "ILS"), money(1n, "USD"))).toThrow(
      /matching currencies/,
    );
    expect(() => compareMoney(money(1n, "EUR"), money(1n, "USD"))).toThrow(
      /matching currencies/,
    );
  });

  it("rejects malformed currency codes and serialized integers", () => {
    expect(() => money(1n, "ils")).toThrow(/ISO 4217/);
    expect(() =>
      deserializeMoney({ amountMinor: "1.5", currency: "ILS" }),
    ).toThrow();
    expect(() =>
      deserializeMoney({ amountMinor: "01", currency: "ILS" }),
    ).toThrow();
  });

  it("enforces the signed BSON int64 persistence range", () => {
    expect(() => money(2n ** 63n, "ILS")).toThrow(/int64/);
    expect(() => money(-(2n ** 63n) - 1n, "ILS")).toThrow(/int64/);
    expect(money(2n ** 63n - 1n, "ILS").amountMinor).toBe(2n ** 63n - 1n);
  });

  it.each([
    [5n, 2n, 2n],
    [7n, 2n, 4n],
    [-5n, 2n, -2n],
    [-7n, 2n, -4n],
    [4n, 3n, 1n],
    [5n, 3n, 2n],
  ])(
    "rounds %s/%s to %s with half-even semantics",
    (numerator, denominator, expected) => {
      expect(roundRatioHalfEven(numerator, denominator)).toBe(expected);
    },
  );

  it("requires an explicit positive divisor for ratio calculations", () => {
    expect(() => roundRatioHalfEven(1n, 0n)).toThrow(/positive/);
  });

  it("applies ratios and rounds once at the minor-unit boundary", () => {
    expect(multiplyMoneyByRatio(money(5n, "ILS"), 1n, 2n)).toEqual(
      money(2n, "ILS"),
    );
    expect(multiplyMoneyByRatio(money(7n, "ILS"), 1n, 2n)).toEqual(
      money(4n, "ILS"),
    );
  });
});
