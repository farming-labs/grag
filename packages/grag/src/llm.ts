export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatOptions {
  responseFormat?: "text" | "json";
  temperature?: number;
  maxTokens?: number;
}

export interface ChatCompletion {
  content: string;
  raw?: unknown;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface ChatModel {
  complete(
    messages: readonly ChatMessage[],
    options?: ChatOptions,
  ): Promise<string | ChatCompletion>;
}

export interface EmbeddingModel {
  embed(texts: readonly string[]): Promise<number[][]>;
}

export function completionContent(completion: string | ChatCompletion): string {
  return typeof completion === "string" ? completion : completion.content;
}
