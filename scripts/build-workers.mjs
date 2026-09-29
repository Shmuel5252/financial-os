// Bundles the backup worker (Lambda, ESM) and the offline restore-drill CLI into .build/ with the repository's own code.
// The AWS SDK is left external (provided by the Lambda Node.js runtime). The index-manifest digest is embedded so a package
// only opens with tooling built from a matching index manifest.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const digest = execFileSync(process.execPath, ["scripts/index-manifest.mjs", "--digest"], { cwd: root, encoding: "utf8" }).trim();
if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("Index manifest digest unavailable");
// Optional MongoDB driver integrations we do not use (Kerberos, compression, client-side encryption, AWS auth helpers).
const optional = ["kerberos", "@mongodb-js/zstd", "snappy", "socks", "aws4", "mongodb-client-encryption", "gcp-metadata", "@aws-sdk/credential-providers"];

for (const [name, entry] of [["backup-worker", "workers/backup/index.ts"], ["restore-drill", "workers/restore-drill/cli.ts"]]) {
  await build({
    configFile: false, root, logLevel: "warn",
    define: { __INDEX_MANIFEST_DIGEST__: JSON.stringify(digest) },
    resolve: { alias: { "@": `${root}src`, "server-only": `${root}workers/server-only.ts` } },
    ssr: { noExternal: true, target: "node" },
    build: {
      ssr: entry, outDir: `.build/${name}`, emptyOutDir: true, target: "node20", minify: false, sourcemap: false,
      rollupOptions: { external: [/^@aws-sdk\//, /^node:/, ...optional], output: { format: "es", entryFileNames: "index.mjs", codeSplitting: false } },
    },
  });
  console.log(`built .build/${name}/index.mjs (index manifest ${digest.slice(0, 12)}…)`);
}
