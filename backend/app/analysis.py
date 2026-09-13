import asyncio
import json
import logging

from google import genai
from google.genai import types
from pydantic import BaseModel

from . import config
from .prompts import SCORING_SYSTEM_PROMPT

logger = logging.getLogger("viacall.analysis")


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
    outcome: str
    key_metrics: list[KeyMetric]
    strengths: list[str]
    weaknesses: list[str]
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
                    system_instruction=SCORING_SYSTEM_PROMPT,
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
