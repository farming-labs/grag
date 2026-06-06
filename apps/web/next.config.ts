import type { NextConfig } from "next";
import { withDocs } from "@farming-labs/next/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: path.join(appDir, "../.."),
  },
};

export default withDocs(nextConfig);
