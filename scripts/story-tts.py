"""
scripts/story-tts.py — batch voice rendering for storyboard stories.

Engine-agnostic: reads a JSON job file and renders with either KittenTTS 2
(default) or VoxCPM2, selected by job["engine"] or --engine.

Runs under the matching local venv (no network for Kitten; VoxCPM may download
weights on first run):
  Kitten:  C:/Users/Narwal/Desktop/kitten-tts-test/.venv/Scripts/python.exe
  VoxCPM:  <set TTS_VOXCPM_PYTHON or install voxcpm in any venv>

Input (argv[1]): a JSON job file:
  { "engine": "kitten2" | "voxcpm2",
    "outDir": "...", "sampleRate": 24000,
    "defaultVoiceDesc": "(calm male narrator)",
    "lines": [ {"id": "beat-0-n", "text": "...", "voice": "expr-voice-5-m",
                "voiceDesc": "(warm female narrator)", "speed": 1.0} ] }

For KittenTTS:  "voice" is a preset voice id (e.g. "Bruno"); missing/unknown
falls back to "Matthew".
For VoxCPM2:    "voiceDesc" (or "voice" if it looks like a description) is
prepended in parentheses for voice design; otherwise a plain generate is used.

Output: writes <outDir>/<id>.wav for each line + prints a JSON summary of
measured durations to stdout (one line, prefixed "@@"):
  @@ {"durations": {"beat-0-n": 2.31, ...}, "engine": "kitten2"}
"""
import argparse
import json
import os
import sys
import wave

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("PYTHONUTF8", "1")
os.environ.setdefault("PYTHONIOENCODING", "utf-8")

import builtins as _builtins
_orig_open = _builtins.open
def _utf8_open(file, mode="r", *a, **kw):
    if "b" not in mode and "encoding" not in kw:
        kw["encoding"] = "utf-8"
    return _orig_open(file, mode, *a, **kw)
_builtins.open = _utf8_open

import soundfile as sf  # noqa: E402


def wav_duration(path: str) -> float:
    with wave.open(path, "rb") as w:
        return w.getnframes() / float(w.getframerate())


def trim_silence(path: str, keep: float = 0.09, max_pause: float = 0.26) -> None:
    """Cut edges + compress internal pauses (KittenTTS pads and breathes long)."""
    import numpy as np  # noqa: PLC0415

    audio, sr = sf.read(path)
    mag = np.abs(audio.astype("float64"))
    thresh = max(mag.max() * 0.006, 1e-4)
    pad = int(keep * sr)
    pause_cap = int(max_pause * sr)

    out = []
    silence = 0
    for i, m in enumerate(mag):
        if m < thresh:
            silence += 1
            continue
        keep_n = min(silence, pause_cap if 0 < i < len(mag) - 1 else pad)
        out.append(np.zeros(max(0, keep_n)))
        out.append(audio[i : i + 1])
        silence = 0
    if silence:
        out.append(np.zeros(min(silence, pause_cap)))
    if not out:
        return
    trimmed = np.concatenate(out)
    if len(trimmed) > len(audio) * 0.2:
        sf.write(path, trimmed, sr)


KITTEN_DEFAULT_VOICE = "Matthew"
KITTEN_BANNED = {"Bella"}


def run_kitten(job, out_dir):
    from kittenml import KittenTTS  # noqa: E402

    model = KittenTTS("KittenML/kitten-tts-2")
    try:
        voices = set(model.available_voices or [])
    except Exception:
        voices = set()

    durations = {}
    for line in job["lines"]:
        path = os.path.join(out_dir, f"{line['id']}.wav")
        voice = line.get("voice") or KITTEN_DEFAULT_VOICE
        if voices and voice not in voices:
            voice = KITTEN_DEFAULT_VOICE
        if voice in KITTEN_BANNED:
            voice = KITTEN_DEFAULT_VOICE
        audio = model.generate(line["text"], voice=voice, temperature=0.1, top_k=1)
        if os.path.exists(path):
            os.remove(path)
        for attempt in range(3):
            try:
                sf.write(path, audio, model.sample_rate)
                break
            except Exception:
                if attempt == 2:
                    raise
        trim_silence(path)
        durations[line["id"]] = round(wav_duration(path), 3)
        print(f"[voice/kitten] {line['id']}: {durations[line['id']]}s ({voice})", flush=True)
    return durations, model.sample_rate


def run_voxcpm(job, out_dir):
    try:
        from voxcpm import VoxCPM  # noqa: E402
    except Exception as e:
        raise RuntimeError(
            "VoxCPM2 is not installed in this Python env. "
            "Run: pip install voxcpm   (Python 3.10-3.12, torch>=2.5, CUDA>=12) "
            f"Original error: {e}"
        )

    model = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False)
    sr = model.tts_model.sample_rate
    default_desc = job.get("defaultVoiceDesc")

    durations = {}
    for line in job["lines"]:
        path = os.path.join(out_dir, f"{line['id']}.wav")
        text = line["text"]
        desc = line.get("voiceDesc") or line.get("voice")
        if desc and isinstance(desc, str) and " " in desc and not desc.startswith("("):
            desc = f"({desc})"
        if desc and isinstance(desc, str) and desc.startswith("("):
            text = f"{desc}{text}"
        elif default_desc:
            text = f"{default_desc}{text}"

        wav = model.generate(text=text, cfg_value=2.0, inference_timesteps=10)
        if os.path.exists(path):
            os.remove(path)
        sf.write(path, wav, sr)
        durations[line["id"]] = round(wav_duration(path), 3)
        print(f"[voice/voxcpm] {line['id']}: {durations[line['id']]}s", flush=True)
    return durations, sr


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("job", help="path to job JSON")
    parser.add_argument("--engine", choices=["kitten2", "voxcpm2"], default=None)
    args = parser.parse_args()

    job = json.loads(open(args.job, "r", encoding="utf-8").read())
    out_dir = job["outDir"]
    os.makedirs(out_dir, exist_ok=True)

    engine = args.engine or job.get("engine") or "kitten2"

    if engine == "voxcpm2":
        durations, sr = run_voxcpm(job, out_dir)
    else:
        durations, sr = run_kitten(job, out_dir)

    print("@@ " + json.dumps({"durations": durations, "engine": engine, "sampleRate": sr}), flush=True)


if __name__ == "__main__":
    main()
