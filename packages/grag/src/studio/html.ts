import type { GraphRagSnapshot } from "../model.js";

export interface GraphRagStudioHtmlOptions {
  title?: string;
}

export interface GraphRagStudioGlobalsOptions extends GraphRagStudioHtmlOptions {
  snapshot?: GraphRagSnapshot;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function globalsScript(options: GraphRagStudioGlobalsOptions): string {
  const globals = [
    `window.__GRAG_STUDIO__=${safeJson({ title: options.title ?? "GraphRAG Studio" })};`,
    options.snapshot ? `window.__GRAG_SNAPSHOT__=${safeJson(options.snapshot)};` : ""
  ].filter(Boolean).join("");

  return `<script>${globals}</script>`;
}

export function injectGraphRagStudioGlobals(
  html: string,
  options: GraphRagStudioGlobalsOptions = {}
): string {
  const script = globalsScript(options);

  if (html.includes("</head>")) {
    return html.replace("</head>", `${script}</head>`);
  }

  return `${script}${html}`;
}

export function renderGraphRagStudioHtml(
  snapshot: GraphRagSnapshot,
  options: GraphRagStudioHtmlOptions = {}
): string {
  const title = escapeHtml(options.title ?? "GraphRAG Studio");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    ${globalsScript({ ...options, snapshot })}
    <script type="module" crossorigin src="./assets/index.js"></script>
    <link rel="stylesheet" crossorigin href="./assets/index.css">
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>`;
}
