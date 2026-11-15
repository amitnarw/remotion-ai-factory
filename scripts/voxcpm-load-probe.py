"""Measure VoxCPM2 load peak on this machine and optionally synthesize one line.

Run with the VoxCPM venv:
  .tts\\voxcpm2\\.venv\\Scripts\\python.exe scripts\\voxcpm-load-probe.py --mode bf16

--mode legacy : current behaviour (fp32 construction, then cast to bf16)
--mode bf16   : construct directly in bf16 (the proposed change)
"""
import argparse
import ctypes
import ctypes.wintypes as wt
import hashlib
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_TEXT = (
    "In the heart of the forest, where sunlight barely reaches the ground, "
    "a hidden world begins to stir."
)
DEFAULT_REF = os.path.join(ROOT, "public", "voice", "references",
                           "character-child-boy-8", "reference.wav")


class PMC_EX(ctypes.Structure):
    _fields_ = [
        ("cb", wt.DWORD), ("PageFaultCount", wt.DWORD),
        ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t),
        ("PrivateUsage", ctypes.c_size_t),
    ]


def peaks():
    """(peak working set GB, peak commit GB) for this process — Windows only."""
    c = PMC_EX()
    c.cb = ctypes.sizeof(PMC_EX)
    ok = ctypes.windll.psapi.GetProcessMemoryInfo(
        ctypes.windll.kernel32.GetCurrentProcess(), ctypes.byref(c), c.cb)
    if not ok:
        return (0.0, 0.0)
    return (c.PeakWorkingSetSize / 1024**3, c.PeakPagefileUsage / 1024**3)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["legacy", "bf16"], default="bf16")
    ap.add_argument("--synth", default=None, help="write this WAV path")
    ap.add_argument("--seed", type=int, default=1234)
    ap.add_argument("--text", default=DEFAULT_TEXT)
    ap.add_argument("--ref", default=DEFAULT_REF)
    args = ap.parse_args()

    if args.synth:
        os.makedirs(os.path.dirname(os.path.abspath(args.synth)), exist_ok=True)

    import torch
    if args.mode == "bf16":
        torch.set_default_dtype(torch.bfloat16)

    from voxcpm import VoxCPM

    device = "cuda" if torch.cuda.is_available() else "cpu"
    t0 = time.time()
    model = VoxCPM.from_pretrained(
        "openbmb/VoxCPM2", load_denoiser=False, device=device,
        local_files_only=True,
    )
    load_s = time.time() - t0
    ws, commit = peaks()
    print(f"[probe] mode={args.mode} loaded in {load_s:.1f}s device={device} "
          f"dtype={model.tts_model.config.dtype}")
    print(f"[probe] after load: peak working set {ws:.2f} GB, peak commit {commit:.2f} GB")

    if args.synth:
        torch.manual_seed(args.seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(args.seed)
        wav = model.generate(
            text=args.text,
            reference_wav_path=args.ref,
            cfg_value=2.0,
            inference_timesteps=20,
            normalize=True,
            denoise=False,
            retry_badcase=True,
            retry_badcase_max_times=3,
            retry_badcase_ratio_threshold=8.0,
        )
        import soundfile as sf
        sf.write(args.synth, wav, model.tts_model.sample_rate)
        with open(args.synth, "rb") as fh:
            print("[probe] sha256", hashlib.sha256(fh.read()).hexdigest(), args.synth)
        ws, commit = peaks()
        print(f"[probe] after synth: peak working set {ws:.2f} GB, peak commit {commit:.2f} GB")


if __name__ == "__main__":
    main()
