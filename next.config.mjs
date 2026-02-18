import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // React development-time checks (double-invoke lifecycles in dev)
  reactStrictMode: true,
  // Generate a fully static site with multiple HTML files per route
  output: "export",
  // Keep using TypeScript path aliases from tsconfig
  webpack: (config) => {
    // Ensure .wasm referenced via new URL() is emitted as an asset and URL is returned
    config.module.rules.push({
      test: /\.wasm$/,
      type: "asset/resource",
    });
    return config;
  },
};

export default nextConfig;
