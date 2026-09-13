import asyncio
import ffmpeg
import logging
import tempfile
from pathlib import Path
from google import genai
from google.genai import types

from . import audio, config

logger = logging.getLogger("viacall.transcribe")

TRANSCRIBE_PROMPT = (
    "Transcribe this phone call verbatim. The call may contain English, Russian and Uzbek speech "
    "in any combination. Preserve each utterance in its ORIGINAL language - do NOT translate. "
    "Output only the plain transcript text, one utterance per line. No commentary, no timestamps, "
    "no speaker labels."
)


def _compress_wav(wav_path: Path) -> Path:
    """Convert WAV to low-bitrate MP3 for smaller upload size (~10x smaller). Returns compressed path."""
    compressed = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False)
    compressed.close()
    (
        ffmpeg.input(str(wav_path))
        .output(compressed.name, codec="libmp3lame", ar=16000, ac=1, b="16k")
        .overwrite_output()
        .run(capture_stdout=True, capture_stderr=True)
    )
    return Path(compressed.name)


class Transcriber:
    """REST-based verbatim multilingual transcription for finished recordings."""

    def __init__(self, api_key: str | None = None):
        self._client = genai.Client(api_key=api_key or config.GEMINI_API_KEY)

    async def transcribe_wav(self, wav_path: Path) -> dict:
        """Transcribe a WAV file via a single Gemini generate_content call.

        Returns {"text": str, "language_code": str|None, "segments": [{"text":...}]}.
        """
        compressed = _compress_wav(wav_path)
        try:
            data = compressed.read_bytes()
            resp = await asyncio.wait_for(
                self._client.aio.models.generate_content(
                    model=config.GEMINI_ANALYSIS_MODEL,
                    contents=[
                        types.Part(text=TRANSCRIBE_PROMPT),
                        types.Part(
                            inline_data=types.Blob(
                                data=data,
                                mime_type="audio/mpeg",
                            )
                        ),
                    ],
                ),
                timeout=120,
            )
            text = (resp.text or "").strip()
            lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
            segments = [{"text": ln, "finished": True, "speaker_label": None, "language_code": None} for ln in lines]
            return {"text": text, "language_code": None, "segments": segments}
        finally:
            Path(compressed.name).unlink(missing_ok=True)
