#!/usr/bin/env node
// Generates and updates a standard DNF/YUM RPM repository (repodata) for WAIncognito.
// Usage: node scripts/update-rpm-repo.mjs --artifacts=<dir> --out=<dir> [--gpg-key=<keyid>]

import {
  readFileSync, writeFileSync, mkdirSync, copyFileSync,
  existsSync, readdirSync
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
const outDir = resolve(opt('out') || join(ROOT, 'rpm'));
const repoBaseUrl = opt('base-url') || 'https://moodynooby.github.io/whatsapp-web-incognito/rpm';
let gpgKeyId = opt('gpg-key') || process.env.APT_GPG_KEY_ID || process.env.RPM_GPG_KEY_ID;

console.log(`Updating RPM repository in ${outDir} from ${artifactsDir}...`);

// Handle automated GPG key import from environment secret (same key used for repository signing)
const gpgSecret = process.env.RPM_GPG_PRIVATE_KEY || process.env.APT_GPG_PRIVATE_KEY;
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

const packagesDir = join(outDir, 'Packages');
const repodataDir = join(outDir, 'repodata');

mkdirSync(packagesDir, { recursive: true });
mkdirSync(repodataDir, { recursive: true });

// 1. Copy any .rpm artifacts to Packages/
const findRpms = (dir) => {
  let results = [];
  if (!existsSync(dir)) return results;
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, f.name);
    if (f.isDirectory()) results = results.concat(findRpms(full));
    else if (f.isFile() && f.name.endsWith('.rpm')) results.push(full);
  }
  return results;
};

const rpms = findRpms(artifactsDir);
console.log(`Found ${rpms.length} .rpm package(s)`);
for (const rpm of rpms) {
  const filename = relative(dirname(rpm), rpm).split('/').pop();
  const dest = join(packagesDir, filename);
  copyFileSync(rpm, dest);
  console.log(`  staged Packages/${filename}`);
}

// 2. Generate repodata metadata using createrepo_c if available, or pure Node.js fallback
let generatedWithCreaterepo = false;
try {
  execSync('createrepo_c --version', { stdio: 'ignore' });
  console.log('Generating repodata using createrepo_c...');
  execSync(`createrepo_c --update "${outDir}"`, { stdio: 'inherit' });
  generatedWithCreaterepo = true;
} catch {
  try {
    execSync('createrepo --version', { stdio: 'ignore' });
    console.log('Generating repodata using createrepo...');
    execSync(`createrepo --update "${outDir}"`, { stdio: 'inherit' });
    generatedWithCreaterepo = true;
  } catch {
    // Fall back to pure Node.js standard RPM-MD metadata generator
    console.log('createrepo_c not found; using built-in RPM-MD metadata generator...');
  }
}

if (!generatedWithCreaterepo) {
  const currentRpms = readdirSync(packagesDir).filter((f) => f.endsWith('.rpm'));
  const packagesList = [];

  for (const filename of currentRpms) {
    const fullPath = join(packagesDir, filename);
    const data = readFileSync(fullPath);
    const pkgSize = data.length;
    const sha256 = createHash('sha256').update(data).digest('hex');

    // Query RPM attributes if rpm binary is available, otherwise derive from filename
    let pkgName = 'waincognito';
    let pkgVer = '2.6.6';
    let pkgRel = '1';
    let pkgArch = 'x86_64';
    let pkgSummary = 'Be invisible on WhatsApp Web by disabling read receipts and presence updates';
    let pkgDesc = pkgSummary;
    let pkgLicense = 'GPL-3.0';

    try {
      const qf = "%{NAME}|%{VERSION}|%{RELEASE}|%{ARCH}|%{SUMMARY}|%{LICENSE}";
      const queryOut = execSync(`rpm -qp --queryformat "${qf}" "${fullPath}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      const parts = queryOut.split('|');
      if (parts.length >= 6) {
        pkgName = parts[0] || pkgName;
        pkgVer = parts[1] || pkgVer;
        pkgRel = parts[2] || pkgRel;
        pkgArch = parts[3] || pkgArch;
        pkgSummary = parts[4] || pkgSummary;
        pkgLicense = parts[5] || pkgLicense;
      }
    } catch {
      // Derive from filename pattern: name-version.release.arch.rpm
      const m = filename.match(/^([a-zA-Z0-9_-]+)-([0-9.]+)-([0-9]+)\.([a-zA-Z0-9_]+)\.rpm$/) ||
                filename.match(/^([a-zA-Z0-9_-]+)-([0-9.]+)\.([a-zA-Z0-9_]+)\.rpm$/);
      if (m) {
        pkgName = m[1];
        pkgVer = m[2];
        pkgRel = m[3] || '1';
        pkgArch = m[4] || 'x86_64';
      }
    }

    packagesList.push({
      name: pkgName,
      arch: pkgArch,
      version: pkgVer,
      release: pkgRel,
      checksum: sha256,
      summary: pkgSummary,
      description: pkgDesc,
      license: pkgLicense,
      size: pkgSize,
      location: `Packages/${filename}`,
      time: Math.floor(Date.now() / 1000),
    });
  }

  // Generate primary.xml
  let primaryXml = `<?xml version="1.0" encoding="UTF-8"?>
<metadata xmlns="http://linux.duke.edu/metadata/common" xmlns:rpm="http://linux.duke.edu/metadata/rpm" packages="${packagesList.length}">
`;
  for (const pkg of packagesList) {
    primaryXml += `  <package type="rpm">
    <name>${pkg.name}</name>
    <arch>${pkg.arch}</arch>
    <version epoch="0" ver="${pkg.version}" rel="${pkg.release}"/>
    <checksum type="sha256" pkgid="YES">${pkg.checksum}</checksum>
    <summary>${escapeXml(pkg.summary)}</summary>
    <description>${escapeXml(pkg.description)}</description>
    <packager>WAIncognito Packagers</packager>
    <url>https://github.com/moodynooby/whatsapp-web-incognito</url>
    <time file="${pkg.time}" build="${pkg.time}"/>
    <size package="${pkg.size}" installed="${pkg.size * 3}" archive="${pkg.size * 3}"/>
    <location href="${pkg.location}"/>
    <format>
      <rpm:license>${pkg.license}</rpm:license>
      <rpm:vendor>WAIncognito</rpm:vendor>
      <rpm:group>Network</rpm:group>
      <rpm:provides>
        <rpm:entry name="${pkg.name}" flags="EQ" epoch="0" ver="${pkg.version}" rel="${pkg.release}"/>
      </rpm:provides>
      <rpm:requires>
        <rpm:entry name="/bin/sh"/>
      </rpm:requires>
    </format>
  </package>
`;
  }
  primaryXml += `</metadata>\n`;

  const primaryGz = gzipSync(Buffer.from(primaryXml, 'utf8'));
  const primaryGzPath = join(repodataDir, 'primary.xml.gz');
  writeFileSync(primaryGzPath, primaryGz);

  const primarySha256 = createHash('sha256').update(primaryGz).digest('hex');
  const primaryOpenSha256 = createHash('sha256').update(primaryXml).digest('hex');
  const nowEpoch = Math.floor(Date.now() / 1000);

  // Generate repomd.xml
  const repomdXml = `<?xml version="1.0" encoding="UTF-8"?>
<repomd xmlns="http://linux.duke.edu/metadata/repo" xmlns:rpm="http://linux.duke.edu/metadata/rpm">
  <revision>${nowEpoch}</revision>
  <data type="primary">
    <checksum type="sha256">${primarySha256}</checksum>
    <open-checksum type="sha256">${primaryOpenSha256}</open-checksum>
    <location href="repodata/primary.xml.gz"/>
    <timestamp>${nowEpoch}</timestamp>
    <size>${primaryGz.length}</size>
    <open-size>${Buffer.byteLength(primaryXml, 'utf8')}</open-size>
  </data>
</repomd>
`;
  writeFileSync(join(repodataDir, 'repomd.xml'), repomdXml, 'utf8');
  console.log('  emitted repodata/repomd.xml and primary.xml.gz');
}

function escapeXml(unsafe) {
  return (unsafe || '').replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}

// 3. Cryptographic GPG Signing of repomd.xml
const repomdPath = join(repodataDir, 'repomd.xml');
let isSigned = false;
if (gpgKeyId && existsSync(repomdPath)) {
  try {
    console.log(`Signing repomd.xml with GPG Key ${gpgKeyId}...`);
    execSync(`gpg --batch --yes --armor --default-key "${gpgKeyId}" --detach-sign -o "${join(repodataDir, 'repomd.xml.asc')}" "${repomdPath}"`);
    execSync(`gpg --batch --yes --export "${gpgKeyId}" > "${join(repodataDir, 'repomd.xml.key')}"`);
    execSync(`gpg --batch --yes --armor --export "${gpgKeyId}" > "${join(outDir, 'RPM-GPG-KEY-waincognito')}"`);
    isSigned = true;
    console.log('  emitted repodata/repomd.xml.asc and exported RPM-GPG-KEY-waincognito');
  } catch (err) {
    console.warn('Warning: GPG signing of repomd.xml failed:', err.message);
  }
}

// 4. Generate static .repo configuration file for DNF/YUM
const repoFileContent = isSigned
  ? `[waincognito]
name=WAIncognito Repository
baseurl=${repoBaseUrl}/
enabled=1
gpgcheck=1
repo_gpgcheck=1
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-waincognito
       ${repoBaseUrl}/RPM-GPG-KEY-waincognito
`
  : `[waincognito]
name=WAIncognito Repository
baseurl=${repoBaseUrl}/
enabled=1
gpgcheck=0
repo_gpgcheck=0
`;

writeFileSync(join(outDir, 'waincognito.repo'), repoFileContent, 'utf8');
console.log('  emitted waincognito.repo');

// 5. Generate setup.sh installer script for DNF / Fedora / RHEL
const setupScript = `#!/bin/bash
# Fast installer for WAIncognito DNF / RPM repository
set -e

echo "Configuring WAIncognito DNF/RPM repository..."

${isSigned ? `# Download and install GPG key into /etc/pki/rpm-gpg
sudo mkdir -p /etc/pki/rpm-gpg
curl -fsSL "${repoBaseUrl}/RPM-GPG-KEY-waincognito" | sudo tee /etc/pki/rpm-gpg/RPM-GPG-KEY-waincognito > /dev/null
sudo chmod 644 /etc/pki/rpm-gpg/RPM-GPG-KEY-waincognito

# Install repo configuration
sudo curl -fsSL "${repoBaseUrl}/waincognito.repo" -o /etc/yum.repos.d/waincognito.repo
sudo chmod 644 /etc/yum.repos.d/waincognito.repo
` : `# Install unsigned repo configuration
sudo curl -fsSL "${repoBaseUrl}/waincognito.repo" -o /etc/yum.repos.d/waincognito.repo
sudo chmod 644 /etc/yum.repos.d/waincognito.repo
`}

echo ""
echo "WAIncognito RPM repository successfully configured!"
echo "Run: sudo dnf install waincognito"
`;

writeFileSync(join(outDir, 'setup.sh'), setupScript, 'utf8');

// 6. Generate index.html landing page
const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WAIncognito RPM Repository (DNF/YUM)</title>
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
  <h1>WAIncognito RPM Repository <span class="badge">${isSigned ? 'GPG Signed' : 'Unsigned'}</span></h1>
  <p>Official Fedora / RHEL / CentOS / openSUSE RPM repository for <strong>WAIncognito</strong> (WhatsApp Incognito Desktop).</p>

  <div class="card">
    <h3>Quick Setup (Recommended)</h3>
    <p>Runs the automated DNF repository installer:</p>
    <pre><code>curl -fsSL ${repoBaseUrl}/setup.sh | sudo bash
sudo dnf install waincognito</code></pre>
  </div>

  <div class="card">
    <h3>Manual Setup</h3>
    <p>1. Download repository configuration:</p>
    <pre><code>${isSigned ? `sudo curl -fsSL ${repoBaseUrl}/RPM-GPG-KEY-waincognito -o /etc/pki/rpm-gpg/RPM-GPG-KEY-waincognito
sudo curl -fsSL ${repoBaseUrl}/waincognito.repo -o /etc/yum.repos.d/waincognito.repo` : `sudo curl -fsSL ${repoBaseUrl}/waincognito.repo -o /etc/yum.repos.d/waincognito.repo`}
sudo dnf install waincognito</code></pre>
  </div>

  <div class="card">
    <h3>Automatic Updates</h3>
    <p>Updates are delivered through standard dnf upgrade commands:</p>
    <pre><code>sudo dnf upgrade --refresh waincognito</code></pre>
  </div>
</body>
</html>
`;

writeFileSync(join(outDir, 'index.html'), htmlContent, 'utf8');
console.log('RPM repository generation complete!\n');
