"""API endpoints for the global processing mode (see docs/CONTRACT.md).

`GET /api/settings` returns the current mode plus what each stage of the
pipeline is backed by. Any authenticated user may read it so the UI can show
the mode; only an admin may change it.

Deliberately separate from `/api/bot/settings` in ``routes_sources.py``: that
endpoint can write arbitrary keys into the same table that stores Zadarma
secrets, and its GET ignores what its POST wrote.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException

from . import config, db, local_stt, transcribe
from .auth import get_current_user, require_role

router = APIRouter(prefix="/api")

logger = logging.getLogger("suhbatdosh.settings")


def _analysis_info() -> dict:
    return {"provider": "gemini", "model": config.GEMINI_ANALYSIS_MODEL}


def _settings_payload() -> dict:
    """Build the settings response from persisted mode + live backend state."""
    stt = local_stt.status()
    reason = local_stt.unavailable_reason()
    if reason:
        stt["unavailable_reason"] = reason
    row = db.get_bot_setting_row(transcribe.MODE_SETTING_KEY)
    mode = transcribe.get_mode()
    return {
        "mode": mode,
        "stt": stt,
        "analysis": _analysis_info(),
        "updated_at": (row or {}).get("updated_at"),
    }


@router.get("/settings")
def get_settings(user: dict = Depends(get_current_user)):
    """Return the processing mode and pipeline backends. Any authenticated user."""
    return _settings_payload()


@router.patch("/settings")
def update_settings(payload: dict, user: dict = Depends(require_role("admin"))):
    """Set the processing mode. Admin only; body is any subset of ``{"mode": ...}``."""
    if "mode" not in payload:
        raise HTTPException(400, "mode is required")
    raw = payload.get("mode")
    mode = raw.strip().lower() if isinstance(raw, str) else ""
    if mode not in transcribe.VALID_MODES:
        raise HTTPException(
            400, f"mode must be one of: {', '.join(transcribe.VALID_MODES)}"
        )
    if mode == transcribe.MODE_PRIVATE and not local_stt.status()["available"]:
        # Still allowed - transcribe.py degrades to Gemini and logs why - but the
        # caller is told immediately so the UI can warn.
        logger.warning(
            "Private mode requested but local STT is unavailable (%s); transcription will fall back to Gemini",
            local_stt.unavailable_reason(),
        )
    db.set_bot_setting(transcribe.MODE_SETTING_KEY, mode)
    logger.info("Processing mode set to %r by %s", mode, user["email"])
    return _settings_payload()