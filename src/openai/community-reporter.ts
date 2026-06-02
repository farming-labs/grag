import { z } from "zod";
import { completionContent, type ChatModel } from "../llm.js";
import type { CommunityReport } from "../model.js";
import type { CommunityReporter } from "../pipeline/types.js";
import { createStableId } from "../utils/ids.js";

export interface OpenAiCommunityReporterOptions {
  model: ChatModel;
  maxSourceChunks?: number;
}

const reportSchema = z.object({
  title: z.string(),
  summary: z.string(),
  findings: z.array(
    z.object({
      summary: z.string(),
      explanation: z.string().optional()
    })
  ),
  rank: z.number()
});

export class OpenAiCommunityReporter implements CommunityReporter {
  private readonly model: ChatModel;
  private readonly maxSourceChunks: number;

  constructor(options: OpenAiCommunityReporterOptions) {
    this.model = options.model;
    this.maxSourceChunks = options.maxSourceChunks ?? 4;
  }

  async report(
    input: Parameters<CommunityReporter["report"]>[0]
  ): Promise<CommunityReport> {
    const { community, entities, relationships, textUnits } = input;

    const context = buildContext(community, entities, relationships, textUnits, this.maxSourceChunks);

    let parsed: z.infer<typeof reportSchema> | undefined;
    try {
      const completion = await this.model.complete(
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: context }
        ],
        { responseFormat: "json", temperature: 0 }
      );
      const raw = JSON.parse(completionContent(completion));
      const result = reportSchema.safeParse(raw);
      if (result.success) parsed = result.data;
    } catch {
      // fall through to defaults
    }

    const title = parsed?.title ?? community.title;
    const summary = parsed?.summary ?? "";
    const findings = parsed?.findings ?? [];
    const rank = parsed?.rank ?? 1;
    const fullContent = [
      summary,
      findings.length > 0
        ? findings
            .map((f, i) => `${i + 1}. ${f.summary}${f.explanation ? ` — ${f.explanation}` : ""}`)
            .join("\n")
        : ""
    ]
      .filter(Boolean)
      .join("\n\n");

    return {
      id: createStableId([community.id, "report"], "rpt"),
      humanReadableId: title,
      title,
      community: community.community,
      level: community.level,
      parent: community.parent,
      children: community.children,
      summary,
      fullContent,
      rank,
      ratingExplanation: null,
      findings: findings.map((f) => ({
        summary: f.summary,
        explanation: f.explanation ?? null
      })),
      size: community.size
    };
  }
}

function buildContext(
  community: Parameters<CommunityReporter["report"]>[0]["community"],
  entities: Parameters<CommunityReporter["report"]>[0]["entities"],
  relationships: Parameters<CommunityReporter["report"]>[0]["relationships"],
  textUnits: Parameters<CommunityReporter["report"]>[0]["textUnits"],
  maxSourceChunks: number
): string {
  const parts: string[] = [`Community: ${community.title}`];

  if (entities.length > 0) {
    parts.push(
      `Entities:\n${entities
        .map((e) => `- ${e.title}${e.type ? ` (${e.type})` : ""}: ${e.description ?? ""}`)
        .join("\n")}`
    );
  }

  if (relationships.length > 0) {
    parts.push(
      `Relationships:\n${relationships
        .map(
          (r) =>
            `- ${r.source} → ${r.target}: ${r.description ?? ""} (weight ${r.weight})`
        )
        .join("\n")}`
    );
  }

  if (textUnits.length > 0) {
    parts.push(
      `Source text:\n${textUnits
        .slice(0, maxSourceChunks)
        .map((t) => t.text)
        .join("\n\n")}`
    );
  }

  return parts.join("\n\n");
}

const SYSTEM_PROMPT = [
  "Generate a structured community report from the supplied knowledge-graph data.",
  "",
  'Return JSON with this exact shape:',
  '{ "title": string, "summary": string,',
  '  "findings": [{ "summary": string, "explanation": string }],',
  '  "rank": number }',
  "",
  "Guidelines:",
  "- title: concise label for the community (can refine the one provided)",
  "- summary: 2–3 sentences describing main themes and significance",
  "- findings: 3–6 key insights, each with a one-line summary and one-sentence explanation",
  "- rank: importance score 1–10 (10 = critical)"
].join("\n");
