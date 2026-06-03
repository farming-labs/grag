import type { ChatCompletion, ChatMessage, ChatModel, ChatOptions } from "../llm.js";

export interface AnthropicChatModelOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  /** Default max tokens. Anthropic requires this field. Default: 4096. */
  maxTokens?: number;
}

/**
 * ChatModel adapter for the Anthropic Messages API (Claude models).
 * Reads ANTHROPIC_API_KEY and ANTHROPIC_MODEL from the environment.
 *
 * @example
 * ```ts
 * const model = new AnthropicChatModel({ model: "claude-sonnet-4-6" });
 * ```
 */
export class AnthropicChatModel implements ChatModel {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly defaultMaxTokens: number;

  constructor(options: AnthropicChatModelOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
    this.model = options.model ?? process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";
    this.baseUrl = (options.baseUrl ?? "https://api.anthropic.com/v1").replace(/\/$/, "");
    this.defaultMaxTokens = options.maxTokens ?? 4096;
  }

  async complete(messages: readonly ChatMessage[], options: ChatOptions = {}): Promise<ChatCompletion> {
    if (!this.apiKey) {
      throw new Error(
        "Anthropic API key is required. Set ANTHROPIC_API_KEY or pass apiKey to AnthropicChatModel."
      );
    }

    // Anthropic separates system messages from the messages array
    const systemMessages = messages.filter((m) => m.role === "system");
    const userAssistantMessages = messages.filter((m) => m.role !== "system");

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: options.maxTokens ?? this.defaultMaxTokens,
      messages: userAssistantMessages.map((m) => ({ role: m.role, content: m.content }))
    };

    if (systemMessages.length > 0) {
      body.system = systemMessages.map((m) => m.content).join("\n\n");
    }

    if (options.temperature !== undefined) body.temperature = options.temperature;

    // Request JSON via a tool when responseFormat === "json"
    if (options.responseFormat === "json") {
      body.system = [body.system, JSON_SYSTEM_SUFFIX].filter(Boolean).join("\n\n");
    }

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      const errorRecord = payload.error as Record<string, unknown> | undefined;
      const message =
        typeof errorRecord?.message === "string" ? errorRecord.message : response.statusText;
      throw new Error(`Anthropic messages API failed (${response.status}): ${message}`);
    }

    const contentBlocks = payload.content as Array<{ type: string; text?: string }>;
    const content = contentBlocks.find((b) => b.type === "text")?.text ?? "";
    const usage = payload.usage as { input_tokens?: number; output_tokens?: number } | undefined;

    const usageObj = usage
      ? {
          ...(usage.input_tokens !== undefined ? { inputTokens: usage.input_tokens } : {}),
          ...(usage.output_tokens !== undefined ? { outputTokens: usage.output_tokens } : {})
        }
      : undefined;

    return {
      content,
      raw: payload,
      ...(usageObj !== undefined ? { usage: usageObj } : {})
    };
  }
}

const JSON_SYSTEM_SUFFIX =
  "Always respond with valid JSON only. Do not include any text, markdown fences, or explanation outside the JSON object.";
