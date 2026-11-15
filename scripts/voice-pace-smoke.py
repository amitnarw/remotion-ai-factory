#!/usr/bin/env python3
"""Minimal VoxCPM2 smoke test: load model, generate one short line, measure duration."""
import sys, wave, time
from pathlib import Path
import numpy as np
import soundfile as sf
import torch

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "output" / "voice-pace-smoke"
OUT.mkdir(parents=True, exist_ok=True)

device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"[smoke] device: {device}", flush=True)

t0 = time.time()
from voxcpm import VoxCPM
model = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False, device=device)
print(f"[smoke] model loaded in {time.time()-t0:.1f}s", flush=True)

text = "What if every person lost their hair at once?"
t1 = time.time()
wav = model.generate(
    text=text,
    cfg_value=2.0,
    inference_timesteps=20,
    normalize=True,
    denoise=False,
    retry_badcase=True,
    retry_badcase_max_times=3,
    retry_badcase_ratio_threshold=8.0,
)
gen_time = time.time() - t1

out_path = OUT / "smoke-test.wav"
sf.write(str(out_path), np.asarray(wav), 48000)

with wave.open(str(out_path), "rb") as w:
    dur = w.getnframes() / float(w.getframerate())

n_words = len(text.split())
print(f"[smoke] generated {dur:.2f}s audio in {gen_time:.1f}s", flush=True)
print(f"[smoke] {n_words} words, {n_words/dur:.2f} wps", flush=True)
print(f"[smoke] wrote {out_path}", flush=True)
