#!/usr/bin/env node
// Stage the full edition's official plugins on Windows, macOS and Linux.
// Cargo's crate-type override preserves the native-test manifests on failures.
import { cp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = join(root, 'crates', 'aster-app', 'bundled-plugins');

function cargo(args, capture = false) {
  const result = spawnSync('cargo', args, {
    cwd: root,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`cargo ${args[0]} failed (${result.status})`);
  return result.stdout;
}

async function directories(path) {
  return (await readdir(path, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

const metadata = JSON.parse(cargo(['metadata', '--no-deps', '--format-version', '1', '--locked'], true));
const staged = [];
// Verify the absolute recursive-delete target stays at this repository's
// generated plugin directory, before touching any existing files.
if (relative(root, resolve(destination)) !== join('crates', 'aster-app', 'bundled-plugins')) {
  throw new Error(`Unsafe plugin staging directory: ${destination}`);
}
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });

for (const name of await directories(join(root, 'plugins'))) {
  await cp(join(root, 'plugins', name), join(destination, name), { recursive: true });
  staged.push(name);
}

for (const name of await directories(join(root, 'plugins-wasm'))) {
  const source = join(root, 'plugins-wasm', name);
  const manifest = join(source, 'Cargo.toml');
  const pkg = metadata.packages.find(pkg => resolve(pkg.manifest_path) === manifest);
  const library = pkg?.targets.find(target => target.kind.includes('rlib') || target.kind.includes('lib'));
  if (!library) throw new Error(`No library target in ${manifest}`);
  cargo(['rustc', '--manifest-path', manifest, '--lib', '--target', 'wasm32-wasip2', '--release', '--locked', '--crate-type', 'cdylib']);
  const wasm = `${library.name.replaceAll('-', '_')}.wasm`;
  const output = join(metadata.target_directory, 'wasm32-wasip2', 'release', wasm);
  // Missing outputs and malformed manifests must fail the release build.
  const plugin = JSON.parse(await readFile(join(source, 'aster.plugin.json'), 'utf8'));
  if (plugin.id !== name) throw new Error(`Plugin identifier mismatch for ${name}`);
  if (plugin.backend !== wasm) throw new Error(`WASM backend filename mismatch for ${name}`);
  await mkdir(join(destination, name), { recursive: true });
  await cp(output, join(destination, name, wasm));
  await cp(join(source, 'aster.plugin.json'), join(destination, name, 'aster.plugin.json'));
  staged.push(name);
}

console.log(`staged: ${staged.join(' ')}`);
