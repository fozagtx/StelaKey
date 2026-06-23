#!/usr/bin/env bash
set -euo pipefail

cargo build --workspace --target wasm32v1-none --release
