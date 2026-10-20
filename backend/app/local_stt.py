"""Private-mode speech-to-text: an adapter over the portable ``local-stt`` module.

The GigaAM implementation itself lives in ``local-stt/gigaam.py`` — one copy,
so facts like the encoder's 5000-frame ceiling and the chunking policy are
learned once and apply everywhere. This module owns only what is specific to
the app: which model directory to use, whether it is usable right now, and why
private mode fell back to Gemini.

``local-stt`` stays standalone and portable; it is loaded by path because its
directory name is not a valid Python package name.
"""

from __future__ import annotations

import importlib.util
import logging
import threading
from pathlib import Path
from types import ModuleType

from . import config

logger = logging.getLogger("suhbatdosh.local_stt")

SAMPLE_RATE = config.LOCAL_STT_SAMPLE_RATE

# Reason the most recent private-mode fallback to Gemini, so callers can surface it.
_last_fallback_reason: str | None = None
_unavailable_reason: str | None = None
_module: ModuleType | None = None
_module_lock = threading.Lock()


def last_fallback_reason() -> str | None:
    """Why the last private-mode transcription fell back to Gemini, if it did."""
    return _last_fallback_reason


def set_fallback_reason(reason: str | None) -> None:
    global _last_fallback_reason
    _last_fallback_reason = reason


def model_dir() -> Path:
    return config.LOCAL_STT_MODEL_DIR


def model_present() -> bool:
    d = model_dir()
    return (d / "model.int8.onnx").is_file() and (d / "tokens.txt").is_file()


def dependency_present() -> bool:
    try:
        import sherpa_onnx  # noqa: F401
    except Exception:
        return False
    return True


def _implementation() -> ModuleType | None:
    """Load ``local-stt/gigaam.py`` by path, or None if it is not there.

    Resolved from config, not from the model directory: weights are relocatable
    but the implementation ships with the repo, and coupling the two made
    private mode silently unavailable under any non-default layout.
    """
    global _module, _unavailable_reason
    if _module is not None:
        return _module
    with _module_lock:
        if _module is not None:
            return _module
        path = Path(config.LOCAL_STT_IMPL_PATH)
        if not path.is_file():
            _unavailable_reason = f"local STT implementation missing at {path}"
            return None
        spec = importlib.util.spec_from_file_location("local_stt_gigaam", path)
        if spec is None or spec.loader is None:
            _unavailable_reason = f"could not load {path}"
            return None
        mod = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(mod)
        except Exception as exc:
            _unavailable_reason = f"failed to import local STT: {exc}"
            return None
        _module = mod
        return _module


def status() -> dict:
    """Describe the local STT backend for the settings endpoint.

    Never raises and never loads the model — it only inspects the dependency,
    the implementation and the weights on disk.
    """
    global _unavailable_reason
    reason: str | None = None
    if not dependency_present():
        reason = "sherpa-onnx is not installed in the backend environment"
    elif not model_present():
        reason = f"local STT model missing at {model_dir()}"
    else:
        _implementation()  # populates _unavailable_reason if it cannot load
        reason = _unavailable_reason
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
    """Warm the model into memory. Safe to call repeatedly; raises if unusable."""
    if not status()["available"]:
        raise RuntimeError(_unavailable_reason or "local STT unavailable")
    mod = _implementation()
    assert mod is not None
    mod.load(model_dir=model_dir(), num_threads=config.LOCAL_STT_THREADS)


def transcribe(path: str | Path) -> dict:
    """Transcribe a recording offline.

    Returns ``{"text", "words", "duration_sec"}`` where each word carries
    ``start``/``end`` on the call's absolute timeline. Raises if the local model
    is unusable — callers decide whether to fall back to Gemini.
    """
    load()
    mod = _implementation()
    assert mod is not None
    out = mod.transcribe_file(path)
    return {
        "text": out["text"],
        "turns": out["turns"],
        "duration_sec": out["duration_sec"],
    }


def transcribe_wav(path: str | Path) -> str:
    """Backwards-compatible flat-text accessor over :func:`transcribe`."""
    return transcribe(path)["text"]