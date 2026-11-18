"""AI-driven problem detection, smart routing, and escalation service.

When an analysed call reveals poor performance, complaints, or critical flaws,
this service inspects the organization's staff directory (attributes, roles,
departments, skills, supervisor hierarchy) and uses Gemini to choose the
optimal employee who has the authority and competence to fix it.
"""

import asyncio
import json
import logging
from typing import Literal

from google import genai
from google.genai import types
from pydantic import BaseModel

from . import config, db
from .notifications_dispatcher import dispatch_problem_escalation

logger = logging.getLogger("suhbatdosh.escalation")


class EscalationDecision(BaseModel):
    """Structured decision returned by Gemini when assessing problem escalation."""

    should_escalate: bool
    problem_title: str
    problem_description: str
    severity: Literal["low", "medium", "high", "critical"]
    assigned_user_id: int
    reason: str
    action_plan: list[str]


ESCALATION_PROMPT = """Siz tashkilot ichidagi muammolarni aniqlash va tegishli vakolatli xodimlarga yoʻnaltiruvchi bosh monitoring ekspertisiz.

Vazifangiz:
Quyidagi qoʻngʻiroq tahlili va tashkilot xodimlari roʻyxatini oʻrganib chiqing.
Agar qoʻngʻiroqda jiddiy nuqson, mijoz noroziligi, xodimning qoʻpol xatosi yoki oʻz ishini yaxshi bajarmaganligi aniqlansa:
1. Muammoning tub mohiyatini va darajasini aniqlang.
2. Xodimlar roʻyxatidan (ularning lavozimi, boʻlimi, koʻnikmalari va iyerarxiyasini hisobga olgan holda) ushbu muammoni HAL QILISHGA ENG VAKOLATLI va MUNOSIB shaxsni tanlang!

MUHIM QOIDALAR:
- Agar xodim (masalan, oʻqituvchi yoki administrator) xato qilgan boʻlsa, muammoni uning oʻziga emas, balki uni nazorat qiluvchi yoki hal qila oladigan rahbarga (masalan: Maktab direktori / School Principal, Yoʻnalish boshligʻi, Bosh metodist) yoʻnaltiring.
- Agar sotuvdagi narx yoki shartnoma boʻyicha eʼtiroz boʻlsa, sotuv boʻlimi boshligʻiga yoʻnaltiring.
- Agar mijoz taʼlim sifatidan shikoyat qilgan boʻlsa, oʻquv boʻlimi rahbari yoki direktorga yoʻnaltiring.
- Tanlangan xodim uchun aniq va amaliy harakatlar rejasini (action_plan) OʻZBEK TILIDA yozing.
- Nega aynan shu xodim tanlanganini asoslab bering (reason).
"""


async def evaluate_and_escalate_call(
    call_id: int,
    analysis_data: dict,
    transcript: str = "",
    org_id: int = 1,
    dashboard_base_url: str | None = None,
) -> dict | None:
    """Assess call problems and dispatch an escalation to the best-suited employee."""
    from . import config
    dashboard_base_url = (dashboard_base_url or config.APP_BASE_URL).rstrip("/")
    settings = db.get_notification_settings(org_id=org_id)
    if not settings.get("auto_escalate_enabled", True):
        logger.info("Auto-escalation disabled for org %d; skipping call %d", org_id, call_id)
        return None

    scorecard = analysis_data.get("scorecard") or {}
    overall_score = scorecard.get("overall") if isinstance(scorecard, dict) else None
    coach_decision = str(analysis_data.get("coach_decision") or "").upper()
    threshold = int(settings.get("escalation_score_threshold") or 50)

    # Determine if this call warrants escalation evaluation
    is_low_score = overall_score is not None and overall_score < threshold
    is_escalate_decision = coach_decision == "ESCALATE"
    outcome = str(analysis_data.get("outcome") or "").lower()

    if not (is_low_score or is_escalate_decision or outcome == "uncertain"):
        logger.info("Call %d does not trigger escalation (score=%s, decision=%s)", call_id, overall_score, coach_decision)
        return None

    # Fetch active staff members in the organization
    users = db.list_users(org_id=org_id)
    active_users = [u for u in users if u.get("active", 1)]
    if not active_users:
        logger.warning("No active users found for org %d; cannot escalate call %d", org_id, call_id)
        return None

    call = db.get_call(call_id)
    call_user_id = call.get("user_id") if call else None

    # Format user directory for prompt context
    user_directory = []
    for u in active_users:
        user_directory.append({
            "id": u["id"],
            "name": u["name"],
            "email": u["email"],
            "role": u["role"],
            "job_title": u.get("job_title") or u["role"],
            "department": u.get("department") or "Umumiy",
            "skills": u.get("skills") or "Umumiy boshqaruv",
            "supervisor_id": u.get("supervisor_id"),
        })

    payload = {
        "call_id": call_id,
        "call_topic": analysis_data.get("topic") or call.get("name") if call else "",
        "overall_score": overall_score,
        "coach_decision": coach_decision,
        "summary": analysis_data.get("summary") or "",
        "coaching_points": analysis_data.get("coaching_points") or [],
        "objections": analysis_data.get("objections") or [],
        "rep_user_id": call_user_id,
        "available_employees": user_directory,
    }

    try:
        client = genai.Client(api_key=config.GEMINI_API_KEY)
        resp = await asyncio.wait_for(
            client.aio.models.generate_content(
                model=config.GEMINI_ANALYSIS_MODEL,
                contents=json.dumps(payload, ensure_ascii=False),
                config=types.GenerateContentConfig(
                    system_instruction=ESCALATION_PROMPT,
                    response_mime_type="application/json",
                    response_schema=EscalationDecision,
                ),
            ),
            timeout=40,
        )
        decision: dict = json.loads(resp.text)
    except Exception as exc:
        logger.exception("AI escalation evaluation failed for call %d: %s", call_id, exc)
        # Fallback heuristic: choose supervisor of the rep, or first admin/yonalish
        fallback_user = None
        if call_user_id:
            rep = db.get_user(call_user_id)
            if rep and rep.get("supervisor_id"):
                fallback_user = db.get_user(rep["supervisor_id"])
        if not fallback_user:
            fallback_user = next((u for u in active_users if u["role"] in ("admin", "yonalish")), active_users[0])

        decision = {
            "should_escalate": True,
            "problem_title": f"Qoʻngʻiroqda past koʻrsatkich ({overall_score or 0} ball)",
            "problem_description": analysis_data.get("summary") or "Qoʻngʻiroqda jiddiy xato yoki shikoyat aniqlandi.",
            "severity": "high" if (overall_score or 0) < 40 else "medium",
            "assigned_user_id": fallback_user["id"],
            "reason": f"Tizim admini/rahbari ({fallback_user.get('job_title') or fallback_user['role']}) sifatida hal qilish uchun tayinlandi.",
            "action_plan": [
                "Suhbat transkripsiyasini koʻrib chiqing va mijoz shikoyatini oʻrganing",
                "Xodim bilan murabbiylik suhbati oʻtkazing",
            ],
        }

    if not decision.get("should_escalate", True):
        logger.info("AI determined no escalation needed for call %d", call_id)
        return None

    assigned_id = decision.get("assigned_user_id")
    # Validate assigned_id exists in active_users
    if not any(u["id"] == assigned_id for u in active_users):
        assigned_id = active_users[0]["id"]

    # Record in database
    esc_id = db.create_escalation(
        org_id=org_id,
        call_id=call_id,
        detected_problem=decision.get("problem_title") or decision.get("problem_description", "Muammo aniqlandi"),
        assigned_to_user_id=assigned_id,
        assigned_reason=decision.get("reason", "Muammoni hal qilish vakolatiga koʻra"),
        action_plan=decision.get("action_plan") or [],
        severity=decision.get("severity", "high"),
        channel="email",
    )

    # In-app notification for the assigned user
    db.create_notification(
        user_id=assigned_id,
        type_="escalation",
        title=f"⚠️ Hal qilish tayinlandi: #{call_id} {decision.get('problem_title', '')[:60]}",
        message=decision.get("problem_description", ""),
        call_id=call_id,
        metadata={
            "escalation_id": esc_id,
            "severity": decision.get("severity", "high"),
            "assigned_reason": decision.get("reason", ""),
            "action_plan": decision.get("action_plan", []),
        },
    )

    # Dispatch outbound notifications (Gmail / SMTP and Telegram)
    dispatch_results = dispatch_problem_escalation(
        escalation_id=esc_id,
        org_id=org_id,
        dashboard_base_url=dashboard_base_url,
    )

    logger.info("Escalation #%d dispatched for call #%d to user #%d: %s", esc_id, call_id, assigned_id, dispatch_results)
    return db.get_escalation(esc_id)
