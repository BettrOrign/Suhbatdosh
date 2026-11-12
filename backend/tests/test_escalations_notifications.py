import json
from starlette.testclient import TestClient

from app import db
from app.notifications_dispatcher import _build_email_html, _build_email_plain


def test_user_attributes_persistence(client: TestClient, admin_token: str):
    """Verify job_title, department, skills, supervisor_id, and telegram_id save and return."""
    headers = {"Authorization": f"Bearer {admin_token}"}

    # 1. Create a supervisor (School Principal)
    resp = client.post(
        "/api/users",
        json={
            "name": "Direktor Karim",
            "email": "principal@school.uz",
            "password": "StrongPassword123!",
            "role": "yonalish",
            "job_title": "Maktab direktori",
            "department": "Rahbariyat",
            "skills": "maktab boshqaruvi, o'qituvchilar nazorati, shikoyatlar",
            "telegram_id": "12345678",
            "phone": "+998901112233",
        },
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    principal_id = resp.json()["id"]
    assert resp.json()["job_title"] == "Maktab direktori"
    assert resp.json()["department"] == "Rahbariyat"

    # 2. Create an employee (Head Teacher) reporting to the principal
    resp = client.post(
        "/api/users",
        json={
            "name": "Bosh O'qituvchi Aziza",
            "email": "headteacher@school.uz",
            "password": "StrongPassword123!",
            "role": "manager",
            "job_title": "Bosh o'qituvchi",
            "department": "O'quv bo'limi",
            "skills": "dars sifati, metodika, o'quv dasturi",
            "supervisor_id": principal_id,
            "telegram_id": "87654321",
            "phone": "+998904445566",
        },
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    teacher_id = resp.json()["id"]
    assert resp.json()["supervisor_id"] == principal_id

    # 3. List users and check all attributes are included
    resp = client.get("/api/users", headers=headers)
    assert resp.status_code == 200
    users = resp.json()
    t_user = next((u for u in users if u["id"] == teacher_id), None)
    assert t_user is not None
    assert t_user["job_title"] == "Bosh o'qituvchi"
    assert t_user["department"] == "O'quv bo'limi"
    assert t_user["supervisor_id"] == principal_id

    # 4. Update attributes
    patch_resp = client.patch(
        f"/api/users/{teacher_id}",
        json={
            "job_title": "Katta Bosh o'qituvchi",
            "skills": "dars sifati, metodika, IELTS tayyorlov",
        },
        headers=headers,
    )
    assert patch_resp.status_code == 200

    resp2 = client.get("/api/users", headers=headers)
    t_updated = next((u for u in resp2.json() if u["id"] == teacher_id), None)
    assert t_updated["job_title"] == "Katta Bosh o'qituvchi"
    assert "IELTS tayyorlov" in t_updated["skills"]


def test_notification_settings_flow(client: TestClient, admin_token: str):
    """Verify getting, updating, and masking notification settings."""
    headers = {"Authorization": f"Bearer {admin_token}"}

    # Initial get
    resp = client.get("/api/settings/notifications", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "smtp_enabled" in data
    assert "auto_escalate_enabled" in data

    # Patch settings
    patch_resp = client.patch(
        "/api/settings/notifications",
        json={
            "smtp_enabled": True,
            "smtp_host": "smtp.gmail.com",
            "smtp_port": 587,
            "smtp_user": "notify@school.uz",
            "smtp_password": "secret-app-password",
            "telegram_alerts_enabled": True,
            "telegram_default_chat_id": "-100123456789",
            "escalation_score_threshold": 60,
        },
        headers=headers,
    )
    assert patch_resp.status_code == 200
    updated = patch_resp.json()
    assert updated["smtp_enabled"] is True
    assert updated["smtp_user"] == "notify@school.uz"
    assert updated["has_smtp_password"] is True
    assert updated["smtp_password"] == "••••••••"
    assert updated["escalation_score_threshold"] == 60


def test_escalation_lifecycle_and_api(client: TestClient, admin_token: str):
    """Test creating a call, escalating it to a supervisor, and resolving it."""
    headers = {"Authorization": f"Bearer {admin_token}"}

    # Create a user
    resp = client.post(
        "/api/users",
        json={
            "name": "Direktor Alisher",
            "email": "director@demo.uz",
            "password": "StrongPassword123!",
            "role": "yonalish",
            "job_title": "Direktor",
        },
        headers=headers,
    )
    director_id = resp.json()["id"]

    # Insert a dummy call
    call_id = db.create_call(
        name="Ingliz tili darsi bo'yicha shikoyat",
        audio_path="/tmp/test.wav",
        duration_sec=180.0,
        call_type="manager",
        org_id=1,
    )
    db.update_call(call_id, status="done")

    # Manually escalate via API
    esc_resp = client.post(
        f"/api/calls/{call_id}/escalate",
        json={
            "assigned_to_user_id": director_id,
            "detected_problem": "O'qituvchi darsga kech qolgan va ota-onaga qo'pol gapirgan",
            "assigned_reason": "Maktab rahbari sifatida xodim bilan tushuntirish ishlari olib borishi kerak",
            "action_plan": [
                "Ota-ona bilan bog'lanib uzr so'rash",
                "O'qituvchi bilan suhbat o'tkazish",
            ],
            "severity": "critical",
        },
        headers=headers,
    )
    assert esc_resp.status_code == 200, esc_resp.text
    esc_data = esc_resp.json()["escalation"]
    assert esc_data["call_id"] == call_id
    assert esc_data["assigned_to_user_id"] == director_id
    assert esc_data["severity"] == "critical"
    esc_id = esc_data["id"]

    # Call should now show escalated
    call = db.get_call(call_id)
    assert call["escalated"] == 1

    # Fetch call escalation
    get_resp = client.get(f"/api/calls/{call_id}/escalation", headers=headers)
    assert get_resp.status_code == 200
    assert get_resp.json()["escalation"]["id"] == esc_id

    # List escalations
    list_resp = client.get("/api/escalations", headers=headers)
    assert list_resp.status_code == 200
    all_esc = list_resp.json()
    assert any(e["id"] == esc_id for e in all_esc)

    # Resolve escalation
    res_resp = client.post(
        f"/api/escalations/{esc_id}/resolve",
        json={"notes": "Ota-ona bilan gaplashildi, muammo to'liq hal bo'ldi"},
        headers=headers,
    )
    assert res_resp.status_code == 200
    assert res_resp.json()["escalation"]["status"] == "resolved"
    assert res_resp.json()["escalation"]["resolution_notes"] == "Ota-ona bilan gaplashildi, muammo to'liq hal bo'ldi"


def test_email_template_builders():
    """Verify HTML and plain email builders produce valid content with required fields."""
    html_out = _build_email_html(
        call_id=99,
        call_name="Shikoyat qo'ng'irog'i",
        detected_problem="O'qituvchi metodikasi bo'yicha e'tiroz",
        assigned_user_name="Direktor Sobir",
        assigned_reason="Muassasa rahbari sifatida hal qilish vakolati bor",
        action_plan=["O'qituvchini tekshirish", "Metodik ko'rsatma berish"],
        severity="critical",
        rep_name="Malika O'qituvchi",
        evidence_quotes=["Dars juda sust o'tildi"],
        dashboard_url="http://localhost:5173/calls/99",
    )
    assert "#99" in html_out
    assert "Direktor Sobir" in html_out
    assert "CRITICAL" in html_out
    assert "Malika O&#x27;qituvchi" in html_out
    assert "http://localhost:5173/calls/99" in html_out

    plain_out = _build_email_plain(
        call_id=99,
        call_name="Shikoyat qo'ng'irog'i",
        detected_problem="O'qituvchi metodikasi bo'yicha e'tiroz",
        assigned_user_name="Direktor Sobir",
        assigned_reason="Muassasa rahbari sifatida hal qilish vakolati bor",
        action_plan=["O'qituvchini tekshirish"],
        severity="critical",
    )
    assert "CRITICAL" in plain_out
    assert "Direktor Sobir" in plain_out
