import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import config, db
from .api import router as api_router, start_reanalysis_task
from .auth import hash_password
from .routes_auth import router as auth_router
from .routes_clients import router as clients_router
from .routes_ingest import router as ingest_router
from .routes_managers import router as managers_router
from .routes_notifications import router as notifications_router
from .routes_sources import router as sources_router
from .telegram_bot import create_bot_application

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

_telegram_app = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _telegram_app
    db.init_db()
    _seed_admin()
    _seed_default_users()
    _seed_demo_calls()
    start_reanalysis_task()
    if config.TELEGRAM_ENABLED:
        _telegram_app = create_bot_application()
        if _telegram_app:
            try:
                await _telegram_app.initialize()
                await _telegram_app.start()
                await _telegram_app.updater.start_polling()
                logging.getLogger("viacall.main").info("Telegram bot started (polling)")
            except Exception as exc:
                logging.getLogger("viacall.main").warning(
                    "Telegram bot could not start (continuing without it): %s", exc
                )
                _telegram_app = None
    yield
    if _telegram_app:
        await _telegram_app.updater.stop()
        await _telegram_app.stop()
        await _telegram_app.shutdown()
        logging.getLogger("viacall.main").info("Telegram bot stopped")


app = FastAPI(title="viacall - AI sales call coaching", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:8123", "http://127.0.0.1:5173", "http://127.0.0.1:8123"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)
app.include_router(auth_router)
app.include_router(clients_router)
app.include_router(ingest_router)
app.include_router(managers_router)
app.include_router(notifications_router)
app.include_router(sources_router)


def _seed_admin():
    if not config.ADMIN_EMAIL or not config.ADMIN_PASSWORD:
        logging.getLogger("viacall.main").warning(
            "Skipping admin seed: ADMIN_EMAIL / ADMIN_PASSWORD are not set in the environment."
        )
        return
    if db.get_user_by_email(config.ADMIN_EMAIL):
        return
    db.create_user(config.ADMIN_NAME, config.ADMIN_EMAIL, hash_password(config.ADMIN_PASSWORD), role="admin")
    logging.getLogger("viacall.main").info("Seeded admin user: %s", config.ADMIN_EMAIL)


def _seed_default_users():
    """Seed default managers and a receptionist if they don't already exist."""
    log = logging.getLogger("viacall.main")

    managers = [
        ("Aziz Karimov", "aziz@viacall.local", "aziz1234"),
        ("Nodira Raximova", "nodira@viacall.local", "nodira1234"),
        ("Sardor Alimov", "sardor@viacall.local", "sardor1234"),
    ]
    for name, email, password in managers:
        if db.get_user_by_email(email):
            continue
        db.create_user(name, email, hash_password(password), role="manager")
        log.info("Seeded manager: %s", email)

    receptionists = [
        ("Dilnoza Karimova", "dilnoza@viacall.local", "dilnoza1234"),
    ]
    for name, email, password in receptionists:
        if db.get_user_by_email(email):
            continue
        db.create_user(name, email, hash_password(password), role="receptionist")
        log.info("Seeded receptionist: %s", email)


def _seed_demo_calls():
    """Seed 5 pre-analyzed demo calls so the dashboard is never empty on demo day."""
    import time as _time

    log = logging.getLogger("viacall.main")

    with db.get_db() as conn:
        count = conn.execute("SELECT COUNT(*) FROM calls").fetchone()[0]
    if count > 0:
        return

    aziz = db.get_user_by_email("aziz@viacall.local")
    nodira = db.get_user_by_email("nodira@viacall.local")
    sardor = db.get_user_by_email("sardor@viacall.local")
    dilnoza = db.get_user_by_email("dilnoza@viacall.local")

    audio_dir = config.AUDIO_DIR
    wav_files = sorted(audio_dir.glob("*.wav")) if audio_dir.exists() else []

    demo_calls = [
        {
            "name": "CRM tizimini joriy qilish bo'yicha dastlabki suhbat",
            "user_id": aziz["id"] if aziz else None,
            "call_type": "manager",
            "duration_sec": 342,
            "language": "uz",
            "transcript": "Sotuvchi: Assalomu alaykum, Aziz Karimovman. ViaCall kompaniyasidan qo'ng'iroq qilyapman.\nMijoz: Va alaykum assalom.\nSotuvchi: Bizning yangi CRM tizimimiz haqida gaplashmoqchi edim. Sizning kompaniyangiz uchun maxsus yechim tayyorladik.\nMijoz: Qiziq, qanday imkoniyatlar bor?\nSotuvchi: Barcha mijozlar bazasini bir joyda saqlash, avtomatik eslatmalar va hisobotlar. Sizning sotuv jamoangiz uchun juda qulay.\nMijoz: Narxi qancha?\nSotuvchi: Oylik 500,000 so'mdan boshlanadi. Birinchi oy bepul sinov muddati bor.\nMijoz: Yaxshi, sinab ko'raman.\nSotuvchi: Ajoyib! Ertaga demo uchun vaqtni belgilaylik.",
            "analysis": {
                "topic": "CRM tizimini joriy qilish bo'yicha dastlabki suhbat",
                "language": "uz",
                "summary": "Sotuvchi Aziz CRM tizimini mijozga muvaffaqiyatli taqdim etdi. Mijoz qiziqish bildirdi va sinov muddatiga rozi bo'ldi.",
                "scorecard": {"opening": 85, "discovery": 72, "objection_handling": 80, "value_prop": 88, "closing": 90, "rapport": 78, "talk_ratio": 55, "overall": 81},
                "rep_share_of_talk": 0.55,
                "outcome": "likely",
                "key_metrics": [{"name": "Narx", "value": "500,000 so'm/oy"}, {"name": "Sinov muddati", "value": "1 oy bepul"}],
                "strengths": ["Aniq va professional kirish", "Mijoz ehtiyojini tushundi", "Narxni ochiq aytdi"],
                "weaknesses": ["Batafsil ehtiyoj aniqlash savollari kam", "Raqobatchilar haqida gapirmadi"],
                "coaching_points": ["Raqobatchilar haqida oldindan tayyorlang", "Mijozning shaxsiy ehtiyojlarini ko'proq oching"],
                "next_steps": ["Demo uchun vaqt belgilash", "CRM tizimi haqida batafsil taqdimot yuborish"],
                "action_items": [{"description": "Demo uchun kalendarga sana qo'shish", "due_date": None, "assignee": "manager", "priority": "high"}]
            },
            "status": "done",
            "source_type": "upload",
        },
        {
            "name": "Telefon orqali oldindan buyurtma qabul qilish",
            "user_id": nodira["id"] if nodira else None,
            "call_type": "manager",
            "duration_sec": 198,
            "language": "uz",
            "transcript": "Sotuvchi: Salom, Nodira Raximovaman. Yangi mahsulotlarimiz haqida xabar berish uchun qo'ng'iroq qilyapman.\nMijoz: Salom, ha eshitaman.\nSotuvchi: Bizning yangi tabiiy kosmetikamiz chiqdi. 100% tabiiy tarkibli, teriga zarar keltirmaydi.\nMijoz: Qancha turadi?\nSotuvchi: To'plam 350,000 so'm. Lekin hozir 20% chegirma bor.\nMijoz: Meni qiziqtirdi. Bitta to'plam buyurtma qilmoqchiman.\nSotuvchi: Ajoyib! Yetkazib berish bepulmi?\nMijoz: Ha, yetkazib bersanglar.\nSotuvchi: Kelishdik. Manzilingizni ayting.\nMijoz: Toshkent, Amir Temur ko'chasi, 15-uy.\nSotuvchi: Rahmat! 2-3 ish kuni ichida yetkazib beramiz.",
            "analysis": {
                "topic": "Telefon orqali kosmetika buyurtma qabul qilish",
                "language": "uz",
                "summary": "Sotuvchi Nodira tabiiy kosmetikani qisqacha va samarali taqdim etdi. Mijoz darhol buyurtma berdi.",
                "scorecard": {"opening": 78, "discovery": 65, "objection_handling": 75, "value_prop": 82, "closing": 95, "rapport": 80, "talk_ratio": 48, "overall": 79},
                "rep_share_of_talk": 0.48,
                "outcome": "win",
                "key_metrics": [{"name": "Narx", "value": "350,000 so'm (20% chegirma)"}, {"name": "Yetkazish", "value": "Bepul, 2-3 kun"}],
                "strengths": ["Tez va aniq taqdimot", "Chegirmani to'g'ri vaqtda aytdi", "Buyurtmani darhol qabul qildi"],
                "weaknesses": ["Mijoz ehtiyojini chuqur o'rganmadi", "Ko'proq mahsulot taklif qilmadi"],
                "coaching_points": ["Qo'shimcha mahsulotlar haqida gapiring", "Mijozning oldingi buyurtmalarini eslang"],
                "next_steps": ["Buyurtmani tasdiqlash", "Yetkazish haqida xabar berish"],
                "action_items": [{"description": "Buyurtmani tizimga kiritish", "due_date": None, "assignee": "manager", "priority": "high"}]
            },
            "status": "done",
            "source_type": "upload",
        },
        {
            "name": "IT xizmatlari bo'yicha texnik maslahat",
            "user_id": sardor["id"] if sardor else None,
            "call_type": "manager",
            "duration_sec": 456,
            "language": "ru",
            "transcript": "Менеджер: Здравствуйте, Сардор Алيمов. Я звоню из ViaCall по поводу IT-услуг для вашего офиса.\nКлиент: Здравствуйте, слушаю вас.\nМенеджер: Мы предлагаем полное IT-обслуживание: настройка серверов, поддержка сети, установка программного обеспечения.\nКлиент: У нас уже есть системный администратор, но он не справляется.\nМенеджер: Понимаю. Мы можем взять на себя рутинные задачи, чтобы ваш администратор занимался стратегическими проектами.\nКлиент: Интересно. Сколько это стоит?\nМенеджер: Зависит от размера офиса. Для 10 человек — 2,000,000 в месяц. Включает 24/7 поддержку.\nКлиент: Дороговато. Можете скидку?\nМенеджер: При годовом договоре — 15% скидка.\nКлиент: Давайте попробуем на месяц, а потом решим.\nМенеджер: Хорошо, я подготовлю договор.",
            "analysis": {
                "topic": "IT xizmatlari bo'yicha texnik maslahat",
                "language": "ru",
                "summary": "Сардор предложил комплексное IT-обслуживание. Клиент согласился на пробный месяц после переговоров о цене.",
                "scorecard": {"opening": 82, "discovery": 78, "objection_handling": 70, "value_prop": 85, "closing": 75, "rapport": 82, "talk_ratio": 52, "overall": 79},
                "rep_share_of_talk": 0.52,
                "outcome": "likely",
                "key_metrics": [{"name": "Цена", "value": "2,000,000 сум/мес"}, {"name": "Скидка", "value": "15% при годовом договоре"}, {"name": "Офис", "value": "10 человек"}],
                "strengths": ["Профессиональная подача", "Понял потребность клиента", "Предложил компромисс"],
                "weaknesses": ["Не показал ROI", "Не привёл кейсы успеха"],
                "coaching_points": ["Подготовьте кейсы успешных клиентов", "Покажите экономию от аутсорсинга"],
                "next_steps": ["Подготовить договор на пробный месяц", "Отправить презентацию"],
                "action_items": [{"description": "Подготовить договор", "due_date": None, "assignee": "manager", "priority": "high"}]
            },
            "status": "done",
            "source_type": "upload",
        },
        {
            "name": "Qabulxonada mijozni qarshilash va yo'naltirish",
            "user_id": dilnoza["id"] if dilnoza else None,
            "call_type": "receptionist",
            "duration_sec": 120,
            "language": "uz",
            "transcript": "Qabulxona: Assalomu alaykum! ViaCall qabulxonasi, Dilnoza Karimova sizga xizmat qilyapman.\nMijoz: Assalomu alaykum. Men manager bilan gaplashmoqchiman.\nQabulxona: Albatta, qaysi masala bo'yicha?\nMijoz: CRM tizimi haqida.\nQabulxona: Tushundim. Aziz Karimov bilan boglaymi? U hozir bo'sh.\nMijoz: Ha, iltimos.\nQabulxona: Bir soniya kuting.\nQabulxona: Aziz aka, sizga qo'ng'iroq bor. CRM tizimi haqida.\nSotuvchi: Yaxshi, ulang.\nQabulxona: Bogladim. Yaxshi kun tilayman!\nMijoz: Rahmat!",
            "analysis": {
                "topic": "Qabulxonada mijozni qarshilash va yo'naltirish",
                "language": "uz",
                "summary": "Qabulxona xodimi Dilnoza mijozni professional darajada qarshiladi va tezda kerakli mutaxassisga bog'ladi.",
                "scorecard": {"opening": 90, "discovery": 85, "objection_handling": 0, "value_prop": 0, "closing": 88, "rapport": 92, "talk_ratio": 40, "overall": 87},
                "rep_share_of_talk": 0.40,
                "outcome": "win",
                "key_metrics": [{"name": "Javob vaqti", "value": "3 soniya"}, {"name": "Yo'naltirish", "value": "To'g'ri mutaxassisga"}],
                "strengths": ["Juda tez va professional", "Mijozni sabr bilan tingladi", "To'g'ri odamga bog'лади"],
                "weaknesses": [],
                "coaching_points": ["Davom eting! Bu juda yaxshi sifat"],
                "next_steps": [],
                "action_items": []
            },
            "status": "done",
            "source_type": "upload",
        },
        {
            "name": "Yangi ofis jihozlari bo'yicha narx muzokarasi",
            "user_id": aziz["id"] if aziz else None,
            "call_type": "manager",
            "duration_sec": 285,
            "language": "uz",
            "transcript": "Sotuvchi: Assalomu alaykum, Aziz Karimovman. Ofis jihozlari haqida gaplashmoqchi edim.\nMijoz: Ha, eshitaman. Bizga yangi stullar kerak.\nSotuvchi: Qancha stul kerak?\nMijoz: 15 ta.\nSotuvchi: Bizning ergonomik stullarimiz bor, 1 yil kafolat bilan. Narxi 800,000 so'mdan.\nMijoz: Boshqada 600,000 so'mdan turadi.\nSotuvchi: Lekin biznikida bel qo'llab-quvvatlash tizimi bor. Sogl'ingiz uchun investitsiya.\nMijoz: Ha, lekin byudjetimiz cheklangan.\nSotuvchi: Tushundim. 15 ta stul uchun maxsus narx beraman: 700,000 so'mdan. Jami 10,500,000 so'm.\nMijoz: Yaxshiroq narx bormi?\nSotuvchi: 10 ta olsangiz, 650,000 so'mdan. Lekin 15 ta kerak dedingiz.\nMijoz: Kelishdik, 15 ta olamiz.\nSotuvchi: Ajoyib! Yetkazish bepul.",
            "analysis": {
                "topic": "Yangi ofis jihozlari bo'yicha narx muzokarasi",
                "language": "uz",
                "summary": "Aziz ergonomik stullarni professional darajada taqdim etdi va narx muzokaralarida muvozanatni saqladi.",
                "scorecard": {"opening": 80, "discovery": 70, "objection_handling": 85, "value_prop": 88, "closing": 82, "rapport": 75, "talk_ratio": 58, "overall": 80},
                "rep_share_of_talk": 0.58,
                "outcome": "win",
                "key_metrics": [{"name": "Soni", "value": "15 stul"}, {"name": "Narx", "value": "700,000 so'm/ta"}, {"name": "Jami", "value": "10,500,000 so'm"}],
                "strengths": ["Qiymatni aniq ko'rsatdi", "Narx muzokaralarini yuritdi", "Yetkazish bepulligini aytdi"],
                "weaknesses": ["Mijozning byudjetini to'liq o'rganmadi", "Variantlarni ko'proq taklif qilmadi"],
                "coaching_points": ["Mijozning byudjetini oldindan aniqlang", "Ko'proq variant tayyorlang"],
                "next_steps": ["Shartnomani tayyorlash", "Yetkazish sanasini belgilash"],
                "action_items": [{"description": "Shartnomani tayyorlash va yuborish", "due_date": None, "assignee": "manager", "priority": "high"}]
            },
            "status": "done",
            "source_type": "upload",
        },
    ]

    for i, call_data in enumerate(demo_calls):
        ts_offset = (len(demo_calls) - i) * 3600
        call_id = db.create_call(
            name=call_data["name"],
            audio_path=str(wav_files[i % len(wav_files)]) if wav_files else "",
            duration_sec=call_data["duration_sec"],
            call_type=call_data["call_type"],
            user_id=call_data["user_id"],
            source_type=call_data["source_type"],
        )
        db.update_call(
            call_id,
            status="done",
            transcript=call_data["transcript"],
            language=call_data["language"],
            analysis=json.dumps(call_data["analysis"], ensure_ascii=False),
        )
        log.info("Seeded demo call #%d: %s", call_id, call_data["name"][:50])

    log.info("Seeded %d demo calls", len(demo_calls))


FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"

if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")