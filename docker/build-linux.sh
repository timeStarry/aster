#!/bin/bash
set -e

export PATH="/root/.cargo/bin:$PATH"

echo "=== Installing tauri-cli ==="
cargo install tauri-cli --version "^2" --locked

echo "=== Installing pnpm dependencies ==="
CI=true pnpm install

echo "=== Staging bundled plugins for full edition ==="
bash scripts/stage-plugins.sh

echo "=== Building lite edition .deb ==="
cd crates/aster-app
cargo tauri build --target x86_64-unknown-linux-gnu --bundles deb 2>&1
cd ../..
deb_lite=$(find target/x86_64-unknown-linux-gnu/release/bundle/deb -name "*.deb" | head -1)
cp "$deb_lite" "/out/Aster-lite_0.1.0-alpha.6_amd64.deb"
echo "Lite .deb: $(du -sh /out/Aster-lite_0.1.0-alpha.6_amd64.deb | cut -f1)"

echo "=== Building full edition .deb ==="
cd crates/aster-app
cargo tauri build --target x86_64-unknown-linux-gnu --bundles deb --features bundled-plugins --config tauri.full.conf.json 2>&1
cd ../..
deb_full=$(find target/x86_64-unknown-linux-gnu/release/bundle/deb -name "*.deb" | head -1)
cp "$deb_full" "/out/Aster-full_0.1.0-alpha.6_amd64.deb"
echo "Full .deb: $(du -sh /out/Aster-full_0.1.0-alpha.6_amd64.deb | cut -f1)"

echo "=== Done ==="
ls -la /out/
