import { createHash, randomUUID } from "node:crypto";

export function createId(prefix?: string): string {
  return prefix ? `${prefix}_${randomUUID()}` : randomUUID();
}

export function createStableId(parts: readonly unknown[], prefix?: string): string {
  const hash = createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 32);

  return prefix ? `${prefix}_${hash}` : hash;
}
