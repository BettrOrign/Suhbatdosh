"""YouTube video download and audio extraction pipeline.

Uses yt-dlp to download audio from YouTube videos, then normalizes
it through the existing audio pipeline (FFmpeg -> WAV + PCM).
"""

import json
import logging
import re
import tempfile
from pathlib import Path

from . import audio, config, db

logger = logging.getLogger("viacall.youtube")

# Regex to extract YouTube video ID from various URL formats
_YT_ID_RE = re.compile(
    r"(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/embed/|youtube\.com/v/|youtube\.com/shorts/)"
    r"([A-Za-z0-9_-]{11})"
)
_YT_ID_SHORT_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


def extract_video_id(url: str) -> str | None:
    """Extract a YouTube video ID from a URL or return the ID if already bare."""
    url = url.strip()
    m = _YT_ID_RE.search(url)
    if m:
        return m.group(1)
    if _YT_ID_SHORT_RE.match(url):
        return url
    return None


def _get_video_info(url: str) -> dict | None:
    """Fetch video metadata without downloading."""
    try:
        import yt_dlp
    except ImportError:
        logger.error("yt-dlp not installed — run: pip install yt-dlp")
        return None

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            return info
    except Exception as e:
        logger.error("Failed to fetch YouTube info for %s: %s", url, e)
        return None


def _download_audio(url: str, output_path: Path) -> bool:
    """Download audio track from a YouTube video as WAV."""
    try:
        import yt_dlp
    except ImportError:
        logger.error("yt-dlp not installed")
        return False

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "format": "bestaudio/best",
        "outtmpl": str(output_path),
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "wav",
                "preferredquality": "192",
            }
        ],
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        return True
    except Exception as e:
        logger.error("Failed to download YouTube audio from %s: %s", url, e)
        return False


def process_youtube_video(
    url: str,
    user_id: int | None = None,
) -> int | None:
    """Download and process a YouTube video through the standard pipeline.

    Returns the call_id on success, None on failure.
    """
    video_id = extract_video_id(url)
    if not video_id:
        logger.error("Invalid YouTube URL: %s", url)
        return None

    # Check whitelist
    info = _get_video_info(url)
    if info is None:
        return None

    channel_id = info.get("channel_id") or info.get("uploader_id")
    channel_name = info.get("channel") or info.get("uploader", "Unknown")
    title = info.get("title", f"youtube_{video_id}")
    duration = info.get("duration")

    if not db.is_youtube_allowed(channel_id=channel_id, url=url):
        logger.warning("YouTube channel %s (%s) not in whitelist", channel_name, channel_id)
        return None

    # Download audio
    with tempfile.TemporaryDirectory() as tmp_dir:
        raw_path = Path(tmp_dir) / f"{video_id}"
        if not _download_audio(url, raw_path):
            return None

        # Find the downloaded file (yt-dlp may add extension)
        candidates = list(Path(tmp_dir).glob(f"{video_id}*"))
        if not candidates:
            logger.error("No audio file found after YouTube download for %s", url)
            return None
        src_path = candidates[0]

        try:
            wav_path, pcm_path = audio.normalize_audio(src_path)
        except Exception as e:
            logger.error("Failed to normalize YouTube audio: %s", e)
            return None

        dur = audio.duration_sec(wav_path)

    source_meta = {
        "youtube_url": url,
        "video_id": video_id,
        "channel_name": channel_name,
        "channel_id": channel_id,
        "title": title,
        "duration": duration,
    }

    call_id = db.create_call(
        name=title,
        audio_path=str(wav_path),
        duration_sec=dur,
        call_type="manager",
        user_id=user_id,
        source_type="youtube",
        source_meta=source_meta,
    )
    db.update_call(call_id, status="queued")
    return call_id
