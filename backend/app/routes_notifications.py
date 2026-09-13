from fastapi import APIRouter, Depends, HTTPException

from . import db
from .auth import get_current_user

router = APIRouter(prefix="/api")


@router.get("/notifications")
def list_notifications(
    unread_only: bool = False,
    limit: int = 50,
    user: dict = Depends(get_current_user),
):
    return db.get_notifications(user["id"], unread_only=unread_only, limit=limit)


@router.get("/notifications/unread-count")
def get_unread_count(user: dict = Depends(get_current_user)):
    return {"count": db.get_unread_count(user["id"])}


@router.patch("/notifications/{notification_id}/read")
def mark_notification_read(notification_id: int, user: dict = Depends(get_current_user)):
    db.mark_notification_read(notification_id, user["id"])
    return {"ok": True}


@router.post("/notifications/read-all")
def mark_all_read(user: dict = Depends(get_current_user)):
    db.mark_all_notifications_read(user["id"])
    return {"ok": True}


@router.post("/telegram/link")
def link_telegram(payload: dict, user: dict = Depends(get_current_user)):
    """Link a Telegram account to the current user."""
    telegram_id = payload.get("telegram_id")
    username = payload.get("username")
    first_name = payload.get("first_name")
    last_name = payload.get("last_name")

    if not telegram_id:
        raise HTTPException(400, "telegram_id is required")

    db.add_telegram_user(
        user_id=user["id"],
        telegram_id=telegram_id,
        username=username,
        first_name=first_name,
        last_name=last_name,
    )
    return {"ok": True, "message": "Telegram account linked"}


@router.delete("/telegram/unlink")
def unlink_telegram(user: dict = Depends(get_current_user)):
    """Unlink the current user's Telegram account."""
    with db.get_db() as conn:
        conn.execute("UPDATE telegram_users SET active = 0 WHERE user_id = ?", (user["id"],))
    return {"ok": True}