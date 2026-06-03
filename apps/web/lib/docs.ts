import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";

const docOrder = [
  "GETTING_STARTED.md",
  "WHY_GRAG.md",
  "ARCHITECTURE.md",
  "SERVICE_INTEGRATION.md",
  "RETRIEVAL_SDK.md",
  "STORAGE_CONFIGURATION.md",
  "STORAGE_AND_RETRIEVAL.md",
  "GITHUB_SAAS.md",
  "REPO_DEMO.md",
  "MICROSOFT_GRAPHRAG_REPLICATION.md"
];

const packageRoot = resolvePackageRoot();
const docsRoot = path.join(packageRoot, "docs");

export type DocEntry = {
  slug: string;
  title: string;
  description: string;
  filename: string;
  href: string;
};

export type Doc = DocEntry & {
  content: string;
};

type PackageManifest = {
  name: string;
  version: string;
  description: string;
};

function resolvePackageRoot() {
  const candidates = [
    path.resolve(process.cwd(), "..", "..", "packages", "grag"),
    path.resolve(process.cwd(), "packages", "grag")
  ];

  const match = candidates.find((candidate) => existsSync(path.join(candidate, "package.json")));

  if (!match) {
    throw new Error("Unable to locate packages/grag from the docs app.");
  }

  return match;
}

function slugFromFilename(filename: string) {
  return path.basename(filename, ".md").toLowerCase().replace(/_/g, "-");
}

function titleFromSlug(slug: string) {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function titleFromContent(content: string, fallback: string) {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? fallback;
}

function descriptionFromContent(content: string) {
  const withoutCode = content.replace(/```[\s\S]*?```/g, "");
  const paragraph = withoutCode
    .split(/\n\s*\n/)
    .map((block) => block.replace(/^#+\s+/gm, "").trim())
    .find((block) => block && !block.startsWith("-") && !block.match(/^\d+\./));

  if (!paragraph) {
    return "GraphRAG documentation for @farming-labs/grag.";
  }

  return paragraph.replace(/\s+/g, " ").slice(0, 180);
}

async function docEntryFromFile(filename: string): Promise<DocEntry> {
  const content = await fs.readFile(path.join(docsRoot, filename), "utf8");
  const slug = slugFromFilename(filename);

  return {
    slug,
    filename,
    title: titleFromContent(content, titleFromSlug(slug)),
    description: descriptionFromContent(content),
    href: `/docs/${slug}`
  };
}

export async function getDocEntries() {
  const filenames = (await fs.readdir(docsRoot)).filter((filename) => filename.endsWith(".md"));
  const entries = await Promise.all(filenames.map(docEntryFromFile));
  const order = new Map(docOrder.map((filename, index) => [filename, index]));

  return entries.sort((a, b) => {
    const aOrder = order.get(a.filename) ?? Number.MAX_SAFE_INTEGER;
    const bOrder = order.get(b.filename) ?? Number.MAX_SAFE_INTEGER;

    return aOrder - bOrder || a.title.localeCompare(b.title);
  });
}

export async function getDocBySlug(slug: string): Promise<Doc | null> {
  const entries = await getDocEntries();
  const entry = entries.find((doc) => doc.slug === slug);

  if (!entry) {
    return null;
  }

  const content = await fs.readFile(path.join(docsRoot, entry.filename), "utf8");
  return { ...entry, content };
}

export async function getAdjacentDocs(slug: string) {
  const docs = await getDocEntries();
  const index = docs.findIndex((doc) => doc.slug === slug);

  return {
    previous: index > 0 ? docs[index - 1] : null,
    next: index >= 0 && index < docs.length - 1 ? docs[index + 1] : null
  };
}

export async function getPackageManifest(): Promise<PackageManifest> {
  const raw = await fs.readFile(path.join(packageRoot, "package.json"), "utf8");
  const manifest = JSON.parse(raw) as PackageManifest;

  return {
    name: manifest.name,
    version: manifest.version,
    description: manifest.description
  };
}

export async function getReadmeIntro() {
  const content = await fs.readFile(path.join(packageRoot, "README.md"), "utf8");
  const paragraphs = content
    .replace(/^#\s+.+$/m, "")
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  return paragraphs.find((block) => !block.startsWith("```") && !block.startsWith("-")) ?? "";
}
