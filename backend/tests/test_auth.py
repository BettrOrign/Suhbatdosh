"""Login, logout and role-gating smoke tests."""

from conftest import auth


def test_login_ok(client):
    r = client.post("/api/auth/login", json={"email": "test-admin@example.com", "password": "admin-pass"})
    assert r.status_code == 200
    body = r.json()
    assert body["token"]
    assert body["user"]["role"] == "admin"


def test_login_wrong_password(client):
    r = client.post("/api/auth/login", json={"email": "test-admin@example.com", "password": "nope"})
    assert r.status_code == 401


def test_login_unknown_user(client):
    r = client.post("/api/auth/login", json={"email": "ghost@example.com", "password": "x"})
    assert r.status_code == 401


def test_unauthenticated_settings_is_401(client):
    assert client.get("/api/settings").status_code == 401


def test_me_requires_token(client):
    assert client.get("/api/auth/me").status_code == 401


def test_logout_deletes_session(client, data_dir):
    """Regression: logout used to read `authorization` as a query param, so the
    session was never actually deleted."""
    from app import db
    from app.auth import hash_password, new_session

    email = "logout-test@example.com"
    if not db.get_user_by_email(email):
        uid = db.create_user("Logout", email, hash_password("pw"), role="admin")
    else:
        uid = db.get_user_by_email(email)["id"]
    token = new_session(uid)
    headers = auth(token)

    assert client.get("/api/auth/me", headers=headers).status_code == 200
    assert client.post("/api/auth/logout", headers=headers).status_code == 200
    # The session must really be gone afterwards.
    assert client.get("/api/auth/me", headers=headers).status_code == 401