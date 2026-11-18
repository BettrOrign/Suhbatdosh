"""
Школьная база MBSI: ученики, учителя и оценки.

Это демонстрационная SQLite-база: при первом обращении создаётся `school.db`
и заполняется реалистичными тестовыми данными. Замените данные на настоящие —
интерфейс функций останется тем же.

Публичный интерфейс:
    search_people(query, role="any") -> dict
    get_student_grades(student="", student_id=None) -> dict
"""

from __future__ import annotations

import os
import sqlite3
import unicodedata

from pathlib import Path
from .. import config as app_config

def _default_db_path() -> str:
    ico_dir = Path(app_config.DATA_DIR) / "ico"
    ico_dir.mkdir(parents=True, exist_ok=True)
    return str(ico_dir / "school.db")

DB_PATH = _default_db_path()

STUDENTS = [
    # full_name (latin), name_ru, class, birth_year, guardian, phone
    ("Aziz Karimov", "Азиз Каримов", "9-A", 2010, "Dilnoza Karimova", "+998 90 123-45-67"),
    ("Malika Yusupova", "Малика Юсупова", "10-B", 2009, "Shahnoza Yusupova", "+998 91 234-56-78"),
    ("Bekzod Tursunov", "Бекзод Турсунов", "11-A", 2008, "Anvar Tursunov", "+998 93 345-67-89"),
    ("Nilufar Abdullayeva", "Нилуфар Абдуллаева", "8-B", 2011, "Gulbahor Abdullayeva", "+998 94 456-78-90"),
    ("Javohir Rahimov", "Жавохир Рахимов", "7-A", 2012, "Sardor Rahimov", "+998 95 567-89-01"),
    ("Madina Sattorova", "Мадина Сатторова", "11-B", 2008, "Feruza Sattorova", "+998 97 678-90-12"),
    ("Sardor Aliyev", "Сардор Алиев", "9-B", 2010, "Bektemir Aliyev", "+998 90 789-01-23"),
    ("Shahzoda Nazarova", "Шахзода Назарова", "10-A", 2009, "Zulfiya Nazarova", "+998 91 890-12-34"),
    ("Timur Ismoilov", "Тимур Исмоилов", "6-A", 2013, "Nodira Ismoilova", "+998 93 901-23-45"),
    ("Ziyoda Ergasheva", "Зиёда Эргашева", "5-B", 2014, "Mavluda Ergasheva", "+998 94 012-34-56"),
    ("Ruslan Qodirov", "Руслан Кодиров", "8-A", 2011, "Ilhom Qodirov", "+998 95 112-23-34"),
    ("Kamila Mirzayeva", "Камила Мирзаева", "7-B", 2012, "Dildora Mirzayeva", "+998 97 223-34-45"),
    ("Umidjon Sobirov", "Умиджон Собиров", "7-A", 2012, "Otabek Sobirov", "+998 90 334-45-56"),
    ("Feruza Hamidova", "Феруза Хамидова", "8-B", 2011, "Nigora Hamidova", "+998 91 445-56-67"),
    ("Doniyor Ergashev", "Дониёр Эргашев", "10-B", 2009, "Ulugbek Ergashev", "+998 93 556-67-78"),
]

TEACHERS = [
    # full_name, name_ru, subject, position, phone, email
    ("Sardorbek Turdaliyev", "Сардорбек Турдалиев", "Руководство", "Директор",
     "+998 94 890-11-88", "principal@mbsi.school"),
    ("Barno Saydullayeva", "Барно Сайдуллаева", "Психология", "Школьный консультант",
     "", "barnosaydullayeva@mbsi.school"),
    ("Nodira Yuldasheva", "Нодира Юлдашева", "Математика", "Учитель математики",
     "", "n.yuldasheva@mbsi.school"),
    ("Alisher Usmonov", "Алишер Усмонов", "Информатика", "Учитель информатики",
     "", "a.usmonov@mbsi.school"),
    ("Sevara Qosimova", "Севара Косимова", "Физика", "Учитель физики",
     "", "s.qosimova@mbsi.school"),
    ("Jasur Toshpulatov", "Жасур Тошпулатов", "Английский язык", "Учитель английского",
     "", "j.toshpulatov@mbsi.school"),
    ("Gulnora Isakova", "Гулнора Исакова", "Химия", "Учитель химии",
     "", "g.isakova@mbsi.school"),
    ("Rustam Bekmurodov", "Рустам Бекмуродов", "Физкультура", "Учитель физкультуры",
     "", "r.bekmurodov@mbsi.school"),
]

SUBJECTS = ["Математика", "Информатика", "Физика", "Английский язык", "Химия", "История"]
TERMS = ["1-семестр", "2-семестр"]


def _connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def ensure_db() -> None:
    """Создаёт схему и демо-данные, если базы ещё нет."""
    with _connect() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS students (
                id INTEGER PRIMARY KEY,
                full_name TEXT NOT NULL,
                name_ru TEXT NOT NULL,
                class_name TEXT NOT NULL,
                birth_year INTEGER,
                guardian TEXT,
                phone TEXT
            );
            CREATE TABLE IF NOT EXISTS teachers (
                id INTEGER PRIMARY KEY,
                full_name TEXT NOT NULL,
                name_ru TEXT NOT NULL,
                subject TEXT NOT NULL,
                position TEXT NOT NULL,
                phone TEXT,
                email TEXT
            );
            CREATE TABLE IF NOT EXISTS grades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id INTEGER NOT NULL REFERENCES students(id),
                subject TEXT NOT NULL,
                term TEXT NOT NULL,
                grade INTEGER NOT NULL,
                comment TEXT
            );
            """
        )
        if connection.execute("SELECT COUNT(*) FROM students").fetchone()[0] == 0:
            connection.executemany(
                "INSERT INTO students "
                "(full_name, name_ru, class_name, birth_year, guardian, phone) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                STUDENTS,
            )
        if connection.execute("SELECT COUNT(*) FROM teachers").fetchone()[0] == 0:
            connection.executemany(
                "INSERT INTO teachers "
                "(full_name, name_ru, subject, position, phone, email) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                TEACHERS,
            )
        if connection.execute("SELECT COUNT(*) FROM grades").fetchone()[0] == 0:
            rows = []
            for index, student in enumerate(STUDENTS, start=1):
                for s_index, subject in enumerate(SUBJECTS):
                    for t_index, term in enumerate(TERMS):
                        score = 5 if (index + s_index + t_index) % 4 else 4
                        if (index * 3 + s_index + t_index) % 11 == 0:
                            score = 3
                        rows.append((index, subject, term, score, None))
            connection.executemany(
                "INSERT INTO grades (student_id, subject, term, grade, comment) "
                "VALUES (?, ?, ?, ?, ?)",
                rows,
            )


def _normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text or "").lower().replace("ё", "е")
    text = text.replace("’", "'").replace("ʻ", "'").replace("`", "'")
    return " ".join(text.split())


def _person_row(row: sqlite3.Row, role: str) -> dict:
    if role == "student":
        return {
            "id": row["id"],
            "role": "student",
            "name": row["full_name"],
            "name_ru": row["name_ru"],
            "class": row["class_name"],
        }
    return {
        "id": row["id"],
        "role": "teacher",
        "name": row["full_name"],
        "name_ru": row["name_ru"],
        "position": row["position"],
        "subject": row["subject"],
        "email": row["email"],
    }


def search_people(query: str = "", role: str = "any") -> dict:
    """Ищет учеников и учителей по имени, фамилии, классу или предмету."""
    ensure_db()
    needle = _normalize(query)
    if not needle:
        return {"found": False, "note": "Уточните имя, фамилию или класс."}
    role = (role or "any").lower()
    if role not in ("any", "student", "teacher"):
        role = "any"

    results: list[dict] = []
    with _connect() as connection:
        if role in ("any", "student"):
            for row in connection.execute(
                "SELECT * FROM students ORDER BY class_name, full_name"
            ):
                haystack = _normalize(
                    f"{row['full_name']} {row['name_ru']} {row['class_name']}"
                )
                if needle in haystack:
                    results.append(_person_row(row, "student"))
        if role in ("any", "teacher"):
            for row in connection.execute(
                "SELECT * FROM teachers ORDER BY full_name"
            ):
                haystack = _normalize(
                    f"{row['full_name']} {row['name_ru']} {row['subject']} {row['position']}"
                )
                if needle in haystack:
                    results.append(_person_row(row, "teacher"))

    if not results:
        return {
            "found": False,
            "note": "Никого не нашёл. Проверьте имя или уточните, ученик это или учитель.",
        }
    payload = {
        "found": True,
        "count": len(results),
        "results": results[:12],
    }
    if len(results) > 1:
        payload["note"] = "Нашлось несколько человек — уточните полное имя или класс."
    return payload


def get_student_grades(student: str = "", student_id: int | None = None) -> dict:
    """Оценки ученика по имени или id. При неоднозначности просит уточнить."""
    ensure_db()
    row = None
    with _connect() as connection:
        if student_id is not None:
            row = connection.execute(
                "SELECT * FROM students WHERE id = ?", (int(student_id),)
            ).fetchone()
        else:
            needle = _normalize(student)
            if not needle:
                return {"found": False, "note": "Назовите имя и фамилию ученика."}
            matches = [
                candidate
                for candidate in connection.execute("SELECT * FROM students")
                if needle
                in _normalize(
                    f"{candidate['full_name']} {candidate['name_ru']} "
                    f"{candidate['class_name']}"
                )
            ]
            if not matches:
                return {
                    "found": False,
                    "note": "Ученик не найден. Уточните имя, фамилию и класс.",
                }
            if len(matches) > 1:
                return {
                    "found": False,
                    "ambiguous": True,
                    "candidates": [_person_row(item, "student") for item in matches],
                    "note": "Несколько учеников подходят. Уточните класс или полное имя.",
                }
            row = matches[0]

        if row is None:
            return {"found": False, "note": "Ученик не найден."}

        grades = [
            {
                "subject": item["subject"],
                "term": item["term"],
                "grade": item["grade"],
            }
            for item in connection.execute(
                "SELECT subject, term, grade FROM grades "
                "WHERE student_id = ? ORDER BY subject, term",
                (row["id"],),
            )
        ]

    average = round(sum(g["grade"] for g in grades) / len(grades), 2) if grades else None
    return {
        "found": True,
        "student": {
            "id": row["id"],
            "name": row["full_name"],
            "name_ru": row["name_ru"],
            "class": row["class_name"],
        },
        "grades": grades,
        "average": average,
        "note": "Оценки за текущий учебный год: 5 — отлично, 4 — хорошо, 3 — удовлетворительно.",
    }


def reset_db() -> None:
    """Удаляет файл базы (для тестов и пересоздания демо-данных)."""
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
