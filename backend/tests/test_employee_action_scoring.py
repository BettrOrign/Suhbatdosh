from starlette.testclient import TestClient

from app import db, telegram_reader
from app.analysis import Analyzer
from app.auth import hash_password, new_session


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_employee_action_queue_and_outcome_scoring(client: TestClient, monkeypatch):
    """Employees receive open escalations, due leads, and unanswered Telegram inquiries and get scored."""
    rec_id = db.create_user("Rec Action", "rec-act@example.com", hash_password("Pass!12345"), role="receptionist")
    mgr_id = db.create_user("Mgr Action", "mgr-act@example.com", hash_password("Pass!12345"), role="manager")
    sup_id = db.create_user("Sup Action", "sup-act@example.com", hash_password("Pass!12345"), role="yonalish")
    rec_tok = new_session(rec_id)
    mgr_tok = new_session(mgr_id)
    sup_tok = new_session(sup_id)

    # 1. Create a lead assigned to mgr_id and advance it to test_scheduled
    cid1 = db.create_client(
        name="Parent 1",
        manager_id=mgr_id,
        org_id=1,
        pipeline_stage="new_lead",
        next_follow_up_at="2020-01-01T00:00:00Z",
    )
    cid2 = db.create_client(
        name="Parent 2",
        manager_id=mgr_id,
        org_id=1,
        pipeline_stage="test_scheduled",
    )

    # 2. Create an escalation assigned to mgr_id
    call_id = db.create_call(name="Escalated Call", audio_path="", call_type="manager", user_id=mgr_id, org_id=1)
    esc_id = db.create_escalation(
        org_id=1,
        call_id=call_id,
        detected_problem="Parent confused about tuition",
        assigned_to_user_id=mgr_id,
        assigned_reason="Follow up",
    )

    # 3. Insert an unanswered Telegram question for receptionist
    with db.get_db() as conn:
        cur = conn.execute(
            "INSERT INTO telegram_messages (org_id, chat_id, message_id, user_id, username, full_name, text, is_bot, is_staff) "
            "VALUES (1, 1001, 55, 999, 'parent1', 'Ota Ona', 'Narxi qancha?', 0, 0)"
        )
        tg_msg_id = cur.lastrowid
        conn.commit()

    # Manager sees open escalation & due lead
    mgr_actions = client.get("/api/me/actions", headers=_auth(mgr_tok))
    assert mgr_actions.status_code == 200
    mdata = mgr_actions.json()
    assert any(e["id"] == esc_id for e in mdata["open_escalations"])
    assert any(l["id"] == cid1 for l in mdata["due_leads"])

    # Receptionist sees unanswered Telegram inquiry
    rec_actions = client.get("/api/me/actions", headers=_auth(rec_tok))
    assert rec_actions.status_code == 200
    assert any(m["id"] == tg_msg_id for m in rec_actions.json()["unanswered_telegram"])

    # Receptionist replies to Telegram inquiry and gets AI-scored
    monkeypatch.setattr(telegram_reader, "send_reply", lambda chat_id, reply_to, text: {"ok": True})

    async def _fake_tg_score(self, q, r):
        return {"score": 92, "feedback": "Juda aniq va xushmuomala javob!"}

    monkeypatch.setattr(Analyzer, "score_telegram_reply", _fake_tg_score)

    rep = client.post(
        f"/api/telegram/messages/{tg_msg_id}/reply",
        json={"text": "Assalomu alaykum! Test shanba kuni soat 10:00 da, narxi 3.5 mln so'm."},
        headers=_auth(rec_tok),
    )
    assert rep.status_code == 200
    with db.get_db() as conn:
        row = conn.execute("SELECT replied_by_user_id, reply_score FROM telegram_messages WHERE id = ?", (tg_msg_id,)).fetchone()
    assert row["replied_by_user_id"] == rec_id
    assert row["reply_score"] == 92

    # Manager resolves escalation -> outcome_metrics & supervisor rankings reflect it
    assert client.post(
        f"/api/escalations/{esc_id}/resolve",
        json={"notes": "Explained tuition"},
        headers=_auth(mgr_tok),
    ).status_code == 200

    ov = client.get("/api/me/overview", headers=_auth(mgr_tok)).json()
    assert ov["outcome_metrics"]["resolved_escalations"] >= 1
    assert ov["outcome_metrics"]["outcome_score"] is not None

    ranks = client.get("/api/stats/manager-rankings", headers=_auth(sup_tok)).json()
    mgr_rank = next(r for r in ranks if r["id"] == mgr_id)
    assert mgr_rank["lead_conversion_rate"] == 50
    assert mgr_rank["escalation_resolved_rate"] == 100
    assert mgr_rank["composite_score"] is not None
