import type { BackupObjectStore } from "@/lib/operations/backup-capture";

/** In-memory stand-in for an object-locked bucket: write once, identical re-put is idempotent, no overwrite, no delete. */
export function wormObjectStore(): BackupObjectStore & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    async putOnce(name, bytes) {
      const existing = objects.get(name);
      if (existing && Buffer.compare(Buffer.from(existing), Buffer.from(bytes)) !== 0) throw new Error("Object is locked");
      objects.set(name, Uint8Array.from(bytes));
    },
    async get(name) { const value = objects.get(name); return value === undefined ? null : Uint8Array.from(value); },
    async list(prefix) { return [...objects.keys()].filter(name => name.startsWith(prefix)).sort(); },
  };
}
