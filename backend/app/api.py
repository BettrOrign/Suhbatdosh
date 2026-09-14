import asyncio
import json
import logging
import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from . import audio, config, db
from .analysis import Analyzer
from .auth import get_current_user
from .live import LiveTranscriber
from .transcribe import Transcriber

logger = logging.getLogger("suhbatdosh.api")
router = APIRouter(prefix="/api")

# Lazy singletons for the live WebSocket transcription path.
# The REST background tasks (_process_call / _analyze_call) intentionally create
# fresh Transcriber()/Analyzer() instances per call to avoid reusing a single
# async HTTP client across asyncio.run() loops (which raises "Event loop is closed").
_transcriber: LiveTranscriber | None = None
_analyzer: Analyzer | None = None
_rest_transcriber: Transcriber | None = None


def _get_transcriber() -> LiveTranscriber:
    """Lazily create and cache the singleton LiveTranscriber for streaming (WebSocket) use."""
    global _transcriber
    if _transcriber is None:
        _transcriber = LiveTranscriber()
    return _transcriber


def _get_rest_transcriber() -> Transcriber:
    """Lazily create and cache the singleton REST Transcriber (retained for live use)."""
    global _rest_transcriber
    if _rest_transcriber is None:
        _rest_transcriber = Transcriber()
    return _rest_transcriber


def _get_analyzer() -> Analyzer:
    """Lazily create and cache the singleton Analyzer (retained for live use)."""
    global _analyzer
    if _analyzer is None:
        _analyzer = Analyzer()
    return _analyzer


def _process_call(call_id: int):
    """Background task: transcribe a recorded call with retry logic for API failures."""
    import time

    max_retries = 3
    for attempt in range(max_retries):
        try:
            call = db.get_call(call_id)
            if not call or not call["audio_path"]:
                return
            wav = audio.resolve_audio_path(call["audio_path"])
            if wav is None:
                return

            db.update_call(call_id, status="transcribing")

            result = asyncio.run(
                asyncio.wait_for(Transcriber().transcribe_wav(wav), timeout=120)
            )
            segments = result.get("segments", [])
            text = result.get("text", "") or ""

            db.update_call(
                call_id,
                status="transcribed",
                transcript=text,
                segments=json.dumps(segments, ensure_ascii=False),
                language=result.get("language_code") or None,
            )
            return  # success

        except Exception as e:
            is_retryable = "503" in str(e) or "429" in str(e) or "UNAVAILABLE" in str(e)
            if is_retryable and attempt < max_retries - 1:
                wait = 2 ** (attempt + 1)  # 2s, 4s, 8s
                logger.warning("process_call retryable error (attempt %d/%d), waiting %ds: %s",
                               attempt + 1, max_retries, wait, e)
                time.sleep(wait)
                continue
            logger.exception("process_call failed")
            prev = db.get_call(call_id)
            db.update_call(call_id, status="error", transcript=(prev["transcript"] if prev else "") or "")
            return


def _analyze_call(call_id: int):
    """Background task: run LLM analysis with retry logic for API failures."""
    import time

    # Wait for transcription to complete
    for _ in range(30):
        call = db.get_call(call_id)
        if call and call["transcript"].strip():
            break
        time.sleep(1)
    else:
        db.update_call(call_id, status="error")
        return

    max_retries = 5
    for attempt in range(max_retries):
        try:
            call = db.get_call(call_id)
            if not call or not call["transcript"].strip():
                db.update_call(call_id, status="error")
                return
            db.update_call(call_id, status="analyzing")
            analyzer = Analyzer()
            result = asyncio.run(
                asyncio.wait_for(analyzer.analyze(call["transcript"]), timeout=60)
            )

            if call.get("user_id") and "error" not in result:
                action_analyzer = Analyzer()
                action_items = asyncio.run(
                    asyncio.wait_for(action_analyzer.extract_action_items(call["transcript"]), timeout=30)
                )
                for item in action_items:
                    db.create_notification(
                        user_id=call["user_id"],
                        type_="action_item",
                        title=item.get("description", "Follow-up needed")[:100],
                        message=item.get("description", ""),
                        call_id=call_id,
                        metadata={
                            "due_date": item.get("due_date"),
                            "assignee": item.get("assignee", "manager"),
                            "priority": item.get("priority", "medium"),
                        },
                    )

            db.update_call(call_id, status="done", analysis=json.dumps(result, ensure_ascii=False))

            topic = (result.get("topic") or "").strip()
            logger.info("Analysis result for call %d: topic=%r, keys=%s", call_id, topic, list(result.keys()))
            if topic:
                db.update_call(call_id, name=topic)
            return  # success

        except Exception as e:
            is_retryable = "503" in str(e) or "429" in str(e) or "UNAVAILABLE" in str(e)
            if is_retryable and attempt < max_retries - 1:
                wait = 5 * (attempt + 1)  # 5s, 10s, 15s, 20s
                logger.warning("analyze_call retryable error (attempt %d/%d), waiting %ds: %s",
                               attempt + 1, max_retries, wait, e)
                time.sleep(wait)
                continue
            logger.exception("analyze_call failed")
            db.update_call(call_id, status="error", analysis=json.dumps({"error": str(e)}))
            return


@router.post("/calls")
async def upload_call(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    name: str | None = Form(None),
    call_type: str | None = Form(None),
    client_id: int | None = Form(None),
    assigned_user_id: int | None = Form(None),
    source_type: str | None = Form(None),
    user: dict = Depends(get_current_user),
):
    """Upload a call recording, normalize it, and enqueue transcription + analysis.

    Managers/receptionists are attached to their own call; only admins may assign
    the call to another user via `assigned_user_id`.
    """
    ctype = (call_type or "manager").strip()
    if ctype not in ("manager", "receptionist"):
        ctype = "manager"
    stype = (source_type or "upload").strip()
    suffix = Path(file.filename or "audio").suffix or ".mp3"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = Path(tmp.name)

    try:
        wav_path, pcm_path = audio.normalize_audio(tmp_path)
        dur = audio.duration_sec(wav_path)
        target_user_id = assigned_user_id if (user["role"] == "admin" and assigned_user_id) else user["id"]
        call_id = db.create_call(
            name=name or Path(file.filename or "call").stem,
            audio_path=str(wav_path),
            duration_sec=dur,
            call_type=ctype,
            user_id=target_user_id,
            client_id=client_id,
            source_type=stype,
        )
        db.update_call(call_id, status="queued")
        background.add_task(_process_call, call_id)
        background.add_task(_analyze_call, call_id)
        return db.get_call(call_id)
    finally:
        tmp_path.unlink(missing_ok=True)


@router.get("/calls")
async def get_calls(
    call_type: str | None = None,
    user: dict = Depends(get_current_user),
):
    """List calls scoped to the current user's role.

    Admin sees everything; a manager sees their own manager calls; a receptionist
    sees receptionist calls. `call_type` filters by 'manager'/'receptionist'.
    """
    if user["role"] == "admin":
        return db.list_calls(call_type=call_type)
    if user["role"] == "manager":
        return db.list_calls(user_id=user["id"], call_type="manager")
    return db.list_calls(call_type="receptionist")


@router.get("/calls/{call_id}")
async def get_call(call_id: int, user: dict = Depends(get_current_user)):
    """Fetch a single call by id, enforcing per-role access."""
    call = db.get_call(call_id)
    if call is None:
        raise HTTPException(404, "call not found")
    _check_call_access(call, user)
    return call


def _check_call_access(call: dict, user: dict):
    """Enforce that the current user may access a given call.

    Admin: always. Receptionist: only receptionist calls. Manager: only calls
    owned by them (or unassigned). Raises 403 otherwise.
    """
    if user["role"] == "admin":
        return
    if call.get("call_type") == "receptionist":
        if user["role"] != "receptionist":
            raise HTTPException(403, "Forbidden")
        return
    if user["role"] == "manager":
        if call.get("user_id") not in (None, user["id"]):
            raise HTTPException(403, "Forbidden")
        return
    raise HTTPException(403, "Forbidden")


@router.get("/calls/{call_id}/audio")
async def get_audio(call_id: int, user: dict = Depends(get_current_user)):
    """Stream the raw WAV audio for a call to the client (browser WavePlayer)."""
    call = db.get_call(call_id)
    if call is None or not call["audio_path"]:
        raise HTTPException(404, "audio not found")
    _check_call_access(call, user)
    path = audio.resolve_audio_path(call["audio_path"])
    if path is None:
        raise HTTPException(404, "audio file missing")
    return FileResponse(path, media_type="audio/wav")


@router.patch("/calls/{call_id}/transcript")
async def update_transcript(call_id: int, payload: dict, user: dict = Depends(get_current_user)):
    """Manual edit of transcript text and/or segments (for Uzbek cleanup)."""
    call = db.get_call(call_id)
    if call is None:
        raise HTTPException(404, "call not found")
    _check_call_access(call, user)
    fields = {}
    if "transcript" in payload:
        fields["transcript"] = payload["transcript"]
    if "segments" in payload:
        fields["segments"] = json.dumps(payload["segments"], ensure_ascii=False)
    if "call_type" in payload:
        fields["call_type"] = payload["call_type"]
    if "client_id" in payload:
        fields["client_id"] = payload["client_id"]
    if fields:
        db.update_call(call_id, **fields)
    return db.get_call(call_id)


@router.post("/calls/{call_id}/reanalyze")
async def reanalyze(call_id: int, background: BackgroundTasks, user: dict = Depends(get_current_user)):
    """Re-run LLM analysis on a call's transcript (useful after manual transcript edits)."""
    call = db.get_call(call_id)
    if call is None:
        raise HTTPException(404, "call not found")
    _check_call_access(call, user)
    background.add_task(_analyze_call, call_id)
    return {"ok": True}


@router.delete("/calls/{call_id}")
async def delete_call(call_id: int, user: dict = Depends(get_current_user)):
    """Delete a call and remove its on-disk audio + pcm files (admin deletes any)."""
    call = db.get_call(call_id)
    if call is None:
        raise HTTPException(404, "call not found")
    _check_call_access(call, user)
    if call["audio_path"]:
        wav = audio.resolve_audio_path(call["audio_path"])
        if wav:
            wav.unlink(missing_ok=True)
        pcm = config.PCM_DIR / (Path(call["audio_path"]).stem + ".pcm")
        pcm.unlink(missing_ok=True)
    with db.get_db() as conn:
        conn.execute("DELETE FROM calls WHERE id = ?", (call_id,))
    return {"ok": True}


# ---------------------------------------------------------------------------
# Startup: re-analyse done calls that lack the new ``topic`` field
# ---------------------------------------------------------------------------

def _reanalyse_done_calls():
    """Re-run analysis on all 'done' calls whose analysis JSON is missing ``topic``.

    Runs in a background thread on startup so it does not block the server.
    Each call is re-analysed with a short back-off to avoid hammering the API.
    """
    import time as _time

    with db.get_db() as conn:
        rows = conn.execute(
            "SELECT id, transcript FROM calls WHERE status = 'done'"
        ).fetchall()

    need_reanalysis = []
    for r in rows:
        call_id = r["id"]
        call = db.get_call(call_id)
        if not call:
            continue
        analysis = call.get("analysis") or {}
        if analysis.get("topic"):
            continue
        if not (call.get("transcript") or "").strip():
            continue
        need_reanalysis.append((call_id, call["transcript"]))

    if not need_reanalysis:
        return

    logger = logging.getLogger("suhbatdosh.api")
    logger.info("Re-analysing %d done calls to add topic field", len(need_reanalysis))

    for idx, (call_id, transcript) in enumerate(need_reanalysis):
        try:
            analyzer = Analyzer()
            result = asyncio.run(
                asyncio.wait_for(analyzer.analyze(transcript), timeout=60)
            )
            if "error" not in result:
                db.update_call(call_id, status="done", analysis=json.dumps(result, ensure_ascii=False))
                topic = (result.get("topic") or "").strip()
                if topic:
                    db.update_call(call_id, name=topic)
            logger.info("Re-analysed call %d (%d/%d)", call_id, idx + 1, len(need_reanalysis))
        except Exception as e:
            logger.warning("Re-analysis failed for call %d: %s", call_id, e)
        if idx < len(need_reanalysis) - 1:
            _time.sleep(2)


def start_reanalysis_task():
    """Launch the re-analysis of done calls in a daemon thread."""
    import threading
    t = threading.Thread(target=_reanalyse_done_calls, daemon=True, name="reanalyse-done")
    t.start()


# ---------------------------------------------------------------------------
# Analytics endpoints
# ---------------------------------------------------------------------------


@router.get("/stats/overview")
def stats_overview(user: dict = Depends(get_current_user)):
    return db.get_org_stats()


@router.get("/stats/day-over-day")
def stats_day_over_day(user: dict = Depends(get_current_user)):
    return db.get_day_over_day_stats()


@router.get("/stats/weekly-trend")
def stats_weekly_trend(user: dict = Depends(get_current_user)):
    return db.get_weekly_trend()


@router.get("/stats/monthly-trend")
def stats_monthly_trend(user: dict = Depends(get_current_user)):
    return db.get_monthly_trend()


@router.get("/stats/problem-calls")
def stats_problem_calls(user: dict = Depends(get_current_user)):
    return db.get_problem_calls()


@router.get("/stats/manager-rankings")
def stats_manager_rankings(user: dict = Depends(get_current_user)):
    return db.get_manager_rankings()


@router.get("/stats/source-breakdown")
def stats_source_breakdown(user: dict = Depends(get_current_user)):
    return db.get_source_breakdown()
