// Owner-run: renders infra/atlas/capacity-alerts.json into one Atlas alert-configuration file per alert that the cluster's tier can
// actually raise, for `atlas alerts settings create --projectId <id> --file <file>`, and lists every intended alert the tier cannot
// raise (never silently dropped). Needs no credentials and contacts nothing. Only verified tiers render (today: free).
// Usage: node scripts/atlas-alerts.mjs --role ledger|primary --tier free --cluster <cluster name> --email <address> --out <directory>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function renderAlerts(definition, role, tier, clusterName, email) {
  const cluster = definition.clusters[role]; const support = definition.tiers?.[tier];
  if (!cluster || !support || !/^[A-Za-z0-9-]{1,64}$/.test(clusterName) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("invalid arguments");
  const intended = definition.alerts.filter(alert => !alert.only || cluster[alert.only]);
  const alerts = intended.filter(alert => support.alerts.includes(alert.id)).map(alert => ({ id: alert.id, config: {
    eventTypeName: support.eventTypeName, enabled: true,
    // Matchers only where the event type accepts them; without one the alert covers the project's cluster(s).
    ...(support.matchers ? { matchers: [{ fieldName: "CLUSTER_NAME", operator: "EQUALS", value: clusterName }] } : {}),
    metricThreshold: { metricName: alert.metricName, operator: alert.operator, units: alert.units, mode: "AVERAGE",
      threshold: typeof alert.threshold === "string" ? cluster[alert.threshold] : alert.threshold },
    notifications: [{ typeName: "EMAIL", emailAddress: email, intervalMin: 60, delayMin: 0 }],
  } }));
  return { alerts, unavailable: intended.filter(alert => !support.alerts.includes(alert.id)).map(alert => alert.id) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const argument = name => { const index = process.argv.indexOf(name); return index === -1 ? undefined : process.argv[index + 1]; };
  const definition = JSON.parse(readFileSync(new URL("../infra/atlas/capacity-alerts.json", import.meta.url), "utf8"));
  const out = argument("--out");
  try {
    if (!out) throw new Error("invalid arguments");
    const { alerts, unavailable } = renderAlerts(definition, argument("--role"), argument("--tier"), argument("--cluster") ?? "", argument("--email") ?? "");
    mkdirSync(out, { recursive: true });
    for (const alert of alerts) writeFileSync(join(out, `${argument("--role")}-${alert.id}.json`), `${JSON.stringify(alert.config, null, 2)}\n`);
    console.log(`wrote ${alerts.length} alert files`);
    if (unavailable.length > 0) console.log(`not available on ${argument("--tier")}: ${unavailable.join(", ")}`);
  } catch { console.log("failed: --role ledger|primary --tier free --cluster <name> --email <address> --out <directory>"); process.exitCode = 2; }
}
