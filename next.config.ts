import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Blink is a database-backed internal tool: every page renders per request.
  serverExternalPackages: ["better-sqlite3"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
