#!/usr/bin/env python3
"""
scripts/voice-pace-test.py — measure what pace a cloned VoxCPM2 narrator actually speaks.

Phase 1: generate 5 candidate reference clips (8-10 s each) for narrator-bbc-calm,
each from a description that varies only pace. Measure each candidate's actual wps
from its known text and measured duration.

Phase 2: keep the 3 candidates nearest 3.2-3.5 wps. For each, clone the same 8
test lines (one sentence each, 8-12 words) and measure output wps, F0 spread, and
max/min pair duration ratio.

Writes output/voice-pace/report.json and prints a table.

Usage:
  .tts/voxcpm2/.venv/Scripts/python.exe scripts/voice-pace-test.py
"""
import json
import os
import sys
import wave
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "output" / "voice-pace"
REF_DIR = OUT / "references"
CLONE_DIR = OUT / "clones"

# 8 test lines, one sentence each, 8-12 words, varied structure.
TEST_LINES = [
    "Every head on the street turns smooth and shiny.",
    "Hats become relics, piled in dusty shop windows.",
    "Barbershops close their doors for the very last time.",
    "Children run their palms across bare scalps in wonder.",
    "The sun burns harder on skin that never felt it.",
    "Wigs become priceless museum pieces behind glass.",
    "No one combs their hair anymore, not even once.",
    "A bald world is just the beginning of the change.",
]

# 5 candidate reference descriptions, pace only, 8-10 s target (~26-32 words).
REF_CANDIDATES = [
    {
        "id": "ref-measured",
        "desc": "middle-aged British man, calm measured mid-low baritone, unhurried pacing with pauses, documentary narration",
        "text": "What if every person lost their hair at once? It starts with a question no one dared to ask. The answer changes everything about how we see ourselves.",
    },
    {
        "id": "ref-brisk",
        "desc": "middle-aged British man, clear articulate baritone, brisk energetic pacing, crisp delivery, modern explainer narration",
        "text": "Imagine a world where nobody has hair. Every head is smooth and shiny. The change happens overnight, without warning or explanation.",
    },
    {
        "id": "ref-fast",
        "desc": "middle-aged British man, confident baritone, fast-paced energetic delivery, rapid but clear, dynamic explainer narration",
        "text": "Everyone goes bald in a single night. No more haircuts, no more shampoo, no more bad hair days ever again.",
    },
    {
        "id": "ref-conversational",
        "desc": "middle-aged British man, warm baritone, natural conversational pacing, clear articulate delivery, friendly explainer tone",
        "text": "What happens when all hair disappears? The streets fill with smooth shiny heads. Life continues, just differently than before.",
    },
    {
        "id": "ref-urgent",
        "desc": "middle-aged British man, firm baritone, urgent crisp pacing, rapid delivery, important announcement tone",
        "text": "The change is here. Every person wakes up bald. No explanation, no warning, just smooth heads everywhere you look.",
    },
]

SAMPLE_RATE = 48000
CFG = 2.0
TIMESTEPS = 20

device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"[pace-test] device: {device}")


def load_model():
    from voxcpm import VoxCPM
    return VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False, device=device)


def wav_duration(path: str) -> float:
    with wave.open(path, "rb") as w:
        return w.getnframes() / float(w.getframerate())


def count_words(text: str) -> int:
    return len([w for w in text.split() if w.strip()])


def f0_stats(wav_path: str):
    """Median F0 and F0 spread (Hz) via autocorrelation on 30 ms frames."""
    import librosa  # noqa: PLC0415

    y, sr = sf.read(wav_path)
    if y.ndim > 1:
        y = y.mean(axis=1)
    y = y.astype(np.float32)
    # Trim silence
    nontrim = np.where(np.abs(y) > 1e-4)[0]
    if len(nontrim) == 0:
        return None
    y = y[nontrim[0]:nontrim[-1] + 1]
    if len(y) < sr * 0.1:
        return None
    f0, voiced_flag, voiced_probs = librosa.pyin(
        y, fmin=50, fmax=400, sr=sr, frame_length=2048, hop_length=512,
    )
    voiced = f0[voiced_flag] if voiced_flag is not None else f0
    voiced = voiced[~np.isnan(voiced)]
    if len(voiced) < 5:
        return None
    return {
        "median_f0": float(np.median(voiced)),
        "f0_spread": float(np.percentile(voiced, 95) - np.percentile(voiced, 5)),
        "voiced_share": float(len(voiced) / len(f0)),
    }


def generate_ref(model, cand, out_path):
    desc = cand["desc"]
    text = cand["text"]
    desc_text = f"({desc}) {text}"
    wav = model.generate(
        text=desc_text,
        cfg_value=CFG,
        inference_timesteps=TIMESTEPS,
        normalize=True,
        denoise=False,
        retry_badcase=True,
        retry_badcase_max_times=3,
        retry_badcase_ratio_threshold=8.0,
    )
    sf.write(str(out_path), np.asarray(wav), SAMPLE_RATE)
    return wav_duration(str(out_path))


def clone_line(model, ref_wav, text, out_path):
    wav = model.generate(
        text=text,
        reference_wav_path=str(ref_wav),
        cfg_value=CFG,
        inference_timesteps=TIMESTEPS,
        normalize=True,
        denoise=False,
        retry_badcase=True,
        retry_badcase_max_times=3,
        retry_badcase_ratio_threshold=8.0,
    )
    sf.write(str(out_path), np.asarray(wav), SAMPLE_RATE)
    return wav_duration(str(out_path))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    REF_DIR.mkdir(parents=True, exist_ok=True)
    CLONE_DIR.mkdir(parents=True, exist_ok=True)

    model = load_model()
    print("[pace-test] model loaded")

    # ---- Phase 1: candidate references ----
    results = []
    for cand in REF_CANDIDATES:
        out_path = REF_DIR / f"{cand['id']}.wav"
        dur = generate_ref(model, cand, out_path)
        n_words = count_words(cand["text"])
        wps = n_words / dur if dur > 0 else 0
        stats = f0_stats(str(out_path))
        results.append({
            "id": cand["id"],
            "desc": cand["desc"],
            "duration": dur,
            "words": n_words,
            "wps": round(wps, 3),
            "target_wps": 3.3,
            "distance": round(abs(wps - 3.3), 3),
            **({} if stats is None else stats),
        })
        print(f"[pace-test] {cand['id']}: {dur:.2f}s, {n_words} words, {wps:.2f} wps"
              + (f", F0 median {stats['median_f0']:.0f} Hz, spread {stats['f0_spread']:.0f} Hz" if stats else ""))

    # Keep 3 nearest 3.2-3.5 wps
    results.sort(key=lambda r: r["distance"])
    top3 = results[:3]
    print(f"\n[pace-test] top 3 references: {[r['id'] for r in top3]}")

    # ---- Phase 2: clone test lines with each top reference ----
    clone_results = []
    for ref in top3:
        ref_wav = REF_DIR / f"{ref['id']}.wav"
        line_results = []
        for i, line in enumerate(TEST_LINES):
            out_path = CLONE_DIR / f"{ref['id']}-{i:02d}.wav"
            dur = clone_line(model, ref_wav, line, out_path)
            n_words = count_words(line)
            wps = n_words / dur if dur > 0 else 0
            stats = f0_stats(str(out_path))
            line_results.append({
                "line_id": f"t{i}",
                "text": line,
                "duration": dur,
                "words": n_words,
                "wps": round(wps, 3),
                **({} if stats is None else stats),
            })
        # Aggregate
        wps_values = [lr["wps"] for lr in line_results]
        f0_values = [lr.get("median_f0", 0) for lr in line_results if lr.get("median_f0")]
        durations = [lr["duration"] for lr in line_results]
        clone_results.append({
            "reference_id": ref["id"],
            "reference_wps": ref["wps"],
            "mean_wps": round(np.mean(wps_values), 3),
            "min_wps": round(min(wps_values), 3),
            "max_wps": round(max(wps_values), 3),
            "median_f0": round(float(np.median(f0_values)), 1) if f0_values else None,
            "f0_spread": round(float(np.percentile(f0_values, 95) - np.percentile(f0_values, 5)), 1) if f0_values else None,
            "max_min_dur_ratio": round(max(durations) / min(durations), 2) if durations else None,
            "lines": line_results,
        })

    report = {
        "phase1_references": results,
        "phase2_clones": clone_results,
        "recommended": clone_results[0]["reference_id"] if clone_results else None,
    }
    report_path = OUT / "report.json"
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)

    # Print table
    print("\n=== Phase 1: Reference candidates ===")
    print(f"{'id':<20} {'dur(s)':<8} {'words':<7} {'wps':<7} {'dist':<7} {'F0med':<7} {'F0spr':<7}")
    for r in results:
        print(f"{r['id']:<20} {r['duration']:<8.2f} {r['words']:<7} {r['wps']:<7.2f} {r['distance']:<7.2f}"
              f" {r.get('median_f0', 0):<7.0f} {r.get('f0_spread', 0):<7.0f}")

    print("\n=== Phase 2: Cloned lines (top 3 references) ===")
    print(f"{'ref':<20} {'mean_wps':<10} {'min_wps':<10} {'max_wps':<10} {'F0med':<7} {'F0spr':<7} {'dur_ratio':<9}")
    for c in clone_results:
        print(f"{c['reference_id']:<20} {c['mean_wps']:<10.2f} {c['min_wps']:<10.2f} {c['max_wps']:<10.2f}"
              f" {c.get('median_f0', 0) or 0:<7.0f} {c.get('f0_spread', 0) or 0:<7.0f} {c.get('max_min_dur_ratio', 0) or 0:<9.2f}")

    print(f"\n[pace-test] report written to {report_path}")


if __name__ == "__main__":
    main()
