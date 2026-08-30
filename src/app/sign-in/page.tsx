import Link from "next/link";

import { signIn } from "@/lib/auth";
import { getConfigurationStatus } from "@/lib/config/server-env";

export const dynamic = "force-dynamic";

async function signInWithGoogle() {
  "use server";

  if (!getConfigurationStatus().authentication.ready) {
    return;
  }

  await signIn("google", {
    redirectTo: "/onboarding/profile",
  }, {
    prompt: "select_account",
  });
}

export default function SignInPage() {
  const authReady = getConfigurationStatus().authentication.ready;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl items-center px-6 py-16">
      <section className="w-full rounded-3xl border border-[var(--border)] bg-white p-8 shadow-[0_24px_70px_rgba(18,35,28,0.08)] sm:p-10">
        <Link className="text-sm font-semibold text-[var(--accent)]" href="/">
          ← Financial OS
        </Link>
        <p className="mt-10 text-sm font-semibold tracking-wide text-[var(--accent)] uppercase">
          Phase 1
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.035em]">
          Sign in securely
        </h1>
        <p className="mt-4 leading-7 text-[var(--muted)]">
          Your server session will determine which financial profile the application
          can access. The browser never chooses a user ID.
        </p>

        {authReady ? (
          <form action={signInWithGoogle} className="mt-8">
            <button
              className="w-full rounded-2xl bg-[var(--accent)] px-5 py-3.5 font-semibold text-white transition hover:brightness-95"
              type="submit"
            >
              Continue with Google
            </button>
          </form>
        ) : (
          <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
            Google sign-in is not configured yet. Add the real credentials to the
            ignored <code>.env.local</code> file to enable this button.
          </div>
        )}
      </section>
    </main>
  );
}
