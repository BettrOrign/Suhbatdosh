#!/usr/bin/env python3
"""Seed demo employees and audio-less calls into a Suhbatdosh database.

Stdlib only — no FastAPI, no uv, no venv. Safe to run on a live server while the
API is up (SQLite WAL, 5 s busy timeout, single transaction per batch).

The product derives "problem solved" from the analysis JSON rather than from a
column (``db.get_manager_rankings``: ``score < 50 AND lower(analysis) LIKE
'%hal qilindi%'``), so a solved call is one whose analysis text actually
contains that phrase, and an open one must not contain it.

Idempotent: every row written here carries ``source_meta.seed = "demo_calls_v1"``
and the script exits early if it finds that marker, so re-running is a no-op.

Usage:
    python3 backend/scripts/seed_demo_calls.py            # auto-detect data/
    python3 backend/scripts/seed_demo_calls.py --db /srv/suhbatdosh/data/suhbatdosh.db
    python3 backend/scripts/seed_demo_calls.py --dry-run   # plan only, no writes
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

SEED_TAG = "demo_calls_v1"
SEED_VERSION = "1"

MANAGERS = [
    ("Shoxrux Karimov", "shoxrux.karimov@suhbatdosh.uz"),
    ("Farhod Yusupov", "farhod.yusupov@suhbatdosh.uz"),
    ("Rustam Abdullayev", "rustam.abdullayev@suhbatdosh.uz"),
]
MASULS = [
    ("Murod Rasulov", "murod.rasulov@suhbatdosh.uz"),
    ("Bakhtiyor Nazarov", "bakhtiyor.nazarov@suhbatdosh.uz"),
]

FLAWS = [
    "Telefon orqali mijozni yo'qotish", "Mijozning shikayati: sotuv haqida gapirmadi",
    "Raqobatchi haqida gapirmadi", "Narxni ochiq aytmadi",
    "Mijozni to'g'ri yo'naltirmadi", "Qo'ng'iroqni juda kech boshladi",
    "Ehtiyoj aniqlash bosqichini o'tkazib yubordi", "Mijozning e'tirozini to'g'ri hal qilmadi",
    "Suhbatni erta yakunladi", "Dastlabki salomlashuv juda sovuq",
    "Qo'shimcha xizmatlarni taklif qilmadi", "Mijozning byudjetini o'rganmadi",
    "Texnik tafsilotlarni juda ko'p aytdi", "Closing qattiq emas",
    "Mijozni tinglamadi", "Raqobatchi mahsulotini tanqid qildi",
    "Mijozning oldingi tajribasini so'ramadi", "Sotuvchi ko'p gapirdi",
    "Mijozning xavotirini e'tiborsiz qoldirdi", "Demo vaqtini belgilamadi",
]

TOPICS_OK = [
    "CRM tizimini sotish", "IT xizmatlari bo'yicha muzokara", "Korporativ trening sotish",
    "Logistika tizimini sotish", "Avtomatlashtirish yechimi", "Moliyaviy konsalting xizmati",
    "HR tizimini joriy qilish", "Veb-sayt yaratish xizmati", "Call markaz tizimini sotish",
    "Cloud xizmatlari", "Cybersecurity audit", "Mobile ilova yaratish",
    "E-commerce platformasi", "Data analytics xizmati", "Ombor boshqaruv tizimi",
]

SOURCE_PLAN = (["upload"] * 32) + (["zadarma"] * 8) + (["telegram_voice"] * 5) \
    + (["ingest"] * 3) + (["youtube"] * 2)


# --- helpers ---------------------------------------------------------------

def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def hash_password(password: str) -> str:
    """Mirror of app.auth.hash_password so seeded accounts stay login-compatible."""
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000).hex()
    return f"{salt}${digest}"


def find_db(explicit: str | None) -> Path:
    if explicit:
        p = Path(explicit).expanduser().resolve()
        if not p.exists():
            sys.exit(f"Database not found: {p}")
        return p
    candidates = []
    if os.getenv("DATA_DIR"):
        candidates.append(Path(os.getenv("DATA_DIR")) / "suhbatdosh.db")
    here = Path(__file__).resolve()
    candidates += [
        Path.cwd() / "data" / "suhbatdosh.db",
        Path.cwd() / "backend" / ".." / "data" / "suhbatdosh.db",
        here.parent.parent.parent / "data" / "suhbatdosh.db",   # repo/data
        here.parent.parent / "data" / "suhbatdosh.db",          # backend/data
        Path("/opt/ViaCall/data/suhbatdosh.db"),
        Path("/root/ViaCall/data/suhbatdosh.db"),
    ]
    for c in candidates:
        if c.exists():
            return c.resolve()
    sys.exit("Could not locate suhbatdosh.db — pass --db PATH explicitly.")


def dialogue(topic: str, ok: bool) -> str:
    if ok:
        return (
            f"[Qo'ng'iroq yozuvi — {topic}]\n"
            "Menejer: Assalomu alaykum, Suhbatdosh kompaniyasidan bezovta qilaman.\n"
            "Mijoz: Assalomu alaykum, eshityapman.\n"
            f"Menejer: {topic} bo'yicha bir necha savolim bor edi — hozir qulaymi?\n"
            "Mijoz: Ha, qulay. Bizda haqiqatan shu yo'nalishda ehtiyoj bor.\n"
            "Menejer: Tushunarli. Qaysi jarayon ko'proq vaqt oladi?\n"
            "Mijoz: Hisobotlar va mijozlar bilan aloqa.\n"
            "Menejer: U holda biz demo ko'rsatib, aniq raqamlarni beramiz.\n"
            "Mijoz: Mayli, juma kuni ko'rishamiz.\n"
        )
    return (
        f"[Qo'ng'iroq yozuvi — {topic}]\n"
        "Menejer: Assalomu alaykum.\n"
        "Mijoz: Assalomu alaykum, men narxni bilmoqchi edim.\n"
        "Menejer: Hozir aytaman, lekin avval bir savol — qancha xodim ishlaydi?\n"
        "Mijoz: Kichik jamoamiz bor, 12 kishi.\n"
        "Menejer: Yaxshi. Bizda bir nechta tarif bor...\n"
        "Mijoz: Aniq raqamni aytmadingiz-ku.\n"
        "Menejer: Keyinroq yozib yuboraman.\n"
        "Mijoz: Xo'p, rahmat.\n"
    )


def ensure_schema(conn: sqlite3.Connection) -> None:
    tables = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    missing = {"users", "calls", "notifications"} - tables
    if missing:
        sys.exit(f"Not a Suhbatdosh database (missing tables: {', '.join(sorted(missing))}).")


# --- main ------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description="Seed demo calls into Suhbatdosh.")
    ap.add_argument("--db", help="path to suhbatdosh.db (auto-detected by default)")
    ap.add_argument("--dry-run", action="store_true", help="print the plan, write nothing")
    args = ap.parse_args()

    db_path = find_db(args.db)
    print(f"Database: {db_path}")

    conn = sqlite3.connect(db_path, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=5000")
    ensure_schema(conn)

    already = conn.execute(
        "SELECT COUNT(*) FROM calls WHERE source_meta LIKE ?", (f'%"{SEED_TAG}"%',)
    ).fetchone()[0]
    if already:
        print(f"Marker {SEED_TAG!r} already on {already} calls — nothing to do (idempotent).")
        return 0

    backup = db_path.with_name(f"{db_path.name}.bak-{datetime.now():%Y%m%d-%H%M%S}")
    if args.dry_run:
        print("DRY RUN — no backup, no writes. Would create 5 users and 50 calls.")
        return 0
    # Use SQLite's own backup API: a plain file copy would miss commits still
    # sitting in the -wal file while the API is running.
    with sqlite3.connect(backup) as dst:
        conn.backup(dst)
    print(f"Backup:  {backup}")

    import random
    rng = random.Random(42)
    ts_now = datetime.now(timezone.utc)

    # --- employees (random unusable passwords: these accounts are for stats) --
    staff: dict[str, list[dict]] = {"manager": [], "yonalish": []}
    for role, people in (("manager", MANAGERS), ("yonalish", MASULS)):
        for name, email in people:
            row = conn.execute(
                "SELECT id, name, email, role FROM users WHERE email = ?", (email,)
            ).fetchone()
            if row:
                staff[role].append(dict(row))
                print(f"  = {role:<9} {email} (existing id={row['id']})")
                continue
            cur = conn.execute(
                "INSERT INTO users (name, email, password_hash, role, active, api_token, created_at) "
                "VALUES (?,?,?,?,1,?,?)",
                (name, email, hash_password(secrets.token_urlsafe(24)), role,
                 secrets.token_urlsafe(32), now()),
            )
            staff[role].append({"id": cur.lastrowid, "name": name, "email": email, "role": role})
            print(f"  + {role:<9} {email} (id={cur.lastrowid})")

    # --- call specs ----------------------------------------------------------
    kinds = ["solved"] * 25 + ["open"] * 10 + ["ok"] * 15
    rng.shuffle(kinds)
    sources = SOURCE_PLAN[:]
    rng.shuffle(sources)

    calls = []
    for i, kind in enumerate(kinds):
        ts = (ts_now - timedelta(days=i % 10)).replace(
            hour=9 + (i * 3) % 10, minute=(i * 17) % 60, second=0, microsecond=0
        )
        calls.append({
            "kind": kind, "ts": ts, "source": sources[i],
            "lang": rng.choice(["uz", "uz", "uz", "uz", "ru"]),
            "duration": 90 + (i * 23) % 280,
        })
    calls.sort(key=lambda c: c["ts"])

    # --- insert --------------------------------------------------------------
    counts = {"solved": 0, "open": 0, "ok": 0}
    open_calls: list[tuple[int, int, str, str]] = []  # (call_id, owner_id, topic, masul)

    for i, spec in enumerate(calls):
        kind = spec["kind"]
        if kind == "ok":
            owner = staff["manager"][i % len(staff["manager"])]
            topic = TOPICS_OK[i % len(TOPICS_OK)]
            score = 68 + (i * 11) % 28
            scorecard = {
                "opening": min(100, score + 6), "discovery": score,
                "objection_handling": score - 4, "value_prop": score + 2,
                "closing": score - 6, "rapport": score + 5,
                "talk_ratio": 55, "overall": score,
            }
            analysis = {
                "topic": topic, "language": spec["lang"],
                "summary": "Professional suhbat: ehtiyoj aniqlandi, yechim taklif qilindi va keyingi qadam belgilandi.",
                "scorecard": scorecard,
                "rep_share_of_talk": round(0.44 + (i % 5) * 0.03, 2),
                "outcome": rng.choice(["win", "win", "likely"]),
                "key_metrics": [
                    {"name": "Xodimlar soni", "value": f"{10 + i % 40}"},
                    {"name": "Byudjet", "value": f"${(i % 9 + 2) * 500}/oy"},
                ],
                "coaching_points": ["E'tirozga tayyor javob bering",
                                    "Closing'ni aniq savol bilan yoping"],
                "next_steps": ["Demo uchrashuv tayinlash", "Taklifnomani yuborish"],
                "action_items": [{"description": "Demo uchrashuvni tasdiqlash",
                                  "due_date": None, "assignee": "manager",
                                  "priority": "medium"}],
            }
            transcript = dialogue(topic, True)
        else:
            owner = staff["yonalish"][i % len(staff["yonalish"])]
            flaw = FLAWS[i % len(FLAWS)]
            topic = flaw
            score = 22 + (i * 7) % 14
            scorecard = {
                "opening": max(15, score - 5), "discovery": max(15, score - 8),
                "objection_handling": max(15, score - 3), "value_prop": max(15, score - 5),
                "closing": max(15, score - 10), "rapport": max(15, score - 2),
                "talk_ratio": 38, "overall": score,
            }
            masul = owner["name"]
            if kind == "solved":
                analysis = {
                    "topic": topic, "language": spec["lang"],
                    "summary": ("Bu suhbatda jiddiy muammo aniqlandi. Xodim "
                                f"{masul} muammoni tahlil qilib, mijoz bilan qayta ishladi va hal qildi."),
                    "scorecard": scorecard, "rep_share_of_talk": 0.38, "outcome": "lost",
                    "key_metrics": [{"name": "Muammo", "value": flaw},
                                    {"name": "Holati", "value": "Hal qilindi"}],
                    "coaching_points": ["Mijoz ehtiyojlarini aniqlang",
                                        "Raqobatchi haqida suhbat boring",
                                        "Narxni ochiq ayting"],
                    "next_steps": ["Mijoz bilan qayta suhbat",
                                   "Muammo yechimi tasdiqlandi"],
                    "action_items": [{"description": f"{flaw} — hal qilindi ({masul})",
                                      "due_date": None, "assignee": "yonalish",
                                      "priority": "high"}],
                }
                transcript = dialogue(topic, False) + f"\n[Izoh] {masul}: muammo hal qilindi."
            else:
                analysis = {
                    "topic": topic, "language": spec["lang"],
                    "summary": ("Bu suhbatda jiddiy muammo aniqlandi, lekin hali hal qilinmagan. "
                                f"Xodim {masul} ustida ishlamoqda."),
                    "scorecard": scorecard, "rep_share_of_talk": 0.38, "outcome": "lost",
                    "key_metrics": [{"name": "Muammo", "value": flaw},
                                    {"name": "Holati", "value": "Hali ochiq"}],
                    "coaching_points": ["Mijoz ehtiyojlarini aniqlang",
                                        "Raqobatchi haqida suhbat boring",
                                        "Narxni ochiq ayting"],
                    "next_steps": ["Zudlik bilan mijozga qayta bog'lanish",
                                   "Muammoni hal qilish kerak"],
                    "action_items": [{"description": f"{flaw} — hali ochiq, hal qilish kerak ({masul})",
                                      "due_date": None, "assignee": "yonalish",
                                      "priority": "high"}],
                }
                transcript = dialogue(topic, False) + f"\n[Izoh] {masul}: muammo hali ochiq."

        meta = {"seed": SEED_TAG, "seed_version": SEED_VERSION}
        if spec["source"] == "zadarma":
            meta["zadarma_call_id"] = f"demo-zd-{i:03d}"
        elif spec["source"] == "youtube":
            meta["youtube_url"] = f"https://youtu.be/demo{i:03d}"
        elif spec["source"] == "ingest":
            meta["filename"] = f"demo-ingest-{i:03d}.mp3"

        cur = conn.execute(
            "INSERT INTO calls (name, status, audio_path, duration_sec, language, transcript, "
            "segments, analysis, call_type, user_id, client_id, created_at, updated_at, "
            "source_type, source_meta) "
            "VALUES (?, 'done', '', ?, ?, ?, '[]', ?, 'manager', ?, NULL, ?, ?, ?, ?)",
            (topic, spec["duration"], spec["lang"], transcript,
             json.dumps(analysis, ensure_ascii=False), owner["id"],
             spec["ts"].isoformat(), spec["ts"].isoformat(),
             spec["source"], json.dumps(meta, ensure_ascii=False)),
        )
        call_id = cur.lastrowid
        counts[kind] += 1
        if kind == "open":
            open_calls.append((call_id, owner["id"], topic, analysis["action_items"][0]["description"]))

    # --- notifications for the open problems ---------------------------------
    for call_id, owner_id, topic, description in open_calls:
        conn.execute(
            "INSERT INTO notifications (user_id, call_id, type, title, message, metadata, read, created_at) "
            "VALUES (?, ?, 'action_item', ?, ?, ?, 0, ?)",
            (owner_id, call_id, description[:100],
             f"Muammoli qo'ng'iroq: {topic}. Hal qilish talab etiladi.",
             json.dumps({"assignee": "yonalish", "priority": "high", "due_date": None}), now()),
        )

    admin = conn.execute(
        "SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1"
    ).fetchone()
    if admin:
        for call_id, _owner, topic, _desc in open_calls[:5]:
            conn.execute(
                "INSERT INTO notifications (user_id, call_id, type, title, message, metadata, read, created_at) "
                "VALUES (?, ?, 'action_item', ?, ?, ?, 0, ?)",
                (admin["id"], call_id, f"Hal qilinmagan muammo: {topic[:60]}",
                 "Muammoli qo'ng'iroq bo'yicha chora ko'rish kerak.",
                 json.dumps({"assignee": "yonalish", "priority": "high"}), now()),
            )

    conn.commit()

    # --- verification ---------------------------------------------------------
    total, done = conn.execute("SELECT COUNT(*), SUM(status='done') FROM calls").fetchone()
    bad_solved = conn.execute(
        "SELECT COUNT(*) FROM calls WHERE json_extract(analysis,'$.scorecard.overall') >= 50 "
        "AND lower(analysis) LIKE '%hal qilindi%'").fetchone()[0]
    print(f"\nInserted {len(calls)} calls: {counts['solved']} solved-problem, "
          f"{counts['open']} open-problem, {counts['ok']} healthy.")
    print(f"Database now: {total} calls ({done} done), false-solved rows: {bad_solved}")
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
