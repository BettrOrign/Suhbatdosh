from starlette.testclient import TestClient

from app import config, db
from app.auth import hash_password, new_session


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_omnichannel_lead_webhook_and_pipeline_summary(client: TestClient, monkeypatch):
    """Website/Instagram/Telegram leads flow into clients and show up in supervisor pipeline summary."""
    monkeypatch.setattr(config, "ZADARMA_WEBHOOK_SECRET", "test-lead-secret")
    sup_id = db.create_user("Sup3", "sup3-p@example.com", hash_password("Pass!12345"), role="yonalish")
    sup_tok = new_session(sup_id)

    # Reject invalid secret
    bad = client.post(
        "/api/leads/webhook/mbsi",
        json={"name": "Parent A", "phone": "+998901234567", "source_channel": "instagram"},
        headers={"X-Webhook-Secret": "wrong"},
    )
    assert bad.status_code == 401

    # Accept valid Instagram lead
    ig = client.post(
        "/api/leads/webhook/mbsi",
        json={
            "name": "Dilnoza Karimova",
            "phone": "+998901234567",
            "source_channel": "instagram",
            "student_grade": "9-sinf",
            "notes": "SAT + STEM track",
        },
        headers={"X-Webhook-Secret": "test-lead-secret"},
    )
    assert ig.status_code == 200
    cid = ig.json()["client"]["id"]
    assert ig.json()["client"]["source_channel"] == "instagram"
    assert ig.json()["client"]["pipeline_stage"] == "new_lead"

    # Receptionist schedules entrance test
    rec_id = db.create_user("Rec3", "rec3-p@example.com", hash_password("Pass!12345"), role="receptionist")
    rec_tok = new_session(rec_id)
    upd = client.patch(
        f"/api/clients/{cid}",
        json={
            "pipeline_stage": "test_scheduled",
            "test_date": "2026-11-20 10:00",
            "test_location": "MBSI Chinobod Campus, Room 204",
        },
        headers=_auth(rec_tok),
    )
    assert upd.status_code == 200
    assert upd.json()["pipeline_stage"] == "test_scheduled"
    assert upd.json()["test_location"] == "MBSI Chinobod Campus, Room 204"

    # Supervisor sees pipeline summary
    summary = client.get("/api/clients/pipeline/summary", headers=_auth(sup_tok))
    assert summary.status_code == 200
    body = summary.json()
    assert body["by_stage"]["test_scheduled"] >= 1
    assert body["by_channel"]["instagram"] >= 1
