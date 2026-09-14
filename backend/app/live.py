import asyncio
import logging
from pathlib import Path

from google import genai
from google.genai import types

from . import config

logger = logging.getLogger("suhbatdosh.live")


class LiveTranscriber:
    """Streams PCM audio to Gemini Live and collects live transcription chunks."""

    def __init__(self, api_key: str | None = None):
        self._api_key = api_key or config.GEMINI_API_KEY
        self._client = genai.Client(api_key=self._api_key)

    def _config(self, resumption_handle: str | None = None) -> types.LiveConnectConfig:
        cfg = types.LiveConnectConfig(
            response_modalities=[types.Modality.AUDIO],
            input_audio_transcription=types.AudioTranscriptionConfig(
                language_codes=["en-US", "uz-Latn-UZ"],
                word_timestamp=True,
                diarization=True,
            ),
            context_window_compression=types.ContextWindowCompressionConfig(
                trigger_tokens=5000, sliding_window=types.SlidingWindow(target_tokens=8192)
            ),
            system_instruction="You are a passive transcription engine. Only transcribe verbatim in the original language. Do not speak, do not translate, do not add commentary. Stay silent.",
        )
        if resumption_handle:
            cfg.session_resumption = types.SessionResumptionConfig(handle=resumption_handle)
        return cfg

    async def transcribe_pcm(
        self, pcm_path: Path, chunk_ms: int = 100, speed: float = 4.0, on_chunk=None
    ) -> dict:
        """Transcribe a raw PCM file (16kHz, 16-bit, mono) through Gemini Live.

        Audio is streamed at `speed`x real-time (1.0 = real-time, 4.0 = 4x faster).
        Returns {"text", "language_code", "segments"}. on_chunk(text, speaker, lang)
        is called as interim transcript text arrives. Handles connection resets via
        session resumption (may slightly duplicate a small tail window).
        """
        chunks = self._read_pcm(pcm_path, chunk_ms)
        total = len(chunks)
        segments: list[dict] = []
        text_parts: list[str] = []
        resumption_handle = None
        # pacing: chunk_ms real-time, but send `speed`x faster
        sleep_s = max(0.0, (chunk_ms / 1000.0) / speed - 0.005)

        for attempt in range(4):
            pos = 0  # chunks submitted in this attempt
            sent_all = False
            deadline = asyncio.get_running_loop().time() + 120
            try:
                async with self._client.aio.live.connect(
                    model=config.GEMINI_LIVE_MODEL,
                    config=self._config(resumption_handle),
                ) as session:

                    async def _sender():
                        nonlocal pos, sent_all
                        for i in range(pos, total):
                            await session.send_realtime_input(
                                audio=types.Blob(
                                    data=chunks[i], mime_type="audio/pcm;rate=16000"
                                )
                            )
                            pos = i + 1
                            if sleep_s > 0:
                                await asyncio.sleep(sleep_s)
                        if pos >= total:
                            await session.send_realtime_input(audio_stream_end=True)
                            sent_all = True

                    sender = asyncio.create_task(_sender())
                    turn_complete_seen = False
                    last_input_t = 0.0
                    try:
                        while True:
                            now = asyncio.get_running_loop().time()
                            if now > deadline:
                                logger.info("Live: deadline reached, stopping receive")
                                break
                            # Once audio has been sent fully, stop shortly after
                            # the last useful transcription arrives (checked on
                            # every message, because the model may keep streaming
                            # heartbeats/resumption updates indefinitely).
                            if (
                                sent_all
                                and sender.done()
                                and (
                                    turn_complete_seen
                                    or (last_input_t and now - last_input_t > 4)
                                )
                            ):
                                break
                            try:
                                msg = await asyncio.wait_for(
                                    session.receive().__anext__(), timeout=2
                                )
                            except StopAsyncIteration:
                                break
                            except asyncio.TimeoutError:
                                # No message: if finished sending, wrap up.
                                if sent_all and sender.done():
                                    break
                                continue
                            if msg.go_away is not None:
                                logger.info("Live: go_away (attempt %d, pos %d/%d)", attempt, pos, total)
                                continue
                            if msg.session_resumption_update is not None and msg.session_resumption_update.new_handle:
                                resumption_handle = msg.session_resumption_update.new_handle
                                logger.info("Live: resumption handle updated")
                            sc = msg.server_content
                            if sc is None:
                                continue
                            if sc.turn_complete is True:
                                turn_complete_seen = True
                                if sent_all and sender.done():
                                    break
                            t = sc.input_transcription
                            if t is not None and t.text:
                                last_input_t = now
                                segments.append(
                                    {
                                        "text": t.text,
                                        "finished": t.finished,
                                        "speaker_label": t.speaker_label,
                                        "language_code": t.language_code,
                                    }
                                )
                                text_parts.append(t.text)
                                if on_chunk:
                                    on_chunk(t.text, t.speaker_label, t.language_code)
                    finally:
                        sender.cancel()
            except Exception as e:
                logger.warning("Live attempt %d failed: %s", attempt, e)
                if attempt == 3:
                    raise
                await asyncio.sleep(1)

            if sent_all:
                break

        text = "".join(text_parts)
        lang = next((s["language_code"] for s in segments if s.get("language_code")), "")
        return {"text": text, "language_code": lang, "segments": segments}

    @staticmethod
    def _read_pcm(pcm_path: Path, chunk_ms: int) -> list[bytes]:
        chunk_bytes = max(16000 * 2 * (chunk_ms // 1000), 1600)
        data = pcm_path.read_bytes()
        return [data[i : i + chunk_bytes] for i in range(0, len(data), chunk_bytes)]
