import type { ReactNode } from "react";

type Block =
  | { type: "heading"; depth: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "code"; language: string; code: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; text: string }
  | { type: "rule" };

export function Markdown({ content }: { content: string }) {
  const blocks = parseMarkdown(content);

  return (
    <div className="markdown">
      {blocks.map((block, index) => renderBlock(block, index))}
    </div>
  );
}

function parseMarkdown(content: string): Block[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const fence = trimmed.match(/^```(.*)$/);
    if (fence) {
      const language = fence[1]?.trim() ?? "";
      const code: string[] = [];
      index += 1;

      while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
        code.push(lines[index] ?? "");
        index += 1;
      }

      blocks.push({ type: "code", language, code: code.join("\n") });
      index += 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: "heading", depth: heading[1]?.length ?? 1, text: heading[2]?.trim() ?? "" });
      index += 1;
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quote: string[] = [];

      while (index < lines.length && /^>\s?/.test((lines[index] ?? "").trim())) {
        quote.push((lines[index] ?? "").trim().replace(/^>\s?/, ""));
        index += 1;
      }

      blocks.push({ type: "quote", text: quote.join(" ") });
      continue;
    }

    if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      const ordered = /^\d+\.\s+/.test(trimmed);
      const items: string[] = [];
      const pattern = ordered ? /^\d+\.\s+/ : /^[-*]\s+/;

      while (index < lines.length && pattern.test((lines[index] ?? "").trim())) {
        items.push((lines[index] ?? "").trim().replace(pattern, ""));
        index += 1;
      }

      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const paragraph: string[] = [];

    while (index < lines.length) {
      const current = lines[index] ?? "";
      const currentTrimmed = current.trim();

      if (!currentTrimmed || startsBlock(currentTrimmed)) {
        break;
      }

      paragraph.push(currentTrimmed);
      index += 1;
    }

    blocks.push({ type: "paragraph", text: paragraph.join(" ") });
  }

  return blocks;
}

function startsBlock(line: string) {
  return (
    line.startsWith("```") ||
    /^(#{1,4})\s+/.test(line) ||
    /^---+$/.test(line) ||
    /^>\s?/.test(line) ||
    /^[-*]\s+/.test(line) ||
    /^\d+\.\s+/.test(line)
  );
}

function renderBlock(block: Block, index: number) {
  if (block.type === "heading") {
    const Heading = `h${Math.min(block.depth, 4)}` as "h1" | "h2" | "h3" | "h4";
    return (
      <Heading id={headingId(block.text)} key={index}>
        {renderInline(block.text, `heading-${index}`)}
      </Heading>
    );
  }

  if (block.type === "paragraph") {
    return <p key={index}>{renderInline(block.text, `paragraph-${index}`)}</p>;
  }

  if (block.type === "code") {
    return (
      <pre key={index} className="code-block">
        {block.language ? <span className="code-language">{block.language}</span> : null}
        <code>{block.code}</code>
      </pre>
    );
  }

  if (block.type === "list") {
    const List = block.ordered ? "ol" : "ul";
    return (
      <List key={index}>
        {block.items.map((item, itemIndex) => (
          <li key={itemIndex}>{renderInline(item, `list-${index}-${itemIndex}`)}</li>
        ))}
      </List>
    );
  }

  if (block.type === "quote") {
    return <blockquote key={index}>{renderInline(block.text, `quote-${index}`)}</blockquote>;
  }

  return <hr key={index} />;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;

    if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const href = normalizeHref(link?.[2] ?? "#");
      const external = href.startsWith("http://") || href.startsWith("https://");

      nodes.push(
        <a key={key} href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>
          {link?.[1] ?? href}
        </a>
      );
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function normalizeHref(href: string) {
  const markdownDoc = href.match(/(?:docs\/)?([^/#]+)\.md(#[^)]+)?$/i);

  if (markdownDoc?.[1]) {
    const slug = markdownDoc[1].toLowerCase().replace(/_/g, "-");
    return `/docs/${slug}${markdownDoc[2] ?? ""}`;
  }

  return href;
}

function headingId(text: string) {
  return text
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
