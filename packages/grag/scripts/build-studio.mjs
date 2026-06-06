#!/usr/bin/env node
import * as esbuild from "esbuild";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "dist/studio");
const assetsDir = resolve(outDir, "assets");

await rm(outDir, { recursive: true, force: true });
await mkdir(assetsDir, { recursive: true });

await esbuild.build({
  entryPoints: [resolve(root, "studio/src/main.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: resolve(assetsDir, "index.js"),
  sourcemap: true,
  logLevel: "info",
});

const template = await readFile(resolve(root, "studio/index.html"), "utf8");
const html = template.replace(
  /<script type="module" src="\/src\/main\.ts"><\/script>/,
  [
    '<script type="module" crossorigin src="./assets/index.js"></script>',
    '<link rel="stylesheet" crossorigin href="./assets/index.css">',
  ].join("\n    "),
);

await writeFile(resolve(outDir, "index.html"), html, "utf8");
