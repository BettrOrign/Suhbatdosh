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

from . import analysis, config, db, local_stt, transcribe
from .auth import get_current_user, require_role
from .prompts import scoring_system_prompt

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
        "flags": db.all_flags(),
        "retention_days": db.get_retention_days(),
        "stt": stt,
        "analysis": _analysis_info(),
        "updated_at": (row or {}).get("updated_at"),
    }


def _update_flags(payload_flags: dict) -> None:
    """Apply a partial flags patch; unknown names are rejected."""
    valid = set(db.FLAG_DEFAULTS)
    unknown = [k for k in payload_flags if k not in valid]
    if unknown:
        raise HTTPException(400, f"unknown flags: {', '.join(unknown)}")
    for key, value in payload_flags.items():
        if not isinstance(value, bool):
            raise HTTPException(400, f"flag {key} must be a boolean")
        db.set_flag(key, value)


@router.get("/settings/org")
def get_org_settings(user: dict = Depends(get_current_user)):
    """The organization profile grounding the Gemini prompts."""
    row = db.get_bot_setting_row(db.ORG_PROFILE_KEY)
    return {"profile": db.get_org_profile(), "updated_at": (row or {}).get("updated_at")}


@router.patch("/settings/org")
def update_org_settings(payload: dict, user: dict = Depends(require_role("admin"))):
    """Upsert organization profile fields. Admin only; "" clears a field."""
    unknown = [k for k in payload if k not in db.ORG_PROFILE_FIELDS]
    if unknown:
        raise HTTPException(400, f"unknown fields: {', '.join(unknown)}")
    fields = {k: v for k, v in payload.items() if isinstance(v, str)}
    merged = db.set_org_profile(fields)
    logger.info("Org profile updated by %s", user["email"])
    row = db.get_bot_setting_row(db.ORG_PROFILE_KEY)
    return {"profile": merged, "updated_at": (row or {}).get("updated_at")}


@router.get("/settings/prompt")
def get_system_prompt(user: dict = Depends(require_role("admin"))):
    """The exact system prompt the scoring agent runs with right now."""
    return {"system_prompt": scoring_system_prompt(db.get_org_profile())}


@router.post("/settings/org/search")
async def search_org_settings(
    payload: dict, user: dict = Depends(require_role("admin"))
):
    """Research an institution on the web and propose a profile.

    Body: ``{"name": str, "description": str (optional)}``. Admin only. The
    response is a **proposal** — nothing is persisted until the admin confirms
    it by PATCHing ``/api/settings/org``.
    """
    name = str(payload.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "name is required")
    try:
        result = await analysis.search_org_profile(
            name, str(payload.get("description", ""))
        )
    except ValueError as exc:
        raise HTTPException(502, str(exc)) from exc
    logger.info("Org profile web-search for %r by %s (found=%s)", name, user["email"], result["found"])
    return result


@router.post("/settings/purge-audio")
def purge_audio(user: dict = Depends(require_role("admin"))):
    """Run the audio-retention purge now (Settings → purge). Admin only."""
    days = db.get_retention_days()
    if not days:
        raise HTTPException(
            400, "auto-delete is off; set retention_days first"
        )
    from . import audio

    removed = audio.purge_expired_audio(days)
    logger.info("Manual audio purge: %d file(s) by %s", removed, user["email"])
    return {"ok": True, "purged": removed}


@router.get("/settings")
def get_settings(user: dict = Depends(get_current_user)):
    """Return the processing mode and pipeline backends. Any authenticated user."""
    return _settings_payload()


@router.patch("/settings")
def update_settings(payload: dict, user: dict = Depends(require_role("admin"))):
    """Update settings. Admin only; body may carry ``mode``, ``flags`` and/or ``retention_days``."""
    if "mode" in payload:
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
    if "flags" in payload:
        flags = payload.get("flags")
        if not isinstance(flags, dict):
            raise HTTPException(400, "flags must be an object")
        _update_flags(flags)
    if "retention_days" in payload:
        days = payload.get("retention_days")
        if not isinstance(days, int) or days not in db.RETENTION_CHOICES:
            raise HTTPException(400, f"retention_days must be one of: {db.RETENTION_CHOICES}")
        db.set_retention_days(days)
        logger.info("Audio retention set to %s days by %s", days, user["email"])
    if "mode" not in payload and "flags" not in payload and "retention_days" not in payload:
        raise HTTPException(400, "nothing to update: pass mode, flags or retention_days")
    return _settings_payload()