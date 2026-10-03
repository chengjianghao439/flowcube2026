'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const VERSION = '26.15.3';
const ORIGINAL_SHA256 = '3452ca5b9a2f29dd6460f0cc9937be2dc1bbbf36809f410649a015b35a607b48';
const PATCHED_SHA256 = '7c298a076e5deed41bc395bf96f749d2755b6d8b8dce33d40d905ed438babaad';
const ORIGINAL_LINE = 'const configWithProgress = { ...config, downloadOptions };';
const PATCHED_LINE = 'const configWithProgress = { ...config, downloadOptions, downloader: require("../../../../build-support/builder-downloader.cjs").builderDownloader };';
const sha256 = input => createHash('sha256').update(input).digest('hex');

function patchBuilderDownload(packageRoot) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) throw new Error('Builder patch requires Node >=22.12.0');
  const version = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).version;
  if (version !== VERSION) throw new Error(`Unsupported app-builder-lib version: expected ${VERSION}, received ${version}`);
  const file = path.join(packageRoot, 'out/util/electronGet.js');
  const current = fs.readFileSync(file, 'utf8');
  const currentHash = sha256(current);
  // Pin both complete byte sequences; the presence of our marker cannot bypass
  // review of any upstream/local drift, including an already patched module.
  if (currentHash === PATCHED_SHA256) return;
  if (currentHash !== ORIGINAL_SHA256) throw new Error('Unsupported electronGet.js SHA-256; review upstream source before updating this patch');
  if (current.split(ORIGINAL_LINE).length !== 2) throw new Error('Expected exactly one electronGet.js injection point');
  const patched = current.replace(ORIGINAL_LINE, PATCHED_LINE);
  if (sha256(patched) !== PATCHED_SHA256) throw new Error('Invalid compatibility patch SHA-256');
  fs.writeFileSync(file, patched);
}

if (require.main === module) {
  const packageRoot = path.resolve(__dirname, '../node_modules/app-builder-lib');
  const resolvedRoot = path.dirname(require.resolve('app-builder-lib/package.json', { paths: [path.resolve(__dirname, '..')] }));
  if (resolvedRoot !== packageRoot) throw new Error('Unsupported app-builder-lib install layout for the pinned relative adapter path');
  patchBuilderDownload(packageRoot);
  console.log(`Applied verified app-builder-lib ${VERSION} Downloader compatibility patch`);
}

module.exports = { patchBuilderDownload, PATCHED_LINE };
