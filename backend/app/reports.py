"""Report generation and export for ViaCall analytics.

Produces formatted text reports for Telegram delivery, covering
day-over-day comparison, trends, problem calls, and manager rankings.
"""

from datetime import datetime, timezone

from . import db


def _fmt_num(val, suffix: str = "") -> str:
    if val is None:
        return "N/A"
    return f"{val}{suffix}"


def _fmt_pct(val) -> str:
    if val is None:
        return "N/A"
    return f"{round(val * 100)}%"


def _trend_emoji(trend: str) -> str:
    if trend == "up":
        return "+"
    if trend == "down":
        return "-"
    return "="


def generate_daily_comparison_report() -> str:
    """Generate a day-over-day comparison report."""
    stats = db.get_day_over_day_stats()
    today = stats["today"]
    yesterday = stats["yesterday"]

    def _delta(t: int | float | None, y: int | float | None) -> str:
        if t is None or y is None:
            return ""
        d = (t or 0) - (y or 0)
        if d > 0:
            return f" (+{d})"
        if d < 0:
            return f" ({d})"
        return " (=)"

    lines = [
        "<b>Day-over-Day Comparison</b>",
        "",
        f"<b>Calls:</b> {today['calls']}{_delta(today['calls'], yesterday['calls'])}",
        f"<b>Completed:</b> {today['done']}{_delta(today['done'], yesterday['done'])}",
        f"<b>Avg Score:</b> {_fmt_num(today['avg_score'])}/100{_delta(today['avg_score'], yesterday['avg_score'])}",
        f"<b>Avg Duration:</b> {_fmt_num(today['avg_duration'], 's')}{_delta(today['avg_duration'], yesterday['avg_duration'])}",
        f"<b>Avg Talk Ratio:</b> {_fmt_pct(today['avg_talk_ratio'])}{_delta(today['avg_talk_ratio'], yesterday['avg_talk_ratio'])}",
    ]
    return "\n".join(lines)


def generate_weekly_trend_report() -> str:
    """Generate a weekly trend report."""
    trend = db.get_weekly_trend()
    if not trend:
        return "<b>Weekly Trend</b>\n\nNo data available for the last 7 days."

    lines = [
        "<b>Weekly Trend (last 7 days)</b>",
        "",
    ]
    for day in trend:
        score = f"{day['avg_score']}/100" if day['avg_score'] is not None else "N/A"
        dur = f"{day['avg_duration']}s" if day['avg_duration'] is not None else "N/A"
        lines.append(
            f"  {day['day']}: {day['done_calls']}/{day['total_calls']} calls | Score: {score} | Dur: {dur}"
        )

    # Calculate trend direction
    if len(trend) >= 2:
        recent = trend[-1]["avg_score"] or 0
        prev = trend[-2]["avg_score"] or 0
        if recent > prev:
            lines.append("")
            lines.append("Trend: <b>improving</b>")
        elif recent < prev:
            lines.append("")
            lines.append("Trend: <b>declining</b>")

    return "\n".join(lines)


def generate_problem_calls_report(limit: int = 5) -> str:
    """Generate a report of problem calls (low scores)."""
    problems = db.get_problem_calls(limit=limit)
    if not problems:
        return "<b>Problem Calls</b>\n\nNo problem calls detected. All calls scoring above 50."

    lines = [
        f"<b>Problem Calls (lowest {len(problems)} scores)</b>",
        "",
    ]
    for p in problems:
        score = f"{p['score']}/100" if p['score'] is not None else "N/A"
        lines.append(f"#{p['id']} {p['name']}")
        lines.append(f"  Score: {score} | {p['source_type']} | {p['uploader_name'] or 'Unknown'}")
        if p.get("summary"):
            lines.append(f"  {p['summary'][:120]}...")
        lines.append("")

    return "\n".join(lines)


def generate_manager_rankings_report(limit: int = 5) -> str:
    """Generate a manager performance ranking report."""
    rankings = db.get_manager_rankings(limit=limit)
    if not rankings:
        return "<b>Manager Rankings</b>\n\nNo manager data available."

    lines = [
        "<b>Manager Performance Rankings</b>",
        "",
    ]
    for i, m in enumerate(rankings, 1):
        score = f"{m['avg_score']}/100" if m['avg_score'] is not None else "N/A"
        trend = _trend_emoji(m.get("trend", "same"))
        lines.append(f"{i}. <b>{m['name']}</b>")
        lines.append(f"   Calls: {m['total_calls']} | Score: {score} | Best: {_fmt_num(m['best_score'])}/100")
        lines.append(f"   Today: {m['calls_today']} | Yesterday: {m['calls_yesterday']} {trend}")
        lines.append("")

    return "\n".join(lines)


def generate_full_report() -> str:
    """Generate a comprehensive analytics report combining all sections."""
    sections = [
        generate_daily_comparison_report(),
        "",
        "—" * 30,
        "",
        generate_weekly_trend_report(),
        "",
        "—" * 30,
        "",
        generate_problem_calls_report(),
        "",
        "—" * 30,
        "",
        generate_manager_rankings_report(),
        "",
        f"<i>Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}</i>",
    ]
    return "\n".join(sections)
