from fastapi import APIRouter, Depends, HTTPException

from . import db
from .auth import require_role

router = APIRouter(prefix="/api")


@router.get("/managers")
def list_managers(user: dict = Depends(require_role("admin"))):
    return db.list_managers_with_stats()


@router.get("/managers/{manager_id}/calls")
def manager_calls(manager_id: int, user: dict = Depends(require_role("admin"))):
    owner = db.get_user(manager_id)
    if not owner or owner["role"] != "manager":
        raise HTTPException(404, "Manager not found")
    return db.list_manager_calls(manager_id)
