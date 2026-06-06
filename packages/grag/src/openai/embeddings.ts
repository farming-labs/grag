import type { EmbeddingModel } from "../llm.js";

export interface OpenAiEmbeddingModelOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  batchSize?: number;
}

export class OpenAiEmbeddingModel implements EmbeddingModel {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly batchSize: number;

  constructor(options: OpenAiEmbeddingModelOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.model = options.model ?? process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
    this.baseUrl = (
      options.baseUrl ??
      process.env.OPENAI_BASE_URL ??
      "https://api.openai.com/v1"
    ).replace(/\/$/, "");
    this.batchSize = options.batchSize ?? 512;
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const batchResults = await this.embedBatch(batch);
      results.push(...batchResults);
    }

    return results;
  }

  private async embedBatch(texts: readonly string[]): Promise<number[][]> {
    if (!this.apiKey) {
      throw new Error(
        "OpenAI API key is required. Set OPENAI_API_KEY or pass apiKey to OpenAiEmbeddingModel.",
      );
    }

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });

    const payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      const errorRecord = payload.error as Record<string, unknown> | undefined;
      const message =
        typeof errorRecord?.message === "string" ? errorRecord.message : response.statusText;
      throw new Error(`OpenAI embeddings failed (${response.status}): ${message}`);
    }

    const data = payload.data as Array<{ embedding: number[]; index: number }>;
    return data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
  }
}
