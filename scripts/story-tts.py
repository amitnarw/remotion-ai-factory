"""
scripts/story-tts.py — batch voice rendering for storyboard stories.

Runs under the LOCAL KittenTTS venv (no network, HF_HUB_OFFLINE=1):
  C:/Users/Narwal/Desktop/kitten-tts-test/.venv/Scripts/python.exe

Input (argv[1]): a JSON job file:
  { "outDir": "...", "sampleRate": 24000,
    "lines": [ {"id": "beat-0-n", "text": "...", "voice": "expr-voice-5-m",
                "speed": 1.0} ] }

Output: writes <outDir>/<id>.wav for each line + prints a JSON summary of
measured durations to stdout (one line, prefixed "@@"):
  @@ {"durations": {"beat-0-n": 2.31, ...}}
The Node side parses that line to fit scenes to the voice timing.
"""
import json
import os
import sys
import wave

os.environ.setdefault("HF_HUB_OFFLINE", "1")

import soundfile as sf  # noqa: E402
from kittenml import KittenTTS  # noqa: E402


def wav_duration(path: str) -> float:
    with wave.open(path, "rb") as w:
        return w.getnframes() / float(w.getframerate())


def trim_silence(path: str, keep: float = 0.09, max_pause: float = 0.26) -> None:
    """Cut edges + compress internal pauses (KittenTTS pads and breathes long)."""
    import numpy as np  # noqa: PLC0415 — inside function on purpose

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
        # Keep a capped pause before this sample (edges handled by pads).
        keep_n = min(silence, pause_cap if 0 < i < len(mag) - 1 else pad)
        out.append(np.zeros(max(0, keep_n)))
        out.append(audio[i : i + 1])
        silence = 0
    if silence:
        out.append(np.zeros(min(silence, pause_cap)))
    if not out:
        return  # fully silent — leave the original untouched
    trimmed = np.concatenate(out)
    # Safety: never cut more than half the speech content.
    if len(trimmed) > len(audio) * 0.2:
        sf.write(path, trimmed, sr)


def main() -> None:
    job = json.loads(open(sys.argv[1], "r", encoding="utf-8").read())
    out_dir = job["outDir"]
    os.makedirs(out_dir, exist_ok=True)

    model = KittenTTS("KittenML/kitten-tts-2")
    default_voice = "Matthew"
    # available_voices is a property (list) on KittenTTS2.
    try:
        voices = set(model.available_voices or [])
    except Exception:
        voices = set()

    durations = {}
    for line in job["lines"]:
        path = os.path.join(out_dir, f"{line['id']}.wav")
        voice = line.get("voice") or default_voice
        if voices and voice not in voices:
            voice = default_voice
        # Greedy-ish sampling: consistent pacing across takes (timing matters).
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
        print(f"[voice] {line['id']}: {durations[line['id']]}s ({voice})", flush=True)

    print("@@ " + json.dumps({"durations": durations}), flush=True)


if __name__ == "__main__":
    main()