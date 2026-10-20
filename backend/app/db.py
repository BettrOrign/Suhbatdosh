"""SQLite persistence layer for Suhbatdosh.

Wraps a per-thread SQLite connection (WAL mode) and exposes small, typed
helpers for users, sessions, clients and calls. All helpers write rows as
``dict`` and parse the JSON ``segments``/``analysis`` columns on read so the
rest of the app never touches raw SQL strings.
"""

import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from . import config

_local = threading.local()


def _conn() -> sqlite3.Connection:
    """Return the current thread's SQLite connection, creating it on first use.

    Connections are cached per-thread and configured for safe concurrent access
    (WAL journal, NORMAL sync, a 5s busy timeout, foreign keys enabled).
    """
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = sqlite3.connect(config.DB_PATH, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("PRAGMA foreign_keys=ON")
        _local.conn = conn
    return conn


@contextmanager
def get_db():
    """Yield the thread-local connection, committing on success or rolling back on error."""
    conn = _conn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def now() -> str:
    """Return the current UTC time as an ISO-8601 string (used for timestamps)."""
    return datetime.now(timezone.utc).isoformat()


def init_db():
    """Create tables, indexes and apply any schema migrations for an existing DB.

    Idempotent: safe to call on every startup. Adds the ``call_type``,
    ``user_id`` and ``client_id`` columns to ``calls`` if an older database is
    found, and creates lookup indexes for manager/client filtering.
    """
    with get_db() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'manager',
                active INTEGER NOT NULL DEFAULT 1,
                api_token TEXT UNIQUE,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS clients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                phone TEXT DEFAULT '',
                company TEXT DEFAULT '',
                email TEXT DEFAULT '',
                notes TEXT DEFAULT '',
                manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS calls (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'uploaded',
                audio_path TEXT,
                duration_sec REAL,
                language TEXT,
                transcript TEXT DEFAULT '',
                segments TEXT DEFAULT '[]',
                analysis TEXT DEFAULT '{}',
                call_type TEXT NOT NULL DEFAULT 'manager',
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                call_id INTEGER REFERENCES calls(id) ON DELETE SET NULL,
                type TEXT NOT NULL,
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                metadata TEXT DEFAULT '{}',
                read INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS telegram_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                telegram_id INTEGER NOT NULL UNIQUE,
                username TEXT,
                first_name TEXT,
                last_name TEXT,
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                color TEXT DEFAULT '#6366f1',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS call_tags (
                call_id INTEGER NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
                tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                PRIMARY KEY (call_id, tag_id)
            );

            CREATE TABLE IF NOT EXISTS youtube_whitelist (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                channel_id TEXT,
                channel_name TEXT,
                pattern TEXT,
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS bot_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            """
        )

        # --- migrations for existing databases ---
        cols = {r[1] for r in db.execute("PRAGMA table_info(calls)").fetchall()}
        if "call_type" not in cols:
            db.execute("ALTER TABLE calls ADD COLUMN call_type TEXT NOT NULL DEFAULT 'manager'")
        if "user_id" not in cols:
            db.execute("ALTER TABLE calls ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL")
        if "client_id" not in cols:
            db.execute("ALTER TABLE calls ADD COLUMN client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL")

        # --- migrations for source_type / source_meta ---
        if "source_type" not in cols:
            db.execute("ALTER TABLE calls ADD COLUMN source_type TEXT NOT NULL DEFAULT 'upload'")
        if "source_meta" not in cols:
            db.execute("ALTER TABLE calls ADD COLUMN source_meta TEXT DEFAULT '{}'")

        db.execute(
            "CREATE INDEX IF NOT EXISTS idx_calls_user ON calls(user_id)"
        )
        db.execute(
            "CREATE INDEX IF NOT EXISTS idx_calls_client ON calls(client_id)"
        )
        db.execute(
            "CREATE INDEX IF NOT EXISTS idx_calls_source ON calls(source_type)"
        )
        db.execute(
            "CREATE INDEX IF NOT EXISTS idx_calls_created ON calls(created_at)"
        )
        db.execute(
            "CREATE INDEX IF NOT EXISTS idx_clients_manager ON clients(manager_id)"
        )
        db.execute(
            "CREATE INDEX IF NOT EXISTS idx_call_tags_call ON call_tags(call_id)"
        )
        db.execute(
            "CREATE INDEX IF NOT EXISTS idx_call_tags_tag ON call_tags(tag_id)"
        )


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


def create_user(name: str, email: str, password_hash: str, role: str = "manager") -> int:
    """Insert a user with a freshly generated API token and return the new row id."""
    from .auth import generate_api_token
    ts = now()
    api_token = generate_api_token()
    with get_db() as db:
        cur = db.execute(
            "INSERT INTO users (name, email, password_hash, role, api_token, created_at) VALUES (?,?,?,?,?,?)",
            (name, email, password_hash, role, api_token, ts),
        )
        return cur.lastrowid


def get_user_by_email(email: str) -> dict | None:
    """Return the user row matching ``email``, or ``None`` if not found."""
    with get_db() as db:
        row = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        return dict(row) if row else None


def get_user(user_id: int) -> dict | None:
    """Return the user row for ``user_id``, or ``None`` if not found."""
    with get_db() as db:
        row = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None


def get_user_by_token(token: str) -> dict | None:
    """Return the user row matching an API token, or ``None`` if not found."""
    with get_db() as db:
        row = db.execute("SELECT * FROM users WHERE api_token = ?", (token,)).fetchone()
        return dict(row) if row else None


def list_users() -> list[dict]:
    """Return all users ordered by id (used by the admin users view)."""
    with get_db() as db:
        rows = db.execute("SELECT * FROM users ORDER BY id").fetchall()
        return [dict(r) for r in rows]


def list_users_by_role(role: str) -> list[dict]:
    """Return lightweight ``(id, name, email)`` records for active users of a role (e.g. managers)."""
    with get_db() as conn:
        rows = conn.execute("SELECT id, name, email FROM users WHERE role = ? AND active = 1", (role,)).fetchall()
        return [dict(r) for r in rows]


def list_managers_with_stats() -> list[dict]:
    """Return active managers with aggregated call stats.

    Computes, per manager: total calls, average overall score, average
    representative talk ratio, most recent score and last call timestamp — all
    scoped to ``call_type = 'manager'`` calls. Scores/talk ratios are rounded
    for display.
    """
    sql = (
        "SELECT u.id, u.name, u.email, u.role, u.active, u.created_at, u.api_token, "
        "COUNT(c.id) AS total_calls, "
        "AVG(CASE WHEN c.status = 'done' THEN json_extract(c.analysis, '$.scorecard.overall') END) AS avg_score, "
        "AVG(CASE WHEN c.status = 'done' THEN json_extract(c.analysis, '$.rep_share_of_talk') END) AS avg_talk_ratio, "
        "MAX(CASE WHEN c.status = 'done' THEN json_extract(c.analysis, '$.scorecard.overall') END) AS last_score, "
        "MAX(c.created_at) AS last_call_at "
        "FROM users u "
        "LEFT JOIN calls c ON c.user_id = u.id AND c.call_type = 'manager' "
        "WHERE u.role = 'manager' AND u.active = 1 "
        "GROUP BY u.id "
        "ORDER BY u.id"
    )
    with get_db() as conn:
        rows = conn.execute(sql).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            for k in ("avg_score", "last_score"):
                d[k] = round(d[k]) if d[k] is not None else None
            d["avg_talk_ratio"] = round(d["avg_talk_ratio"], 3) if d["avg_talk_ratio"] is not None else None
            out.append(d)
        return out


def list_active_managers() -> list[dict]:
    """Id + name of active users with the ``manager`` role.

    Narrow projection for the client form's manager picker, which receptionists
    need but cannot get from ``GET /api/users`` (admin/yonalish only). Exposes
    no email, no role fan-out and no API token.
    """
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, name FROM users WHERE role = 'manager' AND active = 1 ORDER BY name"
        ).fetchall()
        return [dict(r) for r in rows]


def list_manager_calls(manager_id: int) -> list[dict]:
    """Return all ``call_type = 'manager'`` calls owned by ``manager_id``, newest first, with joined names."""
    sql = (
        "SELECT c.*, u.name AS uploader_name, cl.name AS client_name "
        "FROM calls c "
        "LEFT JOIN users u ON u.id = c.user_id "
        "LEFT JOIN clients cl ON cl.id = c.client_id "
        "WHERE c.user_id = ? AND c.call_type = 'manager' "
        "ORDER BY c.created_at DESC"
    )
    with get_db() as conn:
        rows = conn.execute(sql, (manager_id,)).fetchall()
        return [_row_to_call(r) for r in rows]


def update_user(user_id: int, **fields):
    """Update arbitrary columns on a user. No-op when ``fields`` is empty."""
    if not fields:
        return
    cols = ", ".join(f"{k} = ?" for k in fields)
    vals = list(fields.values())
    with get_db() as db:
        db.execute(f"UPDATE users SET {cols} WHERE id = ?", (*vals, user_id))


def delete_user(user_id: int):
    """Delete a user row (sessions cascade; owned calls/clients are set NULL)."""
    with get_db() as db:
        db.execute("DELETE FROM users WHERE id = ?", (user_id,))


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------


def create_session(token: str, user_id: int, expires_at: str) -> None:
    """Persist a new login session token for ``user_id`` with an ISO expiry timestamp."""
    with get_db() as db:
        db.execute(
            "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)",
            (token, user_id, now(), expires_at),
        )


def get_session(token: str) -> dict | None:
    """Return the session joined with its user, or ``None`` for an unknown token."""
    with get_db() as db:
        row = db.execute(
            "SELECT s.*, u.name, u.email, u.role, u.active as user_active "
            "FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?",
            (token,),
        ).fetchone()
        return dict(row) if row else None


def delete_session(token: str):
    """Delete a single session token (e.g. on logout or expiry)."""
    with get_db() as db:
        db.execute("DELETE FROM sessions WHERE token = ?", (token,))


def delete_sessions_for_user(user_id: int):
    """Delete every session for a user (used when deactivating/deleting an account)."""
    with get_db() as db:
        db.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))


# ---------------------------------------------------------------------------
# Clients
# ---------------------------------------------------------------------------


def create_client(name: str, manager_id: int | None = None, **fields) -> int:
    """Insert a client (optionally owned by ``manager_id``) and return the new id."""
    ts = now()
    with get_db() as db:
        cur = db.execute(
            "INSERT INTO clients (name, phone, company, email, notes, manager_id, created_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (name, fields.get("phone", ""), fields.get("company", ""), fields.get("email", ""),
             fields.get("notes", ""), manager_id, ts),
        )
        return cur.lastrowid


def get_client(client_id: int) -> dict | None:
    """Return a client with its manager's name, or ``None`` if not found."""
    with get_db() as db:
        row = db.execute(
            "SELECT c.*, u.name AS manager_name FROM clients c "
            "LEFT JOIN users u ON u.id = c.manager_id WHERE c.id = ?",
            (client_id,),
        ).fetchone()
        return dict(row) if row else None


def list_clients(manager_id: int | None = None) -> list[dict]:
    """Return clients, optionally scoped to a manager (plus unassigned), with a call count each."""
    sql = (
        "SELECT c.*, u.name AS manager_name, "
        "(SELECT COUNT(*) FROM calls WHERE client_id = c.id) AS call_count "
        "FROM clients c LEFT JOIN users u ON u.id = c.manager_id "
    )
    params: tuple = ()
    if manager_id is not None:
        sql += "WHERE c.manager_id = ? OR c.manager_id IS NULL"
        params = (manager_id,)
    sql += " ORDER BY c.created_at DESC"
    with get_db() as db:
        rows = db.execute(sql, params).fetchall()
        return [dict(r) for r in rows]


def update_client(client_id: int, **fields):
    """Update arbitrary columns on a client. No-op when ``fields`` is empty."""
    if not fields:
        return
    cols = ", ".join(f"{k} = ?" for k in fields)
    vals = list(fields.values())
    with get_db() as db:
        db.execute(f"UPDATE clients SET {cols} WHERE id = ?", (*vals, client_id))


def delete_client(client_id: int):
    """Delete a client row."""
    with get_db() as db:
        db.execute("DELETE FROM clients WHERE id = ?", (client_id,))


# ---------------------------------------------------------------------------
# Calls
# ---------------------------------------------------------------------------


def create_call(
    name: str,
    audio_path: str,
    duration_sec: float | None = None,
    call_type: str = "manager",
    user_id: int | None = None,
    client_id: int | None = None,
    source_type: str = "upload",
    source_meta: dict | None = None,
) -> int:
    """Insert a new call row in ``'uploaded'`` status and return its id."""
    ts = now()
    with get_db() as db:
        cur = db.execute(
            "INSERT INTO calls (name, status, audio_path, duration_sec, call_type, user_id, client_id, source_type, source_meta, created_at, updated_at) "
            "VALUES (?, 'uploaded', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (name, audio_path, duration_sec, call_type, user_id, client_id,
             source_type, json.dumps(source_meta or {}), ts, ts),
        )
        return cur.lastrowid


def _row_to_call(d: dict) -> dict:
    """Convert a raw calls row into a dict with parsed JSON columns."""
    d = dict(d)
    d["segments"] = json.loads(d["segments"] or "[]")
    d["analysis"] = json.loads(d["analysis"] or "{}")
    d["source_meta"] = json.loads(d.get("source_meta") or "{}")
    return d


def get_call(call_id: int) -> dict | None:
    """Return a single call with joined uploader/client names and parsed JSON, or ``None``."""
    with get_db() as db:
        row = db.execute(
            "SELECT c.*, u.name AS uploader_name, cl.name AS client_name "
            "FROM calls c "
            "LEFT JOIN users u ON u.id = c.user_id "
            "LEFT JOIN clients cl ON cl.id = c.client_id "
            "WHERE c.id = ?",
            (call_id,),
        ).fetchone()
        if row is None:
            return None
        return _row_to_call(row)


def list_calls(
    role: str | None = None,
    user_id: int | None = None,
    call_type: str | None = None,
    source_type: str | None = None,
    search: str | None = None,
    limit: int | None = None,
    offset: int = 0,
) -> list[dict]:
    """Return calls newest-first, optionally filtered by various fields, with joined names."""
    sql = (
        "SELECT c.*, u.name AS uploader_name, cl.name AS client_name "
        "FROM calls c "
        "LEFT JOIN users u ON u.id = c.user_id "
        "LEFT JOIN clients cl ON cl.id = c.client_id "
    )
    where: list[str] = []
    params: list = []
    if user_id is not None:
        where.append("(c.user_id = ? OR c.user_id IS NULL)")
        params.append(user_id)
    if call_type:
        where.append("c.call_type = ?")
        params.append(call_type)
    if source_type:
        where.append("c.source_type = ?")
        params.append(source_type)
    if search:
        where.append("(c.name LIKE ? OR c.transcript LIKE ?)")
        params.extend([f"%{search}%", f"%{search}%"])
    if where:
        sql += "WHERE " + " AND ".join(where)
    sql += " ORDER BY c.created_at DESC"
    if limit is not None:
        sql += f" LIMIT ? OFFSET ?"
        params.extend([limit, offset])
    with get_db() as db:
        rows = db.execute(sql, params).fetchall()
        return [_row_to_call(r) for r in rows]


def update_call(call_id: int, **fields):
    """Update arbitrary columns on a call, always bumping ``updated_at``. No-op when ``fields`` is empty."""
    if not fields:
        return
    fields["updated_at"] = now()
    cols = ", ".join(f"{k} = ?" for k in fields)
    vals = list(fields.values())
    with get_db() as db:
        db.execute(f"UPDATE calls SET {cols} WHERE id = ?", (*vals, call_id))


def create_notification(user_id: int, type_: str, title: str, message: str, call_id: int | None = None, metadata: dict | None = None) -> int:
    """Create a notification for a user."""
    ts = now()
    with get_db() as db:
        cur = db.execute(
            "INSERT INTO notifications (user_id, call_id, type, title, message, metadata, read, created_at) VALUES (?,?,?,?,?,?,?,?)",
            (user_id, call_id, type_, title, message, json.dumps(metadata or {}), 0, ts),
        )
        return cur.lastrowid


def get_notifications(user_id: int, unread_only: bool = False, limit: int = 50) -> list[dict]:
    """Get notifications for a user, newest first."""
    sql = "SELECT * FROM notifications WHERE user_id = ?"
    params = [user_id]
    if unread_only:
        sql += " AND read = 0"
    sql += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)
    with get_db() as db:
        rows = db.execute(sql, params).fetchall()
        return [dict(r) for r in rows]


def mark_notification_read(notification_id: int, user_id: int) -> None:
    """Mark a notification as read."""
    with get_db() as db:
        db.execute("UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?", (notification_id, user_id))


def mark_all_notifications_read(user_id: int) -> None:
    """Mark all notifications as read for a user."""
    with get_db() as db:
        db.execute("UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0", (user_id,))


def get_unread_count(user_id: int) -> int:
    """Get unread notification count for a user."""
    with get_db() as db:
        row = db.execute("SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read = 0", (user_id,)).fetchone()
        return row[0] if row else 0


def add_telegram_user(user_id: int | None, telegram_id: int, username: str | None = None, first_name: str | None = None, last_name: str | None = None) -> int:
    """Add or update a telegram user link."""
    ts = now()
    with get_db() as db:
        existing = db.execute("SELECT id FROM telegram_users WHERE telegram_id = ?", (telegram_id,)).fetchone()
        if existing:
            db.execute(
                "UPDATE telegram_users SET user_id = ?, username = ?, first_name = ?, last_name = ?, active = 1 WHERE telegram_id = ?",
                (user_id, username, first_name, last_name, telegram_id),
            )
            return existing["id"]
        cur = db.execute(
            "INSERT INTO telegram_users (user_id, telegram_id, username, first_name, last_name, active, created_at) VALUES (?,?,?,?,?,?,?)",
            (user_id, telegram_id, username, first_name, last_name, 1, ts),
        )
        return cur.lastrowid


def get_telegram_users() -> list[dict]:
    """Get all active telegram users with their user info."""
    with get_db() as db:
        rows = db.execute(
            "SELECT tu.*, u.name, u.email, u.role FROM telegram_users tu JOIN users u ON u.id = tu.user_id WHERE tu.active = 1"
        ).fetchall()
        return [dict(r) for r in rows]


def get_org_stats() -> dict:
    """Get global organization statistics for daily reports."""
    with get_db() as db:
        total_calls = db.execute("SELECT COUNT(*) FROM calls").fetchone()[0]
        done_calls = db.execute("SELECT COUNT(*) FROM calls WHERE status = 'done'").fetchone()[0]
        error_calls = db.execute("SELECT COUNT(*) FROM calls WHERE status = 'error'").fetchone()[0]
        processing_calls = db.execute("SELECT COUNT(*) FROM calls WHERE status IN ('queued', 'transcribing', 'transcribed', 'analyzing')").fetchone()[0]

        avg_score_row = db.execute(
            "SELECT AVG(json_extract(analysis, '$.scorecard.overall')) FROM calls WHERE status = 'done' AND json_extract(analysis, '$.scorecard.overall') IS NOT NULL"
        ).fetchone()
        avg_score = round(avg_score_row[0]) if avg_score_row and avg_score_row[0] is not None else None

        total_managers = db.execute("SELECT COUNT(*) FROM users WHERE role = 'manager' AND active = 1").fetchone()[0]
        total_clients = db.execute("SELECT COUNT(*) FROM clients").fetchone()[0]

        top_managers = db.execute(
            """
            SELECT u.name, u.email, COUNT(c.id) as call_count,
                   AVG(CASE WHEN c.status = 'done' THEN json_extract(c.analysis, '$.scorecard.overall') END) as avg_score
            FROM users u
            LEFT JOIN calls c ON c.user_id = u.id AND c.call_type = 'manager'
            WHERE u.role = 'manager' AND u.active = 1
            GROUP BY u.id
            HAVING call_count > 0
            ORDER BY avg_score DESC NULLS LAST
            LIMIT 5
            """
        ).fetchall()

        calls_today = db.execute(
            "SELECT COUNT(*) FROM calls WHERE date(created_at) = date('now')"
        ).fetchone()[0]

        return {
            "total_calls": total_calls,
            "done_calls": done_calls,
            "error_calls": error_calls,
            "processing_calls": processing_calls,
            "avg_score": avg_score,
            "total_managers": total_managers,
            "total_clients": total_clients,
            "calls_today": calls_today,
            "top_managers": [dict(r) for r in top_managers],
        }


# ---------------------------------------------------------------------------
# Tags
# ---------------------------------------------------------------------------


def create_tag(name: str, color: str = "#6366f1") -> int:
    ts = now()
    with get_db() as db:
        cur = db.execute(
            "INSERT INTO tags (name, color, created_at) VALUES (?, ?, ?)",
            (name, color, ts),
        )
        return cur.lastrowid


def list_tags() -> list[dict]:
    with get_db() as db:
        rows = db.execute("SELECT * FROM tags ORDER BY name").fetchall()
        return [dict(r) for r in rows]


def delete_tag(tag_id: int):
    with get_db() as db:
        db.execute("DELETE FROM tags WHERE id = ?", (tag_id,))


def tag_call(call_id: int, tag_id: int):
    with get_db() as db:
        db.execute(
            "INSERT OR IGNORE INTO call_tags (call_id, tag_id) VALUES (?, ?)",
            (call_id, tag_id),
        )


def untag_call(call_id: int, tag_id: int):
    with get_db() as db:
        db.execute(
            "DELETE FROM call_tags WHERE call_id = ? AND tag_id = ?",
            (call_id, tag_id),
        )


def get_call_tags(call_id: int) -> list[dict]:
    with get_db() as db:
        rows = db.execute(
            "SELECT t.* FROM tags t JOIN call_tags ct ON ct.tag_id = t.id WHERE ct.call_id = ?",
            (call_id,),
        ).fetchall()
        return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# YouTube Whitelist
# ---------------------------------------------------------------------------


def add_youtube_whitelist(channel_id: str | None = None, channel_name: str | None = None, pattern: str | None = None) -> int:
    ts = now()
    with get_db() as db:
        cur = db.execute(
            "INSERT INTO youtube_whitelist (channel_id, channel_name, pattern, created_at) VALUES (?, ?, ?, ?)",
            (channel_id, channel_name, pattern, ts),
        )
        return cur.lastrowid


def list_youtube_whitelist() -> list[dict]:
    with get_db() as db:
        rows = db.execute("SELECT * FROM youtube_whitelist ORDER BY id").fetchall()
        return [dict(r) for r in rows]


def remove_youtube_whitelist(entry_id: int):
    with get_db() as db:
        db.execute("DELETE FROM youtube_whitelist WHERE id = ?", (entry_id,))


def is_youtube_allowed(channel_id: str | None = None, url: str | None = None) -> bool:
    with get_db() as db:
        count = db.execute("SELECT COUNT(*) FROM youtube_whitelist WHERE active = 1").fetchone()[0]
        if count == 0:
            return True
        if channel_id:
            row = db.execute(
                "SELECT id FROM youtube_whitelist WHERE active = 1 AND channel_id = ?",
                (channel_id,),
            ).fetchone()
            if row:
                return True
        if url:
            row = db.execute(
                "SELECT id FROM youtube_whitelist WHERE active = 1 AND ? LIKE pattern",
                (url,),
            ).fetchone()
            if row:
                return True
        return False


# ---------------------------------------------------------------------------
# Bot Settings
# ---------------------------------------------------------------------------


def set_bot_setting(key: str, value: str):
    ts = now()
    with get_db() as db:
        db.execute(
            "INSERT INTO bot_settings (key, value, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            (key, value, ts),
        )


def get_bot_setting(key: str, default: str = "") -> str:
    with get_db() as db:
        row = db.execute("SELECT value FROM bot_settings WHERE key = ?", (key,)).fetchone()
        return row[0] if row else default


def get_bot_setting_row(key: str) -> dict | None:
    """Return ``{"key","value","updated_at"}`` for a bot_settings row, or ``None``."""
    with get_db() as db:
        row = db.execute(
            "SELECT key, value, updated_at FROM bot_settings WHERE key = ?", (key,)
        ).fetchone()
        return dict(row) if row else None


# ---------------------------------------------------------------------------
# Advanced Analytics
# ---------------------------------------------------------------------------


def get_day_over_day_stats() -> dict:
    """Compare today vs yesterday metrics."""
    with get_db() as db:
        today = db.execute("SELECT date('now')").fetchone()[0]
        yesterday = db.execute("SELECT date('now', '-1 day')").fetchone()[0]

        def _day_stats(date_str: str) -> dict:
            calls = db.execute(
                "SELECT COUNT(*) FROM calls WHERE date(created_at) = ?", (date_str,)
            ).fetchone()[0]
            done = db.execute(
                "SELECT COUNT(*) FROM calls WHERE date(created_at) = ? AND status = 'done'", (date_str,)
            ).fetchone()[0]
            avg_score_row = db.execute(
                "SELECT AVG(json_extract(analysis, '$.scorecard.overall')) "
                "FROM calls WHERE date(created_at) = ? AND status = 'done' "
                "AND json_extract(analysis, '$.scorecard.overall') IS NOT NULL",
                (date_str,),
            ).fetchone()
            avg_score = round(avg_score_row[0]) if avg_score_row and avg_score_row[0] is not None else None
            avg_duration_row = db.execute(
                "SELECT AVG(duration_sec) FROM calls WHERE date(created_at) = ? AND status = 'done'",
                (date_str,),
            ).fetchone()
            avg_duration = round(avg_duration_row[0]) if avg_duration_row and avg_duration_row[0] is not None else None
            avg_talk_row = db.execute(
                "SELECT AVG(json_extract(analysis, '$.rep_share_of_talk')) "
                "FROM calls WHERE date(created_at) = ? AND status = 'done' "
                "AND json_extract(analysis, '$.rep_share_of_talk') IS NOT NULL",
                (date_str,),
            ).fetchone()
            avg_talk = round(avg_talk_row[0], 2) if avg_talk_row and avg_talk_row[0] is not None else None
            return {
                "calls": calls, "done": done, "avg_score": avg_score,
                "avg_duration": avg_duration, "avg_talk_ratio": avg_talk,
            }

        return {
            "today": _day_stats(today),
            "yesterday": _day_stats(yesterday),
            "date_today": today,
            "date_yesterday": yesterday,
        }


def get_weekly_trend() -> list[dict]:
    """Get per-day stats for the last 7 days."""
    with get_db() as db:
        rows = db.execute(
            """
            SELECT date(created_at) as day,
                   COUNT(*) as total_calls,
                   SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done_calls,
                   AVG(CASE WHEN status = 'done' THEN json_extract(analysis, '$.scorecard.overall') END) as avg_score,
                   AVG(CASE WHEN status = 'done' THEN duration_sec END) as avg_duration
            FROM calls
            WHERE created_at >= date('now', '-7 days')
            GROUP BY date(created_at)
            ORDER BY day
            """
        ).fetchall()
        return [
            {
                "day": r[0], "total_calls": r[1], "done_calls": r[2],
                "avg_score": round(r[3]) if r[3] is not None else None,
                "avg_duration": round(r[4]) if r[4] is not None else None,
            }
            for r in rows
        ]


def get_monthly_trend() -> list[dict]:
    """Get per-week stats for the last 4 weeks."""
    with get_db() as db:
        rows = db.execute(
            """
            SELECT strftime('%Y-W%W', created_at) as week,
                   COUNT(*) as total_calls,
                   SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done_calls,
                   AVG(CASE WHEN status = 'done' THEN json_extract(analysis, '$.scorecard.overall') END) as avg_score
            FROM calls
            WHERE created_at >= date('now', '-28 days')
            GROUP BY strftime('%Y-W%W', created_at)
            ORDER BY week
            """
        ).fetchall()
        return [
            {
                "week": r[0], "total_calls": r[1], "done_calls": r[2],
                "avg_score": round(r[3]) if r[3] is not None else None,
            }
            for r in rows
        ]


def get_problem_calls(limit: int = 10) -> list[dict]:
    """Find calls with issues: low sentiment, negative analysis, long duration anomalies."""
    with get_db() as db:
        rows = db.execute(
            """
            SELECT c.id, c.name, c.duration_sec, c.source_type, c.created_at,
                   json_extract(c.analysis, '$.scorecard.overall') as score,
                   json_extract(c.analysis, '$.outcome') as outcome,
                   json_extract(c.analysis, '$.summary') as summary,
                   u.name as uploader_name
            FROM calls c
            LEFT JOIN users u ON u.id = c.user_id
            WHERE c.status = 'done'
              AND json_extract(c.analysis, '$.scorecard.overall') IS NOT NULL
              AND json_extract(c.analysis, '$.scorecard.overall') < 50
            ORDER BY json_extract(c.analysis, '$.scorecard.overall') ASC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [
            {
                "id": r[0], "name": r[1], "duration_sec": r[2],
                "source_type": r[3], "created_at": r[4],
                "score": round(r[5]) if r[5] is not None else None,
                "outcome": r[6], "summary": r[7], "uploader_name": r[8],
            }
            for r in rows
        ]


def get_manager_rankings(limit: int = 20) -> list[dict]:
    """Full performance rankings with trend indicators (managers + xodimlar).

    Includes ``manager`` and ``yonalish`` roles so the Xodimlar card never
    stays empty. Also counts solved vs unsolved problem calls per user:
    solved = score < 50 and analysis mentions "hal qilindi".
    """
    with get_db() as db:
        rows = db.execute(
            """
            SELECT u.id, u.name, u.email, u.role,
                   COUNT(c.id) as total_calls,
                   AVG(CASE WHEN c.status = 'done' THEN json_extract(c.analysis, '$.scorecard.overall') END) as avg_score,
                   AVG(CASE WHEN c.status = 'done' THEN json_extract(c.analysis, '$.rep_share_of_talk') END) as avg_talk,
                   SUM(CASE WHEN date(c.created_at) = date('now') THEN 1 ELSE 0 END) as calls_today,
                   SUM(CASE WHEN date(c.created_at) = date('now', '-1 day') THEN 1 ELSE 0 END) as calls_yesterday,
                   MAX(CASE WHEN c.status = 'done' THEN json_extract(c.analysis, '$.scorecard.overall') END) as best_score,
                   SUM(CASE WHEN c.status = 'done'
                             AND json_extract(c.analysis, '$.scorecard.overall') < 50
                             AND lower(coalesce(c.analysis, '')) LIKE '%hal qilindi%' THEN 1 ELSE 0 END) as solved_problems,
                   SUM(CASE WHEN c.status = 'done'
                             AND json_extract(c.analysis, '$.scorecard.overall') < 50
                             AND lower(coalesce(c.analysis, '')) NOT LIKE '%hal qilindi%' THEN 1 ELSE 0 END) as unsolved_problems
            FROM users u
            LEFT JOIN calls c ON c.user_id = u.id AND c.call_type = 'manager'
            WHERE u.role IN ('manager', 'yonalish') AND u.active = 1
            GROUP BY u.id
            ORDER BY total_calls DESC, avg_score DESC NULLS LAST
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        result = []
        for r in rows:
            avg_score = round(r[5]) if r[5] is not None else None
            calls_today = r[7] or 0
            calls_yesterday = r[8] or 0
            trend = "up" if calls_today > calls_yesterday else ("down" if calls_today < calls_yesterday else "same")
            result.append({
                "id": r[0], "name": r[1], "email": r[2], "role": r[3],
                "total_calls": r[4], "avg_score": avg_score,
                "avg_talk_ratio": round(r[6], 3) if r[6] is not None else None,
                "calls_today": calls_today, "calls_yesterday": calls_yesterday,
                "trend": trend, "best_score": round(r[9]) if r[9] is not None else None,
                "solved_problems": r[10] or 0, "unsolved_problems": r[11] or 0,
            })
        return result


def get_source_breakdown() -> dict:
    """Get call counts by source_type."""
    with get_db() as db:
        rows = db.execute(
            "SELECT source_type, COUNT(*) FROM calls GROUP BY source_type"
        ).fetchall()
        return {r[0]: r[1] for r in rows}
