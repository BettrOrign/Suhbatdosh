import asyncio
import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from . import audio, config, db, job_queue
from .api import router as api_router, start_reanalysis_task
from .auth import hash_password
from .routes_auth import router as auth_router
from .routes_clients import router as clients_router
from .routes_ico import router as ico_router
from .routes_ingest import router as ingest_router
from .routes_managers import router as managers_router
from .routes_notifications import router as notifications_router
from .routes_rubrics import router as rubrics_router
from .routes_settings import router as settings_router
from .routes_sources import router as sources_router
from .routes_telegram import router as telegram_router
from .routes_zadarma import router as zadarma_router
from .telegram_bot import create_bot_application
from .telegram_reader import start as start_reader, stop as stop_reader

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

_telegram_app = None


async def _retention_worker():
    """Hourly audio-retention pass; reads each organization's setting fresh."""
    while True:
        try:
            with db.get_db() as conn:
                org_ids = [r["id"] for r in conn.execute("SELECT id FROM organizations").fetchall()]
            for oid in org_ids:
                days = db.get_retention_days(org_id=oid)
                if days:
                    removed = audio.purge_expired_audio(days, org_id=oid)
                    if removed:
                        logging.getLogger("suhbatdosh.main").info(
                            "Audio retention (org %d): deleted %d recording(s) older than %d days",
                            oid,
                            removed,
                            days,
                        )
        except Exception:
            logging.getLogger("suhbatdosh.main").exception("Audio retention pass failed")
        await asyncio.sleep(3600)


_telegram_lock = asyncio.Lock()


async def start_telegram_bot() -> bool:
    """Start the Telegram polling bot if enabled and a token is configured."""
    global _telegram_app
    if not config.TELEGRAM_ENABLED:
        return False
    async with _telegram_lock:
        if _telegram_app is not None:
            return True
        app_instance = create_bot_application()
        if not app_instance:
            return False
        try:
            await app_instance.initialize()
            await app_instance.start()
            await app_instance.updater.start_polling()
            _telegram_app = app_instance
            logging.getLogger("suhbatdosh.main").info("Telegram bot started (polling)")
            return True
        except Exception as exc:
            logging.getLogger("suhbatdosh.main").warning(
                "Telegram bot could not start (continuing without it): %s", exc
            )
            _telegram_app = None
            return False


async def stop_telegram_bot() -> None:
    """Stop the running Telegram polling bot if active."""
    global _telegram_app
    async with _telegram_lock:
        if _telegram_app is None:
            return
        try:
            if _telegram_app.updater and _telegram_app.updater.running:
                await _telegram_app.updater.stop()
            await _telegram_app.stop()
            await _telegram_app.shutdown()
            logging.getLogger("suhbatdosh.main").info("Telegram bot stopped")
        except Exception as exc:
            logging.getLogger("suhbatdosh.main").warning("Error stopping Telegram bot: %s", exc)
        finally:
            _telegram_app = None


async def restart_telegram_bot() -> bool:
    """Restart the Telegram bot (e.g., when token is updated in Settings)."""
    await stop_telegram_bot()
    return await start_telegram_bot()


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    _seed_admin()
    # Backfill ``topic`` for done calls analysed before that field existed.
    start_reanalysis_task()
    job_queue.start_worker()
    asyncio.create_task(_retention_worker())
    await start_telegram_bot()
    if config.TELEGRAM_READER_BOT_TOKEN:
        start_reader()
        logging.getLogger("suhbatdosh.main").info("Telegram reader bot started")
    yield
    job_queue.stop_worker()
    if config.TELEGRAM_READER_BOT_TOKEN:
        stop_reader()
        logging.getLogger("suhbatdosh.main").info("Telegram reader bot stopped")
    await stop_telegram_bot()


app = FastAPI(title="suhbatdosh - AI suhbat coach", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers_middleware(request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' data: https:; media-src 'self' blob: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' ws: wss:",
    )
    if request.url.scheme == "https":
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response

app.include_router(api_router)
app.include_router(auth_router)
app.include_router(clients_router)
app.include_router(ico_router)
app.include_router(ingest_router)
app.include_router(managers_router)
app.include_router(notifications_router)
app.include_router(rubrics_router)
app.include_router(sources_router)
app.include_router(telegram_router)
app.include_router(settings_router)
app.include_router(zadarma_router)


def _seed_admin():
    if not config.ADMIN_EMAIL or not config.ADMIN_PASSWORD:
        logging.getLogger("suhbatdosh.main").warning(
            "Skipping admin seed: ADMIN_EMAIL / ADMIN_PASSWORD are not set in the environment."
        )
        return
    if db.get_user_by_email(config.ADMIN_EMAIL):
        return
    db.create_user(config.ADMIN_NAME, config.ADMIN_EMAIL, hash_password(config.ADMIN_PASSWORD), role="admin")
    logging.getLogger("suhbatdosh.main").info("Seeded admin user: %s", config.ADMIN_EMAIL)


@app.get("/api/health")
async def health():
    return {"ok": True}


def _resolve_frontend_dist() -> Path:
    env_dist = os.getenv("FRONTEND_DIST_DIR")
    if env_dist:
        return Path(env_dist)
    if getattr(sys, "frozen", False):
        bundled = Path(getattr(sys, "_MEIPASS", "")) / "frontend_dist"
        if bundled.exists():
            return bundled
    return Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"


FRONTEND_DIST = _resolve_frontend_dist()

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="static-assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """Serve static files or fall back to index.html for SPA routing."""
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")
        file_path = FRONTEND_DIST / full_path
        if full_path and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(FRONTEND_DIST / "index.html")
