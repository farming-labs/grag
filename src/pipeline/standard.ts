import type {
  Community,
  CommunityReport,
  Covariate,
  EmbeddingRecord,
  EmbeddingTargetKind,
  Entity,
  GraphRagDocument,
  Relationship,
  TextUnit
} from "../model.js";
import { chunkDocuments } from "../ingest/chunk.js";
import { mapLimit } from "../utils/concurrency.js";
import { createStableId } from "../utils/ids.js";
import type {
  GraphExtractionResult,
  PipelineStepResult,
  StandardGraphRagIndexOptions,
  StandardGraphRagIndexResult,
  StandardGraphRagPipelineOptions
} from "./types.js";

// Internal results that carry the back-linked collections through the pipeline.
interface InternalGraphResult {
  entities: Entity[];
  relationships: Relationship[];
  textUnits: TextUnit[]; // back-linked with entityIds / relationshipIds
}

interface InternalCommunityResult {
  communities: Community[];
  entities: Entity[]; // updated with communityIds + degree/rank/frequency
}

export class StandardGraphRagPipeline {
  private readonly options: StandardGraphRagPipelineOptions;

  constructor(options: StandardGraphRagPipelineOptions) {
    this.options = options;
  }

  async indexDocuments(
    documents: readonly GraphRagDocument[],
    options: StandardGraphRagIndexOptions = {}
  ): Promise<StandardGraphRagIndexResult> {
    const steps: PipelineStepResult[] = [];
    const chunkOptions: { chunkSize?: number; overlap?: number } = {};
    if (options.chunkSize !== undefined) chunkOptions.chunkSize = options.chunkSize;
    if (options.chunkOverlap !== undefined) chunkOptions.overlap = options.chunkOverlap;
    const chunked = chunkDocuments(documents, chunkOptions);

    await this.options.store.upsertGraph({
      documents: chunked.documents,
      textUnits: chunked.textUnits
    });
    steps.push({ name: "compose_text_units", status: "success", count: chunked.textUnits.length });
    steps.push({ name: "link_documents", status: "success", count: chunked.documents.length });

    const graph = await this.extractGraph(chunked.textUnits, options, steps);
    const covariates = await this.extractClaims(graph.textUnits, graph, options, steps);
    const { communities, entities: linkedEntities } = await this.detectCommunities(graph, steps);
    const communityReports = await this.generateCommunityReports(
      communities,
      { entities: linkedEntities, relationships: graph.relationships },
      covariates,
      graph.textUnits,
      options,
      steps
    );
    const embeddings = await this.generateEmbeddings(
      graph.textUnits,
      linkedEntities,
      communityReports,
      steps
    );

    return {
      documents: chunked.documents,
      textUnits: graph.textUnits,       // back-linked with entityIds/relationshipIds
      entities: linkedEntities,          // with degree, rank, frequency, communityIds
      relationships: graph.relationships,
      covariates,
      communities,
      communityReports,
      embeddings,
      steps
    };
  }

  private async extractGraph(
    textUnits: readonly TextUnit[],
    options: StandardGraphRagIndexOptions,
    steps: PipelineStepResult[]
  ): Promise<InternalGraphResult> {
    if (!this.options.graphExtractor) {
      steps.push({ name: "extract_graph", status: "skipped" });
      return { entities: [], relationships: [], textUnits: [...textUnits] };
    }

    const concurrency = options.concurrency ?? this.options.concurrency ?? 4;
    const extracted = await mapLimit(
      textUnits,
      concurrency,
      (textUnit) => this.options.graphExtractor!.extract(textUnit)
    );
    const merged = mergeGraphExtraction(extracted);

    // Compute entity stats from the merged graph
    const scoredEntities = computeEntityStats(merged.entities, merged.relationships);

    // Back-link text units: fill entityIds and relationshipIds from the graph
    const linkedTextUnits = backLinkTextUnits(textUnits, scoredEntities, merged.relationships);

    await this.options.store.upsertGraph({
      entities: scoredEntities,
      relationships: merged.relationships,
      textUnits: linkedTextUnits
    });

    steps.push({
      name: "extract_graph",
      status: "success",
      count: scoredEntities.length + merged.relationships.length
    });

    return { entities: scoredEntities, relationships: merged.relationships, textUnits: linkedTextUnits };
  }

  private async extractClaims(
    textUnits: readonly TextUnit[],
    graph: Pick<InternalGraphResult, "entities" | "relationships">,
    options: StandardGraphRagIndexOptions,
    steps: PipelineStepResult[]
  ): Promise<Covariate[]> {
    if (!this.options.claimExtractor) {
      steps.push({ name: "extract_claims", status: "skipped" });
      return [];
    }

    const concurrency = options.concurrency ?? this.options.concurrency ?? 4;
    const graphResult: GraphExtractionResult = { entities: graph.entities, relationships: graph.relationships };
    const nested = await mapLimit(
      textUnits,
      concurrency,
      (textUnit) => this.options.claimExtractor!.extract(textUnit, graphResult)
    );
    const covariates = nested.flat();

    await this.options.store.upsertCovariates(covariates);
    steps.push({ name: "extract_claims", status: "success", count: covariates.length });

    return covariates;
  }

  private async detectCommunities(
    graph: InternalGraphResult,
    steps: PipelineStepResult[]
  ): Promise<InternalCommunityResult> {
    if (!this.options.communityDetector) {
      steps.push({ name: "detect_communities", status: "skipped" });
      return { communities: [], entities: graph.entities };
    }

    const communities = await this.options.communityDetector.detect({
      entities: graph.entities,
      relationships: graph.relationships,
      textUnits: graph.textUnits
    });

    // Update entities with their communityIds so the result and store stay in sync
    const linkedEntities = linkEntitiesToCommunities(graph.entities, communities);

    await this.options.store.upsertCommunities(communities);
    // Re-upsert entities so communityIds are reflected in the join table
    await this.options.store.upsertEntities(linkedEntities);

    steps.push({ name: "detect_communities", status: "success", count: communities.length });

    return { communities, entities: linkedEntities };
  }

  private async generateCommunityReports(
    communities: readonly Community[],
    graph: Pick<InternalGraphResult, "entities" | "relationships">,
    covariates: readonly Covariate[],
    textUnits: readonly TextUnit[],
    options: StandardGraphRagIndexOptions,
    steps: PipelineStepResult[]
  ): Promise<CommunityReport[]> {
    if (!this.options.communityReporter) {
      steps.push({ name: "generate_community_reports", status: "skipped" });
      return [];
    }

    const concurrency = options.concurrency ?? this.options.concurrency ?? 4;
    const reports = await mapLimit(
      communities,
      concurrency,
      (community) =>
        this.options.communityReporter!.report({
          community,
          entities: graph.entities.filter((e) => community.entityIds.includes(e.id)),
          relationships: graph.relationships.filter((r) =>
            community.relationshipIds.includes(r.id)
          ),
          covariates: covariates.filter((c) => community.covariateIds.includes(c.id)),
          textUnits: textUnits.filter((t) => community.textUnitIds.includes(t.id))
        })
    );

    await this.options.store.upsertCommunityReports(reports);
    steps.push({ name: "generate_community_reports", status: "success", count: reports.length });

    return reports;
  }

  private async generateEmbeddings(
    textUnits: readonly TextUnit[],
    entities: readonly Entity[],
    communityReports: readonly CommunityReport[],
    steps: PipelineStepResult[]
  ): Promise<EmbeddingRecord[]> {
    if (!this.options.embeddingModel) {
      steps.push({ name: "generate_embeddings", status: "skipped" });
      return [];
    }

    const config = {
      embedTextUnits: true,
      embedEntities: true,
      embedCommunityReports: true,
      ...this.options.embeddings
    };
    const targets = [
      ...(config.embedTextUnits
        ? textUnits.map((tu) => ({ kind: "text_unit" as const, id: tu.id, text: tu.text }))
        : []),
      ...(config.embedEntities
        ? entities.map((e) => ({
            kind: "entity" as const,
            id: e.id,
            text: [e.title, e.description].filter(Boolean).join("\n")
          }))
        : []),
      ...(config.embedCommunityReports
        ? communityReports.map((r) => ({
            kind: "community_report" as const,
            id: r.id,
            text: r.fullContent || r.summary
          }))
        : [])
    ];

    const vectors = await this.options.embeddingModel.embed(targets.map((t) => t.text));
    const embeddings = targets.map((t, i) =>
      toEmbeddingRecord(t.kind, t.id, t.text, vectors[i] ?? [], config.model)
    );

    await this.options.store.upsertEmbeddings(embeddings);
    steps.push({ name: "generate_embeddings", status: "success", count: embeddings.length });

    return embeddings;
  }
}

// ---------------------------------------------------------------------------
// Graph merging

function mergeGraphExtraction(results: readonly GraphExtractionResult[]): GraphExtractionResult {
  const entities = new Map<string, Entity>();
  const relationships = new Map<string, Relationship>();

  for (const result of results) {
    for (const entity of result.entities) {
      const key = `${entity.type ?? ""}:${entity.title}`.toLowerCase();
      const current = entities.get(key);
      entities.set(
        key,
        current
          ? {
              ...current,
              description: mergeDescription(current.description, entity.description),
              textUnitIds: unique([...(current.textUnitIds ?? []), ...(entity.textUnitIds ?? [])])
            }
          : {
              ...entity,
              id: entity.id || createStableId([entity.type ?? "", entity.title], "ent"),
              textUnitIds: entity.textUnitIds ?? [],
              communityIds: entity.communityIds ?? []
            }
      );
    }

    for (const relationship of result.relationships) {
      const key = `${relationship.source}->${relationship.target}`.toLowerCase();
      const current = relationships.get(key);
      relationships.set(
        key,
        current
          ? {
              ...current,
              description: mergeDescription(current.description, relationship.description),
              weight: (current.weight ?? 1) + (relationship.weight ?? 1),
              textUnitIds: unique([...(current.textUnitIds ?? []), ...(relationship.textUnitIds ?? [])])
            }
          : {
              ...relationship,
              id: relationship.id || createStableId([relationship.source, relationship.target], "rel"),
              textUnitIds: relationship.textUnitIds ?? []
            }
      );
    }
  }

  return { entities: [...entities.values()], relationships: [...relationships.values()] };
}

// ---------------------------------------------------------------------------
// Entity stats: degree, frequency, rank

function computeEntityStats(entities: readonly Entity[], relationships: readonly Relationship[]): Entity[] {
  const degreeByTitle = new Map<string, number>();
  for (const rel of relationships) {
    degreeByTitle.set(rel.source, (degreeByTitle.get(rel.source) ?? 0) + 1);
    degreeByTitle.set(rel.target, (degreeByTitle.get(rel.target) ?? 0) + 1);
  }
  const maxDegree = Math.max(1, ...degreeByTitle.values());

  return entities.map((entity) => {
    const degree = degreeByTitle.get(entity.title) ?? 0;
    return {
      ...entity,
      degree,
      frequency: entity.textUnitIds.length,
      rank: degree / maxDegree
    };
  });
}

// ---------------------------------------------------------------------------
// Back-link text units with entityIds and relationshipIds from the merged graph

function backLinkTextUnits(
  textUnits: readonly TextUnit[],
  entities: readonly Entity[],
  relationships: readonly Relationship[]
): TextUnit[] {
  const entityIdsByTextUnit = new Map<string, string[]>();
  const relationshipIdsByTextUnit = new Map<string, string[]>();

  for (const entity of entities) {
    for (const tuId of entity.textUnitIds) {
      const ids = entityIdsByTextUnit.get(tuId) ?? [];
      ids.push(entity.id);
      entityIdsByTextUnit.set(tuId, ids);
    }
  }

  for (const rel of relationships) {
    for (const tuId of rel.textUnitIds) {
      const ids = relationshipIdsByTextUnit.get(tuId) ?? [];
      ids.push(rel.id);
      relationshipIdsByTextUnit.set(tuId, ids);
    }
  }

  return textUnits.map((tu) => ({
    ...tu,
    entityIds: unique([...tu.entityIds, ...(entityIdsByTextUnit.get(tu.id) ?? [])]),
    relationshipIds: unique([...tu.relationshipIds, ...(relationshipIdsByTextUnit.get(tu.id) ?? [])])
  }));
}

// ---------------------------------------------------------------------------
// Link entity communityIds after community detection

function linkEntitiesToCommunities(entities: readonly Entity[], communities: readonly Community[]): Entity[] {
  const communityIdsByEntityId = new Map<string, string[]>();
  for (const community of communities) {
    for (const entityId of community.entityIds) {
      const ids = communityIdsByEntityId.get(entityId) ?? [];
      ids.push(community.id);
      communityIdsByEntityId.set(entityId, ids);
    }
  }

  return entities.map((entity) => ({
    ...entity,
    communityIds: unique([
      ...entity.communityIds,
      ...(communityIdsByEntityId.get(entity.id) ?? [])
    ])
  }));
}

// ---------------------------------------------------------------------------
// Utilities

function mergeDescription(left: string | null | undefined, right: string | null | undefined): string {
  return unique([left, right].filter((v): v is string => Boolean(v))).join("\n");
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function toEmbeddingRecord(
  targetKind: EmbeddingTargetKind,
  targetId: string,
  text: string,
  vector: number[],
  model?: string
): EmbeddingRecord {
  return {
    id: createStableId([targetKind, targetId, model ?? "default"], "emb"),
    targetKind,
    targetId,
    vector,
    model,
    dimensions: vector.length,
    text
  };
}
