import Link from "next/link";

import { messages } from "@/lib/i18n";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-6 py-16 sm:px-10">
      <section className="grid w-full gap-12 lg:grid-cols-[1.25fr_0.75fr] lg:items-end">
        <div>
          <p className="mb-6 inline-flex rounded-full border border-[var(--border)] bg-white/80 px-4 py-2 text-sm font-semibold text-[var(--accent)] shadow-sm">
            {messages.home.badge}
          </p>
          <h1 className="max-w-3xl text-5xl leading-[1.02] font-semibold tracking-[-0.045em] sm:text-7xl">
            {messages.home.title}
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-[var(--muted)] sm:text-xl">
            {messages.home.description}
          </p>
          <Link
            className="mt-8 inline-flex rounded-2xl bg-[var(--accent)] px-5 py-3 font-semibold text-white"
            href="/sign-in"
          >
            {messages.home.start}
          </Link>
        </div>

        <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-7 shadow-[0_24px_70px_rgba(18,35,28,0.08)] sm:p-9">
          <div className="mb-7 flex items-center gap-3">
            <span className="h-3 w-3 rounded-full bg-emerald-500 shadow-[0_0_0_6px_rgba(16,185,129,0.12)]" />
            <p className="font-semibold">{messages.home.foundationTitle}</p>
          </div>
          <ul className="space-y-5">
            {messages.home.foundations.map((foundation) => (
              <li key={foundation} className="flex gap-3 text-[var(--muted)]">
                <span aria-hidden="true" className="mt-0.5 font-bold text-[var(--accent)]">
                  ✓
                </span>
                <span>{foundation}</span>
              </li>
            ))}
          </ul>
          <p className="mt-8 border-t border-[var(--border)] pt-6 text-sm leading-6 text-[var(--muted)]">
            {messages.home.integrations}
          </p>
        </div>
      </section>
    </main>
  );
}
