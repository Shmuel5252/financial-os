import { z } from "zod";

import {
  currencyCode,
  money,
  type Money,
} from "@/lib/domain/money/money";

const MAJOR_AMOUNT_PATTERN = /^-?(0|[1-9]\d*)(\.\d+)?$/;
const supportedCurrencies = new Set(Intl.supportedValuesOf("currency"));

export const supportedCurrencyCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/)
  .refine(
    (value) => supportedCurrencies.has(value),
    "Use a supported ISO 4217 currency code.",
  );

export const moneyInputSchema = z.object({
  amount: z.string().trim().regex(MAJOR_AMOUNT_PATTERN, {
    message: "Use an ungrouped decimal amount.",
  }),
  currency: supportedCurrencyCodeSchema,
});

export type MoneyInput = z.input<typeof moneyInputSchema>;

export function currencyMinorUnitDigits(currency: string): number {
  const normalized = supportedCurrencyCodeSchema.parse(currencyCode(currency));
  const options = new Intl.NumberFormat("en", {
    currency: normalized,
    style: "currency",
  }).resolvedOptions();
  const digits = options.maximumFractionDigits;

  if (digits === undefined || digits < 0 || digits > 6) {
    throw new RangeError("The currency minor-unit precision is not supported.");
  }

  return digits;
}

export function parseMajorMoney(input: MoneyInput): Money {
  const parsed = moneyInputSchema.parse(input);
  const digits = currencyMinorUnitDigits(parsed.currency);
  const negative = parsed.amount.startsWith("-");
  const unsigned = negative ? parsed.amount.slice(1) : parsed.amount;
  const [major = "0", fraction = ""] = unsigned.split(".");

  if (fraction.length > digits) {
    throw new RangeError(
      `${parsed.currency} accepts at most ${digits} fractional digits.`,
    );
  }

  const scale = 10n ** BigInt(digits);
  const paddedFraction = fraction.padEnd(digits, "0");
  const absoluteMinor =
    BigInt(major) * scale + BigInt(paddedFraction.length === 0 ? "0" : paddedFraction);

  return money(negative ? -absoluteMinor : absoluteMinor, parsed.currency);
}
