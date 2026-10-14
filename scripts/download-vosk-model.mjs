/**
 * Downloads vosk-model-small-en-us-0.15 (~40 MB, Apache 2.0) into the local
 * sac-vosk Android assets folder so EAS / Gradle can package it.
 *
 * English-only. The model is 16 kHz; the app upsamples continuous BLE 8 kHz
 * PCM before feeding Vosk (one warm recognizer — never restarted per packet).
 *
 * https://alphacephei.com/vosk/models
 */
import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL_URL = 'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip';
const ROOT = path.resolve(__dirname, '..');
const ASSETS_DIR = path.join(
  ROOT,
  'modules',
  'sac-vosk',
  'android',
  'src',
  'main',
  'assets',
  'model-en-us',
);
const ZIP_PATH = path.join(ROOT, 'tmp', 'vosk-model-small-en-us-0.15.zip');
const EXTRACT_DIR = path.join(ROOT, 'tmp', 'vosk-extract');
const MARKER = path.join(ASSETS_DIR, 'am', 'final.mdl');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const file = fs.createWriteStream(dest);
    const get = (target) => {
      https
        .get(target, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            get(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Download failed: HTTP ${res.statusCode}`));
            return;
          }
          res.pipe(file);
          file.on('finish', () => file.close(() => resolve()));
        })
        .on('error', reject);
    };
    get(url);
  });
}

function hasPowershellExpand() {
  try {
    execFileSync('powershell', ['-NoProfile', '-Command', 'exit 0'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function unzip(zipPath, outDir) {
  fs.mkdirSync(outDir, { recursive: true });

  if (process.platform === 'win32' && hasPowershellExpand()) {
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${outDir.replace(/'/g, "''")}' -Force`,
      ],
      { stdio: 'inherit' },
    );
    return;
  }

  // EAS Linux builders: .zip is not a tar archive — use unzip or Python.
  const attempts = [
    () => execFileSync('unzip', ['-o', zipPath, '-d', outDir], { stdio: 'inherit' }),
    () =>
      execFileSync('python3', ['-m', 'zipfile', '-e', zipPath, outDir], { stdio: 'inherit' }),
    () => execFileSync('busybox', ['unzip', '-o', zipPath, '-d', outDir], { stdio: 'inherit' }),
  ];

  let lastError;
  for (const attempt of attempts) {
    try {
      attempt();
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error(`Failed to extract ${zipPath}`);
}

async function main() {
  if (fs.existsSync(MARKER) && fs.existsSync(path.join(ASSETS_DIR, 'uuid'))) {
    console.log('[vosk:model] Model already present at', ASSETS_DIR);
    return;
  }

  console.log('[vosk:model] Downloading', MODEL_URL);
  await download(MODEL_URL, ZIP_PATH);

  console.log('[vosk:model] Extracting…');
  fs.rmSync(EXTRACT_DIR, { recursive: true, force: true });
  unzip(ZIP_PATH, EXTRACT_DIR);

  const extractedRoot = fs
    .readdirSync(EXTRACT_DIR, { withFileTypes: true })
    .find((d) => d.isDirectory() && d.name.startsWith('vosk-model'));
  if (!extractedRoot) {
    throw new Error('Extracted archive did not contain a vosk-model* folder');
  }

  const source = path.join(EXTRACT_DIR, extractedRoot.name);
  fs.rmSync(ASSETS_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(ASSETS_DIR), { recursive: true });
  fs.cpSync(source, ASSETS_DIR, { recursive: true });
  fs.writeFileSync(path.join(ASSETS_DIR, 'uuid'), `${randomUUID()}\n`, 'utf8');

  console.log('[vosk:model] Installed to', ASSETS_DIR);
}

main().catch((err) => {
  console.error('[vosk:model]', err);
  process.exit(1);
});
