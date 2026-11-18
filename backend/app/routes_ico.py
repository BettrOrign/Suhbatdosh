"""ICO Live Voice AI Operator routes (REST settings + WebSocket audio/text bridge)."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from google.genai import types

from . import config as app_config
from .auth import get_current_user
from .ico import ai_operator, engine

logger = logging.getLogger("suhbatdosh.ico")

router = APIRouter()

_ICO_DATA_DIR = Path(app_config.DATA_DIR) / "ico"
_SETTINGS_PATH = _ICO_DATA_DIR / "settings.json"
_TRANSCRIPTS_DIR = _ICO_DATA_DIR / "transcripts"


def load_ico_settings() -> dict:
    """Return current ICO voice & language settings."""
    data: dict = {}
    if _SETTINGS_PATH.exists():
        try:
            data = json.loads(_SETTINGS_PATH.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            data = {}
    voice = data.get("voice") if data.get("voice") in engine.VOICES else "Aoede"
    lang = data.get("lang") if data.get("lang") in ai_operator.LANGUAGES else "auto"
    return {"voice": voice, "lang": lang}


def save_ico_settings(voice: str | None = None, lang: str | None = None) -> dict:
    """Persist ICO voice and language settings."""
    cur = load_ico_settings()
    if voice in engine.VOICES:
        cur["voice"] = voice
    if lang in ai_operator.LANGUAGES:
        cur["lang"] = lang
    _ICO_DATA_DIR.mkdir(parents=True, exist_ok=True)
    _SETTINGS_PATH.write_text(json.dumps(cur, ensure_ascii=False, indent=2), encoding="utf-8")
    return cur


@router.get("/api/ico/settings")
def get_ico_settings(_user: dict = Depends(get_current_user)):
    """Return ICO avatar profile, voice, and language options."""
    s = load_ico_settings()
    profile = ai_operator.load_org_profile()
    return {
        **s,
        "voices": engine.VOICES,
        "languages": list(ai_operator.LANGUAGES),
        "avatar_name": profile.get("avatar_name") or "Laylo",
        "avatar_role": profile.get("avatar_role") or "AI Operator",
        "org_name": profile.get("name") or "Suhbatdosh",
        "configured": bool(app_config.GEMINI_API_KEY),
    }


@router.post("/api/ico/settings")
def update_ico_settings(payload: dict, _user: dict = Depends(get_current_user)):
    """Update ICO voice or language."""
    return save_ico_settings(voice=payload.get("voice"), lang=payload.get("lang"))


class _RestartSession(Exception):
    """Raised when settings change and the Gemini Live session should restart."""


class _ClientBridge:
    """Bridges a browser WebSocket (16kHz PCM in / 24kHz PCM out + JSON) to Gemini Live."""

    INPUT_RATE = 16000

    def __init__(self, ws: WebSocket, voice: str | None = None, lang: str | None = None) -> None:
        self.ws = ws
        saved = load_ico_settings()
        self.voice = voice if voice in engine.VOICES else saved["voice"]
        self.lang = lang if lang in ai_operator.LANGUAGES else saved["lang"]
        self.prompt = ai_operator.build_system_instruction(lang=self.lang)
        self.model = engine.MODEL_DEFAULT
        self.resume_handle: str | None = None
        self.closed = False
        self.inbox: asyncio.Queue[tuple[str, object]] = asyncio.Queue(maxsize=200)
        self.out: asyncio.Queue[tuple[str, object] | None] = asyncio.Queue()

        self.session_id = uuid.uuid4().hex[:12]
        self.started_at = datetime.now(timezone.utc)
        self.turns: list[dict] = []
        self.tool_calls_count = 0

    def _record(self, role: str, text: str) -> None:
        clean = re.sub(r"<noise>", "", text, flags=re.IGNORECASE).strip()
        if not clean:
            return
        if self.turns and self.turns[-1]["role"] == role and role != "tool":
            prev = self.turns[-1]["text"]
            sep = "" if (not prev or prev[-1].isspace() or clean[0] in ".,!?:;") else " "
            self.turns[-1]["text"] = prev + sep + clean
            return
        self.turns.append({
            "role": role,
            "text": clean,
            "at": datetime.now(timezone.utc).isoformat(),
        })

    def _finalize(self) -> None:
        if not self.turns:
            return
        try:
            _TRANSCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
            payload = {
                "session_id": self.session_id,
                "started_at": self.started_at.isoformat(),
                "ended_at": datetime.now(timezone.utc).isoformat(),
                "lang": self.lang,
                "voice": self.voice,
                "turns": self.turns,
                "tool_calls": self.tool_calls_count,
            }
            (_TRANSCRIPTS_DIR / f"{self.session_id}.json").write_text(
                json.dumps(payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except OSError as exc:
            logger.debug("Could not save ICO transcript: %s", exc)

    async def _emit(self, payload: dict) -> None:
        await self.out.put(("json", json.dumps(payload, ensure_ascii=False)))

    async def _emit_audio(self, pcm: bytes) -> None:
        await self.out.put(("bytes", pcm))

    async def _sender(self) -> None:
        while True:
            item = await self.out.get()
            if item is None:
                return
            kind, data = item
            try:
                if kind == "bytes":
                    await self.ws.send_bytes(data)  # type: ignore[arg-type]
                else:
                    await self.ws.send_text(data)  # type: ignore[arg-type]
            except Exception:
                self.closed = True
                return

    def _queue_audio(self, data: bytes) -> None:
        if self.inbox.full():
            try:
                self.inbox.get_nowait()
            except asyncio.QueueEmpty:
                pass
        try:
            self.inbox.put_nowait(("audio", data))
        except asyncio.QueueFull:
            pass

    async def _reader(self) -> None:
        try:
            while True:
                message = await self.ws.receive()
                if message["type"] == "websocket.disconnect":
                    break
                if message.get("bytes") is not None:
                    self._queue_audio(message["bytes"])
                    continue
                raw = message.get("text")
                if not raw:
                    continue
                try:
                    data = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                kind = data.get("type")
                if kind == "text":
                    text = (data.get("text") or "").strip()
                    if text:
                        await self.inbox.put(("text", text))
                elif kind in ("restart", "stop"):
                    await self.inbox.put(("restart", None))
                elif kind == "ping":
                    await self._emit({"type": "pong"})
        except WebSocketDisconnect:
            pass
        except Exception:
            pass
        finally:
            self.closed = True
            try:
                self.inbox.put_nowait(("closed", None))
            except asyncio.QueueFull:
                pass

    async def run(self) -> None:
        sender = asyncio.create_task(self._sender())
        reader = asyncio.create_task(self._reader())
        try:
            try:
                self.model = await asyncio.to_thread(engine.resolve_model)
            except Exception as exc:
                await self._emit({"type": "error", "message": str(exc)})
                return

            await self._emit({
                "type": "ready",
                "model": self.model,
                "voice": self.voice,
                "lang": self.lang,
                "voices": engine.VOICES,
                "languages": list(ai_operator.LANGUAGES),
            })
            await self._session_loop()
        finally:
            self.closed = True
            await self.out.put(None)
            try:
                await asyncio.wait_for(sender, timeout=1.0)
            except Exception:
                sender.cancel()
            reader.cancel()
            try:
                await self.ws.close()
            except Exception:
                pass
            await asyncio.gather(reader, sender, return_exceptions=True)
            self._finalize()

    async def _session_loop(self) -> None:
        attempt = 0
        factory = engine.connect_factory()
        while not self.closed:
            cfg = engine.build_session_config(
                self.voice, self.prompt, self.resume_handle, lang=self.lang
            )
            try:
                async with factory(self.model, cfg) as session:
                    attempt = 0
                    if self.resume_handle is None:
                        await self._seed(session)
                    await self._emit({"type": "status", "state": "connected"})
                    await self._serve(session)
            except _RestartSession:
                if self.closed:
                    return
                self.resume_handle = None
                settings = load_ico_settings()
                self.lang = settings["lang"]
                self.prompt = ai_operator.build_system_instruction(lang=self.lang)
                self.voice = settings["voice"]
                attempt = 0
                await self._emit({"type": "status", "state": "restarted"})
                continue
            except engine.TRANSIENT_EXC as exc:
                if self.closed:
                    return
                attempt += 1
                delay = min(engine.RECONNECT_DELAY_SECONDS * attempt, 10.0)
                await self._emit({
                    "type": "status",
                    "state": "reconnecting",
                    "error": type(exc).__name__,
                    "delay": delay,
                })
                await asyncio.sleep(delay)
                continue
            except Exception as exc:
                logger.warning("ICO live session error: %s", exc)
                if self.closed:
                    return
                await self._emit({"type": "error", "message": f"{type(exc).__name__}: {exc}"})
                return

    async def _serve(self, session) -> None:
        recv = asyncio.create_task(self._recv_loop(session))
        fwd = asyncio.create_task(self._forward_loop(session))
        try:
            done, pending = await asyncio.wait(
                {recv, fwd}, return_when=asyncio.FIRST_COMPLETED
            )
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            for task in done:
                exc = task.exception()
                if exc:
                    raise exc
        finally:
            for task in (recv, fwd):
                task.cancel()
            await asyncio.gather(recv, fwd, return_exceptions=True)

    async def _seed(self, session) -> None:
        profile = ai_operator.load_org_profile()
        avatar_name = profile.get("avatar_name") or "Laylo"
        org_name = profile.get("name") or "Suhbatdosh"
        seed = {
            "ru": f"Начни разговор от лица {avatar_name} ({org_name}): тепло поздоровайся и предложи помощь.",
            "uz": f"Suhbatni {avatar_name} ({org_name}) nomidan boshlang: iliq salomlashing va yordam taklif qiling.",
            "en": f"Start the conversation as {avatar_name} from {org_name}: greet the caller warmly and offer help.",
            "auto": (
                f"Начни разговор от лица {avatar_name} ({org_name}): тепло поздоровайся и предложи помощь. "
                "Ответь на языке собеседника, а если он ещё не говорил — по-русски."
            ),
        }.get(self.lang, f"Начни разговор от лица {avatar_name}: поздоровайся и предложи помощь.")
        await session.send_client_content(
            turns=[{"role": "user", "parts": [{"text": seed}]}],
            turn_complete=True,
        )

    async def _forward_loop(self, session) -> None:
        while not self.closed:
            kind, payload = await self.inbox.get()
            if kind == "audio":
                await session.send_realtime_input(
                    audio=types.Blob(
                        data=payload,  # type: ignore[arg-type]
                        mime_type=f"audio/pcm;rate={self.INPUT_RATE}",
                    )
                )
            elif kind == "text":
                self._record("user", str(payload))
                await session.send_realtime_input(text=payload)  # type: ignore[arg-type]
            elif kind == "restart":
                self._drop_pending_audio()
                raise _RestartSession()
            elif kind == "closed":
                return

    def _drop_pending_audio(self) -> None:
        kept: list[tuple[str, object]] = []
        while True:
            try:
                kind, payload = self.inbox.get_nowait()
            except asyncio.QueueEmpty:
                break
            if kind != "audio":
                kept.append((kind, payload))
        for item in kept:
            try:
                self.inbox.put_nowait(item)
            except asyncio.QueueFull:
                break

    async def _recv_loop(self, session) -> None:
        while not self.closed:
            async for message in session.receive():
                sc = message.server_content
                if sc is not None:
                    pcm = bytearray()
                    if getattr(sc, "model_turn", None):
                        for part in sc.model_turn.parts or []:
                            inline = getattr(part, "inline_data", None)
                            if inline and inline.data:
                                pcm.extend(inline.data)
                    if pcm:
                        await self._emit_audio(bytes(pcm))

                    if getattr(sc, "interrupted", None):
                        await self._emit({"type": "interrupt"})

                    if getattr(sc, "input_transcription", None) and sc.input_transcription.text:
                        self._record("user", sc.input_transcription.text)
                        await self._emit({"type": "user_text", "text": sc.input_transcription.text})
                    if getattr(sc, "output_transcription", None) and sc.output_transcription.text:
                        self._record("agent", sc.output_transcription.text)
                        await self._emit({"type": "agent_text", "text": sc.output_transcription.text})
                    if getattr(sc, "turn_complete", None):
                        await self._emit({"type": "turn_end"})

                update = getattr(message, "session_resumption_update", None)
                if update and getattr(update, "resumable", False) and update.new_handle:
                    self.resume_handle = update.new_handle

                if getattr(message, "go_away", None):
                    await self._emit({"type": "status", "state": "go_away"})
                    return

                if getattr(message, "tool_call", None):
                    await self._handle_tool_call(session, message.tool_call)

    async def _handle_tool_call(self, session, tool_call) -> None:
        responses = []
        for call in tool_call.function_calls or []:
            result = ai_operator.handle_tool(call.name, dict(call.args or {}))
            self.tool_calls_count += 1
            self._record("tool", f"{call.name}: {json.dumps(dict(call.args or {}), ensure_ascii=False)}")
            await self._emit({"type": "tool", "name": call.name, "result": result})
            responses.append(
                types.FunctionResponse(
                    name=call.name, id=call.id, response={"result": result}
                )
            )
        if responses:
            await session.send_tool_response(function_responses=responses)


@router.websocket("/ws/ico")
async def ico_websocket(ws: WebSocket) -> None:
    """WebSocket endpoint for the floating ICO voice avatar."""
    await ws.accept()
    voice = ws.query_params.get("voice")
    lang = ws.query_params.get("lang")
    bridge = _ClientBridge(ws, voice=voice, lang=lang)
    try:
        await bridge.run()
    except WebSocketDisconnect:
        pass
    finally:
        bridge.closed = True
