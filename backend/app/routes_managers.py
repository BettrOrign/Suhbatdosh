from fastapi import APIRouter, Depends, HTTPException

from . import db
from .auth import require_role, get_current_user

router = APIRouter(prefix="/api")


@router.get("/managers")
def list_managers(user: dict = Depends(get_current_user)):
    if user["role"] not in ("admin", "yonalish"):
        raise HTTPException(403, "Forbidden")
    return db.list_managers_with_stats()


@router.get("/managers/{manager_id}/calls")
def manager_calls(manager_id: int, user: dict = Depends(get_current_user)):
    if user["role"] not in ("admin", "yonalish"):
        raise HTTPException(403, "Forbidden")
    owner = db.get_user(manager_id)
    if not owner or owner["role"] != "manager":
        raise HTTPException(404, "Manager not found")
    return db.list_manager_calls(manager_id)
