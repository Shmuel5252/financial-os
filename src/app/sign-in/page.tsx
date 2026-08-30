import { HomeLink } from "@/components/navigation/home-link";
import { signIn } from "@/lib/auth";
import { getConfigurationStatus } from "@/lib/config/server-env";
import { messages } from "@/lib/i18n";

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
        <HomeLink />
        <p className="mt-10 text-sm font-semibold text-[var(--accent)]">
          {messages.signIn.label}
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.035em]">
          {messages.signIn.title}
        </h1>
        <p className="mt-4 leading-7 text-[var(--muted)]">
          {messages.signIn.description}
        </p>

        {authReady ? (
          <form action={signInWithGoogle} className="mt-8">
            <button
              className="w-full rounded-2xl bg-[var(--accent)] px-5 py-3.5 font-semibold text-white transition hover:brightness-95"
              type="submit"
            >
              {messages.signIn.googleAction}{" "}
              <bdi dir="ltr">{messages.signIn.providerName}</bdi>
            </button>
          </form>
        ) : (
          <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
            {messages.signIn.notConfiguredBefore}{" "}
            <code dir="ltr">.env.local</code>{" "}
            {messages.signIn.notConfiguredAfter}
          </div>
        )}
      </section>
    </main>
  );
}
