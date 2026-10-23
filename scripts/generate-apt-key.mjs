#!/usr/bin/env node
// Generates an Ed25519 GPG keypair for WAIncognito APT repository signing.
// Usage: node scripts/generate-apt-key.mjs

import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagingDir = join(ROOT, 'app', 'packaging', 'linux');
mkdirSync(packagingDir, { recursive: true });

console.log('Generating GPG key for WAIncognito APT Repository...\n');

try {
  execSync('gpg --version', { stdio: 'ignore' });
} catch {
  console.error('Error: "gpg" command not found. Please install gnupg first.');
  process.exit(1);
}

const keyUid = 'WAIncognito APT Archive <release@whatsapp-web-incognito.internal>';

// Use modern gpg --quick-generate-key (supported natively across modern GnuPG 2.x)
try {
  execSync(`gpg --batch --passphrase "" --quick-generate-key "${keyUid}" ed25519 cert,sign 0`, {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
} catch {
  try {
    // Fallback to RSA 4096 if ed25519 is unsupported on older hosts
    console.log('Ed25519 not accepted, falling back to RSA 4096...');
    execSync(`gpg --batch --passphrase "" --quick-generate-key "${keyUid}" rsa4096 default 0`, {
      stdio: ['ignore', 'ignore', 'inherit'],
    });
  } catch (err) {
    console.error('Failed to generate GPG key:', err.message);
    process.exit(1);
  }
}

// Find generated key ID
const listOutput = execSync(`gpg --list-secret-keys --with-colons "${keyUid}"`, { encoding: 'utf8' });
const keyId = listOutput
  .split('\n')
  .filter((line) => line.startsWith('sec:'))
  .map((line) => line.split(':')[4])
  .pop();

if (!keyId) {
  console.error('Could not retrieve generated key ID from GnuPG keyring.');
  process.exit(1);
}

console.log(`Successfully generated GPG Key ID: ${keyId}`);

// Export ASCII-armored private key for GitHub Actions secret
const privateKeyArmored = execSync(`gpg --armor --export-secret-keys "${keyId}"`, { encoding: 'utf8' });

// Export binary and armored public keys
const publicKeyBinary = execSync(`gpg --export "${keyId}"`);
const publicKeyArmored = execSync(`gpg --armor --export "${keyId}"`, { encoding: 'utf8' });

// Save public keyring to app packaging so deb packages can bundle it
const pubBinaryPath = join(packagingDir, 'waincognito.gpg');
const pubArmoredPath = join(packagingDir, 'waincognito.asc');
writeFileSync(pubBinaryPath, publicKeyBinary);
writeFileSync(pubArmoredPath, publicKeyArmored, 'utf8');

console.log(`Saved public keyring to:`);
console.log(`  - ${pubBinaryPath}`);
console.log(`  - ${pubArmoredPath}\n`);

console.log('='.repeat(70));
console.log('ACTIONS REQUIRED TO ENABLE AUTOMATED APT SIGNING IN GITHUB:');
console.log('='.repeat(70));
console.log('1. Go to your GitHub repository:');
console.log('   Settings -> Secrets and variables -> Actions -> "New repository secret"\n');
console.log('2. Secret Name:');
console.log('   APT_GPG_PRIVATE_KEY\n');
console.log('3. Secret Value (copy everything between the dashed lines):\n');
console.log('----------------------------------------------------------------------');
console.log(privateKeyArmored.trim());
console.log('----------------------------------------------------------------------\n');
console.log('Once added, every GitHub Actions release will automatically sign the');
console.log('APT repository, generating InRelease and Release.gpg with zero user warnings!\n');
