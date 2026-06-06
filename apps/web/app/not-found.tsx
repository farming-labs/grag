import Link from "next/link";

export default function NotFound() {
  return (
    <main className="not-found-shell">
      <p className="eyebrow">404</p>
      <h1>That doc slipped out of the graph.</h1>
      <p>
        The docs index is generated from `packages/grag/docs`, so this page may have moved or been
        renamed.
      </p>
      <Link className="button primary" href="/">
        Return to docs home
      </Link>
    </main>
  );
}
