import "server-only";

import { Long } from "mongodb";

import { fromStoredMoney, toStoredMoney } from "@/lib/db/money-mapper";
import { money } from "@/lib/domain/money/money";

function isDomainMoney(
  value: unknown,
): value is Readonly<{ amountMinor: bigint; currency: string }> {
  return (
    typeof value === "object" &&
    value !== null &&
    "amountMinor" in value &&
    "currency" in value &&
    typeof value.amountMinor === "bigint" &&
    typeof value.currency === "string"
  );
}

function isStoredMoney(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "amountMinor" in value &&
    "currency" in value &&
    value.amountMinor instanceof Long &&
    typeof value.currency === "string"
  );
}

export function toStoredDomainValue(value: unknown): unknown {
  if (isDomainMoney(value)) {
    return toStoredMoney(money(value.amountMinor, value.currency));
  }
  if (value instanceof Date) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(toStoredDomainValue);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        toStoredDomainValue(item),
      ]),
    );
  }
  return value;
}

export function fromStoredDomainValue(value: unknown): unknown {
  if (isStoredMoney(value)) {
    return fromStoredMoney(value);
  }
  if (value instanceof Date) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(fromStoredDomainValue);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        fromStoredDomainValue(item),
      ]),
    );
  }
  return value;
}

export function stableSerializableDomainValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(stableSerializableDomainValue);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [
          key,
          stableSerializableDomainValue(item),
        ]),
    );
  }
  return value;
}
