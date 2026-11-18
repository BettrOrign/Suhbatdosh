import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from . import config, db
from .auth import (
    DUMMY_PASSWORD_HASH,
    clear_auth_cookies,
    generate_api_token,
    get_current_user,
    hash_password,
    needs_rehash,
    new_session_with_csrf,
    require_role,
    session_token_from,
    set_auth_cookies,
    validate_password_strength,
    verify_password,
)

router = APIRouter(prefix="/api")

VALID_ROLES = ("admin", "manager", "receptionist", "yonalish")

MAX_EMAIL_FAILS = 5
EMAIL_WINDOW_MINUTES = 15
LOCKOUT_MINUTES = 15

MAX_IP_FAILS = 30
IP_WINDOW_MINUTES = 60


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()[:64]
    return (request.client.host if request.client else "unknown")[:64]


def _user_agent(request: Request) -> str:
    return (request.headers.get("user-agent") or "")[:255]


def _check_rate_limit(ip: str, email: str) -> None:
    now_dt = datetime.now(timezone.utc)
    for key in (f"email:{email}", f"ip:{ip}"):
        rec = db.get_login_attempt(key)
        if rec and rec.get("locked_until"):
            locked_dt = datetime.fromisoformat(rec["locked_until"])
            if locked_dt > now_dt:
                retry_sec = max(1, int((locked_dt - now_dt).total_seconds()))
                raise HTTPException(
                    status_code=429,
                    detail="Too many failed login attempts. Please try again later.",
                    headers={"Retry-After": str(retry_sec)},
                )


def _record_failed_login(ip: str, email: str) -> None:
    if email:
        db.record_login_failure(f"email:{email}", MAX_EMAIL_FAILS, EMAIL_WINDOW_MINUTES, LOCKOUT_MINUTES)
    if ip:
        db.record_login_failure(f"ip:{ip}", MAX_IP_FAILS, IP_WINDOW_MINUTES, LOCKOUT_MINUTES)


def _user_payload(u: dict, org: dict | None = None) -> dict:
    org_id = u.get("org_id") or 1
    if org is None:
        org = db.get_organization(org_id) or {}
    return {
        "id": u["id"],
        "name": u["name"],
        "email": u["email"],
        "role": u["role"],
        "org_id": org_id,
        "org_name": org.get("name") or config.DEFAULT_ORG_NAME,
        "org_slug": org.get("slug") or config.DEFAULT_ORG_SLUG,
        "sip_extension": u.get("sip_extension") or "",
        "job_title": u.get("job_title") or "",
        "department": u.get("department") or "",
        "skills": u.get("skills") or "",
        "telegram_id": u.get("telegram_id") or "",
        "phone": u.get("phone") or "",
    }


class SignupPayload(BaseModel):
    org_name: str = Field(..., min_length=2, max_length=100)
    name: str = Field(..., min_length=2, max_length=100)
    email: str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=10, max_length=128)


class ProfileUpdatePayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)


class PasswordChangePayload(BaseModel):
    current_password: str = Field(..., min_length=1, max_length=128)
    new_password: str = Field(..., min_length=10, max_length=128)


class InviteCreatePayload(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    role: str = Field(default="manager")


class InviteAcceptPayload(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    password: str = Field(..., min_length=10, max_length=128)


@router.post("/auth/signup")
def signup(payload: SignupPayload, request: Request, response: Response):
    """Self-serve company registration: creates a new organization + admin owner and logs them in."""
    if not config.SIGNUP_ENABLED:
        raise HTTPException(403, "Public registration is currently disabled")

    org_name = payload.org_name.strip()
    name = payload.name.strip()
    email = payload.email.strip().lower()
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(400, "Valid email address is required")
    if not org_name or not name:
        raise HTTPException(400, "Organization name and your name are required")

    validate_password_strength(payload.password, email=email)

    if db.get_user_by_email(email):
        raise HTTPException(409, "An account with this email already exists")

    org = db.create_organization(org_name)
    # Seed the organization profile name so AI prompts know the company name immediately
    db.set_org_profile({"name": org_name}, org_id=org["id"])

    user_id = db.create_user(
        name=name,
        email=email,
        password_hash=hash_password(payload.password),
        role="admin",
        org_id=org["id"],
    )
    user_row = db.get_user(user_id)
    token, csrf_token = new_session_with_csrf(
        user_id,
        user_agent=_user_agent(request),
        ip=_client_ip(request),
    )
    set_auth_cookies(response, request, token, csrf_token)
    return {
        "token": token,
        "csrf_token": csrf_token,
        "user": _user_payload(user_row, org=org),
    }


@router.post("/auth/login")
def login(payload: dict, request: Request, response: Response):
    email = str(payload.get("email") or "").strip().lower()[:254]
    password = str(payload.get("password") or "")[:128]
    ip = _client_ip(request)

    _check_rate_limit(ip, email)

    user = db.get_user_by_email(email) if email else None
    if not user:
        verify_password(password, DUMMY_PASSWORD_HASH)
        _record_failed_login(ip, email)
        raise HTTPException(401, "Invalid email or password")

    if not verify_password(password, user["password_hash"]):
        _record_failed_login(ip, email)
        raise HTTPException(401, "Invalid email or password")

    if not user["active"]:
        raise HTTPException(403, "Account disabled")

    db.clear_login_attempts(f"email:{email}")

    if needs_rehash(user["password_hash"]):
        db.update_user(user["id"], password_hash=hash_password(password))

    token, csrf_token = new_session_with_csrf(
        user["id"],
        user_agent=_user_agent(request),
        ip=ip,
    )
    set_auth_cookies(response, request, token, csrf_token)
    return {
        "token": token,
        "csrf_token": csrf_token,
        "user": _user_payload(user),
    }


@router.post("/auth/logout")
def logout(
    response: Response,
    user: dict = Depends(get_current_user),
    session_token: str | None = Depends(session_token_from),
):
    """End the current session and clear auth cookies."""
    if session_token:
        db.delete_session(session_token)
    clear_auth_cookies(response)
    return {"ok": True}


@router.get("/auth/me")
def me(user: dict = Depends(get_current_user)):
    """Return the current user plus their organization and API token."""
    row = db.get_user(user["id"])
    return {
        **user,
        "sip_extension": (row or {}).get("sip_extension") or "",
        "api_token": row["api_token"] if row else None,
    }


@router.patch("/auth/me")
def update_own_profile(payload: ProfileUpdatePayload, user: dict = Depends(get_current_user)):
    """Update the current user's own profile name."""
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Name cannot be empty")
    db.update_user(user["id"], name=name)
    row = db.get_user(user["id"])
    return {
        **_user_payload(row),
        "api_token": row["api_token"] if row else None,
    }


@router.post("/auth/password")
def change_own_password(
    payload: PasswordChangePayload,
    user: dict = Depends(get_current_user),
    session_token: str | None = Depends(session_token_from),
):
    """Change the current user's password and revoke all other active sessions."""
    row = db.get_user(user["id"])
    if not row or not verify_password(payload.current_password, row["password_hash"]):
        raise HTTPException(400, "Current password is incorrect")
    validate_password_strength(payload.new_password, email=row["email"])
    db.update_user(user["id"], password_hash=hash_password(payload.new_password))
    db.delete_sessions_for_user(user["id"], keep_token=session_token)
    return {"ok": True}


@router.get("/auth/sessions")
def list_own_sessions(
    user: dict = Depends(get_current_user),
    session_token: str | None = Depends(session_token_from),
):
    """List active sessions for the current user."""
    return db.list_sessions_for_user(user["id"], current_token=session_token)


@router.delete("/auth/sessions/{session_id}")
def revoke_own_session(session_id: int, user: dict = Depends(get_current_user)):
    """Revoke one of the current user's active sessions."""
    if not db.delete_session_by_id(session_id, user["id"]):
        raise HTTPException(404, "Session not found")
    return {"ok": True}


@router.post("/auth/logout-all")
def logout_other_sessions(
    user: dict = Depends(get_current_user),
    session_token: str | None = Depends(session_token_from),
):
    """Revoke all other sessions for the current user, keeping the current session."""
    db.delete_sessions_for_user(user["id"], keep_token=session_token)
    return {"ok": True}


@router.post("/auth/token")
def regenerate_own_token(user: dict = Depends(get_current_user)):
    """Regenerate the current user's API token (revokes the previous one)."""
    try:
        token = generate_api_token()
        db.update_user(user["id"], api_token=token)
    except Exception as exc:
        raise HTTPException(500, f"Failed to regenerate token: {exc}")
    return {"api_token": token}


@router.get("/me/overview")
def get_my_overview(user: dict = Depends(get_current_user)):
    """Personal employee workspace data: KPIs, rank, weekly trend, rubric averages, coaching points and tasks."""
    return db.get_employee_overview(user["id"], user["role"], org_id=user["org_id"])


@router.get("/me/actions")
def get_my_actions(user: dict = Depends(get_current_user)):
    """Unified employee action queue: open escalations, due leads, unanswered Telegram inquiries, and action items."""
    return db.get_employee_action_queue(user["id"], user["role"], org_id=user.get("org_id") or 1)


# ---------------------------------------------------------------------------
# Invitations (admin creates/revokes; employee accepts via token)
# ---------------------------------------------------------------------------


@router.post("/invites")
def create_invite(payload: InviteCreatePayload, user: dict = Depends(require_role("admin"))):
    email = payload.email.strip().lower()
    role = (payload.role or "manager").strip()
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(400, "Valid email address is required")
    if role not in VALID_ROLES:
        raise HTTPException(400, "role must be admin, manager, receptionist or yonalish")
    if db.get_user_by_email(email):
        raise HTTPException(409, "A user with this email already exists")

    raw_token = secrets.token_urlsafe(24)
    inv = db.create_invite(
        org_id=user["org_id"],
        email=email,
        role=role,
        raw_token=raw_token,
        created_by=user["id"],
    )
    return {
        **inv,
        "invite_path": f"/invite/{raw_token}",
    }


@router.get("/invites")
def list_invites(user: dict = Depends(require_role("admin"))):
    rows = db.list_invites(org_id=user["org_id"])
    return [
        {
            **r,
            "invite_path": f"/invite/{r['token']}" if r.get("token") else None,
        }
        for r in rows
    ]


@router.delete("/invites/{invite_id}")
def delete_invite(invite_id: int, user: dict = Depends(require_role("admin"))):
    if not db.delete_invite(invite_id, org_id=user["org_id"]):
        raise HTTPException(404, "Invite not found")
    return {"ok": True}


@router.get("/invites/{token}")
def get_invite_info(token: str):
    """Public endpoint: inspect an invitation token before accepting."""
    inv = db.get_invite_by_token(token)
    if not inv or inv.get("used_at"):
        raise HTTPException(404, "Invitation not found or already used")
    if datetime.fromisoformat(inv["expires_at"]) < datetime.now(timezone.utc):
        raise HTTPException(410, "Invitation has expired")
    return {
        "email": inv["email"],
        "role": inv["role"],
        "org_id": inv["org_id"],
        "org_name": inv["org_name"],
        "org_slug": inv["org_slug"],
        "expires_at": inv["expires_at"],
    }


@router.post("/invites/{token}/accept")
def accept_invite(token: str, payload: InviteAcceptPayload, request: Request, response: Response):
    """Public endpoint: accept an invitation, create the account, and log in."""
    inv = db.get_invite_by_token(token)
    if not inv or inv.get("used_at"):
        raise HTTPException(404, "Invitation not found or already used")
    if datetime.fromisoformat(inv["expires_at"]) < datetime.now(timezone.utc):
        raise HTTPException(410, "Invitation has expired")

    email = inv["email"].strip().lower()
    if db.get_user_by_email(email):
        raise HTTPException(409, "An account with this email already exists")

    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Name is required")
    validate_password_strength(payload.password, email=email)

    user_id = db.create_user(
        name=name,
        email=email,
        password_hash=hash_password(payload.password),
        role=inv["role"],
        org_id=inv["org_id"],
    )
    db.mark_invite_used(inv["id"])
    user_row = db.get_user(user_id)
    sess_tok, csrf_tok = new_session_with_csrf(
        user_id,
        user_agent=_user_agent(request),
        ip=_client_ip(request),
    )
    set_auth_cookies(response, request, sess_tok, csrf_tok)
    return {
        "token": sess_tok,
        "csrf_token": csrf_tok,
        "user": _user_payload(user_row),
    }


# ---------------------------------------------------------------------------
# User management (admin only, scoped to organization)
# ---------------------------------------------------------------------------


@router.get("/users")
def list_users(user: dict = Depends(require_role("admin", "yonalish"))):
    """Return all users in the current organization; admins and yonalish can see users."""
    is_admin = user["role"] == "admin"
    return [
        {
            "id": u["id"],
            "name": u["name"],
            "email": u["email"],
            "role": u["role"],
            "active": u["active"],
            "sip_extension": u.get("sip_extension") or "",
            "job_title": u.get("job_title") or "",
            "department": u.get("department") or "",
            "skills": u.get("skills") or "",
            "supervisor_id": u.get("supervisor_id"),
            "telegram_id": u.get("telegram_id") or "",
            "phone": u.get("phone") or "",
            **({"api_token": u["api_token"]} if is_admin else {}),
        }
        for u in db.list_users(org_id=user["org_id"])
    ]


@router.post("/users")
def create_user(payload: dict, user: dict = Depends(require_role("admin"))):
    name = (payload.get("name") or "").strip()[:100]
    email = (payload.get("email") or "").strip().lower()[:254]
    password = payload.get("password") or ""
    role = payload.get("role") or "manager"
    sip_extension = (payload.get("sip_extension") or "").strip()[:32]
    job_title = (payload.get("job_title") or "").strip()[:100]
    department = (payload.get("department") or "").strip()[:100]
    skills = (payload.get("skills") or "").strip()[:500]
    supervisor_id = payload.get("supervisor_id")
    telegram_id = (payload.get("telegram_id") or "").strip()[:64]
    phone = (payload.get("phone") or "").strip()[:32]
    if not name or not email or not password:
        raise HTTPException(400, "name, email and password are required")
    if role not in VALID_ROLES:
        raise HTTPException(400, "role must be admin, manager, receptionist or yonalish")
    validate_password_strength(str(password), email=email)
    if db.get_user_by_email(email):
        raise HTTPException(409, "Email already exists")
    user_id = db.create_user(
        name,
        email,
        hash_password(str(password)),
        role,
        sip_extension=sip_extension,
        org_id=user["org_id"],
        job_title=job_title,
        department=department,
        skills=skills,
        supervisor_id=supervisor_id if isinstance(supervisor_id, int) else None,
        telegram_id=telegram_id,
        phone=phone,
    )
    return {
        "id": user_id,
        "name": name,
        "email": email,
        "role": role,
        "active": True,
        "sip_extension": sip_extension,
        "job_title": job_title,
        "department": department,
        "skills": skills,
        "supervisor_id": supervisor_id,
        "telegram_id": telegram_id,
        "phone": phone,
    }


@router.patch("/users/{user_id}")
def update_user(user_id: int, payload: dict, user: dict = Depends(require_role("admin"))):
    target = db.get_user(user_id)
    if not target or (target.get("org_id") or 1) != user["org_id"]:
        raise HTTPException(404, "User not found")
    fields = {}
    revoke_sessions = False
    for key in ("name", "role", "active"):
        if key in payload:
            if key == "role" and payload[key] not in VALID_ROLES:
                raise HTTPException(400, "Invalid role")
            fields[key] = payload[key]
            if key in ("role", "active") and payload[key] != target.get(key):
                revoke_sessions = True
    for attr in ("job_title", "department", "skills", "telegram_id", "phone"):
        if attr in payload:
            fields[attr] = str(payload.get(attr) or "").strip()
    if "supervisor_id" in payload:
        sup_id = payload.get("supervisor_id")
        fields["supervisor_id"] = sup_id if isinstance(sup_id, int) else None
    if "sip_extension" in payload:
        fields["sip_extension"] = (payload.get("sip_extension") or "").strip()[:32]
    if "password" in payload and payload["password"]:
        validate_password_strength(str(payload["password"]), email=target["email"])
        fields["password_hash"] = hash_password(str(payload["password"]))
        revoke_sessions = True
    if "email" in payload and payload["email"].strip().lower() != target["email"]:
        new_email = payload["email"].strip().lower()[:254]
        clash = db.get_user_by_email(new_email)
        if clash and clash["id"] != user_id:
            raise HTTPException(409, "Email already exists")
        fields["email"] = new_email
    db.update_user(user_id, **fields)
    if revoke_sessions:
        db.delete_sessions_for_user(user_id)
    return {"ok": True}


@router.post("/users/{user_id}/token")
def regenerate_user_token(user_id: int, user: dict = Depends(require_role("admin"))):
    """Regenerate any user's API token in the same organization (admin-only)."""
    target = db.get_user(user_id)
    if not target or (target.get("org_id") or 1) != user["org_id"]:
        raise HTTPException(404, "User not found")
    try:
        token = generate_api_token()
        db.update_user(user_id, api_token=token)
    except Exception as exc:
        raise HTTPException(500, f"Failed to regenerate token: {exc}")
    return {"api_token": token}


@router.delete("/users/{user_id}")
def delete_user(user_id: int, user: dict = Depends(require_role("admin"))):
    if user["id"] == user_id:
        raise HTTPException(400, "Cannot delete yourself")
    target = db.get_user(user_id)
    if not target or (target.get("org_id") or 1) != user["org_id"]:
        raise HTTPException(404, "User not found")
    db.delete_user(user_id)
    return {"ok": True}