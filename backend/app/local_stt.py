"""In-process offline speech-to-text (private mode).

Thin wrapper over sherpa-onnx running the GigaAM-Multilingual 220M int8 CTC
model that ships read-only in ``local-stt/model``. The model is loaded lazily
and cached for the lifetime of the process, so the backend boots fine on a
machine with neither the dependency nor the weights — :func:`available` simply
reports ``False`` and callers degrade (private mode falls back to Gemini).

The recogniser is not thread-safe for concurrent ``decode_stream`` calls, so
decoding is serialised on a lock.
"""

from __future__ import annotations

import logging
import os
import subprocess
import tempfile
import threading
from pathlib import Path

from . import config

logger = logging.getLogger("suhbatdosh.local_stt")

SAMPLE_RATE = config.LOCAL_STT_SAMPLE_RATE

# OMP oversubscription makes sherpa-onnx slower than single-digit threads here.
os.environ.setdefault("OMP_NUM_THREADS", str(config.LOCAL_STT_THREADS))

_encoder: Path = config.LOCAL_STT_MODEL_DIR / "model.int8.onnx"
_tokens: Path = config.LOCAL_STT_MODEL_DIR / "tokens.txt"

_recognizer = None
_load_lock = threading.Lock()
_infer_lock = threading.Lock()

# Reason the most recent private-mode fallback to Gemini, so callers can surface it.
_last_fallback_reason: str | None = None


def last_fallback_reason() -> str | None:
    """Why the last private-mode transcription fell back to Gemini, if it did."""
    return _last_fallback_reason


def set_fallback_reason(reason: str | None) -> None:
    global _last_fallback_reason
    _last_fallback_reason = reason


# Reason the last availability probe failed, for logs and the settings endpoint.
_unavailable_reason: str | None = None


def model_dir() -> Path:
    return config.LOCAL_STT_MODEL_DIR


def model_present() -> bool:
    return _encoder.is_file() and _tokens.is_file()


def dependency_present() -> bool:
    try:
        import sherpa_onnx  # noqa: F401
    except Exception:
        return False
    return True


def status() -> dict:
    """Describe the local STT backend for the settings endpoint.

    Never raises and never loads the model — it only inspects the dependency
    and the weights on disk.
    """
    global _unavailable_reason
    reason: str | None = None
    if not dependency_present():
        reason = "sherpa-onnx is not installed in the backend environment"
    elif not model_present():
        reason = f"local STT model missing at {config.LOCAL_STT_MODEL_DIR}"
    if reason:
        _unavailable_reason = reason
    return {
        "provider": "local",
        "model": "GigaAM-Multilingual 220M int8",
        "available": reason is None,
        "languages": list(config.LOCAL_STT_LANGUAGES),
    }


def unavailable_reason() -> str | None:
    if _unavailable_reason is None:
        status()
    return _unavailable_reason


def load() -> None:
    """Load the recogniser into memory. Safe to call repeatedly; raises if unusable."""
    global _recognizer, _unavailable_reason
    if _recognizer is not None:
        return
    with _load_lock:
        if _recognizer is not None:
            return
        st = status()
        if not st["available"]:
            raise RuntimeError(_unavailable_reason or "local STT unavailable")
        import sherpa_onnx

        _recognizer = sherpa_onnx.OfflineRecognizer.from_nemo_ctc(
            model=str(_encoder),
            tokens=str(_tokens),
            num_threads=config.LOCAL_STT_THREADS,
            sample_rate=SAMPLE_RATE,
            feature_dim=80,
            decoding_method="greedy_search",
            provider="cpu",
            debug=False,
        )
        _unavailable_reason = None
        logger.info(
            "Local STT loaded from %s (%d threads)", config.LOCAL_STT_MODEL_DIR, config.LOCAL_STT_THREADS
        )


def to_16k_mono(path: str | Path) -> tuple[list, int]:
    """Decode any recording to 16 kHz mono float32, using ffmpeg for compressed formats."""
    import numpy as np
    import soundfile as sf

    path = str(path)
    tmp = None
    if not path.lower().endswith((".wav", ".flac")):
        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
        try:
            subprocess.run(
                ["ffmpeg", "-y", "-v", "error", "-i", path, "-ar", str(SAMPLE_RATE), "-ac", "1", tmp],
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


def transcribe_wav(path: str | Path) -> str:
    """Transcribe a local audio file offline. Returns lowercase text with no punctuation."""
    audio, sr = to_16k_mono(path)
    if sr != SAMPLE_RATE:
        raise RuntimeError(f"expected {SAMPLE_RATE} Hz audio, got {sr} Hz")
    load()
    with _infer_lock:
        stream = _recognizer.create_stream()
        stream.accept_waveform(sr, audio)
        _recognizer.decode_stream(stream)
        return (stream.result.text or "").strip()