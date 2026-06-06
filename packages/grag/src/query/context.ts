import type { CommunityReport, Entity, Relationship, TextUnit } from "../model.js";

export interface ContextChunk<TRecord> {
  text: string;
  records: TRecord[];
}

export interface BuildCommunityContextOptions {
  maxChunkChars?: number;
  includeFindings?: boolean;
}

export interface LocalContextOptions {
  maxEntities?: number;
  maxTextUnits?: number;
  maxRelationships?: number;
}

const defaultMaxChunkChars = 8_000;

export function buildCommunityContext(
  reports: readonly CommunityReport[],
  options: BuildCommunityContextOptions = {},
): ContextChunk<CommunityReport>[] {
  const chunks: ContextChunk<CommunityReport>[] = [];
  let currentText = "";
  let currentRecords: CommunityReport[] = [];
  const maxChunkChars = options.maxChunkChars ?? defaultMaxChunkChars;

  for (const report of reports) {
    const text = formatCommunityReport(report, options);
    if (currentText.length > 0 && currentText.length + text.length > maxChunkChars) {
      chunks.push({ text: currentText.trim(), records: currentRecords });
      currentText = "";
      currentRecords = [];
    }

    currentText += `${text}\n\n`;
    currentRecords.push(report);
  }

  if (currentRecords.length > 0) {
    chunks.push({ text: currentText.trim(), records: currentRecords });
  }

  return chunks;
}

export function formatCommunityReport(
  report: CommunityReport,
  options: BuildCommunityContextOptions = {},
): string {
  const lines = [
    `# Community ${report.community}: ${report.title}`,
    `Level: ${report.level}`,
    `Rank: ${report.rank}`,
    report.summary ? `Summary: ${report.summary}` : "",
    report.fullContent ? `Report:\n${report.fullContent}` : "",
  ].filter(Boolean);

  if (options.includeFindings && report.findings.length > 0) {
    lines.push(
      `Findings:\n${report.findings
        .map(
          (finding, index) =>
            `${index + 1}. ${finding.summary}${finding.explanation ? ` - ${finding.explanation}` : ""}`,
        )
        .join("\n")}`,
    );
  }

  return lines.join("\n");
}

export function buildLocalContext(
  query: string,
  input: {
    entities: readonly Entity[];
    relationships: readonly Relationship[];
    textUnits: readonly TextUnit[];
  },
  options: LocalContextOptions = {},
): string {
  const maxEntities = options.maxEntities ?? 20;
  const maxTextUnits = options.maxTextUnits ?? 8;
  const maxRelationships = options.maxRelationships ?? 12;
  const entityScores = new Map(
    input.entities.map((entity) => [
      entity.id,
      lexicalScore(query, `${entity.title} ${entity.description ?? ""}`),
    ]),
  );
  const selectedEntities = input.entities
    .filter((entity) => (entityScores.get(entity.id) ?? 0) > 0)
    .sort((left, right) => (entityScores.get(right.id) ?? 0) - (entityScores.get(left.id) ?? 0))
    .slice(0, maxEntities);

  const selectedTitles = new Set(selectedEntities.map((entity) => entity.title));
  const relationships = input.relationships
    .filter(
      (relationship) =>
        selectedTitles.has(relationship.source) ||
        selectedTitles.has(relationship.target) ||
        lexicalScore(query, relationship.description ?? "") > 0,
    )
    .slice(0, maxRelationships);

  const textUnitIds = new Set([
    ...selectedEntities.flatMap((entity) => entity.textUnitIds),
    ...relationships.flatMap((relationship) => relationship.textUnitIds),
  ]);

  const textUnits = input.textUnits
    .filter((textUnit) => textUnitIds.has(textUnit.id) || lexicalScore(query, textUnit.text) > 0)
    .sort((left, right) => lexicalScore(query, right.text) - lexicalScore(query, left.text))
    .slice(0, maxTextUnits);

  return [
    selectedEntities.length
      ? `Entities\n${selectedEntities.map((entity) => `- ${entity.title}: ${entity.description ?? ""}`).join("\n")}`
      : "",
    relationships.length
      ? `Relationships\n${relationships
          .map(
            (relationship) =>
              `- ${relationship.source} -> ${relationship.target}: ${relationship.description ?? ""} (weight ${relationship.weight})`,
          )
          .join("\n")}`
      : "",
    textUnits.length
      ? `Sources\n${textUnits.map((textUnit) => `- ${textUnit.text}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function lexicalScore(query: string, text: string): number {
  const terms = new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length > 2),
  );
  if (terms.size === 0) return 0;

  const normalized = text.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (normalized.includes(term)) {
      score += 1;
    }
  }

  return score;
}
