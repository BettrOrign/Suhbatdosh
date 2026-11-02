import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from . import audio, config, db
from .api import router as api_router, start_reanalysis_task
from .auth import hash_password
from .routes_auth import router as auth_router
from .routes_clients import router as clients_router
from .routes_ingest import router as ingest_router
from .routes_managers import router as managers_router
from .routes_notifications import router as notifications_router
from .routes_settings import router as settings_router
from .routes_sources import router as sources_router
from .routes_zadarma import router as zadarma_router
from .telegram_bot import create_bot_application

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

_telegram_app = None


async def _retention_worker():
    """Hourly audio-retention pass; reads the setting fresh so edits apply live."""
    while True:
        try:
            days = db.get_retention_days()
            if days:
                removed = audio.purge_expired_audio(days)
                if removed:
                    logging.getLogger("suhbatdosh.main").info(
                        "Audio retention: deleted %d recording(s) older than %d days",
                        removed,
                        days,
                    )
        except Exception:
            logging.getLogger("suhbatdosh.main").exception("Audio retention pass failed")
        await asyncio.sleep(3600)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _telegram_app
    db.init_db()
    _seed_admin()
    # Backfill ``topic`` for done calls analysed before that field existed.
    start_reanalysis_task()
    asyncio.create_task(_retention_worker())
    if config.TELEGRAM_ENABLED:
        _telegram_app = create_bot_application()
        if _telegram_app:
            try:
                await _telegram_app.initialize()
                await _telegram_app.start()
                await _telegram_app.updater.start_polling()
                logging.getLogger("suhbatdosh.main").info("Telegram bot started (polling)")
            except Exception as exc:
                logging.getLogger("suhbatdosh.main").warning(
                    "Telegram bot could not start (continuing without it): %s", exc
                )
                _telegram_app = None
    yield
    if _telegram_app:
        await _telegram_app.updater.stop()
        await _telegram_app.stop()
        await _telegram_app.shutdown()
        logging.getLogger("suhbatdosh.main").info("Telegram bot stopped")


app = FastAPI(title="suhbatdosh - AI suhbat coach", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)
app.include_router(auth_router)
app.include_router(clients_router)
app.include_router(ingest_router)
app.include_router(managers_router)
app.include_router(notifications_router)
app.include_router(sources_router)
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


FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="static-assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """Serve static files or fall back to index.html for SPA routing."""
        file_path = FRONTEND_DIST / full_path
        if full_path and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(FRONTEND_DIST / "index.html")