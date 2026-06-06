import type { Community, Entity, Relationship, TextUnit } from "../model.js";
import type { CommunityDetector } from "../pipeline/types.js";
import { createStableId } from "../utils/ids.js";

export interface LabelPropagationCommunityDetectorOptions {
  maxIterations?: number;
}

/**
 * Label-propagation community detector. No external dependencies.
 * Each entity starts as its own label; nodes iteratively adopt the most
 * common label among their neighbors. Isolated nodes become solo communities.
 */
export class LabelPropagationCommunityDetector implements CommunityDetector {
  private readonly maxIterations: number;

  constructor(options: LabelPropagationCommunityDetectorOptions = {}) {
    this.maxIterations = options.maxIterations ?? 15;
  }

  async detect(input: {
    entities: Entity[];
    relationships: Relationship[];
    textUnits: TextUnit[];
  }): Promise<Community[]> {
    const { entities, relationships } = input;
    if (entities.length === 0) return [];

    const entityTitles = new Set(entities.map((e) => e.title));

    // Build undirected adjacency
    const adj = new Map<string, Set<string>>();
    for (const e of entities) adj.set(e.title, new Set());
    for (const rel of relationships) {
      if (entityTitles.has(rel.source) && entityTitles.has(rel.target)) {
        adj.get(rel.source)!.add(rel.target);
        adj.get(rel.target)!.add(rel.source);
      }
    }

    // Label propagation
    const labels = new Map<string, string>(entities.map((e) => [e.title, e.title]));
    for (let iter = 0; iter < this.maxIterations; iter++) {
      let changed = false;
      // Shuffle to avoid order bias
      const order = shuffled(entities);
      for (const entity of order) {
        const neighbors = adj.get(entity.title)!;
        if (neighbors.size === 0) continue;

        const counts = new Map<string, number>();
        for (const neighbor of neighbors) {
          const label = labels.get(neighbor)!;
          counts.set(label, (counts.get(label) ?? 0) + 1);
        }

        // Pick label with highest count; break ties lexicographically
        let bestLabel = labels.get(entity.title)!;
        let bestCount = counts.get(bestLabel) ?? 0;
        for (const [label, count] of counts) {
          if (count > bestCount || (count === bestCount && label < bestLabel)) {
            bestLabel = label;
            bestCount = count;
          }
        }

        if (bestLabel !== labels.get(entity.title)) {
          labels.set(entity.title, bestLabel);
          changed = true;
        }
      }
      if (!changed) break;
    }

    // Group entities by community label
    const groups = new Map<string, Entity[]>();
    for (const entity of entities) {
      const label = labels.get(entity.title)!;
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label)!.push(entity);
    }

    // Sort largest-first for stable community numbering
    const sortedGroups = [...groups.values()].sort((a, b) => b.length - a.length);

    const communities: Community[] = sortedGroups.map((groupEntities, idx) => {
      const entityTitleSet = new Set(groupEntities.map((e) => e.title));
      const groupRelationships = relationships.filter(
        (r) => entityTitleSet.has(r.source) && entityTitleSet.has(r.target),
      );

      const entityIds = groupEntities.map((e) => e.id);
      const relationshipIds = groupRelationships.map((r) => r.id);
      const textUnitIds = uniqueArray([
        ...groupEntities.flatMap((e) => e.textUnitIds),
        ...groupRelationships.flatMap((r) => r.textUnitIds),
      ]);
      const title = groupEntities[0]?.title ?? `Community ${idx}`;

      return {
        id: createStableId([title, idx], "com"),
        humanReadableId: title,
        title,
        community: idx,
        level: 0,
        parent: null,
        children: [],
        entityIds,
        relationshipIds,
        textUnitIds,
        covariateIds: [],
        size: groupEntities.length,
      };
    });

    return communities;
  }
}

function shuffled<T>(arr: readonly T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function uniqueArray<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
