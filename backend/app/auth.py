import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Depends, Header, HTTPException, Request, Response

from . import config, db

SESSION_TTL_HOURS = 24 * 7  # 7 days idle TTL
SESSION_MAX_DAYS = 30  # 30 days absolute max TTL
PBKDF2_ITERATIONS = 600_000
LEGACY_PBKDF2_ITERATIONS = 100_000

SESSION_COOKIE = "sd_session"
CSRF_COOKIE = "sd_csrf"
CSRF_HEADER = "X-CSRF-Token"

COMMON_WEAK_PASSWORDS = frozenset({
    "1234567890",
    "12345678901",
    "123456789012",
    "password123",
    "password1234",
    "qwerty12345",
    "qwertyuiop",
    "admin12345",
    "suhbatdosh",
    "suhbatdosh1",
    "letmein1234",
    "welcome1234",
})


def hash_password(password: str, iterations: int = PBKDF2_ITERATIONS) -> str:
    """Salted PBKDF2-HMAC-SHA256 hash of a password (600,000 iterations by default).

    Stored as ``pbkdf2$<iterations>$<salt_hex>$<digest_hex>``.
    """
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations).hex()
    return f"pbkdf2${iterations}${salt}${digest}"


# Precomputed dummy hash so unknown-email login attempts perform the same work.
DUMMY_PASSWORD_HASH = hash_password("dummy-timing-guard-password")


def verify_password(password: str, stored: str) -> bool:
    """Constant-time comparison of a plaintext password against a stored hash.

    Supports both ``pbkdf2$<iterations>$<salt>$<digest>`` and legacy
    ``<salt>$<digest>`` (100,000 iterations) records.
    """
    if not stored:
        return False
    try:
        if stored.startswith("pbkdf2$"):
            _, iter_str, salt, digest = stored.split("$", 3)
            iterations = int(iter_str)
        else:
            salt, digest = stored.split("$", 1)
            iterations = LEGACY_PBKDF2_ITERATIONS
    except (ValueError, TypeError):
        return False
    check = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations).hex()
    return hmac.compare_digest(check, digest)


def needs_rehash(stored: str) -> bool:
    """Return True if a stored hash should be upgraded to the current iteration count."""
    return not (stored or "").startswith(f"pbkdf2${PBKDF2_ITERATIONS}$")


def validate_password_strength(password: str, email: str = "") -> None:
    """Enforce password policy on account creation and password change."""
    if not password or len(password) < 10:
        raise HTTPException(400, "Password must be at least 10 characters long")
    if len(password) > 128:
        raise HTTPException(400, "Password must not exceed 128 characters")
    low = password.strip().lower()
    if email and low == email.strip().lower():
        raise HTTPException(400, "Password must not match your email address")
    if low in COMMON_WEAK_PASSWORDS:
        raise HTTPException(400, "Password is too common; please choose a stronger password")


def new_session(user_id: int, user_agent: str = "", ip: str = "") -> str:
    """Create a new session token for ``user_id`` and persist its hash."""
    token, _ = new_session_with_csrf(user_id, user_agent=user_agent, ip=ip)
    return token


def new_session_with_csrf(user_id: int, user_agent: str = "", ip: str = "") -> tuple[str, str]:
    """Create a new session token + CSRF token pair and persist their hashes."""
    token = secrets.token_urlsafe(32)
    csrf_token = secrets.token_urlsafe(24)
    expires = (datetime.now(timezone.utc) + timedelta(hours=SESSION_TTL_HOURS)).isoformat()
    db.create_session(
        token=token,
        user_id=user_id,
        expires_at=expires,
        csrf_hash=db._hash_token(csrf_token),
        user_agent=user_agent,
        ip=ip,
    )
    return token, csrf_token


def set_auth_cookies(response: Response, request: Request, session_token: str, csrf_token: str) -> None:
    """Attach the httpOnly session cookie and readable CSRF cookie to ``response``."""
    secure = request.url.scheme == "https"
    max_age = SESSION_TTL_HOURS * 3600
    response.set_cookie(
        key=SESSION_COOKIE,
        value=session_token,
        max_age=max_age,
        httponly=True,
        samesite="lax",
        secure=secure,
        path="/",
    )
    response.set_cookie(
        key=CSRF_COOKIE,
        value=csrf_token,
        max_age=max_age,
        httponly=False,
        samesite="lax",
        secure=secure,
        path="/",
    )


def clear_auth_cookies(response: Response) -> None:
    """Remove session and CSRF cookies from the client."""
    response.delete_cookie(key=SESSION_COOKIE, path="/")
    response.delete_cookie(key=CSRF_COOKIE, path="/")


def generate_api_token() -> str:
    """Return a fresh random API token for a user (used by the ingest endpoint)."""
    return secrets.token_urlsafe(32)


def get_current_user(
    request: Request,
    authorization: str | None = Header(default=None),
) -> dict:
    """Resolve the authenticated user for a request.

    Accepts either:
    1. The ``sd_session`` httpOnly cookie (browser sessions), enforcing the
       double-submit ``X-CSRF-Token`` header on state-changing HTTP methods.
    2. An ``Authorization: Bearer <token>`` header (API / programmatic clients).

    Query-string ``?token=`` authentication is intentionally rejected so
    session tokens never leak into URLs, logs or browser history.
    """
    session_token = None
    used_cookie = False
    if authorization and authorization.startswith("Bearer "):
        session_token = authorization.removeprefix("Bearer ").strip()
    if not session_token:
        cookie_tok = request.cookies.get(SESSION_COOKIE)
        if cookie_tok:
            session_token = cookie_tok.strip()
            used_cookie = True

    if not session_token:
        raise HTTPException(401, "Not authenticated")

    sess = db.get_session(session_token)
    if sess is None:
        raise HTTPException(401, "Invalid or expired session")

    now_dt = datetime.now(timezone.utc)
    expires = datetime.fromisoformat(sess["expires_at"])
    created = datetime.fromisoformat(sess["created_at"])
    max_expires = created + timedelta(days=SESSION_MAX_DAYS)
    org_active = sess.get("org_active")
    if (
        expires < now_dt
        or now_dt > max_expires
        or not sess["user_active"]
        or (org_active is not None and not org_active)
    ):
        db.delete_session(session_token)
        raise HTTPException(401, "Invalid or expired session")

    if used_cookie and request.method in ("POST", "PUT", "PATCH", "DELETE") and sess.get("csrf_hash"):
        csrf_header = (request.headers.get(CSRF_HEADER) or "").strip()
        if not csrf_header or not hmac.compare_digest(db._hash_token(csrf_header), sess["csrf_hash"]):
            raise HTTPException(403, "CSRF token missing or invalid")

    # Sliding expiration: extend when more than 1 hour has elapsed since last touch
    target_expires = min(now_dt + timedelta(hours=SESSION_TTL_HOURS), max_expires)
    if (target_expires - expires).total_seconds() > 3600 and sess.get("id"):
        db.touch_session(sess["id"], target_expires.isoformat())

    return {
        "id": sess["user_id"],
        "name": sess["name"],
        "email": sess["email"],
        "role": sess["role"],
        "org_id": sess.get("org_id") or 1,
        "org_name": sess.get("org_name") or config.DEFAULT_ORG_NAME,
        "org_slug": sess.get("org_slug") or config.DEFAULT_ORG_SLUG,
    }


def session_token_from(
    request: Request,
    authorization: str | None = Header(default=None),
) -> str | None:
    """Extract the raw session token from the Bearer header or the ``sd_session`` cookie."""
    if authorization and authorization.startswith("Bearer "):
        return authorization.removeprefix("Bearer ").strip()
    cookie_tok = request.cookies.get(SESSION_COOKIE)
    return cookie_tok.strip() if cookie_tok else None


def get_user_by_token(token: str) -> dict | None:
    """Resolve a user from their API token (used by the external ingest endpoint)."""
    if not token:
        return None
    row = db.get_user_by_token(token)
    if row is None or not row.get("active"):
        return None
    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "role": row["role"],
        "org_id": row.get("org_id") or 1,
    }


def require_role(*roles: str):
    """FastAPI dependency factory enforcing one of the allowed roles."""
    def dep(user: dict = Depends(get_current_user)) -> dict:
        if user["role"] not in roles:
            raise HTTPException(403, "Forbidden")
        return user

    return dep