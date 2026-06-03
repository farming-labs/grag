import type { GraphRagDocument } from "../model.js";
import { scanRepository } from "../repo/demo.js";
import { createStableId } from "../utils/ids.js";
import type { RepoSourceConfig } from "./types.js";

export async function loadRepoSource(config: RepoSourceConfig): Promise<GraphRagDocument[]> {
  const targetCount = config.maxFiles ?? "all";
  // When include/exclude filters are active, scan a wider pool so filtering
  // doesn't leave us with too few files after pruning.
  const scanCount = targetCount === "all"
    ? "all"
    : config.include || config.exclude ? Math.max(targetCount * 6, 240) : targetCount;
  const scanned = await scanRepository({
    source: config.url,
    provider: "auto",
    maxFiles: scanCount,
    ...(config.maxFileBytes !== undefined ? { maxFileBytes: config.maxFileBytes } : {})
  });

  try {
    const filtered = scanned.files
      .filter((file) => {
        if (config.include && config.include.length > 0) {
          if (!config.include.some((prefix) => file.path.startsWith(prefix))) {
            return false;
          }
        }
        if (config.exclude && config.exclude.length > 0) {
          if (config.exclude.some((prefix) => file.path.startsWith(prefix))) {
            return false;
          }
        }
        return true;
      })
      .slice(0, targetCount === "all" ? undefined : targetCount);

    const sourceLabel = config.label ?? config.url;

    return filtered.map((file) => ({
      id: createStableId([config.url, file.path], "doc"),
      humanReadableId: file.path,
      title: file.path,
      type: `repo-${file.kind}`,
      text: file.text,
      textUnitIds: [],
      attributes: {
        sourcePath: file.path,
        sourceUrl: config.url,
        sourceLabel,
        fileKind: file.kind,
        bytes: file.bytes,
        sourceProvider: scanned.provider
      }
    }));
  } finally {
    await scanned.cleanup();
  }
}
