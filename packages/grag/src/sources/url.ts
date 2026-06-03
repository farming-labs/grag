import type { GraphRagDocument } from "../model.js";
import { createStableId } from "../utils/ids.js";
import type { UrlSourceConfig } from "./types.js";

const DEFAULT_MAX_BYTES = 50_000;
const FETCH_TIMEOUT_MS = 15_000;

export async function loadUrlSource(config: UrlSourceConfig): Promise<GraphRagDocument[]> {
  const maxBytes = config.maxBytes ?? DEFAULT_MAX_BYTES;
  const stripHtml = config.stripHtml !== false;
  const docs: GraphRagDocument[] = [];

  for (const url of config.urls) {
    const doc = await fetchUrl(url, { maxBytes, stripHtml, sourceLabel: config.label });
    if (doc !== null) {
      docs.push(doc);
    }
  }

  return docs;
}

async function fetchUrl(
  url: string,
  options: {
    maxBytes: number;
    stripHtml: boolean;
    sourceLabel: string | undefined;
  }
): Promise<GraphRagDocument | null> {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "grag-data-source/1.0 (+https://github.com/farming-labs/grag)" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get("content-type") ?? "";
    let raw = await response.text();

    // Strip HTML before length cap so we don't waste budget on tags
    if (options.stripHtml && contentType.includes("html")) {
      raw = stripHtmlTags(raw);
    }

    const text = raw.trim().slice(0, options.maxBytes);
    if (!text) {
      return null;
    }

    const title = extractTitle(raw, url);

    return {
      id: createStableId([url], "doc"),
      humanReadableId: url,
      title,
      type: "url",
      text,
      textUnitIds: [],
      attributes: {
        sourceUrl: url,
        contentType,
        ...(options.sourceLabel !== undefined ? { sourceLabel: options.sourceLabel } : {})
      }
    };
  } catch {
    // Network errors, timeouts, CORS — skip silently
    return null;
  }
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s{3,}/g, "\n\n")
    .trim();
}

function extractTitle(text: string, url: string): string {
  // Try <title> tag
  const titleTag = /<title[^>]*>([^<]{1,200})<\/title>/i.exec(text);
  if (titleTag?.[1]) {
    return titleTag[1].trim();
  }

  // Try first Markdown heading
  const heading = /^#{1,3}\s+(.+)$/m.exec(text);
  if (heading?.[1]) {
    return heading[1].trim().slice(0, 120);
  }

  // Fall back to last URL path segment
  try {
    const pathname = new URL(url).pathname;
    const segment = pathname.split("/").filter(Boolean).at(-1);
    if (segment) {
      return decodeURIComponent(segment).replace(/[-_]/g, " ");
    }
  } catch {
    // ignore
  }

  return url;
}
