import Link from "next/link";
import { messages } from "@/lib/i18n";

const groups = [
  { label: messages.management.navigationData, links: [
    ["/financial-data", messages.financialData.title], ["/open-banking", messages.navigation.openBanking],
    ["/transaction-intelligence", messages.navigation.transactionIntelligence], ["/households", messages.navigation.households],
  ] },
  { label: messages.management.navigationPlanning, links: [
    ["/budgets", messages.navigation.budgets], ["/goals", messages.navigation.goals], ["/forecasts", messages.navigation.forecasts],
    ["/purchase-simulation", messages.navigation.purchaseSimulation], ["/debt-strategies", messages.navigation.debtStrategies],
    ["/net-worth", messages.navigation.netWorth],
  ] },
  { label: messages.management.navigationInsights, links: [
    ["/copilot", messages.navigation.copilot], ["/notifications", messages.navigation.notifications],
    ["/reports", messages.navigation.reports], ["/progress", messages.navigation.progress],
  ] },
] as const;

export function AppNavigation({ currentPath }: Readonly<{ currentPath: string }>) {
  const section = currentPath.startsWith("/financial-data/");
  return <nav aria-label={messages.management.navigation} className="rounded-2xl border border-[var(--border)] bg-white p-4">
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 font-semibold text-[var(--accent)]">
      <Link aria-current={currentPath === "/dashboard" ? "page" : undefined} href="/dashboard">{messages.management.backDashboard}</Link>
      <Link aria-current={currentPath === "/financial-data" ? "page" : undefined} href="/financial-data">{section ? messages.financialData.actions.back : messages.financialData.title}</Link>
    </div>
    <details className="mt-3">
      <summary className="cursor-pointer text-sm font-semibold">{messages.management.allTools}</summary>
      <div className="mt-4 grid gap-5 sm:grid-cols-3">
        {groups.map((group) => <section key={group.label}>
          <h2 className="text-sm font-semibold text-[var(--muted)]">{group.label}</h2>
          <ul className="mt-2 space-y-2">{group.links.map(([href, label]) => <li key={href}>
            <Link aria-current={currentPath === href ? "page" : undefined} className="inline-block py-1 text-sm text-[var(--accent)]" href={href}>{label}</Link>
          </li>)}</ul>
        </section>)}
      </div>
    </details>
  </nav>;
}
