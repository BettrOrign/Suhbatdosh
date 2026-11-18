"""
Глубокий module голосового ИИ-оператора.

Один интерфейс: LiveConversation.run(model) — внутри прячутся connect, конфиг
сессии, микрофонный/текстовый ввод, приём, прерывания, tool calls, резолюция
модели и автопереподключение при обрыве связи.
Зависимости приходят снаружи через фабрики/адаптеры, поэтому тесты работают
через тот же run(), что и прод: FakeSession вместо google-genai.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import threading
import time
import urllib.request

import numpy as np
from google.genai import types
from websockets.exceptions import ConnectionClosed

from .. import config as app_config
from . import ai_operator as operator_mod

try:
    import sounddevice as sd  # Optional: only needed for local CLI mode
except ImportError:
    sd = None  # type: ignore[assignment]


def load_env(path: str = ".env") -> None:
    """Читает .env (KEY=VALUE), не перетирая уже заданные переменные окружения."""
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            os.environ.setdefault(key, value)


# --- Аудио ---
INPUT_RATE = 16000   # вход: 16 kHz, mono, 16-bit PCM
OUTPUT_RATE = 24000  # выход: 24 kHz, mono, 16-bit PCM
BLOCK = 1024         # размер блока микрофона (~64 мс)

# Антиэхо (barge-in): пока агент говорит, микрофон не отправляется в модель.
# Если локальный уровень речи превышает порог несколько блоков подряд — это
# живой человек перебивает: сбрасываем воспроизведение и отдаём накопленное.
BARGE_IN_RMS = 2200        # заметно громче эха колонок
BARGE_IN_BLOCKS = 4        # ~250 мс подряд, чтобы не срабатывать на щелчки
BARGE_IN_GRACE_SECONDS = 0.6  # не ловим хвост собственной реплики в начале ответа
MAX_PENDING_BLOCKS = 40    # ~2.5 с речи, накопленной до срабатывания
MAX_GATE_SECONDS = 30.0    # предохранитель: гейт не может зависнуть навсегда


def pcm_rms(chunk: bytes) -> float:
    """Среднеквадратичный уровень 16-битного PCM-блока."""
    if not chunk:
        return 0.0
    samples = np.frombuffer(chunk, dtype=np.int16).astype(np.float64)
    return float(np.sqrt((samples ** 2).mean()))

# --- Модель: по таблице депрекаций Google на ноябрь 2026 рабочая GA-модель
# Live API — gemini-3.8-live (без даты выключения). Она же в кулибуке Gemini.
# https://aistudio.google.com/docs/deprecations
# Этот список — приоритет подбора; ListModels у бесплатных ключей часто
# вообще не показывает bidi-модели, поэтому если выбор по списку не удался,
# берём MODEL_DEFAULT напрямую.
MODEL_DEFAULT = "gemini-3.8-live"

MODEL_PREFERENCES = [
    "gemini-3.8-live",
    "gemini-3.8-live-extended-thinking",
    "gemini-3.1-flash-live-preview",          # ⚠ выключат 17.11.2026
    "gemini-2.5-flash-native-audio-preview-12-2025",  # ⚠ выключат 17.11.2026
]

# Паттерны имён: live-модель для диалога. "-translate" (Live Translate),
# TTS/music и т. п. исключаем — они не для voice-болтовни.
LIVE_NAME_RE = re.compile(r"(live|native-audio)", re.IGNORECASE)
EXCLUDE_NAME_RE = re.compile(r"(translate|music|tts)", re.IGNORECASE)
VERSION_RE = re.compile(r"gemini-(\d+(?:\.\d+)*)")

VOICES = ["Kore", "Charon", "Puck", "Fenrir", "Aoede", "Zephyr", "Leda"]

# Для фиксированного языка подсказываем синтезу произношение. В режиме auto
# язык определяет сам собеседник, поэтому language_code не задаём.
SPEECH_LANGUAGE_CODES = {"ru": "ru-RU", "uz": "uz-UZ", "en": "en-US"}

TOPICS = [
    "искусство и живопись",
    "космос и колонизация Марса",
    "старые видеоигры и ностальгия",
    "философия в повседневной жизни",
    "путешествия и лучшие города мира",
    "еда и странные сочетания вкусов",
    "музыка и концерты",
    "животные и их причуды",
]

# Сколько секунд ждать перед реконнектом (Первый раз — 2, дальше умножается, максимум 10)
RECONNECT_DELAY_SECONDS = 2.0

# Ошибки транспорта, после которых имеет смысл переподключиться
TRANSIENT_EXC = (ConnectionClosed, TimeoutError, ConnectionError, OSError)


# --------------------------------------------------------------------------
# Резолюция модели: имя берём из списка моделей, доступных твоему ключу
# --------------------------------------------------------------------------
def live_names(available: set[str]) -> list[str]:
    """Чистая функция: какие из доступных моделей подходят для voice-разговора."""
    return [
        n for n in available
        if n.startswith("gemini-") and LIVE_NAME_RE.search(n) and not EXCLUDE_NAME_RE.search(n)
    ]


def _version_key(name: str, prefs: list[str] = MODEL_PREFERENCES) -> tuple:
    """Ключ сортировки для max(): выше версия — лучше; при равенстве версий —
    раньше в списке предпочтений."""
    m = VERSION_RE.search(name)
    version = tuple(int(x) for x in m.group(1).split(".")) if m else (-1,)
    pref_index = prefs.index(name) if name in prefs else len(prefs)
    return version + (-pref_index,)


def pick_model(available: set[str], prefs: list[str] = MODEL_PREFERENCES) -> str | None:
    """Самая свежая live-модель, реально доступная ключу. None — если ни одной."""
    names = live_names(available)
    if not names:
        return None
    return max(names, key=lambda n: _version_key(n, prefs))


def fetch_available_model_names(api_key: str) -> set[str]:
    """Какие модели есть у ключа (REST ListModels, v1beta)."""
    url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
    with urllib.request.urlopen(url, timeout=30) as r:
        data = json.load(r)
    return {m["name"].removeprefix("models/") for m in data.get("models", [])}


def resolve_model(api_key: str | None = None, forced: str | None = None) -> str:
    """Имя live-модели для текущего ключа.

    Приоритет: forced → лучшая live-модель из ListModels → MODEL_DEFAULT.
    MODEL_DEFAULT в конце — намеренно: у бесплатных ключей ListModels часто
    вообще не содержит bidi/live-моделей, хотя gemini-3.8-live у ключа работает.
    """
    if forced:
        return forced
    key = api_key if api_key is not None else (os.environ.get("GEMINI_API_KEY") or app_config.GEMINI_API_KEY or "")
    if not key:
        raise RuntimeError("GEMINI_API_KEY is not configured")
    try:
        available = fetch_available_model_names(key)
        name = pick_model(available)
        if name is not None:
            return name
    except Exception as e:  # noqa: BLE001 — сеть/ключ могут лежать по-разному
        # ListModels нередко недоступен (SSL/прокси/квоты), но live-модель
        # при этом работает. Возвращаем дефолтную, а не падаем сессией.
        print(f"Предупреждение: ListModels недоступен ({e}); использую {MODEL_DEFAULT}")
        return MODEL_DEFAULT
    # Live-моделей в списке нет → работаем «вслепую» с текущей GA-моделью
    return MODEL_DEFAULT


# --------------------------------------------------------------------------
# Сессионный конфиг
# --------------------------------------------------------------------------
def build_session_config(
    voice: str,
    system_instruction: str | None = None,
    resume_handle: str | None = None,
    topic: str | None = None,
    lang: str = "auto",
) -> dict:
    speech_config: dict = {
        "voice_config": {"prebuilt_voice_config": {"voice_name": voice}}
    }
    if lang in SPEECH_LANGUAGE_CODES:
        speech_config["language_code"] = SPEECH_LANGUAGE_CODES[lang]

    config = {
        "response_modalities": ["AUDIO"],
        "system_instruction": system_instruction or operator_mod.build_system_instruction(
            topic=topic, lang=lang
        ),
        "speech_config": speech_config,
        "input_audio_transcription": {},
        "output_audio_transcription": {},
        # Менее чувствительный VAD: агент не перебивает сам себя эхом колонок
        "realtime_input_config": {
            "automatic_activity_detection": {
                "start_of_speech_sensitivity": "START_SENSITIVITY_LOW",
                "end_of_speech_sensitivity": "END_SENSITIVITY_LOW",
                "prefix_padding_ms": 300,
                "silence_duration_ms": 800,
            }
        },
        # Инструменты оператора (заявки, база знаний, эскалация)
        "tools": [operator_mod.TOOLS],
        # Продолжение разговора после обрыва/лимита длительности сессии
        "session_resumption": {"handle": resume_handle} if resume_handle else {},
        "context_window_compression": {
            "trigger_tokens": 25600,
            "sliding_window": {"target_tokens": 12800},
        },
    }
    # gemini-3.8-live сейчас отвечает 1007 на enable_affective_dialog,
    # поэтому по умолчанию выключено. Включить: AFFECTIVE_DIALOG=1.
    if os.environ.get("AFFECTIVE_DIALOG", "").lower() in ("1", "true", "yes"):
        config["enable_affective_dialog"] = True
    return config


# --------------------------------------------------------------------------
# Воспроизведение (буфер между сетью и аудиоустройством)
# --------------------------------------------------------------------------
class Player:
    """Простая очередь PCM-чанков -> звуковая карта. Поддерживает прерывания."""

    def __init__(self) -> None:
        self._buffer = bytearray()
        self._lock = threading.Lock()
        self._stream = sd.OutputStream(
            samplerate=OUTPUT_RATE,
            channels=1,
            dtype="int16",
            blocksize=512,  # ~21 мс, для низкой латентности
            callback=self._callback,
        )

    def _callback(self, outdata, frames, time_info, status):  # вызывается из аудиопотока
        need = frames * 2  # байт (int16 = 2 байта на сэмпл)
        with self._lock:
            take = min(len(self._buffer), need)
            chunk = bytes(self._buffer[:take])
            del self._buffer[:take]
        if take < need:  # если данных не хватило — тишина
            chunk += b"\x00\x00" * ((need - take) // 2)
        outdata[:] = np.frombuffer(chunk, dtype=np.int16).reshape(-1, 1)

    def play(self, pcm: bytes) -> None:
        # Поток мог быть остановлен системой/драйвером — поднимаем его обратно,
        # иначе звук копится в буфере и больше никогда не играет.
        if not self._stream.active:
            try:
                self._stream.start()
            except Exception:  # noqa: BLE001 — устройство может быть занято
                pass
        with self._lock:
            self._buffer.extend(pcm)

    def clear(self) -> None:
        """Прервать текущую реплику (пользователь заговорил)."""
        with self._lock:
            self._buffer.clear()

    def buffered_seconds(self) -> float:
        """Сколько ещё звука лежит в буфере (для подавления эха)."""
        with self._lock:
            return len(self._buffer) / 2 / OUTPUT_RATE

    def __enter__(self):
        self._stream.start()
        return self

    def __exit__(self, *exc):
        self._stream.stop()
        self._stream.close()


# --------------------------------------------------------------------------
# Источники ввода: прод-адаптеры (микрофон, stdin); в тестах — FakeSource.
# --------------------------------------------------------------------------
class MicSource:
    """Бесконечный поток PCM-чанков с микрофона."""

    def __init__(self, device: int | None = None) -> None:
        self.device = device

    async def blocks(self):
        loop = asyncio.get_running_loop()
        kwargs = {"device": self.device} if self.device is not None else {}
        with sd.InputStream(
            samplerate=INPUT_RATE, channels=1, dtype="int16", blocksize=BLOCK, **kwargs
        ) as stream:
            while True:
                # Блокирующее чтение уводим в отдельный поток, чтобы не мешать asyncio
                data, _ = await loop.run_in_executor(None, stream.read, BLOCK)
                yield data.tobytes()


class StdinSource:
    """Текст с клавиатуры: можно печатать вместо речи. «q» — завершить.

    Без TTY (stdin = /dev/null или pipe) ввод просто выключается — голос
    продолжает работать, а не роняет сессию с EOFError.
    """

    async def lines(self):
        while True:
            try:
                line = await asyncio.to_thread(input)
            except EOFError:
                await asyncio.Event().wait()  # ввода нет — живём голосом
                return
            yield line


def probe_mic(device: int | None = None, seconds: float = 0.6) -> tuple[str, float]:
    """Быстрая проверка микрофона при старте: имя устройства и RMS сигнала."""
    with sd.InputStream(
        samplerate=INPUT_RATE, channels=1, dtype="int16", blocksize=BLOCK,
        device=device,
    ) as stream:
        frames = [stream.read(BLOCK)[0] for _ in range(max(1, int(INPUT_RATE / BLOCK * seconds)))]
    samples = np.concatenate(frames).ravel().astype(float)
    name = sd.query_devices(device, kind="input")["name"]
    return name, float(np.sqrt((samples ** 2).mean()))


# --------------------------------------------------------------------------
# Фабрика сессии для прод-адаптера google-genai
# --------------------------------------------------------------------------
def connect_factory(api_key: str | None = None):
    """Возвращает session_factory на client.aio.live.connect.

    Важно: Live-модели (в т.ч. gemini-3.8-live) доступны только на api_version
    'v1beta'/'v1alpha'; дефолт SDK — 'v1' — отвечает 404 на WS handshake.
    """
    from google import genai

    resolved_key = api_key if api_key is not None else (os.environ.get("GEMINI_API_KEY") or app_config.GEMINI_API_KEY or "")
    client = genai.Client(api_key=resolved_key, http_options={"api_version": "v1beta"})

    def factory(model, config):
        return client.aio.live.connect(model=model, config=config)

    return factory


# --------------------------------------------------------------------------
# Ядро разговора. Интерфейс один: run().
# --------------------------------------------------------------------------
def process_server_content(sc, player, on_event) -> None:
    """Семантика одного server_content. Презентации здесь нет."""
    if sc is None:
        return

    if getattr(sc, "interrupted", None):
        player.clear()
        on_event({"type": "interrupt"})

    if getattr(sc, "input_transcription", None) and sc.input_transcription.text:
        on_event({"type": "user_text", "text": sc.input_transcription.text})

    if getattr(sc, "output_transcription", None) and sc.output_transcription.text:
        on_event({"type": "agent_text", "text": sc.output_transcription.text})

    if getattr(sc, "model_turn", None):
        for part in sc.model_turn.parts or []:
            inline = getattr(part, "inline_data", None)
            if inline and inline.data:
                player.play(inline.data)

    if getattr(sc, "turn_complete", None):
        on_event({"type": "turn_end"})


class LiveConversation:
    """Разговор: connect -> сеем старт -> микрофон/текст + приём, с реконнектом."""

    def __init__(
        self,
        *,
        session_factory,        # (model, config) -> async context manager -> session
        audio_source,           # .blocks() -> AsyncIterator[bytes PCM]
        player,                 # play(bytes) / clear() / context manager
        on_event,               # callable(event: dict) -> None
        topic: str | None = None,
        voice: str = "Kore",
        system_instruction: str | None = None,
        text_source=None,       # .lines() -> AsyncIterator[str] | None
        barge_in: bool = False, # разрешить перебивание голосом (нужны наушники/AEC)
        lang: str = "auto",     # auto | ru | uz | en
    ) -> None:
        self.session_factory = session_factory
        self.audio_source = audio_source
        self.player = player
        self.on_event = on_event
        self.topic = topic
        self.voice = voice
        self.system_instruction = system_instruction
        self.text_source = text_source
        self.barge_in = barge_in
        self.lang = lang
        self._resume_handle: str | None = None
        self._reconnect_requested = False
        self._agent_audio_until = 0.0
        self._agent_speaking_since = 0.0
        self._stop = asyncio.Event()

    async def run(self, model: str) -> None:
        """Бесконечный разговор с автопереподключением; выход — stop() или Ctrl+C."""
        attempt = 0
        while not self._stop.is_set():
            self._reconnect_requested = False
            config = build_session_config(
                self.voice, self.system_instruction, self._resume_handle,
                topic=self.topic, lang=self.lang,
            )
            try:
                async with self.session_factory(model, config) as session:
                    attempt = 0
                    if not self._resume_handle:
                        await self._seed(session)
                    with self.player:  # запуск/остановка аудиоустройства
                        ended = await self._run_session(session)
                    if ended:
                        break
            except TRANSIENT_EXC as e:  # обрыв связи — продолжаем разговор
                if self._stop.is_set():
                    break
                attempt += 1
                delay = min(RECONNECT_DELAY_SECONDS * attempt, 10.0)
                self.on_event(
                    {"type": "reconnecting", "error": f"{type(e).__name__}", "delay": delay}
                )
                try:
                    await asyncio.wait_for(self._stop.wait(), timeout=delay)
                except TimeoutError:
                    pass

    def stop(self) -> None:
        """Завершить разговор (например, по «q» или Ctrl+C)."""
        self._stop.set()

    async def _seed(self, session) -> None:
        if self.topic:
            text = f"Давай поговорим на тему: {self.topic}"
        else:
            text = "Начни разговор: поздоровайся и предложи помощь."
        await session.send_client_content(
            turns={"role": "user", "parts": [{"text": text}]}, turn_complete=True
        )

    async def _run_session(self, session) -> bool:
        """Гоняет циклы одной сессии. True — разговор завершён штатно,
        False — нужен реконнект (go_away). Транспортные ошибки пробрасываются."""
        tasks = {
            asyncio.create_task(self._mic_loop(session)),
            asyncio.create_task(self._receive_loop(session)),
        }
        if self.text_source is not None:
            tasks.add(asyncio.create_task(self._text_loop(session)))
        stop_task = asyncio.create_task(self._stop.wait())

        pending = set(tasks)
        try:
            while pending:
                done, still = await asyncio.wait(
                    {*pending, stop_task}, return_when=asyncio.FIRST_COMPLETED
                )
                pending = {t for t in still if t is not stop_task}
                if stop_task in done:
                    return True
                # Собираем результаты: любое исключение — наверх (реконнект)
                errors = [e for e in (t.exception() for t in done) if e]
                if errors:
                    raise errors[0]
                if self._reconnect_requested:
                    return False
            return True
        finally:
            for task in [*pending, stop_task]:
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):  # noqa: BLE001
                    pass

    async def _mic_loop(self, session) -> None:
        pending: list[bytes] = []
        voice_run = 0
        async for chunk in self.audio_source.blocks():
            now = time.monotonic()
            if now < self._agent_audio_until:
                # Агент говорит. По умолчанию микрофон не отправляем вообще:
                # с колонками эхо гарантированно обрывает ответ (half-duplex).
                if not self.barge_in:
                    continue
                # Режим наушников: слушаем локально и ловим настоящее перебивание.
                pending.append(chunk)
                if len(pending) > MAX_PENDING_BLOCKS:
                    pending.pop(0)
                speech = pcm_rms(chunk) >= BARGE_IN_RMS
                voice_run = voice_run + 1 if speech else 0
                can_interrupt = now - self._agent_speaking_since >= BARGE_IN_GRACE_SECONDS
                if voice_run < BARGE_IN_BLOCKS or not can_interrupt:
                    continue
                # Человек реально заговорил поверх агента — barge-in.
                self.player.clear()
                self._agent_audio_until = 0.0
                voice_run = 0
                self.on_event({"type": "barge_in", "rms": round(pcm_rms(chunk))})
                for buffered in pending:
                    await self._send_audio(session, buffered)
                pending.clear()
                continue
            pending.clear()
            voice_run = 0
            await self._send_audio(session, chunk)

    @staticmethod
    async def _send_audio(session, chunk: bytes) -> None:
        await session.send_realtime_input(
            audio=types.Blob(data=chunk, mime_type=f"audio/pcm;rate={INPUT_RATE}")
        )

    async def _text_loop(self, session) -> None:
        async for line in self.text_source.lines():
            text = line.strip()
            if not text:
                continue
            if text.lower() in ("q", "quit", "выход"):
                self.stop()
                return
            await session.send_realtime_input(text=text)

    async def _receive_loop(self, session) -> None:
        # ВАЖНО: session.receive() отдаёт события ОДНОЙ реплики и возвращается —
        # его нужно переоткрывать после каждого хода (так в кулибуке Gemini).
        while True:
            async for msg in session.receive():
                sc = msg.server_content
                process_server_content(sc, self.player, self.on_event)

                # Эхо-защита: пока звук ответа ещё играет, микрофон придерживаем.
                if sc is not None:
                    if getattr(sc, "interrupted", None):
                        self._agent_audio_until = 0.0
                    elif getattr(sc, "model_turn", None):
                        buffered = 0.0
                        buffered_fn = getattr(self.player, "buffered_seconds", None)
                        if buffered_fn is not None:
                            buffered = buffered_fn()
                        now = time.monotonic()
                        if now >= self._agent_audio_until:
                            self._agent_speaking_since = now
                        buffered = min(buffered, MAX_GATE_SECONDS)
                        self._agent_audio_until = max(
                            self._agent_audio_until,
                            now + buffered + 0.25,
                        )
                        self._agent_audio_until = min(
                            self._agent_audio_until, now + MAX_GATE_SECONDS
                        )

                update = getattr(msg, "session_resumption_update", None)
                if update and getattr(update, "resumable", False) and update.new_handle:
                    self._resume_handle = update.new_handle

                if getattr(msg, "go_away", None):
                    self.on_event(
                        {"type": "go_away", "seconds": getattr(msg.go_away, "time_left", None)}
                    )
                    self._reconnect_requested = True
                    return  # закроем сессию и переподключимся с resume_handle

                if getattr(msg, "tool_call", None):
                    await self._handle_tool_call(session, msg.tool_call)
            # Ход закончился — следующая итерация переоткроет receive()

    async def _handle_tool_call(self, session, tool_call) -> None:
        responses = []
        for call in tool_call.function_calls or []:
            result = operator_mod.handle_tool(call.name, dict(call.args or {}))
            self.on_event({"type": "tool", "name": call.name, "result": result})
            responses.append(
                types.FunctionResponse(name=call.name, id=call.id, response={"result": result})
            )
        if responses:
            await session.send_tool_response(function_responses=responses)
