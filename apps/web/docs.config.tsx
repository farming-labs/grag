import { defineDocs } from "@farming-labs/docs";
import { pixelBorder } from "@farming-labs/theme/pixel-border";

export default defineDocs({
  entry: "docs",
  theme: pixelBorder({
    ui: {
      layout: {
        sidebarWidth: 304,
        toc: {
          enabled: true,
          depth: 3,
          style: "directional"
        }
      },
      sidebar: {
        style: "floating"
      },
      typography: {
        font: {
          style: {
            sans: "var(--font-geist-sans, system-ui, -apple-system, sans-serif)",
            mono: "var(--font-geist-mono, ui-monospace, monospace)"
          },
          h1: { size: "2.35rem", weight: 750, letterSpacing: "0" },
          h2: { size: "1.55rem", weight: 680, letterSpacing: "0" },
          h3: { size: "1.2rem", weight: 680 },
          body: { size: "0.98rem", lineHeight: "1.78" }
        }
      }
    }
  }),
  nav: {
    title: "@farming-labs/grag",
    url: "/"
  },
  github: {
    url: "https://github.com/farming-labs/grag",
    branch: "main",
    directory: "packages/grag/docs"
  },
  sidebar: {
    flat: true
  },
  breadcrumb: {
    enabled: true
  },
  themeToggle: {
    enabled: false,
    default: "dark"
  },
  pageActions: {
    copyMarkdown: {
      enabled: true
    },
    openDocs: {
      enabled: true,
      target: "markdown",
      providers: ["chatgpt", "claude", "cursor"]
    }
  },
  search: true,
  ai: {
    enabled: false
  },
  mcp: {
    enabled: true,
    name: "@farming-labs/grag"
  },
  llmsTxt: {
    enabled: true,
    siteDescription: "TypeScript GraphRAG primitives for relational, graph-backed retrieval.",
    sections: [
      {
        title: "Core Guides",
        description: "Getting started, architecture, retrieval, and storage guides for GRAG.",
        match: "/docs/**"
      }
    ]
  },
  lastUpdated: {
    position: "below-title"
  },
  metadata: {
    titleTemplate: "%s | @farming-labs/grag",
    description: "Documentation for the @farming-labs/grag TypeScript GraphRAG package."
  },
  review: false,
  ordering: "numeric",
  apiReference: false
});
