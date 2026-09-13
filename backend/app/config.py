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

# --- Storage paths ---------------------------------------------------------
_data_dir = (
    os.getenv("DATA_DIR")
    or _CFG.get("paths", {}).get("data_dir")
    or (BASE_DIR / ".." / "data")
)
DATA_DIR = Path(_data_dir).resolve()
AUDIO_DIR = DATA_DIR / "audio"
PCM_DIR = DATA_DIR / "pcm"
DB_PATH = DATA_DIR / "viacall.db"

# --- Admin bootstrap credentials -------------------------------------------
# These are read from the environment (.env) only and never hardcoded in code,
# so the dev password is not committed to the repository. main.py skips the
# auto-seed when either value is empty.
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")
ADMIN_NAME = os.getenv("ADMIN_NAME", "Admin")

# --- Telegram Bot ------------------------------------------------------------
TELEGRAM_ENABLED = os.getenv("TELEGRAM_ENABLED", "true").lower() in ("true", "1", "yes")
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_ADMIN_IDS: list[int] = [
    int(x) for x in os.getenv("TELEGRAM_ADMIN_IDS", "").split(",") if x.strip().isdigit()
]

# --- YouTube Integration -----------------------------------------------------
YOUTUBE_ENABLED = os.getenv("YOUTUBE_ENABLED", "true").lower() in ("true", "1", "yes")

# Ensure the directories the app writes audio/pcm into exist at import time,
# so concurrent upload jobs never race to create them on first use.
for d in (AUDIO_DIR, PCM_DIR):
    d.mkdir(parents=True, exist_ok=True)
