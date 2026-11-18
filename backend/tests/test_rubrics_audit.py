from starlette.testclient import TestClient

from app import db
from app.auth import hash_password, new_session
from app.prompts import scoring_system_prompt


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_rubrics_seed_crud_and_prompt_injection(client: TestClient, admin_token: str):
    """Default MBSI rubrics auto-seed, supervisors can create/update/delete, and prompt injects criteria."""
    sup_id = db.create_user("Sup", "sup-r@example.com", hash_password("Pass!12345"), role="yonalish")
    sup_tok = new_session(sup_id)
    mgr_id = db.create_user("Mgr", "mgr-r@example.com", hash_password("Pass!12345"), role="manager")
    mgr_tok = new_session(mgr_id)

    # Auto-seed on first GET /api/rubrics
    res = client.get("/api/rubrics", headers=_auth(sup_tok))
    assert res.status_code == 200
    rubrics = res.json()
    assert len(rubrics) >= 2
    assert any(r["call_type"] == "receptionist" for r in rubrics)

    # Manager cannot create a rubric
    create_payload = {
        "name": "SAT Parent Consultation",
        "call_type": "receptionist",
        "description": "SAT info + test booking",
        "criteria": [
            {"key": "sat_info", "label": "SAT dasturi haqida ma'lumot", "weight": 50, "description": "Explain SAT track"},
            {"key": "test_date", "label": "Test sanasi", "weight": 50, "description": "Book entrance test date"},
        ],
    }
    assert client.post("/api/rubrics", json=create_payload, headers=_auth(mgr_tok)).status_code == 403

    # Supervisor creates a rubric
    created = client.post("/api/rubrics", json=create_payload, headers=_auth(sup_tok))
    assert created.status_code == 200
    rid = created.json()["id"]

    # Prompt helper includes active rubric criteria
    active = db.get_active_rubric(org_id=1, call_type="receptionist")
    prompt = scoring_system_prompt(rubric=active)
    assert "FAOL BAHOLASH MEZONI" in prompt

    # Supervisor updates & deletes
    upd = client.patch(f"/api/rubrics/{rid}", json={"active": False}, headers=_auth(sup_tok))
    assert upd.status_code == 200
    assert upd.json()["active"] is False

    dele = client.delete(f"/api/rubrics/{rid}", headers=_auth(sup_tok))
    assert dele.status_code == 200

    # Audit logs recorded create/update/delete
    logs = client.get("/api/audit-logs", headers=_auth(sup_tok))
    assert logs.status_code == 200
    actions = [l["action"] for l in logs.json()]
    assert "rubric.create" in actions
    assert "rubric.update" in actions
    assert "rubric.delete" in actions


def test_resolve_escalation_updates_call_problem_status(client: TestClient):
    """Resolving an escalation marks the call's problem_status='resolved' and writes an audit log."""
    sup_id = db.create_user("Sup2", "sup2-r@example.com", hash_password("Pass!12345"), role="yonalish")
    sup_tok = new_session(sup_id)
    call_id = db.create_call(name="Problem Call", audio_path="", call_type="receptionist", org_id=1)
    db.update_call(call_id, problem_status="open")
    esc_id = db.create_escalation(
        org_id=1,
        call_id=call_id,
        detected_problem="Test date not given",
        assigned_to_user_id=sup_id,
        assigned_reason="Supervisor review",
    )

    res = client.post(
        f"/api/escalations/{esc_id}/resolve",
        json={"notes": "Parent called back and test scheduled"},
        headers=_auth(sup_tok),
    )
    assert res.status_code == 200
    call = db.get_call(call_id)
    assert call["problem_status"] == "resolved"
    assert call["resolved"] == 1
