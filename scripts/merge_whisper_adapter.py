"""
Merge the SAC PEFT LoRA (openai/whisper-small) into a Hugging Face checkpoint,
then convert it to ggml for whisper.rn.

Usage:
  python scripts/merge_whisper_adapter.py tmp/whisper-adapter assets/whisper/ggml-sac-whisper.bin
"""

from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path


CONVERT_URL = (
    "https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/models/convert-h5-to-ggml.py"
)
MEL_URL = (
    "https://raw.githubusercontent.com/openai/whisper/main/whisper/assets/mel_filters.npz"
)


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"[whisper:merge] downloading {url}")
    urllib.request.urlretrieve(url, dest)


def main() -> int:
    if len(sys.argv) < 3:
        print("Usage: merge_whisper_adapter.py <adapter_dir> <ggml_out>")
        return 1

    adapter_dir = Path(sys.argv[1]).resolve()
    ggml_out = Path(sys.argv[2]).resolve()
    root = Path(__file__).resolve().parents[1]
    work = root / "tmp" / "whisper-merge"
    merged_dir = work / "merged"
    whisper_repo = work / "openai-whisper"
    convert_py = work / "convert-h5-to-ggml.py"

    cfg = json.loads((adapter_dir / "adapter_config.json").read_text(encoding="utf-8"))
    base_name = cfg.get("base_model_name_or_path") or "openai/whisper-small"
    print(f"[whisper:merge] base model {base_name}")

    from peft import PeftModel
    from transformers import WhisperForConditionalGeneration, WhisperProcessor

    print("[whisper:merge] loading base + adapter")
    model = WhisperForConditionalGeneration.from_pretrained(base_name)
    model = PeftModel.from_pretrained(model, str(adapter_dir))
    merged = model.merge_and_unload()

    merged_dir.mkdir(parents=True, exist_ok=True)
    merged.save_pretrained(merged_dir)
    WhisperProcessor.from_pretrained(base_name).save_pretrained(merged_dir)

    if not convert_py.exists():
        download(CONVERT_URL, convert_py)
    mel = whisper_repo / "whisper" / "assets" / "mel_filters.npz"
    if not mel.exists():
        download(MEL_URL, mel)

    print("[whisper:merge] converting Hugging Face checkpoint to ggml")
    import subprocess

    subprocess.check_call(
        [sys.executable, str(convert_py), str(merged_dir), str(whisper_repo), str(work)],
        cwd=str(work),
    )

    produced = work / "ggml-model.bin"
    if not produced.exists():
        produced = work / "ggml-model-f32.bin"
    if not produced.exists():
        raise FileNotFoundError("convert-h5-to-ggml.py did not write ggml-model.bin")

    ggml_out.parent.mkdir(parents=True, exist_ok=True)
    ggml_out.write_bytes(produced.read_bytes())
    print(f"[whisper:merge] wrote {ggml_out} ({ggml_out.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
