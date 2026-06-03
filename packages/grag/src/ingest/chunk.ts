import type { GraphRagDocument, TextUnit } from "../model.js";
import { createStableId } from "../utils/ids.js";

export interface ChunkDocumentOptions {
  chunkSize?: number;
  overlap?: number;
  tokenCounter?: (text: string) => number;
}

export interface ChunkDocumentsResult {
  documents: GraphRagDocument[];
  textUnits: TextUnit[];
}

const defaultChunkSize = 300;
const defaultOverlap = 40;

export function chunkDocuments(
  documents: readonly GraphRagDocument[],
  options: ChunkDocumentOptions = {}
): ChunkDocumentsResult {
  const textUnits: TextUnit[] = [];
  const nextDocuments: GraphRagDocument[] = [];

  for (const document of documents) {
    const units = chunkDocument(document, options);
    textUnits.push(...units);
    nextDocuments.push({
      ...document,
      textUnitIds: units.map((unit) => unit.id)
    });
  }

  return { documents: nextDocuments, textUnits };
}

export function chunkDocument(
  document: GraphRagDocument,
  options: ChunkDocumentOptions = {}
): TextUnit[] {
  const chunkSize = options.chunkSize ?? defaultChunkSize;
  const overlap = options.overlap ?? defaultOverlap;

  if (chunkSize <= 0) {
    throw new Error("chunkSize must be greater than zero");
  }
  if (overlap < 0 || overlap >= chunkSize) {
    throw new Error("overlap must be greater than or equal to zero and less than chunkSize");
  }

  const words = document.text.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }

  const step = chunkSize - overlap;
  const units: TextUnit[] = [];

  for (let start = 0; start < words.length; start += step) {
    const chunkWords = words.slice(start, start + chunkSize);
    const text = chunkWords.join(" ");
    const ordinal = units.length;

    units.push({
      id: createStableId([document.id, ordinal, text], "tu"),
      humanReadableId: `${document.humanReadableId ?? document.id}:${ordinal + 1}`,
      text,
      nTokens: options.tokenCounter?.(text) ?? chunkWords.length,
      documentId: document.id,
      entityIds: [],
      relationshipIds: [],
      covariateIds: [],
      attributes: {
        documentTitle: document.title,
        chunkOrdinal: ordinal,
        startWord: start,
        endWord: start + chunkWords.length
      }
    });

    if (start + chunkSize >= words.length) {
      break;
    }
  }

  return units;
}
