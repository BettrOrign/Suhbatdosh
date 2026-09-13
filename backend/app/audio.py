import uuid
from pathlib import Path

import ffmpeg

from . import config


def resolve_audio_path(path: str | Path) -> Path | None:
    """Resolve a stored ``audio_path`` to an existing file on disk.

    Handles project relocation: absolute paths recorded in the DB may point at
    the old install directory. When the exact file is missing, falls back to the
    same filename under the current :data:`config.AUDIO_DIR`. Returns ``None``
    when nothing can be found.
    """
    if not path:
        return None
    p = Path(path)
    if not p.is_absolute():
        p = config.AUDIO_DIR / p
    if p.exists():
        return p
    fallback = config.AUDIO_DIR / p.name
    return fallback if fallback.exists() else None


def duration_sec(path: Path) -> float:
    """Return the duration of an audio file in seconds via ffprobe."""
    return float(ffmpeg.probe(str(path))["format"]["duration"])


def normalize_audio(src: Path) -> tuple[Path, Path]:
    """Convert an uploaded file to 16kHz mono WAV (playback) and 16kHz mono raw PCM (transcription).

    Returns (wav_path, pcm_path).
    """
    audio_id = uuid.uuid4().hex[:12]
    wav_path = config.AUDIO_DIR / f"{audio_id}.wav"
    pcm_path = config.PCM_DIR / f"{audio_id}.pcm"

    (
        ffmpeg.input(str(src))
        .output(str(wav_path), ar=16000, ac=1)
        .overwrite_output()
        .run(capture_stdout=True, capture_stderr=True)
    )
    (
        ffmpeg.input(str(wav_path))
        .output(str(pcm_path), f="s16le", acodec="pcm_s16le")
        .overwrite_output()
        .run(capture_stdout=True, capture_stderr=True)
    )
    return wav_path, pcm_path


def pcm_chunks(pcm_path: Path, chunk_ms: int = 100) -> list[bytes]:
    """Read the full PCM file into ~chunk_ms chunks of 16kHz 16-bit mono audio."""
    chunk_bytes = max(16000 * 2 * (chunk_ms // 1000), 1600)
    data = pcm_path.read_bytes()
    return [data[i : i + chunk_bytes] for i in range(0, len(data), chunk_bytes)]
