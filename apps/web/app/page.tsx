"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import PixelSnow from "./components/pixel-snow";
import { ArrowRightIcon, CheckIcon, CopyIcon } from "lucide-react";

const docsHref = "/docs";
const startHref = "/docs/getting-started";
const installCommand = "npm i @farming-labs/grag";

const chipStyle: CSSProperties = {
  border: "1px solid var(--color-fd-border, rgba(255,255,255,0.14))",
  borderRadius: 0,
  padding: "0.3rem 0.6rem",
  fontSize: "0.6rem",
  letterSpacing: "0.14em",
  fontFamily: "var(--fd-font-mono, var(--font-geist-mono, monospace))",
  textTransform: "uppercase",
  opacity: 0.74,
};

const buttonBase: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 0,
  minHeight: 48,
  minWidth: 154,
  padding: "0.9rem 1.15rem",
  textDecoration: "none",
  fontFamily: "var(--fd-font-mono, var(--font-geist-mono, monospace))",
  fontSize: "0.72rem",
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
};

export default function Home() {
  const [copied, setCopied] = useState(false);

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(installCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      className="relative isolate flex min-h-screen flex-col overflow-hidden px-4 supports-[overflow:clip]:overflow-clip"
      style={{
        background: "var(--color-fd-background, #050506)",
        color: "var(--color-fd-foreground, #f7f7f7)",
      }}
    >
      <PixelSnow
        brightness={0.74}
        density={0.22}
        direction={126}
        flakeSize={0.0028}
        minFlakeSize={1.15}
        pixelResolution={190}
        speed={0.16}
        variant="square"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 opacity-[0.14]"
        style={{
          backgroundImage:
            "linear-gradient(var(--color-fd-border, rgba(255,255,255,0.16)) 1px, transparent 1px), linear-gradient(90deg, var(--color-fd-border, rgba(255,255,255,0.16)) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-24 top-[12%] z-[1] h-[28rem] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.11),rgba(255,255,255,0.045)_34%,transparent_66%)] opacity-80 blur-[56px]"
      />
      <div aria-hidden className="pointer-events-none absolute inset-0 z-[1] bg-black/28" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-0 h-28 border-b border-dashed border-white/10 opacity-80"
        style={{
          backgroundImage:
            "repeating-linear-gradient(-45deg, color-mix(in srgb, var(--color-fd-border) 10%, transparent), color-mix(in srgb, var(--color-fd-foreground) 10%, transparent) 1px, transparent 1px, transparent 7px)",
        }}
      />
      <main className="relative z-10 mx-auto grid h-[100dvh] w-full max-w-4xl grow place-items-center overflow-hidden px-4 py-5 text-center before:absolute before:-inset-y-14 before:-left-px before:z-10 before:w-px before:bg-white/10 after:absolute after:-inset-y-14 after:-right-px after:z-10 after:w-px after:bg-white/10 sm:px-8">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-4 z-[1] w-px bg-gradient-to-b from-transparent via-white/10 to-white/10 md:left-8"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-4 z-[1] w-px bg-gradient-to-b from-transparent via-white/10 to-white/10 md:right-8"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-8 z-[1] w-px bg-gradient-to-b from-transparent via-white/5 to-white/5 md:left-12"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-8 z-[1] w-px bg-gradient-to-b from-transparent via-white/5 to-white/5 md:right-12"
        />

        <section className="relative z-20 grid w-full max-w-[900px] justify-items-center gap-5">
          <div className="grid justify-items-center gap-4">
            <p
              className="m-0 max-w-[820px] text-[2rem] font-normal uppercase leading-[1.08] tracking-tighter sm:text-[2.5rem] lg:text-[3rem]"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Graph-backed retrieval <br />
              for your own data
            </p>
            <p
              className="m-0 max-w-[720px] text-[0.98rem] leading-7 sm:text-[1.02rem] sm:leading-8"
              style={{
                color: "var(--color-fd-muted-foreground, rgba(255,255,255,0.68))",
              }}
            >
              @farming-labs/grag gives you TypeScript primitives for graph-shaped retrieval: ingest
              sources, store entities and relationships, search with context, and return cited
              answers from the database you control.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            <span style={chipStyle}>Entities</span>
            <span style={chipStyle}>Relationships</span>
            <span style={chipStyle}>Citations</span>
            <span style={chipStyle}>Your Storage</span>
          </div>

          <div className="grid w-full max-w-[560px] gap-2">
            <span
              className="justify-self-start font-mono text-[0.7rem] uppercase tracking-[0.14em]"
              style={{
                color: "var(--color-fd-muted-foreground, rgba(255,255,255,0.56))",
              }}
            >
              Install via:
            </span>

            <div
              className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-stretch sm:grid-cols-[auto_minmax(0,1fr)_auto]"
              style={{
                border: "1px solid var(--color-fd-border, rgba(255,255,255,0.14))",
                background: "color-mix(in srgb, var(--color-fd-card, #111) 92%, transparent)",
              }}
            >
              <span
                className="hidden place-items-center border-r px-4 font-mono text-base sm:grid"
                style={{
                  borderColor: "var(--color-fd-border, rgba(255,255,255,0.14))",
                  color: "var(--color-fd-muted-foreground, rgba(255,255,255,0.58))",
                }}
              >
                &gt;
              </span>
              <code className="grid min-w-0 items-center overflow-x-auto whitespace-nowrap px-3 py-4 text-left font-mono text-xs text-white/50 sm:px-4 sm:text-sm">
                {installCommand}
              </code>
              <button
                type="button"
                onClick={copyCommand}
                className="min-w-full cursor-pointer text-white/50 border-0 border-l flex justify-center items-center px-2 font-mono text-[0.68rem] uppercase tracking-[0.14em] sm:min-w-[88px] sm:px-2"
                style={{
                  borderColor: "var(--color-fd-border, rgba(255,255,255,0.14))",
                }}
              >
                {copied ? <CheckIcon className="w-4 h-4" /> : <CopyIcon className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link
              href={startHref}
              style={{
                ...buttonBase,
                background: "var(--color-fd-foreground, #fff)",
                color: "var(--color-fd-background, #050506)",
              }}
            >
              Get Started
            </Link>
            <Link
              href={docsHref}
              style={{
                ...buttonBase,
                // border: "1px solid var(--color-fd-border, rgba(255,255,255,0.14))",
                color: "var(--color-fd-foreground, #fff)",
              }}
            >
              Read Docs <ArrowRightIcon className="w-4 h-4 ml-2" />
            </Link>
          </div>
          <p
            className="m-0 hidden font-mono text-[0.78rem] uppercase tracking-normal sm:block"
            style={{
              color: "var(--color-fd-muted-foreground, rgba(255,255,255,0.52))",
            }}
          >
            // Build a graph snapshot, retrieve grounded context, and ship cited answers.
          </p>
        </section>
      </main>
    </div>
  );
}
