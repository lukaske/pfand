import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Shared workspace package ships raw TS; let Next transpile it.
  transpilePackages: ["@pfand/shared"],
  // Pin the workspace root (avoids Next picking up an unrelated parent lockfile).
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
};

export default nextConfig;
