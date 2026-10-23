#!/usr/bin/env node
// Generates and updates a modern, fast, deb822-compliant Debian APT repository for WAIncognito.
// Usage: node scripts/update-apt-repo.mjs --artifacts=<dir> --out=<dir> [--gpg-key=<keyid>]

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
let gpgKeyId = opt('gpg-key') || process.env.APT_GPG_KEY_ID;

console.log(`Updating APT repository in ${outDir} from ${artifactsDir}...`);

// Handle automated GPG key import from environment secret (e.g. GitHub Actions)
if (!gpgKeyId && process.env.APT_GPG_PRIVATE_KEY) {
  try {
    console.log('Importing GPG private key from APT_GPG_PRIVATE_KEY secret...');
    const importOutput = execSync('gpg --batch --import', {
      input: process.env.APT_GPG_PRIVATE_KEY,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Extract key ID from secret keyring
    const keys = execSync('gpg --list-secret-keys --with-colons', { encoding: 'utf8' })
      .split('\n')
      .filter((l) => l.startsWith('sec:'))
      .map((l) => l.split(':')[4]);
    if (keys.length > 0) {
      gpgKeyId = keys[keys.length - 1];
      console.log(`Using imported GPG key ID: ${gpgKeyId}`);
    }
  } catch (err) {
    console.warn('Warning: Could not import GPG private key:', err.message);
  }
}

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

// 2. Scan packages for amd64 and arm64 and compress with both gzip and xz
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

  // Gzip compression
  const gz = gzipSync(Buffer.from(output, 'utf8'));
  writeFileSync(`${packagesFile}.gz`, gz);

  // XZ compression for modern APT speed and smaller downloads
  try {
    execSync(`xz -k -f -9 "${packagesFile}"`, { stdio: 'ignore' });
  } catch {
    // If xz is not installed, continue with .gz
  }

  const entriesCount = output.trim() ? output.split('\n\n').filter(Boolean).length : 0;
  console.log(`  indexed ${arch} packages (${entriesCount} entries)`);
}

// 3. Compute checksums and write dists/stable/Release
const releaseFiles = [
  'main/binary-amd64/Packages',
  'main/binary-amd64/Packages.gz',
  'main/binary-arm64/Packages',
  'main/binary-arm64/Packages.gz',
];

if (existsSync(join(distDir, 'main', 'binary-amd64', 'Packages.xz'))) {
  releaseFiles.push('main/binary-amd64/Packages.xz');
}
if (existsSync(join(distDir, 'main', 'binary-arm64', 'Packages.xz'))) {
  releaseFiles.push('main/binary-arm64/Packages.xz');
}

function fileInfo(rel) {
  const p = join(distDir, rel);
  const data = readFileSync(p);
  return {
    path: rel,
    size: data.length,
    md5: createHash('md5').update(data).digest('hex'),
    sha1: createHash('sha1').update(data).digest('hex'),
    sha256: createHash('sha256').update(data).digest('hex'),
    sha512: createHash('sha512').update(data).digest('hex'),
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
Acquire-By-Hash: yes
MD5Sum:
${stats.map((s) => ` ${s.md5} ${s.size} ${s.path}`).join('\n')}
SHA1:
${stats.map((s) => ` ${s.sha1} ${s.size} ${s.path}`).join('\n')}
SHA256:
${stats.map((s) => ` ${s.sha256} ${s.size} ${s.path}`).join('\n')}
SHA512:
${stats.map((s) => ` ${s.sha512} ${s.size} ${s.path}`).join('\n')}
`;

const releasePath = join(distDir, 'Release');
writeFileSync(releasePath, releaseContent, 'utf8');
console.log('  emitted dists/stable/Release (with Acquire-By-Hash and SHA512)');

// 4. Cryptographic GPG Signing (Release.gpg and InRelease)
let isSigned = false;
if (gpgKeyId) {
  try {
    console.log(`Signing Release with GPG Key ${gpgKeyId}...`);
    // Detached armored signature
    execSync(`gpg --batch --yes --armor --default-key "${gpgKeyId}" --detach-sign -o "${join(distDir, 'Release.gpg')}" "${releasePath}"`);
    // Clearsigned InRelease (allows 1-request 304 Not Modified caching in modern APT)
    execSync(`gpg --batch --yes --clearsign --default-key "${gpgKeyId}" -o "${join(distDir, 'InRelease')}" "${releasePath}"`);

    // Export public keys to repository root
    execSync(`gpg --batch --yes --export "${gpgKeyId}" > "${join(outDir, 'waincognito.gpg')}"`);
    execSync(`gpg --batch --yes --armor --export "${gpgKeyId}" > "${join(outDir, 'waincognito.asc')}"`);

    isSigned = true;
    console.log('  emitted dists/stable/InRelease');
    console.log('  emitted dists/stable/Release.gpg');
    console.log('  exported waincognito.gpg & waincognito.asc public keys');
  } catch (err) {
    console.warn('Warning: GPG signing failed, falling back to unsigned:', err.message);
  }
} else {
  console.log('No GPG signing key provided; generating clean unsigned deb822 stanza.');
}

// 5. Generate static deb822 waincognito.sources stanza file
const sourcesContent = isSigned
  ? `Types: deb
URIs: ${repoBaseUrl}/
Suites: stable
Components: main
Architectures: amd64 arm64
Signed-By: /etc/apt/keyrings/waincognito.gpg
`
  : `Types: deb
URIs: ${repoBaseUrl}/
Suites: stable
Components: main
Architectures: amd64 arm64
Trusted: yes
`;

writeFileSync(join(outDir, 'waincognito.sources'), sourcesContent, 'utf8');
console.log('  emitted waincognito.sources (deb822 format)');

// 6. Generate modern, robust setup.sh installer script
const setupScript = `#!/bin/bash
# Fast, deb822-compliant installer for WAIncognito APT repository
set -e

echo "Configuring WAIncognito APT repository..."

# Clean up legacy one-line entry to prevent duplicate target warnings
if [ -f "/etc/apt/sources.list.d/waincognito.list" ]; then
    sudo rm -f "/etc/apt/sources.list.d/waincognito.list"
fi

${isSigned ? `# Download and install GPG keyring into the standard /etc/apt/keyrings/ directory
sudo mkdir -p /etc/apt/keyrings
curl -fsSL "${repoBaseUrl}/waincognito.gpg" | sudo tee /etc/apt/keyrings/waincognito.gpg > /dev/null
sudo chmod 644 /etc/apt/keyrings/waincognito.gpg

# Install deb822 sources file with Signed-By verification and architecture restrictions
SOURCES_FILE="/etc/apt/sources.list.d/waincognito.sources"
sudo tee "$SOURCES_FILE" > /dev/null << 'EOF'
Types: deb
URIs: ${repoBaseUrl}/
Suites: stable
Components: main
Architectures: amd64 arm64
Signed-By: /etc/apt/keyrings/waincognito.gpg
EOF
sudo chmod 644 "$SOURCES_FILE"
` : `# Install unsigned deb822 sources file (without empty Signed-By field)
SOURCES_FILE="/etc/apt/sources.list.d/waincognito.sources"
sudo tee "$SOURCES_FILE" > /dev/null << 'EOF'
Types: deb
URIs: ${repoBaseUrl}/
Suites: stable
Components: main
Architectures: amd64 arm64
Trusted: yes
EOF
sudo chmod 644 "$SOURCES_FILE"
`}

echo "Updating package list for WAIncognito..."
sudo apt-get update -o Dir::Etc::sourcelist="sources.list.d/waincognito.sources" -o Dir::Etc::sourceparts="-" -o APT::Get::List-Cleanup="0" 2>/dev/null || sudo apt-get update

echo ""
echo "WAIncognito repository successfully configured with deb822 format!"
echo "Run: sudo apt install waincognito"
`;

writeFileSync(join(outDir, 'setup.sh'), setupScript, 'utf8');

// 7. Generate index.html landing page for GitHub Pages
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
    .badge { display: inline-block; padding: 0.25rem 0.6rem; border-radius: 9999px; font-size: 0.8rem; font-weight: 600; background: ${isSigned ? '#065f46; color: #6ee7b7;' : '#854d0e; color: #fef08a;'}; }
  </style>
</head>
<body>
  <h1>WAIncognito APT Repository <span class="badge">${isSigned ? 'GPG Signed' : 'Unsigned'}</span></h1>
  <p>Official Debian/Ubuntu APT repository for <strong>WAIncognito</strong> (WhatsApp Incognito Desktop).</p>

  <div class="card">
    <h3>Quick Setup (Recommended)</h3>
    <p>Runs the automated deb822 installer:</p>
    <pre><code>curl -fsSL ${repoBaseUrl}/setup.sh | sudo bash
sudo apt install waincognito</code></pre>
  </div>

  <div class="card">
    <h3>Manual Setup (Modern deb822)</h3>
    <p>1. Download the repository source configuration:</p>
    <pre><code>${isSigned ? `sudo mkdir -p /etc/apt/keyrings
curl -fsSL ${repoBaseUrl}/waincognito.gpg | sudo tee /etc/apt/keyrings/waincognito.gpg > /dev/null
curl -fsSL ${repoBaseUrl}/waincognito.sources | sudo tee /etc/apt/sources.list.d/waincognito.sources > /dev/null` : `curl -fsSL ${repoBaseUrl}/waincognito.sources | sudo tee /etc/apt/sources.list.d/waincognito.sources > /dev/null`}
sudo apt update
sudo apt install waincognito</code></pre>
  </div>

  <div class="card">
    <h3>Automatic Updates</h3>
    <p>Once installed, updates are automatically delivered through standard package updates with conditional caching:</p>
    <pre><code>sudo apt update && sudo apt upgrade</code></pre>
  </div>
</body>
</html>
`;

writeFileSync(join(outDir, 'index.html'), htmlContent, 'utf8');
console.log('APT repository generation complete!\n');
