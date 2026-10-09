#!/bin/bash
set -e

export PATH="/root/.cargo/bin:$PATH"

echo "=== Installing tauri-cli ==="
cargo install tauri-cli --version "^2" --locked

echo "=== Installing pnpm dependencies ==="
CI=true pnpm install

echo "=== Building WASM plugins ==="
for plugin_dir in plugins-wasm/*/; do
  plugin_name=$(basename "$plugin_dir")
  wasm_name=$(echo "$plugin_name" | tr '.' '_')
  toml="${plugin_dir}Cargo.toml"
  echo "Building WASM: $plugin_name"
  sed -i.bak 's/crate-type = \["rlib"\]/crate-type = ["cdylib", "rlib"]/' "$toml"
  cargo build --manifest-path "$toml" --target wasm32-wasip2 --release
  mv "${toml}.bak" "$toml"
done

echo "=== Staging bundled plugins for full edition ==="
mkdir -p crates/aster-app/bundled-plugins
cp -r plugins/aster.theme-dark crates/aster-app/bundled-plugins/
cp -r plugins/aster.mermaid    crates/aster-app/bundled-plugins/
cp -r plugins/aster.math       crates/aster-app/bundled-plugins/
for plugin_dir in plugins-wasm/*/; do
  plugin_name=$(basename "$plugin_dir")
  wasm_name=$(echo "$plugin_name" | tr '.' '_')
  dest="crates/aster-app/bundled-plugins/${plugin_name}"
  mkdir -p "$dest"
  cp "target/wasm32-wasip2/release/${wasm_name}.wasm" "$dest/"
  cp "${plugin_dir}aster.plugin.json" "$dest/"
done

echo "=== Building lite edition .deb ==="
cd crates/aster-app
cargo tauri build --target x86_64-unknown-linux-gnu --bundles deb 2>&1
cd ../..
deb_lite=$(find target/x86_64-unknown-linux-gnu/release/bundle/deb -name "*.deb" | head -1)
cp "$deb_lite" "/out/Aster-lite_0.1.0-alpha.3_amd64.deb"
echo "Lite .deb: $(du -sh /out/Aster-lite_0.1.0-alpha.3_amd64.deb | cut -f1)"

echo "=== Building full edition .deb ==="
cd crates/aster-app
cargo tauri build --target x86_64-unknown-linux-gnu --bundles deb --features bundled-plugins 2>&1
cd ../..
deb_full=$(find target/x86_64-unknown-linux-gnu/release/bundle/deb -name "*.deb" | head -1)
cp "$deb_full" "/out/Aster-full_0.1.0-alpha.3_amd64.deb"
echo "Full .deb: $(du -sh /out/Aster-full_0.1.0-alpha.3_amd64.deb | cut -f1)"

echo "=== Done ==="
ls -la /out/
