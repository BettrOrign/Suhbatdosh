from fastapi import APIRouter, Depends, HTTPException

from . import db
from .auth import (
    generate_api_token,
    get_current_user,
    hash_password,
    new_session,
    require_role,
    verify_password,
)

router = APIRouter(prefix="/api")


@router.post("/auth/login")
def login(payload: dict):
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""
    user = db.get_user_by_email(email)
    if not user or not verify_password(password, user["password_hash"]):
        raise HTTPException(401, "Invalid email or password")
    if not user["active"]:
        raise HTTPException(403, "Account disabled")
    token = new_session(user["id"])
    return {
        "token": token,
        "user": {"id": user["id"], "name": user["name"], "email": user["email"], "role": user["role"]},
    }


@router.post("/auth/logout")
def logout(user: dict = Depends(get_current_user), authorization: str | None = None):
    if authorization and authorization.startswith("Bearer "):
        db.delete_session(authorization.removeprefix("Bearer ").strip())
    return {"ok": True}


@router.get("/auth/me")
def me(user: dict = Depends(get_current_user)):
    """Return the current user plus their own API token (visible only to them)."""
    row = db.get_user(user["id"])
    return {**user, "api_token": row["api_token"] if row else None}


@router.post("/auth/token")
def regenerate_own_token(user: dict = Depends(get_current_user)):
    """Regenerate the current user's API token (revokes the previous one)."""
    try:
        token = generate_api_token()
        db.update_user(user["id"], api_token=token)
    except Exception as exc:
        raise HTTPException(500, f"Failed to regenerate token: {exc}")
    return {"api_token": token}


# ---------------------------------------------------------------------------
# User management (admin only)
# ---------------------------------------------------------------------------


@router.get("/users")
def list_users(user: dict = Depends(require_role("admin", "yonalish"))):
    """Return all users; admins and yonalish can see users."""
    return [
        {
            "id": u["id"],
            "name": u["name"],
            "email": u["email"],
            "role": u["role"],
            "active": u["active"],
            "api_token": u["api_token"],
        }
        for u in db.list_users()
    ]


@router.post("/users")
def create_user(payload: dict, user: dict = Depends(require_role("admin"))):
    name = (payload.get("name") or "").strip()
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""
    role = payload.get("role") or "manager"
    if not name or not email or not password:
        raise HTTPException(400, "name, email and password are required")
    if role not in ("admin", "manager", "receptionist", "yonalish"):
        raise HTTPException(400, "role must be admin, manager, receptionist or yonalish")
    if db.get_user_by_email(email):
        raise HTTPException(409, "Email already exists")
    user_id = db.create_user(name, email, hash_password(password), role)
    return {"id": user_id, "name": name, "email": email, "role": role, "active": True}


@router.patch("/users/{user_id}")
def update_user(user_id: int, payload: dict, user: dict = Depends(require_role("admin"))):
    target = db.get_user(user_id)
    if not target:
        raise HTTPException(404, "User not found")
    fields = {}
    for key in ("name", "role", "active"):
        if key in payload:
            fields[key] = payload[key]
    if "password" in payload and payload["password"]:
        fields["password_hash"] = hash_password(payload["password"])
    if "email" in payload and payload["email"].strip().lower() != target["email"]:
        new_email = payload["email"].strip().lower()
        clash = db.get_user_by_email(new_email)
        if clash and clash["id"] != user_id:
            raise HTTPException(409, "Email already exists")
        fields["email"] = new_email
    db.update_user(user_id, **fields)
    return {"ok": True}


@router.post("/users/{user_id}/token")
def regenerate_user_token(user_id: int, user: dict = Depends(require_role("admin"))):
    """Regenerate any user's API token (admin-only)."""
    target = db.get_user(user_id)
    if not target:
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
    if not target:
        raise HTTPException(404, "User not found")
    db.delete_user(user_id)
    return {"ok": True}