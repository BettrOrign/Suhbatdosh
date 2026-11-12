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


def test_cookie_auth_and_csrf_protection(client):
    """Browser login sets httpOnly sd_session + sd_csrf cookies and enforces X-CSRF-Token on writes."""
    r = client.post("/api/auth/login", json={"email": "test-admin@example.com", "password": "admin-pass"})
    assert r.status_code == 200
    assert "sd_session" in client.cookies
    csrf = client.cookies.get("sd_csrf")
    assert csrf

    # GET works with cookie alone
    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.headers.get("X-Frame-Options") == "DENY"
    assert me.headers.get("X-Content-Type-Options") == "nosniff"
    assert "Content-Security-Policy" in me.headers

    # PATCH without X-CSRF-Token is rejected with 403
    bad_patch = client.patch("/api/auth/me", json={"name": "No CSRF"})
    assert bad_patch.status_code == 403

    # PATCH with valid X-CSRF-Token succeeds
    good_patch = client.patch(
        "/api/auth/me",
        json={"name": "Test Admin Updated"},
        headers={"X-CSRF-Token": csrf},
    )
    assert good_patch.status_code == 200
    assert good_patch.json()["name"] == "Test Admin Updated"


def test_session_tokens_are_hashed_in_db_and_query_token_rejected(client):
    """Raw session tokens must never be stored in plaintext or accepted via ?token= query param."""
    from app import db

    r = client.post("/api/auth/login", json={"email": "test-admin@example.com", "password": "admin-pass"})
    raw_token = r.json()["token"]
    client.cookies.clear()

    with db.get_db() as conn:
        rows = [row[0] for row in conn.execute("SELECT token FROM sessions").fetchall()]
    assert raw_token not in rows

    # Query param ?token= must be rejected
    assert client.get(f"/api/auth/me?token={raw_token}").status_code == 401


def test_login_rate_limiting_lockout(client):
    """5 failed attempts for an email trigger a 429 lockout with Retry-After."""
    email = "lockout-target@example.com"
    for _ in range(5):
        res = client.post("/api/auth/login", json={"email": email, "password": "wrong-password"})
        assert res.status_code == 401

    locked = client.post("/api/auth/login", json={"email": email, "password": "wrong-password"})
    assert locked.status_code == 429
    assert "Retry-After" in locked.headers


def test_signup_invites_and_multitenant_isolation(client, admin_token):
    """A new company signing up gets its own isolated organization and can invite employees."""
    from app import db

    # Create data in Org 1
    org1_call = db.create_call(name="Org1 Secret Call", audio_path="", call_type="manager", org_id=1)
    org1_client = db.create_client("Org1 Secret Client", org_id=1)

    # Sign up Org 2
    signup_res = client.post(
        "/api/auth/signup",
        json={
            "org_name": "Zukko Academy",
            "name": "Aziz Owner",
            "email": "aziz@zukko.uz",
            "password": "StrongPassword!2026",
        },
    )
    assert signup_res.status_code == 200, signup_res.text
    org2_token = signup_res.json()["token"]
    org2_user = signup_res.json()["user"]
    assert org2_user["role"] == "admin"
    assert org2_user["org_name"] == "Zukko Academy"
    assert org2_user["org_id"] != 1
    client.cookies.clear()

    org2_headers = auth(org2_token)

    # Org 2 cannot see Org 1's calls or clients
    assert client.get("/api/calls", headers=org2_headers).json() == []
    assert client.get("/api/clients", headers=org2_headers).json() == []
    assert client.get(f"/api/calls/{org1_call}", headers=org2_headers).status_code == 404
    assert client.get(f"/api/clients/{org1_client}", headers=org2_headers).status_code == 404

    # Org 2 admin creates an invite for a manager
    inv_res = client.post(
        "/api/invites",
        json={"email": "jasur@zukko.uz", "role": "manager"},
        headers=org2_headers,
    )
    assert inv_res.status_code == 200, inv_res.text
    inv_token = inv_res.json()["token"]

    # Inspect invite publicly
    info_res = client.get(f"/api/invites/{inv_token}")
    assert info_res.status_code == 200
    assert info_res.json()["org_name"] == "Zukko Academy"
    assert info_res.json()["role"] == "manager"

    # Accept invite
    accept_res = client.post(
        f"/api/invites/{inv_token}/accept",
        json={"name": "Jasur Sotuvchi", "password": "JasurStrongPassword!1"},
    )
    assert accept_res.status_code == 200, accept_res.text
    jasur_token = accept_res.json()["token"]
    jasur_user = accept_res.json()["user"]
    assert jasur_user["org_id"] == org2_user["org_id"]
    assert jasur_user["role"] == "manager"
    client.cookies.clear()

    # Invite cannot be reused
    assert client.get(f"/api/invites/{inv_token}").status_code == 404

    # Jasur can access his personal overview (/api/me/overview)
    ov = client.get("/api/me/overview", headers=auth(jasur_token))
    assert ov.status_code == 200
    assert "kpis" in ov.json()
    assert "rank" in ov.json()


def test_password_change_revokes_other_sessions_and_role_change_revokes_all(client, admin_token):
    """Changing password revokes other sessions; admin changing role revokes user's sessions."""
    from app import db
    from app.auth import hash_password, new_session

    uid = db.create_user("Session User", "sess-user@example.com", hash_password("InitialPass!123"), role="manager")
    tok1 = new_session(uid, user_agent="Browser 1")
    tok2 = new_session(uid, user_agent="Browser 2")

    # List sessions
    sessions = client.get("/api/auth/sessions", headers=auth(tok1)).json()
    assert len(sessions) == 2

    # Change password using tok1 -> tok2 is revoked, tok1 stays valid
    pw_res = client.post(
        "/api/auth/password",
        json={"current_password": "InitialPass!123", "new_password": "UpdatedPass!456"},
        headers=auth(tok1),
    )
    assert pw_res.status_code == 200
    assert client.get("/api/auth/me", headers=auth(tok1)).status_code == 200
    assert client.get("/api/auth/me", headers=auth(tok2)).status_code == 401

    # Admin changes user's role -> tok1 is also revoked immediately
    patch_res = client.patch(
        f"/api/users/{uid}",
        json={"role": "yonalish"},
        headers=auth(admin_token),
    )
    assert patch_res.status_code == 200
    assert client.get("/api/auth/me", headers=auth(tok1)).status_code == 401