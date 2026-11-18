"""
ИИ-оператор: персона + инструменты (function calling).

Интерфейс module: build_system_instruction(), TOOLS, handle_tool(name, args).
Всё остальное (файлы, поиск по базе знаний) спрятано.
"""

from __future__ import annotations

import json
import math
import os
import re
import uuid
from collections import Counter
from datetime import datetime, timezone

from pathlib import Path
from google.genai import types

from .. import config as app_config
from . import school_db

_ICO_DIR = Path(__file__).resolve().parent
_ICO_DATA_DIR = Path(app_config.DATA_DIR) / "ico"
_ICO_DATA_DIR.mkdir(parents=True, exist_ok=True)

KNOWLEDGE_PATH = str(_ICO_DIR / "knowledge.md")
REQUESTS_PATH = str(_ICO_DATA_DIR / "requests.jsonl")
PROMPT_PATH = str(_ICO_DIR / "prompt.md")
ORG_PROFILE_PATH = str(_ICO_DIR / "org_profile.json")

# Язык разговора: auto — зеркалим собеседника, остальные — жёстко фиксируем.
LANGUAGES = ("auto", "ru", "uz", "en")

# Личность / стиль оператора (настраивается в UI)
PERSONALITIES = ("warm", "sales", "support", "concise")

_PERSONALITY_DIRECTIVES = {
    "warm": (
        "Стиль общения — тёплый, дружелюбный и человечный (Warm Receptionist). "
        "Слушай внимательно, поддерживай живой диалог и создавай ощущение заботы."
    ),
    "sales": (
        "Стиль общения — консультативный менеджер по продажам (Consultative Sales). "
        "Мягко выясняй потребность клиента, подчёркивай ценность решения и предлагай "
        "следующий шаг (демо, консультацию или заявку)."
    ),
    "support": (
        "Стиль общения — спокойный специалист поддержки (Calm Support). "
        "Проявляй терпение, уточняй детали проблемы по шагам и давай чёткое решение "
        "или передавай специалисту с полным контекстом."
    ),
    "concise": (
        "Стиль общения — быстрый и деловой (Fast & Direct). "
        "Отвечай максимально кратко, по сути, без лишних вводных слов."
    ),
}

_DEFAULT_ORG_PROFILE = {
    "name": "Suhbatdosh",
    "direction": "AI Call Analytics & Intelligent Call Operator Platform",
    "services": "",
    "rules": "",
    "flaws": "",
    "summary": "",
    "custom_instructions": "",
    "personality": "warm",
    "call_type": "receptionist",
    "greeting": "",
    "avatar_id": "laylo",
    "avatar_name": "Laylo",
    "avatar_role": "Персональный голосовой оператор",
    "avatar_traits": "Тёплая, внимательная, с живой человеческой интонацией. Помнит детали разговора и обращается по имени.",
    "avatar_bio": "Персональный оператор компании Suhbatdosh.",
}

_LANGUAGE_DIRECTIVES = {
    "auto": (
        "Определяй язык собеседника по его речи и отвечай на том же языке: "
        "русский, узбекский или английский. Если человек ещё не сказал ни слова — "
        "начни по-русски. Не переходи на другой язык без причины."
    ),
    "ru": "Всегда отвечай по-русски, даже если собеседник переходит на другой язык.",
    "uz": (
        "Har doim o'zbek tilida (lotin yozuvida) javob ber, hatto suhbatdosh boshqa "
        "tilda gapirsa ham."
    ),
    "en": "Always answer in English, even if the caller switches to another language.",
}


def language_directive(lang: str = "auto") -> str:
    return _LANGUAGE_DIRECTIVES.get(lang, _LANGUAGE_DIRECTIVES["auto"])


def apply_language(prompt: str, lang: str = "auto") -> str:
    """Добавляет к промпту жёсткое правило языка (выбор в интерфейсе)."""
    return f"{prompt.rstrip()}\n\n## Язык общения\n\n{language_directive(lang)}\n"


def _company() -> str:
    """Название компании читаем лениво: .env загружается уже после импорта."""
    return os.environ.get("OPERATOR_COMPANY", "наша компания")


def load_system_prompt() -> str | None:
    """Пользовательский промпт из prompt.md (редактируется в веб-интерфейсе)."""
    if not os.path.exists(PROMPT_PATH):
        return None
    with open(PROMPT_PATH, encoding="utf-8") as f:
        text = f.read().strip()
    return text or None


def load_org_profile() -> dict:
    """Читает профиль организации из org_profile.json."""
    profile = dict(_DEFAULT_ORG_PROFILE)
    if os.path.exists(ORG_PROFILE_PATH):
        try:
            with open(ORG_PROFILE_PATH, encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                profile.update({k: v for k, v in data.items() if v is not None})
        except (OSError, json.JSONDecodeError):
            pass
    if profile.get("personality") not in PERSONALITIES:
        profile["personality"] = "warm"
    return profile


def save_org_profile(patch: dict) -> dict:
    """Обновляет и сохраняет org_profile.json."""
    profile = load_org_profile()
    for key in _DEFAULT_ORG_PROFILE:
        if key in patch and patch[key] is not None:
            profile[key] = str(patch[key]) if not isinstance(patch[key], str) else patch[key]
    if profile.get("personality") not in PERSONALITIES:
        profile["personality"] = "warm"
    with open(ORG_PROFILE_PATH, "w", encoding="utf-8") as f:
        json.dump(profile, f, ensure_ascii=False, indent=2)
    return profile


def personality_directive(personality: str = "warm") -> str:
    return _PERSONALITY_DIRECTIVES.get(personality, _PERSONALITY_DIRECTIVES["warm"])


def format_org_context(profile: dict) -> str:
    parts = [f"Компания: {profile.get('name') or _company()}"]
    if profile.get("avatar_name"):
        parts.append(f"Имя аватара (твоё имя): {profile['avatar_name']}")
    if profile.get("avatar_role"):
        parts.append(f"Твоя роль: {profile['avatar_role']}")
    if profile.get("avatar_bio"):
        parts.append(f"О тебе: {profile['avatar_bio']}")
    if profile.get("avatar_traits"):
        parts.append(f"Черты характера и манера речи: {profile['avatar_traits']}")
    if profile.get("direction"):
        parts.append(f"Направление: {profile['direction']}")
    if profile.get("summary"):
        parts.append(f"О компании: {profile['summary']}")
    if profile.get("services"):
        parts.append(f"Услуги и продукты: {profile['services']}")
    if profile.get("rules"):
        parts.append(f"Правила оператора: {profile['rules']}")
    if profile.get("greeting"):
        parts.append(f"Предпочтительное приветствие: {profile['greeting']}")
    if profile.get("custom_instructions"):
        parts.append(f"Дополнительные инструкции: {profile['custom_instructions']}")
    return "\n".join(parts)


# --------------------------------------------------------------------------
# Персона
# --------------------------------------------------------------------------
def build_system_instruction(
    topic: str | None = None,
    lang: str = "auto",
    personality: str | None = None,
    org_profile: dict | None = None,
) -> str:
    custom = load_system_prompt()
    profile = org_profile if org_profile is not None else load_org_profile()
    active_personality = personality or profile.get("personality") or "warm"

    if custom:
        text = custom
    else:
        company = profile.get("name") or _company()
        text = (
            f"Ты — голосовой ИИ-оператор компании «{company}». Ты общаешься голосом и должен "
            "звучать как живой человек: тепло, естественно, короткими фразами (1–2 предложения), "
            "без списков, markdown и канцелярита.\n\n"
            "Твои задачи:\n"
            "1. Поздороваться и выяснить, чем помочь.\n"
            "2. Отвечать на вопросы о компании и услугах ТОЛЬКО по профилю и базе знаний: сначала вызывай "
            "инструмент lookup_knowledge, затем отвечай по найденному. Если в базе нет ответа — "
            "не выдумывай, предложи передать специалисту.\n"
            "3. Если человек хочет оставить заявку или обращение — выясни имя, контакт (телефон/почта) "
            "и суть вопроса, повтори главное вслух для проверки и вызови save_request.\n"
            "4. Если человек просит отправить письмо на email — уточни адрес, тему и содержание, "
            "подтверди адрес вслух и вызови send_email.\n"
            "5. Если человек просит живого специалиста, вопрос вне базы знаний или ты не уверен — "
            "вызови escalate_to_human и честно скажи, что передал вопрос специалисту.\n\n"
            "Не выдумывай цены, сроки и условия. Если не расслышал — переспроси. "
            "Держи разговор живым: задавай встречные вопросы и не превращай его в допрос."
        )

    org_block = format_org_context(profile)
    text += f"\n\n## Профиль организации\n\n{org_block}"
    text += f"\n\n## Стиль и личность\n\n{personality_directive(active_personality)}"

    if topic:
        text += (
            f"\n\nОтдельно: собеседник хочет поговорить на тему «{topic}». "
            "Поддерживай такую беседу как дружелюбный человек, но если появится деловой "
            "вопрос или просьба оставить заявку — работай по правилам оператора выше."
        )
    return apply_language(text, lang)


# --------------------------------------------------------------------------
# Декларации инструментов
# --------------------------------------------------------------------------
def _params(properties: dict, required: list[str]) -> types.Schema:
    return types.Schema(type="OBJECT", properties=properties, required=required)


TOOLS = types.Tool(
    function_declarations=[
        types.FunctionDeclaration(
            name="save_request",
            description=(
                "Сохраняет обращение клиента в файл. Вызывай только после того, как узнал "
                "имя, контакт и суть вопроса, и повторил их клиенту вслух."
            ),
            parameters=_params(
                {
                    "name": types.Schema(type="STRING", description="Имя клиента"),
                    "contact": types.Schema(type="STRING", description="Телефон или email"),
                    "request": types.Schema(type="STRING", description="Суть обращения"),
                },
                ["name", "contact", "request"],
            ),
        ),
        types.FunctionDeclaration(
            name="lookup_knowledge",
            description=(
                "Ищет ответ в базе знаний компании. Вызывай перед ответом на любой вопрос "
                "о компании, услугах, ценах или правилах."
            ),
            parameters=_params(
                {"question": types.Schema(type="STRING", description="Вопрос клиента")},
                ["question"],
            ),
        ),
        types.FunctionDeclaration(
            name="escalate_to_human",
            description=(
                "Передаёт вопрос живому специалисту. Вызывай, если клиент прямо просит человека, "
                "вопрос вне базы знаний или ты не можешь помочь."
            ),
            parameters=_params(
                {
                    "reason": types.Schema(type="STRING", description="Причина эскалации"),
                    "contact": types.Schema(type="STRING", description="Контакт клиента, если есть"),
                    "summary": types.Schema(type="STRING", description="Краткий контекст разговора для специалиста"),
                },
                ["reason"],
            ),
        ),
        types.FunctionDeclaration(
            name="search_people",
            description=(
                "Ищет учеников или учителей MBSI School по имени, фамилии, классу "
                "или предмету. Вызывай, когда просят найти конкретного человека."
            ),
            parameters=_params(
                {
                    "query": types.Schema(
                        type="STRING",
                        description="Имя, фамилия, класс (например 9-A) или предмет",
                    ),
                    "role": types.Schema(
                        type="STRING",
                        description="Кого искать: student, teacher или any (по умолчанию any)",
                        enum=["any", "student", "teacher"],
                    ),
                },
                ["query"],
            ),
        ),
        types.FunctionDeclaration(
            name="get_student_grades",
            description=(
                "Показывает оценки ученика по имени или id. Если подходят несколько "
                "учеников, инструмент вернёт список — уточни класс или полное имя."
            ),
            parameters=_params(
                {
                    "student": types.Schema(
                        type="STRING", description="Имя и фамилия ученика"
                    ),
                    "student_id": types.Schema(
                        type="INTEGER", description="id ученика, если он уже известен"
                    ),
                },
                [],
            ),
        ),
        types.FunctionDeclaration(
            name="send_email",
            description=(
                "Отправляет письмо клиенту на email. Вызывай только после подтверждения "
                "адреса и согласия клиента, и повтори вслух, что отправляешь."
            ),
            parameters=_params(
                {
                    "to": types.Schema(type="STRING", description="Email получателя"),
                    "subject": types.Schema(type="STRING", description="Тема письма"),
                    "text": types.Schema(type="STRING", description="Текст письма (plain)"),
                    "html": types.Schema(type="STRING", description="HTML-версия письма (необязательно)"),
                },
                ["to", "subject"],
            ),
        ),
    ]
)


# --------------------------------------------------------------------------
# Реализация инструментов
# --------------------------------------------------------------------------
def _append_record(record: dict) -> int:
    with open(REQUESTS_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    with open(REQUESTS_PATH, encoding="utf-8") as f:
        return sum(1 for _ in f)


def save_request(name: str = "", contact: str = "", request: str = "") -> dict:
    record_id = _append_record(
        {
            "id": uuid.uuid4().hex[:8],
            "type": "request",
            "status": "new",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "name": name,
            "contact": contact,
            "request": request,
        }
    )
    synced = False
    try:
        from services import suhbatdosh as sb

        if sb.status().get("api_configured"):
            phone = contact if "@" not in contact else ""
            email = contact if "@" in contact else ""
            res = sb.push_lead_to_suhbatdosh(
                name=name or "ICO Caller",
                phone=phone,
                email=email,
                notes=request,
            )
            synced = bool(res.get("ok"))
    except Exception:  # noqa: BLE001
        pass
    return {"status": "saved", "record_number": record_id, "suhbatdosh_synced": synced}


def escalate_to_human(reason: str = "", contact: str = "", summary: str = "") -> dict:
    record_number = _append_record(
        {
            "id": uuid.uuid4().hex[:8],
            "type": "escalation",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "reason": reason,
            "contact": contact,
            "summary": summary,
            "status": "waiting_human",
        }
    )
    return {"status": "escalated", "record_number": record_number}


_WORD_RE = re.compile(r"[A-Za-zА-Яа-яЁё0-9'’ʻ]+", re.UNICODE)

# Служебные слова и общие для всей базы термины: они не помогают выбрать нужный абзац.
_STOPWORDS = {
    # русский
    "и", "в", "во", "на", "не", "что", "как", "где", "когда", "это", "а", "но",
    "или", "для", "по", "с", "со", "из", "у", "о", "об", "от", "до", "за", "при",
    "к", "ко", "же", "ли", "бы", "есть", "какой", "какая", "какое", "какие",
    "такой", "такая", "такое", "такие",
    "сколько", "кто", "кого", "кому", "кем", "чем", "чего", "чему",
    "вы", "мы", "я", "ты", "он", "она", "они", "мне", "нам", "вас", "вам",
    "ваш", "ваша", "ваше", "пожалуйста", "можно", "нужно", "скажите",
    "подскажите", "хочу", "хотел", "хотела", "интересует", "расскажите",
    "расскажи", "расскажу", "скажи", "про", "подробнее",
    "школа", "школе", "школу", "школы", "mbsi", "school",
    # English
    "the", "a", "an", "is", "are", "am", "was", "were", "be", "do", "does",
    "did", "what", "where", "when", "which", "who", "whom", "how", "why",
    "much", "many", "of", "to", "for", "and", "or", "in", "on", "at", "by",
    "with", "about", "from", "your", "you", "we", "i", "me", "my", "our",
    "please", "tell", "can", "could", "would", "should", "have", "has",
    "there", "it", "this", "that", "information", "info",
    # o'zbekcha
    "va", "bu", "nima", "qanday", "bormi", "bor", "yo'q", "yoq", "ha",
    "uchun", "bilan", "men", "siz", "biz", "ular", "mening", "sizning",
    "maktab", "maktabda", "maktabimiz", "iltimos", "ayting", "aytsangiz",
    "kerak", "mumkin", "qachon", "nechta", "kim",
    # латинская транслитерация русских служебных слов
    "kak", "kakie", "kakoy", "kakaya", "kakoe", "chto", "gde", "kogda",
    "skolko", "kto", "est", "dlya", "pro",
    # общие глаголы
    "study", "studies", "learn", "learning", "studio",
}

# Мультиязычные синонимы: запрос на английском или узбекском должен находить
# русские абзацы базы знаний. Каждая группа — (русские канонические слова,
# варианты на других языках).
_SYNONYM_GROUPS = [
    # цена / оплата
    ("стоимость обучение цена",
     "price cost costs tuition fee fees pay payment narx to'lov tolov qancha pul sum uzs"),
    # год / учебный год
    ("год учебный",
     "year years annual academic yil yili yilda"),
    # учебный / образовательный
    ("учебный", "o'quv"),
    # центр / учебный центр
    ("центр образовательный учебный",
     "center centre educational education learning training markaz markazi markazingiz"),
    # начало учебного года / старт
    ("начинается начало старт семестр сентябрь",
     "start starts begin begins beginning boshlanadi boshlanishi"),
    # поступление / экзамен
    ("поступление поступить прием вступительный экзамен зачисление процесс",
     "admission admissions apply application entrance exam exams enroll enrollment "
     "qabul kirish imtihon topshirish process"),
    # стипендии / скидки
    ("стипендия скидка льгота",
     "scholarship scholarships discount discounts aid financial grant stipendiya chegirma imtiyoz"),
    # адрес / расположение
    ("адрес находится расположен",
     "address location located where map manzil qayerda joylashgan"),
    # контакты
    ("телефон почта контакт позвонить email",
     "phone telephone email contact contacts call number raqam telefon pochta aloqa"),
    # график / время работы
    ("график работает часы время",
     "hours hour schedule open opening time work ish vaqti jadval qachon"),
    # кружки / клубы
    ("кружок кружки клуб",
     "club clubs activities activity extracurricular to'garak togarak "
     "to'garaklar klub kruzhok kruzhki kruzhka"),
    # спорт / секции
    ("спорт секция",
     "sport sports seksiya"),
    # учебная программа / предметы
    ("предмет программа учебный математика физика информатика английский наука",
     "subject subjects curriculum program programs math mathematics physics computer "
     "science english stem fan dastur matematika fizika ingliz informatika"),
    # оценки
    ("оценка балл пятибалльная",
     "grade grades mark marks gpa score scores baho baholar ball"),
    # классы
    ("класс",
     "class classes form sinf"),
    # ученики
    ("ученик учащийся студент",
     "student students pupil pupils enrollment o'quvchi oquvchi o'quvchilar soni"),
    # учителя
    ("учитель педагог преподаватель сотрудник",
     "teacher teachers staff faculty o'qituvchi oqituvchi muallim"),
    # директор
    ("директор",
     "principal director direktor rahbar"),
    # руководство
    ("руководство",
     "leadership head"),
    # лицензия
    ("лицензия аккредитация",
     "license licence accredited accreditation litsenziya"),
    # история
    ("история раньше",
     "history historical formerly previously before past webking tarix tarixi tarixni tarixida tarixini"),
    # питание
    ("питание обед еда",
     "meal meals lunch food ovqat tushlik"),
    # миссия
    ("миссия ценности",
     "mission values qadriyat missiya"),
    # календарь / семестры
    ("календарь семестр каникулы",
     "calendar semester semesters holiday holidays vacation jadval semestr ta'til"),
    # SAT / IELTS
    ("sat ielts",
     "sat ielts imtihon"),
    # документы
    ("документы требования",
     "documents required requirements hujjat"),
    # Suhbatdosh / тарифы / подключение / аналитика / телефония
    ("тариф подключение демо пилот",
     "plan plans pricing demo pilot trial ulanish ulash narxlar"),
    ("аналитика звонок транскрипт качество",
     "analytics call calls transcript scorecard quality tahlil qo'ng'iroq sifat baholash"),
    ("поддержка интеграция телефония задарма телеграм",
     "support integration telephony zadarma telegram pbx yordam integratsiya"),
]


def _norm_text(text: str) -> str:
    text = (text or "").lower().replace("ё", "е")
    for mark in ("’", "ʻ", "`", "´"):
        text = text.replace(mark, "'")
    return text


def _stem(word: str) -> str:
    """Грубая нормализация словоформ.

    Для кириллицы хватает первых 4 букв. Для латиницы берём 6 букв и
    отбрасываем конечную «s»: так «student»/«students» совпадают, а «studio»
    и «study» — нет.
    """
    if re.match(r"[a-z0-9']", word):
        if len(word) > 4 and word.endswith("s"):
            word = word[:-1]
        return word[:6] if len(word) >= 7 else word
    return word[:4] if len(word) >= 5 else word


def _build_synonyms() -> dict[str, set[str]]:
    """Карта «иностранное слово → русские термины базы».

    Ключами служат только английские и узбекские варианты. Русские слова не
    раскрываются в другие русские: иначе «учебный» тянул бы за собой всю
    математику и физику и перебивал нужный абзац.
    """
    mapping: dict[str, set[str]] = {}
    for canonical, variants in _SYNONYM_GROUPS:
        targets = {_stem(word) for word in canonical.split()}
        for word in variants.split():
            mapping.setdefault(_stem(word), set()).update(targets)
    return mapping


_SYNONYMS = _build_synonyms()


def _terms(text: str, expand: bool = False) -> set[str]:
    """Нормализует слова и (для вопроса) добавляет мультиязычные синонимы.

    Сравниваем первые 4 буквы: «обучение»/«обучения», «стоит»/«стоимость»,
    «поступить»/«поступление» попадают в один класс. Для запроса дополнительно
    подмешиваются русские эквиваленты английских и узбекских слов, чтобы
    «how much is tuition» находил абзац про стоимость обучения.
    """
    terms: set[str] = set()
    for word in _WORD_RE.findall(_norm_text(text)):
        if len(word) < 3 or word in _STOPWORDS:
            continue
        stem = _stem(word)
        terms.add(stem)
        if expand:
            terms.update(_SYNONYMS.get(stem, ()))
    return terms


def lookup_knowledge(question: str = "") -> dict:
    if not os.path.exists(KNOWLEDGE_PATH):
        return {
            "found": False,
            "note": "База знаний отсутствует. Не выдумывай ответ — предложи специалиста.",
        }
    with open(KNOWLEDGE_PATH, encoding="utf-8") as f:
        content = f.read()

    # Разбиваем на абзацы и запоминаем ближайший заголовок раздела: он помогает
    # выбрать нужную тему, даже если в самом абзаце нет слова из вопроса.
    units: list[tuple[str, str]] = []
    heading = ""
    for block in re.split(r"\n\s*\n", content):
        block = block.strip()
        if not block:
            continue
        if block.startswith("#"):
            heading = block.lstrip("#").strip()
            continue
        units.append((heading, block))

    direct = _terms(question)
    query = _terms(question, expand=True)
    if not query:
        # Общие вопросы вроде «что такое MBSI School?» после удаления служебных
        # слов не содержат терминов. Отдаём вводный абзац, а не пустоту.
        intro = next((paragraph for _, paragraph in units if paragraph), "")
        if intro:
            return {"found": True, "excerpts": [intro]}
        return {
            "found": False,
            "note": "В базе знаний нет подходящего ответа. Предложи передать специалисту.",
        }

    unit_terms = [_terms(f"{head}\n{paragraph}") for head, paragraph in units]
    heading_terms = [_terms(head) for head, _ in units]
    df = Counter(term for terms in unit_terms for term in terms)
    total = len(units)

    def weight(term: str) -> float:
        # Редкие термины важнее общих: «лицензия» весит больше, чем «обучение».
        return 1.0 + math.log((total + 1) / (1 + df[term]))

    scored = []
    for index, ((head, paragraph), terms) in enumerate(zip(units, unit_terms)):
        overlap = query & terms
        if not overlap:
            continue
        words = [
            _stem(word)
            for word in _WORD_RE.findall(_norm_text(f"{head}\n{paragraph}"))
            if len(word) >= 3 and word not in _STOPWORDS
        ]
        freq = Counter(words)
        score = 0.0
        for term in overlap:
            base = weight(term)
            # Совпадение по слову из самого вопроса весит больше, чем совпадение
            # по переведённому синониму.
            if term in direct:
                base *= 1.8
            # Повтор слова помогает, но не должен перекрывать число разных
            # совпавших терминов.
            base *= 1.0 + 0.2 * min(freq.get(term, 0), 4)
            # Слово в заголовке раздела — сильный сигнал темы.
            if term in heading_terms[index]:
                base *= 1.4
            score += base
        scored.append((score, index, paragraph))

    if not scored:
        return {
            "found": False,
            "note": "В базе знаний нет подходящего ответа. Предложи передать специалисту.",
        }
    scored.sort(key=lambda item: (-item[0], item[1]))
    excerpts = [paragraph for _, _, paragraph in scored[:4]]
    return {"found": True, "excerpts": excerpts}


try:
    from services.email import send_email as _send_email
except Exception:  # noqa: BLE001
    def _send_email(to="", subject="", text="", html=""):
        return {"error": "email service unavailable"}

_HANDLERS = {
    "save_request": save_request,
    "lookup_knowledge": lookup_knowledge,
    "escalate_to_human": escalate_to_human,
    "search_people": school_db.search_people,
    "get_student_grades": school_db.get_student_grades,
    "send_email": _send_email,
}


def handle_tool(name: str, args: dict | None = None) -> dict:
    """Единая точка: имя функции от модели -> результат для неё."""
    handler = _HANDLERS.get(name)
    if handler is None:
        return {"error": f"unknown tool: {name}"}
    try:
        return handler(**(args or {}))
    except TypeError as e:
        return {"error": f"bad arguments for {name}: {e}"}
    except Exception as e:  # noqa: BLE001 — инструмент не должен ронять сессию
        return {"error": f"{type(e).__name__} in {name}: {e}"}
