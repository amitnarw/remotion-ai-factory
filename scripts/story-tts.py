"""
scripts/story-tts.py — batch voice rendering for storyboard stories.

Engine-agnostic: reads a JSON job file and renders with either KittenTTS 2
(default) or VoxCPM2, selected by job["engine"] or --engine.

Runs under the engine's own venv (no network for Kitten; VoxCPM may download
weights on first run). The Python is chosen by src/generator/tts-python.ts:
  TTS_KITTEN_PYTHON / TTS_VOXCPM_PYTHON, else .tts/<engine>/.venv (Setup tab).

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


def trim_silence(path: str, keep: float = 0.09, max_pause: float = 0.42) -> None:
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


def use_all_cores():
    """Torch defaults to half the cores on Windows; Kitten 2 runs ~2.5x faster on all of them."""
    try:
        import torch  # noqa: PLC0415

        torch.set_num_threads(os.cpu_count() or 4)
    except Exception:
        pass


def run_kitten(job, out_dir):
    use_all_cores()
    from kittenml import KittenTTS  # noqa: E402

    import torch
    _dev = "cuda" if torch.cuda.is_available() else "cpu"
    model = KittenTTS("KittenML/kitten-tts-2", device=_dev)
    try:
        voices = set(model.available_voices or [])
    except Exception:
        voices = set()

    durations = {}
    for line in job["lines"]:
        # Optional reproducibility pin: VoxCPM2 itself has no seed parameter,
        # but its sampling uses torch's global RNG, so seeding it (and CUDA)
        # recovers the same timbre when the same job is replayed.
        seed = line.get("seed", job.get("seed"))
        if seed is not None:
            try:
                torch.manual_seed(int(seed))
                if torch.cuda.is_available():
                    torch.cuda.manual_seed_all(int(seed))
            except (ValueError, TypeError):
                pass
        path = os.path.join(out_dir, f"{line['id']}.wav")
        voice = line.get("voice") or KITTEN_DEFAULT_VOICE
        if voices and voice not in voices:
            voice = KITTEN_DEFAULT_VOICE
        if voice in KITTEN_BANNED:
            voice = KITTEN_DEFAULT_VOICE
        # Greedy decoding (temperature 0.1, top_k 1) sounded flat and rushed.
        # Light sampling keeps the preset voice but adds natural variation.
        audio = model.generate(line["text"], voice=voice, temperature=0.6, top_k=30)
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



def apply_voice_transform(wav, sr, tr):
    """Apply a lightweight pitch/tempo/shape transform to a synthesised clip.
    Graceful: any failure returns the original clip."""
    if not isinstance(tr, dict):
        return wav
    try:
        import numpy as np
        import librosa
        semitones = float(tr.get("semitones") or 0.0)
        tempo = float(tr.get("tempo") or 1.0)
        if abs(semitones) > 0.05:
            wav = librosa.effects.pitch_shift(wav, sr=sr, n_steps=semitones)
        if abs(tempo - 1.0) > 0.01:
            wav = librosa.effects.time_stretch(wav, rate=tempo)
        sat = float(tr.get("saturation") or 0.0)
        if sat > 0.0:
            wav = np.tanh(wav * (1.0 + sat)) / (1.0 + sat)
        return wav
    except Exception as e:
        print(f"[voice-transform] {str(e)[:160]}", flush=True)
        return wav


def run_voxcpm(job, out_dir):
    use_all_cores()
    try:
        from voxcpm import VoxCPM  # noqa: E402
    except Exception as e:
        raise RuntimeError(
            "VoxCPM2 is not installed in this Python env. "
            "Run: pip install voxcpm   (Python 3.10-3.12, torch>=2.5, CUDA>=12) "
            f"Original error: {e}"
        )

    import torch
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False, device=device)
    sr = model.tts_model.sample_rate
    default_desc = job.get("defaultVoiceDesc")
    default_ref = job.get("defaultReferenceWav") or job.get("default_reference_wav")
    default_style = job.get("defaultStyle") or job.get("default_style")
    cfg_value = float(job.get("cfgValue", job.get("cfg_value", 2.0)))
    timesteps = int(job.get("inferenceTimesteps", job.get("inference_timesteps", 20)))
    if timesteps < 4:
        timesteps = 4
    if timesteps > 30:
        timesteps = 30
    default_ref_text = job.get("defaultReferenceText") or job.get("default_reference_text")
    retry_threshold = float(job.get("retryBadcaseRatioThreshold", job.get("retry_badcase_ratio_threshold", 8.0)))
    if retry_threshold < 4.0:
        retry_threshold = 4.0
    if retry_threshold > 12.0:
        retry_threshold = 12.0

    durations = {}
    for line in job["lines"]:
        # Optional reproducibility pin: VoxCPM2 itself has no seed parameter,
        # but its sampling uses torch's global RNG, so seeding it (and CUDA)
        # recovers the same timbre when the same job is replayed.
        seed = line.get("seed", job.get("seed"))
        if seed is not None:
            try:
                torch.manual_seed(int(seed))
                if torch.cuda.is_available():
                    torch.cuda.manual_seed_all(int(seed))
            except (ValueError, TypeError):
                pass
        path = os.path.join(out_dir, f"{line['id']}.wav")
        text = line["text"]
        ref = line.get("referenceWav") or line.get("reference_wav") or default_ref
        ref_text = line.get("referenceText") or line.get("reference_text") or default_ref_text
        style = line.get("voiceStyle") or line.get("style") or default_style
        si = ""
        if style and isinstance(style, str) and style.strip():
            si = style.strip()
            if not si.startswith("("):
                si = f"({si})"
        target_text = f"{si}{text}" if si else text
        if ref and ref_text and isinstance(ref_text, str) and ref_text.strip():
            prompt_text = ref_text.strip() + " "
            wav = model.generate(
                text=prompt_text + target_text,
                prompt_wav_path=ref,
                prompt_text=prompt_text,
                reference_wav_path=ref,
                cfg_value=cfg_value,
                inference_timesteps=timesteps,
                normalize=True,
                denoise=False,
                retry_badcase=True,
                retry_badcase_max_times=3,
                retry_badcase_ratio_threshold=retry_threshold,
            )
        elif ref:
            wav = model.generate(
                text=target_text,
                reference_wav_path=ref,
                cfg_value=cfg_value,
                inference_timesteps=timesteps,
                normalize=True,
                denoise=False,
                retry_badcase=True,
                retry_badcase_max_times=3,
                retry_badcase_ratio_threshold=retry_threshold,
            )
        else:
            desc = line.get("voiceDesc") or line.get("voice")
            if desc and isinstance(desc, str) and " " in desc and not desc.startswith("("):
                desc = f"({desc})"
            if desc and isinstance(desc, str) and desc.startswith("("):
                text = f"{desc}{text}"
            elif default_desc:
                text = f"{default_desc}{text}"

            wav = model.generate(
                text=text,
                cfg_value=cfg_value,
                inference_timesteps=timesteps,
                normalize=True,
                denoise=False,
                retry_badcase=True,
                retry_badcase_max_times=3,
                retry_badcase_ratio_threshold=retry_threshold,
            )
        # Per-voice transforms (semitones / tempo / saturation). Applied in-memory
        # before trimming and caching so every consumer sees the finished clip.
        line_transform = line.get("voiceTransform") or line.get("voice_transform")
        if line_transform is None:
            line_transform = job.get("defaultVoiceTransform") or job.get("default_voice_transform")
        if line_transform:
            wav = apply_voice_transform(wav, sr, line_transform)
        if os.path.exists(path):
            os.remove(path)
        sf.write(path, wav, sr)
        try:
            trim_silence(path, keep=0.08, max_pause=0.60)
        except Exception:
            pass
        durations[line["id"]] = round(wav_duration(path), 3)
        print(f"[voice/voxcpm] {line['id']}: {durations[line['id']]}s", flush=True)
    return durations, sr


def worker_kitten() -> None:
    """Keep the model loaded and synthesize lines as they arrive on stdin.

    Protocol (one JSON object per line, written by src/generator/tts.ts):
      request  {"id": "b3-n2", "text": "...", "voice": "Bruno", "outDir": "..."}
      response @@ {"ok": true, "id": "...", "dur": 4.123, "wav": "..."}  (file written)
      or       @@ {"ok": false, "id": "...", "error": "..."}             (line failed; worker stays)
    The loop exits on {"op": "quit"} or when stdin closes.

    """
    import time  # noqa: PLC0415

    use_all_cores()
    from kittenml import KittenTTS  # noqa: E402

    t0 = time.time()
    try:
        import torch
        _dev = "cuda" if torch.cuda.is_available() else "cpu"
        model = KittenTTS("KittenML/kitten-tts-2", device=_dev)
    except Exception as e:  # a load failure is fatal: the Node side falls back to the batch path
        print("@@ " + json.dumps({"ok": False, "id": None, "error": f"model load failed: {str(e)[:300]}"}), flush=True)
        raise
    try:
        voices = set(model.available_voices or [])
    except Exception:
        voices = set()
    print(f"[voice/worker] kitten ready in {time.time() - t0:.1f}s", flush=True)

    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            req = json.loads(raw)
        except Exception as e:
            print("@@ " + json.dumps({"ok": False, "id": None, "error": f"bad request line: {str(e)[:120]}"}), flush=True)
            continue
        if req.get("op") == "quit":
            break
        lid = str(req.get("id") or "line")
        text = str(req.get("text") or "")
        voice = req.get("voice") or KITTEN_DEFAULT_VOICE
        if voices and voice not in voices:
            voice = KITTEN_DEFAULT_VOICE
        if voice in KITTEN_BANNED:
            voice = KITTEN_DEFAULT_VOICE
        out_dir = req.get("outDir") or "."
        os.makedirs(out_dir, exist_ok=True)
        path = os.path.join(out_dir, f"{lid}.wav")
        try:
            t1 = time.time()
            audio = model.generate(text, voice=voice, temperature=0.6, top_k=30)
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
            dur = round(wav_duration(path), 3)
            print(f"[voice/kitten] {lid}: {dur}s ({voice}) in {time.time() - t1:.1f}s", flush=True)
            print("@@ " + json.dumps({"ok": True, "id": lid, "dur": dur, "wav": os.path.abspath(path), "voice": voice}), flush=True)
        except Exception as e:
            print("@@ " + json.dumps({"ok": False, "id": lid, "error": str(e)[:300]}), flush=True)


def worker_voxcpm() -> None:
    """Keep VoxCPM2 loaded and synthesize lines as they arrive on stdin."""

    import time  # noqa: PLC0415
    import json
    import os
    import sys

    import torch

    try:
        from voxcpm import VoxCPM  # noqa: E402
    except Exception as e:  # pragma: no cover - load failure
        print("@@ " + json.dumps({"ok": False, "id": None, "error": f"voxcpm import failed: {str(e)[:300]}"}), flush=True)
        raise

    t0 = time.time()
    try:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False, device=device)
        sr = model.tts_model.sample_rate
    except Exception as e:
        print("@@ " + json.dumps({"ok": False, "id": None, "error": f"model load failed: {str(e)[:300]}"}), flush=True)
        raise

    def trim_silence_local(path):
        try:
            trim_silence(path, keep=0.08, max_pause=0.60)
        except Exception:
            pass

    print(f"[voice/worker] voxcpm ready in {time.time() - t0:.1f}s", flush=True)

    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            req = json.loads(raw)
        except Exception as e:
            print("@@ " + json.dumps({"ok": False, "id": None, "error": f"bad request line: {str(e)[:120]}"}), flush=True)
            continue
        if req.get("op") == "quit":
            break

        lid = str(req.get("id") or "line")
        text = str(req.get("text") or "")
        out_dir = req.get("outDir") or "."
        os.makedirs(out_dir, exist_ok=True)
        path = os.path.join(out_dir, f"{lid}.wav")

        ref = req.get("referenceWav") or req.get("reference_wav")
        ref_text = req.get("referenceText") or req.get("reference_text")
        style = req.get("voiceStyle") or req.get("style")
        voice_desc = req.get("voiceDesc") or req.get("voice")
        default_desc = req.get("defaultVoiceDesc") or req.get("default_desc")
        default_ref = req.get("defaultReferenceWav") or req.get("default_reference_wav")
        default_ref_text = req.get("defaultReferenceText") or req.get("default_reference_text")
        default_style = req.get("defaultStyle") or req.get("default_style")
        ref = ref or default_ref
        ref_text = ref_text or default_ref_text
        style = style or default_style

        seed = req.get("seed")
        if seed is not None:
            try:
                torch.manual_seed(int(seed))
                if torch.cuda.is_available():
                    torch.cuda.manual_seed_all(int(seed))
            except (ValueError, TypeError):
                pass
        cfg_value = float(req.get("cfgValue", req.get("cfg_value", 2.0)))
        timesteps = int(req.get("inferenceTimesteps", req.get("inference_timesteps", 20)))
        if timesteps < 4:
            timesteps = 4
        if timesteps > 30:
            timesteps = 30
        retry_threshold = float(req.get("retryBadcaseRatioThreshold", req.get("retry_badcase_ratio_threshold", 8.0)))
        if retry_threshold < 4.0:
            retry_threshold = 4.0
        if retry_threshold > 12.0:
            retry_threshold = 12.0

        si = ""
        if style and isinstance(style, str) and style.strip():
            si = style.strip()
            if not si.startswith("("):
                si = f"({si})"
        target_text = f"{si}{text}" if si else text

        try:
            t1 = time.time()
            if ref and ref_text and isinstance(ref_text, str) and ref_text.strip():
                prompt_text = ref_text.strip() + " "
                wav = model.generate(
                    text=prompt_text + target_text,
                    prompt_wav_path=ref,
                    prompt_text=prompt_text,
                    reference_wav_path=ref,
                    cfg_value=cfg_value,
                    inference_timesteps=timesteps,
                    normalize=True,
                    denoise=False,
                    retry_badcase=True,
                    retry_badcase_max_times=3,
                    retry_badcase_ratio_threshold=retry_threshold,
                )
            elif ref:
                wav = model.generate(
                    text=target_text,
                    reference_wav_path=ref,
                    cfg_value=cfg_value,
                    inference_timesteps=timesteps,
                    normalize=True,
                    denoise=False,
                    retry_badcase=True,
                    retry_badcase_max_times=3,
                    retry_badcase_ratio_threshold=retry_threshold,
                )
            else:
                desc = voice_desc or default_desc
                gtext = text
                if desc and isinstance(desc, str) and " " in desc and not desc.startswith("("):
                    desc = f"({desc})"
                if desc and isinstance(desc, str) and desc.startswith("("):
                    gtext = f"{desc}{text}"
                elif default_desc:
                    gtext = f"{default_desc}{text}"
                wav = model.generate(
                    text=gtext,
                    cfg_value=cfg_value,
                    inference_timesteps=timesteps,
                    normalize=True,
                    denoise=False,
                    retry_badcase=True,
                    retry_badcase_max_times=3,
                    retry_badcase_ratio_threshold=retry_threshold,
                )

            line_transform = req.get("voiceTransform") or req.get("voice_transform")
            if line_transform is None:
                line_transform = req.get("defaultVoiceTransform") or req.get("default_voice_transform")
            if line_transform:
                wav = apply_voice_transform(wav, sr, line_transform)
            if os.path.exists(path):
                os.remove(path)
            try:
                import soundfile as sfm
                sfm.write(path, wav, sr)
            except Exception as e:
                raise RuntimeError(f"soundfile write failed: {e}")
            trim_silence_local(path)
            dur = round(wav_duration(path), 3)
            print(f"[voice/voxcpm] {lid}: {dur}s in {time.time() - t1:.1f}s", flush=True)
            print("@@ " + json.dumps({"ok": True, "id": lid, "dur": dur, "wav": os.path.abspath(path)}), flush=True)
        except Exception as e:
            print("@@ " + json.dumps({"ok": False, "id": lid, "error": str(e)[:300]}), flush=True)



def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("job", nargs="?", default=None, help="path to job JSON")
    parser.add_argument("--engine", choices=["kitten2", "voxcpm2"], default=None)
    parser.add_argument(
        "--worker",
        action="store_true",
        help="keep the engine loaded for the whole process and read one JSON line per utterance from stdin (kitten2). The Node side keeps one worker per server session; a line then costs only its generation time.",
    )
    args = parser.parse_args()

    engine = args.engine or "kitten2"

    if args.worker:
        if engine == "kitten2":
            worker_kitten()
            return
        if engine == "voxcpm2":
            worker_voxcpm()
            return
        raise SystemExit("--worker is only implemented for kitten2 and voxcpm2")

    if not args.job:
        parser.error("a job JSON file is required without --worker")
    job = json.loads(open(args.job, "r", encoding="utf-8").read())
    out_dir = job["outDir"]
    os.makedirs(out_dir, exist_ok=True)

    if engine == "voxcpm2":
        durations, sr = run_voxcpm(job, out_dir)
    else:
        durations, sr = run_kitten(job, out_dir)

    print("@@ " + json.dumps({"durations": durations, "engine": engine, "sampleRate": sr}), flush=True)


if __name__ == "__main__":
    main()
