"""GET/PATCH /api/settings — see docs/CONTRACT.md."""

import pytest

from app import db, transcribe
from conftest import auth


@pytest.fixture(autouse=True)
def reset_mode():
    yield
    db.set_bot_setting(transcribe.MODE_SETTING_KEY, "online")


def test_get_settings_requires_auth(client):
    assert client.get("/api/settings").status_code == 401


def test_get_settings_as_admin(client, admin_token):
    r = client.get("/api/settings", headers=auth(admin_token))
    assert r.status_code == 200
    body = r.json()
    assert body["mode"] in ("online", "private")
    assert body["stt"]["provider"] == "local"
    assert isinstance(body["stt"]["available"], bool)
    assert isinstance(body["stt"]["languages"], list)
    assert body["analysis"]["provider"] == "gemini"
    assert "updated_at" in body


def test_get_settings_as_non_admin(client, manager_token):
    """A non-admin must be able to READ the mode so the UI can display it."""
    r = client.get("/api/settings", headers=auth(manager_token))
    assert r.status_code == 200
    assert r.json()["mode"] in ("online", "private")


def test_patch_settings_as_admin(client, admin_token):
    r = client.patch("/api/settings", json={"mode": "private"}, headers=auth(admin_token))
    assert r.status_code == 200
    assert r.json()["mode"] == "private"
    # persisted, not just echoed
    assert db.get_bot_setting("processing_mode") == "private"


def test_patch_settings_as_non_admin_is_403(client, manager_token):
    r = client.patch("/api/settings", json={"mode": "private"}, headers=auth(manager_token))
    assert r.status_code == 403
    assert db.get_bot_setting("processing_mode", "online") == "online"


def test_patch_settings_unauthenticated_is_401(client):
    assert client.patch("/api/settings", json={"mode": "private"}).status_code == 401


def test_patch_rejects_invalid_mode(client, admin_token):
    for bad in ("offline", "", "PRIVATE!", None, 42):
        r = client.patch("/api/settings", json={"mode": bad}, headers=auth(admin_token))
        assert r.status_code == 400, bad
    assert db.get_bot_setting("processing_mode", "online") == "online"


def test_patch_requires_mode_key(client, admin_token):
    r = client.patch("/api/settings", json={}, headers=auth(admin_token))
    assert r.status_code == 400


def test_mode_persists_across_reads(client, admin_token):
    client.patch("/api/settings", json={"mode": "private"}, headers=auth(admin_token))
    assert client.get("/api/settings", headers=auth(admin_token)).json()["mode"] == "private"
    client.patch("/api/settings", json={"mode": "online"}, headers=auth(admin_token))
    assert client.get("/api/settings", headers=auth(admin_token)).json()["mode"] == "online"
    assert db.get_bot_setting("processing_mode") == "online"


def test_mode_normalises_case(client, admin_token):
    r = client.patch("/api/settings", json={"mode": "  Private "}, headers=auth(admin_token))
    assert r.status_code == 200
    assert r.json()["mode"] == "private"


def test_transcribe_get_mode_reads_db(client, admin_token):
    client.patch("/api/settings", json={"mode": "private"}, headers=auth(admin_token))
    assert transcribe.get_mode() == "private"
    client.patch("/api/settings", json={"mode": "online"}, headers=auth(admin_token))
    assert transcribe.get_mode() == "online"


def test_unknown_stored_mode_defaults_to_online():
    db.set_bot_setting("processing_mode", "garbage")
    assert transcribe.get_mode() == "online"
    db.set_bot_setting("processing_mode", "online")