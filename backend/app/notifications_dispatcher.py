"""Outbound notification dispatcher for Suhbatdosh.

Handles sending problem alerts, escalations, and action notices via:
1. Email (Gmail / SMTP with HTML & plain text formatting)
2. Telegram (Bot API with HTML formatting)
"""

import email.utils
import html
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import httpx

from . import db

logger = logging.getLogger("suhbatdosh.notifications_dispatcher")


def _build_email_html(
    call_id: int,
    call_name: str,
    detected_problem: str,
    assigned_user_name: str,
    assigned_reason: str,
    action_plan: list[str],
    severity: str = "high",
    rep_name: str = "",
    evidence_quotes: list[str] | None = None,
    dashboard_url: str = "",
) -> str:
    """Render a clean, responsive HTML email for the assigned employee."""
    severity_color = {
        "critical": "#dc2626",
        "high": "#ea580c",
        "medium": "#d97706",
        "low": "#2563eb",
    }.get(severity.lower(), "#ea580c")

    plan_items = "".join(
        f'<li style="margin-bottom: 8px; color: #1e293b;">{html.escape(step)}</li>'
        for step in (action_plan or [])
        if step.strip()
    ) or '<li style="color: #64748b;">Qoʻngʻiroqni tahlil qiling va kerakli choralarni koʻring.</li>'

    quotes_block = ""
    if evidence_quotes:
        quote_items = "".join(
            f'<div style="background: #f1f5f9; padding: 10px 14px; border-left: 3px solid #64748b; margin-bottom: 8px; font-style: italic; font-size: 13px; color: #334155;">&ldquo;{html.escape(q)}&rdquo;</div>'
            for q in evidence_quotes[:3]
            if q.strip()
        )
        if quote_items:
            quotes_block = f"""
            <div style="margin-top: 20px;">
                <h4 style="font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; margin-bottom: 8px;">Suhbatdan iqtiboslar:</h4>
                {quote_items}
            </div>
            """

    rep_info = f'<p style="margin: 4px 0; color: #475569; font-size: 14px;"><strong>Qoʻngʻiroqdagi xodim:</strong> {html.escape(rep_name)}</p>' if rep_name else ""
    link_button = f"""
    <div style="margin: 28px 0; text-align: center;">
        <a href="{html.escape(dashboard_url)}" target="_blank"
           style="background-color: #4f46e5; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; font-size: 14px; display: inline-block;">
            Suhbatdoshda toʻliq tahlilni koʻrish &rarr;
        </a>
    </div>
    """ if dashboard_url else ""

    return f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Suhbatdosh Ogohlantirish</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px 12px; line-height: 1.5;">
    <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
        <!-- Header -->
        <div style="background-color: #0f172a; padding: 20px 24px; color: #ffffff;">
            <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #94a3b8; font-weight: 700;">Suhbatdosh AI &bull; Muammo Aniqlash va Eskalatsiya</div>
            <h2 style="margin: 6px 0 0 0; font-size: 20px; font-weight: 700; color: #f8fafc;">
                #{call_id} {html.escape(call_name[:60])}
            </h2>
        </div>

        <!-- Body -->
        <div style="padding: 24px;">
            <!-- Severity banner -->
            <div style="border-left: 4px solid {severity_color}; background-color: #fff7ed; padding: 12px 16px; border-radius: 0 4px 4px 0; margin-bottom: 20px;">
                <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: {severity_color}; margin-bottom: 4px;">
                    {severity.upper()} &bull; Aniqlangan Nuqson / Muammo
                </div>
                <div style="font-size: 15px; font-weight: 600; color: #1e293b;">
                    {html.escape(detected_problem)}
                </div>
            </div>

            <p style="margin: 0 0 16px 0; font-size: 14px; color: #334155;">
                Hurmatli <strong>{html.escape(assigned_user_name)}</strong>, Suhbatdosh AI ushbu suhbatdagi muammoni bartaraf etish uchun vakolatlaringiz va masʼuliyatingizga tayangan holda sizni tayinladi.
            </p>

            {rep_info}

            <!-- Reason Box -->
            <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 14px; margin: 16px 0;">
                <div style="font-size: 12px; font-weight: 700; color: #475569; margin-bottom: 4px;">Nima uchun siz tanlandingiz:</div>
                <div style="font-size: 13px; color: #334155;">{html.escape(assigned_reason)}</div>
            </div>

            <!-- Action Plan -->
            <div style="margin-top: 20px;">
                <h4 style="font-size: 14px; color: #0f172a; margin-bottom: 10px; font-weight: 700;">Tavsiya etilgan harakatlar:</h4>
                <ul style="padding-left: 20px; margin: 0; font-size: 14px;">
                    {plan_items}
                </ul>
            </div>

            {quotes_block}

            {link_button}
        </div>

        <!-- Footer -->
        <div style="background-color: #f1f5f9; padding: 14px 24px; font-size: 12px; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0;">
            Ushbu xabar Suhbatdosh AI avtomatik monitoring tizimi tomonidan yuborildi.
        </div>
    </div>
</body>
</html>
"""


def _build_email_plain(
    call_id: int,
    call_name: str,
    detected_problem: str,
    assigned_user_name: str,
    assigned_reason: str,
    action_plan: list[str],
    severity: str = "high",
    rep_name: str = "",
    dashboard_url: str = "",
) -> str:
    """Render a clean plain-text fallback for email clients."""
    plan = "\n".join(f"- {step}" for step in (action_plan or []))
    lines = [
        f"[DIQQAT] Suhbatdosh AI: Muammo Aniqlangan (#{call_id} {call_name})",
        f"Darajasi: {severity.upper()}",
        "",
        f"Hurmatli {assigned_user_name},",
        f"Qoʻngʻiroqdagi nuqson/muammo: {detected_problem}",
        "",
    ]
    if rep_name:
        lines.append(f"Qoʻngʻiroqdagi xodim: {rep_name}")
    lines.extend([
        f"Tayinlash sababi: {assigned_reason}",
        "",
        "Tavsiya etilgan harakatlar:",
        plan,
        "",
    ])
    if dashboard_url:
        lines.append(f"Batafsil koʻrish: {dashboard_url}")
    return "\n".join(lines)


def send_email(
    to_email: str,
    subject: str,
    html_body: str,
    plain_body: str,
    settings: dict,
) -> tuple[bool, str]:
    """Send an email using SMTP credentials from settings.

    Returns (success: bool, message: str).
    """
    if not to_email or "@" not in to_email:
        return False, "Recipient email is missing or invalid"

    host = (settings.get("smtp_host") or "smtp.gmail.com").strip()
    port = int(settings.get("smtp_port") or 587)
    user = (settings.get("smtp_user") or "").strip()
    password = (settings.get("smtp_password") or "").strip()
    from_name = (settings.get("smtp_from_name") or "Suhbatdosh AI").strip()

    if not user or not password:
        return False, "SMTP user or password is not configured in settings"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = email.utils.formataddr((from_name, user))
    msg["To"] = to_email
    msg["Date"] = email.utils.formatdate(localtime=True)

    msg.attach(MIMEText(plain_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    try:
        if port == 465:
            with smtplib.SMTP_SSL(host, port, timeout=15) as server:
                server.login(user, password)
                server.sendmail(user, [to_email], msg.as_string())
        else:
            with smtplib.SMTP(host, port, timeout=15) as server:
                server.ehlo()
                server.starttls()
                server.ehlo()
                server.login(user, password)
                server.sendmail(user, [to_email], msg.as_string())
        logger.info("Email successfully sent to %s (subject: %s)", to_email, subject)
        return True, "sent"
    except Exception as exc:
        err_msg = f"{type(exc).__name__}: {str(exc)}"
        logger.warning("Failed to send email to %s: %s", to_email, err_msg)
        return False, err_msg


def send_telegram_alert(
    chat_id: str | int,
    text: str,
    bot_token: str,
) -> tuple[bool, str]:
    """Send a Telegram message via Bot API."""
    token = (bot_token or "").strip()
    target_chat = str(chat_id or "").strip()
    if not token:
        return False, "Telegram bot token is not configured"
    if not target_chat:
        return False, "Telegram chat ID is missing"

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": target_chat,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": False,
    }

    try:
        with httpx.Client(timeout=10) as client:
            resp = client.post(url, json=payload)
            data = resp.json()
            if resp.status_code == 200 and data.get("ok"):
                logger.info("Telegram alert sent to chat %s", target_chat)
                return True, "sent"
            err = data.get("description") or f"HTTP {resp.status_code}"
            if "chat not found" in err.lower():
                bot_hint = ""
                try:
                    me_resp = client.get(f"https://api.telegram.org/bot{token}/getMe")
                    me_data = me_resp.json()
                    uname = (me_data.get("result") or {}).get("username")
                    if uname:
                        bot_hint = f" (@{uname})"
                except Exception:
                    pass
                err = (
                    f"{err} — Chat ID '{target_chat}' topilmadi. "
                    f"Telegramda{bot_hint} botiga /start bosing yoki botni guruhga qo'shing "
                    f"(superguruh/kanal IDsi -100 bilan boshlanishi kerak; /chatid buyrug'i bilan tekshiring)."
                )
            logger.warning("Telegram send failed for chat %s: %s", target_chat, err)
            return False, err
    except Exception as exc:
        err_msg = f"{type(exc).__name__}: {str(exc)}"
        logger.warning("Telegram alert error for chat %s: %s", target_chat, err_msg)
        return False, err_msg


def dispatch_problem_escalation(
    escalation_id: int,
    org_id: int = 1,
    dashboard_base_url: str | None = None,
) -> dict:
    """Send notifications for an existing escalation via Email and/or Telegram."""
    from . import config
    dashboard_base_url = (dashboard_base_url or config.APP_BASE_URL).rstrip("/")
    esc = db.get_escalation(escalation_id)
    if not esc:
        return {"error": "Escalation not found"}

    settings = db.get_notification_settings(org_id=org_id)
    results = {}

    assigned_email = (esc.get("assigned_user_email") or "").strip()
    assigned_name = (esc.get("assigned_user_name") or "Xodim").strip()
    call_id = esc.get("call_id")
    call_name = esc.get("call_name") or f"Call #{call_id}"
    problem = esc.get("detected_problem") or "Nuqson aniqlandi"
    reason = esc.get("assigned_reason") or "Vakolat doirasida hal qilish uchun"
    plan = esc.get("action_plan") or []
    if isinstance(plan, str):
        plan = [plan]
    severity = esc.get("severity") or "high"
    rep_name = esc.get("call_user_name") or ""
    call_url = f"{dashboard_base_url.rstrip('/')}/calls/{call_id}" if dashboard_base_url else ""

    # 1. Email dispatch (Gmail / SMTP)
    email_status = "disabled"
    if settings.get("smtp_enabled") and assigned_email:
        subject = f"[DIQQAT] #{call_id} Nuqson aniqlandi: {call_name[:40]} — Hal qilish tayinlandi"
        html_content = _build_email_html(
            call_id=call_id,
            call_name=call_name,
            detected_problem=problem,
            assigned_user_name=assigned_name,
            assigned_reason=reason,
            action_plan=plan,
            severity=severity,
            rep_name=rep_name,
            dashboard_url=call_url,
        )
        plain_content = _build_email_plain(
            call_id=call_id,
            call_name=call_name,
            detected_problem=problem,
            assigned_user_name=assigned_name,
            assigned_reason=reason,
            action_plan=plan,
            severity=severity,
            rep_name=rep_name,
            dashboard_url=call_url,
        )
        ok, msg = send_email(
            to_email=assigned_email,
            subject=subject,
            html_body=html_content,
            plain_body=plain_content,
            settings=settings,
        )
        email_status = "sent" if ok else f"failed: {msg}"
    elif not assigned_email:
        email_status = "no_email_for_user"
    results["email"] = email_status

    # 2. Telegram dispatch
    telegram_status = "disabled"
    tg_token = settings.get("telegram_bot_token")
    assigned_tg = ""
    # Check if assigned user has telegram_id (either on users.telegram_id or linked in telegram_users)
    if esc.get("assigned_to_user_id"):
        user_row = db.get_user(esc["assigned_to_user_id"])
        if user_row:
            assigned_tg = (user_row.get("telegram_id") or "").strip()
        if not assigned_tg:
            with db.get_db() as conn:
                tu_row = conn.execute(
                    "SELECT telegram_id FROM telegram_users WHERE user_id = ? AND active = 1 ORDER BY id DESC LIMIT 1",
                    (esc["assigned_to_user_id"],),
                ).fetchone()
                if tu_row and tu_row["telegram_id"]:
                    assigned_tg = str(tu_row["telegram_id"])
    target_tg = assigned_tg or settings.get("telegram_default_chat_id")

    if settings.get("telegram_alerts_enabled") and tg_token and target_tg:
        tg_text = (
            f"<b>⚠️ [DIQQAT] Muammo aniqlandi</b>\n\n"
            f"<b>Qoʻngʻiroq:</b> #{call_id} {html.escape(call_name[:45])}\n"
            f"<b>Daraja:</b> <code>{severity.upper()}</code>\n"
            f"<b>Aniqlangan muammo:</b> {html.escape(problem)}\n"
            f"<b>Tayinlangan shaxs:</b> {html.escape(assigned_name)}\n"
            f"<b>Sababi:</b> {html.escape(reason)}\n\n"
            f"<b>Tavsiya:</b>\n" + "\n".join(f"• {html.escape(s)}" for s in plan[:3]) + "\n\n"
            f'<a href="{html.escape(call_url)}">Platformada koʻrish &rarr;</a>'
        )
        ok, msg = send_telegram_alert(target_tg, tg_text, tg_token)
        telegram_status = "sent" if ok else f"failed: {msg}"
    results["telegram"] = telegram_status

    # Update escalation row status
    db.update_escalation(
        escalation_id,
        email_status=email_status,
        telegram_status=telegram_status,
        status="sent" if (email_status == "sent" or telegram_status == "sent") else "open",
    )
    return results
