"""The segment shape the app persists and the transcript page renders.

``calls.segments`` is a JSON text column read back by
``frontend/src/lib/types.ts`` as ``Segment``. If this shape drifts the call
detail page breaks silently -- nothing validates it on the way out.

Timed turns from local STT are the source: each becomes one segment, carrying
a ``speaker_label`` slot that diarization will fill later.
"""

import asyncio

import pytest

from app import local_stt, transcribe
from app.transcribe import _local_transcribe


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture
def fake_local(monkeypatch):
    """Replace local STT with a scripted turn list."""
    def install(turns=(), text="", boom=None):
        def transcribe(path):
            if boom:
                raise boom
            return {"text": text, "turns": list(turns), "duration_sec": 10.0}

        monkeypatch.setattr(local_stt, "transcribe", transcribe)
        return local_stt

    return install


def test_each_turn_becomes_its_own_segment(fake_local):
    fake_local(turns=[
        {"start": 0.0, "end": 2.5, "text": "да как только вы приобрели"},
        {"start": 4.0, "end": 6.0, "text": "номер уже в наличии оплачен"},
    ])

    result = _run(_local_transcribe("/tmp/whatever.wav"))

    assert len(result["segments"]) == 2
    assert result["segments"][0]["text"] == "да как только вы приобрели"
    assert result["segments"][1]["text"] == "номер уже в наличии оплачен"


def test_segments_carry_timings(fake_local):
    """Times drive transcript seeking and are what make turns navigable."""
    fake_local(turns=[{"start": 12.5, "end": 15.75, "text": "да"}])

    result = _run(_local_transcribe("/tmp/whatever.wav"))

    assert result["segments"][0]["start"] == 12.5
    assert result["segments"][0]["end"] == 15.75


def test_speaker_label_slot_is_present_and_empty(fake_local):
    """Diarization is deferred; the slot must already exist for it."""
    fake_local(turns=[{"start": 0.0, "end": 1.0, "text": "да"}])

    segment = _run(_local_transcribe("/tmp/whatever.wav"))["segments"][0]

    assert "speaker_label" in segment
    assert segment["speaker_label"] is None


def test_finished_and_language_code_keys_are_always_present(fake_local):
    """The frontend Segment type requires these, so they are never omitted."""
    fake_local(turns=[{"start": 0.0, "end": 1.0, "text": "да"}])

    segment = _run(_local_transcribe("/tmp/whatever.wav"))["segments"][0]

    assert set(segment) >= {"text", "finished", "speaker_label",
                            "language_code", "start", "end"}


def test_empty_turns_fall_back_to_one_segment(fake_local):
    """No timings still yields a readable transcript rather than nothing."""
    fake_local(turns=[], text="analiz shart emas")

    result = _run(_local_transcribe("/tmp/whatever.wav"))

    assert result["text"] == "analiz shart emas"
    assert len(result["segments"]) == 1
    assert result["segments"][0]["text"] == "analiz shart emas"


def test_blank_turns_are_dropped(fake_local):
    """Empty turns are chatter artefacts and must not reach the database."""
    fake_local(turns=[
        {"start": 0.0, "end": 1.0, "text": "да"},
        {"start": 1.0, "end": 1.2, "text": "   "},
        {"start": 2.0, "end": 3.0, "text": "нет"},
    ])

    result = _run(_local_transcribe("/tmp/whatever.wav"))

    assert [s["text"] for s in result["segments"]] == ["да", "нет"]


def test_empty_call_produces_no_segments(fake_local):
    fake_local(turns=[], text="")

    result = _run(_local_transcribe("/tmp/whatever.wav"))

    assert result["segments"] == []


def test_top_level_shape_matches_the_gemini_path(fake_local):
    """Private and online must return the same keys or callers diverge."""
    fake_local(turns=[{"start": 0.0, "end": 1.0, "text": "да"}])

    result = _run(_local_transcribe("/tmp/whatever.wav"))

    assert set(result) == {"text", "language_code", "segments"}


def test_local_failure_becomes_unavailable_not_a_crash(fake_local):
    """Callers catch one exception type; anything else escapes."""
    from app.transcribe import LocalSttUnavailable

    fake_local(boom=RuntimeError("model missing"))

    with pytest.raises(LocalSttUnavailable):
        _run(_local_transcribe("/tmp/whatever.wav"))