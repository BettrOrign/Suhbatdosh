import asyncio
import json
import logging

from google import genai
from google.genai import types
from typing import Literal

from pydantic import BaseModel

from . import config, db
from .prompts import (
    CROSS_CALL_QA_PROMPT,
    ORG_SUMMARY_PROMPT,
    ORG_WEB_FACTS_PROMPT,
    TELEGRAM_REPLY_SCORING_PROMPT,
    scoring_system_prompt,
)

logger = logging.getLogger("suhbatdosh.analysis")


class Scorecard(BaseModel):
    """Per-dimension rubric (0-100) produced by the scoring prompt."""

    opening: int
    discovery: int
    objection_handling: int
    value_prop: int
    closing: int
    rapport: int
    talk_ratio: int
    overall: int


class KeyMetric(BaseModel):
    """A named extracted fact/figure from the call (deal size, timeline, ...)."""

    name: str
    value: str


class ActionItem(BaseModel):
    """An action item / commitment extracted from the call."""

    description: str
    due_date: str | None
    assignee: str
    priority: str


class EvidenceQuote(BaseModel):
    """A transcript quote cited as evidence for a rubric dimension."""

    dimension: str
    quote: str
    speaker: str | None = None
    start_sec: float | None = None


class RubricCriterionScore(BaseModel):
    """Score and evidence for a single custom rubric criterion."""

    key: str
    label: str
    score: int
    evidence: str = ""


class LeadExtraction(BaseModel):
    """Admissions/lead details automatically extracted from the conversation."""

    student_grade: str = ""
    agreed_to_tuition: bool | None = None
    test_scheduled: bool = False
    test_date: str = ""
    test_location: str = ""
    suggested_stage: Literal["new_lead", "consulted", "test_scheduled", "tested", "enrolled", "lost"] | None = None


class CallAnalysis(BaseModel):
    """Structured coaching report returned by the analysis model."""

    topic: str
    language: str
    summary: str
    scorecard: Scorecard
    rep_share_of_talk: float
    outcome: Literal["win", "likely", "uncertain", "unknown"]
    coach_decision: Literal["NO_ACTION", "COACH", "ESCALATE"] = "COACH"
    key_metrics: list[KeyMetric]
    coaching_points: list[str]
    next_steps: list[str]
    action_items: list[ActionItem]
    evidence_quotes: list[EvidenceQuote] = []
    objections: list[str] = []
    rubric_scores: list[RubricCriterionScore] = []
    lead_extraction: LeadExtraction | None = None


class TelegramReplyScore(BaseModel):
    """Quality score and feedback for a staff reply to a Telegram inquiry."""

    score: int
    feedback: str


class CrossCallAnswer(BaseModel):
    """Structured answer returned by the cross-call Q&A endpoint."""

    answer: str
    cited_call_ids: list[int] = []
    recommendations: list[str] = []


class Analyzer:
    """Wraps a Gemini client used to score a call transcript into a CallAnalysis."""

    def __init__(self, api_key: str | None = None, org_id: int = 1):
        self._client = genai.Client(api_key=api_key or config.GEMINI_API_KEY)
        self._org_id = org_id

    async def analyze(self, transcript: str, call_type: str = "manager") -> dict:
        """Asynchronously generate a CallAnalysis from a transcript string."""
        if not transcript or not transcript.strip():
            return {"error": "empty transcript"}
        profile = db.get_org_profile() if self._org_id == 1 else db.get_org_profile(org_id=self._org_id)
        rubric = db.get_active_rubric(org_id=self._org_id, call_type=call_type)
        resp = await asyncio.wait_for(
            self._client.aio.models.generate_content(
                model=config.GEMINI_ANALYSIS_MODEL,
                contents=transcript,
                config=types.GenerateContentConfig(
                    # Read fresh per analysis so a profile/rubric edit applies to the
                    # very next call without a restart.
                    system_instruction=scoring_system_prompt(profile, rubric=rubric),
                    response_mime_type="application/json",
                    response_schema=CallAnalysis,
                ),
            ),
            timeout=60,
        )
        text = resp.text
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            logger.error("Analysis returned non-JSON: %.300s", text)
            return {"error": "non-JSON response", "raw": text}

    async def extract_action_items(self, transcript: str) -> list[dict]:
        """Extract action items / commitments from a transcript."""
        if not transcript or not transcript.strip():
            return []
        prompt = (
            "Ushbu sotuv qoʻngʻirogi transkripsiyasidan barcha amaliy vazifalarni, "
            "majburiyatlarni va keyingi harakatlarni OʻZBEK TILIDA chiqaring.\n"
            "JSON massivini quyidagi formatda qaytaring: description (nima qilish kerak), "
            "due_date (agar sana aytilgan boʻlsa ISO formatda, aks holda null), "
            "assignee ('manager', 'client' yoki 'team'), "
            "priority ('high', 'medium', 'low'). Faqat aniq majburiyatlarni kiriting."
        )
        resp = await asyncio.wait_for(
            self._client.aio.models.generate_content(
                model=config.GEMINI_ANALYSIS_MODEL,
                contents=transcript,
                config=types.GenerateContentConfig(
                    system_instruction=prompt,
                    response_mime_type="application/json",
                    response_schema=list[ActionItem],
                ),
            ),
            timeout=30,
        )
        text = resp.text
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            logger.error("Action items extraction returned non-JSON: %.300s", text)
            return []

    async def ask_across_calls(
        self,
        question: str,
        calls_context: list[dict],
        history: list[dict] | None = None,
    ) -> dict:
        """Answer a supervisor's natural-language question across recent analysed calls."""
        if not calls_context:
            return {
                "answer": "Tahlil qilingan qoʻngʻiroqlar hali mavjud emas.",
                "cited_call_ids": [],
                "recommendations": [],
            }
        payload = json.dumps(
            {
                "question": question,
                "history": (history or [])[-6:],
                "calls": calls_context,
            },
            ensure_ascii=False,
        )
        resp = await asyncio.wait_for(
            self._client.aio.models.generate_content(
                model=config.GEMINI_ANALYSIS_MODEL,
                contents=payload,
                config=types.GenerateContentConfig(
                    system_instruction=CROSS_CALL_QA_PROMPT,
                    response_mime_type="application/json",
                    response_schema=CrossCallAnswer,
                ),
            ),
            timeout=45,
        )
        try:
            return json.loads(resp.text)
        except json.JSONDecodeError:
            return {
                "answer": (resp.text or "").strip(),
                "cited_call_ids": [],
                "recommendations": [],
            }

    async def draft_followup(self, transcript: str, analysis_data: dict | None = None) -> dict:
        """Draft a polite Uzbek follow-up message for the parent/client after a call."""
        profile = db.get_org_profile(org_id=self._org_id)
        org_name = profile.get("name") or "MBSI"
        prompt = (
            f"Siz {org_name} oʻquv markazi/maktabi uchun mijoz (ota-ona) bilan qayta aloqa xabari "
            "tayyorlovchi yordamchisiz. Suhbat transkripsiyasi va tahlil natijasiga asoslanib, "
            "Telegram yoki SMS orqali yuborishga tayyor, qisqa, samimiy va aniq xabarni OʻZBEK TILIDA yozing. "
            "Agar kirish testi sanasi/joyi yoki keyingi qadam aytilgan boʻlsa, uni albatta kiriting."
        )
        context = json.dumps(
            {
                "transcript": (transcript or "")[:4000],
                "summary": (analysis_data or {}).get("summary", ""),
                "next_steps": (analysis_data or {}).get("next_steps", []),
                "lead_extraction": (analysis_data or {}).get("lead_extraction", {}),
            },
            ensure_ascii=False,
        )
        resp = await asyncio.wait_for(
            self._client.aio.models.generate_content(
                model=config.GEMINI_ANALYSIS_MODEL,
                contents=context,
                config=types.GenerateContentConfig(system_instruction=prompt),
            ),
            timeout=30,
        )
        return {"message": (resp.text or "").strip()}

    async def score_telegram_reply(self, question_text: str, reply_text: str) -> dict:
        """Score a staff member's written Telegram reply against org context."""
        profile = db.get_org_profile(org_id=self._org_id)
        ctx = json.dumps(
            {
                "org_name": profile.get("name", "MBSI"),
                "services": profile.get("services", ""),
                "question": question_text,
                "staff_reply": reply_text,
            },
            ensure_ascii=False,
        )
        resp = await asyncio.wait_for(
            self._client.aio.models.generate_content(
                model=config.GEMINI_ANALYSIS_MODEL,
                contents=ctx,
                config=types.GenerateContentConfig(
                    system_instruction=TELEGRAM_REPLY_SCORING_PROMPT,
                    response_mime_type="application/json",
                    response_schema=TelegramReplyScore,
                ),
            ),
            timeout=25,
        )
        try:
            data = json.loads(resp.text)
            return {
                "score": max(0, min(100, int(data.get("score", 70)))),
                "feedback": str(data.get("feedback", "")).strip(),
            }
        except Exception:
            return {"score": 70, "feedback": ""}


class OrgProfileDraft(BaseModel):
    """Normalized organization profile produced from raw Telegram Q&A answers."""

    name: str
    direction: str
    services: str
    rules: str
    flaws: str
    metrics: str
    summary: str


async def summarize_org_profile(answers_text: str) -> dict:
    """Turn raw admin Q&A answers into a normalized org profile (Uzbek).

    Raises ``ValueError`` on a non-JSON / truncated model response so the
    Telegram flow can tell the admin to retry instead of persisting garbage.
    """
    resp = await asyncio.wait_for(
        _client_for_org().aio.models.generate_content(
            model=config.GEMINI_ANALYSIS_MODEL,
            contents=answers_text,
            config=types.GenerateContentConfig(
                system_instruction=ORG_SUMMARY_PROMPT,
                response_mime_type="application/json",
                response_schema=OrgProfileDraft,
            ),
        ),
        timeout=60,
    )
    try:
        data = json.loads(resp.text)
    except (json.JSONDecodeError, TypeError) as exc:
        logger.error("Org profile summary returned non-JSON: %.300s", resp.text)
        raise ValueError("Gemini returned non-JSON") from exc
    if not isinstance(data, dict) or not data.get("summary"):
        raise ValueError("Gemini returned an incomplete profile")
    return data


def _client_for_org() -> "genai.Client":
    """A dedicated Gemini client: bot calls may run on a different loop."""
    return genai.Client(api_key=config.GEMINI_API_KEY)


_NOT_FOUND_MARKER = "topilmadi"


async def search_org_profile(name: str, description: str = "") -> dict:
    """Web-search an institution and normalize what was found.

    Step 1 grounds Gemini in real Google Search results and produces an Uzbek
    fact sheet; step 2 normalizes that sheet into the org-profile JSON (the
    same schema the Telegram /org flow produces). Returns::

        {"found": bool, "profile": {...}, "sources": [url...], "facts": str}

    Raises ``ValueError`` when Gemini returns an unusable response, so the API
    can surface a 502 instead of persisting garbage.
    """
    client = _client_for_org()
    query = f"Muassasa: {name}"
    if description.strip():
        query += f"\nTavsif: {description.strip()}"

    resp = await asyncio.wait_for(
        client.aio.models.generate_content(
            model=config.GEMINI_ANALYSIS_MODEL,
            contents=query,
            config=types.GenerateContentConfig(
                system_instruction=ORG_WEB_FACTS_PROMPT,
                tools=[types.Tool(google_search=types.GoogleSearch())],
            ),
        ),
        timeout=90,
    )
    facts = (resp.text or "").strip()
    if not facts:
        raise ValueError("Gemini returned an empty search result")

    sources: list[str] = []
    try:
        chunks = resp.candidates[0].grounding_metadata.grounding_chunks or []
        for chunk in chunks:
            uri = (chunk.web.uri if chunk.web else None) or None
            if uri and uri not in sources:
                sources.append(uri)
    except (AttributeError, IndexError, TypeError):
        logger.warning("Grounding metadata missing on org search response")

    if facts.lstrip().lower().startswith(_NOT_FOUND_MARKER):
        return {"found": False, "profile": {}, "sources": sources, "facts": facts}

    profile = await summarize_org_profile(facts)
    return {"found": True, "profile": profile, "sources": sources, "facts": facts}
