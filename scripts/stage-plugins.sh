#!/usr/bin/env bash
# Keep the existing local and Docker entry point; the implementation also runs
# natively on Windows and does not rewrite Cargo manifests to build WASM.
set -euo pipefail
exec node "$(dirname "$0")/stage-plugins.mjs"
