import type { EmbeddingModel } from "../llm.js";
import type { EmbeddingRecord, TextUnit } from "../model.js";
import type { GraphRagStore } from "../storage/types.js";
import { cosineSimilarity } from "../utils/math.js";
import { lexicalScore } from "./context.js";

export interface BasicSearchOptions {
  limit?: number;
  embeddingModel?: EmbeddingModel;
  embeddingRecords?: readonly EmbeddingRecord[];
}

export interface BasicSearchHit {
  textUnit: TextUnit;
  score: number;
  scoreType: "vector" | "lexical";
}

export async function basicSearch(
  store: GraphRagStore,
  query: string,
  options: BasicSearchOptions = {}
): Promise<BasicSearchHit[]> {
  const limit = options.limit ?? 10;
  const textUnits = await store.listTextUnits();

  if (options.embeddingModel) {
    const [queryVector] = await options.embeddingModel.embed([query]);
    const embeddings =
      options.embeddingRecords ??
      (await store.listEmbeddings({
        targetKind: "text_unit",
        targetIds: textUnits.map((textUnit) => textUnit.id)
      }));
    const vectorsByTargetId = new Map(embeddings.map((embedding) => [embedding.targetId, embedding.vector]));

    return textUnits
      .map((textUnit) => ({
        textUnit,
        score: cosineSimilarity(queryVector ?? [], vectorsByTargetId.get(textUnit.id) ?? []),
        scoreType: "vector" as const
      }))
      .filter((hit) => hit.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }

  return textUnits
    .map((textUnit) => ({
      textUnit,
      score: lexicalScore(query, textUnit.text),
      scoreType: "lexical" as const
    }))
    .filter((hit) => hit.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}
