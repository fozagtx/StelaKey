import { createWriteStream, existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binDir = resolve(appDir, ".prover-bin");

const versions = {
  nargo: "1.0.0-beta.9",
  bb: "0.87.0"
};

function assetUrls() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "linux" && arch === "x64") {
    return {
      nargo: `https://github.com/noir-lang/noir/releases/download/v${versions.nargo}/nargo-x86_64-unknown-linux-gnu.tar.gz`,
      bb: `https://github.com/AztecProtocol/aztec-packages/releases/download/v${versions.bb}/barretenberg-amd64-linux.tar.gz`
    };
  }

  if (platform === "linux" && arch === "arm64") {
    return {
      nargo: `https://github.com/noir-lang/noir/releases/download/v${versions.nargo}/nargo-aarch64-unknown-linux-gnu.tar.gz`,
      bb: null
    };
  }

  if (platform === "darwin" && arch === "arm64") {
    return {
      nargo: `https://github.com/noir-lang/noir/releases/download/v${versions.nargo}/nargo-aarch64-apple-darwin.tar.gz`,
      bb: `https://github.com/AztecProtocol/aztec-packages/releases/download/v${versions.bb}/barretenberg-arm64-darwin.tar.gz`
    };
  }

  if (platform === "darwin" && arch === "x64") {
    return {
      nargo: `https://github.com/noir-lang/noir/releases/download/v${versions.nargo}/nargo-x86_64-apple-darwin.tar.gz`,
      bb: `https://github.com/AztecProtocol/aztec-packages/releases/download/v${versions.bb}/barretenberg-amd64-darwin.tar.gz`
    };
  }

  throw new Error(`Unsupported prover tool platform: ${platform}/${arch}`);
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

function canRun(command, args) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("error", () => resolvePromise(false));
    child.on("exit", (code) => resolvePromise(code === 0));
  });
}

async function download(url, target) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }
  await pipeline(response.body, createWriteStream(target));
}

async function installArchive(url, binaryName) {
  const binaryPath = join(binDir, binaryName);
  if (existsSync(binaryPath)) {
    await chmod(binaryPath, 0o755);
    if (await canRun(binaryPath, ["--version"])) return;
    await rm(binaryPath, { force: true });
  }

  const workDir = await mkdtemp(join(tmpdir(), `stelakey-${binaryName}-`));
  const archive = join(workDir, `${binaryName}.tar.gz`);
  try {
    await download(url, archive);
    await run("tar", ["-xzf", archive, "-C", binDir]);
    await chmod(binaryPath, 0o755);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function main() {
  const urls = assetUrls();
  const installNativeBb =
    process.env.PROVER_NATIVE_BB === "1" || (!process.env.VERCEL && process.env.PROVER_NATIVE_BB !== "0");
  if (installNativeBb && !urls.bb) {
    throw new Error("No Barretenberg CLI release asset is configured for this platform.");
  }

  await mkdir(binDir, { recursive: true });
  await installArchive(urls.nargo, "nargo");
  if (installNativeBb && urls.bb) {
    await installArchive(urls.bb, "bb");
  } else {
    await rm(join(binDir, "bb"), { force: true });
  }
  await run(join(binDir, "nargo"), ["--version"]);
  if (installNativeBb) {
    await run(join(binDir, "bb"), ["--version"]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
