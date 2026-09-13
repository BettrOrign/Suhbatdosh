"""External audio ingest endpoint.

Lets a device (phone app / recorder) push a call recording over HTTPS using a
per-user API token. The server verifies the sender, normalizes the audio,
writes the call row and enqueues background transcription + analysis.
"""

import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile

from . import audio, db
from .auth import get_user_by_token

router = APIRouter(prefix="/api")

MAX_FILE_BYTES = 200 * 1024 * 1024  # 200 MB safety cap


@router.post("/ingest")
async def ingest(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    token: str = Form(...),
    name: str | None = Form(None),
    call_type: str | None = Form(None),
    client_id: int | None = Form(None),
):
    """Receive an audio file from an external device and queue it for processing.

    Fields:
      - ``file``: the recording (mp3/wav/m4a/…).
      - ``token``: the sender's API token (from ``users.api_token``).
      - ``name``: optional display name for the call.
      - ``call_type``: ``manager`` (default) or ``receptionist``.
      - ``client_id``: optional client the call belongs to.

    The sender is identified purely by ``token``; the call row is attributed to
    that user and transcription + analysis run in the background. Returns
    ``{"ok": true, "call_id": ..., "status": "queued"}`` on success.
    """
    sender = get_user_by_token(token)
    if sender is None:
        raise HTTPException(401, "Invalid or revoked API token")

    if not file.filename:
        raise HTTPException(400, "Missing filename")
    suffix = Path(file.filename).suffix or ".mp3"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        size = 0
        while chunk := file.file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_FILE_BYTES:
                tmp.close()
                Path(tmp.name).unlink(missing_ok=True)
                raise HTTPException(413, "File too large")
            tmp.write(chunk)
        tmp_path = Path(tmp.name)

    try:
        wav_path, pcm_path = audio.normalize_audio(tmp_path)
        dur = audio.duration_sec(wav_path)
    except Exception as exc:
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(400, f"Could not process audio: {exc}") from exc
    finally:
        tmp_path.unlink(missing_ok=True)

    ctype = (call_type or "manager").strip()
    if ctype not in ("manager", "receptionist"):
        ctype = "manager"

    call_id = db.create_call(
        name=name or Path(file.filename).stem,
        audio_path=str(wav_path),
        duration_sec=dur,
        call_type=ctype,
        user_id=sender["id"],
        client_id=client_id,
    )
    db.update_call(call_id, status="queued")
    background.add_task(_process_call, call_id)
    background.add_task(_analyze_call, call_id)

    return {"ok": True, "call_id": call_id, "status": "queued"}


def _process_call(call_id: int):
    """Background task: transcribe the ingested call (see api._process_call)."""
    from .api import _process_call as run

    run(call_id)


def _analyze_call(call_id: int):
    """Background task: analyze the ingested call's transcript (see api._analyze_call)."""
    from .api import _analyze_call as run

    run(call_id)
