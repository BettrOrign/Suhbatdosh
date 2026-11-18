"""Persistent SQLite-backed background job worker for call processing."""

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from . import db

logger = logging.getLogger("suhbatdosh.jobs")

_stop_event = threading.Event()
_worker_thread: threading.Thread | None = None
_executor: ThreadPoolExecutor | None = None


def _run_job(job: dict) -> None:
    job_id = job["id"]
    job_type = job["job_type"]
    payload = job.get("payload") or {}
    call_id = payload.get("call_id")
    try:
        if job_type == "transcribe_call" and call_id is not None:
            from .api import _process_call
            _process_call(int(call_id))
        elif job_type == "analyze_call" and call_id is not None:
            from .api import _analyze_call
            _analyze_call(int(call_id))
        else:
            logger.warning("Unknown job type %r (id=%d)", job_type, job_id)
        db.complete_job(job_id)
    except Exception as exc:
        logger.exception("Job %d (%s) failed: %s", job_id, job_type, exc)
        db.fail_job(job_id, str(exc))


def _poll_loop() -> None:
    assert _executor is not None
    while not _stop_event.is_set():
        try:
            job = db.claim_next_job()
            if job is not None:
                _executor.submit(_run_job, job)
                continue
        except Exception:
            logger.exception("Job queue poll error")
        _stop_event.wait(1.5)


def enqueue_call_pipeline(call_id: int, org_id: int = 1) -> None:
    """Enqueue transcription and analysis jobs for a call into the persistent queue."""
    db.enqueue_job("transcribe_call", {"call_id": call_id}, org_id=org_id)
    db.enqueue_job("analyze_call", {"call_id": call_id}, org_id=org_id)


def start_worker(max_workers: int = 2) -> None:
    """Recover stale jobs and start the background worker loop."""
    global _worker_thread, _executor
    if _worker_thread is not None and _worker_thread.is_alive():
        return
    recovered = db.recover_stale_jobs()
    if recovered:
        logger.info("Recovered %d stale job(s) from previous run", recovered)
    _stop_event.clear()
    _executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="job-worker")
    _worker_thread = threading.Thread(target=_poll_loop, daemon=True, name="job-queue-poller")
    _worker_thread.start()


def stop_worker() -> None:
    """Signal the worker loop to stop and shut down the executor."""
    global _worker_thread, _executor
    _stop_event.set()
    if _worker_thread is not None:
        _worker_thread.join(timeout=3)
        _worker_thread = None
    if _executor is not None:
        _executor.shutdown(wait=False)
        _executor = None
