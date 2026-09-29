// Owner-run: renders infra/atlas/capacity-alerts.json into one Atlas alert-configuration file per alert for one cluster, for
// `atlas alerts settings create --projectId <id> --file <file>`. Needs no credentials and contacts nothing.
// Usage: node scripts/atlas-alerts.mjs --role ledger|primary --cluster <cluster name> --email <address> --out <directory>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function renderAlerts(definition, role, clusterName, email) {
  const cluster = definition.clusters[role];
  if (!cluster || !/^[A-Za-z0-9-]{1,64}$/.test(clusterName) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("invalid arguments");
  return definition.alerts.filter(alert => !alert.only || cluster[alert.only]).map(alert => ({ id: alert.id, config: {
    eventTypeName: "OUTSIDE_METRIC_THRESHOLD", enabled: true,
    matchers: [{ fieldName: "CLUSTER_NAME", operator: "EQUALS", value: clusterName }],
    metricThreshold: { metricName: alert.metricName, operator: alert.operator, units: alert.units, mode: "AVERAGE",
      threshold: typeof alert.threshold === "string" ? cluster[alert.threshold] : alert.threshold },
    notifications: [{ typeName: "EMAIL", emailAddress: email, intervalMin: 60, delayMin: 0 }],
  } }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const argument = name => { const index = process.argv.indexOf(name); return index === -1 ? undefined : process.argv[index + 1]; };
  const definition = JSON.parse(readFileSync(new URL("../infra/atlas/capacity-alerts.json", import.meta.url), "utf8"));
  const out = argument("--out");
  try {
    if (!out) throw new Error("invalid arguments");
    const alerts = renderAlerts(definition, argument("--role"), argument("--cluster") ?? "", argument("--email") ?? "");
    mkdirSync(out, { recursive: true });
    for (const alert of alerts) writeFileSync(join(out, `${argument("--role")}-${alert.id}.json`), `${JSON.stringify(alert.config, null, 2)}\n`);
    console.log(`wrote ${alerts.length} alert files`);
  } catch { console.log("failed: --role ledger|primary --cluster <name> --email <address> --out <directory>"); process.exitCode = 2; }
}
