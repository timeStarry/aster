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

echo "=== Staging bundled plugins for full edition ==="
node scripts/stage-plugins.mjs

echo "=== Building lite edition .deb ==="
cd crates/aster-app
cargo tauri build --target x86_64-unknown-linux-gnu --bundles deb -- --locked 2>&1
cd ../..
cp "$deb" "/out/Aster-lite_${version}_amd64.deb"
echo "Lite .deb: $(du -sh "/out/Aster-lite_${version}_amd64.deb" | cut -f1)"

echo "=== Building full edition .deb ==="
cd crates/aster-app
cargo tauri build --target x86_64-unknown-linux-gnu --bundles deb --features bundled-plugins --config tauri.full.conf.json -- --locked 2>&1
cd ../..
cp "$deb" "/out/Aster-full_${version}_amd64.deb"
echo "Full .deb: $(du -sh "/out/Aster-full_${version}_amd64.deb" | cut -f1)"

echo "=== Done ==="
ls -la /out/
