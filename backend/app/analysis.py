import asyncio
import json
import logging

from google import genai
from google.genai import types
from typing import Literal

from pydantic import BaseModel

from . import config, db
from .prompts import ORG_SUMMARY_PROMPT, ORG_WEB_FACTS_PROMPT, scoring_system_prompt

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


class CallAnalysis(BaseModel):
    """Structured coaching report returned by the analysis model."""

    topic: str
    language: str
    summary: str
    scorecard: Scorecard
    rep_share_of_talk: float
    outcome: Literal["win", "likely", "uncertain", "unknown"]
    key_metrics: list[KeyMetric]
    coaching_points: list[str]
    next_steps: list[str]
    action_items: list[ActionItem]


class Analyzer:
    """Wraps a Gemini client used to score a call transcript into a CallAnalysis."""

    def __init__(self, api_key: str | None = None):
        self._client = genai.Client(api_key=api_key or config.GEMINI_API_KEY)

    async def analyze(self, transcript: str) -> dict:
        """Asynchronously generate a CallAnalysis from a transcript string."""
        if not transcript or not transcript.strip():
            return {"error": "empty transcript"}
        resp = await asyncio.wait_for(
            self._client.aio.models.generate_content(
                model=config.GEMINI_ANALYSIS_MODEL,
                contents=transcript,
                config=types.GenerateContentConfig(
                    # Read fresh per analysis so a profile edit applies to the
                    # very next call without a restart.
                    system_instruction=scoring_system_prompt(db.get_org_profile()),
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
