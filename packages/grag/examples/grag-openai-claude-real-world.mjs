#!/usr/bin/env node
import {
  AnthropicChatModel,
  OpenAiChatModel,
  OpenAiEmbeddingModel,
  createMemoryGraphRagService,
  createStableId,
  indexRepository,
} from "../dist/index.js";

const repoPath = process.argv[2] ?? process.cwd();
const query =
  process.argv.slice(3).join(" ") ||
  "What does this repository do, and where are the core modules?";
const openAiKeyPresent = Boolean(process.env.OPENAI_API_KEY);
const anthropicKeyPresent = Boolean(process.env.ANTHROPIC_API_KEY);
const embeddingModelName = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
const answerProvider = anthropicKeyPresent ? "claude" : openAiKeyPresent ? "openai" : "extractive";

function step(title) {
  console.log(`\n== ${title} ==`);
}

function oneLine(value) {
  return value.replace(/\s+/g, " ").trim();
}

function sourcePathForTextUnit(textUnit) {
  const sourcePath = textUnit.attributes?.sourcePath;
  return typeof sourcePath === "string"
    ? sourcePath
    : (textUnit.humanReadableId?.toString() ?? textUnit.id);
}

function embeddingTextForTextUnit(textUnit) {
  const source = sourcePathForTextUnit(textUnit);
  return [`Source path: ${source}`, textUnit.text.slice(0, 8_000)].join("\n\n");
}

async function embedTextUnits(service, embeddingModel) {
  const textUnits = await service.store.listTextUnits();
  const inputs = textUnits.map(embeddingTextForTextUnit);
  const vectors = await embeddingModel.embed(inputs);
  const records = textUnits.flatMap((textUnit, index) => {
    const vector = vectors[index];
    if (!vector) return [];
    return [
      {
        id: createStableId(["text_unit", textUnit.id, embeddingModelName], "emb"),
        targetKind: "text_unit",
        targetId: textUnit.id,
        vector,
        model: embeddingModelName,
        dimensions: vector.length,
        text: inputs[index],
        metadata: { sourcePath: sourcePathForTextUnit(textUnit) },
      },
    ];
  });

  await service.store.upsertEmbeddings(records);
  return records.length;
}

function createAnswerModel() {
  if (anthropicKeyPresent) {
    return new AnthropicChatModel({
      model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
      maxTokens: Number(process.env.GRAG_EXAMPLE_MAX_TOKENS ?? 1200),
    });
  }

  if (openAiKeyPresent) {
    return new OpenAiChatModel({
      model: process.env.OPENAI_MODEL ?? process.env.GRAG_OPENAI_ANSWER_MODEL ?? "gpt-4o-mini",
    });
  }

  return undefined;
}

step("1. Provider wiring");
console.log(
  `OPENAI_API_KEY: ${openAiKeyPresent ? "present, used for embeddings" : "missing, vector search disabled"}`,
);
console.log(
  `ANTHROPIC_API_KEY: ${anthropicKeyPresent ? "present, used for Claude answer" : "missing"}`,
);
console.log(`Answer provider: ${answerProvider}`);

step("2. Full codebase scan");
const indexed = await indexRepository({
  source: repoPath,
  provider: "auto",
  scan: { maxFiles: "all" },
  extraction: { provider: "local" },
});
const selectedFiles = indexed.files;
console.log(`Repo: ${repoPath}`);
console.log(`Provider: ${indexed.provider}`);
console.log(`Indexed files: ${selectedFiles.length}`);
console.log(`source files: ${selectedFiles.filter((file) => file.kind === "source").length}`);
console.log(`docs files: ${selectedFiles.filter((file) => file.kind === "docs").length}`);
console.log(`example files: ${selectedFiles.filter((file) => file.kind === "example").length}`);
console.log(`config files: ${selectedFiles.filter((file) => file.kind === "config").length}`);

step("3. Local graph build");
const { snapshot, mode } = indexed;
const embeddingModel = openAiKeyPresent
  ? new OpenAiEmbeddingModel({
      model: embeddingModelName,
      batchSize: Number(process.env.GRAG_EXAMPLE_EMBED_BATCH_SIZE ?? 128),
    })
  : undefined;
const answerModel = createAnswerModel();
const service = createMemoryGraphRagService({
  ...(answerModel ? { model: answerModel } : {}),
  ...(embeddingModel ? { embeddingModel } : {}),
});
await service.ingestSnapshot(snapshot);
let stats = await service.stats();
console.log(`Graph mode: ${mode}`);
console.log(`Documents: ${stats.documents}`);
console.log(`Text units: ${stats.textUnits}`);
console.log(`Entities: ${stats.entities}`);
console.log(`Relationships: ${stats.relationships}`);

if (embeddingModel) {
  step("4. OpenAI embeddings");
  const embedded = await embedTextUnits(service, embeddingModel);
  stats = await service.stats();
  console.log(`Embedded text units: ${embedded}`);
  console.log(`Stored embeddings: ${stats.embeddings}`);
} else {
  step("4. OpenAI embeddings");
  console.log("Skipped because OPENAI_API_KEY is not set.");
}

step("5. Ask");
console.log(`Question: ${query}`);
let result;
try {
  result = await service.ask(query, {
    limit: 8,
    basicSearch: { limit: 10 },
    maxContextChars: 12_000,
    responseStyle: "concise engineering answer with source file citations",
    temperature: 0,
    maxTokens: Number(process.env.GRAG_EXAMPLE_MAX_TOKENS ?? 1200),
  });
} catch (error) {
  console.log(`Model answer failed: ${error instanceof Error ? error.message : String(error)}`);
  console.log("Retrying in extractive mode.");
  const fallbackService = createMemoryGraphRagService({
    ...(embeddingModel ? { embeddingModel } : {}),
  });
  await fallbackService.ingestSnapshot(await service.snapshot());
  result = await fallbackService.ask(query, {
    limit: 8,
    basicSearch: { limit: 10 },
    maxContextChars: 12_000,
  });
}

console.log(`Answer mode: ${result.mode}`);
console.log(`Plan: ${result.trace.find((item) => item.stage === "plan")?.detail ?? "none"}`);

step("6. Trace");
for (const item of result.trace) {
  console.log(`- ${item.stage}: count=${item.count ?? "-"} ${item.detail}`);
}

step("7. Top evidence");
for (const [index, hit] of result.hits.entries()) {
  const source = hit.sourcePaths.join(", ") || hit.title;
  console.log(
    `${index + 1}. score=${hit.score} channels=${hit.channels.join("+")} source=${source}`,
  );
  console.log(`   ${oneLine(hit.text).slice(0, 180)}`);
}

step("8. Answer");
console.log(result.answer);
