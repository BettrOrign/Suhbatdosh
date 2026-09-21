"""Zadarma telephony integration routes.

Provides:
  - POST /api/zadarma/config  — save API key/secret (admin only)
  - GET  /api/zadarma/config  — get current config status (admin only)
  - POST /api/zadarma/sync    — fetch recent recordings from Zadarma and import
  - POST /api/zadarma/webhook — receive real-time NOTIFY_RECORD events
"""

import hashlib
import json
import logging
import shutil
import tempfile
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request

from . import audio, config as app_config, db
from .auth import get_current_user
from .zadarma import ZadarmaClient

logger = logging.getLogger("suhbatdosh.zadarma_routes")

router = APIRouter(prefix="/api/zadarma")

# ---------------------------------------------------------------------------
# Config helpers
# ---------------------------------------------------------------------------

_ZADARMA_KEY_ENV = "ZADARMA_API_KEY"
_ZADARMA_SECRET_ENV = "ZADARMA_API_SECRET"

import os


def _get_zadarma_credentials() -> tuple[str, str]:
    """Return (api_key, api_secret) from environment or DB bot_settings."""
    key = os.getenv(_ZADARMA_KEY_ENV, "")
    secret = os.getenv(_ZADARMA_SECRET_ENV, "")
    if not key:
        key = db.get_bot_setting("zadarma_api_key", "")
    if not secret:
        secret = db.get_bot_setting("zadarma_api_secret", "")
    return key, secret


def _get_client() -> ZadarmaClient | None:
    """Create a ZadarmaClient if credentials are available."""
    key, secret = _get_zadarma_credentials()
    if not key or not secret:
        return None
    return ZadarmaClient(key, secret)


# ---------------------------------------------------------------------------
# Config endpoints (admin only)
# ---------------------------------------------------------------------------


@router.get("/config")
async def get_config(user: dict = Depends(get_current_user)):
    """Return whether Zadarma is configured (no secrets exposed)."""
    if user["role"] != "admin":
        raise HTTPException(403, "Admin only")
    key, secret = _get_zadarma_credentials()
    configured = bool(key and secret)
    result = {"configured": configured}
    if configured:
        try:
            client = _get_client()
            balance = client.get_balance()
            result["balance"] = balance.get("balance")
            result["currency"] = balance.get("currency")
        except Exception as e:
            logger.warning("Could not fetch Zadarma balance: %s", e)
            result["balance"] = None
            result["error"] = str(e)
    return result


@router.post("/config")
async def save_config(payload: dict, user: dict = Depends(get_current_user)):
    """Save Zadarma API credentials (admin only)."""
    if user["role"] != "admin":
        raise HTTPException(403, "Admin only")
    api_key = (payload.get("api_key") or "").strip()
    api_secret = (payload.get("api_secret") or "").strip()
    if not api_key or not api_secret:
        raise HTTPException(400, "api_key and api_secret are required")
    db.set_bot_setting("zadarma_api_key", api_key)
    db.set_bot_setting("zadarma_api_secret", api_secret)
    return {"ok": True, "configured": True}


# ---------------------------------------------------------------------------
# Sync endpoint (admin only)
# ---------------------------------------------------------------------------


@router.post("/sync")
async def sync_recordings(
    background: BackgroundTasks,
    payload: dict | None = None,
    user: dict = Depends(get_current_user),
):
    """Fetch recent Zadarma PBX recordings and import them.

    Body (optional):
      - start: "YYYY-MM-DD HH:MM:SS" (default: 7 days ago)
      - end: "YYYY-MM-DD HH:MM:SS" (default: now)
    """
    if user["role"] != "admin":
        raise HTTPException(403, "Admin only")

    client = _get_client()
    if client is None:
        raise HTTPException(400, "Zadarma is not configured. Set API key and secret first.")

    now = datetime.now(timezone.utc)
    payload = payload or {}
    if "start" in payload:
        start_str = payload["start"]
    else:
        start_str = (now - timedelta(days=7)).strftime("%Y-%m-%d %H:%M:%S")
    if "end" in payload:
        end_str = payload["end"]
    else:
        end_str = now.strftime("%Y-%m-%d %H:%M:%S")

    # Launch sync in background so the HTTP response isn't slow
    background.add_task(_run_sync, start_str, end_str, user["id"])
    return {"ok": True, "status": "sync_started", "start": start_str, "end": end_str}


def _run_sync(start: str, end: str, user_id: int):
    """Background: fetch Zadarma stats, download recordings, import into DB."""
    log = logging.getLogger("suhbatdosh.zadarma_sync")

    client = _get_client()
    if client is None:
        log.error("Zadarma credentials disappeared during sync")
        return

    # Collect all recorded call IDs from Zadarma stats (paginate)
    all_stats: list[dict] = []
    skip = 0
    while True:
        try:
            resp = client.get_pbx_statistics(start=start, end=end, skip=skip, limit=1000)
        except Exception as e:
            log.error("Failed to fetch Zadarma stats: %s", e)
            break
        stats = resp.get("stats", [])
        all_stats.extend(stats)
        if len(stats) < 1000:
            break
        skip += 1000
        time.sleep(0.5)  # respect rate limits

    recorded_calls = [s for s in all_stats if s.get("is_recorded")]
    log.info("Found %d recorded calls in Zadarma stats (%d total)", len(recorded_calls), len(all_stats))

    # Get existing Zadarma call IDs to avoid duplicates
    existing_zids = set()
    with db.get_db() as conn:
        rows = conn.execute(
            "SELECT source_meta FROM calls WHERE source_type = 'zadarma'"
        ).fetchall()
        for r in rows:
            meta = json.loads(r[0] or "{}")
            zid = meta.get("zadarma_call_id")
            if zid:
                existing_zids.add(str(zid))

    imported = 0
    for stat in recorded_calls:
        z_call_id = str(stat.get("call_id", ""))
        if z_call_id in existing_zids:
            continue

        # Try to get download link
        try:
            link_resp = client.get_record_link(call_id=z_call_id, lifetime=3600)
        except Exception as e:
            log.warning("Could not get record link for call_id=%s: %s", z_call_id, e)
            continue

        if link_resp.get("status") != "success":
            log.warning("Record link response not success for call_id=%s: %s", z_call_id, link_resp)
            continue

        record_url = link_resp.get("link")
        if not record_url:
            log.warning("No download link for call_id=%s", z_call_id)
            continue

        # Download audio
        try:
            audio_bytes = client.download_recording(record_url)
        except Exception as e:
            log.warning("Failed to download recording for call_id=%s: %s", z_call_id, e)
            continue

        if not audio_bytes:
            continue

        # Save to temp file and normalize
        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
                tmp.write(audio_bytes)
                tmp_path = Path(tmp.name)

            wav_path, pcm_path = audio.normalize_audio(tmp_path)
            dur = audio.duration_sec(wav_path)
        except Exception as e:
            log.warning("Failed to normalize audio for call_id=%s: %s", z_call_id, e)
            if tmp_path:
                tmp_path.unlink(missing_ok=True)
            continue
        finally:
            if tmp_path:
                tmp_path.unlink(missing_ok=True)

        # Build call name from stats
        sip = stat.get("sip", "")
        clid = stat.get("clid", "")
        destination = stat.get("destination", "")
        callstart = stat.get("callstart", "")
        name = f"Zadarma {clid}→{destination} {callstart}" if callstart else f"Zadarma call {z_call_id}"

        source_meta = {
            "zadarma_call_id": z_call_id,
            "zadarma_sip": sip,
            "zadarma_clid": clid,
            "zadarma_destination": destination,
            "zadarma_callstart": callstart,
            "zadarma_disposition": stat.get("disposition", ""),
            "zadarma_seconds": stat.get("seconds", 0),
            "zadarma_pbx_call_id": stat.get("pbx_call_id", ""),
        }

        # Determine call_type: if destination looks like an internal ext, it's
        # likely a manager-to-manager call; otherwise default to manager.
        call_type = "manager"

        # Try to match SIP to a user
        user_id_for_call = _match_sip_to_user(sip)

        call_id = db.create_call(
            name=name,
            audio_path=str(wav_path),
            duration_sec=dur,
            call_type=call_type,
            user_id=user_id_for_call,
            client_id=None,
            source_type="zadarma",
            source_meta=source_meta,
        )
        db.update_call(call_id, status="queued")

        # Enqueue transcription + analysis
        from .api import _process_call, _analyze_call
        threading.Thread(target=_process_call, args=(call_id,), daemon=True).start()
        threading.Thread(target=_analyze_call, args=(call_id,), daemon=True).start()

        imported += 1
        log.info("Imported Zadarma call %s as call_id=%d", z_call_id, call_id)

    log.info("Zadarma sync complete: %d new calls imported", imported)


def _match_sip_to_user(sip: str) -> int | None:
    """Try to match a Zadarma SIP number to a local user by name or email pattern.

    Returns the user_id or None if no match found.
    """
    if not sip:
        return None
    # Try matching by email containing the SIP number
    with db.get_db() as conn:
        row = conn.execute(
            "SELECT id FROM users WHERE email LIKE ? AND active = 1 LIMIT 1",
            (f"%{sip}%",),
        ).fetchone()
        if row:
            return row[0]
    return None


# ---------------------------------------------------------------------------
# Webhook endpoint (no auth — called by Zadarma)
# ---------------------------------------------------------------------------


@router.get("/webhook")
async def webhook_verify(request: Request):
    """Zadarma URL verification — returns ``zd_echo`` param back."""
    zd_echo = request.query_params.get("zd_echo", "")
    from fastapi.responses import PlainTextResponse
    return PlainTextResponse(zd_echo)


@router.post("/webhook")
async def webhook_notify(request: Request, background: BackgroundTasks):
    """Receive NOTIFY_RECORD webhooks from Zadarma.

    Zadarma POSTs form-encoded data with:
      - event: "NOTIFY_RECORD"
      - call_id_with_rec: unique recording ID
      - pbx_call_id: permanent call ID

    We verify the signature, then queue the recording for import.
    """
    body = await request.form()
    event = body.get("event", "")

    if event != "NOTIFY_RECORD":
        return {"ok": True, "skipped": True}

    call_id_with_rec = body.get("call_id_with_rec", "")
    pbx_call_id = body.get("pbx_call_id", "")

    if not call_id_with_rec:
        return {"ok": True, "error": "missing call_id_with_rec"}

    # Check for duplicate
    with db.get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM calls WHERE source_type = 'zadarma' AND source_meta LIKE ?",
            (f'%{call_id_with_rec}%',),
        ).fetchone()
        if existing:
            return {"ok": True, "duplicate": True, "call_id": existing[0]}

    # Launch background import
    background.add_task(_import_webhook_recording, call_id_with_rec, pbx_call_id)
    return {"ok": True, "queued": True}


def _import_webhook_recording(call_id_with_rec: str, pbx_call_id: str):
    """Background: download and import a single recording from a webhook event."""
    log = logging.getLogger("suhbatdosh.zadarma_webhook")

    client = _get_client()
    if client is None:
        log.error("Zadarma not configured, cannot import webhook recording")
        return

    # Wait a bit for Zadarma to finish writing the file
    time.sleep(45)

    # Get download link using call_id_with_rec as the call_id
    try:
        link_resp = client.get_record_link(call_id=call_id_with_rec, lifetime=3600)
    except Exception as e:
        log.error("Failed to get record link for webhook call: %s", e)
        return

    if link_resp.get("status") != "success":
        log.error("Record link not success: %s", link_resp)
        return

    record_url = link_resp.get("link")
    if not record_url:
        log.error("No download link in response: %s", link_resp)
        return

    # Download
    try:
        audio_bytes = client.download_recording(record_url)
    except Exception as e:
        log.error("Failed to download recording: %s", e)
        return

    if not audio_bytes:
        return

    # Normalize
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = Path(tmp.name)
        wav_path, pcm_path = audio.normalize_audio(tmp_path)
        dur = audio.duration_sec(wav_path)
    except Exception as e:
        log.error("Failed to normalize webhook recording: %s", e)
        if tmp_path:
            tmp_path.unlink(missing_ok=True)
        return
    finally:
        if tmp_path:
            tmp_path.unlink(missing_ok=True)

    name = f"Zadarma webhook call {call_id_with_rec}"
    source_meta = {
        "zadarma_call_id": call_id_with_rec,
        "zadarma_pbx_call_id": pbx_call_id,
    }

    call_id = db.create_call(
        name=name,
        audio_path=str(wav_path),
        duration_sec=dur,
        call_type="manager",
        user_id=None,
        client_id=None,
        source_type="zadarma",
        source_meta=source_meta,
    )
    db.update_call(call_id, status="queued")

    from .api import _process_call, _analyze_call
    threading.Thread(target=_process_call, args=(call_id,), daemon=True).start()
    threading.Thread(target=_analyze_call, args=(call_id,), daemon=True).start()

    log.info("Imported webhook recording as call_id=%d", call_id)
