# Repository Index

Use the `repo` command to build a repository index from any local repository or Git URL, ask a question over it, and optionally open the generated graph in Studio.

## Local Repository

```bash
grag repo . --ask "What does this repository do?" --snapshot repo.snapshot.json
```

The command scans useful text files such as README files, package manifests, docs, config, examples, and source entry points. It skips heavy build folders such as `node_modules`, `.git`, `dist`, `.next`, and `coverage`.

## OpenAI Extraction

If `OPENAI_API_KEY` is present, the command uses OpenAI automatically for graph extraction and final answering:

```bash
OPENAI_API_KEY=<your-key> grag repo . --ask "How does storage work?"
```

You can force or disable model use:

```bash
grag repo . --ask "How does retrieval work?" --openai
grag repo . --ask "How does retrieval work?" --no-openai
```

Model overrides:

```bash
GRAG_OPENAI_MODEL=gpt-5.4-mini grag repo . --ask "What should this service index?"
GRAG_OPENAI_ANSWER_MODEL=gpt-5.4-mini grag repo . --ask "What should this service index?"
```

The API key stays on the local CLI process. It is not written to the snapshot and is not sent to the browser.

## Remote Git Repository

```bash
grag repo https://github.com/microsoft/graphrag.git \
  --ask "What are the main indexing and retrieval concepts?" \
  --snapshot microsoft-graphrag.snapshot.json
```

Remote repositories are cloned shallowly into a temporary directory. Add `--keep-clone` if you want to inspect the checkout after the command runs.

From TypeScript, pass a GitHub source directly:

```ts
const indexed = await indexRepository({
  source: "microsoft/graphrag",
  provider: "github",
  remote: {
    ref: "main"
  },
  scan: {
    maxFiles: "all"
  },
  extraction: {
    provider: "local"
  }
});
```

For private GitHub repos, pass a GitHub App installation token in `remote.token`.

## Visualize The Graph

```bash
grag repo . \
  --ask "Which modules are connected to storage?" \
  --snapshot repo.snapshot.json \
  --studio \
  --open
```

Studio renders entities, relationships, communities, source-grounded text units, and retrieval context. This is the easiest way to inspect whether the graph node model is good enough for AI infra work.

## Tuning

```bash
grag repo . \
  --ask "How should another service use this package?" \
  --max-files 120 \
  --max-file-bytes 40000 \
  --max-corpus-chars 220000
```

- `--max-files` controls how many prioritized files are indexed.
- `--max-file-bytes` caps each selected file.
- `--max-corpus-chars` caps the combined corpus sent to extraction.

For production indexing, wire the same exported APIs into a job queue and persist the resulting snapshot with `SqlGraphRagStore` or `OrmGraphRagStore`.
