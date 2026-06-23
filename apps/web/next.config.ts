import type { NextConfig } from "next";

const proverRuntimeIncludes = [
  "./prover-circuit/**/*",
  "./.prover-bin/**/*",
  "./node_modules/@aztec/bb.js/**/*",
  "../../node_modules/.pnpm/@aztec+bb.js@0.87.0/node_modules/@aztec/bb.js/**/*",
  "./.next/barretenberg-threads.wasm.gz",
  "./.next/server/chunks/main.worker.js",
  "./.next/server/chunks/thread.worker.js"
];

const nextConfig: NextConfig = {
  devIndicators: false,
  serverExternalPackages: ["@aztec/bb.js"],
  outputFileTracingIncludes: {
    "/api/proofs": proverRuntimeIncludes,
    "/api/prover/health": proverRuntimeIncludes
  }
};

export default nextConfig;
