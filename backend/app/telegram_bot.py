"""Telegram bot with comfortable interactive chat experience.

Features:
- Visual main menu with inline keyboard navigation
- Score bars and visual indicators
- Conversational flows with context-sensitive buttons
- Recording browser with clickable detail views
- Quick actions on every view (reanalyze, tag, play)
- Typing indicators and progress feedback
- Navigation breadcrumbs and back buttons
- Rich audio/video file handling
"""

import asyncio
import logging
import tempfile
from pathlib import Path

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from telegram import (
    BotCommand,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Update,
)
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from . import audio, config, db
from .reports import (
    generate_daily_comparison_report,
    generate_full_report,
    generate_manager_rankings_report,
    generate_problem_calls_report,
    generate_weekly_trend_report,
)
from .youtube import extract_video_id, process_youtube_video

logger = logging.getLogger("viacall.telegram")

PAGE_SIZE = 5


# ---------------------------------------------------------------------------
# Visual helpers
# ---------------------------------------------------------------------------


def _score_bar(score: int | None, width: int = 10) -> str:
    """Render a visual score bar using Unicode block characters."""
    if score is None:
        return "_" * width
    filled = round(score / 100 * width)
    empty = width - filled
    if score >= 80:
        char = "#"
    elif score >= 60:
        char = "="
    elif score >= 40:
        char = "-"
    else:
        char = "."
    return char * filled + "_" * empty


def _score_chip(score) -> str:
    """Score with visual bar and color hint."""
    if score is None:
        return "N/A"
    s = round(score)
    bar = _score_bar(s, 8)
    return f"{bar} {s}/100"


def _status_badge(status: str) -> str:
    """Visual status badge."""
    badges = {
        "done": "[OK] Done",
        "error": "[FAIL] Error",
        "transcribing": "[...] Transcribing",
        "analyzing": "[...] Analyzing",
        "queued": "[...] Queued",
        "uploaded": "[In] Uploaded",
    }
    return badges.get(status, f"? {status}")


def _source_badge(source: str) -> str:
    badges = {
        "upload": "[In] Upload",
        "ingest": "[Out] Ingest",
        "telegram_voice": "[Mic] Voice",
        "telegram_audio": "[Audio] Audio",
        "telegram_video": "[Video] Video",
        "youtube": "> YouTube",
    }
    return badges.get(source, source)


def _trend_arrow(trend: str) -> str:
    return {"up": "[Trend]", "down": "", "same": "->"}.get(trend, "")


def _is_admin(user_id: int) -> bool:
    return user_id in config.TELEGRAM_ADMIN_IDS


def _fmt_duration(seconds: float | None) -> str:
    if seconds is None:
        return "N/A"
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    if h:
        return f"{h}h{m:02d}m{s:02d}s"
    return f"{m}m{s:02d}s"


def _header(title: str) -> str:
    return f"<b>{title}</b>"


def _divider() -> str:
    return "-" * 24


async def _typing(update_or_query):
    """Send typing indicator."""
    chat_id = None
    if hasattr(update_or_query, "message") and update_or_query.message:
        chat_id = update_or_query.message.chat_id
    elif hasattr(update_or_query, "chat_id"):
        chat_id = update_or_query.chat_id
    if chat_id:
        try:
            await update_or_query.get_bot().send_chat_action(chat_id=chat_id, action="typing")
        except Exception:
            pass


async def _linked_user(telegram_id: int) -> dict | None:
    with db.get_db() as conn:
        row = conn.execute(
            "SELECT u.* FROM users u JOIN telegram_users tu ON tu.user_id = u.id "
            "WHERE tu.telegram_id = ? AND tu.active = 1",
            (telegram_id,),
        ).fetchone()
        return dict(row) if row else None


# ---------------------------------------------------------------------------
# Main menu
# ---------------------------------------------------------------------------


def _main_menu_keyboard(is_admin: bool) -> InlineKeyboardMarkup:
    """Build the main menu inline keyboard."""
    rows = [
        [
            InlineKeyboardButton("[Audio] Recordings", callback_data="menu:recordings"),
            InlineKeyboardButton("[Search] Search", callback_data="menu:search"),
        ],
        [
            InlineKeyboardButton("[Stats] Stats", callback_data="menu:stats"),
            InlineKeyboardButton("[Trend] Trends", callback_data="analytics:trends"),
        ],
        [
            InlineKeyboardButton("[!] Alerts", callback_data="menu:alerts"),
            InlineKeyboardButton("[Rank] Rankings", callback_data="menu:rankings"),
        ],
    ]
    if is_admin:
        rows.append([
            InlineKeyboardButton("[*] Admin", callback_data="menu:admin"),
            InlineKeyboardButton("> YouTube", callback_data="menu:youtube"),
        ])
    return InlineKeyboardMarkup(rows)


def _back_button(target: str = "home") -> InlineKeyboardButton:
    return InlineKeyboardButton("< Back", callback_data=target)


def _home_button() -> InlineKeyboardButton:
    return InlineKeyboardButton("[Menu] Menu", callback_data="home")


async def _show_home(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Display the main menu."""
    await _typing(update)
    user = update.effective_user
    is_adm = _is_admin(user.id) if user else False
    linked = await _linked_user(user.id) if user else None

    name = user.first_name if user else "there"
    stats = db.get_org_stats()

    lines = [
        _header(f"Hey, {name}! "),
        "",
        f"Today: <b>{stats['calls_today']}</b> calls | Avg score: <b>{stats['avg_score'] or 'N/A'}</b>/100",
        f"Active: {stats['processing_calls']} processing | {stats['done_calls']} completed",
        "",
        "<i>Send a voice message or audio file to transcribe it,</i>",
        "<i>or use the menu below.</i>",
    ]

    kb = _main_menu_keyboard(is_adm)

    if hasattr(update, "callback_query") and update.callback_query:
        await update.callback_query.edit_message_text(
            "\n".join(lines), parse_mode="HTML", reply_markup=kb
        )
    else:
        await update.message.reply_text(
            "\n".join(lines), parse_mode="HTML", reply_markup=kb
        )


async def home_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle 'home' callback - return to main menu."""
    query = update.callback_query
    await query.answer()
    user = query.from_user
    is_adm = _is_admin(user.id)
    stats = db.get_org_stats()
    name = user.first_name if user else "there"

    lines = [
        _header(f"Hey, {name}! "),
        "",
        f"Today: <b>{stats['calls_today']}</b> calls | Avg score: <b>{stats['avg_score'] or 'N/A'}</b>/100",
        f"Active: {stats['processing_calls']} processing | {stats['done_calls']} completed",
        "",
        "<i>Send a voice message or audio file to transcribe it,</i>",
        "<i>or use the menu below.</i>",
    ]

    await query.edit_message_text(
        "\n".join(lines), parse_mode="HTML", reply_markup=_main_menu_keyboard(is_adm)
    )


# ---------------------------------------------------------------------------
# Recordings browser
# ---------------------------------------------------------------------------


def _format_call_card(call: dict, compact: bool = False) -> str:
    """Format a single call as a visual card."""
    score = call.get("analysis", {}).get("scorecard", {}).get("overall")
    status = _status_badge(call["status"])
    source = _source_badge(call.get("source_type", "upload"))
    dur = _fmt_duration(call.get("duration_sec"))

    if compact:
        return (
            f"{status}  <b>#{call['id']}</b> {call['name'][:35]}\n"
            f"  {_score_chip(score)}  -  {dur}  -  {source}"
        )

    lines = [
        f"[>] <b>#{call['id']}</b>  {call['name'][:40]}",
        f"  {status}",
        f"  Score: {_score_chip(score)}",
        f"  Duration: {dur}  |  Source: {source}",
    ]
    if call.get("client_name"):
        lines.append(f"  Client: {call['client_name']}")
    if call.get("uploader_name"):
        lines.append(f"  By: {call['uploader_name']}")
    return "\n".join(lines)


async def recordings_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show recordings list via inline keyboard."""
    query = update.callback_query
    await query.answer()
    await _typing(query)

    data = query.data.split(":")
    page = int(data[1]) if len(data) > 1 else 0

    calls = db.list_calls(limit=PAGE_SIZE, offset=page * PAGE_SIZE)
    total = len(db.list_calls(limit=10000))
    total_pages = max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE)

    if not calls:
        await query.edit_message_text(
            _header("No Recordings") + "\n\nNo recordings found yet.\nSend a voice message to get started!",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup([[_home_button()]]),
        )
        return

    lines = [
        _header(f"[Audio] Recordings  ({page + 1}/{total_pages})"),
        _divider(),
        "",
    ]
    for c in calls:
        lines.append(_format_call_card(c, compact=True))
        lines.append("")

    # Navigation row
    nav = []
    if page > 0:
        nav.append(InlineKeyboardButton("< Prev", callback_data=f"rec_page:{page - 1}"))
    nav.append(InlineKeyboardButton(f"{page + 1}/{total_pages}", callback_data="noop"))
    if page < total_pages - 1:
        nav.append(InlineKeyboardButton("Next >", callback_data=f"rec_page:{page + 1}"))

    # Detail buttons row
    detail_buttons = [
        InlineKeyboardButton(f"#{c['id']}", callback_data=f"detail:{c['id']}")
        for c in calls[:3]
    ]

    rows = [nav]
    if detail_buttons:
        rows.append(detail_buttons)
    rows.append([_home_button()])

    await query.edit_message_text(
        "\n".join(lines), parse_mode="HTML", reply_markup=InlineKeyboardMarkup(rows)
    )


async def recordings_page_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle recordings pagination."""
    query = update.callback_query
    await query.answer()
    page = int(query.data.split(":")[1])
    await _show_recordings_page(query, context, page)


async def _show_recordings_page(query, context, page: int):
    calls = db.list_calls(limit=PAGE_SIZE, offset=page * PAGE_SIZE)
    total = len(db.list_calls(limit=10000))
    total_pages = max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE)

    lines = [
        _header(f"[Audio] Recordings  ({page + 1}/{total_pages})"),
        _divider(),
        "",
    ]
    for c in calls:
        lines.append(_format_call_card(c, compact=True))
        lines.append("")

    nav = []
    if page > 0:
        nav.append(InlineKeyboardButton("< Prev", callback_data=f"rec_page:{page - 1}"))
    nav.append(InlineKeyboardButton(f"{page + 1}/{total_pages}", callback_data="noop"))
    if page < total_pages - 1:
        nav.append(InlineKeyboardButton("Next >", callback_data=f"rec_page:{page + 1}"))

    detail_buttons = [
        InlineKeyboardButton(f"#{c['id']}", callback_data=f"detail:{c['id']}")
        for c in calls[:3]
    ]

    rows = [nav]
    if detail_buttons:
        rows.append(detail_buttons)
    rows.append([_home_button()])

    await query.edit_message_text(
        "\n".join(lines), parse_mode="HTML", reply_markup=InlineKeyboardMarkup(rows)
    )


# ---------------------------------------------------------------------------
# Call detail view
# ---------------------------------------------------------------------------


async def detail_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show call detail with interactive buttons."""
    query = update.callback_query
    await query.answer()
    await _typing(query)

    call_id = int(query.data.split(":")[1])
    call = db.get_call(call_id)

    if not call:
        await query.edit_message_text(
            f"Call #{call_id} not found.",
            reply_markup=InlineKeyboardMarkup([[_home_button()]]),
        )
        return

    await _show_call_detail(query, call)


async def _show_call_detail(query, call: dict):
    analysis = call.get("analysis", {})
    scorecard = analysis.get("scorecard", {})
    overall = scorecard.get("overall")
    source_meta = call.get("source_meta", {})

    lines = [
        _header(f"[>] Recording #{call['id']}"),
        _divider(),
        "",
        f"<b>{call['name'][:50]}</b>",
        "",
        f"Status: {_status_badge(call['status'])}",
        f"Source: {_source_badge(call.get('source_type', 'upload'))}",
        f"Duration: {_fmt_duration(call.get('duration_sec'))}",
        f"Language: {call.get('language') or 'N/A'}",
        f"Created: {call['created_at'][:16]}",
    ]

    if call.get("uploader_name"):
        lines.append(f"By: {call['uploader_name']}")
    if call.get("client_name"):
        lines.append(f"Client: {call['client_name']}")
    if source_meta.get("youtube_url"):
        lines.append(f"YouTube: {source_meta['youtube_url'][:50]}")

    # Scorecard with visual bars
    if scorecard:
        lines.append("")
        lines.append(_header("Scorecard"))
        dims = [
            ("opening", "Opening"), ("discovery", "Discovery"),
            ("objection_handling", "Objections"), ("value_prop", "Value"),
            ("closing", "Closing"), ("rapport", "Rapport"),
            ("talk_ratio", "Talk Ratio"),
        ]
        for key, label in dims:
            val = scorecard.get(key)
            if val is not None:
                lines.append(f"  {label}: {_score_bar(val, 6)} {val}")

        if overall is not None:
            lines.append("")
            lines.append(f"  Overall: {_score_bar(overall, 10)} <b>{overall}/100</b>")

    # Summary
    if analysis.get("summary"):
        lines.append("")
        lines.append(_header("Summary"))
        lines.append(analysis["summary"][:400])

    # Coaching
    if analysis.get("coaching_points"):
        lines.append("")
        lines.append(_header("Coaching"))
        for pt in analysis["coaching_points"][:3]:
            lines.append(f"  - {pt[:100]}")

    # Action items
    if analysis.get("action_items"):
        lines.append("")
        lines.append(_header("Action Items"))
        for item in analysis["action_items"][:3]:
            due = f" (due: {item['due_date']})" if item.get("due_date") else ""
            lines.append(f"  [x] {item.get('description', '')[:80]}{due}")

    # Buttons
    buttons = [
        [
            InlineKeyboardButton("[...] Reanalyze", callback_data=f"reanalyze:{call['id']}"),
            InlineKeyboardButton("[Audio] Audio", callback_data=f"audio:{call['id']}"),
        ],
        [
            InlineKeyboardButton("[Tag] Tags", callback_data=f"tags:{call['id']}"),
            InlineKeyboardButton("[X] Delete", callback_data=f"confirm_delete:{call['id']}"),
        ],
        [
            InlineKeyboardButton("< Back to recordings", callback_data="rec_page:0"),
            _home_button(),
        ],
    ]

    await query.edit_message_text(
        "\n".join(lines), parse_mode="HTML", reply_markup=InlineKeyboardMarkup(buttons)
    )


# ---------------------------------------------------------------------------
# Audio playback
# ---------------------------------------------------------------------------


async def audio_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Send audio file for a call."""
    query = update.callback_query
    await query.answer("Sending audio...")
    call_id = int(query.data.split(":")[1])
    call = db.get_call(call_id)

    if not call or not call.get("audio_path"):
        await query.answer("Audio not found", show_alert=True)
        return

    from .audio import resolve_audio_path
    path = resolve_audio_path(call["audio_path"])
    if path is None:
        await query.answer("Audio file missing", show_alert=True)
        return

    try:
        with open(path, "rb") as f:
            await query.message.reply_audio(
                audio=f,
                title=call["name"][:50],
                caption=f"#{call['id']} | {_fmt_duration(call.get('duration_sec'))}",
            )
    except Exception as e:
        await query.message.reply_text(f"Failed to send audio: {e}")


# ---------------------------------------------------------------------------
# Reanalyze
# ---------------------------------------------------------------------------


async def reanalyze_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Trigger re-analysis for a call."""
    query = update.callback_query
    call_id = int(query.data.split(":")[1])

    call = db.get_call(call_id)
    if not call:
        await query.answer("Call not found", show_alert=True)
        return

    if not call.get("transcript").strip():
        await query.answer("No transcript available for analysis", show_alert=True)
        return

    await query.answer("Re-analysis started...")
    await query.message.reply_text(
        f"[...] Re-analyzing call #{call_id}...\n<i>This may take a moment.</i>",
        parse_mode="HTML",
    )

    from .api import _analyze_call
    import concurrent.futures
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    executor.submit(_analyze_call, call_id)


# ---------------------------------------------------------------------------
# Delete confirmation
# ---------------------------------------------------------------------------


async def confirm_delete_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show delete confirmation dialog."""
    query = update.callback_query
    await query.answer()
    call_id = int(query.data.split(":")[1])
    call = db.get_call(call_id)

    if not call:
        await query.edit_message_text("Call not found.", reply_markup=InlineKeyboardMarkup([[_home_button()]]))
        return

    lines = [
        _header("[!] Confirm Delete"),
        "",
        f"Are you sure you want to delete:",
        f"<b>#{call['id']} {call['name'][:40]}</b>",
        "",
        "<i>This action cannot be undone.</i>",
    ]

    buttons = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("[FAIL] Cancel", callback_data=f"detail:{call_id}"),
            InlineKeyboardButton("[X] Delete", callback_data=f"delete:{call_id}"),
        ]
    ])

    await query.edit_message_text("\n".join(lines), parse_mode="HTML", reply_markup=buttons)


async def delete_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Execute call deletion."""
    query = update.callback_query
    call_id = int(query.data.split(":")[1])

    from . import audio as audio_mod
    call = db.get_call(call_id)
    if call and call.get("audio_path"):
        wav = audio_mod.resolve_audio_path(call["audio_path"])
        if wav:
            wav.unlink(missing_ok=True)
        pcm = config.PCM_DIR / (Path(call["audio_path"]).stem + ".pcm")
        pcm.unlink(missing_ok=True)

    with db.get_db() as conn:
        conn.execute("DELETE FROM calls WHERE id = ?", (call_id,))

    await query.answer("Deleted")
    await query.edit_message_text(
        f"[OK] Recording #{call_id} deleted.",
        reply_markup=InlineKeyboardMarkup([[_home_button()]]),
    )


# ---------------------------------------------------------------------------
# Tags
# ---------------------------------------------------------------------------


async def tags_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show tags management for a call."""
    query = update.callback_query
    await query.answer()
    call_id = int(query.data.split(":")[1])

    call_tags = db.get_call_tags(call_id)
    all_tags = db.list_tags()
    call_tag_ids = {t["id"] for t in call_tags}

    lines = [
        _header(f"[Tag] Tags for #{call_id}"),
        _divider(),
    ]

    if call_tags:
        lines.append("")
        lines.append("Current: " + ", ".join(t["name"] for t in call_tags))
    else:
        lines.append("\nNo tags assigned.")

    buttons = []
    row = []
    for t in all_tags:
        if t["id"] in call_tag_ids:
            label = f"[OK] {t['name']}"
            cb = f"untag:{call_id}:{t['id']}"
        else:
            label = f"[ ] {t['name']}"
            cb = f"dotag:{call_id}:{t['id']}"
        row.append(InlineKeyboardButton(label, callback_data=cb))
        if len(row) == 2:
            buttons.append(row)
            row = []
    if row:
        buttons.append(row)

    buttons.append([
        InlineKeyboardButton("< Back", callback_data=f"detail:{call_id}"),
        _home_button(),
    ])

    await query.edit_message_text(
        "\n".join(lines), parse_mode="HTML", reply_markup=InlineKeyboardMarkup(buttons)
    )


async def dotag_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Add a tag to a call."""
    query = update.callback_query
    parts = query.data.split(":")
    call_id, tag_id = int(parts[1]), int(parts[2])
    db.tag_call(call_id, tag_id)
    await query.answer("Tag added")
    # Refresh tags view
    await tags_callback(update, context)


async def untag_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Remove a tag from a call."""
    query = update.callback_query
    parts = query.data.split(":")
    call_id, tag_id = int(parts[1]), int(parts[2])
    db.untag_call(call_id, tag_id)
    await query.answer("Tag removed")
    await tags_callback(update, context)


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------


async def search_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Prompt for search input."""
    query = update.callback_query
    await query.answer()

    await query.edit_message_text(
        _header("[X] Search Recordings"),
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup([
            [_home_button()],
        ]),
    )
    # Set state to expect search query
    context.user_data["awaiting_search"] = True
    await query.message.reply_text(
        "Type your search query:\n\n"
        "<i>Search by recording name or transcript content.</i>",
        parse_mode="HTML",
    )


async def handle_text_search(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle free text as search query."""
    if not context.user_data.get("awaiting_search"):
        return False

    context.user_data["awaiting_search"] = False
    query_text = update.message.text.strip()
    if not query_text:
        return True

    calls = db.list_calls(search=query_text, limit=10)

    if not calls:
        await update.message.reply_text(
            f"No results for <b>\"{query_text[:50]}\"</b>.",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup([[_home_button()]]),
        )
        return True

    lines = [
        _header(f"[Search] \"{query_text[:30]}\" ({len(calls)} results)"),
        _divider(),
        "",
    ]
    for c in calls:
        lines.append(_format_call_card(c, compact=True))
        lines.append("")

    buttons = [
        [InlineKeyboardButton(f"#{c['id']}", callback_data=f"detail:{c['id']}")]
        for c in calls[:5]
    ]
    buttons.append([_home_button()])

    await update.message.reply_text(
        "\n".join(lines), parse_mode="HTML", reply_markup=InlineKeyboardMarkup(buttons)
    )
    return True


# ---------------------------------------------------------------------------
# Stats menu
# ---------------------------------------------------------------------------


async def stats_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show stats overview with interactive buttons."""
    query = update.callback_query
    await query.answer()
    await _typing(query)

    stats = db.get_org_stats()
    source = db.get_source_breakdown()

    lines = [
        _header("[Stats] Statistics"),
        _divider(),
        "",
        f"Total calls: <b>{stats['total_calls']}</b>",
        f"Completed: <b>{stats['done_calls']}</b>",
        f"Processing: <b>{stats['processing_calls']}</b>",
        f"Errors: <b>{stats['error_calls']}</b>",
        f"Today: <b>{stats['calls_today']}</b>",
        "",
        f"Avg score: {_score_chip(stats['avg_score'])}",
        f"Managers: {stats['total_managers']}  |  Clients: {stats['total_clients']}",
    ]

    if source:
        lines.append("")
        lines.append(_header("By Source"))
        for src, cnt in source.items():
            lines.append(f"  {_source_badge(src)}: {cnt}")

    if stats["top_managers"]:
        lines.append("")
        lines.append(_header("Top Managers"))
        for i, m in enumerate(stats["top_managers"][:3], 1):
            score = round(m["avg_score"]) if m.get("avg_score") else "N/A"
            lines.append(f"  {i}. <b>{m['name']}</b> - {m['call_count']} calls - {score}/100")

    buttons = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("[Trend] Comparison", callback_data="analytics:comparison"),
            InlineKeyboardButton("[Trend] Trends", callback_data="analytics:trends"),
        ],
        [
            InlineKeyboardButton("[Rank] Rankings", callback_data="menu:rankings"),
            InlineKeyboardButton("[!] Problems", callback_data="menu:problems"),
        ],
        [_home_button()],
    ])

    await query.edit_message_text(
        "\n".join(lines), parse_mode="HTML", reply_markup=buttons
    )


# ---------------------------------------------------------------------------
# Analytics sub-menus
# ---------------------------------------------------------------------------


async def analytics_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Route analytics sub-menu callbacks."""
    query = update.callback_query
    await query.answer()
    await _typing(query)

    action = query.data.split(":")[1]

    if action == "comparison":
        report = generate_daily_comparison_report()
        title = "[Trend] Day-over-Day"
    elif action == "trends":
        report = generate_weekly_trend_report()
        title = "[Trend] Weekly Trends"
    elif action == "problems":
        report = generate_problem_calls_report()
        title = "[!] Problem Calls"
    elif action == "rankings":
        report = generate_manager_rankings_report()
        title = "[Rank] Manager Rankings"
    elif action == "report":
        report = generate_full_report()
        title = "[Stats] Full Report"
    else:
        return

    lines = [_header(title), _divider(), "", report]

    buttons = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("[Trend] Comparison", callback_data="analytics:comparison"),
            InlineKeyboardButton("[Trend] Trends", callback_data="analytics:trends"),
        ],
        [
            InlineKeyboardButton("[Rank] Rankings", callback_data="analytics:rankings"),
            InlineKeyboardButton("[Stats] Full Report", callback_data="analytics:report"),
        ],
        [_home_button()],
    ])

    # Split if too long
    text = "\n".join(lines)
    if len(text) > 4000:
        text = text[:3950] + "\n\n<i>...truncated</i>"

    await query.edit_message_text(text, parse_mode="HTML", reply_markup=buttons)


# ---------------------------------------------------------------------------
# Alerts
# ---------------------------------------------------------------------------


async def alerts_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show alerts/problems list."""
    query = update.callback_query
    await query.answer()
    await _typing(query)

    problems = db.get_problem_calls(limit=5)

    if not problems:
        await query.edit_message_text(
            _header("[OK] All Clear!") + "\n\nNo problem calls detected.",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup([[_home_button()]]),
        )
        return

    lines = [
        _header(f"[!] Alerts ({len(problems)} problems)"),
        _divider(),
        "",
    ]
    for p in problems:
        score = p.get("score")
        lines.append(f"[!] <b>#{p['id']}</b> {p['name'][:35]}")
        lines.append(f"  Score: {_score_chip(score)}  |  {_source_badge(p.get('source_type', ''))}")
        if p.get("uploader_name"):
            lines.append(f"  By: {p['uploader_name']}")
        lines.append("")

    buttons = [
        [InlineKeyboardButton(f"#{p['id']} Details", callback_data=f"detail:{p['id']}")]
        for p in problems[:3]
    ]
    buttons.append([
        InlineKeyboardButton("[Stats] Full Report", callback_data="analytics:report"),
        _home_button(),
    ])

    await query.edit_message_text(
        "\n".join(lines), parse_mode="HTML", reply_markup=InlineKeyboardMarkup(buttons)
    )


# ---------------------------------------------------------------------------
# Rankings
# ---------------------------------------------------------------------------


async def rankings_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show manager rankings."""
    query = update.callback_query
    await query.answer()
    await _typing(query)

    rankings = db.get_manager_rankings(limit=10)

    if not rankings:
        await query.edit_message_text(
            _header("[Rank] Manager Rankings") + "\n\nNo manager data available.",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup([[_home_button()]]),
        )
        return

    lines = [
        _header("[Rank] Manager Rankings"),
        _divider(),
        "",
    ]
    for i, m in enumerate(rankings[:10], 1):
        medal = ["#1", "#2", "#3"][i - 1] if i <= 3 else f"{i}."
        score = round(m["avg_score"]) if m.get("avg_score") is not None else "N/A"
        trend = _trend_arrow(m.get("trend", "same"))
        lines.append(f"{medal} <b>{m['name']}</b>")
        lines.append(f"    {_score_chip(m.get('avg_score'))}")
        lines.append(f"    Calls: {m['total_calls']}  Today: {m['calls_today']} {trend}")
        lines.append("")

    buttons = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("[Trend] Full Report", callback_data="analytics:report"),
            _home_button(),
        ],
    ])

    await query.edit_message_text(
        "\n".join(lines), parse_mode="HTML", reply_markup=buttons
    )


# ---------------------------------------------------------------------------
# Admin panel
# ---------------------------------------------------------------------------


async def admin_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show admin control panel."""
    query = update.callback_query
    await query.answer()

    user = query.from_user
    if not _is_admin(user.id):
        await query.edit_message_text(
            "[X] Admin access required.\nSet TELEGRAM_ADMIN_IDS in .env.",
            reply_markup=InlineKeyboardMarkup([[_home_button()]]),
        )
        return

    await _typing(query)
    stats = db.get_org_stats()
    wl = db.list_youtube_whitelist()
    tags = db.list_tags()

    lines = [
        _header("[*] Admin Panel"),
        _divider(),
        "",
        f"Calls: <b>{stats['total_calls']}</b> | Done: <b>{stats['done_calls']}</b>",
        f"Managers: <b>{stats['total_managers']}</b> | Clients: <b>{stats['total_clients']}</b>",
        f"YouTube WL: {len(wl)} entries | Tags: {len(tags)}",
    ]

    buttons = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("[Audio] Recordings", callback_data="rec_page:0"),
            InlineKeyboardButton("[Rank] Rankings", callback_data="menu:rankings"),
        ],
        [
            InlineKeyboardButton("[!] Problems", callback_data="menu:problems"),
            InlineKeyboardButton("[Trend] Report", callback_data="analytics:report"),
        ],
        [
            InlineKeyboardButton("> YouTube Whitelist", callback_data="admin:yt_wl"),
            InlineKeyboardButton("[Tag] Manage Tags", callback_data="admin:tags"),
        ],
        [_home_button()],
    ])

    await query.edit_message_text(
        "\n".join(lines), parse_mode="HTML", reply_markup=buttons
    )


async def admin_sub_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle admin sub-menu callbacks."""
    query = update.callback_query
    await query.answer()
    action = query.data.split(":")[1]

    if action == "yt_wl":
        wl = db.list_youtube_whitelist()
        lines = [_header("> YouTube Whitelist"), _divider(), ""]
        if not wl:
            lines.append("No entries. All channels are allowed.")
        else:
            for e in wl:
                ch = e.get("channel_name") or e.get("channel_id") or e.get("pattern", "?")
                lines.append(f"  - {ch}")
        buttons = InlineKeyboardMarkup([[_home_button()]])
        await query.edit_message_text("\n".join(lines), parse_mode="HTML", reply_markup=buttons)

    elif action == "tags":
        tags = db.list_tags()
        lines = [_header("[Tag] Tags"), _divider(), ""]
        if not tags:
            lines.append("No tags defined.")
        else:
            for t in tags:
                lines.append(f"  - {t['name']}  <code>{t['color']}</code>")
        buttons = InlineKeyboardMarkup([[_home_button()]])
        await query.edit_message_text("\n".join(lines), parse_mode="HTML", reply_markup=buttons)


# ---------------------------------------------------------------------------
# YouTube ingestion
# ---------------------------------------------------------------------------


async def youtube_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Prompt for YouTube URL."""
    query = update.callback_query
    await query.answer()

    user = query.from_user
    if not _is_admin(user.id):
        await query.edit_message_text(
            "[X] Admin only.",
            reply_markup=InlineKeyboardMarkup([[_home_button()]]),
        )
        return

    context.user_data["awaiting_yt_url"] = True
    await query.edit_message_text(
        _header("> YouTube Transcription"),
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup([[_home_button()]]),
    )
    await query.message.reply_text(
        "Paste a YouTube URL:\n\n"
        "<i>The audio will be extracted, transcribed, and analyzed.</i>",
        parse_mode="HTML",
    )


async def handle_text_youtube(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle free text as YouTube URL."""
    if not context.user_data.get("awaiting_yt_url"):
        return False

    context.user_data["awaiting_yt_url"] = False
    url = update.message.text.strip()

    if not url:
        return True

    video_id = extract_video_id(url)
    if not video_id:
        await update.message.reply_text(
            "[FAIL] Invalid YouTube URL.",
            reply_markup=InlineKeyboardMarkup([[_home_button()]]),
        )
        return True

    status_msg = await update.message.reply_text("[...] Processing YouTube video...")

    user = await _linked_user(update.effective_user.id)
    user_id = user["id"] if user else None

    try:
        call_id = await asyncio.get_event_loop().run_in_executor(
            None, process_youtube_video, url, user_id
        )
    except Exception as e:
        logger.error("YouTube processing failed: %s", e)
        await status_msg.edit_text(f"[FAIL] Failed: {e}")
        return True

    if call_id is None:
        await status_msg.edit_text(
            "[FAIL] Failed to process. Check whitelist settings.",
            reply_markup=InlineKeyboardMarkup([[_home_button()]]),
        )
        return True

    call = db.get_call(call_id)
    lines = [
        _header("[OK] Video Queued!"),
        "",
        f"ID: <b>#{call_id}</b>",
        f"Name: {call['name'][:50]}",
        f"Duration: {_fmt_duration(call.get('duration_sec'))}",
        "",
        "<i>Transcription and analysis will run in the background.</i>",
    ]

    buttons = InlineKeyboardMarkup([
        [InlineKeyboardButton(f"#{call_id} Details", callback_data=f"detail:{call_id}")],
        [_home_button()],
    ])

    await status_msg.edit_text("\n".join(lines), parse_mode="HTML", reply_markup=buttons)
    return True


# ---------------------------------------------------------------------------
# Telegram audio/video file handlers
# ---------------------------------------------------------------------------


async def _handle_audio_file(update: Update, context: ContextTypes.DEFAULT_TYPE, source_type: str):
    """Handle incoming voice, audio, video_note, or video messages."""
    if not update.message:
        return

    linked = await _linked_user(update.effective_user.id)
    if not linked:
        await update.message.reply_text(
            "You are not linked to a manager account.\n\n"
            "Use /link YOUR_API_TOKEN to link your account first.\n"
            "Get your API token from the web dashboard (Profile > API Token).",
            reply_markup=InlineKeyboardMarkup([[_home_button()]]),
        )
        return

    user_id = linked["id"]

    msg = update.message
    file_obj = None
    file_name = "telegram_audio"

    if msg.voice:
        file_obj = await msg.voice.get_file()
        file_name = f"voice_{msg.voice.file_id[:8]}"
    elif msg.audio:
        file_obj = await msg.audio.get_file()
        file_name = msg.audio.file_name or f"audio_{msg.audio.file_id[:8]}"
    elif msg.video_note:
        file_obj = await msg.video_note.get_file()
        file_name = f"video_note_{msg.video_note.file_id[:8]}"
    elif msg.video:
        file_obj = await msg.video.get_file()
        file_name = msg.video.file_name or f"video_{msg.video.file_id[:8]}"

    if not file_obj:
        return

    status_msg = await msg.reply_text(
        f"[...] Receiving {_source_badge(source_type).split(' ', 1)[-1].lower()}..."
    )

    try:
        suffix = Path(file_name).suffix or ".ogg"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            await file_obj.download_to_drive(tmp.name)
            tmp_path = Path(tmp.name)

        await status_msg.edit_text("[...] Normalizing audio...")

        wav_path, pcm_path = audio.normalize_audio(tmp_path)
        dur = audio.duration_sec(wav_path)

        source_meta = {
            "telegram_file_id": file_obj.file_id,
            "telegram_user_id": update.effective_user.id,
            "original_filename": file_name,
        }

        call_id = db.create_call(
            name=file_name,
            audio_path=str(wav_path),
            duration_sec=dur,
            call_type="manager",
            user_id=user_id,
            source_type=source_type,
            source_meta=source_meta,
        )
        db.update_call(call_id, status="queued")

        from .api import _process_call, _analyze_call
        import concurrent.futures
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=2)
        executor.submit(_process_call, call_id)
        executor.submit(_analyze_call, call_id)

        lines = [
            _header("[OK] Audio Received!"),
            "",
            f"ID: <b>#{call_id}</b>",
            f"Duration: {_fmt_duration(dur)}",
            "",
            "[...] <i>Transcription and analysis in progress...</i>",
            "<i>You'll see results when ready.</i>",
        ]

        buttons = InlineKeyboardMarkup([
            [InlineKeyboardButton(f"#{call_id} Details", callback_data=f"detail:{call_id}")],
            [_home_button()],
        ])

        await status_msg.edit_text("\n".join(lines), parse_mode="HTML", reply_markup=buttons)

    except Exception as e:
        logger.exception("Failed to process Telegram audio")
        await status_msg.edit_text(
            f"[FAIL] Failed to process audio: {e}",
            reply_markup=InlineKeyboardMarkup([[_home_button()]]),
        )
    finally:
        tmp_path.unlink(missing_ok=True)


async def voice_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await _handle_audio_file(update, context, "telegram_voice")

async def audio_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await _handle_audio_file(update, context, "telegram_audio")

async def video_note_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await _handle_audio_file(update, context, "telegram_video")

async def video_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await _handle_audio_file(update, context, "telegram_video")


async def _handle_audio_file_document(
    update: Update, context: ContextTypes.DEFAULT_TYPE,
    source_type: str, document, file_name: str,
):
    """Handle audio files sent as documents (mp3, wav, etc.)."""
    if not update.message:
        return

    linked = await _linked_user(update.effective_user.id)
    if not linked:
        await update.message.reply_text(
            "You are not linked to a manager account.\n\n"
            "Use /link YOUR_API_TOKEN to link your account first.\n"
            "Get your API token from the web dashboard (Profile > API Token).",
            reply_markup=InlineKeyboardMarkup([[_home_button()]]),
        )
        return

    user_id = linked["id"]

    file_obj = await document.get_file()
    status_msg = await update.message.reply_text(
        f"[...] Receiving <b>{file_name[:40]}</b>...",
        parse_mode="HTML",
    )

    try:
        suffix = Path(file_name).suffix or ".mp3"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            await file_obj.download_to_drive(tmp.name)
            tmp_path = Path(tmp.name)

        await status_msg.edit_text("[...] Normalizing audio...")

        wav_path, pcm_path = audio.normalize_audio(tmp_path)
        dur = audio.duration_sec(wav_path)

        source_meta = {
            "telegram_file_id": file_obj.file_id,
            "telegram_user_id": update.effective_user.id,
            "original_filename": file_name,
        }

        call_id = db.create_call(
            name=file_name,
            audio_path=str(wav_path),
            duration_sec=dur,
            call_type="manager",
            user_id=user_id,
            source_type=source_type,
            source_meta=source_meta,
        )
        db.update_call(call_id, status="queued")

        from .api import _process_call, _analyze_call
        import concurrent.futures
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=2)
        executor.submit(_process_call, call_id)
        executor.submit(_analyze_call, call_id)

        lines = [
            _header("[OK] File Received!"),
            "",
            f"ID: <b>#{call_id}</b>",
            f"File: {file_name[:50]}",
            f"Duration: {_fmt_duration(dur)}",
            "",
            "[...] <i>Transcription and analysis in progress...</i>",
        ]

        buttons = InlineKeyboardMarkup([
            [InlineKeyboardButton(f"#{call_id} Details", callback_data=f"detail:{call_id}")],
            [_home_button()],
        ])

        await status_msg.edit_text("\n".join(lines), parse_mode="HTML", reply_markup=buttons)

    except Exception as e:
        logger.exception("Failed to process document audio")
        await status_msg.edit_text(
            f"[FAIL] Failed to process: {e}",
            reply_markup=InlineKeyboardMarkup([[_home_button()]]),
        )
    finally:
        tmp_path.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Start / help / link / unsubscribe
# ---------------------------------------------------------------------------


async def start_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not update.effective_user:
        return
    user = update.effective_user

    existing = await _linked_user(user.id)
    if existing:
        await _show_home(update, context)
        return

    db.add_telegram_user(
        user_id=None,
        telegram_id=user.id,
        username=user.username,
        first_name=user.first_name,
        last_name=user.last_name,
    )

    lines = [
        _header("ViaCall Bot"),
        "",
        "You are not linked to a manager account yet.",
        "",
        "To link your account, get your API token from the",
        "web dashboard (Profile > API Token) and send:",
        "",
        "  /link YOUR_API_TOKEN",
        "",
        "Only linked managers can send audio files.",
    ]
    await update.message.reply_text(
        "\n".join(lines), parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup([[_home_button()]]),
    )


async def link_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Link Telegram account to a manager via API token."""
    if not update.effective_user:
        return

    if not context.args:
        await update.message.reply_text(
            "Usage: /link YOUR_API_TOKEN\n\n"
            "Get your API token from the web dashboard (Profile > API Token).",
        )
        return

    token = context.args[0].strip()
    user = db.get_user_by_token(token)

    if not user:
        await update.message.reply_text(
            "[FAIL] Invalid token. Get your API token from the web dashboard.",
            reply_markup=InlineKeyboardMarkup([[_home_button()]]),
        )
        return

    if user["role"] not in ("admin", "manager"):
        await update.message.reply_text(
            "Only managers and admins can link accounts.",
            reply_markup=InlineKeyboardMarkup([[_home_button()]]),
        )
        return

    db.add_telegram_user(
        user_id=user["id"],
        telegram_id=update.effective_user.id,
        username=update.effective_user.username,
        first_name=update.effective_user.first_name,
        last_name=update.effective_user.last_name,
    )

    await update.message.reply_text(
        f"[OK] Linked to: {user['name']} ({user['email']})\n\n"
        "You can now send audio files for transcription.",
        reply_markup=InlineKeyboardMarkup([[_home_button()]]),
    )


async def help_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    linked = await _linked_user(update.effective_user.id) if update.effective_user else None
    is_adm = _is_admin(update.effective_user.id) if update.effective_user else False

    lines = [
        _header("ViaCall Bot Commands"),
        "",
        "/start - Open main menu",
        "/link &lt;token&gt; - Link your manager account",
        "/status - Quick status check",
        "/unsubscribe - Stop daily reports",
        "",
    ]
    if linked:
        lines.extend([
            "Send audio files to transcribe and analyze them.",
            "",
            "Available commands in menu:",
            "  Recordings - Browse all recordings",
            "  Search - Search by name or transcript",
            "  Stats - View statistics",
            "  Trends - Weekly trends",
            "  Alerts - Problem calls",
            "  Rankings - Manager rankings",
        ])
        if is_adm:
            lines.append("  Admin - Admin control panel")
    else:
        lines.append("Use /link YOUR_API_TOKEN to link your account first.")

    await update.message.reply_text(
        "\n".join(lines), parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup([[_home_button()]]),
    )


async def unsubscribe_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not update.effective_user:
        return
    with db.get_db() as conn:
        conn.execute("UPDATE telegram_users SET active = 0 WHERE telegram_id = ?", (update.effective_user.id,))
    await update.message.reply_text(
        "[OK] Unsubscribed from daily reports.",
        reply_markup=InlineKeyboardMarkup([[
            InlineKeyboardButton("[OK] Resubscribe", callback_data="home"),
        ]]),
    )


# ---------------------------------------------------------------------------
# Noop handler (for page indicator buttons)
# ---------------------------------------------------------------------------


async def noop_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.callback_query.answer()


# ---------------------------------------------------------------------------
# Fallback text handler
# ---------------------------------------------------------------------------


async def fallback_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle unexpected text messages with a helpful hint."""
    await update.message.reply_text(
        "I didn't understand that. ?\n\n"
        "Send me a <b>voice message</b> or <b>audio file</b> to transcribe it,\n"
        "or tap the button below to open the menu.",
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup([[_home_button()]]),
    )


# ---------------------------------------------------------------------------
# Scheduled jobs
# ---------------------------------------------------------------------------


async def send_daily_report(application: Application):
    telegram_users = db.get_telegram_users()
    if not telegram_users:
        return

    stats = db.get_org_stats()
    comparison = generate_daily_comparison_report()
    trend = generate_weekly_trend_report()

    msg = (
        _header("[Trend] Daily Report") + "\n\n"
        f"Total: {stats['total_calls']} | Done: {stats['done_calls']} | Today: {stats['calls_today']}\n"
        f"Avg score: {_score_chip(stats['avg_score'])}\n\n"
        + _divider() + "\n\n"
        + comparison + "\n\n"
        + _divider() + "\n\n"
        + trend
    )

    for tu in telegram_users:
        try:
            await application.bot.send_message(
                chat_id=tu["telegram_id"], text=msg, parse_mode="HTML"
            )
        except Exception as e:
            logger.warning("Failed to send daily report to %s: %s", tu["telegram_id"], e)


async def send_problem_alerts(application: Application):
    problems = db.get_problem_calls(limit=3)
    if not problems:
        return

    lines = [_header("[!] Problem Call Alert"), _divider(), ""]
    for p in problems:
        score = p.get("score")
        lines.append(f"#{p['id']} {p['name'][:40]} - Score: {score or 'N/A'}")

    msg = "\n".join(lines)
    for admin_id in config.TELEGRAM_ADMIN_IDS:
        try:
            await application.bot.send_message(chat_id=admin_id, text=msg, parse_mode="HTML")
        except Exception as e:
            logger.warning("Failed to send alert to admin %s: %s", admin_id, e)


# ---------------------------------------------------------------------------
# Bot creation
# ---------------------------------------------------------------------------


async def post_init(application: Application):
    commands = [
        BotCommand("start", "Open main menu"),
        BotCommand("help", "Show commands"),
        BotCommand("link", "Link your manager account"),
        BotCommand("recordings", "Browse recordings"),
        BotCommand("search", "Search recordings"),
        BotCommand("stats", "View statistics"),
        BotCommand("admin", "Admin panel"),
        BotCommand("unsubscribe", "Stop daily reports"),
    ]
    await application.bot.set_my_commands(commands)


def create_bot_application() -> Application | None:
    token = config.TELEGRAM_BOT_TOKEN
    if not token:
        logger.warning("TELEGRAM_BOT_TOKEN not set, Telegram bot disabled")
        return None

    application = (
        Application.builder()
        .token(token)
        .post_init(post_init)
        .build()
    )

    # --- Command handlers ---
    application.add_handler(CommandHandler("start", start_cmd))
    application.add_handler(CommandHandler("help", help_cmd))
    application.add_handler(CommandHandler("link", link_cmd))
    application.add_handler(CommandHandler("unsubscribe", unsubscribe_cmd))

    # --- Callback query handlers (inline keyboards) ---
    # Navigation
    application.add_handler(CallbackQueryHandler(home_callback, pattern=r"^home$"))
    application.add_handler(CallbackQueryHandler(noop_callback, pattern=r"^noop$"))

    # Main menu sections
    application.add_handler(CallbackQueryHandler(recordings_callback, pattern=r"^menu:recordings"))
    application.add_handler(CallbackQueryHandler(search_callback, pattern=r"^menu:search"))
    application.add_handler(CallbackQueryHandler(stats_callback, pattern=r"^menu:stats"))
    application.add_handler(CallbackQueryHandler(alerts_callback, pattern=r"^menu:alerts"))
    application.add_handler(CallbackQueryHandler(rankings_callback, pattern=r"^menu:rankings"))
    application.add_handler(CallbackQueryHandler(admin_callback, pattern=r"^menu:admin"))
    application.add_handler(CallbackQueryHandler(youtube_callback, pattern=r"^menu:youtube"))

    # Recordings
    application.add_handler(CallbackQueryHandler(recordings_page_callback, pattern=r"^rec_page:"))
    application.add_handler(CallbackQueryHandler(detail_callback, pattern=r"^detail:"))
    application.add_handler(CallbackQueryHandler(audio_callback, pattern=r"^audio:"))
    application.add_handler(CallbackQueryHandler(reanalyze_callback, pattern=r"^reanalyze:"))
    application.add_handler(CallbackQueryHandler(confirm_delete_callback, pattern=r"^confirm_delete:"))
    application.add_handler(CallbackQueryHandler(delete_callback, pattern=r"^delete:"))
    application.add_handler(CallbackQueryHandler(tags_callback, pattern=r"^tags:"))
    application.add_handler(CallbackQueryHandler(dotag_callback, pattern=r"^dotag:"))
    application.add_handler(CallbackQueryHandler(untag_callback, pattern=r"^untag:"))

    # Analytics
    application.add_handler(CallbackQueryHandler(analytics_callback, pattern=r"^analytics:"))

    # Admin sub-menus
    application.add_handler(CallbackQueryHandler(admin_sub_callback, pattern=r"^admin:"))

    # --- Message handlers ---
    application.add_handler(MessageHandler(filters.VOICE, voice_handler))
    application.add_handler(MessageHandler(filters.AUDIO, audio_handler))
    application.add_handler(MessageHandler(filters.VIDEO_NOTE, video_note_handler))
    application.add_handler(MessageHandler(filters.VIDEO, video_handler))

    # Document handler - catch audio files sent as documents (mp3, wav, ogg, m4a, etc.)
    AUDIO_EXTS = {".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac", ".wma", ".opus", ".oga"}

    async def document_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
        if not update.message or not update.message.document:
            return
        doc = update.message.document
        file_name = doc.file_name or ""
        ext = Path(file_name).suffix.lower()
        mime = (doc.mime_type or "").lower()
        is_audio_doc = ext in AUDIO_EXTS or mime.startswith("audio/")
        if is_audio_doc:
            await _handle_audio_file_document(update, context, "upload", doc, file_name)
        # else: ignore non-audio documents silently

    application.add_handler(MessageHandler(filters.Document.ALL, document_handler))

    # Text handlers (for search/YouTube input) - must be last
    async def text_router(update: Update, context: ContextTypes.DEFAULT_TYPE):
        if await handle_text_search(update, context):
            return
        if await handle_text_youtube(update, context):
            return
        await fallback_text(update, context)

    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_router))

    # --- Scheduler ---
    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        send_daily_report,
        CronTrigger(hour=8, minute=0),
        args=[application],
        id="daily_report",
        replace_existing=True,
    )
    scheduler.add_job(
        send_problem_alerts,
        CronTrigger(hour=9, minute=0),
        args=[application],
        id="problem_alerts",
        replace_existing=True,
    )
    scheduler.start()
    logger.info("Telegram bot scheduler started (daily at 08:00, alerts at 09:00)")

    return application
