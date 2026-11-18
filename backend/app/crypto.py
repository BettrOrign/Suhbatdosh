"""Symmetric encryption helpers for sensitive organization settings at rest."""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from . import config

_PREFIX = "enc:v1:"

SECRET_SETTING_KEYS = frozenset({
    "zadarma_api_secret",
    "zadarma_webhook_secret",
    "smtp_password",
    "notif_smtp_password",
    "telegram_bot_token",
    "notif_telegram_bot_token",
    "lead_webhook_secret",
})


def _fernet() -> Fernet | None:
    raw = (config.SECRET_ENCRYPTION_KEY or "").strip()
    if not raw:
        return None
    digest = hashlib.sha256(raw.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_secret(value: str) -> str:
    """Encrypt ``value`` with Fernet when SECRET_ENCRYPTION_KEY is configured."""
    if not value:
        return value
    f = _fernet()
    if f is None:
        return value
    if value.startswith(_PREFIX):
        return value
    return _PREFIX + f.encrypt(value.encode("utf-8")).decode("ascii")


def decrypt_secret(value: str) -> str:
    """Decrypt ``enc:v1:...`` values; returns plaintext legacy values unchanged."""
    if not value or not value.startswith(_PREFIX):
        return value
    f = _fernet()
    if f is None:
        return ""
    token = value[len(_PREFIX):]
    try:
        return f.decrypt(token.encode("ascii")).decode("utf-8")
    except InvalidToken:
        return ""
