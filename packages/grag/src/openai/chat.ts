import type { ChatCompletion, ChatMessage, ChatModel, ChatOptions } from "../llm.js";

export interface OpenAiChatModelOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

export class OpenAiChatModel implements ChatModel {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(options: OpenAiChatModelOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.model = options.model ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    this.baseUrl = (
      options.baseUrl ??
      process.env.OPENAI_BASE_URL ??
      "https://api.openai.com/v1"
    ).replace(/\/$/, "");
  }

  async complete(
    messages: readonly ChatMessage[],
    options: ChatOptions = {},
  ): Promise<ChatCompletion> {
    if (!this.apiKey) {
      throw new Error(
        "OpenAI API key is required. Set OPENAI_API_KEY or pass apiKey to OpenAiChatModel.",
      );
    }

    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    };

    if (options.responseFormat === "json") {
      body.response_format = { type: "json_object" };
    }
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      const errorRecord = payload.error as Record<string, unknown> | undefined;
      const message =
        typeof errorRecord?.message === "string" ? errorRecord.message : response.statusText;
      throw new Error(`OpenAI chat/completions failed (${response.status}): ${message}`);
    }

    const choices = payload.choices as Array<{ message: { content: string } }>;
    const content = choices[0]?.message?.content ?? "";
    const usage = payload.usage as
      | { prompt_tokens?: number; completion_tokens?: number }
      | undefined;

    const usageObj = usage
      ? {
          ...(usage.prompt_tokens !== undefined ? { inputTokens: usage.prompt_tokens } : {}),
          ...(usage.completion_tokens !== undefined
            ? { outputTokens: usage.completion_tokens }
            : {}),
        }
      : undefined;

    return {
      content,
      raw: payload,
      ...(usageObj !== undefined ? { usage: usageObj } : {}),
    };
  }
}
