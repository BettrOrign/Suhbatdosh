import asyncio
import ffmpeg
import logging
import tempfile
from pathlib import Path
from google import genai
from google.genai import types

from . import audio, config, db, local_stt

logger = logging.getLogger("suhbatdosh.transcribe")

# bot_settings key holding "online" | "private". Default online.
MODE_SETTING_KEY = "processing_mode"
MODE_ONLINE = "online"
MODE_PRIVATE = "private"
VALID_MODES = (MODE_ONLINE, MODE_PRIVATE)

TRANSCRIBE_PROMPT = (
    "Transcribe this phone call verbatim. The call may contain English, Russian and Uzbek speech "
    "in any combination. Preserve each utterance in its ORIGINAL language - do NOT translate. "
    "Output only the plain transcript text, one utterance per line. No commentary, no timestamps, "
    "no speaker labels."
)


def _transcribe_prompt(org_id: int = 1) -> str:
    """TRANSCRIBE_PROMPT adjusted by the Settings feature flags."""
    prompt = TRANSCRIBE_PROMPT
    if not db.get_flag("punctuation", org_id=org_id):
        prompt += " Do not add punctuation - write the words as they were spoken."
    if db.get_flag("speaker_labels", org_id=org_id):
        prompt += (
            " Prefix each line with the speaker: 'Sotuvchi:' for the staff member "
            "or 'Mijoz:' for the caller."
        )
    return prompt


def get_mode(org_id: int = 1) -> str:
    """Return the configured processing mode, defaulting to ``online``."""
    try:
        mode = (db.get_bot_setting(MODE_SETTING_KEY, "", org_id=org_id) or "").strip().lower()
    except Exception as exc:  # DB not initialised yet (e.g. very early boot)
        logger.warning("Could not read processing mode, defaulting to online: %s", exc)
        return MODE_ONLINE
    return mode if mode in VALID_MODES else MODE_ONLINE


class LocalSttUnavailable(RuntimeError):
    """Raised when private mode is selected but local STT cannot be used."""


async def _local_transcribe(wav_path: Path) -> dict:
    """Offline transcription via the in-process GigaAM model.

    Runs the blocking sherpa-onnx decode in a worker thread so the caller's
    ``asyncio.wait_for`` timeout can actually fire.

    Raises :class:`LocalSttUnavailable` (never anything the caller must decode
    beyond "fall back to Gemini") when the model or dependency is missing.
    """
    try:
        result = await asyncio.to_thread(local_stt.transcribe, wav_path)
    except (RuntimeError, OSError, ImportError) as exc:
        raise LocalSttUnavailable(str(exc)) from exc

    text = result.get("text") or ""
    turns = result.get("turns") or []
    segments = [
        {
            "text": t["text"].strip(),
            "finished": True,
            "speaker_label": None,
            "language_code": None,
            "start": t.get("start"),
            "end": t.get("end"),
        }
        for t in turns
        if t.get("text") and t["text"].strip()
    ]
    if not segments and text:
        segments = [{"text": text, "finished": True,
                     "speaker_label": None, "language_code": None}]
    return {"text": text, "language_code": None, "segments": segments}


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

    def __init__(self, api_key: str | None = None, org_id: int = 1):
        self._api_key = api_key or config.GEMINI_API_KEY
        self._org_id = org_id
        self._client = None

    @property
    def client(self):
        """The Gemini client, built on first use."""
        if self._client is None:
            self._client = genai.Client(api_key=self._api_key)
        return self._client

    async def transcribe_wav(self, wav_path: Path) -> dict:
        """Transcribe a WAV file, honouring the configured processing mode."""
        mode = get_mode() if self._org_id == 1 else get_mode(self._org_id)
        if mode == MODE_PRIVATE:
            try:
                return await _local_transcribe(wav_path)
            except LocalSttUnavailable as exc:
                local_stt.set_fallback_reason(str(exc))
                logger.warning(
                    "Private mode selected but local STT unavailable (%s) - falling back to Gemini", exc
                )
        return await self._gemini_transcribe(wav_path)

    async def _gemini_transcribe(self, wav_path: Path) -> dict:
        """Transcribe a WAV file via a single Gemini generate_content call."""
        compressed = _compress_wav(wav_path)
        try:
            data = compressed.read_bytes()
            prompt = _transcribe_prompt() if self._org_id == 1 else _transcribe_prompt(self._org_id)
            resp = await asyncio.wait_for(
                self.client.aio.models.generate_content(
                    model=config.GEMINI_ANALYSIS_MODEL,
                    contents=[
                        types.Part(text=prompt),
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
