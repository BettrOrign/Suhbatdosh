import os
from pathlib import Path

import yaml
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

# Optional path to a YAML config; falls back to config.yaml next to backend/.
CONFIG_PATH = Path(os.getenv("CONFIG_YAML", BASE_DIR / "config.yaml"))


def _load_yaml() -> dict:
    """Read the optional YAML config file, returning {} when it is absent."""
    if CONFIG_PATH.exists():
        with open(CONFIG_PATH, encoding="utf-8") as fh:
            return yaml.safe_load(fh) or {}
    return {}


_CFG = _load_yaml()


def _resolve(section: str, key: str, env_name: str, default):
    """Pick a setting with env vars winning over YAML, then the built-in default.

    Secrets (API keys, admin credentials) are intentionally never stored in the
    YAML file — they come from the environment (.env) only.
    """
    env_val = os.getenv(env_name)
    if env_val not in (None, ""):
        return env_val
    return _CFG.get(section, {}).get(key, default)


# --- Gemini models ---------------------------------------------------------
# The API key is a secret and is read solely from the environment (.env).
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_LIVE_MODEL = _resolve(
    "gemini", "live_model", "GEMINI_LIVE_MODEL",
    "gemini-2.5-flash-native-audio-preview-12-2025",
)
GEMINI_ANALYSIS_MODEL = _resolve(
    "gemini", "analysis_model", "GEMINI_ANALYSIS_MODEL", "gemini-2.5-flash",
)

# --- Local STT (private mode) ------------------------------------------------
# The offline GigaAM model ships in the read-only local-stt/ folder next to
# backend/, so <repo>/local-stt/model is the default. Overridable for tests
# and for deployments that stage the model elsewhere.
REPO_DIR = BASE_DIR.parent
LOCAL_STT_MODEL_DIR = Path(
    _resolve("stt", "model_dir", "LOCAL_STT_MODEL_DIR", REPO_DIR / "local-stt" / "model")
).resolve()
LOCAL_STT_THREADS = int(_resolve("stt", "threads", "LOCAL_STT_THREADS", "8"))
LOCAL_STT_SAMPLE_RATE = 16000
# Languages the GigaAM multilingual CTC model is trained for.
LOCAL_STT_LANGUAGES = ["uz", "ru", "en", "kk", "ky"]

# --- Storage paths ---------------------------------------------------------
_data_dir = (
    os.getenv("DATA_DIR")
    or _CFG.get("paths", {}).get("data_dir")
    or (BASE_DIR / ".." / "data")
)
DATA_DIR = Path(_data_dir).resolve()
AUDIO_DIR = DATA_DIR / "audio"
PCM_DIR = DATA_DIR / "pcm"
DB_PATH = DATA_DIR / "suhbatdosh.db"

# --- Admin bootstrap credentials -------------------------------------------
# These are read from the environment (.env) only and never hardcoded in code,
# so the dev password is not committed to the repository. main.py skips the
# auto-seed when either value is empty.
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")
ADMIN_NAME = os.getenv("ADMIN_NAME", "Admin")


def _env_flag(env_name: str, default: bool) -> bool:
    """Like :func:`_flag` but lets YAML win over the built-in default."""
    val = os.getenv(env_name)
    if val not in (None, ""):
        return val.strip().lower() in ("true", "1", "yes", "on")
    return _CFG.get("app", {}).get(env_name.lower(), default)


# Demo seeding ships with trivial passwords, so it is ON only when APP_ENV is
# absent/"dev"/"development" (the default). Production must set APP_ENV=prod,
# which turns both the demo accounts and the demo calls off.
APP_ENV = (os.getenv("APP_ENV", "") or "").strip().lower()
DEV_MODE = APP_ENV in ("", "dev", "development", "local")
SEED_DEMO_USERS = _env_flag("SEED_DEMO_USERS", DEV_MODE)
SEED_DEMO_CALLS = _env_flag("SEED_DEMO_CALLS", DEV_MODE)

# --- CORS -------------------------------------------------------------------
# Comma-separated origin allowlist. Empty/unset falls back to "*" so the
# Vite dev server (and same-origin static hosting) keep working out of the box;
# production deployments should pin CORS_ORIGINS to their real hostnames.
CORS_ORIGINS = [
    o.strip().rstrip("/")
    for o in (os.getenv("CORS_ORIGINS", "") or "").split(",")
    if o.strip()
] or ["*"]

# Shared secret for machine-to-machine webhook endpoints (e.g. the Zadarma
# webhook, which Zadarma calls without any session token). Empty means the
# endpoint is refused rather than left open.
ZADARMA_WEBHOOK_SECRET = os.getenv("ZADARMA_WEBHOOK_SECRET", "")

# --- Telegram Bot ------------------------------------------------------------
TELEGRAM_ENABLED = os.getenv("TELEGRAM_ENABLED", "true").lower() in ("true", "1", "yes")
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_ADMIN_IDS: list[int] = [
    int(x) for x in os.getenv("TELEGRAM_ADMIN_IDS", "").split(",") if x.strip().isdigit()
]

# --- YouTube Integration -----------------------------------------------------
YOUTUBE_ENABLED = os.getenv("YOUTUBE_ENABLED", "true").lower() in ("true", "1", "yes")

# --- Zadarma Integration ----------------------------------------------------
ZADARMA_API_KEY = os.getenv("ZADARMA_API_KEY", "")
ZADARMA_API_SECRET = os.getenv("ZADARMA_API_SECRET", "")

# Ensure the directories the app writes audio/pcm into exist at import time,
# so concurrent upload jobs never race to create them on first use.
for d in (AUDIO_DIR, PCM_DIR):
    d.mkdir(parents=True, exist_ok=True)
