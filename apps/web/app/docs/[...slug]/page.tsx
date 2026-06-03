import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/markdown";
import { getAdjacentDocs, getDocBySlug, getDocEntries } from "@/lib/docs";

type DocPageProps = {
  params: Promise<{ slug: string[] }>;
};

export async function generateStaticParams() {
  const docs = await getDocEntries();
  return docs.map((doc) => ({ slug: [doc.slug] }));
}

export async function generateMetadata({ params }: DocPageProps): Promise<Metadata> {
  const { slug } = await params;
  const doc = await getDocBySlug(slug.join("/"));

  if (!doc) {
    return { title: "Docs" };
  }

  return {
    title: doc.title,
    description: doc.description
  };
}

export default async function DocPage({ params }: DocPageProps) {
  const [{ slug }, docs] = await Promise.all([params, getDocEntries()]);
  const activeSlug = slug.join("/");
  const [doc, adjacent] = await Promise.all([getDocBySlug(activeSlug), getAdjacentDocs(activeSlug)]);

  if (!doc) {
    notFound();
  }

  return (
    <main className="doc-layout">
      <aside className="doc-sidebar" aria-label="Documentation navigation">
        <Link className="brand sidebar-brand" href="/">
          <span className="brand-mark">g</span>
          <span>@farming-labs/grag</span>
        </Link>
        <nav>
          {docs.map((entry) => (
            <Link className={entry.slug === doc.slug ? "active" : undefined} href={entry.href} key={entry.slug}>
              {entry.title}
            </Link>
          ))}
        </nav>
      </aside>

      <article className="doc-article">
        <Link className="back-link" href="/">
          Back to overview
        </Link>
        <Markdown content={doc.content} />
        <footer className="doc-footer-nav">
          {adjacent.previous ? (
            <Link href={adjacent.previous.href}>
              <span>Previous</span>
              {adjacent.previous.title}
            </Link>
          ) : (
            <span />
          )}
          {adjacent.next ? (
            <Link href={adjacent.next.href}>
              <span>Next</span>
              {adjacent.next.title}
            </Link>
          ) : null}
        </footer>
      </article>
    </main>
  );
}
