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


def _settings_payload(org_id: int = 1) -> dict:
    """Build the settings response from persisted mode + live backend state."""
    stt = local_stt.status()
    reason = local_stt.unavailable_reason()
    if reason:
        stt["unavailable_reason"] = reason
    row = db.get_bot_setting_row(transcribe.MODE_SETTING_KEY, org_id=org_id)
    mode = transcribe.get_mode() if org_id == 1 else transcribe.get_mode(org_id=org_id)
    return {
        "mode": mode,
        "flags": db.all_flags(org_id=org_id),
        "retention_days": db.get_retention_days(org_id=org_id),
        "stt": stt,
        "analysis": _analysis_info(),
        "updated_at": (row or {}).get("updated_at"),
    }


def _update_flags(payload_flags: dict, org_id: int = 1) -> None:
    """Apply a partial flags patch; unknown names are rejected."""
    valid = set(db.FLAG_DEFAULTS)
    unknown = [k for k in payload_flags if k not in valid]
    if unknown:
        raise HTTPException(400, f"unknown flags: {', '.join(unknown)}")
    for key, value in payload_flags.items():
        if not isinstance(value, bool):
            raise HTTPException(400, f"flag {key} must be a boolean")
        db.set_flag(key, value, org_id=org_id)


@router.get("/settings/org")
def get_org_settings(user: dict = Depends(get_current_user)):
    """The organization profile grounding the Gemini prompts."""
    org_id = user.get("org_id") or 1
    row = db.get_bot_setting_row(db.ORG_PROFILE_KEY, org_id=org_id)
    return {"profile": db.get_org_profile(org_id=org_id), "updated_at": (row or {}).get("updated_at")}


@router.patch("/settings/org")
def update_org_settings(payload: dict, user: dict = Depends(require_role("admin"))):
    """Upsert organization profile fields. Admin only; "" clears a field."""
    org_id = user.get("org_id") or 1
    unknown = [k for k in payload if k not in db.ORG_PROFILE_FIELDS]
    if unknown:
        raise HTTPException(400, f"unknown fields: {', '.join(unknown)}")
    fields = {k: v for k, v in payload.items() if isinstance(v, str)}
    merged = db.set_org_profile(fields, org_id=org_id)
    logger.info("Org profile updated by %s (org=%d)", user["email"], org_id)
    row = db.get_bot_setting_row(db.ORG_PROFILE_KEY, org_id=org_id)
    return {"profile": merged, "updated_at": (row or {}).get("updated_at")}


@router.get("/settings/prompt")
def get_system_prompt(user: dict = Depends(require_role("admin"))):
    """The exact system prompt the scoring agent runs with right now."""
    org_id = user.get("org_id") or 1
    return {"system_prompt": scoring_system_prompt(db.get_org_profile(org_id=org_id))}


@router.post("/settings/org/search")
async def search_org_settings(
    payload: dict, user: dict = Depends(require_role("admin"))
):
    """Research an institution on the web and propose a profile."""
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
    org_id = user.get("org_id") or 1
    days = db.get_retention_days(org_id=org_id)
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
    return _settings_payload(org_id=user.get("org_id") or 1)


@router.patch("/settings")
def update_settings(payload: dict, user: dict = Depends(require_role("admin"))):
    """Update settings. Admin only; body may carry ``mode``, ``flags`` and/or ``retention_days``."""
    org_id = user.get("org_id") or 1
    if "mode" in payload:
        raw = payload.get("mode")
        mode = raw.strip().lower() if isinstance(raw, str) else ""
        if mode not in transcribe.VALID_MODES:
            raise HTTPException(
                400, f"mode must be one of: {', '.join(transcribe.VALID_MODES)}"
            )
        if mode == transcribe.MODE_PRIVATE and not local_stt.status()["available"]:
            logger.warning(
                "Private mode requested but local STT is unavailable (%s); transcription will fall back to Gemini",
                local_stt.unavailable_reason(),
            )
        db.set_bot_setting(transcribe.MODE_SETTING_KEY, mode, org_id=org_id)
        logger.info("Processing mode set to %r by %s (org=%d)", mode, user["email"], org_id)
    if "flags" in payload:
        flags = payload.get("flags")
        if not isinstance(flags, dict):
            raise HTTPException(400, "flags must be an object")
        _update_flags(flags, org_id=org_id)
    if "retention_days" in payload:
        days = payload.get("retention_days")
        if not isinstance(days, int) or days not in db.RETENTION_CHOICES:
            raise HTTPException(400, f"retention_days must be one of: {db.RETENTION_CHOICES}")
        db.set_retention_days(days, org_id=org_id)
        logger.info("Audio retention set to %s days by %s (org=%d)", days, user["email"], org_id)
    if "mode" not in payload and "flags" not in payload and "retention_days" not in payload:
        raise HTTPException(400, "nothing to update: pass mode, flags or retention_days")
    return _settings_payload(org_id=org_id)