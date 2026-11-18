"""Tests for Telegram bot command/token fixes and Settings notification masking."""

import asyncio

from app import config, db, telegram_bot
from conftest import auth


def test_telegram_bot_registers_all_commands_and_problems_callback(monkeypatch):
    monkeypatch.setattr(config, "TELEGRAM_BOT_TOKEN", "123456:TEST_TOKEN")

    async def _build():
        return telegram_bot.create_bot_application()

    app = asyncio.run(_build())
    assert app is not None

    commands = set()
    callback_patterns = []
    for group_handlers in app.handlers.values():
        for h in group_handlers:
            if hasattr(h, "commands"):
                commands.update(h.commands)
            if hasattr(h, "pattern") and h.pattern is not None:
                callback_patterns.append(h.pattern.pattern)

    expected_commands = {
        "start",
        "help",
        "status",
        "link",
        "recordings",
        "search",
        "stats",
        "admin",
        "unsubscribe",
        "org",
        "skip",
        "cancel",
    }
    assert expected_commands.issubset(commands)
    assert any("problems" in p for p in callback_patterns)


def test_telegram_resolve_token_falls_back_to_org_settings(monkeypatch):
    monkeypatch.setattr(config, "TELEGRAM_BOT_TOKEN", "")
    db.set_notification_settings({"telegram_bot_token": "999888:ORG_TOKEN"}, org_id=1)
    assert telegram_bot.resolve_bot_token() == "999888:ORG_TOKEN"


def test_telegram_is_admin_recognizes_linked_web_admin(monkeypatch):
    monkeypatch.setattr(config, "TELEGRAM_ADMIN_IDS", [])
    assert telegram_bot._is_admin(4242, None) is False
    assert telegram_bot._is_admin(4242, {"id": 1, "role": "manager"}) is False
    assert telegram_bot._is_admin(4242, {"id": 1, "role": "admin"}) is True


def test_notification_settings_masks_telegram_token_and_preserves_on_patch(client, admin_token, monkeypatch):
    monkeypatch.setattr(config, "TELEGRAM_ENABLED", False)

    r = client.patch(
        "/api/settings/notifications",
        headers=auth(admin_token),
        json={
            "telegram_bot_token": "111222:SECRET_TG_TOKEN",
            "telegram_default_chat_id": "-100555666",
            "telegram_alerts_enabled": True,
            "escalation_score_threshold": 150,
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["has_telegram_bot_token"] is True
    assert body["telegram_bot_token"] == "••••••••"
    assert body["escalation_score_threshold"] == 100

    # Sending masked placeholder back should NOT overwrite the real stored token
    r2 = client.patch(
        "/api/settings/notifications",
        headers=auth(admin_token),
        json={
            "telegram_bot_token": "••••••••",
            "telegram_default_chat_id": "-100777888",
        },
    )
    assert r2.status_code == 200
    assert db.get_notification_settings(org_id=1)["telegram_bot_token"] == "111222:SECRET_TG_TOKEN"


def test_test_telegram_uses_saved_token_when_masked(client, admin_token, monkeypatch):
    db.set_notification_settings(
        {"telegram_bot_token": "333444:SAVED_TOKEN", "telegram_default_chat_id": "-100123"},
        org_id=1,
    )
    captured = {}

    def fake_send(chat_id, text, bot_token):
        captured["chat_id"] = chat_id
        captured["bot_token"] = bot_token
        return True, "sent"

    monkeypatch.setattr("app.notifications_dispatcher.send_telegram_alert", fake_send)

    r = client.post(
        "/api/settings/notifications/test-telegram",
        headers=auth(admin_token),
        json={"telegram_bot_token": "••••••••", "telegram_default_chat_id": "-100123"},
    )
    assert r.status_code == 200
    assert captured["bot_token"] == "333444:SAVED_TOKEN"
    assert captured["chat_id"] == "-100123"


def test_problem_alerts_flag_persists_via_settings(client, admin_token):
    r = client.patch(
        "/api/settings",
        headers=auth(admin_token),
        json={"flags": {"problem_alerts": False}},
    )
    assert r.status_code == 200
    assert r.json()["flags"]["problem_alerts"] is False

    r2 = client.patch(
        "/api/settings",
        headers=auth(admin_token),
        json={"flags": {"problem_alerts": True}},
    )
    assert r2.status_code == 200
    assert r2.json()["flags"]["problem_alerts"] is True
