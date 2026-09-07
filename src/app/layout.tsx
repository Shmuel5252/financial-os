import type { Metadata } from "next";
import type { ReactNode } from "react";

import { appLocale, messages } from "@/lib/i18n";

import "./globals.css";
import { NumericFocusBoundary } from "@/components/forms/numeric-focus-boundary";

export const metadata: Metadata = {
  title: messages.brand,
  description: messages.metadataDescription,
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html dir={appLocale.direction} lang={appLocale.htmlLanguage}>
      <body><NumericFocusBoundary>{children}</NumericFocusBoundary></body>
    </html>
  );
}
