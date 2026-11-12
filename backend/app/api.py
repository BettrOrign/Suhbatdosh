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
from .auth import get_current_user, require_role
from .transcribe import Transcriber

logger = logging.getLogger("suhbatdosh.api")
router = APIRouter(prefix="/api")

# The REST background tasks (_process_call / _analyze_call) intentionally create
# fresh Transcriber()/Analyzer() instances per call to avoid reusing a single
# async HTTP client across asyncio.run() loops (which raises "Event loop is closed").


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
            org_id = call.get("org_id") or 1

            result = asyncio.run(
                asyncio.wait_for(Transcriber(org_id=org_id).transcribe_wav(wav), timeout=120)
            )
            segments = result.get("segments", [])
            text = result.get("text", "") or ""

            acoustics = audio.compute_acoustics(wav)
            if acoustics:
                segments = audio.assign_stereo_speakers(segments, acoustics)
                meta = dict(call.get("source_meta") or {})
                meta["acoustics"] = {k: v for k, v in acoustics.items() if k != "stereo_turns"}
                source_meta_str = json.dumps(meta, ensure_ascii=False)
            else:
                source_meta_str = None

            update_kwargs = {
                "status": "transcribed",
                "transcript": text,
                "segments": json.dumps(segments, ensure_ascii=False),
                "language": result.get("language_code") or None,
            }
            if source_meta_str is not None:
                update_kwargs["source_meta"] = source_meta_str
            db.update_call(call_id, **update_kwargs)
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
            org_id = call.get("org_id") or 1
            analyzer = Analyzer(org_id=org_id)
            result = asyncio.run(
                asyncio.wait_for(analyzer.analyze(call["transcript"]), timeout=60)
            )

            if (
                call.get("user_id")
                and "error" not in result
                and db.get_flag("problem_alerts", org_id=org_id)
            ):
                action_items = result.get("action_items") or []
                for item in action_items:
                    if not isinstance(item, dict):
                        continue
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
            lang = (result.get("language") or "").strip()
            logger.info("Analysis result for call %d: topic=%r, keys=%s", call_id, topic, list(result.keys()))
            extra_updates = {}
            if topic:
                extra_updates["name"] = topic
            if lang and not call.get("language"):
                extra_updates["language"] = lang
            if extra_updates:
                db.update_call(call_id, **extra_updates)

            # Interactive & Outactive Problem Escalation:
            # If problems are detected in conversation, AI selects the most competent
            # employee (e.g. principal if teacher failed) and dispatches Gmail/Telegram alert.
            try:
                from .escalation import evaluate_and_escalate_call
                asyncio.run(
                    evaluate_and_escalate_call(
                        call_id=call_id,
                        analysis_data=result,
                        transcript=call["transcript"],
                        org_id=org_id,
                    )
                )
            except Exception as esc_err:
                logger.warning("Auto-escalation check failed for call %d: %s", call_id, esc_err)

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
        org_id = user.get("org_id") or 1
        target_user_id = user["id"]
        if user["role"] == "admin" and assigned_user_id:
            target = db.get_user(assigned_user_id)
            if target and (target.get("org_id") or 1) == org_id:
                target_user_id = assigned_user_id
        if client_id:
            cl = db.get_client(client_id, org_id=org_id)
            if not cl:
                client_id = None
        call_id = db.create_call(
            name=name or Path(file.filename or "call").stem,
            audio_path=str(wav_path),
            duration_sec=dur,
            call_type=ctype,
            user_id=target_user_id,
            client_id=client_id,
            source_type=stype,
            org_id=org_id,
        )
        db.update_call(call_id, status="queued")
        background.add_task(_process_call, call_id)
        background.add_task(_analyze_call, call_id)
        return db.get_call(call_id, org_id=org_id)
    finally:
        tmp_path.unlink(missing_ok=True)


@router.get("/calls")
async def get_calls(
    call_type: str | None = None,
    user: dict = Depends(get_current_user),
):
    """List calls scoped to the current user's organization and role.

    Admin and yonalish see everything in their organization; a manager sees
    their own manager calls; a receptionist sees receptionist calls.
    """
    org_id = user.get("org_id") or 1
    if user["role"] in ("admin", "yonalish"):
        return db.list_calls(call_type=call_type, org_id=org_id)
    if user["role"] == "manager":
        return db.list_calls(user_id=user["id"], call_type="manager", org_id=org_id)
    return db.list_calls(call_type="receptionist", org_id=org_id)


@router.get("/calls/{call_id}")
async def get_call(call_id: int, user: dict = Depends(get_current_user)):
    """Fetch a single call by id, enforcing organization isolation and per-role access."""
    call = db.get_call(call_id, org_id=user.get("org_id") or 1)
    if call is None:
        raise HTTPException(404, "call not found")
    _check_call_access(call, user)
    meta = dict(call.get("source_meta") or {})
    if "acoustics" not in meta and call.get("audio_path"):
        wav = audio.resolve_audio_path(call["audio_path"])
        if wav is not None:
            ac = audio.compute_acoustics(wav)
            if ac:
                meta["acoustics"] = {k: v for k, v in ac.items() if k != "stereo_turns"}
                call["source_meta"] = meta
    return call


def _check_call_access(call: dict, user: dict):
    """Enforce that the current user may access a given call.

    Cross-organization access raises 404 so call IDs cannot be enumerated.
    Admin/yonalish: always within org. Receptionist: only receptionist calls.
    Manager: only manager calls owned by them (or unassigned).
    """
    if (call.get("org_id") or 1) != (user.get("org_id") or 1):
        raise HTTPException(404, "call not found")
    if user["role"] in ("admin", "yonalish"):
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
    call = db.get_call(call_id, org_id=user.get("org_id") or 1)
    if call is None or not call["audio_path"]:
        raise HTTPException(404, "audio not found")
    _check_call_access(call, user)
    path = audio.resolve_audio_path(call["audio_path"])
    if path is None:
        raise HTTPException(404, "audio file missing")
    return FileResponse(path, media_type="audio/wav")


@router.patch("/calls/{call_id}")
@router.patch("/calls/{call_id}/transcript")
async def update_transcript(call_id: int, payload: dict, user: dict = Depends(get_current_user)):
    """Manual edit of call metadata, resolved state, transcript text and/or segments."""
    org_id = user.get("org_id") or 1
    call = db.get_call(call_id, org_id=org_id)
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
    if "name" in payload and str(payload["name"]).strip():
        fields["name"] = str(payload["name"]).strip()
    if "resolved" in payload:
        fields["resolved"] = 1 if payload["resolved"] else 0
    if "bookmarked" in payload:
        fields["bookmarked"] = 1 if payload["bookmarked"] else 0
    if "bookmark_note" in payload:
        fields["bookmark_note"] = str(payload.get("bookmark_note") or "").strip()
    if fields:
        db.update_call(call_id, **fields)
    return db.get_call(call_id, org_id=org_id)


@router.post("/calls/{call_id}/reanalyze")
async def reanalyze(call_id: int, background: BackgroundTasks, user: dict = Depends(get_current_user)):
    """Re-run LLM analysis on a call's transcript (useful after manual transcript edits)."""
    call = db.get_call(call_id, org_id=user.get("org_id") or 1)
    if call is None:
        raise HTTPException(404, "call not found")
    _check_call_access(call, user)
    background.add_task(_analyze_call, call_id)
    return {"ok": True}


@router.post("/calls/reanalyze-all")
async def reanalyze_all(background: BackgroundTasks, user: dict = Depends(require_role("admin"))):
    """Queue re-analysis of every analysed call in the current organization (cap 200, newest first). Admin only."""
    ids = db.list_analysable_call_ids(limit=200, org_id=user.get("org_id") or 1)
    for call_id in ids:
        background.add_task(_analyze_call, call_id)
    logger.info("Bulk re-analysis queued for %d call(s) by %s", len(ids), user["email"])
    return {"ok": True, "queued": len(ids)}


@router.delete("/calls/{call_id}")
async def delete_call(call_id: int, user: dict = Depends(get_current_user)):
    """Delete a call and remove its on-disk audio + pcm files (admin deletes any)."""
    call = db.get_call(call_id, org_id=user.get("org_id") or 1)
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

def _reanalyse_done_calls(limit: int = 50):
    """Re-run analysis on 'done' calls whose analysis JSON is missing ``topic``.

    Runs in a background thread on startup so it does not block the server.
    The candidate set is capped at ``limit`` (oldest first, so the backlog
    drains in order) because this would otherwise re-bill Gemini for the whole
    database on every restart. Single SQL query — no N+1 get_call per row.
    """
    import time as _time

    with db.get_db() as conn:
        rows = conn.execute(
            "SELECT c.id, c.transcript, c.analysis FROM calls c "
            "WHERE c.status = 'done' AND c.transcript IS NOT NULL "
            "AND TRIM(c.transcript) != '' "
            "AND (c.analysis IS NULL OR c.analysis = '' OR c.analysis = '{}' "
            "     OR json_extract(c.analysis, '$.topic') IS NULL) "
            "ORDER BY c.id LIMIT ?",
            (limit,),
        ).fetchall()

    need_reanalysis = []
    for r in rows:
        analysis = json.loads(r["analysis"] or "{}")
        if analysis.get("topic"):
            continue
        need_reanalysis.append((r["id"], r["transcript"]))

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
#
# These aggregate across the whole organisation, so they are restricted to the
# roles that legitimately see org-wide performance. Managers get their own
# numbers back through /api/calls instead, not someone else's.

ORG_WIDE_STATS = Depends(require_role("admin", "yonalish"))


@router.get("/stats/overview")
def stats_overview(user: dict = ORG_WIDE_STATS):
    return db.get_org_stats(org_id=user.get("org_id") or 1)


@router.get("/stats/day-over-day")
def stats_day_over_day(user: dict = ORG_WIDE_STATS):
    return db.get_day_over_day_stats(org_id=user.get("org_id") or 1)


@router.get("/stats/weekly-trend")
def stats_weekly_trend(user: dict = ORG_WIDE_STATS):
    return db.get_weekly_trend(org_id=user.get("org_id") or 1)


@router.get("/stats/monthly-trend")
def stats_monthly_trend(user: dict = ORG_WIDE_STATS):
    return db.get_monthly_trend(org_id=user.get("org_id") or 1)


@router.get("/stats/problem-calls")
def stats_problem_calls(user: dict = ORG_WIDE_STATS):
    return db.get_problem_calls(org_id=user.get("org_id") or 1)


@router.get("/stats/manager-rankings")
def stats_manager_rankings(user: dict = ORG_WIDE_STATS):
    return db.get_manager_rankings(org_id=user.get("org_id") or 1)


@router.get("/stats/source-breakdown")
def stats_source_breakdown(user: dict = ORG_WIDE_STATS):
    return db.get_source_breakdown(org_id=user.get("org_id") or 1)


@router.get("/stats/insights")
def stats_insights(user: dict = ORG_WIDE_STATS):
    """Cross-call intelligence: recurring objections, flaws, rubric weak spots, and coach decisions."""
    return db.get_cross_call_insights(org_id=user.get("org_id") or 1)


@router.post("/stats/ask")
async def stats_ask_ai(payload: dict, user: dict = ORG_WIDE_STATS):
    """Ask AI a natural-language question across recent analysed calls."""
    question = (payload.get("question") or "").strip()
    if not question:
        raise HTTPException(400, "question is required")
    org_id = user.get("org_id") or 1
    calls_ctx = db.list_recent_calls_for_qa(limit=30, org_id=org_id)
    try:
        return await Analyzer(org_id=org_id).ask_across_calls(question, calls_ctx)
    except Exception as exc:
        logger.exception("stats_ask_ai failed")
        raise HTTPException(502, f"AI query failed: {exc}") from exc


# ---------------------------------------------------------------------------
# Problem Escalations & Interactive Dispatch
# ---------------------------------------------------------------------------


@router.get("/calls/{call_id}/escalation")
def get_call_escalation_endpoint(call_id: int, user: dict = Depends(get_current_user)):
    """Return the most recent problem escalation for a specific call."""
    call = db.get_call(call_id)
    if not call or (call.get("org_id") or 1) != (user.get("org_id") or 1):
        raise HTTPException(404, "Call not found")
    esc = db.get_call_escalation(call_id)
    return {"escalation": esc}


@router.post("/calls/{call_id}/escalate")
async def trigger_call_escalation(
    call_id: int,
    payload: dict | None = None,
    user: dict = Depends(require_role("admin", "yonalish")),
):
    """Manually trigger or re-assign an escalation for a call."""
    call = db.get_call(call_id)
    if not call or (call.get("org_id") or 1) != (user.get("org_id") or 1):
        raise HTTPException(404, "Call not found")
    org_id = user.get("org_id") or 1
    payload = payload or {}

    assigned_user_id = payload.get("assigned_to_user_id")
    detected_problem = (payload.get("detected_problem") or "").strip()
    reason = (payload.get("assigned_reason") or "").strip()
    action_plan = payload.get("action_plan") or []

    # If specific assignment was given manually
    if assigned_user_id:
        target_user = db.get_user(assigned_user_id)
        if not target_user or (target_user.get("org_id") or 1) != org_id:
            raise HTTPException(400, "Assigned user not found in organization")
        if not detected_problem:
            detected_problem = f"Qoʻngʻiroqda muammo aniqlandi ({call.get('name', 'Nomsiz')})"
        if not reason:
            reason = f"{user.get('name', 'Admin')} tomonidan masʼul etib tayinlandi"

        esc_id = db.create_escalation(
            org_id=org_id,
            call_id=call_id,
            detected_problem=detected_problem,
            assigned_to_user_id=assigned_user_id,
            assigned_reason=reason,
            action_plan=action_plan if isinstance(action_plan, list) else [str(action_plan)],
            severity=payload.get("severity", "high"),
            channel=payload.get("channel", "email"),
        )
        from .notifications_dispatcher import dispatch_problem_escalation
        dispatch_results = dispatch_problem_escalation(esc_id, org_id=org_id)
        return {"escalation": db.get_escalation(esc_id), "dispatch": dispatch_results}

    # Otherwise trigger AI evaluation
    analysis_data = {}
    if call.get("analysis"):
        try:
            analysis_data = json.loads(call["analysis"]) if isinstance(call["analysis"], str) else call["analysis"]
        except Exception:
            pass
    from .escalation import evaluate_and_escalate_call
    esc = await evaluate_and_escalate_call(
        call_id=call_id,
        analysis_data=analysis_data,
        transcript=call.get("transcript") or "",
        org_id=org_id,
    )
    return {"escalation": esc}


@router.post("/escalations/{escalation_id}/resolve")
def resolve_call_escalation(
    escalation_id: int,
    payload: dict | None = None,
    user: dict = Depends(get_current_user),
):
    """Mark an escalation as resolved with resolution notes."""
    esc = db.get_escalation(escalation_id)
    if not esc or (esc.get("org_id") or 1) != (user.get("org_id") or 1):
        raise HTTPException(404, "Escalation not found")
    notes = (payload or {}).get("notes", "")
    db.resolve_escalation(escalation_id, resolution_notes=notes)
    return {"ok": True, "escalation": db.get_escalation(escalation_id)}


@router.get("/escalations")
def list_org_escalations(
    status: str | None = None,
    user: dict = Depends(require_role("admin", "yonalish")),
):
    """List all problem escalations in the current organization."""
    org_id = user.get("org_id") or 1
    return db.list_escalations(org_id=org_id, status=status)


