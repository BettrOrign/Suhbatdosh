"""Tests for stereo diarization, acoustic metrics, bookmarks, and cross-call AI insights."""

import array
import json
import wave
from pathlib import Path

from app import audio, db
from conftest import auth


def _write_test_wav(path: Path, channels: int, sample_rate: int, frames_data: list[int]) -> None:
    arr = array.array("h", frames_data)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(arr.tobytes())


def test_mono_acoustics_detects_silence(tmp_path):
    sr = 16000
    # 1s of speech (amplitude 4000), followed by 2s of silence (0), followed by 1s of speech
    samples = [4000] * sr + [0] * (sr * 2) + [4000] * sr
    wav_path = tmp_path / "mono.wav"
    _write_test_wav(wav_path, 1, sr, samples)

    res = audio.compute_acoustics(wav_path)
    assert res["channels"] == 1
    assert res["longest_silence_sec"] >= 1.9
    assert res["silence_sec"] >= 1.9
    assert 0.45 <= res["silence_ratio"] <= 0.55


def test_stereo_acoustics_and_speaker_assignment(tmp_path):
    sr = 16000
    # 3 seconds stereo:
    # 0-1s: Left active (Sotuvchi = 5000), Right silent (0)
    # 1-2s: Left silent (0), Right active (Mijoz = 5000)
    # 2-3s: Both active (Overlap: L=5000, R=5000)
    stereo_samples: list[int] = []
    for _ in range(sr):
        stereo_samples.extend([5000, 0])
    for _ in range(sr):
        stereo_samples.extend([0, 5000])
    for _ in range(sr):
        stereo_samples.extend([5000, 5000])

    src_stereo = tmp_path / "stereo_src.wav"
    mono_norm = tmp_path / "mono_norm.wav"
    _write_test_wav(src_stereo, 2, sr, stereo_samples)
    _write_test_wav(mono_norm, 1, sr, [5000] * (sr * 3))

    res = audio.compute_acoustics(mono_norm, src_path=src_stereo)
    assert res["channels"] == 2
    assert res["interruption_count"] >= 1
    assert res["talk_over_sec"] >= 0.8

    segments = [
        {"speaker": "Speaker 1", "text": "Salom", "start": 0.1, "end": 0.9},
        {"speaker": "Speaker 1", "text": "Kurs narxi qancha?", "start": 1.1, "end": 1.9},
    ]
    assigned = audio.assign_stereo_speakers(segments, res)
    assert assigned[0]["speaker_label"] == "Sotuvchi"
    assert assigned[1]["speaker_label"] == "Mijoz"


def test_call_bookmark_and_resolved_roundtrip(client, admin_token):
    admin = db.get_user_by_email("test-admin@example.com")
    cid = db.create_call(
        name="Coaching Demo Call",
        audio_path="/tmp/nonexistent.wav",
        user_id=admin["id"],
    )

    r = client.patch(
        f"/api/calls/{cid}",
        json={"bookmarked": True, "bookmark_note": "Ajoyib e'tiroz yechimi", "resolved": True},
        headers=auth(admin_token),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["bookmarked"] is True
    assert body["bookmark_note"] == "Ajoyib e'tiroz yechimi"
    assert body["resolved"] is True

    fetched = client.get(f"/api/calls/{cid}", headers=auth(admin_token)).json()
    assert fetched["bookmarked"] is True
    assert fetched["bookmark_note"] == "Ajoyib e'tiroz yechimi"
    assert fetched["resolved"] is True


def test_cross_call_insights_and_ask(client, admin_token, monkeypatch):
    admin = db.get_user_by_email("test-admin@example.com")
    cid = db.create_call(
        name="Insight Call",
        audio_path="/tmp/nonexistent2.wav",
        user_id=admin["id"],
    )
    analysis_payload = {
        "topic": "Ingliz tili kursi",
        "summary": "Mijoz narx haqida so'radi",
        "language": "uz",
        "outcome": "uncertain",
        "scorecard": {
            "opening": 80,
            "discovery": 45,
            "objection_handling": 40,
            "value_prop": 70,
            "closing": 35,
            "rapport": 85,
            "talk_ratio": 75,
            "overall": 60,
        },
        "objections": ["Narxi qimmat ekan", "Vaqtim to'g'ri kelmaydi"],
        "coaching_points": ["Skidkalar haqida aytilmadi"],
    }
    with db.get_db() as conn:
        conn.execute(
            "UPDATE calls SET status='done', transcript=?, analysis=? WHERE id=?",
            ("Mijoz: Narxi qimmat ekan.", json.dumps(analysis_payload), cid),
        )

    r = client.get("/api/stats/insights", headers=auth(admin_token))
    assert r.status_code == 200
    ins = r.json()
    assert ins["analyzed_calls"] >= 1
    assert any(o["text"] == "Narxi qimmat ekan" for o in ins["top_objections"])
    assert len(ins["weakest_dimensions"]) > 0

    async def fake_ask(self, question: str, calls_context: list[dict]) -> dict:
        return {
            "answer": f"Savolingiz: {question}. Mijozlar asosan narxdan shikoyat qilgan.",
            "cited_call_ids": [cid],
            "recommendations": ["Bo'lib to'lash imkoniyatini tushuntiring"],
        }

    from app.analysis import Analyzer

    monkeypatch.setattr(Analyzer, "ask_across_calls", fake_ask)

    ask_res = client.post(
        "/api/stats/ask",
        json={"question": "Nega mijozlar rad etyapti?"},
        headers=auth(admin_token),
    )
    assert ask_res.status_code == 200
    ans = ask_res.json()
    assert cid in ans["cited_call_ids"]
    assert len(ans["recommendations"]) == 1
