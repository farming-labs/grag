import { basename, extname } from "node:path";
import type {
  Community,
  CommunityReport,
  Entity,
  GraphRagDocument,
  GraphRagSnapshot,
  JsonObject,
  Relationship,
  TextUnit,
} from "../model.js";
import { createStableId } from "../utils/ids.js";

export interface LocalRepositoryGraphSourceFile {
  path: string;
  kind: string;
  bytes: number;
  text: string;
}

export interface BuildLocalRepositoryGraphRagSnapshotOptions {
  repoName: string;
  repoPath: string;
  selectedFiles: readonly LocalRepositoryGraphSourceFile[];
  maxTextUnitChars?: number;
}

const COMMUNITY_DEFINITIONS = [
  {
    key: "overview",
    title: "Repository Overview",
    summary: "Repository identity, core purpose, and top-level architecture.",
  },
  {
    key: "source",
    title: "Core Implementation",
    summary: "Primary source files, core features, and exported API surface.",
  },
  {
    key: "storage",
    title: "Storage And Data",
    summary: "Database adapters, schemas, persistence interfaces, and data models.",
  },
  {
    key: "retrieval",
    title: "Integrations And Flows",
    summary: "Integration patterns, data flows, middleware, and key workflows.",
  },
  {
    key: "surface",
    title: "Entry Points And Tooling",
    summary: "CLI tools, REST APIs, framework integrations, and developer-facing surfaces.",
  },
  {
    key: "docs",
    title: "Documentation",
    summary: "Readmes, guides, examples, and documented topics.",
  },
  {
    key: "dependencies",
    title: "Packages And Dependencies",
    summary: "Package manifests, scripts, runtime and dev dependencies.",
  },
] as const;

type CommunityKey = (typeof COMMUNITY_DEFINITIONS)[number]["key"];

interface EntitySeed {
  id: string;
  title: string;
  type: string;
  description: string;
  communityKey: CommunityKey;
  sourcePaths: Set<string>;
  textUnitIds: Set<string>;
  baseRank: number;
  attributes: JsonObject;
}

interface RelationshipSeed {
  id: string;
  sourceId: string;
  targetId: string;
  kind: string;
  description: string;
  weight: number;
  sourcePaths: Set<string>;
  textUnitIds: Set<string>;
}

interface TextUnitSeed {
  id: string;
  humanReadableId: string;
  documentId: string;
  text: string;
  sourcePath: string;
  kind: string;
  entityIds: Set<string>;
  relationshipIds: Set<string>;
}

interface RepositoryConcept {
  title: string;
  type: string;
  description: string;
  communityKey: CommunityKey;
  patterns: RegExp[];
}

interface ExportedSymbol {
  name: string;
  kind: string;
}

interface PackageDependency {
  name: string;
  version: string;
  group: string;
}

const MAX_EXPORTED_SYMBOLS = 120;
const MAX_EXPORTED_SYMBOLS_PER_FILE = 8;
const MAX_DEPENDENCIES = 36;
const MAX_CLI_OPTIONS = 40;
const MAX_ENVIRONMENT_VARIABLES = 32;
const MAX_TABLES = 40;
const MAX_MARKDOWN_TOPICS = 60;

const COMMON_NON_ENV_TOKENS = new Set([
  "API",
  "CLI",
  "CSS",
  "DOM",
  "HTML",
  "HTTP",
  "HTTPS",
  "ID",
  "JSON",
  "LLM",
  "MDX",
  "RAG",
  "SQL",
  "SVG",
  "TS",
  "TSX",
  "UI",
  "URL",
  "UUID",
  "XML",
  "YAML",
]);

const NOISY_SYMBOL_NAMES = new Set([
  "Array",
  "Boolean",
  "Date",
  "Error",
  "File",
  "JSON",
  "Map",
  "Number",
  "Object",
  "Partial",
  "Pick",
  "Promise",
  "Readonly",
  "Record",
  "Set",
  "String",
  "Symbol",
]);

const REPOSITORY_CONCEPTS: RepositoryConcept[] = [
  // ── Authentication & Identity ──
  {
    title: "Authentication",
    type: "Core Feature",
    description: "Core authentication logic handling sign-in, sign-up, and identity verification.",
    communityKey: "source",
    patterns: [
      /\bauth(?:enticate|entication)?\b/i,
      /\bsignIn\b/i,
      /\bsignUp\b/i,
      /\bverif(?:y|ication)\b/i,
    ],
  },
  {
    title: "Session Management",
    type: "Auth Concept",
    description: "Session creation, storage, validation, and expiry across requests.",
    communityKey: "source",
    patterns: [
      /\bsession(?:Store|Token|Manager|Cookie)?\b/i,
      /\bcreateSession\b/i,
      /\bgetSession\b/i,
    ],
  },
  {
    title: "OAuth 2.0 / Social Login",
    type: "Authentication Protocol",
    description:
      "OAuth 2.0 flows and social provider integrations (GitHub, Google, Twitter, etc.).",
    communityKey: "source",
    patterns: [
      /\bOAuth\b/i,
      /\boauth2?\b/i,
      /\bsocial\b/i,
      /\bprovider\b/i,
      /\bgithub.*auth\b/i,
      /\bgoogle.*auth\b/i,
    ],
  },
  {
    title: "Two-Factor Authentication",
    type: "Auth Feature",
    description: "TOTP, OTP, and two-factor verification support.",
    communityKey: "source",
    patterns: [/\btotp\b/i, /\b2fa\b/i, /\btwo.?factor\b/i, /\botp\b/i],
  },
  {
    title: "Magic Link / Passwordless",
    type: "Auth Feature",
    description: "Passwordless authentication via magic links and email verification.",
    communityKey: "source",
    patterns: [/\bmagic.?link\b/i, /\bpasswordless\b/i, /\bemail.*verif\b/i],
  },
  {
    title: "Authorization",
    type: "Security Concept",
    description: "Role-based and permission-based access control.",
    communityKey: "source",
    patterns: [
      /\bauthoriz\b/i,
      /\bpermission\b/i,
      /\brole\b/i,
      /\baccess.?control\b/i,
      /\bRBAC\b/i,
    ],
  },
  // ── Storage & Data ──
  {
    title: "Relational Storage",
    type: "Storage Concept",
    description: "SQL-based durable storage via PostgreSQL, SQLite, or MySQL.",
    communityKey: "storage",
    patterns: [
      /\bPostgres\b/i,
      /\bSQLite\b/i,
      /\bMySQL\b/i,
      /\bKysely\b/i,
      /\brelational\b/i,
      /\bSQL\b/,
    ],
  },
  {
    title: "Database Adapter",
    type: "Storage Adapter",
    description: "Database adapter layer supporting Drizzle, Prisma, Mongoose, and others.",
    communityKey: "storage",
    patterns: [
      /\bdrizzle\b/i,
      /\bprisma\b/i,
      /\bmongoose\b/i,
      /\badapter\b/i,
      /\bdrizzleAdapter\b/i,
    ],
  },
  // ── Plugin / Extension system ──
  {
    title: "Plugin System",
    type: "Extension Mechanism",
    description: "Plugin and middleware architecture for extending core functionality.",
    communityKey: "retrieval",
    patterns: [/\bplugin\b/i, /\bmiddleware\b/i, /\bextension\b/i, /\bhook\b/i],
  },
  // ── API & Framework integrations ──
  {
    title: "REST API",
    type: "API Surface",
    description: "HTTP handler layer exposing authentication routes and REST endpoints.",
    communityKey: "surface",
    patterns: [
      /\bhandler\b/i,
      /\broute\b/i,
      /\bapi\b/i,
      /\bHTTP\b/i,
      /\bfetch\b/i,
      /\bPOST|GET|PUT|DELETE\b/,
    ],
  },
  {
    title: "Next.js Integration",
    type: "Framework Integration",
    description: "Integration with Next.js App Router and API routes.",
    communityKey: "surface",
    patterns: [
      /\bnext\.js\b/i,
      /\bnextjs\b/i,
      /next\/server/i,
      /next\/headers/i,
      /\bNextRequest\b/,
    ],
  },
  {
    title: "CLI Tool",
    type: "Developer Tool",
    description: "Command-line interface for setup, code generation, and administration.",
    communityKey: "surface",
    patterns: [/\bcli\b/i, /\bcommand.line\b/i, /\bbin\b.*cli/i, /\byargs\b/i, /\bcommander\b/i],
  },
  // ── AI / GraphRAG specific (for this repo) ──
  {
    title: "GraphRAG",
    type: "AI Infra Concept",
    description:
      "GraphRAG capability for retrieval over documents, entities, relationships, and communities.",
    communityKey: "overview",
    patterns: [/\bGraphRAG\b/i, /\bGRAG\b/i, /\bknowledge graph\b/i],
  },
  {
    title: "OpenAI Integration",
    type: "LLM Integration",
    description: "OpenAI API integration for extraction, embeddings, or chat completions.",
    communityKey: "retrieval",
    patterns: [/\bOpenAI\b/i, /\bOPENAI_API_KEY\b/, /\bgpt-/i, /\bembedding.*model\b/i],
  },
  // ── Testing ──
  {
    title: "Testing",
    type: "Quality",
    description: "Unit, integration, and end-to-end test infrastructure.",
    communityKey: "source",
    patterns: [/\bvitest\b/i, /\bjest\b/i, /\bdescribe\b/i, /\bit\(['"`]/i, /\btest\b.*spec\b/i],
  },
  // ── Studio / Visualizer (grag-specific) ──
  {
    title: "Studio Visualizer",
    type: "Application Surface",
    description:
      "Interactive visual explorer for graph nodes, relationships, and retrieval results.",
    communityKey: "surface",
    patterns: [/\bstudio\b/i, /\bvisuali[sz]/i, /\bpreview\b/i],
  },
  {
    title: "Document Ingestion",
    type: "Ingestion Flow",
    description:
      "Document chunking and ingestion path that converts source text into graph records.",
    communityKey: "retrieval",
    patterns: [/\bingest/i, /\bchunk/i, /\btext.unit/i],
  },
];

export function buildLocalRepositoryGraphRagSnapshot(
  options: BuildLocalRepositoryGraphRagSnapshotOptions,
): GraphRagSnapshot {
  const maxTextUnitChars = Math.max(2_000, options.maxTextUnitChars ?? 8_000);
  const documents: GraphRagDocument[] = [];
  const textUnitSeeds = new Map<string, TextUnitSeed>();
  const entitySeeds = new Map<string, EntitySeed>();
  const relationshipSeeds = new Map<string, RelationshipSeed>();
  const packageEntityIds: string[] = [];
  const dependencyEntityIds = new Map<string, string>();
  const exportedSymbolEntityIds = new Map<string, string>();

  const communityIdByKey = new Map<CommunityKey, string>(
    COMMUNITY_DEFINITIONS.map((definition) => [
      definition.key,
      createStableId(["repo-community", options.repoName, definition.key], "community"),
    ]),
  );

  const repoEntityId = entityId("repository", options.repoName, options.repoPath);
  upsertEntity(entitySeeds, {
    id: repoEntityId,
    title: options.repoName,
    type: "Repository",
    description: `Repository scanned from ${options.repoPath}.`,
    communityKey: "overview",
    sourcePaths: options.selectedFiles.map((file) => file.path),
    textUnitIds: [],
    baseRank: 8,
    attributes: {
      repositoryName: options.repoName,
      repositoryPath: options.repoPath,
      selectedFileCount: options.selectedFiles.length,
    },
  });

  for (const file of options.selectedFiles) {
    const documentId = createStableId(["repo-document", options.repoPath, file.path], "doc");
    const textUnitId = textUnitIdForPath(options.repoPath, file.path);
    const documentAttributes: JsonObject = {
      sourcePath: file.path,
      sourcePaths: [file.path],
      kind: file.kind,
      bytes: file.bytes,
      repositoryName: options.repoName,
      repositoryPath: options.repoPath,
    };

    documents.push({
      id: documentId,
      humanReadableId: file.path,
      title: file.path,
      type: file.kind,
      text: file.text,
      textUnitIds: [textUnitId],
      attributes: documentAttributes,
    });
    textUnitSeeds.set(textUnitId, {
      id: textUnitId,
      humanReadableId: file.path,
      documentId,
      text: renderFileTextUnit(file, maxTextUnitChars),
      sourcePath: file.path,
      kind: file.kind,
      entityIds: new Set(),
      relationshipIds: new Set(),
    });
  }

  const moduleEntityIds = addFileAndModuleEntities({
    repoPath: options.repoPath,
    repoEntityId,
    files: options.selectedFiles,
    entitySeeds,
    relationshipSeeds,
  });

  addPackageMetadata({
    repoPath: options.repoPath,
    repoEntityId,
    files: options.selectedFiles,
    entitySeeds,
    relationshipSeeds,
    packageEntityIds,
    dependencyEntityIds,
  });

  addExportedSymbols({
    repoPath: options.repoPath,
    files: options.selectedFiles,
    entitySeeds,
    relationshipSeeds,
    exportedSymbolEntityIds,
  });

  addDatabaseTables({
    repoPath: options.repoPath,
    files: options.selectedFiles,
    entitySeeds,
    relationshipSeeds,
  });

  addEnvironmentVariables({
    repoPath: options.repoPath,
    files: options.selectedFiles,
    entitySeeds,
    relationshipSeeds,
  });

  addCliOptions({
    repoPath: options.repoPath,
    files: options.selectedFiles,
    entitySeeds,
    relationshipSeeds,
  });

  addMarkdownTopics({
    repoPath: options.repoPath,
    files: options.selectedFiles,
    entitySeeds,
    relationshipSeeds,
  });

  const conceptEntityIds = addRepositoryConcepts({
    repoPath: options.repoPath,
    files: options.selectedFiles,
    entitySeeds,
    relationshipSeeds,
  });

  addCrossCuttingRelationships({
    entitySeeds,
    relationshipSeeds,
    repoEntityId,
    moduleEntityIds,
    packageEntityIds,
    dependencyEntityIds,
    exportedSymbolEntityIds,
    conceptEntityIds,
  });

  const degreeByEntityId = new Map<string, number>();
  for (const relationship of relationshipSeeds.values()) {
    degreeByEntityId.set(
      relationship.sourceId,
      (degreeByEntityId.get(relationship.sourceId) ?? 0) + 1,
    );
    degreeByEntityId.set(
      relationship.targetId,
      (degreeByEntityId.get(relationship.targetId) ?? 0) + 1,
    );
  }

  for (const entity of entitySeeds.values()) {
    for (const textUnitId of entity.textUnitIds) {
      textUnitSeeds.get(textUnitId)?.entityIds.add(entity.id);
    }
  }
  for (const relationship of relationshipSeeds.values()) {
    for (const textUnitId of relationship.textUnitIds) {
      textUnitSeeds.get(textUnitId)?.relationshipIds.add(relationship.id);
    }
  }

  const entities = Array.from(entitySeeds.values())
    .map((seed): Entity => {
      const degree = degreeByEntityId.get(seed.id) ?? 0;
      const frequency = Math.max(seed.textUnitIds.size, seed.sourcePaths.size, 1);
      const communityId = communityIdByKey.get(seed.communityKey);
      return {
        id: seed.id,
        humanReadableId: seed.title,
        title: seed.title,
        type: seed.type,
        description: seed.description,
        communityIds: communityId ? [communityId] : [],
        textUnitIds: sortedStrings(seed.textUnitIds),
        frequency,
        degree,
        rank: roundRank(seed.baseRank + degree * 0.72 + frequency * 0.28),
        attributes: {
          ...seed.attributes,
          communityKey: seed.communityKey,
          sourcePaths: sortedStrings(seed.sourcePaths),
        },
      };
    })
    .sort(
      (left, right) =>
        (right.rank ?? 0) - (left.rank ?? 0) || left.title.localeCompare(right.title),
    );

  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const relationships = Array.from(relationshipSeeds.values())
    .flatMap((seed): Relationship[] => {
      const source = entityById.get(seed.sourceId);
      const target = entityById.get(seed.targetId);
      if (!source || !target) {
        return [];
      }
      const sourceDegree = degreeByEntityId.get(seed.sourceId) ?? 0;
      const targetDegree = degreeByEntityId.get(seed.targetId) ?? 0;
      const combinedDegree = sourceDegree + targetDegree;
      return [
        {
          id: seed.id,
          humanReadableId: `${source.title} ${seed.kind} ${target.title}`,
          source: source.title,
          target: target.title,
          description: seed.description,
          weight: roundRank(seed.weight),
          combinedDegree,
          rank: roundRank(seed.weight + combinedDegree * 0.12),
          textUnitIds: sortedStrings(seed.textUnitIds),
          attributes: {
            kind: seed.kind,
            sourceEntityId: seed.sourceId,
            targetEntityId: seed.targetId,
            sourcePaths: sortedStrings(seed.sourcePaths),
          },
        },
      ];
    })
    .sort(
      (left, right) =>
        (right.rank ?? 0) - (left.rank ?? 0) ||
        left.source.localeCompare(right.source) ||
        left.target.localeCompare(right.target),
    );

  const textUnits = Array.from(textUnitSeeds.values())
    .map(
      (seed): TextUnit => ({
        id: seed.id,
        humanReadableId: seed.humanReadableId,
        text: seed.text,
        entityIds: sortedStrings(seed.entityIds),
        relationshipIds: sortedStrings(seed.relationshipIds),
        covariateIds: [],
        nTokens: estimateTokenCount(seed.text),
        documentId: seed.documentId,
        attributes: {
          sourcePath: seed.sourcePath,
          sourcePaths: [seed.sourcePath],
          kind: seed.kind,
        },
      }),
    )
    .sort((left, right) =>
      String(left.humanReadableId ?? left.id).localeCompare(
        String(right.humanReadableId ?? right.id),
      ),
    );

  const { communities, communityReports } = buildCommunities({
    communityIdByKey,
    entities,
    relationships,
    textUnits,
  });

  return {
    documents,
    textUnits,
    entities,
    relationships,
    covariates: [],
    communities,
    communityReports,
    embeddings: [],
  };
}

function addFileAndModuleEntities(options: {
  repoPath: string;
  repoEntityId: string;
  files: readonly LocalRepositoryGraphSourceFile[];
  entitySeeds: Map<string, EntitySeed>;
  relationshipSeeds: Map<string, RelationshipSeed>;
}): Map<string, string> {
  const moduleEntityIds = new Map<string, string>();

  for (const file of options.files) {
    const fileEntityId = fileEntityIdForPath(options.repoPath, file.path);
    const textUnitId = textUnitIdForPath(options.repoPath, file.path);
    const communityKey = communityKeyForFile(file);

    upsertEntity(options.entitySeeds, {
      id: fileEntityId,
      title: file.path,
      type: fileEntityType(file),
      description: `${file.kind} file with ${file.bytes} bytes of source evidence.`,
      communityKey,
      sourcePaths: [file.path],
      textUnitIds: [textUnitId],
      baseRank: fileBaseRank(file),
      attributes: {
        sourcePath: file.path,
        kind: file.kind,
        bytes: file.bytes,
        extension: extname(file.path) || "none",
      },
    });

    const moduleName = topLevelModuleName(file.path);
    if (moduleName) {
      const moduleEntityId = moduleEntityIds.get(moduleName) ?? entityId("module", moduleName);
      moduleEntityIds.set(moduleName, moduleEntityId);
      upsertEntity(options.entitySeeds, {
        id: moduleEntityId,
        title: `${moduleName}/`,
        type: "Module",
        description: `Top-level repository module containing ${moduleName} files.`,
        communityKey: communityKeyForModule(moduleName),
        sourcePaths: [file.path],
        textUnitIds: [textUnitId],
        baseRank: 4.8,
        attributes: {
          moduleName,
        },
      });
      addRelationship(options.relationshipSeeds, options.entitySeeds, {
        sourceId: options.repoEntityId,
        targetId: moduleEntityId,
        kind: "contains",
        description: `${basename(options.repoPath)} contains the ${moduleName}/ module.`,
        weight: 2.4,
        sourcePaths: [file.path],
        textUnitIds: [textUnitId],
      });
      addRelationship(options.relationshipSeeds, options.entitySeeds, {
        sourceId: moduleEntityId,
        targetId: fileEntityId,
        kind: "contains",
        description: `${moduleName}/ contains ${file.path}.`,
        weight: 2.2,
        sourcePaths: [file.path],
        textUnitIds: [textUnitId],
      });
      continue;
    }

    addRelationship(options.relationshipSeeds, options.entitySeeds, {
      sourceId: options.repoEntityId,
      targetId: fileEntityId,
      kind: "contains",
      description: `${basename(options.repoPath)} contains ${file.path}.`,
      weight: 2.2,
      sourcePaths: [file.path],
      textUnitIds: [textUnitId],
    });
  }

  return moduleEntityIds;
}

function addPackageMetadata(options: {
  repoPath: string;
  repoEntityId: string;
  files: readonly LocalRepositoryGraphSourceFile[];
  entitySeeds: Map<string, EntitySeed>;
  relationshipSeeds: Map<string, RelationshipSeed>;
  packageEntityIds: string[];
  dependencyEntityIds: Map<string, string>;
}): void {
  for (const file of options.files.filter((entry) => basename(entry.path) === "package.json")) {
    const textUnitId = textUnitIdForPath(options.repoPath, file.path);
    const fileEntityId = fileEntityIdForPath(options.repoPath, file.path);
    const parsed = safeJsonParse(file.text);
    const packageName = stringFromRecord(parsed, "name") ?? `${basename(options.repoPath)} package`;
    const packageEntityId = entityId("package", packageName);
    options.packageEntityIds.push(packageEntityId);

    upsertEntity(options.entitySeeds, {
      id: packageEntityId,
      title: packageName,
      type: "Package",
      description: `Package manifest declared in ${file.path}.`,
      communityKey: "dependencies",
      sourcePaths: [file.path],
      textUnitIds: [textUnitId],
      baseRank: 7,
      attributes: {
        packageName,
        version: stringFromRecord(parsed, "version") ?? "unknown",
        private: booleanFromRecord(parsed, "private") ?? false,
      },
    });
    addRelationship(options.relationshipSeeds, options.entitySeeds, {
      sourceId: options.repoEntityId,
      targetId: packageEntityId,
      kind: "declares package",
      description: `${basename(options.repoPath)} declares the ${packageName} package.`,
      weight: 3.2,
      sourcePaths: [file.path],
      textUnitIds: [textUnitId],
    });
    addRelationship(options.relationshipSeeds, options.entitySeeds, {
      sourceId: fileEntityId,
      targetId: packageEntityId,
      kind: "declares",
      description: `${file.path} declares package metadata for ${packageName}.`,
      weight: 3,
      sourcePaths: [file.path],
      textUnitIds: [textUnitId],
    });

    for (const script of readPackageScripts(parsed).slice(0, 18)) {
      const scriptEntityId = entityId("script", packageName, script.name);
      upsertEntity(options.entitySeeds, {
        id: scriptEntityId,
        title: `npm run ${script.name}`,
        type: "Package Script",
        description: `Package script "${script.name}" runs: ${script.command}`,
        communityKey: "dependencies",
        sourcePaths: [file.path],
        textUnitIds: [textUnitId],
        baseRank: 3.2,
        attributes: {
          scriptName: script.name,
          command: script.command,
        },
      });
      addRelationship(options.relationshipSeeds, options.entitySeeds, {
        sourceId: packageEntityId,
        targetId: scriptEntityId,
        kind: "exposes script",
        description: `${packageName} exposes the npm script "${script.name}".`,
        weight: 2.1,
        sourcePaths: [file.path],
        textUnitIds: [textUnitId],
      });
    }

    for (const dependency of readPackageDependencies(parsed).slice(0, MAX_DEPENDENCIES)) {
      const dependencyEntityId = entityId("dependency", dependency.name);
      options.dependencyEntityIds.set(dependency.name, dependencyEntityId);
      upsertEntity(options.entitySeeds, {
        id: dependencyEntityId,
        title: dependency.name,
        type: "Dependency",
        description: `${dependency.group} dependency ${dependency.name}@${dependency.version}.`,
        communityKey: dependencyCommunityKey(dependency.name),
        sourcePaths: [file.path],
        textUnitIds: [textUnitId],
        baseRank: dependencyBaseRank(dependency.name),
        attributes: {
          dependencyName: dependency.name,
          version: dependency.version,
          dependencyGroup: dependency.group,
        },
      });
      addRelationship(options.relationshipSeeds, options.entitySeeds, {
        sourceId: packageEntityId,
        targetId: dependencyEntityId,
        kind: "depends on",
        description: `${packageName} depends on ${dependency.name}.`,
        weight: dependency.name.includes("orm") || dependency.name === "kysely" ? 3 : 1.8,
        sourcePaths: [file.path],
        textUnitIds: [textUnitId],
      });
    }
  }
}

function addExportedSymbols(options: {
  repoPath: string;
  files: readonly LocalRepositoryGraphSourceFile[];
  entitySeeds: Map<string, EntitySeed>;
  relationshipSeeds: Map<string, RelationshipSeed>;
  exportedSymbolEntityIds: Map<string, string>;
}): void {
  let exportedSymbolCount = 0;
  for (const file of options.files) {
    if (!isCodeFile(file.path) || exportedSymbolCount >= MAX_EXPORTED_SYMBOLS) {
      continue;
    }

    const fileEntityId = fileEntityIdForPath(options.repoPath, file.path);
    const textUnitId = textUnitIdForPath(options.repoPath, file.path);
    const symbols = extractExportedSymbols(file.text).slice(0, MAX_EXPORTED_SYMBOLS_PER_FILE);
    for (const symbol of symbols) {
      if (exportedSymbolCount >= MAX_EXPORTED_SYMBOLS) {
        return;
      }
      const symbolEntityId = entityId("exported-symbol", file.path, symbol.name);
      options.exportedSymbolEntityIds.set(symbol.name, symbolEntityId);
      exportedSymbolCount += 1;
      upsertEntity(options.entitySeeds, {
        id: symbolEntityId,
        title: symbol.name,
        type: "Exported Symbol",
        description: `${symbol.kind} exported from ${file.path}.`,
        communityKey: communityKeyForSymbol(file.path, symbol.name),
        sourcePaths: [file.path],
        textUnitIds: [textUnitId],
        baseRank: symbolBaseRank(symbol.name),
        attributes: {
          symbolName: symbol.name,
          symbolKind: symbol.kind,
          sourcePath: file.path,
        },
      });
      addRelationship(options.relationshipSeeds, options.entitySeeds, {
        sourceId: fileEntityId,
        targetId: symbolEntityId,
        kind: "declares",
        description: `${file.path} declares ${symbol.name}.`,
        weight: symbol.name.includes("GraphRag") || symbol.name.includes("Graph") ? 2.8 : 2,
        sourcePaths: [file.path],
        textUnitIds: [textUnitId],
      });
    }
  }
}

function addDatabaseTables(options: {
  repoPath: string;
  files: readonly LocalRepositoryGraphSourceFile[];
  entitySeeds: Map<string, EntitySeed>;
  relationshipSeeds: Map<string, RelationshipSeed>;
}): void {
  const tableNames = new Set<string>();
  for (const file of options.files) {
    for (const tableName of matchAllUnique(file.text, /\bgrag_[a-z][a-z0-9_]*\b/g)) {
      if (tableNames.size >= MAX_TABLES) {
        return;
      }
      tableNames.add(tableName);
      const textUnitId = textUnitIdForPath(options.repoPath, file.path);
      const tableEntityId = entityId("database-table", tableName);
      upsertEntity(options.entitySeeds, {
        id: tableEntityId,
        title: tableName,
        type: "Database Table",
        description: `Relational table referenced by ${file.path}.`,
        communityKey: "storage",
        sourcePaths: [file.path],
        textUnitIds: [textUnitId],
        baseRank: 4.5,
        attributes: {
          tableName,
        },
      });
      addRelationship(options.relationshipSeeds, options.entitySeeds, {
        sourceId: fileEntityIdForPath(options.repoPath, file.path),
        targetId: tableEntityId,
        kind: "references table",
        description: `${file.path} references relational table ${tableName}.`,
        weight: 2.6,
        sourcePaths: [file.path],
        textUnitIds: [textUnitId],
      });
    }
  }
}

function addEnvironmentVariables(options: {
  repoPath: string;
  files: readonly LocalRepositoryGraphSourceFile[];
  entitySeeds: Map<string, EntitySeed>;
  relationshipSeeds: Map<string, RelationshipSeed>;
}): void {
  const variables = new Set<string>();
  for (const file of options.files) {
    for (const variableName of matchAllUnique(file.text, /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g)) {
      if (variables.size >= MAX_ENVIRONMENT_VARIABLES) {
        return;
      }
      if (COMMON_NON_ENV_TOKENS.has(variableName) || variableName.length > 56) {
        continue;
      }
      variables.add(variableName);
      const textUnitId = textUnitIdForPath(options.repoPath, file.path);
      const variableEntityId = entityId("environment-variable", variableName);
      upsertEntity(options.entitySeeds, {
        id: variableEntityId,
        title: variableName,
        type: "Environment Variable",
        description: `Environment variable referenced by ${file.path}.`,
        communityKey: variableName.includes("DATABASE") ? "storage" : "surface",
        sourcePaths: [file.path],
        textUnitIds: [textUnitId],
        baseRank: variableName.includes("OPENAI") || variableName.includes("DATABASE") ? 4.2 : 2.8,
        attributes: {
          variableName,
        },
      });
      addRelationship(options.relationshipSeeds, options.entitySeeds, {
        sourceId: fileEntityIdForPath(options.repoPath, file.path),
        targetId: variableEntityId,
        kind: "references env",
        description: `${file.path} references environment variable ${variableName}.`,
        weight: 2.1,
        sourcePaths: [file.path],
        textUnitIds: [textUnitId],
      });
    }
  }
}

function addCliOptions(options: {
  repoPath: string;
  files: readonly LocalRepositoryGraphSourceFile[];
  entitySeeds: Map<string, EntitySeed>;
  relationshipSeeds: Map<string, RelationshipSeed>;
}): void {
  const cliOptions = new Set<string>();
  for (const file of options.files) {
    if (!isLikelyCliSurface(file)) {
      continue;
    }

    for (const optionName of matchAllUnique(file.text, /--[a-z][a-z0-9-]{1,44}/g)) {
      if (cliOptions.size >= MAX_CLI_OPTIONS) {
        return;
      }
      cliOptions.add(optionName);
      const textUnitId = textUnitIdForPath(options.repoPath, file.path);
      const optionEntityId = entityId("cli-option", optionName);
      upsertEntity(options.entitySeeds, {
        id: optionEntityId,
        title: optionName,
        type: "CLI Option",
        description: `CLI option referenced by ${file.path}.`,
        communityKey: "surface",
        sourcePaths: [file.path],
        textUnitIds: [textUnitId],
        baseRank: 3,
        attributes: {
          optionName,
        },
      });
      addRelationship(options.relationshipSeeds, options.entitySeeds, {
        sourceId: fileEntityIdForPath(options.repoPath, file.path),
        targetId: optionEntityId,
        kind: "documents option",
        description: `${file.path} documents or implements ${optionName}.`,
        weight: 2,
        sourcePaths: [file.path],
        textUnitIds: [textUnitId],
      });
    }
  }
}

function addMarkdownTopics(options: {
  repoPath: string;
  files: readonly LocalRepositoryGraphSourceFile[];
  entitySeeds: Map<string, EntitySeed>;
  relationshipSeeds: Map<string, RelationshipSeed>;
}): void {
  let topicCount = 0;
  for (const file of options.files) {
    if (!isMarkdownFile(file.path) || topicCount >= MAX_MARKDOWN_TOPICS) {
      continue;
    }

    const fileEntityId = fileEntityIdForPath(options.repoPath, file.path);
    const textUnitId = textUnitIdForPath(options.repoPath, file.path);
    for (const heading of extractMarkdownHeadings(file.text).slice(0, 5)) {
      if (topicCount >= MAX_MARKDOWN_TOPICS) {
        return;
      }
      topicCount += 1;
      const topicEntityId = entityId("documentation-topic", heading);
      upsertEntity(options.entitySeeds, {
        id: topicEntityId,
        title: heading,
        type: "Documentation Topic",
        description: `Documentation topic from ${file.path}.`,
        communityKey: "docs",
        sourcePaths: [file.path],
        textUnitIds: [textUnitId],
        baseRank:
          heading.toLowerCase().includes("storage") || heading.toLowerCase().includes("rag")
            ? 4
            : 2.8,
        attributes: {
          heading,
        },
      });
      addRelationship(options.relationshipSeeds, options.entitySeeds, {
        sourceId: fileEntityId,
        targetId: topicEntityId,
        kind: "documents topic",
        description: `${file.path} documents "${heading}".`,
        weight: 2,
        sourcePaths: [file.path],
        textUnitIds: [textUnitId],
      });
    }
  }
}

function addRepositoryConcepts(options: {
  repoPath: string;
  files: readonly LocalRepositoryGraphSourceFile[];
  entitySeeds: Map<string, EntitySeed>;
  relationshipSeeds: Map<string, RelationshipSeed>;
}): Map<string, string> {
  const conceptEntityIds = new Map<string, string>();
  for (const concept of REPOSITORY_CONCEPTS) {
    const matchingFiles = options.files.filter((file) =>
      concept.patterns.some((pattern) => pattern.test(file.text) || pattern.test(file.path)),
    );
    if (matchingFiles.length === 0) {
      continue;
    }

    const conceptEntityId = entityId("concept", concept.title);
    conceptEntityIds.set(concept.title, conceptEntityId);
    upsertEntity(options.entitySeeds, {
      id: conceptEntityId,
      title: concept.title,
      type: concept.type,
      description: concept.description,
      communityKey: concept.communityKey,
      sourcePaths: matchingFiles.map((file) => file.path),
      textUnitIds: matchingFiles.map((file) => textUnitIdForPath(options.repoPath, file.path)),
      baseRank: 6.2,
      attributes: {
        conceptTitle: concept.title,
      },
    });

    for (const file of matchingFiles.slice(0, 16)) {
      const textUnitId = textUnitIdForPath(options.repoPath, file.path);
      addRelationship(options.relationshipSeeds, options.entitySeeds, {
        sourceId: fileEntityIdForPath(options.repoPath, file.path),
        targetId: conceptEntityId,
        kind: "mentions concept",
        description: `${file.path} provides source evidence for ${concept.title}.`,
        weight: concept.title === "GraphRAG" ? 3 : 2.2,
        sourcePaths: [file.path],
        textUnitIds: [textUnitId],
      });
    }
  }
  return conceptEntityIds;
}

function addCrossCuttingRelationships(options: {
  entitySeeds: Map<string, EntitySeed>;
  relationshipSeeds: Map<string, RelationshipSeed>;
  repoEntityId: string;
  moduleEntityIds: Map<string, string>;
  packageEntityIds: readonly string[];
  dependencyEntityIds: Map<string, string>;
  exportedSymbolEntityIds: Map<string, string>;
  conceptEntityIds: Map<string, string>;
}): void {
  const storageConceptId =
    options.conceptEntityIds.get("Relational Storage") ??
    options.conceptEntityIds.get("Database Adapter");
  const pluginConceptId = options.conceptEntityIds.get("Plugin System");
  const authConceptId = options.conceptEntityIds.get("Authentication");
  const sessionConceptId = options.conceptEntityIds.get("Session Management");
  const apiConceptId = options.conceptEntityIds.get("REST API");

  // Wire storage-related dependencies to the storage concept
  const storageDeps = [
    "kysely",
    "drizzle-orm",
    "prisma",
    "pg",
    "mysql2",
    "@farming-labs/orm",
    "better-sqlite3",
    "mongoose",
    "@prisma/client",
    "drizzle-kit",
  ];
  for (const depName of storageDeps) {
    const depId = options.dependencyEntityIds.get(depName);
    if (depId && storageConceptId) {
      addRelationship(options.relationshipSeeds, options.entitySeeds, {
        sourceId: depId,
        targetId: storageConceptId,
        kind: "supports",
        description: `${depName} is a storage-layer dependency.`,
        weight: 3.0,
        sourcePaths: [],
        textUnitIds: [],
      });
    }
  }

  // Wire exported symbols to their matching concepts
  for (const [name, symbolEntityId] of options.exportedSymbolEntityIds) {
    if (storageConceptId && /[Ss]tore|[Ss]torage|[Ss]chema|[Mm]igration|[Aa]dapter/i.test(name)) {
      addRelationship(options.relationshipSeeds, options.entitySeeds, {
        sourceId: symbolEntityId,
        targetId: storageConceptId,
        kind: "implements",
        description: `${name} is part of the storage API surface.`,
        weight: 2.5,
        sourcePaths: [],
        textUnitIds: [],
      });
    }
    if (authConceptId && /[Aa]uth|[Ss]ignIn|[Ss]ignUp|[Ll]ogin|[Vv]erif/i.test(name)) {
      addRelationship(options.relationshipSeeds, options.entitySeeds, {
        sourceId: symbolEntityId,
        targetId: authConceptId,
        kind: "implements",
        description: `${name} is part of the authentication API surface.`,
        weight: 2.5,
        sourcePaths: [],
        textUnitIds: [],
      });
    }
    if (sessionConceptId && /[Ss]ession/i.test(name)) {
      addRelationship(options.relationshipSeeds, options.entitySeeds, {
        sourceId: symbolEntityId,
        targetId: sessionConceptId,
        kind: "implements",
        description: `${name} is part of the session management API.`,
        weight: 2.5,
        sourcePaths: [],
        textUnitIds: [],
      });
    }
    if (pluginConceptId && /[Pp]lugin|[Mm]iddleware|[Hh]ook/i.test(name)) {
      addRelationship(options.relationshipSeeds, options.entitySeeds, {
        sourceId: symbolEntityId,
        targetId: pluginConceptId,
        kind: "supports",
        description: `${name} is part of the plugin/extension system.`,
        weight: 2.3,
        sourcePaths: [],
        textUnitIds: [],
      });
    }
    if (apiConceptId && /[Hh]andler|[Rr]outer|[Rr]oute|[Ee]ndpoint/i.test(name)) {
      addRelationship(options.relationshipSeeds, options.entitySeeds, {
        sourceId: symbolEntityId,
        targetId: apiConceptId,
        kind: "exposes",
        description: `${name} is part of the API/routing surface.`,
        weight: 2.2,
        sourcePaths: [],
        textUnitIds: [],
      });
    }
  }

  // Wire src/ module to its primary concepts
  const srcModuleId = options.moduleEntityIds.get("src") ?? options.moduleEntityIds.get("packages");
  if (srcModuleId && authConceptId) {
    addRelationship(options.relationshipSeeds, options.entitySeeds, {
      sourceId: srcModuleId,
      targetId: authConceptId,
      kind: "implements",
      description: "The primary source module implements the core authentication behavior.",
      weight: 3.0,
      sourcePaths: [],
      textUnitIds: [],
    });
  }

  // Wire the repo entity to its most important concepts
  for (const conceptId of [authConceptId, storageConceptId, pluginConceptId, apiConceptId].filter(
    Boolean,
  )) {
    addRelationship(options.relationshipSeeds, options.entitySeeds, {
      sourceId: options.repoEntityId,
      targetId: conceptId as string,
      kind: "provides",
      description: "The repository provides this capability.",
      weight: 2.8,
      sourcePaths: [],
      textUnitIds: [],
    });
  }
}

function buildCommunities(options: {
  communityIdByKey: Map<CommunityKey, string>;
  entities: readonly Entity[];
  relationships: readonly Relationship[];
  textUnits: readonly TextUnit[];
}): { communities: Community[]; communityReports: CommunityReport[] } {
  const relationshipsByEntityId = new Map<string, Set<string>>();
  for (const relationship of options.relationships) {
    const sourceEntityId =
      typeof relationship.attributes?.sourceEntityId === "string"
        ? relationship.attributes.sourceEntityId
        : undefined;
    const targetEntityId =
      typeof relationship.attributes?.targetEntityId === "string"
        ? relationship.attributes.targetEntityId
        : undefined;
    if (sourceEntityId) {
      addToSetMap(relationshipsByEntityId, sourceEntityId, relationship.id);
    }
    if (targetEntityId) {
      addToSetMap(relationshipsByEntityId, targetEntityId, relationship.id);
    }
  }

  const textUnitsByEntityId = new Map<string, Set<string>>();
  for (const textUnit of options.textUnits) {
    for (const entityId of textUnit.entityIds) {
      addToSetMap(textUnitsByEntityId, entityId, textUnit.id);
    }
  }

  const communities: Community[] = [];
  const communityReports: CommunityReport[] = [];
  for (const [index, definition] of COMMUNITY_DEFINITIONS.entries()) {
    const communityId = options.communityIdByKey.get(definition.key);
    if (!communityId) {
      continue;
    }

    const communityEntities = options.entities.filter((entity) =>
      entity.communityIds.includes(communityId),
    );
    if (communityEntities.length === 0) {
      continue;
    }

    const entityIds = communityEntities.map((entity) => entity.id);
    const entityIdSet = new Set(entityIds);
    const relationshipIds = sortedStrings(
      flattenSets(entityIds.map((entityId) => relationshipsByEntityId.get(entityId))),
    );
    const textUnitIds = sortedStrings(
      flattenSets(entityIds.map((entityId) => textUnitsByEntityId.get(entityId))),
    );
    const topEntities = communityEntities.slice(0, 7).map((entity) => entity.title);
    const sourcePaths = sortedStrings(
      new Set(communityEntities.flatMap((entity) => sourcePathsFromAttributes(entity.attributes))),
    ).slice(0, 12);

    communities.push({
      id: communityId,
      humanReadableId: definition.title,
      title: definition.title,
      community: index,
      level: 0,
      children: [],
      entityIds,
      relationshipIds,
      textUnitIds,
      covariateIds: [],
      size: communityEntities.length,
      attributes: {
        communityKey: definition.key,
        sourcePaths,
      },
    });

    const reportId = createStableId(["repo-community-report", communityId], "report");

    // Build a richer summary using entity type distributions and top nodes
    const typeCounts = new Map<string, number>();
    for (const e of communityEntities) {
      const t = e.type ?? "Unknown";
      typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
    }
    const topTypes = Array.from(typeCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([type, count]) => `${count} ${type}`)
      .join(", ");

    // Top concept/feature entities (non-structural)
    const semanticEntities = communityEntities
      .filter(
        (e) =>
          ![
            "Package",
            "Package Manifest",
            "Package Script",
            "Dependency",
            "Source File",
            "Documentation File",
            "Example File",
            "Config File",
            "Test File",
            "Readme",
          ].includes(e.type ?? ""),
      )
      .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))
      .slice(0, 6)
      .map((e) => e.title);

    const topNodes = semanticEntities.length > 0 ? semanticEntities : topEntities;

    const summary = [
      definition.summary,
      topNodes.length > 0 ? `Key concepts: ${topNodes.slice(0, 4).join(", ")}.` : "",
      topTypes ? `Contains ${topTypes}.` : "",
    ]
      .filter(Boolean)
      .join(" ");

    // Compute findings from entity groups
    const findings = buildCommunityFindings(
      communityEntities,
      relationshipIds.length,
      definition.key,
    );

    // Better rank: weight by semantic density, not raw count
    const semanticEntityCount = semanticEntities.length;
    const rawRank =
      1 + semanticEntityCount * 1.5 + communityEntities.length / 15 + relationshipIds.length / 25;

    communityReports.push({
      id: reportId,
      humanReadableId: definition.title,
      title: `${definition.title}`,
      community: index,
      level: 0,
      children: [],
      summary,
      fullContent: [
        summary,
        findings.length > 0
          ? `Findings:\n${findings.map((f, i) => `${i + 1}. ${f.summary}: ${f.explanation}`).join("\n")}`
          : "",
        sourcePaths.length > 0 ? `Source evidence: ${sourcePaths.slice(0, 6).join(", ")}.` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      rank: roundRank(rawRank),
      findings,
      fullContentJson: {
        communityKey: definition.key,
        topEntities,
        sourcePaths,
        entityCount: communityEntities.length,
        relationshipCount: relationshipIds.length,
        entityIds: Array.from(entityIdSet),
      },
      attributes: { sourcePaths },
      size: communityEntities.length,
    });
  }

  return { communities, communityReports };
}

function buildCommunityFindings(
  entities: readonly Entity[],
  relationshipCount: number,
  communityKey: string,
): Array<{ summary: string; explanation: string }> {
  const findings: Array<{ summary: string; explanation: string }> = [];

  // Finding 1: top-ranked concept / feature entities
  const conceptTypes = [
    "Core Feature",
    "Auth Concept",
    "Authentication Protocol",
    "Auth Feature",
    "Security Concept",
    "Storage Concept",
    "Storage Adapter",
    "Storage Interface",
    "Storage Implementation",
    "Extension Mechanism",
    "API Surface",
    "Framework Integration",
    "Developer Tool",
    "Application Surface",
    "AI Infra Concept",
    "LLM Integration",
    "Workflow",
    "Retrieval Flow",
    "Ingestion Flow",
  ];
  const concepts = entities
    .filter((e) => conceptTypes.includes(e.type ?? ""))
    .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))
    .slice(0, 4);
  if (concepts.length > 0) {
    findings.push({
      summary: `Core concepts: ${concepts.map((e) => e.title).join(", ")}`,
      explanation: `These ${concepts.length} concept nodes represent the primary capabilities or architectural patterns in this community.`,
    });
  }

  // Finding 2: top packages / dependencies (for dependencies community)
  if (communityKey === "dependencies" || communityKey === "storage") {
    const deps = entities
      .filter((e) => e.type === "Dependency" || e.type === "Package")
      .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))
      .slice(0, 5);
    if (deps.length > 0) {
      findings.push({
        summary: `Key dependencies: ${deps.map((e) => e.title).join(", ")}`,
        explanation: `${deps.length} notable packages shape this community's dependency footprint.`,
      });
    }
  }

  // Finding 3: exported symbols (API surface)
  const symbols = entities
    .filter((e) => e.type === "Exported Symbol")
    .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))
    .slice(0, 5);
  if (symbols.length > 0) {
    findings.push({
      summary: `Public API: ${symbols.map((e) => e.title).join(", ")}`,
      explanation: `${symbols.length} exported symbols form the public API surface of this community.`,
    });
  }

  // Finding 4: documentation topics (for docs community)
  if (communityKey === "docs") {
    const topics = entities
      .filter((e) => e.type === "Documentation Topic")
      .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))
      .slice(0, 6);
    if (topics.length > 0) {
      findings.push({
        summary: `Documented topics: ${topics.map((e) => e.title).join(", ")}`,
        explanation: `${topics.length} documentation topics provide guidance on this community's subject area.`,
      });
    }
  }

  // Finding 5: connectivity summary
  if (relationshipCount > 5) {
    findings.push({
      summary: `Graph connectivity: ${entities.length} entities, ${relationshipCount} relationships`,
      explanation: `High connectivity (avg ${(relationshipCount / Math.max(entities.length, 1)).toFixed(1)} edges/entity) indicates a tightly integrated community.`,
    });
  }

  return findings;
}

function upsertEntity(
  seeds: Map<string, EntitySeed>,
  input: {
    id: string;
    title: string;
    type: string;
    description: string;
    communityKey: CommunityKey;
    sourcePaths: readonly string[];
    textUnitIds: readonly string[];
    baseRank: number;
    attributes?: JsonObject;
  },
): void {
  const existing = seeds.get(input.id);
  if (existing) {
    existing.description = mergeDescription(existing.description, input.description);
    existing.baseRank = Math.max(existing.baseRank, input.baseRank);
    for (const sourcePath of input.sourcePaths) {
      existing.sourcePaths.add(sourcePath);
    }
    for (const textUnitId of input.textUnitIds) {
      existing.textUnitIds.add(textUnitId);
    }
    existing.attributes = {
      ...existing.attributes,
      ...input.attributes,
    };
    return;
  }

  seeds.set(input.id, {
    id: input.id,
    title: input.title,
    type: input.type,
    description: input.description,
    communityKey: input.communityKey,
    sourcePaths: new Set(input.sourcePaths),
    textUnitIds: new Set(input.textUnitIds),
    baseRank: input.baseRank,
    attributes: input.attributes ?? {},
  });
}

function addRelationship(
  seeds: Map<string, RelationshipSeed>,
  entities: Map<string, EntitySeed>,
  input: {
    sourceId: string;
    targetId: string;
    kind: string;
    description: string;
    weight: number;
    sourcePaths: readonly string[];
    textUnitIds: readonly string[];
  },
): void {
  if (
    input.sourceId === input.targetId ||
    !entities.has(input.sourceId) ||
    !entities.has(input.targetId)
  ) {
    return;
  }

  const id = createStableId(
    ["repo-relationship", input.sourceId, input.kind, input.targetId],
    "rel",
  );
  const existing = seeds.get(id);
  if (existing) {
    existing.description = mergeDescription(existing.description, input.description);
    existing.weight = Math.max(existing.weight, input.weight);
    for (const sourcePath of input.sourcePaths) {
      existing.sourcePaths.add(sourcePath);
    }
    for (const textUnitId of input.textUnitIds) {
      existing.textUnitIds.add(textUnitId);
    }
    return;
  }

  seeds.set(id, {
    id,
    sourceId: input.sourceId,
    targetId: input.targetId,
    kind: input.kind,
    description: input.description,
    weight: input.weight,
    sourcePaths: new Set(input.sourcePaths),
    textUnitIds: new Set(input.textUnitIds),
  });
}

function renderFileTextUnit(file: LocalRepositoryGraphSourceFile, maxChars: number): string {
  const header = [`File: ${file.path}`, `Kind: ${file.kind}`, `Bytes: ${file.bytes}`, ""].join(
    "\n",
  );
  const body =
    file.text.length > maxChars ? `${file.text.slice(0, maxChars)}\n\n[truncated]` : file.text;
  return `${header}${body}`;
}

function entityId(kind: string, ...parts: readonly string[]): string {
  return createStableId(["repo-entity", kind, ...parts], "ent");
}

function fileEntityIdForPath(repoPath: string, path: string): string {
  return entityId("file", repoPath, path);
}

function textUnitIdForPath(repoPath: string, path: string): string {
  return createStableId(["repo-text-unit", repoPath, path], "tu");
}

function topLevelModuleName(path: string): string | undefined {
  const [first, second] = path.split("/");
  if (!first || !second) {
    return undefined;
  }
  return first;
}

function communityKeyForFile(file: LocalRepositoryGraphSourceFile): CommunityKey {
  const lower = file.path.toLowerCase();
  const text = file.text.slice(0, 8_000).toLowerCase();
  if (
    file.kind === "readme" ||
    file.kind === "docs" ||
    lower.endsWith(".md") ||
    lower.endsWith(".mdx")
  ) {
    return "docs";
  }
  if (file.kind === "package-manifest" || lower.includes("package.json")) {
    return "dependencies";
  }
  if (
    lower.includes("studio") ||
    lower.includes("cli") ||
    lower.includes("preview") ||
    lower.includes("handler") ||
    lower.includes("route") ||
    lower.includes("api")
  ) {
    return "surface";
  }
  if (
    lower.includes("storage") ||
    lower.includes("sql") ||
    lower.includes("orm") ||
    lower.includes("migration") ||
    lower.includes("adapter") ||
    lower.includes("schema") ||
    text.includes("postgres") ||
    text.includes("sqlite") ||
    text.includes("drizzle") ||
    text.includes("prisma") ||
    text.includes("mysql")
  ) {
    return "storage";
  }
  if (
    lower.includes("plugin") ||
    lower.includes("middleware") ||
    lower.includes("hook") ||
    lower.includes("pipeline") ||
    lower.includes("integrat") ||
    lower.includes("query") ||
    lower.includes("retriev") ||
    lower.includes("ingest")
  ) {
    return "retrieval";
  }
  return "source";
}

function communityKeyForModule(moduleName: string): CommunityKey {
  const lower = moduleName.toLowerCase();
  if (lower.includes("doc")) return "docs";
  if (
    lower.includes("studio") ||
    lower.includes("cli") ||
    lower.includes("example") ||
    lower.includes("app") ||
    lower.includes("api")
  )
    return "surface";
  if (
    lower.includes("storage") ||
    lower.includes("sql") ||
    lower.includes("orm") ||
    lower.includes("adapter") ||
    lower.includes("schema") ||
    lower.includes("db") ||
    lower.includes("database") ||
    lower.includes("migration")
  )
    return "storage";
  if (
    lower.includes("plugin") ||
    lower.includes("middleware") ||
    lower.includes("hook") ||
    lower.includes("query") ||
    lower.includes("ingest") ||
    lower.includes("pipeline") ||
    lower.includes("integrat")
  )
    return "retrieval";
  if (lower.includes("test")) return "source";
  return "source";
}

function communityKeyForSymbol(path: string, symbolName: string): CommunityKey {
  const lower = `${path} ${symbolName}`.toLowerCase();
  if (
    lower.includes("store") ||
    lower.includes("storage") ||
    lower.includes("schema") ||
    lower.includes("migration") ||
    lower.includes("sql") ||
    lower.includes("orm") ||
    lower.includes("adapter") ||
    lower.includes("drizzle") ||
    lower.includes("prisma") ||
    lower.includes("database") ||
    lower.includes("db")
  ) {
    return "storage";
  }
  if (
    lower.includes("plugin") ||
    lower.includes("middleware") ||
    lower.includes("hook") ||
    lower.includes("pipeline") ||
    lower.includes("integrat") ||
    lower.includes("retrieve") ||
    lower.includes("search") ||
    lower.includes("query") ||
    lower.includes("ingest")
  ) {
    return "retrieval";
  }
  if (
    lower.includes("studio") ||
    lower.includes("cli") ||
    lower.includes("preview") ||
    lower.includes("html") ||
    lower.includes("handler") ||
    lower.includes("route") ||
    lower.includes("api")
  ) {
    return "surface";
  }
  return "source";
}

function dependencyCommunityKey(name: string): CommunityKey {
  if (
    name === "@farming-labs/orm" ||
    name === "kysely" ||
    name.includes("sqlite") ||
    name === "pg" ||
    name === "mysql2" ||
    name === "drizzle-orm" ||
    name === "drizzle-kit" ||
    name === "mongoose" ||
    name === "@prisma/client" ||
    name === "prisma" ||
    name === "better-sqlite3" ||
    name.includes("database")
  ) {
    return "storage";
  }
  if (
    name.includes("vite") ||
    name.includes("react") ||
    name.includes("lucide") ||
    name.includes("next") ||
    name.includes("astro") ||
    name.includes("svelte") ||
    name.includes("nuxt") ||
    name.includes("remix") ||
    name.includes("hono") ||
    name.includes("express") ||
    name.includes("fastify")
  ) {
    return "surface";
  }
  return "dependencies";
}

function fileEntityType(file: LocalRepositoryGraphSourceFile): string {
  switch (file.kind) {
    case "readme":
      return "Readme";
    case "package-manifest":
      return "Package Manifest";
    case "docs":
      return "Documentation File";
    case "example":
      return "Example File";
    case "test":
      return "Test File";
    case "config":
      return "Config File";
    default:
      return "Source File";
  }
}

function fileBaseRank(file: LocalRepositoryGraphSourceFile): number {
  if (file.kind === "readme") return 5.8;
  if (file.kind === "package-manifest") return 5.6;
  if (file.path.includes("index.")) return 5.2;
  if (file.path.includes("cli.")) return 5.1;
  if (file.path.includes("store") || file.path.includes("storage")) return 5.1;
  return 3.8;
}

function symbolBaseRank(symbolName: string): number {
  if (/GraphRag|Graph|Store|Service|Pipeline|Studio/i.test(symbolName)) return 4.8;
  if (/Auth|Session|OAuth|Plugin|Adapter|Handler|Router|Provider/i.test(symbolName)) return 4.6;
  if (/create[A-Z]|use[A-Z]|build[A-Z]|make[A-Z]/i.test(symbolName)) return 4.2;
  return 3.2;
}

function dependencyBaseRank(name: string): number {
  // Core ORM / DB drivers
  if (
    [
      "kysely",
      "drizzle-orm",
      "prisma",
      "mongoose",
      "@prisma/client",
      "@farming-labs/orm",
      "pg",
      "mysql2",
      "better-sqlite3",
    ].includes(name)
  )
    return 5.4;
  // Auth / identity libraries
  if (
    name.includes("auth") ||
    name.includes("next-auth") ||
    name.includes("passport") ||
    name.includes("jose") ||
    name.includes("jsonwebtoken")
  )
    return 5.2;
  // AI / schema
  if (name.includes("openai") || name === "zod" || name.includes("ai-sdk")) return 4.4;
  // Framework runtimes
  if (
    ["next", "astro", "svelte", "nuxt", "@remix-run/node", "express", "fastify", "hono"].some((f) =>
      name.includes(f),
    )
  )
    return 4.2;
  return 2.8;
}

function isCodeFile(path: string): boolean {
  return [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(extname(path).toLowerCase());
}

function isMarkdownFile(path: string): boolean {
  return (
    [".md", ".mdx"].includes(extname(path).toLowerCase()) ||
    basename(path).toLowerCase().startsWith("readme")
  );
}

function isLikelyCliSurface(file: LocalRepositoryGraphSourceFile): boolean {
  const lower = file.path.toLowerCase();
  return (
    lower.includes("cli") ||
    lower.includes("readme") ||
    lower.startsWith("docs/") ||
    /\bcommand\b|--[a-z]/i.test(file.text)
  );
}

function extractExportedSymbols(text: string): ExportedSymbol[] {
  const symbols = new Map<string, ExportedSymbol>();
  const declarationPattern =
    /\bexport\s+(?:declare\s+)?(?:async\s+)?(class|function|interface|type|const|let|var|enum)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of text.matchAll(declarationPattern)) {
    const kind = match[1];
    const name = match[2];
    if (kind && name && isMeaningfulSymbolName(name)) {
      symbols.set(name, { name, kind });
    }
  }

  const defaultPattern =
    /\bexport\s+default\s+(?:async\s+)?(?:class|function)?\s*([A-Za-z_$][\w$]*)/g;
  for (const match of text.matchAll(defaultPattern)) {
    const name = match[1];
    if (name && isMeaningfulSymbolName(name)) {
      symbols.set(name, { name, kind: "default export" });
    }
  }

  const namedExportPattern = /\bexport\s*\{([^}]+)\}/g;
  for (const match of text.matchAll(namedExportPattern)) {
    const exportList = match[1];
    if (!exportList) {
      continue;
    }
    for (const entry of exportList.split(",")) {
      const name = entry
        .trim()
        .split(/\s+as\s+/i)
        .at(-1)
        ?.trim();
      if (name && isMeaningfulSymbolName(name)) {
        symbols.set(name, { name, kind: "named export" });
      }
    }
  }

  return Array.from(symbols.values());
}

function isMeaningfulSymbolName(name: string): boolean {
  return name.length >= 3 && !NOISY_SYMBOL_NAMES.has(name) && !/^z[A-Z.]/.test(name);
}

function extractMarkdownHeadings(text: string): string[] {
  const headings = new Set<string>();
  for (const match of text.matchAll(/^#{1,3}\s+(.+)$/gm)) {
    const heading = cleanHeading(match[1] ?? "");
    if (heading) {
      headings.add(heading);
    }
  }
  return Array.from(headings);
}

function cleanHeading(value: string): string | undefined {
  const heading = value
    .replace(/[`*_#]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  if (!heading || heading.length < 3 || /^table of contents$/i.test(heading)) {
    return undefined;
  }
  return heading;
}

function readPackageDependencies(value: unknown): PackageDependency[] {
  const groups = ["dependencies", "peerDependencies", "optionalDependencies", "devDependencies"];
  const dependencies: PackageDependency[] = [];
  for (const group of groups) {
    const record = recordFromRecord(value, group);
    if (!record) {
      continue;
    }
    for (const [name, version] of Object.entries(record)) {
      if (typeof version === "string") {
        dependencies.push({ name, version, group });
      }
    }
  }
  return dependencies.sort(
    (left, right) =>
      dependencySortScore(right.name) - dependencySortScore(left.name) ||
      left.name.localeCompare(right.name),
  );
}

function readPackageScripts(value: unknown): Array<{ name: string; command: string }> {
  const scripts = recordFromRecord(value, "scripts");
  if (!scripts) {
    return [];
  }
  return Object.entries(scripts)
    .flatMap(([name, command]) => (typeof command === "string" ? [{ name, command }] : []))
    .sort(
      (left, right) =>
        scriptSortScore(right.name) - scriptSortScore(left.name) ||
        left.name.localeCompare(right.name),
    );
}

function dependencySortScore(name: string): number {
  if (name === "@farming-labs/orm") return 100;
  if (["kysely", "drizzle-orm", "prisma", "@prisma/client", "mongoose"].includes(name)) return 90;
  if (name === "zod" || name.includes("jose") || name.includes("jsonwebtoken")) return 80;
  if (name.includes("openai") || name.includes("ai-sdk")) return 75;
  if (name.includes("auth") || name.includes("next-auth") || name.includes("passport")) return 72;
  if (name === "pg" || name.includes("sqlite") || name === "mysql2" || name === "better-sqlite3")
    return 65;
  if (
    ["next", "astro", "svelte", "nuxt", "hono", "express", "fastify"].some((f) => name.includes(f))
  )
    return 50;
  if (name.includes("vite") || name.includes("react")) return 45;
  return 10;
}

function scriptSortScore(name: string): number {
  if (name === "build") return 80;
  if (name === "check") return 75;
  if (name === "test") return 70;
  if (name.includes("studio")) return 65;
  if (name.includes("dev")) return 60;
  return 10;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function stringFromRecord(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const result = value[key];
  return typeof result === "string" ? result : undefined;
}

function booleanFromRecord(value: unknown, key: string): boolean | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const result = value[key];
  return typeof result === "boolean" ? result : undefined;
}

function recordFromRecord(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const result = value[key];
  return isRecord(result) ? result : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function matchAllUnique(text: string, pattern: RegExp): string[] {
  return Array.from(
    new Set(Array.from(text.matchAll(pattern)).flatMap((match) => (match[0] ? [match[0]] : []))),
  );
}

function sourcePathsFromAttributes(attributes: unknown): string[] {
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) {
    return [];
  }
  const record = attributes as Record<string, unknown>;
  const sourcePaths = Array.isArray(record.sourcePaths)
    ? record.sourcePaths.filter((value): value is string => typeof value === "string")
    : [];
  const sourcePath = typeof record.sourcePath === "string" ? [record.sourcePath] : [];
  return Array.from(new Set([...sourcePaths, ...sourcePath]));
}

function addToSetMap(map: Map<string, Set<string>>, key: string, value: string): void {
  const set = map.get(key) ?? new Set<string>();
  set.add(value);
  map.set(key, set);
}

function flattenSets(sets: Array<Set<string> | undefined>): Set<string> {
  const output = new Set<string>();
  for (const set of sets) {
    if (!set) {
      continue;
    }
    for (const value of set) {
      output.add(value);
    }
  }
  return output;
}

function sortedStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(values))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function mergeDescription(left: string, right: string): string {
  if (left === right || left.includes(right)) {
    return left;
  }
  if (right.includes(left)) {
    return right;
  }
  return `${left} ${right}`.slice(0, 1_200);
}

function estimateTokenCount(text: string): number {
  return Math.ceil(text.split(/\s+/).filter(Boolean).length * 1.15);
}

function roundRank(value: number): number {
  return Math.round(value * 100) / 100;
}
