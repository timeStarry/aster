#!/bin/bash
set -euo pipefail

export PATH="/root/.cargo/bin:$PATH"

# Keep manual builds aligned with the release source and the CI toolchain.
version=$(node -p 'JSON.parse(require("fs").readFileSync("crates/aster-app/tauri.conf.json", "utf8")).version')
deb="target/x86_64-unknown-linux-gnu/release/bundle/deb/Aster_${version}_amd64.deb"
mkdir -p /out

echo "=== Installing tauri-cli ==="
cargo install tauri-cli --version "2.12.1" --locked

echo "=== Installing pnpm dependencies ==="
CI=true pnpm install --frozen-lockfile

echo "=== Building Aster Flagship .deb ==="
cd crates/aster-app
cargo tauri build --target x86_64-unknown-linux-gnu --bundles deb -- --locked 2>&1
cd ../..
cp "$deb" "/out/Aster_${version}_amd64.deb"
echo "Flagship .deb: $(du -sh "/out/Aster_${version}_amd64.deb" | cut -f1)"

echo "=== Done ==="
ls -la /out/
