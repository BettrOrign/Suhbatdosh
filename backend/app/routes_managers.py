from fastapi import APIRouter, Depends, HTTPException

from . import db
from .auth import require_role, get_current_user

router = APIRouter(prefix="/api")


@router.get("/managers")
def list_managers(user: dict = Depends(get_current_user)):
    if user["role"] not in ("admin", "yonalish"):
        raise HTTPException(403, "Forbidden")
    return db.list_managers_with_stats()


@router.get("/managers/options")
def manager_options(user: dict = Depends(get_current_user)):
    """Id + name of active managers, for pickers.

    The client form offers a manager dropdown to receptionists, but the only
    source it had was GET /api/users, which is admin/yonalish-only — so that
    select was permanently empty with the 403 swallowed. This is the narrow
    projection the picker actually needs; it exposes no email and no token.
    """
    if user["role"] not in ("admin", "yonalish", "receptionist"):
        raise HTTPException(403, "Forbidden")
    return db.list_active_managers()


@router.get("/managers/{manager_id}/calls")
def manager_calls(manager_id: int, user: dict = Depends(get_current_user)):
    if user["role"] not in ("admin", "yonalish"):
        raise HTTPException(403, "Forbidden")
    owner = db.get_user(manager_id)
    # `yonalish` counts here for the same reason it does in
    # `db.get_manager_rankings`: both roles own `call_type = 'manager'`
    # calls, and the leaderboard and the Employees directory drill down from
    # exactly those rows. Rejecting a supervisor made every drill-down 404.
    if not owner or owner["role"] not in ("manager", "yonalish"):
        raise HTTPException(404, "Manager not found")
    return db.list_manager_calls(manager_id)
