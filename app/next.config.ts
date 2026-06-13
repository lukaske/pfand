import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // @pfand/shared is vendored at lib/shared and aliased in tsconfig paths, so the
  // app is self-contained (deployable without the monorepo workspace).
  // Pin the workspace root so Next doesn't latch onto an unrelated parent lockfile.
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
};

export default nextConfig;
