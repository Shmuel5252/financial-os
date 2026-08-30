import "server-only";

import { Long } from "mongodb";

import { money, type Money } from "@/lib/domain/money/money";
import { DependencyUnavailableError } from "@/lib/errors/application-error";

export type StoredMoney = Readonly<{
  amountMinor: Long;
  currency: string;
}>;

export function toStoredMoney(value: Money): StoredMoney {
  return {
    amountMinor: Long.fromBigInt(value.amountMinor),
    currency: value.currency,
  };
}

export function fromStoredMoney(value: unknown): Money {
  if (
    typeof value !== "object" ||
    value === null ||
    !("amountMinor" in value) ||
    !("currency" in value) ||
    !(value.amountMinor instanceof Long) ||
    typeof value.currency !== "string"
  ) {
    throw new DependencyUnavailableError("Stored money data is invalid.");
  }

  return money(value.amountMinor.toBigInt(), value.currency);
}
