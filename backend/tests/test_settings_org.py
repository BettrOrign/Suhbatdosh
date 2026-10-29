"""Org profile (GET/PATCH /api/settings/org), feature flags and the live prompt."""

import pytest

from app import db
from conftest import auth


@pytest.fixture(autouse=True)
def clean_state():
    yield
    db.set_bot_setting(db.ORG_PROFILE_KEY, "")
    for key in db.FLAG_DEFAULTS:
        db.set_bot_setting(f"flag_{key}", "")
    db.set_bot_setting("retention_days", "0")


def test_org_get_requires_auth(client):
    assert client.get("/api/settings/org").status_code == 401


def test_org_patch_requires_admin(client, manager_token):
    assert (
        client.patch("/api/settings/org", json={"name": "X"}, headers=auth(manager_token)).status_code
        == 403
    )


def test_org_roundtrip(client, admin_token):
    r = client.patch(
        "/api/settings/org",
        json={"name": "O'quv markaz Test", "rules": "Salomlashish majburiy"},
        headers=auth(admin_token),
    )
    assert r.status_code == 200
    assert r.json()["profile"]["name"] == "O'quv markaz Test"
    got = client.get("/api/settings/org", headers=auth(admin_token)).json()
    assert got["profile"]["rules"] == "Salomlashish majburiy"
    assert got["updated_at"]


def test_org_patch_empty_value_clears_field(client, admin_token):
    client.patch("/api/settings/org", json={"name": "X"}, headers=auth(admin_token))
    r = client.patch("/api/settings/org", json={"name": ""}, headers=auth(admin_token))
    assert r.status_code == 200
    assert "name" not in r.json()["profile"]


def test_org_patch_rejects_unknown_field(client, admin_token):
    r = client.patch("/api/settings/org", json={"bogus": "x"}, headers=auth(admin_token))
    assert r.status_code == 400


def test_flags_roundtrip(client, admin_token):
    r = client.patch(
        "/api/settings", json={"flags": {"speaker_labels": True}}, headers=auth(admin_token)
    )
    assert r.status_code == 200
    flags = r.json()["flags"]
    assert flags["speaker_labels"] is True
    # other flags keep their defaults
    assert flags["punctuation"] is True
    assert db.get_flag("speaker_labels") is True


def test_flags_reject_unknown_and_non_bool(client, admin_token):
    r = client.patch(
        "/api/settings", json={"flags": {"nope": True}}, headers=auth(admin_token)
    )
    assert r.status_code == 400
    r = client.patch(
        "/api/settings", json={"flags": {"gpu": "yes"}}, headers=auth(admin_token)
    )
    assert r.status_code == 400


def test_retention_roundtrip(client, admin_token):
    r = client.patch("/api/settings", json={"retention_days": 30}, headers=auth(admin_token))
    assert r.status_code == 200
    assert r.json()["retention_days"] == 30
    assert client.patch(
        "/api/settings", json={"retention_days": 45}, headers=auth(admin_token)
    ).status_code == 400


def test_prompt_reflects_profile(client, admin_token):
    base = client.get("/api/settings/prompt", headers=auth(admin_token)).json()["system_prompt"]
    client.patch(
        "/api/settings/org", json={"rules": "Salomlashish majburiy"}, headers=auth(admin_token)
    )
    now = client.get("/api/settings/prompt", headers=auth(admin_token)).json()["system_prompt"]
    assert "Salomlashish majburiy" in now
    assert "Salomlashish majburiy" not in base
    assert base in now  # the base rubric is still the prefix


def test_purge_audio_requires_retention(client, admin_token):
    r = client.post("/api/settings/purge-audio", headers=auth(admin_token))
    assert r.status_code == 400


# --- org profile web search (Settings → "find automatically") ---------------


def test_org_search_requires_name(client, admin_token):
    r = client.post("/api/settings/org/search", json={}, headers=auth(admin_token))
    assert r.status_code == 400


def test_org_search_requires_admin(client, manager_token):
    r = client.post(
        "/api/settings/org/search",
        json={"name": "Test Centre"},
        headers=auth(manager_token),
    )
    assert r.status_code == 403


@pytest.fixture
def fake_search(monkeypatch):
    """Patch the Gemini-backed search inside routes_settings."""
    calls: dict = {}

    async def _fake(name: str, description: str = "") -> dict:
        calls["args"] = (name, description)
        return {
            "found": True,
            "profile": {"name": "Test Centre", "summary": "A test place."},
            "sources": ["https://example.com/page"],
            "facts": "fact sheet",
        }

    monkeypatch.setattr("app.routes_settings.analysis.search_org_profile", _fake)
    return calls


def test_org_search_is_proposal_only(client, admin_token, fake_search):
    """The search result must NOT persist anything until the admin confirms."""
    r = client.post(
        "/api/settings/org/search",
        json={"name": "Test Centre", "description": "a centre"},
        headers=auth(admin_token),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["found"] is True
    assert body["profile"]["name"] == "Test Centre"
    assert fake_search["args"] == ("Test Centre", "a centre")
    stored = client.get("/api/settings/org", headers=auth(admin_token)).json()["profile"]
    assert stored == {}


def test_org_search_not_found(client, admin_token, monkeypatch):
    async def _fake(name: str, description: str = "") -> dict:
        return {"found": False, "profile": {}, "sources": [], "facts": "TOPIlmadi"}

    monkeypatch.setattr("app.routes_settings.analysis.search_org_profile", _fake)
    r = client.post(
        "/api/settings/org/search", json={"name": "No Such Place"}, headers=auth(admin_token)
    )
    assert r.status_code == 200
    assert r.json()["found"] is False


def test_org_search_backend_error(client, admin_token, monkeypatch):
    async def _fake(name: str, description: str = "") -> dict:
        raise ValueError("Gemini returned non-JSON")

    monkeypatch.setattr("app.routes_settings.analysis.search_org_profile", _fake)
    r = client.post(
        "/api/settings/org/search", json={"name": "Test"}, headers=auth(admin_token)
    )
    assert r.status_code == 502
