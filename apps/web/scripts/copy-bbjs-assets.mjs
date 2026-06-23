import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bbJsDir = resolve(appDir, "node_modules/@aztec/bb.js/dest/node/barretenberg_wasm");
const nextDir = resolve(appDir, ".next");
const chunksDir = resolve(nextDir, "server/chunks");

await mkdir(chunksDir, { recursive: true });
await copyFile(resolve(bbJsDir, "barretenberg-threads.wasm.gz"), resolve(nextDir, "barretenberg-threads.wasm.gz"));
await copyFile(
  resolve(bbJsDir, "barretenberg_wasm_main/factory/node/main.worker.js"),
  resolve(chunksDir, "main.worker.js")
);
await copyFile(
  resolve(bbJsDir, "barretenberg_wasm_thread/factory/node/thread.worker.js"),
  resolve(chunksDir, "thread.worker.js")
);

console.log("Copied bb.js WASM runtime assets into .next.");
