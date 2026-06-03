import Link from "next/link";
import { getDocEntries, getPackageManifest, getReadmeIntro } from "@/lib/docs";

export default async function HomePage() {
  const [docs, manifest, readmeIntro] = await Promise.all([
    getDocEntries(),
    getPackageManifest(),
    getReadmeIntro()
  ]);
  const featuredDocs = docs.slice(0, 6);

  return (
    <main>
      <section className="hero-shell">
        <nav className="topbar" aria-label="Primary navigation">
          <Link className="brand" href="/">
            <span className="brand-mark">g</span>
            <span>{manifest.name}</span>
          </Link>
          <div className="topbar-links">
            <Link href="/docs/getting-started">Docs</Link>
            <a href="https://github.com/farming-labs/grag" target="_blank" rel="noreferrer">
              GitHub
            </a>
          </div>
        </nav>

        <div className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">GraphRAG primitives for TypeScript</p>
            <h1>Build graph-backed retrieval without leaving your app stack.</h1>
            <p className="hero-lede">{readmeIntro || manifest.description}</p>
            <div className="hero-actions">
              <Link className="button primary" href="/docs/getting-started">
                Start with the docs
              </Link>
              <Link className="button secondary" href="/docs/retrieval-sdk">
                Explore retrieval SDK
              </Link>
            </div>
          </div>

          <aside className="install-card" aria-label="Install command">
            <div className="install-card-header">
              <span>Package</span>
              <span>v{manifest.version}</span>
            </div>
            <pre><code>pnpm add @farming-labs/grag kysely</code></pre>
            <p>
              Add your database driver separately, then wire memory, SQL, or ORM-backed storage into the service API.
            </p>
          </aside>
        </div>
      </section>

      <section className="section-band">
        <div className="section-heading">
          <p className="eyebrow">What is inside</p>
          <h2>One package, several GraphRAG layers.</h2>
        </div>
        <div className="feature-grid">
          <article>
            <span className="card-kicker">Model</span>
            <h3>Graph artifacts</h3>
            <p>Documents, chunks, entities, relationships, communities, reports, covariates, and embeddings in strict TypeScript.</p>
          </article>
          <article>
            <span className="card-kicker">Storage</span>
            <h3>Relational first</h3>
            <p>Kysely SQL storage and optional `@farming-labs/orm` adapters keep graph state portable across database engines.</p>
          </article>
          <article>
            <span className="card-kicker">Retrieval</span>
            <h3>Local and global search</h3>
            <p>Use lexical, vector, neighborhood, community, and cited answer flows from package primitives or the service facade.</p>
          </article>
        </div>
      </section>

      <section className="docs-section">
        <div className="section-heading compact">
          <p className="eyebrow">Docs</p>
          <h2>Read the migration-friendly guides.</h2>
        </div>
        <div className="docs-grid">
          {featuredDocs.map((doc) => (
            <Link className="doc-card" href={doc.href} key={doc.slug}>
              <h3>{doc.title}</h3>
              <p>{doc.description}</p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
