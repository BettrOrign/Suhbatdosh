"""REST routes for listing and replying to ingested Telegram group/channel messages."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app import auth, db, telegram_reader

router = APIRouter(prefix="/api/telegram", tags=["telegram"])


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
            "UPDATE telegram_messages SET reply_text = ?, replied_at = ? WHERE id = ?",
            (text, replied_at, msg_id),
        )
        conn.commit()
        updated = conn.execute(
            "SELECT * FROM telegram_messages WHERE id = ?", (msg_id,)
        ).fetchone()
    return dict(updated)
