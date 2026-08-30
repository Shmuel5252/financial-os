import Link from "next/link";

import { messages } from "@/lib/i18n";

export function HomeLink() {
  return (
    <Link
      className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--accent)]"
      href="/"
    >
      <span aria-hidden="true">→</span>
      <span>{messages.navigation.home}</span>
    </Link>
  );
}
