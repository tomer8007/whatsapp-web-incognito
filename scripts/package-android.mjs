#!/usr/bin/env node
// Package the Android GeckoView app into an installable, reproducible APK.
//
//   node scripts/package-android.mjs            builds release APK
//   node scripts/package-android.mjs --debug    builds debug APK
//   node scripts/package-android.mjs --check    diagnostic check of Android toolchain
//
// Mirroring scripts/package-ext.mjs, this script:
// 1. Verifies and stages the extension assets automatically (node scripts/build.mjs --target=geckoview)
// 2. Checks Java & Android SDK environments, auto-detecting compatible JDKs (17/21)
// 3. Executes the Gradle build hermetically via ./gradlew
// 4. Stashes the final APK into release/android/ with standard naming and sha256 checksums

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID_DIR = join(ROOT, 'app', 'android');
const OUTDIR = join(ROOT, 'release', 'android');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);

if (flag('help') || flag('h')) {
  console.log(`
  Package the Android GeckoView app into an installable APK.

    node scripts/package-android.mjs [--debug] [--check]

    --debug    Build debug variant (assembleDebug) instead of release
    --check    Only check JDK, Gradle wrapper, and Android SDK prerequisites
`);
  process.exit(0);
}

const isDebug = flag('debug');
const isCheckOnly = flag('check');

// ---------------------------------------------------------------- helpers

function human(n) {
  return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
}

function getVersion() {
  const m = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
  return m.version || '2.5.95';
}

function sha256(filePath) {
  const data = readFileSync(filePath);
  return createHash('sha256').update(data).digest('hex');
}

// ---------------------------------------------------------------- toolchain detection

function detectJdk() {
  // Check existing JAVA_HOME
  const envJavaHome = process.env.JAVA_HOME;
  if (envJavaHome && existsSync(join(envJavaHome, 'bin', 'javac'))) {
    return { path: envJavaHome, source: 'JAVA_HOME' };
  }

  // Check SDKMAN candidates for Java 17 or 21
  const sdkmanJava = join(process.env.HOME || '', '.sdkman', 'candidates', 'java');
  if (existsSync(sdkmanJava)) {
    const candidates = readdirSync(sdkmanJava).filter((d) => d.startsWith('17.') || d.startsWith('21.'));
    if (candidates.length) {
      return { path: join(sdkmanJava, candidates[0]), source: 'sdkman' };
    }
  }

  // Check /usr/lib/jvm
  const jvmDir = '/usr/lib/jvm';
  if (existsSync(jvmDir)) {
    const candidates = readdirSync(jvmDir).filter((d) => d.includes('17') || d.includes('21'));
    if (candidates.length) {
      return { path: join(jvmDir, candidates[0]), source: '/usr/lib/jvm' };
    }
  }

  return null;
}

function detectAndroidSdk() {
  const envSdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (envSdk && existsSync(envSdk)) {
    const hasPlatforms = existsSync(join(envSdk, 'platforms'));
    return { path: envSdk, hasPlatforms, source: 'ENV' };
  }

  const standardPaths = [
    join(process.env.HOME || '', 'Android', 'Sdk'),
    join(process.env.HOME || '', '.android', 'sdk'),
    '/opt/android-sdk',
    '/usr/lib/android-sdk',
  ];

  for (const p of standardPaths) {
    if (existsSync(p)) {
      const hasPlatforms = existsSync(join(p, 'platforms'));
      return { path: p, hasPlatforms, source: p };
    }
  }
  return null;
}

// ---------------------------------------------------------------- main

console.log(`\nWAIncognito Android Packager — version ${getVersion()}\n`);

// 1. Stage assets
console.log('1. Staging extension assets into Android project...');
try {
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'build.mjs'), '--target=geckoview'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
} catch (e) {
  console.error('\nFailed to stage assets for GeckoView:', e.message);
  process.exit(1);
}

// 2. Validate Gradle Wrapper
const gradlewPath = join(ANDROID_DIR, 'gradlew');
if (!existsSync(gradlewPath)) {
  console.error('\nError: Gradle Wrapper (app/android/gradlew) is missing.');
  console.error('Run `npm run doctor:android` to initialize the wrapper.');
  process.exit(1);
}

// 3. Check JDK
const jdk = detectJdk();
const env = { ...process.env };
if (jdk) {
  console.log(`\n2. JDK: using ${jdk.path} (${jdk.source})`);
  env.JAVA_HOME = jdk.path;
  env.PATH = `${join(jdk.path, 'bin')}:${env.PATH}`;
} else {
  console.log('\n2. JDK: using system default Java');
}

// 4. Check Android SDK
const androidSdk = detectAndroidSdk();
if (androidSdk && androidSdk.hasPlatforms) {
  console.log(`3. Android SDK: located at ${androidSdk.path}`);
  env.ANDROID_HOME = androidSdk.path;
  env.ANDROID_SDK_ROOT = androidSdk.path;
} else if (androidSdk && !androidSdk.hasPlatforms) {
  console.log(`3. Android SDK: located at ${androidSdk.path} (missing platforms directory)`);
  console.log('   (A full Android SDK with platforms/android-35 is required to build the APK)');
} else {
  console.log('3. Android SDK: not detected in standard paths.');
  console.log('   (Ensure ANDROID_HOME is exported, e.g. export ANDROID_HOME=$HOME/Android/Sdk)');
}

if (isCheckOnly) {
  console.log('\nCheck complete.');
  process.exit(0);
}

if (!androidSdk || !androidSdk.hasPlatforms) {
  console.error('\nCannot assemble APK without an Android SDK platform.');
  console.error('Set ANDROID_HOME or install Android SDK platforms:');
  console.error('  sdkmanager "platforms;android-35" "build-tools;35.0.0"');
  process.exit(1);
}

// 5. Run Gradle build
const targetTask = isDebug ? 'assembleDebug' : 'assembleRelease';
console.log(`\n4. Running Gradle ${targetTask}...`);

try {
  execFileSync('./gradlew', [targetTask, '--stacktrace'], {
    cwd: ANDROID_DIR,
    env,
    stdio: 'inherit',
  });
} catch (e) {
  console.error('\nGradle build failed.');
  process.exit(1);
}

// 6. Collect output APK
const variant = isDebug ? 'debug' : 'release';
const apkDir = join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', variant);
if (!existsSync(apkDir)) {
  console.error(`\nError: expected output directory does not exist: ${apkDir}`);
  process.exit(1);
}

const apks = readdirSync(apkDir).filter((f) => f.endsWith('.apk'));
if (!apks.length) {
  console.error('\nNo APK was emitted by the Gradle build.');
  process.exit(1);
}

mkdirSync(OUTDIR, { recursive: true });
const emittedApk = join(apkDir, apks[0]);
const destApkName = `WAIncognito-${getVersion()}-${variant}.apk`;
const destApk = join(OUTDIR, destApkName);

copyFileSync(emittedApk, destApk);

const size = statSync(destApk).size;
const hash = sha256(destApk);

console.log(`\n== Output ==`);
console.log(`  Path:    ${relative(ROOT, destApk)}`);
console.log(`  Size:    ${human(size)}`);
console.log(`  SHA-256: ${hash}\n`);
