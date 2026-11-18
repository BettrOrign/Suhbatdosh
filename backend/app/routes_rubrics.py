"""Dynamic scoring rubrics and audit log routes."""

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import db
from .auth import get_current_user, require_role

logger = logging.getLogger("suhbatdosh.rubrics")

router = APIRouter(prefix="/api", tags=["rubrics"])


class RubricCriterionIn(BaseModel):
    key: str = Field(..., min_length=1, max_length=64)
    label: str = Field(..., min_length=1, max_length=120)
    weight: int = Field(default=20, ge=0, le=100)
    description: str = Field(default="", max_length=400)


class RubricCreateIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    call_type: str = Field(default="all")
    description: str = Field(default="", max_length=500)
    criteria: list[RubricCriterionIn] = Field(..., min_length=1)
    is_default: bool = False


class RubricUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    call_type: str | None = None
    description: str | None = Field(default=None, max_length=500)
    criteria: list[RubricCriterionIn] | None = None
    is_default: bool | None = None
    active: bool | None = None


@router.get("/rubrics")
def list_rubrics(active_only: bool = False, user: dict = Depends(get_current_user)):
    """List scoring rubrics for the current organization."""
    org_id = user.get("org_id") or 1
    return db.list_rubrics(org_id=org_id, active_only=active_only)


@router.post("/rubrics")
def create_rubric(
    payload: RubricCreateIn,
    user: dict = Depends(require_role("admin", "yonalish")),
):
    """Create a custom scoring rubric (admin or supervisor)."""
    org_id = user.get("org_id") or 1
    created = db.create_rubric(
        org_id=org_id,
        name=payload.name,
        call_type=payload.call_type,
        description=payload.description,
        criteria=[c.model_dump() for c in payload.criteria],
        is_default=payload.is_default,
    )
    db.log_audit(
        org_id=org_id,
        user_id=user["id"],
        action="rubric.create",
        target_type="rubric",
        target_id=created["id"],
        details=created["name"],
    )
    return created


@router.patch("/rubrics/{rubric_id}")
def update_rubric(
    rubric_id: int,
    payload: RubricUpdateIn,
    user: dict = Depends(require_role("admin", "yonalish")),
):
    """Update an existing scoring rubric (admin or supervisor)."""
    org_id = user.get("org_id") or 1
    existing = db.get_rubric(rubric_id)
    if not existing or (existing.get("org_id") or 1) != org_id:
        raise HTTPException(404, "Rubric not found")

    fields = payload.model_dump(exclude_none=True)
    if "criteria" in fields:
        fields["criteria"] = [c.model_dump() for c in payload.criteria or []]
    updated = db.update_rubric(rubric_id, **fields)
    db.log_audit(
        org_id=org_id,
        user_id=user["id"],
        action="rubric.update",
        target_type="rubric",
        target_id=rubric_id,
        details=updated["name"] if updated else "",
    )
    return updated


@router.delete("/rubrics/{rubric_id}")
def delete_rubric(
    rubric_id: int,
    user: dict = Depends(require_role("admin", "yonalish")),
):
    """Delete a custom rubric (admin or supervisor)."""
    org_id = user.get("org_id") or 1
    existing = db.get_rubric(rubric_id)
    if not existing or (existing.get("org_id") or 1) != org_id:
        raise HTTPException(404, "Rubric not found")
    db.delete_rubric(rubric_id)
    db.log_audit(
        org_id=org_id,
        user_id=user["id"],
        action="rubric.delete",
        target_type="rubric",
        target_id=rubric_id,
        details=existing["name"],
    )
    return {"ok": True}


@router.get("/audit-logs")
def get_audit_logs(
    limit: int = 50,
    user: dict = Depends(require_role("admin", "yonalish")),
):
    """Return recent audit log entries for the organization."""
    org_id = user.get("org_id") or 1
    return db.list_audit_logs(org_id=org_id, limit=min(limit, 200))
