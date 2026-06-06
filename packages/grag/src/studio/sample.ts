import type { GraphRagSnapshot } from "../model.js";
import { buildDocumentGraphRagSnapshot } from "./document.js";

const REPOSITORY_KNOWLEDGE_GRAPH_SAMPLE = `# Repository Knowledge Graph Demo

This sample shows how GRAG turns a software repository into a queryable knowledge graph. A GitHub repo import clones the repository, scans useful files, selects README files, docs, package manifests, config files, examples, tests, and source entry points, then builds a GraphRAG snapshot.

Repository ingestion preserves file paths, package names, exported APIs, database table names, CLI flags, environment variables, and source modules as graph evidence. The source scanner skips build folders such as node_modules, dist, .next, coverage, and .git so the graph focuses on meaningful project material.

The graph model stores documents, text units, entities, relationships, covariates, communities, community reports, and embeddings. Documents become text units. Text units ground entity extraction and relationship extraction. Entities represent packages, modules, functions, files, storage adapters, APIs, docs pages, workflows, and database tables.

Relational storage persists the graph through grag_documents, grag_text_units, grag_entities, grag_relationships, grag_covariates, grag_communities, grag_community_reports, and grag_embeddings. Related chunks are connected through grag_text_unit_entities, grag_entity_text_units, grag_text_unit_relationships, grag_relationship_text_units, and grag_community_text_units.

The storage layer can use MemoryGraphRagStore for tests, SqlGraphRagStore with Postgres for production, SqlGraphRagStore with SQLite for local persistent demos, or OrmGraphRagStore with @farming-labs/orm for portable service storage. Postgres can later add pgvector and HNSW indexes for semantic recall.

Retrieval combines lexical search, vector recall, entity matching, relationship matching, graph neighborhood expansion, community reports, and cited text units. A query can start from a matching chunk, jump to entities, follow nearby relationships, load related chunks, read community summaries, and return grounded context.

Studio visualizes the repository graph as labeled nodes and relationship edges. Every node label is visible without clicking. Users can drag nodes, pan, zoom, filter, focus neighborhoods, inspect database tables, and run retrieval queries against the active snapshot.

The repo graph is useful for docs platforms, support assistants, agent memory, release note generation, migration review, docs drift detection, dependency analysis, and multi-repo maps. It can answer which files implement a feature, which storage tables support retrieval, which modules expose APIs, and which docs should change after a code update.

The CLI exposes grag repo for local paths and GitHub URLs. The Studio server exposes repo-graph.json so the browser can request a repository graph directly from a public GitHub repository. The generated snapshot can be saved, visualized, queried, or persisted in a relational database.`;

export function createSampleGraphRagSnapshot(): GraphRagSnapshot {
  return buildDocumentGraphRagSnapshot(REPOSITORY_KNOWLEDGE_GRAPH_SAMPLE, {
    title: "Repository knowledge graph sample",
    sourcePath: "examples/repository-knowledge-graph.md",
    maxEntities: 72,
    maxRelationships: 110,
  });
}
