# Support GraphRAG Demo

The docs platform support team uses GraphRAG to understand customer tickets, source markdown, incident runbooks, release notes, and database migration notes. The ingestion pipeline chunks each document into text units and keeps the original source path for citations.

The graph indexing step extracts entities such as docs platform, @farming-labs/grag, @farming-labs/orm, Postgres, SQLite, MySQL, pgvector, Studio, CLI preview, hybrid retrieval, community reports, text units, and citation context. Relationships connect storage tables to retrieval, retrieval to graph expansion, and support tickets to the source files that explain the failure.

Relational storage keeps documents, text units, entities, relationships, communities, community reports, covariates, and embeddings in SQL tables. @farming-labs/orm can adapt the GraphRAG store to Postgres, SQLite, MySQL, and local memory drivers while keeping the same snapshot shape for Studio visualization.

Hybrid retrieval starts with a support question, runs lexical search and vector recall, expands through nearby graph relationships, reads community reports, and builds grounded context with citations. Local search answers focused questions about one ticket or one docs page. Global search summarizes a whole community such as storage, retrieval, or operational workflows.

Studio lets maintainers upload this document, visualize the extracted graph, drag nodes, click edges, filter communities, inspect grounding text, and run queries. A maintainer can ask why a customer cannot deploy the docs platform, which storage table owns embeddings, or how pgvector participates in retrieval.

Operational workflows include nightly indexing, pull request previews, migration checks, stale embedding cleanup, and incident investigation. When retrieval misses an answer, the graph highlights missing source coverage so the team can add docs or improve extraction.
