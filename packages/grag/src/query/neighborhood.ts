import type {
  Community,
  CommunityReport,
  Entity,
  Relationship,
  TextUnit
} from "../model.js";
import type { GraphRagStore } from "../storage/types.js";

export interface GraphRagNeighborhoodOptions {
  entityIds?: readonly string[];
  relationshipIds?: readonly string[];
  communityIds?: readonly string[];
  textUnitIds?: readonly string[];
  documentIds?: readonly string[];
  maxTextUnits?: number;
  maxEntities?: number;
  maxRelationships?: number;
  maxCommunities?: number;
  includeCommunityReports?: boolean;
}

export interface GraphRagNeighborhood {
  entities: Entity[];
  relationships: Relationship[];
  communities: Community[];
  communityReports: CommunityReport[];
  textUnits: TextUnit[];
  context: string;
}

const DEFAULT_MAX_TEXT_UNITS = 12;
const DEFAULT_MAX_ENTITIES = 24;
const DEFAULT_MAX_RELATIONSHIPS = 24;
const DEFAULT_MAX_COMMUNITIES = 8;

export async function loadGraphRagNeighborhood(
  store: GraphRagStore,
  options: GraphRagNeighborhoodOptions
): Promise<GraphRagNeighborhood> {
  const [allEntities, allRelationships, allCommunities, allReports, allTextUnits] = await Promise.all([
    store.listEntities(),
    store.listRelationships(),
    store.listCommunities(),
    store.listCommunityReports(),
    store.listTextUnits()
  ]);
  const entityById = new Map(allEntities.map((entity) => [entity.id, entity]));
  const entityByTitle = new Map(allEntities.map((entity) => [entity.title, entity]));
  const relationshipById = new Map(allRelationships.map((relationship) => [relationship.id, relationship]));
  const communityById = new Map(allCommunities.map((community) => [community.id, community]));
  const textUnitById = new Map(allTextUnits.map((textUnit) => [textUnit.id, textUnit]));
  const entityIds = new Set(options.entityIds ?? []);
  const relationshipIds = new Set(options.relationshipIds ?? []);
  const communityIds = new Set(options.communityIds ?? []);
  const textUnitIds = new Set(options.textUnitIds ?? []);

  for (const documentId of options.documentIds ?? []) {
    for (const textUnit of allTextUnits) {
      if (textUnit.documentId === documentId) {
        textUnitIds.add(textUnit.id);
      }
    }
  }

  for (const textUnitId of [...textUnitIds]) {
    const textUnit = textUnitById.get(textUnitId);
    if (!textUnit) continue;
    for (const entityId of textUnit.entityIds) entityIds.add(entityId);
    for (const relationshipId of textUnit.relationshipIds) relationshipIds.add(relationshipId);
  }

  for (const entityId of [...entityIds]) {
    const entity = entityById.get(entityId);
    if (!entity) continue;
    for (const textUnitId of entity.textUnitIds) textUnitIds.add(textUnitId);
    for (const communityId of entity.communityIds) communityIds.add(communityId);
  }

  for (const communityId of [...communityIds]) {
    const community = communityById.get(communityId);
    if (!community) continue;
    for (const entityId of community.entityIds) entityIds.add(entityId);
    for (const relationshipId of community.relationshipIds) relationshipIds.add(relationshipId);
    for (const textUnitId of community.textUnitIds) textUnitIds.add(textUnitId);
  }

  for (const relationship of allRelationships) {
    const endpoints = relationshipEndpointEntityIds(relationship, entityByTitle);
    if (
      relationshipIds.has(relationship.id) ||
      endpoints.some((entityId) => entityIds.has(entityId))
    ) {
      relationshipIds.add(relationship.id);
      for (const entityId of endpoints) entityIds.add(entityId);
      for (const textUnitId of relationship.textUnitIds) textUnitIds.add(textUnitId);
    }
  }

  for (const textUnitId of [...textUnitIds]) {
    const textUnit = textUnitById.get(textUnitId);
    if (!textUnit) continue;
    for (const entityId of textUnit.entityIds) entityIds.add(entityId);
    for (const relationshipId of textUnit.relationshipIds) relationshipIds.add(relationshipId);
  }

  const entities = rankedEntities([...entityIds].flatMap((id) => entityById.get(id) ?? []))
    .slice(0, options.maxEntities ?? DEFAULT_MAX_ENTITIES);
  const relationships = rankedRelationships([...relationshipIds].flatMap((id) => relationshipById.get(id) ?? []))
    .slice(0, options.maxRelationships ?? DEFAULT_MAX_RELATIONSHIPS);
  const communities = rankedCommunities([...communityIds].flatMap((id) => communityById.get(id) ?? []))
    .slice(0, options.maxCommunities ?? DEFAULT_MAX_COMMUNITIES);
  const selectedEntityIds = new Set(entities.map((entity) => entity.id));
  const selectedRelationshipIds = new Set(relationships.map((relationship) => relationship.id));
  const selectedCommunityNumbers = new Set(communities.map((community) => community.community));
  const textUnits = rankedTextUnits([...textUnitIds].flatMap((id) => textUnitById.get(id) ?? []), {
    entityIds: selectedEntityIds,
    relationshipIds: selectedRelationshipIds
  }).slice(0, options.maxTextUnits ?? DEFAULT_MAX_TEXT_UNITS);
  const communityReports = options.includeCommunityReports === false
    ? []
    : allReports
        .filter((report) => selectedCommunityNumbers.has(report.community))
        .sort((left, right) => right.rank - left.rank);

  return {
    entities,
    relationships,
    communities,
    communityReports,
    textUnits,
    context: buildNeighborhoodContext({
      entities,
      relationships,
      communities,
      communityReports,
      textUnits
    })
  };
}

function relationshipEndpointEntityIds(
  relationship: Relationship,
  entityByTitle: Map<string, Entity>
): string[] {
  const sourceEntityId = typeof relationship.attributes?.sourceEntityId === "string"
    ? relationship.attributes.sourceEntityId
    : entityByTitle.get(relationship.source)?.id;
  const targetEntityId = typeof relationship.attributes?.targetEntityId === "string"
    ? relationship.attributes.targetEntityId
    : entityByTitle.get(relationship.target)?.id;

  return [sourceEntityId, targetEntityId].filter((id): id is string => Boolean(id));
}

function rankedEntities(entities: readonly Entity[]): Entity[] {
  return uniqueById(entities)
    .sort((left, right) =>
      (right.rank ?? 0) - (left.rank ?? 0) ||
      (right.degree ?? 0) - (left.degree ?? 0) ||
      left.title.localeCompare(right.title)
    );
}

function rankedRelationships(relationships: readonly Relationship[]): Relationship[] {
  return uniqueById(relationships)
    .sort((left, right) =>
      (right.rank ?? 0) - (left.rank ?? 0) ||
      right.weight - left.weight ||
      (left.description ?? "").localeCompare(right.description ?? "")
    );
}

function rankedCommunities(communities: readonly Community[]): Community[] {
  return uniqueById(communities)
    .sort((left, right) =>
      (right.size ?? right.entityIds.length) - (left.size ?? left.entityIds.length) ||
      left.level - right.level ||
      left.title.localeCompare(right.title)
    );
}

function rankedTextUnits(
  textUnits: readonly TextUnit[],
  selected: {
    entityIds: ReadonlySet<string>;
    relationshipIds: ReadonlySet<string>;
  }
): TextUnit[] {
  return uniqueById(textUnits)
    .sort((left, right) =>
      textUnitSupportScore(right, selected) - textUnitSupportScore(left, selected) ||
      (right.nTokens ?? 0) - (left.nTokens ?? 0) ||
      String(left.humanReadableId ?? left.id).localeCompare(String(right.humanReadableId ?? right.id))
    );
}

function textUnitSupportScore(
  textUnit: TextUnit,
  selected: {
    entityIds: ReadonlySet<string>;
    relationshipIds: ReadonlySet<string>;
  }
): number {
  return textUnit.entityIds.filter((id) => selected.entityIds.has(id)).length * 2 +
    textUnit.relationshipIds.filter((id) => selected.relationshipIds.has(id)).length * 3;
}

function uniqueById<T extends { id: string }>(records: readonly T[]): T[] {
  const seen = new Set<string>();
  const output: T[] = [];

  for (const record of records) {
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    output.push(record);
  }

  return output;
}

function buildNeighborhoodContext(input: Omit<GraphRagNeighborhood, "context">): string {
  return [
    input.entities.length
      ? `Entities\n${input.entities.map((entity) => `- ${entity.title}${entity.type ? ` (${entity.type})` : ""}: ${entity.description ?? ""}`).join("\n")}`
      : "",
    input.relationships.length
      ? `Relationships\n${input.relationships.map((relationship) => `- ${relationship.source} -> ${relationship.target}: ${relationship.description ?? ""}`).join("\n")}`
      : "",
    input.communities.length
      ? `Communities\n${input.communities.map((community) => `- ${community.title}: ${community.entityIds.length} entities, ${community.relationshipIds.length} relationships`).join("\n")}`
      : "",
    input.communityReports.length
      ? `Community Reports\n${input.communityReports.map((report) => `- ${report.title}: ${report.summary}`).join("\n")}`
      : "",
    input.textUnits.length
      ? `Related Chunks\n${input.textUnits.map((textUnit) => `- ${textUnit.humanReadableId ?? textUnit.id}: ${textUnit.text}`).join("\n")}`
      : ""
  ].filter(Boolean).join("\n\n");
}
