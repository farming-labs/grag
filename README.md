# grag

Monorepo for `@farming-labs/grag`, a TypeScript GraphRAG package, plus the docs web app.

## Workspaces

- `packages/grag`: npm package published as `@farming-labs/grag`.
- `apps/web`: documentation site for the package docs.

## Development

```bash
pnpm install
pnpm check
pnpm test
pnpm build
```

Run the docs app locally:

```bash
pnpm dev
```

Package documentation lives in [`packages/grag/README.md`](packages/grag/README.md) and [`packages/grag/docs`](packages/grag/docs).
