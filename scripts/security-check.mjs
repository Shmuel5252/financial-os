import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Deterministic guardrails, not a comprehensive secret scanner or SAST engine. */
export function inspectFile(path, content) {
  const findings = [];
  const normalized = path.replaceAll("\\", "/");
  if (/(^|\/)\.env(?:\..*)?$/.test(normalized) && !normalized.endsWith(".env.example")) findings.push("private-env-file");
  if (/\.(pem|key|p12|pfx|jks|bson|archive|dump)$/i.test(normalized) || /(^|\/)(id_rsa|id_ed25519|credentials\.json|auth\.json)$/.test(normalized) || normalized.startsWith(".vercel/")) findings.push("private-artifact");
  if (new RegExp("-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE" + " KEY-----").test(content)) findings.push("private-key");
  if (new RegExp("sk-ant-" + "api03-[A-Za-z0-9_-]{30,}").test(content) || new RegExp("gh[pousr]_" + "[A-Za-z0-9]{30,}").test(content)) findings.push("provider-token");
  if (/NEXT_PUBLIC_[A-Z_]*(SECRET|PASSWORD|PRIVATE_KEY|ACCESS_TOKEN|REFRESH_TOKEN)/.test(content)) findings.push("public-secret-binding");
  return findings;
}

export function runSecurityCheck() {
  const files = execFileSync("git", ["-c", `safe.directory=${process.cwd().replaceAll("\\", "/")}`, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" }).split("\0").filter(Boolean);
  let failures = 0;
  for (const file of new Set(files)) {
    // Never read the contents of prohibited private files to report a violation.
    const pathFindings = inspectFile(file, "");
    const findings = pathFindings.length ? pathFindings : inspectFile(file, readFileSync(file, "utf8"));
    if (findings.length) { failures += findings.length; console.error(`Security check: ${findings.join(",")} (${file})`); }
  }
  console.info(`Security check: ${new Set(files).size} files; ${failures} findings`);
  return failures === 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = runSecurityCheck() ? 0 : 1;
