import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = dirname(fileURLToPath(import.meta.url));

const proverRuntimeIncludes = [
  "./prover-circuit/**/*",
  "./.prover-bin/**/*",
  "./node_modules/@aztec/bb.js/**/*",
  "./node_modules/buffer-from/**/*",
  "./node_modules/comlink/**/*",
  "./node_modules/commander/**/*",
  "./node_modules/debug/**/*",
  "./node_modules/fflate/**/*",
  "./node_modules/ms/**/*",
  "./node_modules/msgpackr/**/*",
  "./node_modules/pako/**/*",
  "./node_modules/source-map/**/*",
  "./node_modules/source-map-support/**/*",
  "./node_modules/tslib/**/*",
  "./node_modules/.pnpm/@aztec+bb.js@*/node_modules/@aztec/bb.js/**/*",
  "./node_modules/.pnpm/buffer-from@*/node_modules/buffer-from/**/*",
  "./node_modules/.pnpm/comlink@*/node_modules/comlink/**/*",
  "./node_modules/.pnpm/commander@*/node_modules/commander/**/*",
  "./node_modules/.pnpm/debug@*/node_modules/debug/**/*",
  "./node_modules/.pnpm/fflate@*/node_modules/fflate/**/*",
  "./node_modules/.pnpm/ms@*/node_modules/ms/**/*",
  "./node_modules/.pnpm/msgpackr@*/node_modules/msgpackr/**/*",
  "./node_modules/.pnpm/pako@*/node_modules/pako/**/*",
  "./node_modules/.pnpm/source-map@*/node_modules/source-map/**/*",
  "./node_modules/.pnpm/source-map-support@*/node_modules/source-map-support/**/*",
  "./node_modules/.pnpm/tslib@*/node_modules/tslib/**/*"
];

const nextConfig: NextConfig = {
  devIndicators: false,
  outputFileTracingRoot: appDir,
  serverExternalPackages: ["@aztec/bb.js"],
  outputFileTracingIncludes: {
    "/api/proofs": proverRuntimeIncludes,
    "/api/prover/health": proverRuntimeIncludes
  }
};

export default nextConfig;
