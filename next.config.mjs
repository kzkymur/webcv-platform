import path from "node:path";

const isGitHubActions = process.env.GITHUB_ACTIONS === "true";
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "";
const basePath = isGitHubActions && repositoryName ? `/${repositoryName}` : "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // React development-time checks (double-invoke lifecycles in dev)
  reactStrictMode: true,
  // Generate a fully static site with multiple HTML files per route
  output: "export",
  // Keep static export routing stable under GitHub Pages subpaths
  trailingSlash: true,
  basePath,
  assetPrefix: basePath ? `${basePath}/` : undefined,
  images: {
    unoptimized: true,
  },
  // Keep using TypeScript path aliases from tsconfig
  webpack: (config) => {
    // Ensure .wasm referenced via new URL() is emitted as an asset and URL is returned
    config.module.rules.push({
      test: /\.wasm$/,
      type: "asset/resource",
    });
    // Treat any `?url` import (including JS glue) as a file URL
    config.module.rules.push({
      resourceQuery: /url/,
      type: "asset/resource",
    });
    // Ensure @wasm alias resolves in both app code and workers
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "@wasm": path.resolve(process.cwd(), "src-wasm/index.js"),
    };
    return config;
  },
};

export default nextConfig;
