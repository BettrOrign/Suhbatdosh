"""REST routes for listing and replying to ingested Telegram group/channel messages."""

import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from app import auth, db, telegram_reader

logger = logging.getLogger("suhbatdosh.telegram")
router = APIRouter(prefix="/api/telegram", tags=["telegram"])


def _grade_telegram_reply(msg_id: int, question_text: str, reply_text: str, org_id: int) -> None:
    try:
        from app.analysis import Analyzer
        res = asyncio.run(Analyzer(org_id=org_id).score_telegram_reply(question_text, reply_text))
        with db.get_db() as conn:
            conn.execute(
                "UPDATE telegram_messages SET reply_score = ?, reply_feedback = ? WHERE id = ?",
                (res.get("score"), res.get("feedback", ""), msg_id),
            )
            conn.commit()
    except Exception as exc:
        logger.warning("Failed to grade telegram reply %d: %s", msg_id, exc)


class ReplyRequest(BaseModel):
    text: str


@router.get("/messages")
def list_messages(user: dict = Depends(auth.require_role("admin", "receptionist", "yonalish"))):
    org_id = user.get("org_id") or 1
    with db.get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM telegram_messages WHERE org_id = ? ORDER BY id DESC LIMIT 200",
            (org_id,),
        ).fetchall()
    return [dict(r) for r in rows]


@router.post("/messages/{msg_id}/reply")
def reply_message(
    msg_id: int,
    body: ReplyRequest,
    background: BackgroundTasks,
    user: dict = Depends(auth.require_role("admin", "receptionist", "yonalish")),
):
    org_id = user.get("org_id") or 1
    text = body.text.strip()
    if not text:
        raise HTTPException(400, "Reply text cannot be empty")

    with db.get_db() as conn:
        row = conn.execute(
            "SELECT * FROM telegram_messages WHERE id = ? AND org_id = ?", (msg_id, org_id)
        ).fetchone()
        if not row:
            raise HTTPException(404, "Message not found")
        msg = dict(row)

    try:
        telegram_reader.send_reply(msg["chat_id"], msg["message_id"], text)
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, f"Telegram API error: {exc}") from exc

    replied_at = datetime.now(timezone.utc).isoformat()
    with db.get_db() as conn:
        conn.execute(
            "UPDATE telegram_messages SET reply_text = ?, replied_at = ?, replied_by_user_id = ? WHERE id = ?",
            (text, replied_at, user["id"], msg_id),
        )
        conn.commit()
        updated = conn.execute(
            "SELECT * FROM telegram_messages WHERE id = ?", (msg_id,)
        ).fetchone()
    background.add_task(_grade_telegram_reply, msg_id, msg.get("text") or "", text, org_id)
    return dict(updated)
