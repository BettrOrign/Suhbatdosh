"""SQLite persistence layer for Suhbatdosh.

Wraps a per-thread SQLite connection (WAL mode) and exposes small, typed
helpers for users, sessions, clients and calls. All helpers write rows as
``dict`` and parse the JSON ``segments``/``analysis`` columns on read so the
rest of the app never touches raw SQL strings.
"""

import hashlib
import json
import re
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import config

_local = threading.local()


def _hash_token(raw_token: str) -> str:
    """Return the SHA-256 hex digest of a raw session/invite token."""
    return hashlib.sha256((raw_token or "").encode("utf-8")).hexdigest()


def _slugify(name: str) -> str:
    """Create a URL-safe lowercase slug from an organization name."""
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").strip().lower()).strip("-")
    return s or "org"


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


def _resolve_org_id(conn: sqlite3.Connection, org_id: int | None, user_id: int | None = None) -> int:
    """Resolve an organization ID, inheriting from ``user_id`` when ``org_id`` is omitted."""
    if org_id is not None:
        return int(org_id)
    if user_id is not None:
        row = conn.execute("SELECT org_id FROM users WHERE id = ?", (user_id,)).fetchone()
        if row and row["org_id"]:
            return int(row["org_id"])
    return 1


def init_db():
    """Create tables, indexes and apply any schema migrations for an existing DB.

    Idempotent: safe to call on every startup.
    """
    with get_db() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS organizations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                slug TEXT NOT NULL UNIQUE,
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS org_settings (
                org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (org_id, key)
            );

            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                org_id INTEGER NOT NULL DEFAULT 1,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'manager',
                active INTEGER NOT NULL DEFAULT 1,
                api_token TEXT UNIQUE,
                sip_extension TEXT DEFAULT '',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS invites (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                email TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'manager',
                token_hash TEXT NOT NULL UNIQUE,
                raw_token TEXT DEFAULT '',
                created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                expires_at TEXT NOT NULL,
                used_at TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS login_attempts (
                key TEXT PRIMARY KEY,
                fails INTEGER NOT NULL DEFAULT 0,
                first_fail_at TEXT NOT NULL,
                locked_until TEXT
            );

            CREATE TABLE IF NOT EXISTS clients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                org_id INTEGER NOT NULL DEFAULT 1,
                name TEXT NOT NULL,
                phone TEXT DEFAULT '',
                company TEXT DEFAULT '',
                email TEXT DEFAULT '',
                notes TEXT DEFAULT '',
                manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token TEXT NOT NULL UNIQUE,
                csrf_hash TEXT NOT NULL DEFAULT '',
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                user_agent TEXT DEFAULT '',
                ip TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS calls (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                org_id INTEGER NOT NULL DEFAULT 1,
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
                org_id INTEGER NOT NULL DEFAULT 1,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                telegram_id INTEGER NOT NULL UNIQUE,
                username TEXT,
                first_name TEXT,
                last_name TEXT,
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS telegram_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                org_id INTEGER NOT NULL DEFAULT 1,
                chat_id INTEGER NOT NULL,
                message_id INTEGER NOT NULL,
                user_id INTEGER,
                username TEXT,
                full_name TEXT,
                photo_url TEXT,
                text TEXT,
                is_bot INTEGER NOT NULL DEFAULT 0,
                is_staff INTEGER NOT NULL DEFAULT 0,
                topic TEXT,
                reply_text TEXT,
                replied_at TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(chat_id, message_id)
            );

            CREATE TABLE IF NOT EXISTS tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                org_id INTEGER NOT NULL DEFAULT 1,
                name TEXT NOT NULL,
                color TEXT DEFAULT '#6366f1',
                created_at TEXT NOT NULL,
                UNIQUE(org_id, name)
            );

            CREATE TABLE IF NOT EXISTS call_tags (
                call_id INTEGER NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
                tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                PRIMARY KEY (call_id, tag_id)
            );

            CREATE TABLE IF NOT EXISTS youtube_whitelist (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                org_id INTEGER NOT NULL DEFAULT 1,
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

        # Ensure default organization #1 exists
        db.execute(
            "INSERT OR IGNORE INTO organizations (id, name, slug, active, created_at) VALUES (1, ?, ?, 1, ?)",
            (config.DEFAULT_ORG_NAME, config.DEFAULT_ORG_SLUG, now()),
        )

        # --- migrations for sessions table if upgrading from old schema ---
        sess_cols = {r[1] for r in db.execute("PRAGMA table_info(sessions)").fetchall()}
        if "csrf_hash" not in sess_cols:
            db.execute("DROP TABLE sessions")
            db.execute(
                """
                CREATE TABLE sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    token TEXT NOT NULL UNIQUE,
                    csrf_hash TEXT NOT NULL DEFAULT '',
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    user_agent TEXT DEFAULT '',
                    ip TEXT DEFAULT '',
                    created_at TEXT NOT NULL,
                    last_seen_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL
                )
                """
            )

        # --- migrations for existing databases ---
        cols = {r[1] for r in db.execute("PRAGMA table_info(calls)").fetchall()}
        if "org_id" not in cols:
            db.execute("ALTER TABLE calls ADD COLUMN org_id INTEGER NOT NULL DEFAULT 1")
        if "call_type" not in cols:
            db.execute("ALTER TABLE calls ADD COLUMN call_type TEXT NOT NULL DEFAULT 'manager'")
        if "user_id" not in cols:
            db.execute("ALTER TABLE calls ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL")
        if "client_id" not in cols:
            db.execute("ALTER TABLE calls ADD COLUMN client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL")
        if "source_type" not in cols:
            db.execute("ALTER TABLE calls ADD COLUMN source_type TEXT NOT NULL DEFAULT 'upload'")
        if "source_meta" not in cols:
            db.execute("ALTER TABLE calls ADD COLUMN source_meta TEXT DEFAULT '{}'")
        if "resolved" not in cols:
            db.execute("ALTER TABLE calls ADD COLUMN resolved INTEGER NOT NULL DEFAULT 0")
        if "bookmarked" not in cols:
            db.execute("ALTER TABLE calls ADD COLUMN bookmarked INTEGER NOT NULL DEFAULT 0")
        if "bookmark_note" not in cols:
            db.execute("ALTER TABLE calls ADD COLUMN bookmark_note TEXT DEFAULT ''")

        user_cols = {r[1] for r in db.execute("PRAGMA table_info(users)").fetchall()}
        if "org_id" not in user_cols:
            db.execute("ALTER TABLE users ADD COLUMN org_id INTEGER NOT NULL DEFAULT 1")
        if "sip_extension" not in user_cols:
            db.execute("ALTER TABLE users ADD COLUMN sip_extension TEXT DEFAULT ''")

        for tbl in ("clients", "tags", "telegram_users", "telegram_messages", "youtube_whitelist"):
            tcols = {r[1] for r in db.execute(f"PRAGMA table_info({tbl})").fetchall()}
            if "org_id" not in tcols:
                db.execute(f"ALTER TABLE {tbl} ADD COLUMN org_id INTEGER NOT NULL DEFAULT 1")

        # Backfill org_settings for org #1 from bot_settings
        db.execute(
            "INSERT OR IGNORE INTO org_settings (org_id, key, value, updated_at) "
            "SELECT 1, key, value, updated_at FROM bot_settings"
        )

        db.execute("CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_calls_org ON calls(org_id)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_calls_user ON calls(user_id)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_calls_client ON calls(client_id)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_calls_source ON calls(source_type)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_calls_created ON calls(created_at)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_clients_org ON clients(org_id)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_clients_manager ON clients(manager_id)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_call_tags_call ON call_tags(call_id)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_call_tags_tag ON call_tags(tag_id)")


# ---------------------------------------------------------------------------
# Organizations & Invites & Login Rate Limiting
# ---------------------------------------------------------------------------


def create_organization(name: str, slug: str | None = None) -> dict:
    """Create a new organization with a unique slug and return its row dict."""
    ts = now()
    base = _slugify(slug or name)
    with get_db() as conn:
        candidate = base
        idx = 2
        while conn.execute("SELECT 1 FROM organizations WHERE slug = ?", (candidate,)).fetchone():
            candidate = f"{base}-{idx}"
            idx += 1
        cur = conn.execute(
            "INSERT INTO organizations (name, slug, active, created_at) VALUES (?, ?, 1, ?)",
            (name.strip(), candidate, ts),
        )
        org_id = cur.lastrowid
        return {"id": org_id, "name": name.strip(), "slug": candidate, "active": 1, "created_at": ts}


def get_organization(org_id: int) -> dict | None:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM organizations WHERE id = ?", (org_id,)).fetchone()
        return dict(row) if row else None


def get_organization_by_slug(slug: str) -> dict | None:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM organizations WHERE slug = ?", ((slug or "").strip().lower(),)).fetchone()
        return dict(row) if row else None


def create_invite(
    org_id: int,
    email: str,
    role: str,
    raw_token: str,
    created_by: int | None = None,
    ttl_days: int = 7,
) -> dict:
    """Create an invitation row and return its metadata (including raw token)."""
    ts = now()
    expires = (datetime.now(timezone.utc) + timedelta(days=ttl_days)).isoformat()
    token_hash = _hash_token(raw_token)
    clean_email = email.strip().lower()
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO invites (org_id, email, role, token_hash, raw_token, created_by, expires_at, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (org_id, clean_email, role, token_hash, raw_token, created_by, expires, ts),
        )
        return {
            "id": cur.lastrowid,
            "org_id": org_id,
            "email": clean_email,
            "role": role,
            "token": raw_token,
            "expires_at": expires,
            "created_at": ts,
        }


def get_invite_by_token(raw_token: str) -> dict | None:
    """Look up an invite by its raw token, joined with organization name and slug."""
    token_hash = _hash_token(raw_token)
    with get_db() as conn:
        row = conn.execute(
            "SELECT i.*, o.name AS org_name, o.slug AS org_slug "
            "FROM invites i JOIN organizations o ON o.id = i.org_id "
            "WHERE i.token_hash = ?",
            (token_hash,),
        ).fetchone()
        return dict(row) if row else None


def list_invites(org_id: int = 1) -> list[dict]:
    """List pending (unused, non-expired) invites for an organization."""
    ts = now()
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, org_id, email, role, raw_token AS token, expires_at, created_at "
            "FROM invites WHERE org_id = ? AND used_at IS NULL AND expires_at > ? "
            "ORDER BY id DESC",
            (org_id, ts),
        ).fetchall()
        return [dict(r) for r in rows]


def delete_invite(invite_id: int, org_id: int = 1) -> bool:
    with get_db() as conn:
        cur = conn.execute("DELETE FROM invites WHERE id = ? AND org_id = ?", (invite_id, org_id))
        return cur.rowcount > 0


def mark_invite_used(invite_id: int) -> None:
    with get_db() as conn:
        conn.execute("UPDATE invites SET used_at = ?, raw_token = '' WHERE id = ?", (now(), invite_id))


def get_login_attempt(key: str) -> dict | None:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM login_attempts WHERE key = ?", (key,)).fetchone()
        return dict(row) if row else None


def record_login_failure(key: str, max_fails: int, window_minutes: int, lockout_minutes: int) -> dict:
    """Increment failure counter for ``key`` and set ``locked_until`` when threshold is reached."""
    now_dt = datetime.now(timezone.utc)
    ts = now_dt.isoformat()
    with get_db() as conn:
        row = conn.execute("SELECT * FROM login_attempts WHERE key = ?", (key,)).fetchone()
        if row:
            first_dt = datetime.fromisoformat(row["first_fail_at"])
            if (now_dt - first_dt) > timedelta(minutes=window_minutes):
                fails = 1
                first_fail_at = ts
            else:
                fails = row["fails"] + 1
                first_fail_at = row["first_fail_at"]
        else:
            fails = 1
            first_fail_at = ts

        locked_until = None
        if fails >= max_fails:
            locked_until = (now_dt + timedelta(minutes=lockout_minutes)).isoformat()

        conn.execute(
            "INSERT INTO login_attempts (key, fails, first_fail_at, locked_until) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET fails = excluded.fails, first_fail_at = excluded.first_fail_at, locked_until = excluded.locked_until",
            (key, fails, first_fail_at, locked_until),
        )
        return {"key": key, "fails": fails, "locked_until": locked_until}


def clear_login_attempts(key: str) -> None:
    with get_db() as conn:
        conn.execute("DELETE FROM login_attempts WHERE key = ?", (key,))


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


def create_user(
    name: str,
    email: str,
    password_hash: str,
    role: str = "manager",
    sip_extension: str = "",
    org_id: int = 1,
) -> int:
    """Insert a user with a freshly generated API token and return the new row id."""
    from .auth import generate_api_token
    ts = now()
    api_token = generate_api_token()
    with get_db() as db:
        cur = db.execute(
            "INSERT INTO users (org_id, name, email, password_hash, role, api_token, sip_extension, created_at) VALUES (?,?,?,?,?,?,?,?)",
            (org_id, name, email, password_hash, role, api_token, sip_extension, ts),
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


def list_users(org_id: int | None = None) -> list[dict]:
    """Return all users ordered by id (scoped to ``org_id`` when provided)."""
    with get_db() as db:
        if org_id is not None:
            rows = db.execute("SELECT * FROM users WHERE org_id = ? ORDER BY id", (org_id,)).fetchall()
        else:
            rows = db.execute("SELECT * FROM users ORDER BY id").fetchall()
        return [dict(r) for r in rows]


def list_managers_with_stats(org_id: int = 1) -> list[dict]:
    """Return active managers with aggregated call stats scoped to ``org_id``."""
    sql = (
        "SELECT u.id, u.name, u.email, u.role, u.active, u.created_at, u.api_token, "
        "COUNT(c.id) AS total_calls, "
        "AVG(CASE WHEN c.status = 'done' THEN json_extract(c.analysis, '$.scorecard.overall') END) AS avg_score, "
        "AVG(CASE WHEN c.status = 'done' THEN json_extract(c.analysis, '$.rep_share_of_talk') END) AS avg_talk_ratio, "
        "MAX(CASE WHEN c.status = 'done' THEN json_extract(c.analysis, '$.scorecard.overall') END) AS last_score, "
        "MAX(c.created_at) AS last_call_at "
        "FROM users u "
        "LEFT JOIN calls c ON c.user_id = u.id AND c.call_type = 'manager' "
        "WHERE u.role = 'manager' AND u.active = 1 AND u.org_id = ? "
        "GROUP BY u.id "
        "ORDER BY u.id"
    )
    with get_db() as conn:
        rows = conn.execute(sql, (org_id,)).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            for k in ("avg_score", "last_score"):
                d[k] = round(d[k]) if d[k] is not None else None
            d["avg_talk_ratio"] = round(d["avg_talk_ratio"], 3) if d["avg_talk_ratio"] is not None else None
            out.append(d)
        return out


def list_active_managers(org_id: int = 1) -> list[dict]:
    """Id + name of active users with the ``manager`` role in ``org_id``."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, name FROM users WHERE role = 'manager' AND active = 1 AND org_id = ? ORDER BY name",
            (org_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def list_manager_calls(manager_id: int, org_id: int | None = None) -> list[dict]:
    """Return all ``call_type = 'manager'`` calls owned by ``manager_id``, newest first, with joined names."""
    sql = (
        "SELECT c.*, u.name AS uploader_name, cl.name AS client_name "
        "FROM calls c "
        "LEFT JOIN users u ON u.id = c.user_id "
        "LEFT JOIN clients cl ON cl.id = c.client_id "
        "WHERE c.user_id = ? AND c.call_type = 'manager' "
    )
    params: list = [manager_id]
    if org_id is not None:
        sql += "AND c.org_id = ? "
        params.append(org_id)
    sql += "ORDER BY c.created_at DESC"
    with get_db() as conn:
        rows = conn.execute(sql, params).fetchall()
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


def create_session(
    token: str,
    user_id: int,
    expires_at: str,
    csrf_hash: str = "",
    user_agent: str = "",
    ip: str = "",
) -> int:
    """Persist a new login session token (stored as SHA-256 hash) for ``user_id``."""
    ts = now()
    token_hash = _hash_token(token)
    with get_db() as db:
        cur = db.execute(
            "INSERT INTO sessions (token, csrf_hash, user_id, user_agent, ip, created_at, last_seen_at, expires_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (token_hash, csrf_hash, user_id, (user_agent or "")[:255], (ip or "")[:64], ts, ts, expires_at),
        )
        return cur.lastrowid


def get_session(token: str) -> dict | None:
    """Return the session joined with its user and organization, or ``None`` for an unknown token."""
    token_hash = _hash_token(token)
    with get_db() as db:
        row = db.execute(
            "SELECT s.*, u.name, u.email, u.role, u.org_id, u.active as user_active, "
            "o.name as org_name, o.slug as org_slug, o.active as org_active "
            "FROM sessions s "
            "JOIN users u ON u.id = s.user_id "
            "LEFT JOIN organizations o ON o.id = u.org_id "
            "WHERE s.token = ?",
            (token_hash,),
        ).fetchone()
        return dict(row) if row else None


def touch_session(session_id: int, new_expires_at: str) -> None:
    """Update last_seen_at and extend expiry for a sliding session."""
    with get_db() as db:
        db.execute(
            "UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?",
            (now(), new_expires_at, session_id),
        )


def list_sessions_for_user(user_id: int, current_token: str | None = None) -> list[dict]:
    """Return active sessions for ``user_id`` without exposing token hashes."""
    cur_hash = _hash_token(current_token) if current_token else None
    ts = now()
    with get_db() as db:
        rows = db.execute(
            "SELECT id, token, user_agent, ip, created_at, last_seen_at, expires_at "
            "FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC",
            (user_id, ts),
        ).fetchall()
        return [
            {
                "id": r["id"],
                "user_agent": r["user_agent"] or "",
                "ip": r["ip"] or "",
                "created_at": r["created_at"],
                "last_seen_at": r["last_seen_at"],
                "expires_at": r["expires_at"],
                "is_current": bool(cur_hash and r["token"] == cur_hash),
            }
            for r in rows
        ]


def delete_session(token: str):
    """Delete a single session token (e.g. on logout or expiry)."""
    token_hash = _hash_token(token)
    with get_db() as db:
        db.execute("DELETE FROM sessions WHERE token = ?", (token_hash,))


def delete_session_by_id(session_id: int, user_id: int) -> bool:
    """Delete a specific session belonging to ``user_id``."""
    with get_db() as db:
        cur = db.execute("DELETE FROM sessions WHERE id = ? AND user_id = ?", (session_id, user_id))
        return cur.rowcount > 0


def delete_sessions_for_user(user_id: int, keep_token: str | None = None):
    """Delete every session for a user (optionally keeping ``keep_token``)."""
    with get_db() as db:
        if keep_token:
            db.execute(
                "DELETE FROM sessions WHERE user_id = ? AND token != ?",
                (user_id, _hash_token(keep_token)),
            )
        else:
            db.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))


# ---------------------------------------------------------------------------
# Clients
# ---------------------------------------------------------------------------


def create_client(name: str, manager_id: int | None = None, org_id: int | None = None, **fields) -> int:
    """Insert a client (optionally owned by ``manager_id``) and return the new id."""
    ts = now()
    with get_db() as db:
        resolved_org = _resolve_org_id(db, org_id, manager_id)
        cur = db.execute(
            "INSERT INTO clients (org_id, name, phone, company, email, notes, manager_id, created_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (resolved_org, name, fields.get("phone", ""), fields.get("company", ""), fields.get("email", ""),
             fields.get("notes", ""), manager_id, ts),
        )
        return cur.lastrowid


def get_client(client_id: int, org_id: int | None = None) -> dict | None:
    """Return a client with its manager's name, or ``None`` if not found."""
    with get_db() as db:
        if org_id is not None:
            row = db.execute(
                "SELECT c.*, u.name AS manager_name FROM clients c "
                "LEFT JOIN users u ON u.id = c.manager_id WHERE c.id = ? AND c.org_id = ?",
                (client_id, org_id),
            ).fetchone()
        else:
            row = db.execute(
                "SELECT c.*, u.name AS manager_name FROM clients c "
                "LEFT JOIN users u ON u.id = c.manager_id WHERE c.id = ?",
                (client_id,),
            ).fetchone()
        return dict(row) if row else None


def list_clients(manager_id: int | None = None, org_id: int = 1) -> list[dict]:
    """Return clients in ``org_id``, optionally scoped to a manager (plus unassigned), with a call count each."""
    sql = (
        "SELECT c.*, u.name AS manager_name, "
        "(SELECT COUNT(*) FROM calls WHERE client_id = c.id) AS call_count "
        "FROM clients c LEFT JOIN users u ON u.id = c.manager_id "
        "WHERE c.org_id = ? "
    )
    params: list = [org_id]
    if manager_id is not None:
        sql += "AND (c.manager_id = ? OR c.manager_id IS NULL)"
        params.append(manager_id)
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
    org_id: int | None = None,
) -> int:
    """Insert a new call row in ``'uploaded'`` status and return its id."""
    ts = now()
    with get_db() as db:
        resolved_org = _resolve_org_id(db, org_id, user_id)
        cur = db.execute(
            "INSERT INTO calls (org_id, name, status, audio_path, duration_sec, call_type, user_id, client_id, source_type, source_meta, created_at, updated_at) "
            "VALUES (?, ?, 'uploaded', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (resolved_org, name, audio_path, duration_sec, call_type, user_id, client_id,
             source_type, json.dumps(source_meta or {}), ts, ts),
        )
        return cur.lastrowid


def _row_to_call(d: dict) -> dict:
    """Convert a raw calls row into a dict with parsed JSON columns."""
    d = dict(d)
    d["segments"] = json.loads(d["segments"] or "[]")
    d["analysis"] = json.loads(d["analysis"] or "{}")
    d["source_meta"] = json.loads(d.get("source_meta") or "{}")
    d["resolved"] = bool(d.get("resolved", 0))
    d["bookmarked"] = bool(d.get("bookmarked", 0))
    d["bookmark_note"] = d.get("bookmark_note") or ""
    return d


def get_call(call_id: int, org_id: int | None = None) -> dict | None:
    """Return a single call with joined uploader/client names and parsed JSON, or ``None``."""
    with get_db() as db:
        if org_id is not None:
            row = db.execute(
                "SELECT c.*, u.name AS uploader_name, cl.name AS client_name "
                "FROM calls c "
                "LEFT JOIN users u ON u.id = c.user_id "
                "LEFT JOIN clients cl ON cl.id = c.client_id "
                "WHERE c.id = ? AND c.org_id = ?",
                (call_id, org_id),
            ).fetchone()
        else:
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
    user_id: int | None = None,
    call_type: str | None = None,
    source_type: str | None = None,
    search: str | None = None,
    limit: int | None = None,
    offset: int = 0,
    org_id: int = 1,
) -> list[dict]:
    """Return calls newest-first in ``org_id``, optionally filtered by various fields, with joined names."""
    sql = (
        "SELECT c.*, u.name AS uploader_name, cl.name AS client_name "
        "FROM calls c "
        "LEFT JOIN users u ON u.id = c.user_id "
        "LEFT JOIN clients cl ON cl.id = c.client_id "
    )
    where: list[str] = ["c.org_id = ?"]
    params: list = [org_id]
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
        sql += " LIMIT ? OFFSET ?"
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


def add_telegram_user(user_id: int | None, telegram_id: int, username: str | None = None, first_name: str | None = None, last_name: str | None = None, org_id: int | None = None) -> int:
    """Add or update a telegram user link."""
    ts = now()
    with get_db() as db:
        resolved_org = _resolve_org_id(db, org_id, user_id)
        existing = db.execute("SELECT id FROM telegram_users WHERE telegram_id = ?", (telegram_id,)).fetchone()
        if existing:
            db.execute(
                "UPDATE telegram_users SET org_id = ?, user_id = ?, username = ?, first_name = ?, last_name = ?, active = 1 WHERE telegram_id = ?",
                (resolved_org, user_id, username, first_name, last_name, telegram_id),
            )
            return existing["id"]
        cur = db.execute(
            "INSERT INTO telegram_users (org_id, user_id, telegram_id, username, first_name, last_name, active, created_at) VALUES (?,?,?,?,?,?,?,?)",
            (resolved_org, user_id, telegram_id, username, first_name, last_name, 1, ts),
        )
        return cur.lastrowid


def get_telegram_users(org_id: int | None = None) -> list[dict]:
    """Get all active telegram users with their user info."""
    with get_db() as db:
        if org_id is not None:
            rows = db.execute(
                "SELECT tu.*, u.name, u.email, u.role FROM telegram_users tu JOIN users u ON u.id = tu.user_id WHERE tu.active = 1 AND u.org_id = ?",
                (org_id,),
            ).fetchall()
        else:
            rows = db.execute(
                "SELECT tu.*, u.name, u.email, u.role FROM telegram_users tu JOIN users u ON u.id = tu.user_id WHERE tu.active = 1"
            ).fetchall()
        return [dict(r) for r in rows]


def get_org_stats(org_id: int = 1) -> dict:
    """Get organization statistics scoped to ``org_id``."""
    with get_db() as db:
        total_calls = db.execute("SELECT COUNT(*) FROM calls WHERE org_id = ?", (org_id,)).fetchone()[0]
        done_calls = db.execute("SELECT COUNT(*) FROM calls WHERE org_id = ? AND status = 'done'", (org_id,)).fetchone()[0]
        error_calls = db.execute("SELECT COUNT(*) FROM calls WHERE org_id = ? AND status = 'error'", (org_id,)).fetchone()[0]
        processing_calls = db.execute(
            "SELECT COUNT(*) FROM calls WHERE org_id = ? AND status IN ('queued', 'transcribing', 'transcribed', 'analyzing')",
            (org_id,),
        ).fetchone()[0]

        avg_score_row = db.execute(
            "SELECT AVG(json_extract(analysis, '$.scorecard.overall')) FROM calls WHERE org_id = ? AND status = 'done' AND json_extract(analysis, '$.scorecard.overall') IS NOT NULL",
            (org_id,),
        ).fetchone()
        avg_score = round(avg_score_row[0]) if avg_score_row and avg_score_row[0] is not None else None

        total_managers = db.execute(
            "SELECT COUNT(*) FROM users WHERE org_id = ? AND role = 'manager' AND active = 1",
            (org_id,),
        ).fetchone()[0]
        total_clients = db.execute("SELECT COUNT(*) FROM clients WHERE org_id = ?", (org_id,)).fetchone()[0]

        top_managers = db.execute(
            """
            SELECT u.name, u.email, COUNT(c.id) as call_count,
                   AVG(CASE WHEN c.status = 'done' THEN json_extract(c.analysis, '$.scorecard.overall') END) as avg_score
            FROM users u
            LEFT JOIN calls c ON c.user_id = u.id AND c.call_type = 'manager' AND c.org_id = u.org_id
            WHERE u.org_id = ? AND u.role = 'manager' AND u.active = 1
            GROUP BY u.id
            HAVING call_count > 0
            ORDER BY avg_score DESC NULLS LAST
            LIMIT 5
            """,
            (org_id,),
        ).fetchall()

        calls_today = db.execute(
            "SELECT COUNT(*) FROM calls WHERE org_id = ? AND date(created_at) = date('now')",
            (org_id,),
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


def create_tag(name: str, color: str = "#6366f1", org_id: int = 1) -> int:
    ts = now()
    with get_db() as db:
        cur = db.execute(
            "INSERT INTO tags (org_id, name, color, created_at) VALUES (?, ?, ?, ?)",
            (org_id, name, color, ts),
        )
        return cur.lastrowid


def list_tags(org_id: int = 1) -> list[dict]:
    with get_db() as db:
        rows = db.execute("SELECT * FROM tags WHERE org_id = ? ORDER BY name", (org_id,)).fetchall()
        return [dict(r) for r in rows]


def delete_tag(tag_id: int, org_id: int | None = None):
    with get_db() as db:
        if org_id is not None:
            db.execute("DELETE FROM tags WHERE id = ? AND org_id = ?", (tag_id, org_id))
        else:
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


def add_youtube_whitelist(channel_id: str | None = None, channel_name: str | None = None, pattern: str | None = None, org_id: int = 1) -> int:
    ts = now()
    with get_db() as db:
        cur = db.execute(
            "INSERT INTO youtube_whitelist (org_id, channel_id, channel_name, pattern, created_at) VALUES (?, ?, ?, ?, ?)",
            (org_id, channel_id, channel_name, pattern, ts),
        )
        return cur.lastrowid


def list_youtube_whitelist(org_id: int = 1) -> list[dict]:
    with get_db() as db:
        rows = db.execute("SELECT * FROM youtube_whitelist WHERE org_id = ? ORDER BY id", (org_id,)).fetchall()
        return [dict(r) for r in rows]


def remove_youtube_whitelist(entry_id: int, org_id: int | None = None):
    with get_db() as db:
        if org_id is not None:
            db.execute("DELETE FROM youtube_whitelist WHERE id = ? AND org_id = ?", (entry_id, org_id))
        else:
            db.execute("DELETE FROM youtube_whitelist WHERE id = ?", (entry_id,))


def is_youtube_allowed(channel_id: str | None = None, url: str | None = None, org_id: int = 1) -> bool:
    with get_db() as db:
        count = db.execute("SELECT COUNT(*) FROM youtube_whitelist WHERE active = 1 AND org_id = ?", (org_id,)).fetchone()[0]
        if count == 0:
            return True
        if channel_id:
            row = db.execute(
                "SELECT id FROM youtube_whitelist WHERE active = 1 AND org_id = ? AND channel_id = ?",
                (org_id, channel_id),
            ).fetchone()
            if row:
                return True
        if url:
            row = db.execute(
                "SELECT id FROM youtube_whitelist WHERE active = 1 AND org_id = ? AND ? LIKE pattern",
                (org_id, url),
            ).fetchone()
            if row:
                return True
        return False


# ---------------------------------------------------------------------------
# Bot / Organization Settings
# ---------------------------------------------------------------------------


def set_bot_setting(key: str, value: str, org_id: int = 1):
    ts = now()
    with get_db() as db:
        db.execute(
            "INSERT INTO org_settings (org_id, key, value, updated_at) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(org_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            (org_id, key, value, ts),
        )
        if org_id == 1:
            db.execute(
                "INSERT INTO bot_settings (key, value, updated_at) VALUES (?, ?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                (key, value, ts),
            )


def get_bot_setting(key: str, default: str = "", org_id: int = 1) -> str:
    with get_db() as db:
        row = db.execute(
            "SELECT value FROM org_settings WHERE org_id = ? AND key = ?",
            (org_id, key),
        ).fetchone()
        if row is not None:
            return row[0]
        if org_id == 1:
            row2 = db.execute("SELECT value FROM bot_settings WHERE key = ?", (key,)).fetchone()
            if row2 is not None:
                return row2[0]
        return default


def get_bot_setting_row(key: str, org_id: int = 1) -> dict | None:
    """Return ``{"key","value","updated_at"}`` for an org setting row, or ``None``."""
    with get_db() as db:
        row = db.execute(
            "SELECT key, value, updated_at FROM org_settings WHERE org_id = ? AND key = ?",
            (org_id, key),
        ).fetchone()
        if row is not None:
            return dict(row)
        if org_id == 1:
            row2 = db.execute(
                "SELECT key, value, updated_at FROM bot_settings WHERE key = ?", (key,)
            ).fetchone()
            if row2 is not None:
                return dict(row2)
        return None


# ---------------------------------------------------------------------------
# Organization profile + feature flags
# ---------------------------------------------------------------------------

ORG_PROFILE_KEY = "org_profile"

ORG_PROFILE_FIELDS = (
    "name",        # muassasa nomi
    "direction",   # faoliyat yo'nalishi (o'quv markaz / call-markaz / ...)
    "services",    # xizmatlar va tariflar
    "rules",       # ideal qo'ng'iroq qoidalari (skript)
    "flaws",       # nima nuqson (nuqson) hisoblanadi
    "metrics",     # maqsadli ko'rsatkichlar
    "summary",     # birlashgan tavsif (Gemini tomonidan yoziladi)
    "custom_instructions",  # Admin qo'shimcha ko'rsatmalari
)

FLAG_DEFAULTS = {
    "punctuation": True,
    "speaker_labels": False,
    "problem_alerts": True,
    "gpu": False,
}

RETENTION_CHOICES = (0, 30, 90)


def get_org_profile(org_id: int = 1) -> dict:
    raw = get_bot_setting(ORG_PROFILE_KEY, "", org_id=org_id)
    if not raw:
        return {}
    try:
        profile = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return profile if isinstance(profile, dict) else {}


def set_org_profile(profile: dict, org_id: int = 1) -> dict:
    """Merge into the stored profile and return the merged result."""
    merged = {
        **get_org_profile(org_id=org_id),
        **{k: str(v).strip() for k, v in profile.items()},
    }
    merged = {k: v for k, v in merged.items() if v}
    set_bot_setting(ORG_PROFILE_KEY, json.dumps(merged, ensure_ascii=False), org_id=org_id)
    return merged


def get_flag(key: str, org_id: int = 1) -> bool:
    if key not in FLAG_DEFAULTS:
        raise ValueError(f"unknown flag: {key}")
    raw = get_bot_setting(f"flag_{key}", "", org_id=org_id).strip().lower()
    if raw in ("true", "false"):
        return raw == "true"
    return FLAG_DEFAULTS[key]


def set_flag(key: str, value: bool, org_id: int = 1) -> None:
    if key not in FLAG_DEFAULTS:
        raise ValueError(f"unknown flag: {key}")
    set_bot_setting(f"flag_{key}", "true" if value else "false", org_id=org_id)


def all_flags(org_id: int = 1) -> dict:
    return {key: get_flag(key, org_id=org_id) for key in FLAG_DEFAULTS}


def get_retention_days(org_id: int = 1) -> int:
    raw = get_bot_setting("retention_days", "0", org_id=org_id)
    try:
        days = int(raw)
    except ValueError:
        return 0
    return days if days in RETENTION_CHOICES else 0


def set_retention_days(days: int, org_id: int = 1) -> None:
    set_bot_setting("retention_days", str(days), org_id=org_id)


def expired_audio(days: int, org_id: int | None = None) -> list[dict]:
    """Calls whose audio is older than ``days`` — candidates for audio purge."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    with get_db() as db:
        if org_id is not None:
            rows = db.execute(
                "SELECT id, audio_path FROM calls "
                "WHERE org_id = ? AND audio_path IS NOT NULL AND audio_path != '' AND created_at < ?",
                (org_id, cutoff),
            ).fetchall()
        else:
            rows = db.execute(
                "SELECT id, audio_path FROM calls "
                "WHERE audio_path IS NOT NULL AND audio_path != '' AND created_at < ?",
                (cutoff,),
            ).fetchall()
    return [{"id": r[0], "audio_path": r[1]} for r in rows]


def clear_audio(call_id: int) -> None:
    with get_db() as db:
        db.execute("UPDATE calls SET audio_path = NULL WHERE id = ?", (call_id,))


def list_analysable_call_ids(limit: int = 200, org_id: int = 1) -> list[int]:
    """IDs of 'done' calls with a transcript in ``org_id`` — the bulk re-analysis pool."""
    with get_db() as db:
        rows = db.execute(
            "SELECT id FROM calls "
            "WHERE org_id = ? AND status = 'done' AND transcript IS NOT NULL AND transcript != '' "
            "ORDER BY id DESC LIMIT ?",
            (org_id, limit),
        ).fetchall()
    return [r[0] for r in rows]


# ---------------------------------------------------------------------------
# Advanced Analytics
# ---------------------------------------------------------------------------


def get_day_over_day_stats(org_id: int = 1) -> dict:
    """Compare today vs yesterday metrics in ``org_id``."""
    with get_db() as db:
        today = db.execute("SELECT date('now')").fetchone()[0]
        yesterday = db.execute("SELECT date('now', '-1 day')").fetchone()[0]

        def _day_stats(date_str: str) -> dict:
            calls = db.execute(
                "SELECT COUNT(*) FROM calls WHERE org_id = ? AND date(created_at) = ?", (org_id, date_str)
            ).fetchone()[0]
            done = db.execute(
                "SELECT COUNT(*) FROM calls WHERE org_id = ? AND date(created_at) = ? AND status = 'done'", (org_id, date_str)
            ).fetchone()[0]
            avg_score_row = db.execute(
                "SELECT AVG(json_extract(analysis, '$.scorecard.overall')) "
                "FROM calls WHERE org_id = ? AND date(created_at) = ? AND status = 'done' "
                "AND json_extract(analysis, '$.scorecard.overall') IS NOT NULL",
                (org_id, date_str),
            ).fetchone()
            avg_score = round(avg_score_row[0]) if avg_score_row and avg_score_row[0] is not None else None
            avg_duration_row = db.execute(
                "SELECT AVG(duration_sec) FROM calls WHERE org_id = ? AND date(created_at) = ? AND status = 'done'",
                (org_id, date_str),
            ).fetchone()
            avg_duration = round(avg_duration_row[0]) if avg_duration_row and avg_duration_row[0] is not None else None
            avg_talk_row = db.execute(
                "SELECT AVG(json_extract(analysis, '$.rep_share_of_talk')) "
                "FROM calls WHERE org_id = ? AND date(created_at) = ? AND status = 'done' "
                "AND json_extract(analysis, '$.rep_share_of_talk') IS NOT NULL",
                (org_id, date_str),
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


def get_weekly_trend(org_id: int = 1) -> list[dict]:
    """Get per-day stats for the last 7 days in ``org_id``."""
    with get_db() as db:
        rows = db.execute(
            """
            SELECT date(created_at) as day,
                   COUNT(*) as total_calls,
                   SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done_calls,
                   AVG(CASE WHEN status = 'done' THEN json_extract(analysis, '$.scorecard.overall') END) as avg_score,
                   AVG(CASE WHEN status = 'done' THEN duration_sec END) as avg_duration
            FROM calls
            WHERE org_id = ? AND created_at >= date('now', '-7 days')
            GROUP BY date(created_at)
            ORDER BY day
            """,
            (org_id,),
        ).fetchall()
        return [
            {
                "day": r[0], "total_calls": r[1], "done_calls": r[2],
                "avg_score": round(r[3]) if r[3] is not None else None,
                "avg_duration": round(r[4]) if r[4] is not None else None,
            }
            for r in rows
        ]


def get_monthly_trend(org_id: int = 1) -> list[dict]:
    """Get per-week stats for the last 4 weeks in ``org_id``."""
    with get_db() as db:
        rows = db.execute(
            """
            SELECT strftime('%Y-W%W', created_at) as week,
                   COUNT(*) as total_calls,
                   SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done_calls,
                   AVG(CASE WHEN status = 'done' THEN json_extract(analysis, '$.scorecard.overall') END) as avg_score
            FROM calls
            WHERE org_id = ? AND created_at >= date('now', '-28 days')
            GROUP BY strftime('%Y-W%W', created_at)
            ORDER BY week
            """,
            (org_id,),
        ).fetchall()
        return [
            {
                "week": r[0], "total_calls": r[1], "done_calls": r[2],
                "avg_score": round(r[3]) if r[3] is not None else None,
            }
            for r in rows
        ]


def get_problem_calls(limit: int = 10, org_id: int = 1) -> list[dict]:
    """Find calls with issues in ``org_id``."""
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
            WHERE c.org_id = ?
              AND c.status = 'done'
              AND json_extract(c.analysis, '$.scorecard.overall') IS NOT NULL
              AND json_extract(c.analysis, '$.scorecard.overall') < 50
            ORDER BY json_extract(c.analysis, '$.scorecard.overall') ASC
            LIMIT ?
            """,
            (org_id, limit),
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


def get_manager_rankings(limit: int = 20, org_id: int = 1) -> list[dict]:
    """Full performance rankings with trend indicators in ``org_id``."""
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
                             AND (c.resolved = 1 OR lower(coalesce(c.analysis, '')) LIKE '%hal qilindi%') THEN 1 ELSE 0 END) as solved_problems,
                   SUM(CASE WHEN c.status = 'done'
                             AND json_extract(c.analysis, '$.scorecard.overall') < 50
                             AND c.resolved = 0
                             AND lower(coalesce(c.analysis, '')) NOT LIKE '%hal qilindi%' THEN 1 ELSE 0 END) as unsolved_problems
            FROM users u
            LEFT JOIN calls c ON c.user_id = u.id AND c.call_type = 'manager' AND c.org_id = u.org_id
            WHERE u.org_id = ? AND u.role IN ('manager', 'yonalish') AND u.active = 1
            GROUP BY u.id
            ORDER BY total_calls DESC, avg_score DESC NULLS LAST
            LIMIT ?
            """,
            (org_id, limit),
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


def get_source_breakdown(org_id: int = 1) -> dict:
    """Get call counts by source_type in ``org_id``."""
    with get_db() as db:
        rows = db.execute(
            "SELECT source_type, COUNT(*) FROM calls WHERE org_id = ? GROUP BY source_type",
            (org_id,),
        ).fetchall()
        return {r[0]: r[1] for r in rows}


def get_cross_call_insights(limit: int = 100, org_id: int = 1) -> dict:
    """Aggregate recurring objections, coaching flaws, rubric weak spots, and coach decisions in ``org_id``."""
    from collections import Counter

    dims = (
        "opening",
        "discovery",
        "objection_handling",
        "value_prop",
        "closing",
        "rapport",
        "talk_ratio",
    )
    dim_totals: dict[str, list[float]] = {d: [] for d in dims}
    flaw_counter: Counter[str] = Counter()
    objection_counter: Counter[str] = Counter()
    decisions: dict[str, int] = {"NO_ACTION": 0, "COACH": 0, "ESCALATE": 0}
    bookmarked_count = 0

    with get_db() as conn:
        bookmarked_count = conn.execute(
            "SELECT COUNT(*) FROM calls WHERE org_id = ? AND bookmarked = 1",
            (org_id,),
        ).fetchone()[0]
        rows = conn.execute(
            "SELECT analysis FROM calls WHERE org_id = ? AND status = 'done' ORDER BY id DESC LIMIT ?",
            (org_id, limit),
        ).fetchall()

    for r in rows:
        try:
            a = json.loads(r[0] or "{}")
        except json.JSONDecodeError:
            continue
        sc = a.get("scorecard") or {}
        if isinstance(sc, dict):
            for d in dims:
                val = sc.get(d)
                if isinstance(val, (int, float)):
                    dim_totals[d].append(float(val))
            overall = sc.get("overall")
        else:
            overall = None

        dec = a.get("coach_decision")
        if dec in decisions:
            decisions[dec] += 1
        elif isinstance(overall, (int, float)):
            if overall >= 75:
                decisions["NO_ACTION"] += 1
            elif overall >= 50:
                decisions["COACH"] += 1
            else:
                decisions["ESCALATE"] += 1

        for cp in a.get("coaching_points") or []:
            if isinstance(cp, str) and cp.strip():
                short = cp.strip()[:120]
                flaw_counter[short] += 1

        for obj in a.get("objections") or []:
            if isinstance(obj, str) and obj.strip():
                short = obj.strip()[:100]
                objection_counter[short] += 1

        for km in a.get("key_metrics") or []:
            if isinstance(km, dict):
                kname = str(km.get("name") or "").lower()
                kval = str(km.get("value") or "").strip()
                if kval and any(w in kname for w in ("e'tiroz", "etiroz", "objection", "rad", "muammo", "narx")):
                    objection_counter[f"{km.get('name')}: {kval}"[:100]] += 1

    rubric_averages = [
        {"dimension": d, "avg_score": round(sum(vals) / len(vals))}
        for d, vals in dim_totals.items()
        if vals
    ]
    rubric_averages.sort(key=lambda x: x["avg_score"])

    return {
        "analyzed_calls": len(rows),
        "bookmarked_calls": bookmarked_count,
        "decision_counts": decisions,
        "weakest_dimensions": rubric_averages,
        "top_flaws": [{"text": k, "count": v} for k, v in flaw_counter.most_common(6)],
        "top_objections": [{"text": k, "count": v} for k, v in objection_counter.most_common(6)],
    }


def list_recent_calls_for_qa(limit: int = 30, org_id: int = 1) -> list[dict]:
    """Compact summary of recent analysed calls in ``org_id`` for cross-call Q&A."""
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT c.id, c.name, c.created_at, c.analysis, u.name AS uploader_name
            FROM calls c
            LEFT JOIN users u ON u.id = c.user_id
            WHERE c.org_id = ? AND c.status = 'done'
            ORDER BY c.id DESC
            LIMIT ?
            """,
            (org_id, limit),
        ).fetchall()
    out = []
    for r in rows:
        try:
            a = json.loads(r["analysis"] or "{}")
        except json.JSONDecodeError:
            a = {}
        sc = a.get("scorecard") or {}
        out.append(
            {
                "id": r["id"],
                "title": a.get("topic") or r["name"],
                "manager": r["uploader_name"] or "Unknown",
                "score": sc.get("overall"),
                "outcome": a.get("outcome"),
                "summary": a.get("summary") or "",
                "coaching_points": (a.get("coaching_points") or [])[:3],
                "objections": (a.get("objections") or [])[:3],
            }
        )
    return out


def get_employee_overview(user_id: int, role: str, org_id: int = 1) -> dict:
    """Compute personal KPIs, weekly trend, rubric averages, coaching points, rank, and tasks for an employee."""
    dims = (
        "opening",
        "discovery",
        "objection_handling",
        "value_prop",
        "closing",
        "rapport",
        "talk_ratio",
    )
    dim_totals: dict[str, list[float]] = {d: [] for d in dims}
    coaching_points: list[dict] = []

    with get_db() as conn:
        if role == "receptionist":
            where_sql = "c.org_id = ? AND c.call_type = 'receptionist'"
            where_params: tuple = (org_id,)
        else:
            where_sql = "c.org_id = ? AND c.user_id = ?"
            where_params = (org_id, user_id)

        total_calls = conn.execute(f"SELECT COUNT(*) FROM calls c WHERE {where_sql}", where_params).fetchone()[0]
        calls_today = conn.execute(
            f"SELECT COUNT(*) FROM calls c WHERE {where_sql} AND date(c.created_at) = date('now')",
            where_params,
        ).fetchone()[0]
        calls_week = conn.execute(
            f"SELECT COUNT(*) FROM calls c WHERE {where_sql} AND c.created_at >= date('now', '-7 days')",
            where_params,
        ).fetchone()[0]
        avg_row = conn.execute(
            f"SELECT AVG(json_extract(c.analysis, '$.scorecard.overall')), "
            f"MAX(json_extract(c.analysis, '$.scorecard.overall')), "
            f"AVG(json_extract(c.analysis, '$.rep_share_of_talk')) "
            f"FROM calls c WHERE {where_sql} AND c.status = 'done' "
            f"AND json_extract(c.analysis, '$.scorecard.overall') IS NOT NULL",
            where_params,
        ).fetchone()
        avg_score = round(avg_row[0]) if avg_row and avg_row[0] is not None else None
        best_score = round(avg_row[1]) if avg_row and avg_row[1] is not None else None
        avg_talk = round(avg_row[2], 2) if avg_row and avg_row[2] is not None else None

        problem_count = conn.execute(
            f"SELECT COUNT(*) FROM calls c WHERE {where_sql} AND c.status = 'done' "
            f"AND c.resolved = 0 AND json_extract(c.analysis, '$.scorecard.overall') < 50",
            where_params,
        ).fetchone()[0]

        trend_rows = conn.execute(
            f"SELECT date(c.created_at) as day, COUNT(*) as total_calls, "
            f"AVG(CASE WHEN c.status = 'done' THEN json_extract(c.analysis, '$.scorecard.overall') END) as avg_score "
            f"FROM calls c WHERE {where_sql} AND c.created_at >= date('now', '-7 days') "
            f"GROUP BY date(c.created_at) ORDER BY day",
            where_params,
        ).fetchall()

        done_rows = conn.execute(
            f"SELECT c.id, c.name, c.created_at, c.analysis FROM calls c "
            f"WHERE {where_sql} AND c.status = 'done' ORDER BY c.id DESC LIMIT 25",
            where_params,
        ).fetchall()

        peer_rows = conn.execute(
            """
            SELECT u.id,
                   AVG(CASE WHEN c.status = 'done' THEN json_extract(c.analysis, '$.scorecard.overall') END) as avg_score,
                   COUNT(c.id) as total_calls
            FROM users u
            LEFT JOIN calls c ON c.user_id = u.id AND c.org_id = u.org_id
            WHERE u.org_id = ? AND u.role IN ('manager', 'receptionist') AND u.active = 1
            GROUP BY u.id
            ORDER BY avg_score DESC NULLS LAST, total_calls DESC
            """,
            (org_id,),
        ).fetchall()

    rank_pos = None
    for idx, pr in enumerate(peer_rows, start=1):
        if pr["id"] == user_id:
            rank_pos = idx
            break

    for r in done_rows:
        try:
            a = json.loads(r["analysis"] or "{}")
        except json.JSONDecodeError:
            continue
        sc = a.get("scorecard") or {}
        overall = sc.get("overall") if isinstance(sc, dict) else None
        if isinstance(sc, dict):
            for d in dims:
                val = sc.get(d)
                if isinstance(val, (int, float)):
                    dim_totals[d].append(float(val))
        title = a.get("topic") or r["name"]
        for cp in (a.get("coaching_points") or [])[:2]:
            if isinstance(cp, str) and cp.strip() and len(coaching_points) < 6:
                coaching_points.append({
                    "call_id": r["id"],
                    "call_title": title,
                    "created_at": r["created_at"],
                    "score": round(overall) if isinstance(overall, (int, float)) else None,
                    "point": cp.strip(),
                })

    rubric_averages = [
        {"dimension": d, "avg_score": round(sum(vals) / len(vals))}
        for d, vals in dim_totals.items()
        if vals
    ]
    rubric_averages.sort(key=lambda x: x["avg_score"])

    notifications = get_notifications(user_id, unread_only=False, limit=15)
    unread_tasks = sum(1 for n in notifications if not n.get("read"))

    recent_calls = list_calls(
        user_id=None if role == "receptionist" else user_id,
        call_type="receptionist" if role == "receptionist" else None,
        limit=8,
        org_id=org_id,
    )

    return {
        "kpis": {
            "total_calls": total_calls,
            "calls_today": calls_today,
            "calls_this_week": calls_week,
            "avg_score": avg_score,
            "best_score": best_score,
            "avg_talk_ratio": avg_talk,
            "open_tasks_count": unread_tasks,
            "problem_calls_count": problem_count,
        },
        "rank": {
            "position": rank_pos,
            "total_peers": len(peer_rows),
        },
        "weekly_trend": [
            {
                "day": r["day"],
                "total_calls": r["total_calls"],
                "avg_score": round(r["avg_score"]) if r["avg_score"] is not None else None,
            }
            for r in trend_rows
        ],
        "rubric_averages": rubric_averages,
        "coaching_points": coaching_points,
        "tasks": notifications,
        "recent_calls": recent_calls,
    }

