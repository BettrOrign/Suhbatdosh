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

# The CTC encoder tops out at 5000 frames; at 25 frames/sec that is 200s.
# Stay well under it and overlap slightly so words straddling a boundary are
# still heard whole by at least one window.
CHUNK_SECONDS = 90
CHUNK_SAMPLES = int(CHUNK_SECONDS * SAMPLE_RATE)
CHUNK_OVERLAP_SECONDS = 3
CHUNK_OVERLAP_SAMPLES = int(CHUNK_OVERLAP_SECONDS * SAMPLE_RATE)

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
    """Decode any audio file to 16 kHz mono float32.

    ffmpeg does the work for every format, including wav/flac, because the
    recognizer is built for exactly SAMPLE_RATE. Returning a WAV's native
    rate instead crashes the encoder's positional-embedding lookup on
    narrowband phone audio (8 kHz is common for Zadarma recordings).
    """
    import numpy as np
    import soundfile as sf

    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-i", str(path),
             "-ar", str(SAMPLE_RATE), "-ac", "1", "-acodec", "pcm_s16le", tmp],
            check=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise RuntimeError(f"could not decode audio: {exc}") from exc

    try:
        audio, sr = sf.read(tmp, dtype="float32")
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass

    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    assert sr == SAMPLE_RATE, f"resample failed: got {sr}Hz"
    return np.ascontiguousarray(audio), sr


def _decode_chunk(audio, sr: int, offset: float = 0.0) -> tuple[str, list[dict]]:
    """Transcribe one chunk that fits the encoder's frame budget.

    The CTC head emits one token per character, and its timestamps are noisy
    (zero-length spans). Text is rebuilt by joining tokens exactly; turn
    boundaries come from :func:`speech_regions` on the waveform instead, which
    is far more reliable than character timings.
    """
    stream = _recognizer.create_stream()
    stream.accept_waveform(sr, audio)
    _recognizer.decode_stream(stream)

    res = stream.result
    tokens = list(getattr(res, "tokens", None) or [])
    stamps = list(getattr(res, "timestamps", None) or [])

    # A token is one character; the raw text is their exact concatenation.
    text = "".join(tokens)

    chars = []
    for i, tok in enumerate(tokens):
        start = float(stamps[i]) + offset if i < len(stamps) else offset
        chars.append({"start": round(start, 2), "text": tok})

    return text.strip(), chars


def speech_regions(audio, sr: int, min_silence: float = 0.55,
                   min_speech: float = 0.25) -> list[tuple[float, float]]:
    """Locate speech spans by frame energy. Returns [(start_sec, end_sec), ...].

    Energy-based silence detection is used instead of the CTC head's character
    timestamps, which are too coarse to separate two people talking.
    """
    import numpy as np

    if len(audio) == 0:
        return []

    frame = max(1, int(0.02 * sr))          # 20 ms frames
    n_frames = len(audio) // frame
    if n_frames == 0:
        return []

    usable = audio[:n_frames * frame]
    if usable.ndim > 1:
        usable = usable.mean(axis=1)

    frames = usable.reshape(n_frames, frame)
    energy = np.sqrt((frames.astype("float64") ** 2).mean(axis=1))

    if energy.max() <= 1e-8:
        return []

    # Threshold sits between the quiet and loud levels. Both arms scale off the
    # observed range so a recording with no dynamic range (a continuous voice,
    # no silences at all) stays fully voiced instead of falling under its own
    # floor.
    noise = np.percentile(energy, 10)
    peak = np.percentile(energy, 95)
    threshold = max(peak * 0.15, noise * 0.5, 1e-6)

    voiced = energy > threshold
    min_silence_frames = max(1, int(min_silence / 0.02))
    min_speech_frames = max(1, int(min_speech / 0.02))

    regions: list[tuple[float, float]] = []
    start: int | None = None
    silence = 0

    for i, is_voiced in enumerate(voiced):
        if is_voiced:
            if start is None:
                start = i
            silence = 0
        elif start is not None:
            silence += 1
            if silence >= min_silence_frames:
                end = i - silence + 1
                if end - start >= min_speech_frames:
                    regions.append((start * 0.02, end * 0.02))
                start = None
                silence = 0

    if start is not None and n_frames - start >= min_speech_frames:
        regions.append((start * 0.02, n_frames * 0.02))

    return regions


def _assign_chars_to_regions(chars: list[dict],
                             regions: list[tuple[float, float]]) -> list[dict]:
    """Bucket characters into speech regions to produce timed turns."""
    if not regions:
        if not chars:
            return []
        return [{"start": round(chars[0]["start"], 2),
                 "end": round(chars[-1]["start"], 2),
                 "text": "".join(c["text"] for c in chars)}]

    turns = []
    for start, end in regions:
        bucket = [c for c in chars if start <= c["start"] < end]
        if not bucket:
            continue
        turns.append({
            "start": round(start, 2),
            "end": round(end, 2),
            "text": "".join(c["text"] for c in bucket).strip(),
        })
    return turns


def _join_chunks(chunks: list[tuple[str, list[dict]]]) -> tuple[str, list[dict]]:
    """Merge chunk results, dropping the character overlap at chunk seams.

    Chunks overlap by CHUNK_OVERLAP_SECONDS, so the tail of one chunk repeats
    the head of the next. Timestamps identify the seam precisely, so words are
    kept from whichever side carries them further.
    """
    text_parts: list[str] = []
    chars: list[dict] = []
    seen_until = -1.0

    for chunk_text, chunk_chars in chunks:
        text_parts.append(chunk_text)
        for c in chunk_chars:
            if c["start"] < seen_until - 0.03:
                continue
            chars.append(c)
            seen_until = c["start"]

    return " ".join(t for t in text_parts if t).strip(), chars


def transcribe_array(audio, sr: int, progress=None, decode=None) -> dict:
    """Transcribe mono float32 audio, chunking to stay inside the encoder limit.

    The CTC encoder has a hard ceiling of 5000 frames (~200s at 25 frames/sec)
    and full self-attention beyond it is O(n^2) in memory. Longer audio must be
    split or it fails outright, which is every real phone call.

    ``decode`` accepts and returns ``(text, chars)``; it exists so the chunking
    and stitching above can be exercised without loading the model.
    """
    if decode is None:
        load()
        decode = lambda piece, off: _decode_chunk(piece, sr, offset=off)

    total = len(audio)
    if total == 0:
        return {"text": "", "turns": [], "duration_sec": 0.0}

    if total <= CHUNK_SAMPLES:
        text, chars = decode(audio, 0.0)
    else:
        step = CHUNK_SAMPLES - CHUNK_OVERLAP_SAMPLES
        chunks = []
        for start in range(0, total, step):
            piece = audio[start:start + CHUNK_SAMPLES]
            if len(piece) == 0:
                break
            chunks.append(decode(piece, start / sr))
            if progress:
                progress(min(start + len(piece), total), total)
            if start + CHUNK_SAMPLES >= total:
                break
        text, chars = _join_chunks(chunks)

    regions = speech_regions(audio, sr)
    turns = _assign_chars_to_regions(chars, regions)

    return {
        "text": text,
        "turns": turns,
        "duration_sec": round(total / sr, 2),
    }


def transcribe_file(path: str | Path, progress=None) -> dict:
    """Transcribe any audio file. Returns text, timed turns and duration."""
    import time

    audio, sr = to_16k_mono(path)
    started = time.perf_counter()
    out = transcribe_array(audio, sr, progress=progress)
    elapsed = time.perf_counter() - started
    duration = out["duration_sec"]

    return {
        **out,
        "process_sec": round(elapsed, 2),
        "rtf": round(elapsed / duration, 3) if duration else None,
        "chunks": max(1, -(-len(audio) // CHUNK_SAMPLES)),
        "language": "uz/ru (auto, model is multilingual)",
        "model": "GigaAM-Multilingual 220M int8",
    }
