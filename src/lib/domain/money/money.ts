import { z } from "zod";

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const INTEGER_PATTERN = /^-?(0|[1-9]\d*)$/;

declare const currencyBrand: unique symbol;

export type CurrencyCode = string & {
  readonly [currencyBrand]: true;
};

export type Money = Readonly<{
  amountMinor: bigint;
  currency: CurrencyCode;
}>;

export type SerializedMoney = Readonly<{
  amountMinor: string;
  currency: string;
}>;

export const serializedMoneySchema = z.object({
  amountMinor: z.string().regex(INTEGER_PATTERN),
  currency: z.string().regex(CURRENCY_PATTERN),
});

export function currencyCode(value: string): CurrencyCode {
  if (!CURRENCY_PATTERN.test(value)) {
    throw new RangeError("Currency must be an uppercase three-letter ISO 4217 code.");
  }

  return value as CurrencyCode;
}

function assertInt64(value: bigint): void {
  if (value < INT64_MIN || value > INT64_MAX) {
    throw new RangeError("Money amount is outside the supported signed int64 range.");
  }
}

export function money(amountMinor: bigint, currency: string): Money {
  assertInt64(amountMinor);

  return Object.freeze({
    amountMinor,
    currency: currencyCode(currency),
  });
}

function assertSameCurrency(left: Money, right: Money): void {
  if (left.currency !== right.currency) {
    throw new RangeError("Money arithmetic requires matching currencies.");
  }
}

export function addMoney(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  return money(left.amountMinor + right.amountMinor, left.currency);
}

export function subtractMoney(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  return money(left.amountMinor - right.amountMinor, left.currency);
}

export function compareMoney(left: Money, right: Money): -1 | 0 | 1 {
  assertSameCurrency(left, right);

  if (left.amountMinor < right.amountMinor) {
    return -1;
  }

  if (left.amountMinor > right.amountMinor) {
    return 1;
  }

  return 0;
}

export function serializeMoney(value: Money): SerializedMoney {
  return {
    amountMinor: value.amountMinor.toString(),
    currency: value.currency,
  };
}

export function deserializeMoney(value: unknown): Money {
  const parsed = serializedMoneySchema.parse(value);
  return money(BigInt(parsed.amountMinor), parsed.currency);
}

export function roundRatioHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new RangeError("The denominator must be positive.");
  }

  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const absoluteRemainder = remainder < 0n ? -remainder : remainder;
  const doubledRemainder = absoluteRemainder * 2n;

  if (doubledRemainder < denominator) {
    return quotient;
  }

  const step = numerator < 0n ? -1n : 1n;

  if (doubledRemainder > denominator) {
    return quotient + step;
  }

  return quotient % 2n === 0n ? quotient : quotient + step;
}

export function multiplyMoneyByRatio(
  value: Money,
  numerator: bigint,
  denominator: bigint,
): Money {
  const rounded = roundRatioHalfEven(
    value.amountMinor * numerator,
    denominator,
  );
  return money(rounded, value.currency);
}
