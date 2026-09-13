import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Depends, Header, HTTPException

from . import config, db

SESSION_TTL_HOURS = 24 * 7  # 7 days

def hash_password(password: str) -> str:
    """Salted PBKDF2-HMAC-SHA256 hash of a password.

    Generates a fresh 16-byte salt per password and stores the result as
    ``<salt_hex>$<digest_hex>``. The salt travels with the hash so
    :func:`verify_password` can recompute the digest with the same parameters.
    """
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000).hex()
    return f"{salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    """Constant-time comparison of a plaintext password against a stored hash.

    Splits the ``<salt>$<digest>`` record produced by :func:`hash_password`,
    recomputes the PBKDF2 digest with the stored salt, and uses
    :func:`hmac.compare_digest` to avoid timing side channels. Returns
    ``False`` for malformed records or mismatches.
    """
    try:
        salt, digest = stored.split("$", 1)
    except ValueError:
        return False
    check = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000).hex()
    return hmac.compare_digest(check, digest)


def new_session(user_id: int) -> str:
    """Create a new session token for ``user_id`` and persist it.

    Returns an opaque URL-safe token (``secrets.token_urlsafe(32)``) that the
    client sends back as a Bearer header or ``token`` query arg. The session
    row is written via :func:`db.create_session` with a TTL of
    :data:`SESSION_TTL_HOURS`.
    """
    token = secrets.token_urlsafe(32)
    expires = (datetime.now(timezone.utc) + timedelta(hours=SESSION_TTL_HOURS)).isoformat()
    db.create_session(token, user_id, expires)
    return token


def generate_api_token() -> str:
    """Return a fresh random API token for a user (used by the ingest endpoint).

    A URL-safe token without expiry; admins (or the owner) can regenerate it
    anytime, which instantly revokes the previous one.
    """
    return secrets.token_urlsafe(32)


def get_current_user(
    authorization: str | None = Header(default=None),
    token: str | None = None,
) -> dict:
    """Resolve the authenticated user for a request.

    The session token may be supplied either as a ``Bearer <token>`` value in
    the ``authorization`` header or as a ``token`` query/header parameter. The
    matching session is looked up in the DB; expired or inactive sessions are
    deleted and rejected with 401. Returns a ``{"id","name","email","role"}``
    dict that downstream endpoints and :func:`require_role` use for
    authorization checks.
    """
    session_token = None
    if authorization and authorization.startswith("Bearer "):
        session_token = authorization.removeprefix("Bearer ").strip()
    if not session_token and token:
        session_token = token
    if not session_token:
        raise HTTPException(401, "Not authenticated")
    sess = db.get_session(session_token)
    if sess is None:
        raise HTTPException(401, "Invalid or expired session")
    expires = datetime.fromisoformat(sess["expires_at"])
    if expires < datetime.now(timezone.utc) or not sess["user_active"]:
        db.delete_session(session_token)
        raise HTTPException(401, "Invalid or expired session")
    return {"id": sess["user_id"], "name": sess["name"], "email": sess["email"], "role": sess["role"]}


def get_user_by_token(token: str) -> dict | None:
    """Resolve a user from their API token (used by the external ingest endpoint).

    Returns the user dict ``{"id","name","email","role"}`` when the token
    belongs to an existing **active** account, otherwise ``None``. Inactive
    users are rejected so revoked tokens stop working immediately.
    """
    if not token:
        return None
    row = db.get_user_by_token(token)
    if row is None or not row.get("active"):
        return None
    return {"id": row["id"], "name": row["name"], "email": row["email"], "role": row["role"]}


def require_role(*roles: str):
    """FastAPI dependency factory enforcing one of the allowed roles.

    Returns a dependency that calls :func:`get_current_user` and raises 403
    unless the authenticated user's ``role`` is among ``roles``. Typical use:
    ``Depends(require_role("admin"))``.
    """
    def dep(user: dict = Depends(get_current_user)) -> dict:
        if user["role"] not in roles:
            raise HTTPException(403, "Forbidden")
        return user

    return dep