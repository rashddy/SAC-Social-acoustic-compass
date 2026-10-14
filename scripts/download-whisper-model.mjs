/**
 * Prepares Whisper for the compass BLE path.
 *
 * The shared Drive folder is a PEFT LoRA on openai/whisper-small, not a ggml
 * file. whisper.rn can only load ggml, so this script:
 *   1. Downloads the official whisper-small q5_1 ggml (phone fallback)
 *   2. Downloads the SAC adapter from Google Drive
 *   3. Merges adapter → ggml when Python + torch/peft/transformers are present
 *
 * https://drive.google.com/drive/folders/1wfbrZSnh2PvSsBDqufMeTUXUOMxnxra1
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ASSETS_DIR = path.join(ROOT, 'assets', 'whisper');
const ADAPTER_DIR = path.join(ROOT, 'tmp', 'whisper-adapter');
const GGML_PATH = path.join(ASSETS_DIR, 'ggml-small.en-q5_1.bin');
const MERGED_PATH = path.join(ASSETS_DIR, 'ggml-sac-whisper.bin');

const GGML_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en-q5_1.bin';
const GGML_FALLBACK_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en-q5_1.bin';

/** Public files from whisper-stt-output-latest. */
const DRIVE_FILES = {
  'adapter_config.json': '1b7rkOmGR-OrKac1Xy3330cUbU0tkf--E',
  'adapter_model.safetensors': '1Vwz278pl0MNIFcutLFMkTeYnsBH0_2Wd',
  'preprocessor_config.json': '1aCU6UVx60J8dvF_6RrC64Ww1nY85QkBV',
  'processor_config.json': '1DppV-tN7Auk-RIFDHhW8petzScnftC15',
  'tokenizer_config.json': '1XG7WgJyxZdk8O3o1ucm4SPTylG7hjql_',
  'tokenizer.json': '1sq5h-8P1q244bfjq2gsx-UqLFkj_yJ3J',
  'training_args.bin': '1uCbrkfKsGauX4b-b0AXmQpxIn3wpyykj',
};

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
            file.close();
            fs.rmSync(dest, { force: true });
            reject(new Error(`Download failed: HTTP ${res.statusCode} for ${target}`));
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

async function downloadDriveFile(id, dest) {
  const url = `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
  await download(url, dest);
  const head = fs.readFileSync(dest, { encoding: 'utf8' }).slice(0, 80);
  if (head.includes('<html') || head.includes('Google Drive')) {
    throw new Error(`Drive returned HTML instead of a file for ${path.basename(dest)}`);
  }
}

function findPython() {
  for (const cmd of ['python', 'python3', 'py']) {
    try {
      const args = cmd === 'py' ? ['-3', '--version'] : ['--version'];
      execFileSync(cmd, args, { stdio: 'ignore' });
      return cmd === 'py' ? ['py', '-3'] : [cmd];
    } catch {
      /* keep looking */
    }
  }
  return null;
}

function canMerge(python) {
  try {
    execFileSync(
      python[0],
      [...python.slice(1), '-c', 'import torch, transformers, peft'],
      { stdio: 'ignore' },
    );
    return true;
  } catch {
    return false;
  }
}

async function ensureOfficialGgml() {
  if (fs.existsSync(GGML_PATH) && fs.statSync(GGML_PATH).size > 1_000_000) {
    console.log('[whisper:model] Official ggml already present at', GGML_PATH);
    return;
  }
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  console.log('[whisper:model] Downloading', GGML_URL);
  try {
    await download(GGML_URL, GGML_PATH);
  } catch (error) {
    console.warn('[whisper:model] Primary ggml failed, trying English-only fallback', error);
    await download(GGML_FALLBACK_URL, GGML_PATH);
  }
  console.log('[whisper:model] Saved', GGML_PATH);
}

async function ensureAdapter() {
  const marker = path.join(ADAPTER_DIR, 'adapter_config.json');
  if (fs.existsSync(marker) && fs.existsSync(path.join(ADAPTER_DIR, 'adapter_model.safetensors'))) {
    console.log('[whisper:model] SAC adapter already present at', ADAPTER_DIR);
    return;
  }
  fs.mkdirSync(ADAPTER_DIR, { recursive: true });
  for (const [name, id] of Object.entries(DRIVE_FILES)) {
    const dest = path.join(ADAPTER_DIR, name);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) continue;
    console.log('[whisper:model] Downloading Drive file', name);
    await downloadDriveFile(id, dest);
  }
}

function mergeAdapter() {
  if (process.env.EAS_BUILD) {
    console.log('[whisper:model] Skipping LoRA merge on EAS (too heavy).');
    return;
  }
  if (fs.existsSync(MERGED_PATH) && fs.statSync(MERGED_PATH).size > 1_000_000) {
    console.log('[whisper:model] Merged ggml already present at', MERGED_PATH);
    return;
  }

  const python = findPython();
  if (!python) {
    console.log('[whisper:model] Python not found. Official whisper-small ggml will be used.');
    console.log('[whisper:model] To bake in the SAC LoRA: install Python, then');
    console.log('  pip install torch transformers peft numpy');
    console.log('  npm run whisper:model');
    return;
  }
  if (!canMerge(python)) {
    console.log('[whisper:model] Python is missing torch/transformers/peft. Official ggml will be used.');
    console.log('[whisper:model] Install them, then re-run npm run whisper:model to merge the SAC adapter.');
    return;
  }

  const script = path.join(__dirname, 'merge_whisper_adapter.py');
  console.log('[whisper:model] Merging SAC LoRA into whisper-small ggml…');
  execFileSync(python[0], [...python.slice(1), script, ADAPTER_DIR, MERGED_PATH], {
    stdio: 'inherit',
    cwd: ROOT,
  });
}

async function main() {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  await ensureOfficialGgml();
  await ensureAdapter();
  mergeAdapter();
  console.log('[whisper:model] Done. Rebuild the dev client so whisper.rn is linked.');
}

main().catch((err) => {
  console.error('[whisper:model]', err);
  process.exit(1);
});
