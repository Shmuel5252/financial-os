"use client";

import type { FocusEvent, ReactNode } from "react";

export function selectZeroOnFocus(event: FocusEvent<HTMLElement>) {
  const input = event.target;
  if (input instanceof HTMLInputElement &&
      (input.type === "number" || input.inputMode === "decimal" || input.inputMode === "numeric") &&
      /^-?0(?:\.0+)?$/.test(input.value)) {
    input.select();
  }
}

export function NumericFocusBoundary({ children }: Readonly<{ children: ReactNode }>) {
  return <div onFocusCapture={selectZeroOnFocus}>{children}</div>;
}
