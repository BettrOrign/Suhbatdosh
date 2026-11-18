import array
import json
import math
import uuid
import wave
from pathlib import Path

import ffmpeg

from . import config

_FRAME_MS = 100
_SILENCE_RMS = 220.0
_SPEECH_RMS = 320.0


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


def _rms(samples: array.array) -> float:
    if not samples:
        return 0.0
    total = sum(s * s for s in samples)
    return math.sqrt(total / len(samples))


def _analyze_mono_pcm(raw_bytes: bytes, sample_rate: int = 16000) -> dict:
    """Compute silence / dead-air metrics from 16-bit signed mono PCM bytes."""
    samples = array.array("h")
    n_bytes = len(raw_bytes) - (len(raw_bytes) % 2)
    samples.frombytes(raw_bytes[:n_bytes])
    frame_samples = max(1, int(sample_rate * (_FRAME_MS / 1000.0)))
    frame_sec = frame_samples / float(sample_rate)
    total_sec = round(len(samples) / float(sample_rate), 2)
    if total_sec <= 0:
        return {
            "channels": 1,
            "total_sec": 0.0,
            "silence_sec": 0.0,
            "silence_ratio": 0.0,
            "longest_silence_sec": 0.0,
            "dead_air_count": 0,
            "interruption_count": 0,
            "talk_over_sec": 0.0,
        }

    silent_run = 0.0
    silence_sec = 0.0
    longest_silence_sec = 0.0
    dead_air_count = 0

    for idx in range(0, len(samples), frame_samples):
        chunk = samples[idx : idx + frame_samples]
        if _rms(chunk) < _SILENCE_RMS:
            silent_run += frame_sec
        else:
            if silent_run >= 1.0:
                silence_sec += silent_run
                if silent_run > longest_silence_sec:
                    longest_silence_sec = silent_run
            if silent_run >= 3.0:
                dead_air_count += 1
            silent_run = 0.0

    if silent_run >= 1.0:
        silence_sec += silent_run
        if silent_run > longest_silence_sec:
            longest_silence_sec = silent_run
    if silent_run >= 3.0:
        dead_air_count += 1

    return {
        "channels": 1,
        "total_sec": total_sec,
        "silence_sec": round(silence_sec, 2),
        "silence_ratio": round(min(1.0, silence_sec / total_sec), 3),
        "longest_silence_sec": round(longest_silence_sec, 2),
        "dead_air_count": dead_air_count,
        "interruption_count": 0,
        "talk_over_sec": 0.0,
    }


def _analyze_stereo_pcm(raw_bytes: bytes, sample_rate: int = 16000) -> dict:
    """Compute 2-channel diarization, talk-over, and dead-air metrics from stereo s16le PCM."""
    samples = array.array("h")
    n_bytes = len(raw_bytes) - (len(raw_bytes) % 4)
    samples.frombytes(raw_bytes[:n_bytes])
    left = samples[0::2]
    right = samples[1::2]
    base = _analyze_mono_pcm(
        array.array("h", ((l // 2 + r // 2) for l, r in zip(left, right))).tobytes(),
        sample_rate=sample_rate,
    )
    frame_samples = max(1, int(sample_rate * (_FRAME_MS / 1000.0)))
    frame_sec = frame_samples / float(sample_rate)

    rep_talk_sec = 0.0
    client_talk_sec = 0.0
    overlap_run = 0.0
    talk_over_sec = 0.0
    interruption_count = 0
    stereo_turns: list[dict] = []
    cur_speaker: str | None = None
    cur_start = 0.0

    n_frames = len(left) // frame_samples
    for f_idx in range(n_frames):
        offset = f_idx * frame_samples
        t_now = round(f_idx * frame_sec, 2)
        l_rms = _rms(left[offset : offset + frame_samples])
        r_rms = _rms(right[offset : offset + frame_samples])
        l_active = l_rms >= _SPEECH_RMS
        r_active = r_rms >= _SPEECH_RMS

        if l_active:
            rep_talk_sec += frame_sec
        if r_active:
            client_talk_sec += frame_sec

        if l_active and r_active:
            overlap_run += frame_sec
        else:
            if overlap_run >= 0.4:
                interruption_count += 1
                talk_over_sec += overlap_run
            overlap_run = 0.0

        dom: str | None = None
        if l_active and l_rms >= r_rms * 1.15:
            dom = "Sotuvchi"
        elif r_active and r_rms > l_rms * 1.15:
            dom = "Mijoz"

        if dom != cur_speaker:
            if cur_speaker is not None and (t_now - cur_start) >= 0.3:
                stereo_turns.append(
                    {"speaker": cur_speaker, "start": round(cur_start, 2), "end": t_now}
                )
            cur_speaker = dom
            cur_start = t_now

    if overlap_run >= 0.4:
        interruption_count += 1
        talk_over_sec += overlap_run
    end_sec = round(n_frames * frame_sec, 2)
    if cur_speaker is not None and (end_sec - cur_start) >= 0.3:
        stereo_turns.append({"speaker": cur_speaker, "start": round(cur_start, 2), "end": end_sec})

    total_speech = rep_talk_sec + client_talk_sec
    base.update(
        {
            "channels": 2,
            "rep_talk_sec": round(rep_talk_sec, 2),
            "client_talk_sec": round(client_talk_sec, 2),
            "rep_share_acoustics": round(rep_talk_sec / total_speech, 3) if total_speech > 0 else None,
            "interruption_count": interruption_count,
            "talk_over_sec": round(talk_over_sec, 2),
            "stereo_turns": stereo_turns[:200],
        }
    )
    return base


def compute_acoustics(wav_path: Path, src_path: Path | None = None) -> dict:
    """Return acoustic telemetry for ``wav_path`` (and stereo ``src_path`` if 2-channel).

    Caches results in ``<wav_path>.acoustics.json`` so subsequent reads are instant.
    """
    sidecar = wav_path.with_suffix(".acoustics.json")
    if sidecar.exists():
        try:
            return json.loads(sidecar.read_text(encoding="utf-8"))
        except Exception:
            pass

    result: dict = {}
    if src_path and src_path.exists():
        if src_path.suffix.lower() == ".wav":
            try:
                with wave.open(str(src_path), "rb") as wf:
                    sr = wf.getframerate() or 16000
                    ch = wf.getnchannels()
                    raw = wf.readframes(wf.getnframes())
                if ch >= 2:
                    result = _analyze_stereo_pcm(raw, sample_rate=sr)
            except Exception:
                result = {}
        if not result:
            try:
                probe = ffmpeg.probe(str(src_path))
                streams = [s for s in probe.get("streams", []) if s.get("codec_type") == "audio"]
                channels = int(streams[0].get("channels", 1)) if streams else 1
                if channels >= 2:
                    out, _ = (
                        ffmpeg.input(str(src_path))
                        .output("pipe:", format="s16le", acodec="pcm_s16le", ar=16000, ac=2)
                        .run(capture_stdout=True, capture_stderr=True)
                    )
                    result = _analyze_stereo_pcm(out, sample_rate=16000)
            except Exception:
                result = {}

    if not result and wav_path.exists():
        try:
            with wave.open(str(wav_path), "rb") as wf:
                sr = wf.getframerate() or 16000
                ch = wf.getnchannels()
                raw = wf.readframes(wf.getnframes())
            if ch >= 2:
                result = _analyze_stereo_pcm(raw, sample_rate=sr)
            else:
                result = _analyze_mono_pcm(raw, sample_rate=sr)
        except Exception:
            result = {}

    if result:
        try:
            sidecar.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
        except Exception:
            pass
    return result


def assign_stereo_speakers(segments: list[dict], acoustics: dict) -> list[dict]:
    """Enrich timed ``segments`` with ``speaker_label`` from 2-channel ``stereo_turns``."""
    turns = acoustics.get("stereo_turns") or []
    if not turns or not segments:
        return segments
    enriched = []
    for seg in segments:
        s_copy = dict(seg)
        start = s_copy.get("start")
        end = s_copy.get("end")
        if not s_copy.get("speaker_label") and start is not None and end is not None:
            rep_overlap = 0.0
            cli_overlap = 0.0
            for t in turns:
                ov = min(float(end), float(t["end"])) - max(float(start), float(t["start"]))
                if ov > 0:
                    if t["speaker"] == "Sotuvchi":
                        rep_overlap += ov
                    else:
                        cli_overlap += ov
            if rep_overlap > 0 or cli_overlap > 0:
                s_copy["speaker_label"] = "Sotuvchi" if rep_overlap >= cli_overlap else "Mijoz"
        enriched.append(s_copy)
    return enriched


def normalize_audio(src: Path) -> tuple[Path, Path]:
    """Convert an uploaded file to 16kHz mono WAV (playback) and 16kHz mono raw PCM (transcription).

    Also precomputes stereo/mono acoustic metrics before stereo channels are downmixed.
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
    compute_acoustics(wav_path, src_path=src)
    return wav_path, pcm_path


def purge_expired_audio(days: int, org_id: int | None = None) -> int:
    """Delete recordings older than ``days`` (Settings → auto-delete).

    Transcripts and analyses are kept; only the WAV (and its PCM cache) is
    removed and ``calls.audio_path`` is NULLed so the UI stops offering a
    player for a file that no longer exists. Returns how many were purged.
    """
    from . import db

    removed = 0
    for row in db.expired_audio(days, org_id=org_id):
        wav = resolve_audio_path(row["audio_path"])
        if wav is not None:
            wav.unlink(missing_ok=True)
            wav.with_suffix(".acoustics.json").unlink(missing_ok=True)
            Path(config.PCM_DIR / f"{Path(row['audio_path']).stem}.pcm").unlink(
                missing_ok=True
            )
        db.clear_audio(row["id"])
        removed += 1
    return removed
