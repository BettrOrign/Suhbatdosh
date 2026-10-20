"""Drill-down from a ranking row to that person's calls.

`db.get_manager_rankings` ranks `manager` AND `yonalish` owners of
`call_type = 'manager'` calls, and the Analytics leaderboard plus the Employees
directory both drill down from those rows via `/api/managers/{id}/calls`. The
route used to reject any owner whose role was not exactly `manager`, so every
drill-down from a supervisor row 404'd.
"""

from app import db
from app.auth import hash_password


def _ensure_user(email: str, name: str, role: str) -> int:
    existing = db.get_user_by_email(email)
    if existing:
        return existing["id"]
    return db.create_user(name, email, hash_password("pw-for-test"), role=role)


def test_manager_calls_allow_yonalish_owner(client, admin_token):
    """A supervisor owns manager-type calls, so their drill-down must work."""
    from conftest import auth

    uid = _ensure_user("test-supervisor@example.com", "Test Supervisor", "yonalish")
    r = client.get(f"/api/managers/{uid}/calls", headers=auth(admin_token))
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list)


def test_manager_calls_allow_manager_owner(client, admin_token):
    from conftest import auth

    uid = _ensure_user("test-owner@example.com", "Test Owner", "manager")
    r = client.get(f"/api/managers/{uid}/calls", headers=auth(admin_token))
    assert r.status_code == 200, r.text


def test_manager_calls_reject_receptionist_owner(client, admin_token):
    """Receptionists own receptionist calls; they are not in this listing."""
    from conftest import auth

    uid = _ensure_user("test-reception@example.com", "Test Reception", "receptionist")
    r = client.get(f"/api/managers/{uid}/calls", headers=auth(admin_token))
    assert r.status_code == 404, r.text


def test_manager_calls_reject_unknown_id(client, admin_token):
    from conftest import auth

    assert client.get("/api/managers/999999/calls", headers=auth(admin_token)).status_code == 404


def test_manager_calls_require_privileged_viewer(client, manager_token):
    """The viewer still needs admin or yonalish — this is about the owner."""
    from conftest import auth

    uid = _ensure_user("test-owner-2@example.com", "Test Owner 2", "manager")
    r = client.get(f"/api/managers/{uid}/calls", headers=auth(manager_token))
    assert r.status_code == 403
