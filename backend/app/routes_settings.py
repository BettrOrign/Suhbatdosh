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

    removed = audio.purge_expired_audio(days, org_id=org_id)
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


# ---------------------------------------------------------------------------
# Outbound Dispatch & Notification Settings
# ---------------------------------------------------------------------------


def _mask_notification_settings(settings: dict) -> dict:
    masked = dict(settings)
    if masked.get("smtp_password"):
        masked["has_smtp_password"] = True
        masked["smtp_password"] = "••••••••"
    else:
        masked["has_smtp_password"] = False
        masked["smtp_password"] = ""
    if masked.get("telegram_bot_token"):
        masked["has_telegram_bot_token"] = True
        masked["telegram_bot_token"] = "••••••••"
    else:
        masked["has_telegram_bot_token"] = False
        masked["telegram_bot_token"] = ""
    return masked


@router.get("/settings/notifications")
def get_notification_settings_endpoint(user: dict = Depends(get_current_user)):
    """Return outbound notification and escalation settings for the user's organization."""
    org_id = user.get("org_id") or 1
    settings = db.get_notification_settings(org_id=org_id)
    return _mask_notification_settings(settings)


@router.patch("/settings/notifications")
async def update_notification_settings_endpoint(payload: dict, user: dict = Depends(require_role("admin"))):
    """Update outbound notification settings (Gmail/SMTP and Telegram). Admin only."""
    org_id = user.get("org_id") or 1
    clean_payload = dict(payload)
    if clean_payload.get("smtp_password") in ("••••••••", None):
        clean_payload.pop("smtp_password", None)
    if clean_payload.get("telegram_bot_token") in ("••••••••", None):
        clean_payload.pop("telegram_bot_token", None)
    if "escalation_score_threshold" in clean_payload:
        try:
            clean_payload["escalation_score_threshold"] = max(0, min(100, int(clean_payload["escalation_score_threshold"])))
        except (TypeError, ValueError):
            clean_payload.pop("escalation_score_threshold", None)
    if "smtp_port" in clean_payload:
        try:
            clean_payload["smtp_port"] = max(1, min(65535, int(clean_payload["smtp_port"])))
        except (TypeError, ValueError):
            clean_payload.pop("smtp_port", None)

    tg_token_changed = "telegram_bot_token" in clean_payload
    updated = db.set_notification_settings(clean_payload, org_id=org_id)
    logger.info("Notification settings updated by %s (org=%d)", user["email"], org_id)

    if tg_token_changed:
        import asyncio
        from . import main as app_main
        asyncio.create_task(app_main.restart_telegram_bot())

    return _mask_notification_settings(updated)


@router.post("/settings/notifications/test-email")
def test_email_endpoint(payload: dict, user: dict = Depends(require_role("admin"))):
    """Send a real test email to verify SMTP / Gmail configuration."""
    org_id = user.get("org_id") or 1
    settings = db.get_notification_settings(org_id=org_id)
    recipient = (payload.get("recipient") or user.get("email") or "").strip()
    if not recipient:
        raise HTTPException(400, "Recipient email is required")

    from .notifications_dispatcher import send_email
    subject = "Suhbatdosh AI — Sinov Xabari (Test Email)"
    html_body = f"""
    <div style="font-family: sans-serif; padding: 20px; background: #f8fafc; border-radius: 8px;">
        <h2 style="color: #4f46e5;">Suhbatdosh AI Sinov Xabari</h2>
        <p>Tabriklaymiz! Elektron pochta (SMTP / Gmail) muvaffaqiyatli ulandi.</p>
        <p style="color: #64748b; font-size: 13px;">Yuborilgan vaqt: {db.now()} | Qabul qiluvchi: {recipient}</p>
    </div>
    """
    plain_body = f"Suhbatdosh AI Sinov Xabari\n\nElektron pochta (SMTP / Gmail) muvaffaqiyatli ulandi!\nQabul qiluvchi: {recipient}"

    # If payload contains overrides for testing before saving
    test_settings = dict(settings)
    for k in ("smtp_host", "smtp_port", "smtp_user", "smtp_from_name"):
        if k in payload and payload[k]:
            test_settings[k] = payload[k]
    if payload.get("smtp_password") and payload["smtp_password"] != "••••••••":
        test_settings["smtp_password"] = payload["smtp_password"]

    ok, msg = send_email(
        to_email=recipient,
        subject=subject,
        html_body=html_body,
        plain_body=plain_body,
        settings=test_settings,
    )
    if not ok:
        raise HTTPException(400, f"Email yuborishda xatolik: {msg}")
    return {"ok": True, "message": "Test email muvaffaqiyatli yuborildi"}


@router.post("/settings/notifications/test-telegram")
def test_telegram_endpoint(payload: dict, user: dict = Depends(require_role("admin"))):
    """Send a real test message to verify Telegram bot and chat configuration."""
    org_id = user.get("org_id") or 1
    settings = db.get_notification_settings(org_id=org_id)
    raw_token = (payload.get("telegram_bot_token") or "").strip()
    if raw_token == "••••••••":
        raw_token = ""
    bot_token = (raw_token or settings.get("telegram_bot_token") or "").strip()
    chat_id = (payload.get("telegram_default_chat_id") or settings.get("telegram_default_chat_id") or "").strip()

    if not bot_token:
        raise HTTPException(400, "Telegram Bot Token kiritilmagan")
    if not chat_id:
        raise HTTPException(400, "Telegram Chat ID kiritilmagan")

    from .notifications_dispatcher import send_telegram_alert
    text = (
        "<b>Suhbatdosh AI &bull; Sinov Xabari</b>\n\n"
        "Tabriklaymiz! Telegram xabarnoma kanali muvaffaqiyatli sozlandi.\n"
        "Endi muammoli qoʻngʻiroqlar haqida bildirishnomalar shu yerga yuboriladi."
    )
    ok, msg = send_telegram_alert(chat_id=chat_id, text=text, bot_token=bot_token)
    if not ok:
        raise HTTPException(400, f"Telegramga yuborishda xatolik: {msg}")
    return {"ok": True, "message": "Test Telegram xabari muvaffaqiyatli yuborildi"}
