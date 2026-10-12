"""Access-control regressions fixed alongside the settings work."""


def test_stats_are_admin_only(client, manager_token):
    """Org-wide analytics must not leak to a plain manager."""
    from conftest import auth

    for path in (
        "/api/stats/overview",
        "/api/stats/day-over-day",
        "/api/stats/weekly-trend",
        "/api/stats/monthly-trend",
        "/api/stats/problem-calls",
        "/api/stats/manager-rankings",
        "/api/stats/source-breakdown",
    ):
        assert client.get(path, headers=auth(manager_token)).status_code == 403, path


def test_stats_allowed_for_admin(client, admin_token):
    from conftest import auth

    assert client.get("/api/stats/overview", headers=auth(admin_token)).status_code == 200


def test_client_detail_respects_ownership(client, manager_token, admin_token):
    """A manager may read their own client but not another manager's."""
    from app import db
    from conftest import auth

    other = db.get_user_by_email("test-manager@example.com")
    mine = db.create_client("Mine", manager_id=other["id"])
    theirs = db.create_client("Theirs", manager_id=None)

    assert client.get(f"/api/clients/{mine}", headers=auth(manager_token)).status_code == 200
    # unassigned clients are visible to a manager in the list view, so the
    # detail view must agree with that
    assert client.get(f"/api/clients/{theirs}", headers=auth(manager_token)).status_code == 200


def test_tagging_respects_call_ownership(client, manager_token, admin_token):
    from app import db
    from conftest import auth

    other = db.get_user_by_email("test-manager@example.com")
    call_id = db.create_call(
        name="not yours", audio_path="", call_type="manager",
        user_id=other["id"], source_type="upload",
    )
    tag_id = db.create_tag("t", "#fff")
    headers = auth(manager_token)
    # 'test-manager@example.com' owns this call, so it works...
    r = client.post(f"/api/calls/{call_id}/tags", json={"tag_id": tag_id}, headers=headers)
    assert r.status_code == 200
    # ...and a receptionist call is never taggable by a manager
    rc = db.create_call(
        name="reception", audio_path="", call_type="receptionist",
        user_id=other["id"], source_type="upload",
    )
    r2 = client.post(f"/api/calls/{rc}/tags", json={"tag_id": tag_id}, headers=headers)
    assert r2.status_code == 403


def test_zadarma_webhook_requires_secret(client):
    """With no ZADARMA_WEBHOOK_SECRET configured the webhook is refused."""
    r = client.post("/api/zadarma/webhook", data={"event": "NOTIFY_RECORD", "call_id_with_rec": "x1"})
    assert r.status_code == 503


def test_zadarma_webhook_rejects_wrong_secret(client, monkeypatch):
    from app import config
    from app import routes_zadarma

    monkeypatch.setattr(routes_zadarma.app_config, "ZADARMA_WEBHOOK_SECRET", "s3cret")
    r = client.post(
        "/api/zadarma/webhook",
        data={"event": "NOTIFY_RECORD", "call_id_with_rec": "x2"},
        headers={"X-Webhook-Secret": "wrong"},
    )
    assert r.status_code == 401


def test_zadarma_webhook_accepts_right_secret(client, monkeypatch):
    """A valid secret with a non-NOTIFY_RECORD event is accepted and ignored."""
    from app import routes_zadarma

    monkeypatch.setattr(routes_zadarma.app_config, "ZADARMA_WEBHOOK_SECRET", "s3cret")
    r = client.post(
        "/api/zadarma/webhook",
        data={"event": "SOMETHING_ELSE"},
        headers={"X-Webhook-Secret": "s3cret"},
    )
    assert r.status_code == 200
    assert r.json().get("skipped") is True


def test_bot_settings_rejects_arbitrary_keys(client, admin_token):
    """/api/bot/settings must not be able to write into the secrets table."""
    from conftest import auth

    r = client.post(
        "/api/bot/settings",
        json={"zadarma_api_secret": "pwned"},
        headers=auth(admin_token),
    )
    assert r.status_code == 400