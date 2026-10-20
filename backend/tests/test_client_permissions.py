"""Client write/read permissions and the manager picker behind them.

Two asymmetries these lock down:
- `POST /api/clients` honoured `manager_id` for a receptionist while
  `PATCH /api/clients/{id}` dropped it, so the reception desk's assignment
  vanished on every edit after the first save.
- `GET /api/users` is admin/yonalish only, but the client form's manager
  dropdown is shown to receptionists — leaving them a permanently empty select.
"""

from app import db
from app.auth import hash_password


def _ensure_user(email: str, name: str, role: str) -> int:
    existing = db.get_user_by_email(email)
    if existing:
        return existing["id"]
    return db.create_user(name, email, hash_password("pw-for-test"), role=role)


def _receptionist_token() -> str:
    from app.auth import new_session

    uid = _ensure_user("test-reception2@example.com", "Test Front Desk", "receptionist")
    return new_session(uid)


def test_manager_options_available_to_receptionist(client):
    from conftest import auth

    r = client.get("/api/managers/options", headers=auth(_receptionist_token()))
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, list)
    # Narrow projection: no email, no token, no role fan-out.
    assert all(set(item) == {"id", "name"} for item in body)


def test_manager_options_denied_to_plain_manager(client, manager_token):
    from conftest import auth

    assert client.get("/api/managers/options", headers=auth(manager_token)).status_code == 403


def test_receptionist_can_assign_and_reassign_a_manager(client, admin_token):
    from conftest import auth

    token = _receptionist_token()
    manager_id = _ensure_user("test-picker@example.com", "Test Picker", "manager")

    created = client.post(
        "/api/clients",
        headers=auth(token),
        json={"name": "Reception Client", "manager_id": manager_id},
    )
    assert created.status_code == 200, created.text
    client_id = created.json()["id"]
    assert created.json()["manager_id"] == manager_id

    other_manager = _ensure_user("test-picker2@example.com", "Test Picker 2", "manager")
    patched = client.patch(
        f"/api/clients/{client_id}",
        headers=auth(token),
        json={"manager_id": other_manager},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["manager_id"] == other_manager


def test_manager_cannot_reassign_client_owner(client, manager_token):
    """A manager edits their own records but must not hand them to someone else."""
    from conftest import auth

    me = db.get_user_by_email("test-manager@example.com")
    client_id = db.create_client("Owned Client", manager_id=me["id"])
    other = _ensure_user("test-picker3@example.com", "Test Picker 3", "manager")

    patched = client.patch(
        f"/api/clients/{client_id}",
        headers=auth(manager_token),
        json={"name": "Renamed", "manager_id": other},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["manager_id"] == me["id"], "a manager must not reassign ownership"


def test_admin_still_can_assign(client, admin_token):
    from conftest import auth

    manager_id = _ensure_user("test-picker4@example.com", "Test Picker 4", "manager")
    created = client.post(
        "/api/clients", headers=auth(admin_token), json={"name": "Admin Client", "manager_id": manager_id}
    )
    assert created.status_code == 200
    assert created.json()["manager_id"] == manager_id


def test_yonalish_cannot_write_clients(client, admin_token):
    """The nav gives yonalish the /clients page, but every write is refused."""
    from app.auth import new_session
    from conftest import auth

    uid = _ensure_user("test-supervisor2@example.com", "Test Supervisor 2", "yonalish")
    token = new_session(uid)

    assert client.get("/api/clients", headers=auth(token)).status_code == 200
    assert client.post("/api/clients", headers=auth(token), json={"name": "Nope"}).status_code == 403
