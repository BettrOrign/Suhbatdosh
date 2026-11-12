from fastapi import APIRouter, Depends, HTTPException

from . import db
from .auth import require_role, get_current_user

router = APIRouter(prefix="/api")


@router.get("/managers")
def list_managers(user: dict = Depends(get_current_user)):
    if user["role"] not in ("admin", "yonalish"):
        raise HTTPException(403, "Forbidden")
    return db.list_managers_with_stats(org_id=user.get("org_id") or 1)


@router.get("/managers/options")
def manager_options(user: dict = Depends(get_current_user)):
    """Id + name of active managers in the user's organization, for pickers."""
    if user["role"] not in ("admin", "yonalish", "receptionist"):
        raise HTTPException(403, "Forbidden")
    return db.list_active_managers(org_id=user.get("org_id") or 1)


@router.get("/managers/{manager_id}/calls")
def manager_calls(manager_id: int, user: dict = Depends(get_current_user)):
    if user["role"] not in ("admin", "yonalish"):
        raise HTTPException(403, "Forbidden")
    org_id = user.get("org_id") or 1
    owner = db.get_user(manager_id)
    if not owner or (owner.get("org_id") or 1) != org_id or owner["role"] not in ("manager", "yonalish"):
        raise HTTPException(404, "Manager not found")
    return db.list_manager_calls(manager_id, org_id=org_id)
