import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { GraphRagDocument } from "../model.js";
import { createStableId } from "../utils/ids.js";
import type { DocumentSourceConfig, InlineDocument } from "./types.js";

export async function loadDocumentSource(config: DocumentSourceConfig): Promise<GraphRagDocument[]> {
  const docs: GraphRagDocument[] = [];

  // --- Files from disk ---
  for (const filePath of config.files ?? []) {
    const raw = await readFile(filePath, "utf8");
    const name = basename(filePath);
    const ext = extname(filePath).replace(/^\./, "") || "txt";

    docs.push({
      id: createStableId([filePath], "doc"),
      humanReadableId: filePath,
      title: name,
      type: `document-${ext}`,
      text: raw.trim(),
      textUnitIds: [],
      attributes: {
        sourcePath: filePath,
        ...(config.label !== undefined ? { sourceLabel: config.label } : {})
      }
    });
  }

  // --- Inline content ---
  for (const inline of config.content ?? []) {
    docs.push(inlineToDocument(inline, config.label));
  }

  return docs;
}

function inlineToDocument(inline: InlineDocument, sourceLabel: string | undefined): GraphRagDocument {
  const id = inline.id ?? createStableId([inline.title, inline.text.slice(0, 120)], "doc");
  return {
    id,
    humanReadableId: inline.title,
    title: inline.title,
    type: inline.type ?? "document",
    text: inline.text,
    textUnitIds: [],
    attributes: {
      ...(inline.attributes ?? {}),
      ...(sourceLabel !== undefined ? { sourceLabel } : {})
    }
  };
}
