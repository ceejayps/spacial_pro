import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageSwiftPath = path.resolve(
  __dirname,
  '..',
  'node_modules',
  '@capacitor-community',
  'camera-preview',
  'Package.swift',
);

if (!existsSync(packageSwiftPath)) {
  process.exit(0);
}

const original = readFileSync(packageSwiftPath, 'utf8');

const patched = original
  .replace(
    '.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "7.0.0")',
    '.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")',
  )
  .replace('name: "CapacitorCommunityCameraPreviewPlugin"', 'name: "CapacitorCommunityCameraPreview"');

if (patched !== original) {
  writeFileSync(packageSwiftPath, patched);
  process.stdout.write('patched camera-preview Package.swift for Capacitor 8\n');
}
