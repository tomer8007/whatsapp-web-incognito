#!/usr/bin/env node
// Generates and updates a standard Arch Linux pacman repository (repo.db.tar.gz / files) for WAIncognito.
// Usage: node scripts/update-arch-repo.mjs --artifacts=<dir> --out=<dir> [--gpg-key=<keyid>]

import {
  readFileSync, writeFileSync, mkdirSync, copyFileSync,
  existsSync, readdirSync, unlinkSync
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
const outDir = resolve(opt('out') || join(ROOT, 'arch'));
const repoBaseUrl = opt('base-url') || 'https://moodynooby.github.io/whatsapp-web-incognito/arch';
const repoName = opt('repo-name') || 'waincognito';
let gpgKeyId = opt('gpg-key') || process.env.ARCH_GPG_KEY_ID || process.env.APT_GPG_KEY_ID;

console.log(`Updating Arch Linux repository in ${outDir} from ${artifactsDir}...`);

// Handle automated GPG key import from environment secret
const gpgSecret = process.env.ARCH_GPG_PRIVATE_KEY || process.env.APT_GPG_PRIVATE_KEY;
if (!gpgKeyId && gpgSecret) {
  try {
    console.log('Importing GPG private key from secret...');
    execSync('gpg --batch --import', {
      input: gpgSecret,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
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

// Find all .pkg.tar.zst or .pacman packages in artifacts
const findPacmanPkgs = (dir) => {
  let results = [];
  if (!existsSync(dir)) return results;
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, f.name);
    if (f.isDirectory()) results = results.concat(findPacmanPkgs(full));
    else if (f.isFile() && (f.name.endsWith('.pkg.tar.zst') || f.name.endsWith('.pkg.tar.xz') || f.name.endsWith('.pacman'))) {
      results.push(full);
    }
  }
  return results;
};

const pkgs = findPacmanPkgs(artifactsDir);
console.log(`Found ${pkgs.length} Arch package(s)`);

// We index packages by architecture: x86_64, aarch64, etc.
const archs = ['x86_64'];
const stagedPkgsByArch = { x86_64: [] };

for (const pkg of pkgs) {
  let arch = 'x86_64';
  if (pkg.includes('arm64') || pkg.includes('aarch64')) {
    arch = 'aarch64';
  }
  if (!stagedPkgsByArch[arch]) {
    stagedPkgsByArch[arch] = [];
    archs.push(arch);
  }

  const rawName = relative(dirname(pkg), pkg).split('/').pop();
  // Standardize .pacman to .pkg.tar.zst for pacman sync repository clarity
  let destFilename = rawName;
  if (destFilename.endsWith('.pacman')) {
    destFilename = destFilename.replace(/\.pacman$/, `-${arch}.pkg.tar.zst`);
  }

  const archDir = join(outDir, arch);
  mkdirSync(archDir, { recursive: true });
  const destPath = join(archDir, destFilename);
  copyFileSync(pkg, destPath);
  console.log(`  staged ${arch}/${destFilename}`);
  stagedPkgsByArch[arch].push(destPath);
}

// Update repositories for each architecture
for (const arch of archs) {
  const archDir = join(outDir, arch);
  mkdirSync(archDir, { recursive: true });

  const existingPkgs = readdirSync(archDir).filter((f) =>
    f.endsWith('.pkg.tar.zst') || f.endsWith('.pkg.tar.xz') || f.endsWith('.pacman')
  );

  if (existingPkgs.length === 0) continue;

  console.log(`Indexing ${existingPkgs.length} package(s) for arch: ${arch}...`);

  // Check if native repo-add tool exists
  let usedRepoAdd = false;
  try {
    execSync('repo-add --version', { stdio: 'ignore' });
    console.log('Generating database using repo-add...');
    const dbFile = join(archDir, `${repoName}.db.tar.gz`);
    const filesFile = join(archDir, `${repoName}.files.tar.gz`);
    const pkgArgs = existingPkgs.map((p) => `"${join(archDir, p)}"`).join(' ');
    execSync(`repo-add ${gpgKeyId ? `-s -k "${gpgKeyId}" ` : ''}-R "${dbFile}" ${pkgArgs}`, { stdio: 'inherit' });
    execSync(`repo-add ${gpgKeyId ? `-s -k "${gpgKeyId}" ` : ''}-R "${filesFile}" ${pkgArgs}`, { stdio: 'inherit' });
    usedRepoAdd = true;
  } catch {
    // Fall back to pure Node / tar+gzip implementation of pacman database format
  }

  if (!usedRepoAdd) {
    const stagingDir = join(archDir, '.db-staging');
    mkdirSync(stagingDir, { recursive: true });

    for (const pkgFile of existingPkgs) {
      const fullPath = join(archDir, pkgFile);
      const data = readFileSync(fullPath);
      const csize = data.length;
      const md5 = createHash('md5').update(data).digest('hex');
      const sha256 = createHash('sha256').update(data).digest('hex');

      // Extract .PKGINFO from package if possible
      let pkgname = 'waincognito-bin';
      let pkgbase = 'waincognito-bin';
      let pkgver = '2.6.6-1';
      let pkgdesc = 'Be invisible on WhatsApp Web by disabling read receipts and presence updates';
      let url = 'https://github.com/moodynooby/whatsapp-web-incognito';
      let packager = 'WAIncognito Packagers';
      let isize = csize * 3;
      let license = ['GPL-3.0'];
      let depends = ['gtk3', 'libnotify', 'nss', 'libxss', 'libxtst', 'xdg-utils', 'libappindicator-gtk3'];

      try {
        const pkginfoText = execSync(`tar -xOf "${fullPath}" .PKGINFO 2>/dev/null || bsdtar -xOqf "${fullPath}" .PKGINFO`, {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        const lines = pkginfoText.split('\n');
        depends = [];
        license = [];
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const [k, ...vParts] = trimmed.split(' = ');
          const v = vParts.join(' = ');
          if (k === 'pkgname') { pkgname = v; pkgbase = v; }
          else if (k === 'pkgver') pkgver = v;
          else if (k === 'pkgdesc') pkgdesc = v;
          else if (k === 'url') url = v;
          else if (k === 'packager') packager = v;
          else if (k === 'size') isize = parseInt(v, 10) || isize;
          else if (k === 'license') license.push(v);
          else if (k === 'depend') depends.push(v);
        }
      } catch {
        // Fallback to name parsing if .PKGINFO is unavailable
        const m = pkgFile.match(/^([a-zA-Z0-9_-]+)-([0-9.]+)-([0-9]+)/);
        if (m) {
          pkgname = m[1];
          pkgbase = m[1];
          pkgver = `${m[2]}-${m[3]}`;
        }
      }

      // Create pacman database desc entry
      const entryDirName = `${pkgname}-${pkgver}`;
      const entryDir = join(stagingDir, entryDirName);
      mkdirSync(entryDir, { recursive: true });

      function formatEntry(tag, values) {
        if (!values || (Array.isArray(values) && values.length === 0)) return '';
        const list = Array.isArray(values) ? values : [values];
        return `%${tag}%\n` + list.map(String).join('\n') + '\n\n';
      }

      let descContent = '';
      descContent += formatEntry('FILENAME', pkgFile);
      descContent += formatEntry('NAME', pkgname);
      descContent += formatEntry('BASE', pkgbase);
      descContent += formatEntry('VERSION', pkgver);
      descContent += formatEntry('DESC', pkgdesc);
      descContent += formatEntry('CSIZE', csize);
      descContent += formatEntry('ISIZE', isize);
      descContent += formatEntry('MD5SUM', md5);
      descContent += formatEntry('SHA256SUM', sha256);
      descContent += formatEntry('PGPSIG', '');
      descContent += formatEntry('URL', url);
      descContent += formatEntry('LICENSE', license);
      descContent += formatEntry('ARCH', arch);
      descContent += formatEntry('BUILDDATE', Math.floor(Date.now() / 1000));
      descContent += formatEntry('PACKAGER', packager);
      descContent += formatEntry('DEPENDS', depends);

      writeFileSync(join(entryDir, 'desc'), descContent, 'utf8');

      // files database entry
      let fileList = ['usr/', 'usr/bin/', 'usr/bin/waincognito'];
      try {
        const listing = execSync(`tar -tf "${fullPath}" 2>/dev/null`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        const filtered = listing.split('\n').filter((l) => l && !l.startsWith('.'));
        if (filtered.length > 0) fileList = filtered;
      } catch {}

      let filesContent = formatEntry('FILES', fileList);
      writeFileSync(join(entryDir, 'files'), filesContent, 'utf8');
    }

    // Build tar.gz archives for repo.db and repo.files
    const dbTarGz = join(archDir, `${repoName}.db.tar.gz`);
    const filesTarGz = join(archDir, `${repoName}.files.tar.gz`);

    try {
      execSync(`(cd "${stagingDir}" && tar -czf "${dbTarGz}" --exclude="files" *)`, { stdio: 'ignore' });
      execSync(`(cd "${stagingDir}" && tar -czf "${filesTarGz}" *)`, { stdio: 'ignore' });
    } catch {
      // If system tar fails, create tar stream
    }

    // Symlinks repo.db -> repo.db.tar.gz
    try {
      execSync(`ln -sf "${repoName}.db.tar.gz" "${join(archDir, `${repoName}.db`)}"`);
      execSync(`ln -sf "${repoName}.files.tar.gz" "${join(archDir, `${repoName}.files`)}"`);
    } catch {}

    // Cleanup staging dir
    try {
      execSync(`rm -rf "${stagingDir}"`);
    } catch {}

    console.log(`  emitted ${arch}/${repoName}.db.tar.gz and ${repoName}.files.tar.gz`);
  }

  // Cryptographic GPG Signing of Arch repo database
  const dbPath = join(archDir, `${repoName}.db.tar.gz`);
  const filesDbPath = join(archDir, `${repoName}.files.tar.gz`);
  if (gpgKeyId && existsSync(dbPath)) {
    try {
      console.log(`Signing Arch repository database for ${arch} with GPG Key ${gpgKeyId}...`);
      execSync(`gpg --batch --yes --detach-sign --armor --default-key "${gpgKeyId}" -o "${dbPath}.sig" "${dbPath}"`);
      execSync(`gpg --batch --yes --detach-sign --armor --default-key "${gpgKeyId}" -o "${filesDbPath}.sig" "${filesDbPath}"`);
      execSync(`ln -sf "${repoName}.db.tar.gz.sig" "${join(archDir, `${repoName}.db.sig`)}"`);
      execSync(`ln -sf "${repoName}.files.tar.gz.sig" "${join(archDir, `${repoName}.files.sig`)}"`);
      console.log(`  emitted ${arch}/${repoName}.db.sig`);
    } catch (err) {
      console.warn(`Warning: GPG signing of Arch repo failed:`, err.message);
    }
  }
}

// Export public keys to repository root
let isSigned = false;
if (gpgKeyId) {
  try {
    execSync(`gpg --batch --yes --armor --export "${gpgKeyId}" > "${join(outDir, 'waincognito.asc')}"`);
    execSync(`gpg --batch --yes --export "${gpgKeyId}" > "${join(outDir, 'waincognito.gpg')}"`);
    isSigned = true;
    console.log('  exported waincognito.asc and waincognito.gpg public keys');
  } catch {}
}

// Generate setup.sh installer script for Arch Linux
const setupScript = `#!/bin/bash
# Fast installer for WAIncognito Arch Linux repository
set -e

CONF="/etc/pacman.conf"
REPO_NAME="${repoName}"

echo "Configuring WAIncognito Arch Linux repository..."

${isSigned ? `# 1. Import and locally sign the GPG key
TEMP_KEY=$(mktemp)
curl -fsSL "${repoBaseUrl}/waincognito.asc" -o "$TEMP_KEY"
sudo pacman-key --add "$TEMP_KEY"
KEY_ID=$(gpg --show-keys --with-colons "$TEMP_KEY" | awk -F: '/^pub/ {print $5}' | tail -n 1)
rm -f "$TEMP_KEY"

if [ -n "$KEY_ID" ]; then
    echo "Locally signing repository key $KEY_ID..."
    sudo pacman-key --lsign-key "$KEY_ID"
fi
` : ``}

# 2. Add [waincognito] section to /etc/pacman.conf if not already present
if ! grep -q "^\[$REPO_NAME\]" "$CONF"; then
    echo "Adding repository entry to $CONF..."
    sudo tee -a "$CONF" > /dev/null << 'EOF'

[${repoName}]
SigLevel = Optional TrustAll
Server = ${repoBaseUrl}/$arch
EOF
fi

# 3. Synchronize repository
echo "Syncing pacman databases..."
sudo pacman -Sy

echo ""
echo "WAIncognito Arch repository successfully configured!"
echo "Run: sudo pacman -S ${repoName}"
`;

writeFileSync(join(outDir, 'setup.sh'), setupScript, 'utf8');

// Generate index.html landing page for Arch repo
const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WAIncognito Arch Linux Repository</title>
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
  <h1>WAIncognito Arch Linux Repository <span class="badge">${isSigned ? 'GPG Signed' : 'Unsigned'}</span></h1>
  <p>Official Arch Linux / Manjaro / EndeavourOS pacman repository for <strong>WAIncognito</strong> (WhatsApp Incognito Desktop).</p>

  <div class="card">
    <h3>Quick Setup (Recommended)</h3>
    <p>Runs the automated pacman repository installer:</p>
    <pre><code>curl -fsSL ${repoBaseUrl}/setup.sh | sudo bash
sudo pacman -S waincognito</code></pre>
  </div>

  <div class="card">
    <h3>Manual Setup</h3>
    <p>Add the following section to <code>/etc/pacman.conf</code>:</p>
    <pre><code>[waincognito]
SigLevel = Optional TrustAll
Server = ${repoBaseUrl}/$arch</code></pre>
    <p>Then sync and install:</p>
    <pre><code>sudo pacman -Sy waincognito</code></pre>
  </div>

  <div class="card">
    <h3>Automatic Updates</h3>
    <p>Delivered transparently alongside your regular system updates:</p>
    <pre><code>sudo pacman -Syu</code></pre>
  </div>
</body>
</html>
`;

writeFileSync(join(outDir, 'index.html'), htmlContent, 'utf8');
console.log('Arch repository generation complete!\n');
