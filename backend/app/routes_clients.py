import hmac
from fastapi import APIRouter, Depends, HTTPException, Request

from . import config, db
from .auth import get_current_user, require_role

router = APIRouter(prefix="/api")

_CLIENT_WRITABLE = (
    "name",
    "phone",
    "company",
    "email",
    "notes",
    "manager_id",
    "pipeline_stage",
    "source_channel",
    "student_grade",
    "test_date",
    "test_location",
    "next_follow_up_at",
)


@router.get("/clients")
def list_clients(user: dict = Depends(get_current_user)):
    org_id = user.get("org_id") or 1
    # receptionist and yonalish see all clients; manager sees own + unassigned
    if user["role"] == "receptionist" or user["role"] == "yonalish":
        view = None
    elif user["role"] == "manager":
        view = user["id"]
    else:
        view = None
    return db.list_clients(view, org_id=org_id)


@router.post("/clients")
def create_client(payload: dict, user: dict = Depends(require_role("admin", "manager", "receptionist"))):
    org_id = user.get("org_id") or 1
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name is required")
    manager_id = payload.get("manager_id")
    if user["role"] == "manager" and manager_id is None:
        manager_id = user["id"]
    if manager_id is not None:
        mgr = db.get_user(manager_id)
        if not mgr or (mgr.get("org_id") or 1) != org_id:
            raise HTTPException(400, "Invalid manager_id")
    cid = db.create_client(
        name,
        manager_id=manager_id,
        org_id=org_id,
        phone=payload.get("phone", ""),
        company=payload.get("company", ""),
        email=payload.get("email", ""),
        notes=payload.get("notes", ""),
        pipeline_stage=payload.get("pipeline_stage", "new_lead"),
        source_channel=payload.get("source_channel", "manual"),
        student_grade=payload.get("student_grade", ""),
        test_date=payload.get("test_date", ""),
        test_location=payload.get("test_location", ""),
        next_follow_up_at=payload.get("next_follow_up_at", ""),
    )
    return db.get_client(cid, org_id=org_id)


@router.get("/clients/pipeline/summary")
def pipeline_summary(user: dict = Depends(require_role("admin", "yonalish"))):
    """Return admissions pipeline funnel counts by stage and source channel."""
    org_id = user.get("org_id") or 1
    return db.get_client_pipeline_summary(org_id=org_id)


def _visible_client(client_id: int, user: dict) -> dict:
    """Load a client, hiding clients a manager does not own behind a 403 and cross-org behind 404."""
    c = db.get_client(client_id, org_id=user.get("org_id") or 1)
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
    org_id = user.get("org_id") or 1
    c = db.get_client(client_id, org_id=org_id)
    if c is None:
        raise HTTPException(404, "Client not found")
    if user["role"] == "manager" and c["manager_id"] not in (None, user["id"]):
        raise HTTPException(403, "Forbidden")
    fields = {k: payload[k] for k in _CLIENT_WRITABLE if k in payload}
    if "pipeline_stage" in fields and fields["pipeline_stage"] not in db.PIPELINE_STAGES:
        raise HTTPException(400, "Invalid pipeline_stage")
    if "source_channel" in fields and fields["source_channel"] not in db.SOURCE_CHANNELS:
        raise HTTPException(400, "Invalid source_channel")
    if "manager_id" in fields and user["role"] not in ("admin", "receptionist"):
        fields.pop("manager_id", None)
    if fields.get("manager_id") is not None:
        mgr = db.get_user(fields["manager_id"])
        if not mgr or (mgr.get("org_id") or 1) != org_id:
            raise HTTPException(400, "Invalid manager_id")
    db.update_client(client_id, **fields)
    return db.get_client(client_id, org_id=org_id)


@router.delete("/clients/{client_id}")
def delete_client(client_id: int, user: dict = Depends(require_role("admin"))):
    c = db.get_client(client_id, org_id=user.get("org_id") or 1)
    if c is None:
        raise HTTPException(404, "Client not found")
    db.delete_client(client_id)
    return {"ok": True}


@router.post("/leads/webhook/{org_slug}")
async def ingest_omnichannel_lead(org_slug: str, request: Request, payload: dict):
    """Ingest a lead from Website forms, Instagram/ManyChat, or Telegram bots."""
    org = db.get_organization_by_slug(org_slug)
    if not org:
        raise HTTPException(404, "Organization not found")
    org_id = org["id"]
    expected = db.get_bot_setting("lead_webhook_secret", "", org_id=org_id) or config.ZADARMA_WEBHOOK_SECRET
    if not expected:
        raise HTTPException(503, "Lead webhook is disabled (no secret configured)")
    supplied = request.headers.get("X-Webhook-Secret") or payload.get("webhook_secret") or ""
    if not supplied or not hmac.compare_digest(str(supplied), expected):
        raise HTTPException(401, "Invalid webhook secret")

    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name is required")
    channel = (payload.get("source_channel") or "website").strip().lower()
    if channel not in db.SOURCE_CHANNELS:
        channel = "website"

    cid = db.create_client(
        name=name,
        org_id=org_id,
        phone=(payload.get("phone") or "").strip(),
        email=(payload.get("email") or "").strip(),
        notes=(payload.get("notes") or "").strip(),
        source_channel=channel,
        pipeline_stage=payload.get("pipeline_stage") or "new_lead",
        student_grade=(payload.get("student_grade") or "").strip(),
        test_date=(payload.get("test_date") or "").strip(),
        test_location=(payload.get("test_location") or "").strip(),
    )
    return {"ok": True, "client": db.get_client(cid, org_id=org_id)}