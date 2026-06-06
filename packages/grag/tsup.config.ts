import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "orm/index": "src/orm/index.ts",
    "openai/index": "src/openai/index.ts",
    "anthropic/index": "src/anthropic/index.ts",
    cli: "src/cli.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  splitting: true,
  clean: true,
  target: "es2022",
});
