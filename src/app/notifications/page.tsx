import { redirect } from "next/navigation";

import { NotificationCenter } from "@/components/notifications/notification-center";
import { AppNavigation } from "@/components/navigation/app-navigation";
import { auth } from "@/lib/auth";
import { actorFromSession } from "@/lib/auth/actor";
import { getConfigurationStatus } from "@/lib/config/server-env";
import { messages } from "@/lib/i18n";
import { loadNotificationCenter } from "@/lib/notifications/notification-service";
import { loadProfile } from "@/lib/profiles/profile-service";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  if (!getConfigurationStatus().authentication.ready) redirect("/sign-in");
  const session = await auth();
  if (session?.user?.id === undefined) redirect("/sign-in");
  const actor = actorFromSession(session);
  const profile = await loadProfile(actor);
  if (profile === null || profile.onboarding.status !== "complete") redirect("/onboarding/review");
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-12 sm:py-20">
      <AppNavigation currentPath="/notifications" />
      <p className="mt-8 text-sm font-semibold text-[var(--accent)]">{messages.notifications.eyebrow}</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">{messages.notifications.title}</h1>
      <p className="mt-4 max-w-3xl leading-7 text-[var(--muted)]">{messages.notifications.description}</p>
      <NotificationCenter initialView={await loadNotificationCenter(actor)} />
    </main>
  );
}
