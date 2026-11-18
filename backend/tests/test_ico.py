"""Tests for the integrated ICO live voice AI operator."""

from app import config
from app.ico import ai_operator
from conftest import auth


def test_ico_settings_requires_auth_and_persists(client, admin_token):
    assert client.get("/api/ico/settings").status_code == 401

    r = client.get("/api/ico/settings", headers=auth(admin_token))
    assert r.status_code == 200
    body = r.json()
    assert body["avatar_name"]
    assert "Aoede" in body["voices"]
    assert "uz" in body["languages"]

    r2 = client.post(
        "/api/ico/settings",
        headers=auth(admin_token),
        json={"voice": "Kore", "lang": "uz"},
    )
    assert r2.status_code == 200
    assert r2.json() == {"voice": "Kore", "lang": "uz"}


def test_ico_knowledge_and_school_db_tools():
    prompt = ai_operator.build_system_instruction(lang="uz")
    assert "o'zbek" in prompt.lower()

    kb = ai_operator.handle_tool("lookup_knowledge", {"question": "MBSI"})
    assert isinstance(kb, dict)
    assert "error" not in kb

    people = ai_operator.handle_tool("search_people", {"query": "Aziz"})
    assert isinstance(people, dict)
    assert people.get("results")


def test_ico_websocket_handles_missing_api_key_gracefully(client, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setattr(config, "GEMINI_API_KEY", "")

    with client.websocket_connect("/ws/ico?lang=uz") as ws:
        msg = ws.receive_json()
        assert msg["type"] == "error"
        assert "GEMINI_API_KEY" in msg["message"]
