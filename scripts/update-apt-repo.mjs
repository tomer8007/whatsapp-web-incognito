#!/usr/bin/env node
// Generates and updates a Debian APT repository for WAIncognito.
// Usage: node scripts/update-apt-repo.mjs --artifacts=<dir> --out=<dir>

import {
  readFileSync, writeFileSync, mkdirSync, copyFileSync,
  existsSync, readdirSync, statSync
} from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n) => argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];

const artifactsDir = resolve(opt('artifacts') || join(ROOT, 'release'));
const outDir = resolve(opt('out') || join(ROOT, 'apt'));
const repoBaseUrl = opt('base-url') || 'https://moodynooby.github.io/whatsapp-web-incognito/apt';

console.log(`Updating APT repository in ${outDir} from ${artifactsDir}...`);

const poolDir = join(outDir, 'pool', 'main');
const distDir = join(outDir, 'dists', 'stable');
const amd64Dir = join(distDir, 'main', 'binary-amd64');
const arm64Dir = join(distDir, 'main', 'binary-arm64');

mkdirSync(poolDir, { recursive: true });
mkdirSync(amd64Dir, { recursive: true });
mkdirSync(arm64Dir, { recursive: true });

// 1. Copy any .deb artifacts to the pool
if (existsSync(artifactsDir)) {
  const findDebs = (dir) => {
    let results = [];
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, f.name);
      if (f.isDirectory()) results = results.concat(findDebs(full));
      else if (f.isFile() && f.name.endsWith('.deb')) results.push(full);
    }
    return results;
  };

  const debs = findDebs(artifactsDir);
  console.log(`Found ${debs.length} .deb package(s)`);
  for (const deb of debs) {
    const dest = join(poolDir, relative(dirname(deb), deb).split('/').pop());
    copyFileSync(deb, dest);
    console.log(`  staged ${dest.split('/').pop()}`);
  }
}

// 2. Scan packages for amd64 and arm64
for (const arch of ['amd64', 'arm64']) {
  const targetDir = arch === 'amd64' ? amd64Dir : arm64Dir;
  const packagesFile = join(targetDir, 'Packages');
  let output = '';
  try {
    output = execSync(`dpkg-scanpackages --arch ${arch} pool/main /dev/null`, {
      cwd: outDir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
  } catch {
    output = '';
  }

  writeFileSync(packagesFile, output, 'utf8');
  const gz = gzipSync(Buffer.from(output, 'utf8'));
  writeFileSync(`${packagesFile}.gz`, gz);
  console.log(`  indexed ${arch} packages (${output.trim() ? output.split('\n\n').filter(Boolean).length : 0} entries)`);
}

// 3. Compute checksums and write dists/stable/Release
const releaseFiles = [
  'main/binary-amd64/Packages',
  'main/binary-amd64/Packages.gz',
  'main/binary-arm64/Packages',
  'main/binary-arm64/Packages.gz',
];

function fileInfo(rel) {
  const p = join(distDir, rel);
  const data = readFileSync(p);
  return {
    path: rel,
    size: data.length,
    md5: createHash('md5').update(data).digest('hex'),
    sha1: createHash('sha1').update(data).digest('hex'),
    sha256: createHash('sha256').update(data).digest('hex'),
  };
}

const stats = releaseFiles.map(fileInfo);

let releaseContent = `Origin: WAIncognito
Label: WAIncognito
Suite: stable
Codename: stable
Architectures: amd64 arm64
Components: main
Description: Official APT repository for WAIncognito (WhatsApp Incognito Desktop)
Date: ${new Date().toUTCString()}
MD5Sum:
${stats.map((s) => ` ${s.md5} ${s.size} ${s.path}`).join('\n')}
SHA1:
${stats.map((s) => ` ${s.sha1} ${s.size} ${s.path}`).join('\n')}
SHA256:
${stats.map((s) => ` ${s.sha256} ${s.size} ${s.path}`).join('\n')}
`;

writeFileSync(join(distDir, 'Release'), releaseContent, 'utf8');
console.log('  emitted dists/stable/Release');

// 4. Generate setup.sh helper script
const setupScript = `#!/bin/bash
# One-line installer for WAIncognito APT repository
set -e

echo "Configuring WAIncognito APT repository..."
SOURCES_FILE="/etc/apt/sources.list.d/waincognito.list"
echo "deb [trusted=yes] ${repoBaseUrl}/ stable main" | sudo tee "$SOURCES_FILE" > /dev/null
sudo chmod 644 "$SOURCES_FILE"

echo "Updating package list..."
sudo apt-get update -o Dir::Etc::sourcelist="sources.list.d/waincognito.list" -o Dir::Etc::sourceparts="-" -o APT::Get::List-Cleanup="0" || sudo apt-get update

echo ""
echo "WAIncognito repository is configured!"
echo "Run: sudo apt install waincognito"
`;

writeFileSync(join(outDir, 'setup.sh'), setupScript, 'utf8');

// 5. Generate index.html landing page for GitHub Pages
const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WAIncognito APT Repository</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; max-width: 800px; margin: 0 auto; line-height: 1.6; }
    h1 { color: #38bdf8; }
    code { background: #1e293b; color: #38bdf8; padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.9em; }
    pre { background: #1e293b; padding: 1rem; border-radius: 8px; overflow-x: auto; border: 1px solid #334155; }
    pre code { background: none; padding: 0; color: #a5f3fc; }
    .card { background: #1e293b80; border: 1px solid #334155; border-radius: 8px; padding: 1.5rem; margin-top: 1.5rem; }
  </style>
</head>
<body>
  <h1>WAIncognito APT Repository</h1>
  <p>Official Debian/Ubuntu APT repository for <strong>WAIncognito</strong>.</p>

  <div class="card">
    <h3>Quick Setup</h3>
    <pre><code>curl -fsSL ${repoBaseUrl}/setup.sh | sudo bash
sudo apt install waincognito</code></pre>
  </div>

  <div class="card">
    <h3>Manual Setup</h3>
    <p>Add the repository to your APT sources:</p>
    <pre><code>echo "deb [trusted=yes] ${repoBaseUrl}/ stable main" | sudo tee /etc/apt/sources.list.d/waincognito.list
sudo apt update
sudo apt install waincognito</code></pre>
  </div>

  <div class="card">
    <h3>Updating</h3>
    <p>Once installed, updates are delivered automatically via standard package management:</p>
    <pre><code>sudo apt update && sudo apt upgrade</code></pre>
  </div>
</body>
</html>
`;

writeFileSync(join(outDir, 'index.html'), htmlContent, 'utf8');
console.log('APT repository generation complete!\n');
