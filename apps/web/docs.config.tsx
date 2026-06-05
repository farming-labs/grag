import { defineDocs } from "@farming-labs/docs";
import { threadline, threadlinePageActions } from "@farming-labs/theme/threadline";
import { SidebarThemeToggle } from "@/app/components/sidebar-theme-toggle";
import {
  BookOpenIcon,
  DatabaseIcon,
  FolderGit2Icon,
  GitBranchIcon,
  LightbulbIcon,
  NetworkIcon,
  RocketIcon,
  SearchIcon,
  ServerCogIcon,
  WaypointsIcon
} from "lucide-react";

export default defineDocs({
  entry: "docs",
  theme: threadline({
    ui: {
      radius: "0px",
      layout: {
        sidebarWidth: 286,
        toc: {
          enabled: true,
          depth: 3,
          style: "default"
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
    title: (
      <span className="inline-flex items-center gap-2 font-mono uppercase tracking-normal">
        <NetworkIcon aria-hidden="true" size={14} />
        @farming-labs/grag
      </span>
    ),
    url: "/"
  },
  github: {
    url: "https://github.com/farming-labs/grag",
    branch: "main",
    directory: "packages/grag/docs"
  },
  sidebar: {
    flat: true,
    footer: (
      <div
        className="-mx-4 -mb-4 border-t font-mono uppercase"
        style={{
          backgroundImage:
            "repeating-linear-gradient(-45deg, color-mix(in srgb, var(--color-fd-border) 24%, transparent), color-mix(in srgb, var(--color-fd-border) 24%, transparent) 1px, transparent 1px, transparent 7px)",
          borderColor: "var(--color-fd-border)"
        }}
      >
        <div
          className="flex items-center justify-between gap-3 border-b px-3 py-2"
          style={{
            borderColor: "var(--color-fd-border)",
            color: "var(--color-fd-muted-foreground)"
          }}
        >
          <span className="text-[10px] tracking-normal">Theme</span>
          <SidebarThemeToggle variant="pill" />
        </div>
      </div>
    )
  },
  breadcrumb: {
    enabled: true
  },
  icons: {
    book: <BookOpenIcon size={16} />,
    rocket: <RocketIcon size={16} />,
    lightbulb: <LightbulbIcon size={16} />,
    network: <NetworkIcon size={16} />,
    service: <ServerCogIcon size={16} />,
    retrieval: <SearchIcon size={16} />,
    database: <DatabaseIcon size={16} />,
    graph: <WaypointsIcon size={16} />,
    github: <GitBranchIcon size={16} />,
    repo: <FolderGit2Icon size={16} />
  },
  themeToggle: {
    enabled: false
  },
  pageActions: {
    ...threadlinePageActions
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
  lastUpdated: false,
  metadata: {
    titleTemplate: "%s | @farming-labs/grag",
    description: "Documentation for the @farming-labs/grag TypeScript GraphRAG package."
  },
  review: false,
  ordering: "numeric",
  apiReference: false
});
