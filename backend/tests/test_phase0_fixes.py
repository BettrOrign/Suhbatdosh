from starlette.testclient import TestClient

from app import audio, db
from app.auth import hash_password, new_session


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_escalation_access_control(client: TestClient, admin_token: str):
    """Managers cannot view receptionist call escalations or resolve others' escalations."""
    mgr_id = db.create_user("Mgr", "mgr-p0@example.com", hash_password("Pass!12345"), role="manager")
    other_mgr_id = db.create_user("Other", "other-p0@example.com", hash_password("Pass!12345"), role="manager")
    mgr_tok = new_session(mgr_id)
    other_tok = new_session(other_mgr_id)

    rec_call_id = db.create_call(
        name="Receptionist Call",
        audio_path="",
        call_type="receptionist",
        org_id=1,
    )
    esc_id = db.create_escalation(
        org_id=1,
        call_id=rec_call_id,
        detected_problem="Parent waited too long",
        assigned_to_user_id=other_mgr_id,
        assigned_reason="Follow up",
    )

    # Manager cannot read escalation on a receptionist call
    assert client.get(f"/api/calls/{rec_call_id}/escalation", headers=_auth(mgr_tok)).status_code == 403

    # Unassigned manager cannot resolve another user's escalation
    assert client.post(
        f"/api/escalations/{esc_id}/resolve",
        json={"notes": "hijack"},
        headers=_auth(mgr_tok),
    ).status_code == 403

    # Assigned manager can resolve their own escalation
    res = client.post(
        f"/api/escalations/{esc_id}/resolve",
        json={"notes": "Called parent back"},
        headers=_auth(other_tok),
    )
    assert res.status_code == 200
    assert res.json()["escalation"]["status"] == "resolved"


def test_purge_expired_audio_is_org_scoped():
    """Purging expired audio for org 2 does not touch org 1's recordings."""
    org2 = db.create_organization("Other Center", "other-center")["id"]
    c1 = db.create_call(name="Org1 Old", audio_path="/tmp/nonexistent_org1.wav", org_id=1)
    c2 = db.create_call(name="Org2 Old", audio_path="/tmp/nonexistent_org2.wav", org_id=org2)

    with db.get_db() as conn:
        conn.execute("UPDATE calls SET created_at = '2020-01-01T00:00:00Z' WHERE id IN (?, ?)", (c1, c2))
        conn.commit()

    purged = audio.purge_expired_audio(30, org_id=org2)
    assert purged == 1
    assert db.get_call(c1)["audio_path"] == "/tmp/nonexistent_org1.wav"
    assert db.get_call(c2)["audio_path"] is None


def test_me_overview_contract(client: TestClient):
    """GET /api/me/overview returns the exact contract expected by EmployeeHome.tsx."""
    rec_id = db.create_user("Rec", "rec-p0@example.com", hash_password("Pass!12345"), role="receptionist")
    rec_tok = new_session(rec_id)
    res = client.get("/api/me/overview", headers=_auth(rec_tok))
    assert res.status_code == 200
    body = res.json()
    for key in ("kpis", "rank", "weekly_trend", "rubric_averages", "coaching_points", "tasks", "recent_calls"):
        assert key in body
    assert "position" in body["rank"]
    assert "total_peers" in body["rank"]
    assert "calls_this_week" in body["kpis"]
