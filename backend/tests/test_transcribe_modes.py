"""Mode-aware transcription branching (private -> local, online -> Gemini)."""

import asyncio

from app import local_stt, transcribe
from app.transcribe import LocalSttUnavailable, Transcriber


class _FakeLocal:
    """Stand-in for the sherpa-onnx wrapper so the tests need no model."""

    def __init__(self, text="analiz shart emas bir yarim million", boom=None,
                 turns=None):
        self.text = text
        self.boom = boom
        self.fallback_reason = None
        self.turns = turns if turns is not None else (
            [{"start": 0.0, "end": 2.5, "text": text}] if text else []
        )

    def transcribe(self, path):
        if self.boom:
            raise self.boom
        return {"text": self.text, "turns": self.turns, "duration_sec": 2.5}

    def set_fallback_reason(self, reason):
        self.fallback_reason = reason


def _run(coro):
    return asyncio.run(coro)


async def _never_local(wav_path):
    raise AssertionError("local STT must not be used in online mode")


def test_online_mode_uses_gemini(monkeypatch):
    monkeypatch.setattr(transcribe, "get_mode", lambda: "online")

    called = {}

    async def fake_gemini(self, wav_path):
        called["yes"] = True
        return {"text": "gemini text", "language_code": None, "segments": []}

    monkeypatch.setattr(Transcriber, "_gemini_transcribe", fake_gemini)
    monkeypatch.setattr(transcribe, "_local_transcribe", _never_local)

    result = _run(Transcriber(api_key="x").transcribe_wav("/tmp/whatever.wav"))
    assert called["yes"]
    assert result["text"] == "gemini text"


def test_private_mode_uses_local_and_never_gemini(monkeypatch):
    monkeypatch.setattr(transcribe, "get_mode", lambda: "private")
    monkeypatch.setattr(transcribe, "local_stt", _FakeLocal())

    def fake_gemini(self, wav_path):
        raise AssertionError("Gemini must not be called in private mode")

    monkeypatch.setattr(Transcriber, "_gemini_transcribe", fake_gemini)

    result = _run(Transcriber(api_key="x").transcribe_wav("/tmp/whatever.wav"))
    assert result["text"].startswith("analiz shart emas")
    assert result["language_code"] is None
    assert len(result["segments"]) == 1
    assert result["segments"][0]["finished"] is True
    assert result["segments"][0]["speaker_label"] is None


def test_private_mode_empty_transcript_has_no_segments(monkeypatch):
    monkeypatch.setattr(transcribe, "get_mode", lambda: "private")
    monkeypatch.setattr(transcribe, "local_stt", _FakeLocal(text=""))
    result = _run(Transcriber(api_key="x").transcribe_wav("/tmp/whatever.wav"))
    assert result["text"] == ""
    assert result["segments"] == []


def test_private_mode_falls_back_to_gemini_when_model_missing(monkeypatch):
    monkeypatch.setattr(transcribe, "get_mode", lambda: "private")
    fake = _FakeLocal(boom=RuntimeError("model missing at /tmp"))
    monkeypatch.setattr(transcribe, "local_stt", fake)

    async def fake_gemini(self, wav_path):
        return {"text": "gemini fallback", "language_code": None, "segments": []}

    monkeypatch.setattr(Transcriber, "_gemini_transcribe", fake_gemini)

    result = _run(Transcriber(api_key="x").transcribe_wav("/tmp/whatever.wav"))
    assert result["text"] == "gemini fallback"
    assert "model missing" in fake.fallback_reason


def test_local_transcribe_wraps_runtime_error_as_unavailable(monkeypatch):
    monkeypatch.setattr(
        local_stt, "transcribe", lambda p: (_ for _ in ()).throw(RuntimeError("boom"))
    )
    try:
        _run(transcribe._local_transcribe("/tmp/whatever.wav"))
    except LocalSttUnavailable as exc:
        assert "boom" in str(exc)
    else:
        raise AssertionError("expected LocalSttUnavailable")


def test_local_transcribe_returns_the_shared_shape(monkeypatch):
    monkeypatch.setattr(
        local_stt, "transcribe",
        lambda p: {
            "text": "analiz shart emas",
            "turns": [
                {"start": 0.0, "end": 2.5, "text": "analiz shart emas"},
                {"start": 3.0, "end": 5.0, "text": "bir yarim million"},
            ],
            "duration_sec": 5.0,
        },
    )
    result = _run(transcribe._local_transcribe("/tmp/whatever.wav"))
    assert set(result) == {"text", "language_code", "segments"}
    assert result["segments"][0]["text"] == "analiz shart emas"
    # each timed turn becomes its own segment, ready for a speaker label
    assert len(result["segments"]) == 2
    assert result["segments"][1]["start"] == 3.0
    assert all(s["speaker_label"] is None for s in result["segments"])


def test_transcriber_does_not_need_a_gemini_key_to_construct():
    """Regression: the client was built eagerly, so private mode crashed on a
    deployment with no GEMINI_API_KEY even though it never calls Gemini."""
    t = Transcriber(api_key="")
    assert t._client is None


def test_local_stt_status_shape():
    st = local_stt.status()
    assert set(st) >= {"provider", "model", "available", "languages"}
    assert st["provider"] == "local"
    assert isinstance(st["available"], bool)