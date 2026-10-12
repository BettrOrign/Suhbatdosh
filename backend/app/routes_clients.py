from fastapi import APIRouter, Depends, HTTPException

from . import db
from .auth import get_current_user, require_role

router = APIRouter(prefix="/api")


@router.get("/clients")
def list_clients(user: dict = Depends(get_current_user)):
    # receptionist and yonalish see all clients; manager sees own + unassigned
    if user["role"] == "receptionist" or user["role"] == "yonalish":
        view = None
    elif user["role"] == "manager":
        view = user["id"]
    else:
        view = None
    return db.list_clients(view)


@router.post("/clients")
def create_client(payload: dict, user: dict = Depends(require_role("admin", "manager", "receptionist"))):
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name is required")
    manager_id = payload.get("manager_id")
    if user["role"] == "manager" and manager_id is None:
        manager_id = user["id"]
    cid = db.create_client(
        name,
        manager_id=manager_id,
        phone=payload.get("phone", ""),
        company=payload.get("company", ""),
        email=payload.get("email", ""),
        notes=payload.get("notes", ""),
    )
    return db.get_client(cid)


def _visible_client(client_id: int, user: dict) -> dict:
    """Load a client, hiding clients a manager does not own behind a 403.

    Mirrors the scoping of GET /api/clients: admin/receptionist/yonalish see
    everything, a manager sees only their own clients.
    """
    c = db.get_client(client_id)
    if c is None:
        raise HTTPException(404, "Client not found")
    if user["role"] == "manager" and c["manager_id"] not in (None, user["id"]):
        raise HTTPException(403, "Forbidden")
    return c


@router.get("/clients/{client_id}")
def get_client(client_id: int, user: dict = Depends(get_current_user)):
    return _visible_client(client_id, user)


@router.patch("/clients/{client_id}")
def update_client(client_id: int, payload: dict, user: dict = Depends(require_role("admin", "manager", "receptionist"))):
    c = db.get_client(client_id)
    if c is None:
        raise HTTPException(404, "Client not found")
    if user["role"] == "manager" and c["manager_id"] not in (None, user["id"]):
        raise HTTPException(403, "Forbidden")
    fields = {k: payload[k] for k in ("name", "phone", "company", "email", "notes", "manager_id") if k in payload}
    if "manager_id" in fields and user["role"] != "admin":
        fields.pop("manager_id", None)
    db.update_client(client_id, **fields)
    return db.get_client(client_id)


@router.delete("/clients/{client_id}")
def delete_client(client_id: int, user: dict = Depends(require_role("admin"))):
    c = db.get_client(client_id)
    if c is None:
        raise HTTPException(404, "Client not found")
    db.delete_client(client_id)
    return {"ok": True}