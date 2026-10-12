"""GigaAM offline speech-to-text core.

Thin wrapper over sherpa-onnx that loads the model once and transcribes
16 kHz mono audio. Languages: Uzbek, Russian, English, Kazakh, Kyrgyz.
"""

from __future__ import annotations

import os
import subprocess
import tempfile
import threading
from pathlib import Path

MODEL_DIR = Path(__file__).resolve().parent / "model"
SAMPLE_RATE = 16000

os.environ.setdefault("OMP_NUM_THREADS", "8")

_recognizer = None
_lock = threading.Lock()


def load(model_dir: Path | None = None, num_threads: int = 8) -> None:
    """Load the model into memory. Safe to call repeatedly."""
    global _recognizer
    with _lock:
        if _recognizer is not None:
            return
        import sherpa_onnx

        d = Path(model_dir or MODEL_DIR)
        encoder, tokens = d / "model.int8.onnx", d / "tokens.txt"
        for p in (encoder, tokens):
            if not p.exists():
                raise FileNotFoundError(
                    f"missing {p.name} in {d} — the model folder is incomplete"
                )
        _recognizer = sherpa_onnx.OfflineRecognizer.from_nemo_ctc(
            model=str(encoder),
            tokens=str(tokens),
            num_threads=num_threads,
            sample_rate=SAMPLE_RATE,
            feature_dim=80,
            decoding_method="greedy_search",
            provider="cpu",
            debug=False,
        )


def to_16k_mono(path: str | Path) -> "tuple[list, int]":
    """Decode any audio file to a 16 kHz mono float32 array.

    Uses ffmpeg for compressed formats so callers can hand over an .ogg /
    .mp3 / .m4a / .mp4 recording directly.
    """
    import numpy as np
    import soundfile as sf

    path = str(path)
    tmp = None
    if not path.lower().endswith((".wav", ".flac")):
        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
        try:
            subprocess.run(
                ["ffmpeg", "-y", "-v", "error", "-i", path,
                 "-ar", str(SAMPLE_RATE), "-ac", "1", tmp],
                check=True,
            )
            path = tmp
        except (subprocess.CalledProcessError, FileNotFoundError) as exc:
            raise RuntimeError(f"could not decode audio: {exc}") from exc

    try:
        audio, sr = sf.read(path, dtype="float32")
    finally:
        if tmp:
            try:
                os.unlink(tmp)
            except OSError:
                pass

    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    return np.ascontiguousarray(audio), sr


def transcribe_array(audio, sr: int) -> str:
    """Transcribe a mono float32 array. Returns lowercase text (no punctuation)."""
    load()
    stream = _recognizer.create_stream()
    stream.accept_waveform(sr, audio)
    _recognizer.decode_stream(stream)
    return stream.result.text.strip()


def transcribe_file(path: str | Path) -> dict:
    """Transcribe any audio file. Returns dict with text, duration and timing."""
    audio, sr = to_16k_mono(path)
    duration = len(audio) / sr

    import time

    started = time.perf_counter()
    text = transcribe_array(audio, sr)
    elapsed = time.perf_counter() - started

    return {
        "text": text,
        "duration_sec": round(duration, 2),
        "process_sec": round(elapsed, 2),
        "rtf": round(elapsed / duration, 3) if duration else None,
        "language": "uz/ru (auto, model is multilingual)",
        "model": "GigaAM-Multilingual 220M int8",
    }