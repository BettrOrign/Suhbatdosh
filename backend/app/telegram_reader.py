"""Background reader bot for ingesting group/channel client questions and sending replies."""

import json
import logging
import threading
import time
import urllib.parse
import urllib.request

from app import config, db

logger = logging.getLogger("suhbatdosh.telegram_reader")

BASE = "https://api.telegram.org/bot{token}"


def _api(token: str, method: str, params: dict | None = None) -> dict:
    url = BASE.format(token=token) + "/" + method
    data = urllib.parse.urlencode(params or {}).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def _staff_handles() -> set[str]:
    raw = db.get_bot_setting("telegram_staff_handles", "", org_id=config.TELEGRAM_READER_ORG_ID) or "mr_individ"
    return {h.strip().lstrip("@").lower() for h in raw.split(",") if h.strip()}


def _is_staff_or_bot(msg: dict) -> bool:
    u = msg.get("from", {})
    if u.get("is_bot"):
        return True
    uid = u.get("id")
    if uid:
        if uid in config.TELEGRAM_ADMIN_IDS:
            return True
        if any(tu.get("telegram_id") == uid for tu in db.get_telegram_users(org_id=config.TELEGRAM_READER_ORG_ID)):
            return True
    uname = (u.get("username") or "").lower()
    if uname and uname in _staff_handles():
        return True
    return False


def send_reply(chat_id: int, reply_to_message_id: int, text: str) -> dict:
    """Send a reply to a specific Telegram message via the reader bot."""
    token = config.TELEGRAM_READER_BOT_TOKEN or config.TELEGRAM_BOT_TOKEN
    if not token:
        raise RuntimeError("TELEGRAM_READER_BOT_TOKEN is not configured")
    return _api(
        token,
        "sendMessage",
        {
            "chat_id": chat_id,
            "text": text,
            "reply_to_message_id": reply_to_message_id,
        },
    )


def _poll_loop(token: str, stop_event: threading.Event) -> None:
    offset = 0
    while not stop_event.is_set():
        try:
            res = _api(token, "getUpdates", {"offset": offset, "timeout": 20})
            for upd in res.get("result", []):
                offset = upd["update_id"] + 1
                msg = upd.get("message") or upd.get("channel_post")
                if not msg:
                    continue
                chat = msg.get("chat", {})
                chat_id = chat.get("id")
                if chat.get("type") not in ("group", "supergroup", "channel"):
                    continue
                u = msg.get("from", {})
                text = (msg.get("text") or msg.get("caption") or "").strip()
                if not text:
                    continue
                is_staff = _is_staff_or_bot(msg)
                full_name = f"{u.get('first_name') or ''} {u.get('last_name') or ''}".strip()
                try:
                    with db.get_db() as conn:
                        conn.execute(
                            """INSERT OR IGNORE INTO telegram_messages
                               (org_id, chat_id, message_id, user_id, username, full_name, text, is_bot, is_staff)
                               VALUES (?,?,?,?,?,?,?,?,?)""",
                            (
                                config.TELEGRAM_READER_ORG_ID,
                                chat_id,
                                msg["message_id"],
                                u.get("id"),
                                u.get("username"),
                                full_name or None,
                                text,
                                1 if u.get("is_bot") else 0,
                                1 if is_staff else 0,
                            ),
                        )
                        conn.commit()
                except Exception as e:
                    logger.exception("db insert failed: %s", e)
        except Exception as e:
            logger.warning("poll error: %s", e)
            stop_event.wait(3)


_thread: threading.Thread | None = None
_stop = threading.Event()


def start() -> None:
    global _thread
    token = config.TELEGRAM_READER_BOT_TOKEN
    if not token:
        logger.info("TELEGRAM_READER_BOT_TOKEN not set, reader bot disabled")
        return
    _stop.clear()
    _thread = threading.Thread(target=_poll_loop, args=(token, _stop), daemon=True)
    _thread.start()
    logger.info("telegram reader bot started")


def stop() -> None:
    _stop.set()
    if _thread:
        _thread.join(timeout=5)
