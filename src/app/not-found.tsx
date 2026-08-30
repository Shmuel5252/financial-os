import Link from "next/link";

import { messages } from "@/lib/i18n";

export default function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl items-center px-6 py-16">
      <section className="w-full rounded-3xl border border-[var(--border)] bg-white p-8 shadow-[0_24px_70px_rgba(18,35,28,0.08)] sm:p-10">
        <h1 className="text-4xl font-semibold tracking-[-0.035em]">
          {messages.system.notFoundTitle}
        </h1>
        <p className="mt-4 leading-7 text-[var(--muted)]">
          {messages.system.notFoundDescription}
        </p>
        <Link
          className="mt-8 inline-flex rounded-2xl bg-[var(--accent)] px-5 py-3 font-semibold text-white"
          href="/"
        >
          {messages.system.backHome}
        </Link>
      </section>
    </main>
  );
}
