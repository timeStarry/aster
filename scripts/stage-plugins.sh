#!/usr/bin/env bash
# Stage official plugins into crates/aster-app/bundled-plugins for the full
# edition. Single source of truth for local, Docker and CI builds.
set -euo pipefail
cd "$(dirname "$0")/.."

dest=crates/aster-app/bundled-plugins
rm -rf "$dest"
mkdir -p "$dest"

for dir in plugins/*/; do
  cp -R "$dir" "$dest/$(basename "$dir")"
done

for dir in plugins-wasm/*/; do
  name=$(basename "$dir")
  wasm=$(echo "$name" | tr '.' '_')
  toml="${dir}Cargo.toml"
  # Cargo.toml stays rlib-only so native `cargo test` avoids the WIT export
  # linker error; add cdylib just for the wasm build.
  sed -i.bak 's/crate-type = \["rlib"\]/crate-type = ["cdylib", "rlib"]/' "$toml"
  cargo build --manifest-path "$toml" --target wasm32-wasip2 --release
  mv "${toml}.bak" "$toml"
  mkdir -p "$dest/$name"
  cp "target/wasm32-wasip2/release/${wasm}.wasm" "$dest/$name/"
  cp "${dir}aster.plugin.json" "$dest/$name/"
done

echo "staged: $(ls "$dest" | tr '\n' ' ')"
