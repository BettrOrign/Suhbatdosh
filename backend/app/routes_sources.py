"""API endpoints for managing data sources (YouTube whitelist, tags)."""

from fastapi import APIRouter, Depends, HTTPException

from . import config, db
from .auth import get_current_user, require_role
from .youtube import process_youtube_video, extract_video_id

router = APIRouter(prefix="/api")


# ---------------------------------------------------------------------------
# Tags
# ---------------------------------------------------------------------------


@router.get("/tags")
def list_tags(user: dict = Depends(get_current_user)):
    return db.list_tags()


@router.post("/tags")
def create_tag(payload: dict, user: dict = Depends(require_role("admin"))):
    name = payload.get("name", "").strip()
    if not name:
        raise HTTPException(400, "tag name is required")
    color = payload.get("color", "#6366f1")
    tag_id = db.create_tag(name, color)
    return {"id": tag_id, "name": name, "color": color}


@router.delete("/tags/{tag_id}")
def delete_tag(tag_id: int, user: dict = Depends(require_role("admin"))):
    db.delete_tag(tag_id)
    return {"ok": True}


@router.post("/calls/{call_id}/tags")
def tag_call(call_id: int, payload: dict, user: dict = Depends(get_current_user)):
    tag_id = payload.get("tag_id")
    if not tag_id:
        raise HTTPException(400, "tag_id is required")
    db.tag_call(call_id, tag_id)
    return {"ok": True}


@router.delete("/calls/{call_id}/tags/{tag_id}")
def untag_call(call_id: int, tag_id: int, user: dict = Depends(get_current_user)):
    db.untag_call(call_id, tag_id)
    return {"ok": True}


@router.get("/calls/{call_id}/tags")
def get_call_tags(call_id: int, user: dict = Depends(get_current_user)):
    return db.get_call_tags(call_id)


# ---------------------------------------------------------------------------
# YouTube Whitelist
# ---------------------------------------------------------------------------


@router.get("/youtube/whitelist")
def list_youtube_whitelist(user: dict = Depends(require_role("admin"))):
    return db.list_youtube_whitelist()


@router.post("/youtube/whitelist")
def add_youtube_whitelist(payload: dict, user: dict = Depends(require_role("admin"))):
    channel_id = payload.get("channel_id")
    channel_name = payload.get("channel_name")
    pattern = payload.get("pattern")
    if not channel_id and not pattern:
        raise HTTPException(400, "channel_id or pattern is required")
    entry_id = db.add_youtube_whitelist(channel_id, channel_name, pattern)
    return {"id": entry_id}


@router.delete("/youtube/whitelist/{entry_id}")
def remove_youtube_whitelist(entry_id: int, user: dict = Depends(require_role("admin"))):
    db.remove_youtube_whitelist(entry_id)
    return {"ok": True}


@router.post("/youtube/process")
async def process_youtube_url(
    payload: dict,
    user: dict = Depends(require_role("admin")),
):
    """Submit a YouTube URL for processing."""
    if not config.YOUTUBE_ENABLED:
        raise HTTPException(400, "YouTube ingestion is disabled")
    url = payload.get("url", "").strip()
    if not url:
        raise HTTPException(400, "url is required")
    video_id = extract_video_id(url)
    if not video_id:
        raise HTTPException(400, "Invalid YouTube URL")
    call_id = process_youtube_video(url, user_id=user["id"])
    if call_id is None:
        raise HTTPException(500, "Failed to process YouTube video")
    call = db.get_call(call_id)
    return {"ok": True, "call_id": call_id, "call": call}


# ---------------------------------------------------------------------------
# Bot Settings
# ---------------------------------------------------------------------------


@router.get("/bot/settings")
def get_bot_settings(user: dict = Depends(require_role("admin"))):
    return {
        "youtube_enabled": config.YOUTUBE_ENABLED,
        "telegram_admin_ids": config.TELEGRAM_ADMIN_IDS,
    }


@router.post("/bot/settings")
def update_bot_settings(payload: dict, user: dict = Depends(require_role("admin"))):
    for key, value in payload.items():
        db.set_bot_setting(key, str(value))
    return {"ok": True}
