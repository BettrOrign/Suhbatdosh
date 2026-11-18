from starlette.testclient import TestClient

from app import config, db
from app.analysis import Analyzer
from app.auth import hash_password, new_session


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_secret_encryption_at_rest(monkeypatch):
    """Sensitive org_settings values are encrypted in SQLite when SECRET_ENCRYPTION_KEY is set."""
    monkeypatch.setattr(config, "SECRET_ENCRYPTION_KEY", "super-secret-master-key-for-tests")
    db.set_bot_setting("smtp_password", "my-gmail-app-pw", org_id=1)

    with db.get_db() as conn:
        raw = conn.execute(
            "SELECT value FROM org_settings WHERE org_id = 1 AND key = 'smtp_password'"
        ).fetchone()[0]
    assert raw.startswith("enc:v1:")
    assert "my-gmail-app-pw" not in raw
    assert db.get_bot_setting("smtp_password", org_id=1) == "my-gmail-app-pw"


def test_persistent_job_queue_lifecycle():
    """Jobs can be enqueued, claimed, retried on failure, recovered, and completed."""
    jid = db.enqueue_job("transcribe_call", {"call_id": 999}, org_id=1, max_attempts=2)
    job = db.claim_next_job()
    assert job is not None
    assert job["id"] == jid
    assert job["status"] == "running"
    assert job["attempts"] == 1

    # Simulate crash recovery while running
    assert db.recover_stale_jobs() >= 1
    job2 = db.claim_next_job()
    assert job2 is not None and job2["id"] == jid
    assert job2["attempts"] == 2

    # Failing after max_attempts marks job dead
    db.fail_job(jid, "network timeout")
    with db.get_db() as conn:
        row = conn.execute("SELECT status, last_error FROM jobs WHERE id = ?", (jid,)).fetchone()
    assert row["status"] == "dead"
    assert "network timeout" in row["last_error"]


def test_csv_export_and_followup_draft(client: TestClient, monkeypatch):
    """Supervisors can export CSV; staff can generate Uzbek follow-up drafts."""
    sup_id = db.create_user("Sup4", "sup4-f@example.com", hash_password("Pass!12345"), role="yonalish")
    sup_tok = new_session(sup_id)
    mgr_id = db.create_user("Mgr4", "mgr4-f@example.com", hash_password("Pass!12345"), role="manager")
    mgr_tok = new_session(mgr_id)

    cid = db.create_call(name="SAT Inquiry", audio_path="", call_type="manager", user_id=mgr_id, org_id=1)
    db.update_call(cid, status="done", transcript="Assalomu alaykum, test shanba kuni soat 10:00 da.")

    # Manager cannot export org-wide CSV
    assert client.get("/api/calls/export.csv", headers=_auth(mgr_tok)).status_code == 403

    # Supervisor can export CSV
    csv_res = client.get("/api/calls/export.csv", headers=_auth(sup_tok))
    assert csv_res.status_code == 200
    assert "text/csv" in csv_res.headers["content-type"]
    assert "SAT Inquiry" in csv_res.text

    # Follow-up draft
    async def _fake_draft(self, transcript, analysis_data=None):
        return {"message": "Assalomu alaykum! Shanba kuni soat 10:00 da MBSI testida kutamiz."}

    monkeypatch.setattr(Analyzer, "draft_followup", _fake_draft)
    draft_res = client.post(f"/api/calls/{cid}/draft-followup", headers=_auth(mgr_tok))
    assert draft_res.status_code == 200
    assert "MBSI" in draft_res.json()["message"]
