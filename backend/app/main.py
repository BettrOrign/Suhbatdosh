import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

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
                logging.getLogger("suhbatdosh.main").info("Telegram bot started (polling)")
            except Exception as exc:
                logging.getLogger("suhbatdosh.main").warning(
                    "Telegram bot could not start (continuing without it): %s", exc
                )
                _telegram_app = None
    yield
    if _telegram_app:
        await _telegram_app.updater.stop()
        await _telegram_app.stop()
        await _telegram_app.shutdown()
        logging.getLogger("suhbatdosh.main").info("Telegram bot stopped")


app = FastAPI(title="suhbatdosh - AI suhbat coach", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
        logging.getLogger("suhbatdosh.main").warning(
            "Skipping admin seed: ADMIN_EMAIL / ADMIN_PASSWORD are not set in the environment."
        )
        return
    if db.get_user_by_email(config.ADMIN_EMAIL):
        return
    db.create_user(config.ADMIN_NAME, config.ADMIN_EMAIL, hash_password(config.ADMIN_PASSWORD), role="admin")
    logging.getLogger("suhbatdosh.main").info("Seeded admin user: %s", config.ADMIN_EMAIL)


def _seed_default_users():
    """Seed default managers and receptionists if they don't already exist."""
    log = logging.getLogger("suhbatdosh.main")

    managers = [
        ("Aziz Karimov", "aziz@suhbatdosh.local", "aziz1234"),
        ("Nodira Raximova", "nodira@suhbatdosh.local", "nodira1234"),
        ("Sardor Alimov", "sardor@suhbatdosh.local", "sardor1234"),
        ("Jasur Qosimov", "jasur@suhbatdosh.local", "jasur1234"),
        ("Malika Turdiyeva", "malika@suhbatdosh.local", "malika1234"),
    ]
    for name, email, password in managers:
        if db.get_user_by_email(email):
            continue
        db.create_user(name, email, hash_password(password), role="manager")
        log.info("Seeded manager: %s", email)

    receptionists = [
        ("Dilnoza Karimova", "dilnoza@suhbatdosh.local", "dilnoza1234"),
        ("Nilufar Hamidova", "nilufar@suhbatdosh.local", "nilufar1234"),
    ]
    for name, email, password in receptionists:
        if db.get_user_by_email(email):
            continue
        db.create_user(name, email, hash_password(password), role="receptionist")
        log.info("Seeded receptionist: %s", email)

    yonalish = [
        ("Shoxrux Bobojonov", "shoxrux@suhbatdosh.local", "shoxrux1234"),
        ("Farhod Toshpulatov", "farhod@suhbatdosh.local", "farhod1234"),
        ("Rustam Zoirov", "rustam@suhbatdosh.local", "rustam1234"),
        ("Murod Abdullayev", "murod@suhbatdosh.local", "murod1234"),
        ("Bakhtiyor Karimov", "bakhtiyor@suhbatdosh.local", "bakhtiyor1234"),
        ("Jasur Raximov", "jasur.yonalish@suhbatdosh.local", "jasur1234"),
        ("Davron Mirzayev", "davron@suhbatdosh.local", "davron1234"),
        ("Sardor Alimov", "sardor.yonalish@suhbatdosh.local", "sardor1234"),
        ("Bobur Turgunov", "bobur@suhbatdosh.local", "bobur1234"),
        ("Akbar Normatov", "akbar@suhbatdosh.local", "akbar1234"),
    ]
    for name, email, password in yonalish:
        if db.get_user_by_email(email):
            continue
        db.create_user(name, email, hash_password(password), role="yonalish")
        log.info("Seeded yonalish: %s", email)


def _seed_demo_calls():
    """Seed demo calls so the dashboard is never empty."""
    import random
    import time as _time

    log = logging.getLogger("suhbatdosh.main")

    with db.get_db() as conn:
        count = conn.execute("SELECT COUNT(*) FROM calls").fetchone()[0]
    if count >= 30:
        return

    managers = [
        ("Aziz Karimov", "aziz@suhbatdosh.local", "aziz1234"),
        ("Nodira Raximova", "nodira@suhbatdosh.local", "nodira1234"),
        ("Sardor Alimov", "sardor@suhbatdosh.local", "sardor1234"),
        ("Jasur Qosimov", "jasur@suhbatdosh.local", "jasur1234"),
        ("Malika Turdiyeva", "malika@suhbatdosh.local", "malika1234"),
    ]
    for name, email, password in managers:
        if not db.get_user_by_email(email):
            db.create_user(name, email, hash_password(password), role="manager")
            log.info("Seeded manager: %s", email)

    if not db.get_user_by_email("dilnoza@suhbatdosh.local"):
        db.create_user("Dilnoza Karimova", "dilnoza@suhbatdosh.local", hash_password("dilnoza1234"), role="receptionist")
        log.info("Seeded receptionist: dilnoza@suhbatdosh.local")
    if not db.get_user_by_email("nilufar@suhbatdosh.local"):
        db.create_user("Nilufar Hamidova", "nilufar@suhbatdosh.local", hash_password("nilufar1234"), role="receptionist")
        log.info("Seeded receptionist: nilufar@suhbatdosh.local")

    if not db.get_user_by_email("admin@suhbatdosh.local"):
        db.create_user("Admin", "admin@suhbatdosh.local", hash_password("admin1234"), role="admin")
        log.info("Seeded admin: admin@suhbatdosh.local")

    aziz = db.get_user_by_email("aziz@suhbatdosh.local")
    nodira = db.get_user_by_email("nodira@suhbatdosh.local")
    sardor = db.get_user_by_email("sardor@suhbatdosh.local")
    jasur = db.get_user_by_email("jasur@suhbatdosh.local")
    malika = db.get_user_by_email("malika@suhbatdosh.local")
    dilnoza = db.get_user_by_email("dilnoza@suhbatdosh.local")
    nilufar = db.get_user_by_email("nilufar@suhbatdosh.local")
    admin = db.get_user_by_email("admin@suhbatdosh.local")
    shoxrux = db.get_user_by_email("shoxrux@suhbatdosh.local")
    farhod = db.get_user_by_email("farhod@suhbatdosh.local")
    rustam = db.get_user_by_email("rustam@suhbatdosh.local")
    murod = db.get_user_by_email("murod@suhbatdosh.local")
    bakhtiyor = db.get_user_by_email("bakhtiyor@suhbatdosh.local")
    jasur_yon = db.get_user_by_email("jasur.yonalish@suhbatdosh.local")
    davron = db.get_user_by_email("davron@suhbatdosh.local")
    sardor_yon = db.get_user_by_email("sardor.yonalish@suhbatdosh.local")
    bobur = db.get_user_by_email("bobur@suhbatdosh.local")
    akbar = db.get_user_by_email("akbar@suhbatdosh.local")

    demo_clients_data = [
        ("TechSoft LLC", "998901234567", "TechSoft", "info@techsoft.uz", "IT xizmatlari bo'yicha doimiy mijoz"),
        ("Green Valley", "998907654321", "Green Valley", "contact@greenvalley.uz", "Kosmetika optom savdosi"),
        ("StartUp Hub", "998901112233", "StartUp Hub", "hello@startuphub.uz", "Yangi startap, inkubator"),
        ("UzbekTrade", "998903334455", "UzbekTrade", "info@uzbektrade.uz", "Tashqi savdo kompaniyasi"),
        ("MegaMarket", "998905556677", "MegaMarket", "support@megamarket.uz", "Onlayn do'kon tarmog'i"),
        ("IT Park", "998908889900", "IT Park", "collaboration@itpark.uz", "IT sohasida hamkorlik"),
        ("SmartEducation", "998902223344", "SmartEducation", "info@smartedu.uz", "Ta'lim platformasi"),
        ("AutoPrime", "998904445566", "AutoPrime", "sales@autoprime.uz", "Avtomobil savdosi"),
    ]

    existing_clients = {c["name"] for c in db.list_clients()}
    client_map = {}
    for name, phone, company, email, notes in demo_clients_data:
        if name not in existing_clients:
            cid = db.create_client(name, phone=phone, company=company, email=email, notes=notes)
            log.info("Seeded client: %s (id=%d)", name, cid)
            client_map[name] = cid
        else:
            for c in db.list_clients():
                if c["name"] == name:
                    client_map[name] = c["id"]
                    break

    audio_dir = config.AUDIO_DIR
    wav_files = sorted(audio_dir.glob("*.wav")) if audio_dir.exists() else []
    if not wav_files and audio_dir.exists():
        wav_files = list(audio_dir.glob("*"))

    existing_names = set()
    with db.get_db() as conn:
        rows = conn.execute("SELECT name FROM calls").fetchall()
        for r in rows:
            existing_names.add(r[0])

    demo_calls = [
        {
            "name": "CRM tizimini joriy qilish bo'yicha dastlabki suhbat",
            "user_id": aziz["id"] if aziz else None,
            "client_id": client_map.get("TechSoft LLC"),
            "call_type": "manager",
            "duration_sec": 342,
            "language": "uz",
            "transcript": "Sotuvchi: Assalomu alaykum, Aziz Karimovman. Suhbatdosh kompaniyasidan qo'ng'iroq qilyapman.\nMijoz: Va alaykum assalom.\nSotuvchi: Bizning yangi CRM tizimimiz haqida gaplashmoqchi edim. Sizning kompaniyangiz uchun maxsus yechim tayyorladik.\nMijoz: Qiziq, qanday imkoniyatlar bor?\nSotuvchi: Barcha mijozlar bazasini bir joyda saqlash, avtomatik eslatmalar va hisobotlar. Sizning sotuv jamoangiz uchun juda qulay.\nMijoz: Narxi qancha?\nSotuvchi: Oylik 500,000 so'mdan boshlanadi. Birinchi oy bepul sinov muddati bor.\nMijoz: Yaxshi, sinab ko'raman.\nSotuvchi: Ajoyib! Ertaga demo uchun vaqtni belgilaylik.",
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
            "client_id": client_map.get("Green Valley"),
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
            "client_id": client_map.get("TechSoft LLC"),
            "call_type": "manager",
            "duration_sec": 456,
            "language": "ru",
            "transcript": "Менеджер: Здравствуйте, Сардор Алимов. Я звоню из Suhbatdosh по поводу IT-услуг для вашего офиса.\nКлиент: Здравствуйте, слушаю вас.\nМенеджер: Мы предлагаем полное IT-обслуживание: настройка серверов, поддержка сети, установка программного обеспечения.\nКлиент: У нас уже есть системный администратор, но он не справляется.\nМенеджер: Понимаю. Мы можем взять на себя рутинные задачи, чтобы ваш администратор занимался стратегическими проектами.\nКлиент: Интересно. Сколько это стоит?\nМенеджер: Зависит от размера офиса. Для 10 человек — 2,000,000 в месяц. Включает 24/7 поддержку.\nКлиент: Дороговато. Можете скидку?\nМенеджер: При годовом договоре — 15% скидка.\nКлиент: Давайте попробуем на месяц, а потом решим.\nМенеджер: Хорошо, я подготовлю договор.",
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
            "transcript": "Qabulxona: Assalomu alaykum! Suhbatdosh qabulxonasi, Dilnoza Karimova sizga xizmat qilyapman.\nMijoz: Assalomu alaykum. Men manager bilan gaplashmoqchiman.\nQabulxona: Albatta, qaysi masla bo'yida?\nMijoz: CRM tizimi haqida.\nQabulxona: Tushundim. Aziz Karimov bilan boglaymi? U hozir bo'sh.\nMijoz: Ha, iltimos.\nQabulxona: Bir soniya kuting.\nQabulxona: Aziz aka, sizga qo'ng'iroq bor. CRM tizisi haqida.\nSotuvchi: Yaxshi, ulang.\nQabulxona: Bogladim. Yaxshi kun tilayman!\nMijoz: Rahmat!",
            "analysis": {
                "topic": "Qabulxonada mijozni qarshilash va yo'naltirish",
                "language": "uz",
                "summary": "Qabulxona xodimi Dilnoza mijozni professional darajada qarshiladi va tezda kerakli mutaxassisga bog'ladi.",
                "scorecard": {"opening": 90, "discovery": 85, "objection_handling": 0, "value_prop": 0, "closing": 88, "rapport": 92, "talk_ratio": 40, "overall": 87},
                "rep_share_of_talk": 0.40,
                "outcome": "win",
                "key_metrics": [{"name": "Javob vaqti", "value": "3 soniya"}, {"name": "Yo'naltirish", "value": "To'g'ri mutaxassisga"}],
                "strengths": ["Juda tez va professional", "Mijozni sabr bilan tingladi", "To'g'ri odamga bog'ladi"],
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
            "client_id": client_map.get("StartUp Hub"),
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
        {
            "name": "Korporativ trening dasturini sotish",
            "user_id": aziz["id"] if aziz else None,
            "client_id": client_map.get("SmartEducation"),
            "call_type": "manager",
            "duration_sec": 410,
            "language": "uz",
            "transcript": "Sotuvchi: Assalomu alaykum! Suhbatdosh kompaniyasidan qo'ng'iroq qilyapman. Korporativ sotuv trening dasturimiz haqida gaplashmoqchi edim.\nMijoz: Ha, eshitaman. Bizda 20 tadan ortiq sotuvchi ishlaydi.\nSotuvchi: Bizning trening dasturimiz 4 haftalik, har hafta 2 marta to'liq sessiya. Amaliy vazifalar bilan.\nMijoz: Natijalar necha oyda ko'rinadi?\nSotuvchi: Birinchi 2 haftada already kuchli o'zgarishlar ko'rinadi. Sotuv hajmi o'rtacha 30% oshadi.\nMijoz: Narxi qancha?\nSotuvchi: Barcha 20 sotuvchi uchun 8,000,000 so'm. Bitta sotuvchi uchun 400,000 so'm.\nMijoz: Bu juda arzon! Peniya bermayman?\nSotuvchi: Albatta, dastur tugagandan keyin 30 kunlik qo'llab-quvvatlash mavjud.\nMijoz: Ajoyib! Qaysi sanada boshlaymiz?\nSotuvchi: Ertaga boshlashimiz mumkin.",
            "analysis": {
                "topic": "Korporativ trening dasturini sotish",
                "language": "uz",
                "summary": "Aziz korporativ trening dasturini taqdim etdi. Mijoz 20 sotuvchiga qiziqib qoldi va darhol kelishdi.",
                "scorecard": {"opening": 88, "discovery": 82, "objection_handling": 90, "value_prop": 85, "closing": 92, "rapport": 86, "talk_ratio": 50, "overall": 87},
                "rep_share_of_talk": 0.50,
                "outcome": "win",
                "key_metrics": [{"name": "Sotuvchilar", "value": "20 kishi"}, {"name": "Narx", "value": "8,000,000 so'm"}, {"name": "O'sish", "value": "30% o'sish"}],
                "strengths": ["Aniq raqamlar va natijalar ko'rsatdi", "Peniya taklifini o'z vaqtida aytdi", "Profesional darajada"],
                "weaknesses": ["Raqobatchilarni eslatmadi", "Mijozning vaqtini to'liq o'rganmadi"],
                "coaching_points": ["Raqobatchi tahlili qo'shing", "Qo'shimcha xizmatlarni taklif qiling"],
                "next_steps": ["Shartnoma imzolash", "Trening dasturini tayyorlash"],
                "action_items": [{"description": "Shartnoma tayyorlash", "due_date": None, "assignee": "manager", "priority": "high"}]
            },
            "status": "done",
            "source_type": "upload",
        },
        {
            "name": "Mahsulot yangilanishi haqida jarayon",
            "user_id": sardor["id"] if sardor else None,
            "client_id": client_map.get("UzbekTrade"),
            "call_type": "manager",
            "duration_sec": 165,
            "language": "ru",
            "transcript": "Менеджер: Здравствуйте, Сергей! Я звоню из Suhbatdosh. У нас есть интересное предложение.\nКлиент: Здравствуйте, слушаю вас.\nМенеджер: Мы расширяем линейку продуктов и хотели бы обсудить ваши потребности.\nКлиент: Интересно. Что у вас нового?\nМенеджер: У нас появилась система аналитики в реальном времени. Вы можете отслеживать все звонки ваших сотрудников.\nКлиент: Звучит интересно. Сколько это стоит?\nМенеджер: Для компаний до 50 человек — 50,000 рублей в месяц.\nКлиент: Может немного подешевле?\nМенеджер: Если подписать на год — 45,000 рублей.\nКлиент: Давайте, оформим пробный месяц.\nМенеджер: Отлично! Я подготовлю договор.",
            "analysis": {
                "topic": "Mahsulot yangilanishi haqida jarayon",
                "language": "ru",
                "summary": "Сардор предложил аналитическую систему клиенту. Мягкая переговорная тактика помогла закрыть сделку.",
                "scorecard": {"opening": 80, "discovery": 75, "objection_handling": 82, "value_prop": 78, "closing": 85, "rapport": 83, "talk_ratio": 46, "overall": 80},
                "rep_share_of_talk": 0.46,
                "outcome": "likely",
                "key_metrics": [{"name": "Цена", "value": "50,000 руб/мес"}, {"name": "Скидка", "value": "45,000 руб/год"}, {"name": "Пробный", "value": "1 месяц"}],
                "strengths": ["Чётко обозначил ценность", "Гибко шёл к сделке", "Правильно ответил на возражение"],
                "weaknesses": ["Не использовал кейсы", "Не спросил про текущую аналитику клиента"],
                "coaching_points": ["Подготовьте кейсы клиентов из вашей отрасли", "Спросите про текущее решение клиента"],
                "next_steps": ["Подготовить договор на пробный месяц", "Организовать демонстрацию"],
                "action_items": [{"description": "Подготовить демонстрацию", "due_date": None, "assignee": "manager", "priority": "medium"}]
            },
            "status": "done",
            "source_type": "upload",
        },
        {
            "name": "Boshlang'ich biznes rejalash maslahati",
            "user_id": nodira["id"] if nodira else None,
            "client_id": client_map.get("StartUp Hub"),
            "call_type": "manager",
            "duration_sec": 320,
            "language": "uz",
            "transcript": "Sotuvchi: Salom! Suhbatdosh kompaniyasidan qo'ng'iroq qilyapman. Bizning biznes rejalash xizmatimiz haqida gaplashmoqchi edim.\nMijoz: Assalomu alaykum. Yangi biznesim bor, ilk bosqichda ekanman.\nSotuvchi: Zafarlimiz! Bizda biznes rejalash va marketing strategiyasiga oid xizmatlar mavjud.\nMijoz: Qanday yordam berzadingiz?\nSotuvchi: Biz biznes rejasini, marketing strategiyasini va ilk 3 oylik action plan tayyorlaymiz.\nMijoz: Bu necha talab qiladi?\nSotuvchi: 10,000,000 so'm. Shuningdek, keyingi 2 oylik konsalting bepul.\nMijoz: Men shuncha pul yo'q, lekin kerak.\nSotuvchi: Tushunaman. Biz 3 aylik to'lov dasturi tayyorlaymiz: 3,500,000 so'm oylig.\nMijoz: Yaxshi, o'ylab ko'raman.",
            "analysis": {
                "topic": "Boshlang'ich biznes rejalash maslahati",
                "language": "uz",
                "summary": "Sotuvchi Nodiraga biznes rejalash xizmatini taqdim etdi. Mijoz qiziqish bildirdi va o'ylashga rozi bo'ldi.",
                "scorecard": {"opening": 82, "discovery": 76, "objection_handling": 85, "value_prop": 80, "closing": 70, "rapport": 84, "talk_ratio": 54, "overall": 79},
                "rep_share_of_talk": 0.54,
                "outcome": "likely",
                "key_metrics": [{"name": "Narx", "value": "3,500,000 so'm/oy"}, {"name": "Xizmat", "value": "3 oylik rejalash + 2 oy konsalting"}, {"name": "Mijoz", "value": "Yangi biznes"}],
                "strengths": ["Ehtiyojni tushundi", "Moslashuvchan to'lov sharti taklif qildi", "Rapport yaxshi"],
                "weaknesses": ["Closing qattiq emas", "Mijozning byudjetini aniq o'rganmadi"],
                "coaching_points": ["Qaror qabul qiluvchiga to'g'ri murojaat qiling", "Closing jarayonini kuchaytiring"],
                "next_steps": ["Taklifnoma yuborish", "Kelishuv sanasini belgilash"],
                "action_items": [{"description": "Taklifnoma tayyorlash", "due_date": None, "assignee": "manager", "priority": "high"}]
            },
            "status": "done",
            "source_type": "upload",
        },
        {
            "name": "Kontrakt shartnomasini muzokara qilish",
            "user_id": sardor["id"] if sardor else None,
            "client_id": client_map.get("MegaMarket"),
            "call_type": "manager",
            "duration_sec": 250,
            "language": "ru",
            "transcript": "Менеджер: Здравствуйте, Игорь! Я из Suhbatdosh. Хотел обсудить условия контракта.\nКлиент: Здравствуйте. Да, мне перезвонили по этому поводу.\nМенеджер: Мы изучили ваши требования и готовы предложить оптимальные условия.\nКлиент: Нам важна гибкость условий.\nМенеджер: Понимаю. Мы можем разделить оплату на 4 квартала и добавить опцию расторжения.\nКлиент: Это интересно. А если мы хотим расширить сферу услуг?\nМенеджер: Конечно, расширение возможно с дополнительной скидкой 10%.\nКлиент: Хорошо, я согласен на предварительные условия.\nМенеджер: Отлично! Я направлю окончательный вариант контракта на ваш email.",
            "analysis": {
                "topic": "Kontrakt shartnomasini muzokara qilish",
                "language": "ru",
                "summary": "Сардор успешно провёл переговоры по контракту. Гибкие условия оплаты впечатлили клиента.",
                "scorecard": {"opening": 85, "discovery": 80, "objection_handling": 88, "value_prop": 82, "closing": 90, "rapport": 84, "talk_ratio": 45, "overall": 84},
                "rep_share_of_talk": 0.45,
                "outcome": "win",
                "key_metrics": [{"name": "Оплата", "value": "4 квартала"}, {"name": "Скидка", "value": "10% при расширении"}, {"name": "Расторжение", "value": "Опция доступна"}],
                "strengths": ["Гибко подошёл к условиям", "Ответил на дополнительный вопрос", "Предложил расторжение"],
                "weaknesses": ["Не уточнил сроки контракта", "Не предложил бонус за раннее подписание"],
                "coaching_points": ["Уточните сроки и штрафные условия", "Предложите early-bird скидку"],
                "next_steps": ["Направить окончательный контракт", "Согласовать дату подписания"],
                "action_items": [{"description": "Подготовить окончательный контракт", "due_date": None, "assignee": "manager", "priority": "high"}]
            },
            "status": "done",
            "source_type": "upload",
        },
        {
            "name": "Ishga qabul qilish jarayoni",
            "user_id": dilnoza["id"] if dilnoza else None,
            "call_type": "receptionist",
            "duration_sec": 95,
            "language": "uz",
            "transcript": "Qabulxona: Assalomu alaykum! Suhbatdosh qabulxonasi, Dilnoza Karimova sizga xizmat qilyapman.\nMijoz: Salom, men yangi ishga qabul qilish haqida gaplashmoqchiman.\nQabulxona: Albatta, qaysi bo'lim uchun qidiraysiz?\nMijoz: Sotuv bo'limi uchun.\nQabulxona: Tushundim. Nodira Raximovaga bog'laman.\nMijoz: Ha, shaxsiy bilan gaplashishim kerak.\nQabulxona: Bir daqiqa kuting.\nQabulxona: Nodira, sizga yangi xabar bor - ishga qabul qilish.\nNodira: Yaxshi, ungleman.\nQabulxona: Ulang, Nodira. Mijoz kuting!\nMijoz: Rahmat, keling.",
            "analysis": {
                "topic": "Ishga qabul qilish jarayoni",
                "language": "uz",
                "summary": "Qabulxona xodimi Dilnoza professional darajada mijozni qarshiladi va tezda kerakli mutaxassisga bog'ladi.",
                "scorecard": {"opening": 92, "discovery": 88, "objection_handling": 0, "value_prop": 0, "closing": 90, "rapport": 95, "talk_ratio": 38, "overall": 89},
                "rep_share_of_talk": 0.38,
                "outcome": "win",
                "key_metrics": [{"name": "Javob", "value": "Professional"}, {"name": "Yo'naltirish", "value": "Sotuv bo'limi"}],
                "strengths": ["Juda tez va ishonchli", "To'g'ri bo'limga bog'лади", "Saber bilan xizmat qildi"],
                "weaknesses": [],
                "coaching_points": ["Davom eting! Judan yaxshi ishlayapsiz"],
                "next_steps": [],
                "action_items": []
            },
            "status": "done",
            "source_type": "upload",
        },
        {
            "name": "Xizmatlar haqida umumiy ma'lumot",
            "user_id": nodira["id"] if nodira else None,
            "call_type": "receptionist",
            "duration_sec": 75,
            "language": "uz",
            "transcript": "Qabulxona: Assalomu alaykum! Suhbatdosh qabulxonasi.\nMijoz: Salom, umumiy ma'lumot beraman.\nQabulxona: Albatta, qaysi bo'yicha qiziqdingiz?\nMijoz: Sizning barcha xizmatlaringiz haqida.\nQabulxona: Bizda CRM tizimi, sotuv treninglari, IT xizmatlar va biznes konsalting mavjud.\nMijoz: Qisqacha qisqacha gaplashasizmi?\nQabulxona: Tabii, yozing va biz 1 soat ichida javob beramiz.",
            "analysis": {
                "topic": "Xizmatlar haqida umumiy ma'lumot",
                "language": "uz",
                "summary": "Dilnoza mijozga barcha xizmatlarni tez va professional darajada taqdim etdi.",
                "scorecard": {"opening": 91, "discovery": 86, "objection_handling": 0, "value_prop": 0, "closing": 93, "rapport": 96, "talk_ratio": 35, "overall": 90},
                "rep_share_of_talk": 0.35,
                "outcome": "win",
                "key_metrics": [{"name": "Xizmatlar", "value": "4 ta tur"}, {"name": "Javob", "value": "1 soat ichida"}],
                "strengths": ["Barcha xizmatlarni tez aytdi", "Professional va samimiy"],
                "weaknesses": [],
                "coaching_points": ["Davom eting! Juda yaxshi"],
                "next_steps": [],
                "action_items": []
            },
            "status": "done",
            "source_type": "upload",
        },
        {
            "name": "Uzoq muzokaralar natijasi",
            "user_id": aziz["id"] if aziz else None,
            "client_id": client_map.get("UzbekTrade"),
            "call_type": "manager",
            "duration_sec": 510,
            "language": "uz",
            "transcript": "Sotuvchi: Assalomu alaykum, Aziz Karimovman. Uzoq muddatdan beri bog'lanmoqchi edim.\nMijoz: Salom, qanday yordam berasiz?\nSotuvchi: Bizning yangi xususiyatimiz - AI asosli sotuv tahlili. Har qo'ng'iroqni avtomatik ravishda tahlil qilish.\nMijoz: Bu nima uchun kerak?\nSotuvchi: Har qo'ng'iringizdan keyin aniq ko'rsatkichlar: qayerda zaif tomonlaringiz, qanday yaxshilash mumkin.\nMijoz: Boshqa xizmatlar yo'qlami?\nSotuvchi: Ta'minot bilan ham ishlaymiz. Har oyda hisobot beramiz.\nMijoz: Men 100 dan ortiq xodimim bor. Umumiy narx nech?\nSotuvchi: 500,000 so'm oylig. Jami 12 oylik shartnoma bilan 50,000,000 so'm.\nMijoz: Bu juda qimmat! Menga 300,000 so'mni taklif qiling.\nSotuvchi: Tushundim. 350,000 so'm oylig va 12 oylik shartnoma bilan 38,000,000 so'm, shuningdek bepul integratsiya.\nMijoz: Kelishdik. Qaysi sanada boshlaymiz?\nSotuvchi: Ertaga boshlaymiz!",
            "analysis": {
                "topic": "Uzoq muzokaralar natijasi",
                "language": "uz",
                "summary": "Aziz katta mijozga AI asosli sotuv tahlisi xizmatini muvaffaqiyatli sotdi. Uzoq muzokaralar natijasida kelishib oldi.",
                "scorecard": {"opening": 84, "discovery": 82, "objection_handling": 92, "value_prop": 88, "closing": 86, "rapport": 80, "talk_ratio": 56, "overall": 85},
                "rep_share_of_talk": 0.56,
                "outcome": "win",
                "key_metrics": [{"name": "Xodimlar", "value": "100+ kishi"}, {"name": "Narx", "value": "350,000 so'm/oy"}, {"name": "Jami", "value": "38,000,000 so'm"}],
                "strengths": ["AI qimmatli funksiyani aniq tushuntirdi", "Mijozning qarorini kuchli qo'llab-quvvatlashda", "Bepul integratsiya taklif qildi"],
                "weaknesses": ["Dastlab juda yuqori narx qo'ydi", "Mijozning tanlovi uchun yanada ilovalarni ko'rsatmadi"],
                "coaching_points": ["Avval mantiqiy narxni qo'yishga harakat qiling", "Raqobatchi afzalliklarni taqqoslash qo'shing"],
                "next_steps": ["Shartnoma imzolash", "Integratsiyani boshlash"],
                "action_items": [{"description": "Shartnoma tayyorlash", "due_date": None, "assignee": "manager", "priority": "high"}]
            },
            "status": "done",
            "source_type": "upload",
        },
        {
            "name": "Klient qayta murojaat qilish",
            "user_id": nodira["id"] if nodira else None,
            "client_id": client_map.get("Green Valley"),
            "call_type": "manager",
            "duration_sec": 185,
            "language": "uz",
            "transcript": "Sotuvchi: Salom! Suhbatdosh kompaniyasidan qo'ng'iroq qilyapman. Bu yerda Nodira Raximovaman.\nMijoz: Salom! Men avvalroq buyurtma qilganman. Mana, buni qayta ko'proq ko'rishim kerak.\nSotuvchi: Tushundim! Sizning oldingi buyurtmaingiz 350,000 so'm to'plam edi. Hozir yangi loyiha bor? Yangi taklifimiz bor.\nMijoz: Ha, hozir yangi loyihamiz bor. Boshqacha bo'lsa qanday?\nSotuvchi: Biz hozir yangi kompaniyalar uchun 30% chegirma taklif etamiz.\nMijoz: Yoqdi! Qanday yuboraman?\nSotuvchi: Bizning timurimizga yozing va men sizga to'liq taqdimot yuboraman.\nMijoz: Rahmat! Tezroq kelmasizmi?\nSotuvchi: Bugun kunga qadar yetkazib beramiz.",
            "analysis": {
                "topic": "Klient qayta murojaat qilish",
                "language": "uz",
                "summary": "Nodira mavjud mijozni qayta jalb qildi va yangi taklif bilan kelishib oldi.",
                "scorecard": {"opening": 85, "discovery": 80, "objection_handling": 78, "value_prop": 82, "closing": 88, "rapport": 86, "talk_ratio": 52, "overall": 82},
                "rep_share_of_talk": 0.52,
                "outcome": "win",
                "key_metrics": [{"name": "Chegirma", "value": "30% yangi kompaniyalar uchun"}, {"name": "Oldingi", "value": "350,000 so'm"}, {"name": "Yetkazish", "value": "Bugun"}],
                "strengths": ["Avvalgi munosabatlardan foydalandi", "Yangilik tezda aytdi", "Chegirma tez aytdi"],
                "weaknesses": ["Mijozning yangi ehtiyojlarini chuqur o'rganmadi", "Natijalar ko'rsatkichlari yo'q"],
                "coaching_points": ["Mijozning yangi loyihasini batafsil o'rganing", "Natijalarni ko'rsatish uchun kichik hikoya qo'shing"],
                "next_steps": ["Taqdimotni tayyorlash", "Chegirma sharti tasdiqlash"],
                "action_items": [{"description": "Taqdimotni tayyorlash va yuborish", "due_date": None, "assignee": "manager", "priority": "high"}]
            },
            "status": "done",
            "source_type": "upload",
        },
        {
            "name": "Texnik yordam so'rovi",
            "user_id": sardor["id"] if sardor else None,
            "call_type": "manager",
            "duration_sec": 140,
            "language": "ru",
            "transcript": "Менеджер: Здравствуйте, Дмитрий! Как я могу вам помочь?\nКлиент: Здравствуйте. У нас проблемы с серверной инфраструктурой.\nМенеджер: Понимаю. Расскажите подробнее о проблеме.\nКлиент: Наша сеть работает медленно, и мы теряем данные.\nМенеджер: Это может быть связано с недостатком пропускной способности или устаревшим оборудованием.\nКлиент: Когда мы это исправим?\nМенеджер: Мы можем направить специалиста сегодня вечером для диагностики.\nКлиент: И сколько это будет стоить?\nМенеджер: Диагностика бесплатно, а ремонт зависит от проблемы. Обычно от 50,000 до 150,000 рублей.\nКлиент: Ладно, давайте сделаем диагностику.\nМенеджер: Отлично! Я направлю специалиста на 18:00.",
            "analysis": {
                "topic": "Texnik yordam so'rovi",
                "language": "ru",
                "summary": "Сардор оперативно ответил на техническую поддержку, поставил диагностику на сегодня вечером.",
                "scorecard": {"opening": 88, "discovery": 82, "objection_handling": 75, "value_prop": 72, "closing": 85, "rapport": 86, "talk_ratio": 42, "overall": 81},
                "rep_share_of_talk": 0.42,
                "outcome": "likely",
                "key_metrics": [{"name": "Диагностика", "value": "Бесплатно"}, {"name": "Ремонт", "value": "50,000-150,000 руб"}, {"name": "Время", "value": "Сегодня 18:00"}],
                "strengths": ["Быстро отреагировал", "Профессионально диагностировал", "Бесплатную диагностику предложил"],
                "weaknesses": ["Не уточнил сроки ремонта", "Не предложил гарантию"],
                "coaching_points": ["Уточните сроки и гарантийные обязательства", "Предложите пакет услуг со скидкой"],
                "next_steps": ["Направить специалиста на диагностику", "Подготовить смету"],
                "action_items": [{"description": "Направить специалиста", "due_date": None, "assignee": "manager", "priority": "high"}]
            },
            "status": "done",
            "source_type": "upload",
        },
        {
            "name": "Sotuvchining yangi ishga kirishi",
            "user_id": aziz["id"] if aziz else None,
            "call_type": "manager",
            "duration_sec": 370,
            "language": "uz",
            "transcript": "Sotuvchi: Assalomu alaykum! Yangi sotuvchimiz bilan ishlayman. U juda istiqbolli, lekin tajribasiz.\nMijoz: Ha, men unga kerakli bo'lganni o'rgataman.\nSotuvchi: Men 3 haftalik dastur tayyorladim: birinchi haftada asoslar, ikkinchisida amaliyot, uchinchisida test suhbatlar.\nMijoz: Bu qimmatga tushadi?\nSotuvchi: Bitta sotuvchiga 250,000 so'm oylig, lekin agar 3 oydan keyin sotuv 20% oshsa, 100,000 so'm qaytarib beramiz.\nMijoz: Bu haqiqiy! Men 2 sotuvchini yuboraman.\nSotuvchi: Ajoyib! Bitta uchun shartnoma imzolang, keyin qo'shimcha boshlanadi.\nMijoz: Ertaga ishga qo'yamiz. Rahmat!",
            "analysis": {
                "topic": "Sotuvchining yangi ishga kirishi",
                "language": "uz",
                "summary": "Aziz yangi sotuvchilarni tayyorlash dasturini sotdi. Performance-based pricing mijozni qiziqtirdi.",
                "scorecard": {"opening": 86, "discovery": 84, "objection_handling": 88, "value_prop": 85, "closing": 84, "rapport": 82, "talk_ratio": 53, "overall": 84},
                "rep_share_of_talk": 0.53,
                "outcome": "win",
                "key_metrics": [{"name": "Narx", "value": "250,000 so'm/oy"}, {"name": "Qaytarish", "value": "100,000 so'm"}, {"name": "Sotuvchilar", "value": "2 kishi"}],
                "strengths": ["Performance-based pricing taklif qildi", "Tayyor dastur ko'rsatdi", "Tez karor qabul qildi"],
                "weaknesses": ["Batafsiz dastur rejasini ko'rsatmadi", "Rivojlanish choralari yo'q"],
                "coaching_points": ["Tayyor dastur rejasini vizual qiling", "Success stories qo'shing"],
                "next_steps": ["Shartnoma imzolash", "Dastur boshlash"],
                "action_items": [{"description": "Shartnoma tayyorlash", "due_date": None, "assignee": "manager", "priority": "high"}]
            },
            "status": "done",
            "source_type": "upload",
        },
        {
            "name": "Mijozning shikayati va qayta ishlash",
            "user_id": nodira["id"] if nodira else None,
            "call_type": "manager",
            "duration_sec": 210,
            "language": "uz",
            "transcript": "Sotuvchi: Assalomu alaykum! Bu yerda Nodira Raximovaman. Mijozimiz shikayat qilmoqda.\nMijoz: Sizning xizmatingiz juda yomon, men qaytarishni istayman.\nSotuvchi: Tushundim, juda uzr. Mijozning nima uchun qoniqsizligini bilishni xohlayman.\nMijoz: Ma'lumotlar to'g'ri emas, 3 oylik hisobot yo'q.\nSotuvchi: Albatta, men bu masalani tezda hal qilaman. Qaysi mijoz? Nima uchun?\nMijoz: Maxsus kompaniya, hisobotni 3 oy o'tkazib yubordik.\nSotuvchi: Men shuni qilaman: 24 soat ichida yangi hisobot tayyorlayman va bepul yuboraman.\nMijoz: Agar hech narsa bo'lmasa, bekor qilaman.\nSotuvchi: Agar yangi hisobot qoniqarli bo'lsa, 20% chegirma beraman keyingi oy uchun.",
            "analysis": {
                "topic": "Mijozning shikayati va qayta ishlash",
                "language": "uz",
                "summary": "Nodira mijozning shikayatini professional darajada qayta ishladi. Kompensatsiya taklif qildi.",
                "scorecard": {"opening": 82, "discovery": 88, "objection_handling": 90, "value_prop": 80, "closing": 85, "rapport": 84, "talk_ratio": 48, "overall": 83},
                "rep_share_of_talk": 0.48,
                "outcome": "likely",
                "key_metrics": [{"name": "Chegirma", "value": "20% keyingi oy uchun"}, {"name": "Yangi hisobot", "value": "24 soat ichida"}, {"name": "Mijoz", "value": "Maxsus kompaniya"}],
                "strengths": ["Tushunarli javob berdi", "Kompensatsiya taklif qildi", "Mijozning ehtiyojini tingladi"],
                "weaknesses": ["Oldinroq qanday bo'lganini o'rganmadi", "Boshqa mijozlarni qo'llab-quvvatladi"],
                "coaching_points": ["Oldingi xatoliklarni tahlil qiling", "Preventiv choralar tayyorlang"],
                "next_steps": ["Yangi hisobot tayyorlash", "Chegirma shartnomasini belgilash"],
                "action_items": [{"description": "Yangi hisobot tayyorlash", "due_date": None, "assignee": "manager", "priority": "high"}]
            },
            "status": "done",
            "source_type": "upload",
        },
        {
            "name": "Marketing kampaniya muzokarasi",
            "user_id": sardor["id"] if sardor else None,
            "call_type": "manager",
            "duration_sec": 295,
            "language": "ru",
            "transcript": "Менеджер: Здравствуйте, Ольга! Я из Suhbatdosh. Мы обсуждаем маркетинговую кампанию.\nКлиент: Здравствуйте, слушаю.\nМенеджер: Мы готовы разработать комплексную маркетинговую стратегию для вашего бизнеса.\nКлиент: Сколько это будет стоить?\nМенеджер: Для среднего бизнеса от 80,000 до 120,000 рублей за проект.\nКлиент: Это слишком дорого.\nМенеджер: Мы можем начать с базового пакета за 60,000 рублей и расширять по мере роста.\nКлиент: Интересно. Что входит в базовый пакет?\nМенеджер: Аудит, SMM стратегия и 2 месяца продвижения.\nКлиент: Давайте, оформим базовый пакет.\nМенеджер: Отлично! Я подготовлю договор и начнем аудит.\nКлиент: Когда начнете?\nМенеджер: Завтра утром.",
            "analysis": {
                "topic": "Marketing kampaniya muzokarasi",
                "language": "ru",
                "summary": "Сардор предложил маркетинговые услуги клиенту через базовый пакет. Клиент согласился после обсуждения цены.",
                "scorecard": {"opening": 84, "discovery": 78, "objection_handling": 86, "value_prop": 80, "closing": 85, "rapport": 82, "talk_ratio": 44, "overall": 82},
                "rep_share_of_talk": 0.44,
                "outcome": "win",
                "key_metrics": [{"name": "Цена", "value": "60,000 руб (базовый)"}, {"name": "Включает", "value": "Аудит + SMM + 2 мес"}, {"name": "Начало", "value": "Завтра"}],
                "strengths": ["Доступную стартовую цену предложил", "Четко описал пакет услуг", "Быстро начал процесс"],
                "weaknesses": ["Долгосрочные планы не обсудил", "Не предложил кейсы успеха"],
                "coaching_points": ["Подготовьте кейсы из вашей отрасли", "Обсудите долгосрочное сотрудничество"],
                "next_steps": ["Подготовить договор", "Начать аудит"],
                "action_items": [{"description": "Подготовить договор и начать аудит", "due_date": None, "assignee": "manager", "priority": "high"}]
            },
            "status": "done",
            "source_type": "upload",
        },
        {
            "name": "Avto salon uchun CRM tizimi sotish",
            "user_id": jasur["id"] if jasur else None,
            "client_id": client_map.get("AutoPrime"),
            "call_type": "manager",
            "duration_sec": 380,
            "language": "uz",
            "transcript": "Sotuvchi: Assalomu alaykum! Jasur Qosimovman. Suhbatdosh dan qo'ng'iroq qilyapman.\nMijoz: Assalomu alaykum, ha eshitaman.\nSotuvchi: Sizning avto saloningiz uchun maxsus CRM tizimini taklif qilmoqchiman. Barcha mijozlaringizni, avtolarini va shartnomalarini bir joyda saqlash.\nMijoz: Bizda hozir Excel foydalanamiz, juda qiyin.\nSotuvchi: Tushundim. Bizning tizimimiz avtomatik eslatmalar, avtomobil bazasi va shartnoma generatsiyasini qiladi.\nMijoz: Integratsiya qilish qiyinmi?\nSotuvchi: Yo'q, bizning jamoamiz o'rnatib beradi. 2-3 kun ichida.\nMijoz: Narxi qancha?\nSotuvchi: Oylik 300,000 so'm. Yillik to'lovda 20% chegirma.\nMijoz: Yaxshi, sinab ko'raman.\nSotuvchi: Ajoyib! Ertaga o'rnatishni boshlaymiz.",
            "analysis": {
                "topic": "Avto salon uchun CRM tizimi sotish",
                "language": "uz",
                "summary": "Jasur avto salonga CRM tizimini taklif qildi. Mijozning Excel muammosini tushundi va yechim taklif qildi.",
                "scorecard": {"opening": 86, "discovery": 82, "objection_handling": 85, "value_prop": 88, "closing": 90, "rapport": 84, "talk_ratio": 52, "overall": 85},
                "rep_share_of_talk": 0.52,
                "outcome": "win",
                "key_metrics": [{"name": "Narx", "value": "300,000 so'm/oy"}, {"name": "Chegirma", "value": "20% yillik"}, {"name": "O'rn.", "value": "2-3 kun"}],
                "strengths": ["Mijozning muammosini tushundi", "Integratsiya haqida aytdi", "Narxni aniq belgiladi"],
                "weaknesses": ["Demo ko'rsatmadi", "Boshqa funksiyalarni aytmadi"],
                "coaching_points": ["Demo tayyorlang", "Qo'shimcha funksiyalarni taqdim qiling"],
                "next_steps": ["CRM o'rnatishni boshlash", "Mijozga kirish treningini berish"],
                "action_items": [{"description": "O'rnatish uchun jamoani yuborish", "due_date": None, "assignee": "manager", "priority": "high"}]
            },
            "status": "done",
            "source_type": "upload",
        },
        {
            "name": "Onlayn do'kon uchun marketing strategiyasi",
            "user_id": malika["id"] if malika else None,
            "client_id": client_map.get("MegaMarket"),
            "call_type": "manager",
            "duration_sec": 290,
            "language": "uz",
            "transcript": "Sotuvchi: Assalomu alaykum! Malika Turdiyevaman. MegaMarket uchun marketing strategiyasini muhokama qilmoqchi edim.\nMijoz: Assalomu alaykum! Ha, bizning marketingimiz zaif.\nSotuvchi: Biz SMM, Google reklama va influencer marketingni birlashtirgan strategiya tayyorladik.\nMijoz: Qancha vaqt kerak?\nSotuvchi: Birinchi natijalar 2 haftada ko'rinadi. To'liq strategiya 1 oy ichida.\nMijoz: Narxi nechi?\nSotuvchi: Baz paket 150,000 so'm/oy. Premium paket 350,000 so'm/oy.\nMijoz: Bizga baz paket yetadi.\nSotuvchi: Yaxshi! Ertaga boshlaymiz. Sizning Instagram va Telegram akkauntingizni so'rayman.\nMijoz: Yuboramiz. Rahmat!",
            "analysis": {
                "topic": "Onlayn do'kon uchun marketing strategiyasi",
                "language": "uz",
                "summary": "Malika MegaMarket uchun marketing strategiyasini taklif qildi. Mijoz baz paketni tanladi.",
                "scorecard": {"opening": 84, "discovery": 78, "objection_handling": 82, "value_prop": 86, "closing": 88, "rapport": 85, "talk_ratio": 50, "overall": 83},
                "rep_share_of_talk": 0.50,
                "outcome": "win",
                "key_metrics": [{"name": "Paket", "value": "Baz - 150,000 so'm"}, {"name": "Natija", "value": "2 haftada"}, {"name": "Kanal", "value": "Instagram + Telegram"}],
                "strengths": ["Strategiyani aniq tushuntirdi", "Narx variantlarini ko'rsatdi", "Tez boshlash vaqtini aytdi"],
                "weaknesses": ["ROI ko'rsatmadi", "Raqobatchilar haqida gapirmadi"],
                "coaching_points": ["ROI hisobini tayyorlang", "Raqobatchi tahlili qo'shing"],
                "next_steps": ["Akkаунтlar so'rash", "Reklama kampaniyasini boshlash"],
                "action_items": [{"description": "Akkаунтlarini olish va audit qilish", "due_date": None, "assignee": "manager", "priority": "high"}]
            },
            "status": "done",
            "source_type": "upload",
        },
        {
            "name": "IT Park bilan hamkorlik haqida",
            "user_id": sardor["id"] if sardor else None,
            "client_id": client_map.get("IT Park"),
            "call_type": "manager",
            "duration_sec": 420,
            "language": "ru",
            "transcript": "Менеджер: Здравствуйте! Сардор Алимов из Suhbatdosh. Хотел обсудить партнёрство.\nКлиент: Здравствуйте, слушаю. Какое партнёрство?\nМенеджер: Мы предлагаем интеграцию Suhbatdosh с вашими стартапами. Каждый стартап получает CRM и аналитику звонков.\nКлиент: Интересно. Сколько стартапов у вас?\nМенеджер: Пока 5, но мы хотим масштабироваться. Для IT Park специальная цена.\nКлиент: Какая?\nМенеджер: Для каждого стартапа 200,000 сум вместо 500,000. Годовой контракт.\nКлиент: Это хорошее предложение. Я обсужу с руководством.\nМенеджер: Хорошо, я подготовлю презентацию.\nКлиент: Давайте на следующей неделе.\nМенеджер: Отлично!",
            "analysis": {
                "topic": "IT Park bilan hamkorlik haqida",
                "language": "ru",
                "summary": "Сардор предложил IT Park партнёрство. Специальная цена для стартапов заинтересовала клиента.",
                "scorecard": {"opening": 85, "discovery": 80, "objection_handling": 83, "value_prop": 87, "closing": 82, "rapport": 86, "talk_ratio": 48, "overall": 84},
                "rep_share_of_talk": 0.48,
                "outcome": "likely",
                "key_metrics": [{"name": "Стартапы", "value": "5 шт"}, {"name": "Цена", "value": "200,000 сум/мес"}, {"name": "Контракт", "value": "1 год"}],
                "strengths": ["Специальную цену предложил", "Масштабируемость показал", "Профессионально подошёл"],
                "weaknesses": ["Презентацию не показал", "ROI не рассчитал"],
                "coaching_points": ["Подготовьте презентацию", "Покажите ROI для стартапов"],
                "next_steps": ["Подготовить презентацию", "Встреча на следующей неделе"],
                "action_items": [{"description": "Презентацию подготовить", "due_date": None, "assignee": "manager", "priority": "high"}]
            },
            "status": "done",
            "source_type": "upload",
        },
        {
            "name": "Ta'lim platformasi uchun integratsiya",
            "user_id": jasur["id"] if jasur else None,
            "client_id": client_map.get("SmartEducation"),
            "call_type": "manager",
            "duration_sec": 350,
            "language": "uz",
            "transcript": "Sotuvchi: Assalomu alaykum! Jasur Qosimovman. SmartEducation platformangiz uchun Suhbatdosh integratsiyasini taklif qilmoqchiman.\nMijoz: Assalomu alaykum. Qanday integratsiya?\nSotuvchi: O'quvchilar bilan telefon suhbatlaringizni avtomatik tahlil qiladi. Har bir suhbatdan keyin baho va tavsiyalar beradi.\nMijoz: Bizda 500 dan ortiq o'quvchi bor. Barchasini qila olasizmi?\nSotuvchi: Albatta. Bizning tizimimiz kuniga 1000+ suhbatni qayta ishlaydi.\nMijoz: Narxi qancha?\nSotuvchi: O'quvchi soniga qarab. 500 o'quvchi uchun oylik 800,000 so'm.\nMijoz: Bu juda qimmat!\nSotuvchi: Tushundim. 3 oylik sinov muddati bepul. Keyin qaraysiz.\nMijoz: Yaxshi, sinab ko'raman!\nSotuvchi: Ajoyib! Ertaga boshlaymiz.",
            "analysis": {
                "topic": "Ta'lim platformasi uchun integratsiya",
                "language": "uz",
                "summary": "Jasur SmartEducation platformasiga Suhbatdosh integratsiyasini taklif qildi. Bepul sinov muddati mijozni qiziqtirdi.",
                "scorecard": {"opening": 88, "discovery": 84, "objection_handling": 87, "value_prop": 90, "closing": 85, "rapport": 86, "talk_ratio": 54, "overall": 86},
                "rep_share_of_talk": 0.54,
                "outcome": "win",
                "key_metrics": [{"name": "O'quvchilar", "value": "500+"}, {"name": "Narx", "value": "800,000 so'm/oy"}, {"name": "Sinov", "value": "3 oy bepul"}],
                "strengths": ["Aniq qiymat ko'rsatdi", "Bepul sinov taklif qildi", "Mijoz soniga moslashdi"],
                "weaknesses": ["Texnik detallarni kam aytdi", "Raqobatchilar haqida gapirmadi"],
                "coaching_points": ["Texnik arxitekturani tushuntiring", "Raqobatchi afzalliklarni taqqoslang"],
                "next_steps": ["Integratsiyani boshlash", "Texnik jamoani tanishtirish"],
                "action_items": [{"description": "Texnik jamoani tayyorlash", "due_date": None, "assignee": "manager", "priority": "high"}]
            },
            "status": "done",
            "source_type": "upload",
        },
    ]

    for i, call_data in enumerate(demo_calls):
        if call_data["name"] in existing_names:
            continue
        ts_offset = (len(demo_calls) - i) * 1800
        ts = (datetime.now(timezone.utc) - timedelta(seconds=ts_offset)).isoformat()
        audio_path = str(wav_files[i % len(wav_files)]) if wav_files else ""
        call_id = db.create_call(
            name=call_data["name"],
            audio_path=audio_path,
            duration_sec=call_data["duration_sec"],
            call_type=call_data["call_type"],
            user_id=call_data["user_id"],
            client_id=call_data.get("client_id"),
            source_type=call_data["source_type"],
        )
        db.update_call(
            call_id,
            status="done",
            transcript=call_data["transcript"],
            language=call_data["language"],
            analysis=json.dumps(call_data["analysis"], ensure_ascii=False),
            created_at=ts,
            updated_at=ts,
        )
        log.info("Seeded hand-crafted call #%d: %s", call_id, call_data["name"][:50])

    # ─── Yonalish problem calls (calls with problems that were solved) ──
    yonalish_problem_calls = [
        (shoxrux, "Telefon orqali mijozni yo'qotish", client_map.get("MegaMarket"), 200, "uz"),
        (farhod, "Mijozning shikayati: sotuv haqida gapirmadi", client_map.get("TechSoft LLC"), 180, "uz"),
        (rustam, "Raqobatchi haqida gapirmadi", client_map.get("Green Valley"), 150, "uz"),
        (murod, "Narxni ochiq aytmadi", client_map.get("AutoPrime"), 170, "uz"),
        (bakhtiyor, "Mijozni to'g'ri yo'nallatmadi", client_map.get("IT Park"), 160, "uz"),
    ]
    for yuser, name, cid, dur, lang in yonalish_problem_calls:
        if name in existing_names:
            continue
        ts_now = (datetime.now(timezone.utc) - timedelta(seconds=3600)).isoformat()
        call_id = db.create_call(
            name=name,
            audio_path="",
            duration_sec=dur,
            call_type="manager",
            user_id=yuser["id"] if yuser else None,
            client_id=cid,
            source_type="upload",
        )
        problem_scorecard = {"opening": 35, "discovery": 40, "objection_handling": 25, "value_prop": 30, "closing": 20, "rapport": 45, "talk_ratio": 38, "overall": 30}
        analysis = {
            "topic": name,
            "language": lang,
            "summary": "Bu suhbatda ko'p qat'iy muammolar bor — sotuvchi ijtimoiy xususiyatlarni ko'rsatmadi, mijozni to'g'ri yo'nallatmadi.",
            "scorecard": problem_scorecard,
            "rep_share_of_talk": 0.38,
            "outcome": "lost",
            "key_metrics": [{"name": "Muammo", "value": "Past balandlik"}],
            "strengths": [],
            "weaknesses": ["Mijozni tushunmadi", "Raqobatchi haqida gapirmadi", "Narxni ochiq aytmadi"],
            "coaching_points": ["Mijoz ehtiyojlarini aniqlang", "Raqobatchi haqida suhbat boring", "Narni ochiq ayting"],
            "next_steps": ["Mijoz bilan qayta suhbat"],
            "action_items": [{"description": "Muammo yechish", "due_date": None, "assignee": "yonalish", "priority": "high"}]
        }
        db.update_call(call_id, status="done", transcript="", language=lang, analysis=json.dumps(analysis, ensure_ascii=False), created_at=ts_now, updated_at=ts_now)
        log.info("Seeded yonalish problem call: %s", name)

    # ─── Procedurally generated calls (spread over last 60 days) ───────────
    rng = random.Random(42)

    manager_users = [(u, "manager") for u in [aziz, nodira, sardor, jasur, malika] if u]
    receptionist_users = [(u, "receptionist") for u in [dilnoza, nilufar] if u]
    yonalish_users = [(u, "yonalish") for u in [shoxrux, farhod, rustam, murod, bakhtiyor, jasur_yon, davron, sardor_yon, bobur, akbar] if u]
    all_users = manager_users + receptionist_users + yonalish_users

    client_names = list(client_map.keys())

    topics_manager = [
        "CRM tizimini sotish", "IT xizmatlari bo'yicha muzokara", "Marketing strategiyasi",
        "Korporativ trening sotish", "Biznes rejalash maslahati", "Logistika tizimini sotish",
        "Avtomatlashtirish yechimi", "Moliyaviy konsalting xizmati", "HR tizimini joriy qilish",
        "Veb-sayt yaratish xizmati", "SEO optimallashtirish", "SMM xizmatlari",
        "Call markaz tizimini sotish", "ERP tizimini joriy qilish", "Video surveillance tizimi",
        "Cloud xizmatlari", "Cybersecurity audit", "Mobile ilova yaratish",
        "E-commerce platformasi", "Data analytics xizmati", "Bog'chalar uchun tizim",
        "Klinika uchun CRM", "Ombor boshqaruv tizimi", "Transport logistikasi",
        "Kosmetika optom savdosi", "Mebel ishlab chiqarish", "Gastro biznes konsalting",
        "Sug'urta xizmatlari", "Yuridik maslahat xizmati", "Tibbiyot markazi sotish",
    ]
    topics_receptionist = [
        "Mijozni qabul qilish", "Telefon orqali ma'lumot berish", "Uchrashuvni belgilash",
        "Shikayatni qabul qilish", "Texnik yordam yo'naltirish", "Yangi mijozni ro'yxatdan o'tkazish",
        "Qo'ng'iroqni qayta ulash", "Ma'lumot so'rovini qayta ishlash",
    ]

    summaries = [
        "Mijoz qiziqish bildirdi, kelishuvga tayyor.",
        "Professional taqdimot, mijoz ijobiy javob berdi.",
        "Narx bo'yicha muzokara olib borildi, kompromissga kelindi.",
        "Mijoz ehtiyojini aniqladik, maxsus yechim taklif qildik.",
        "Tez va samarali suhbat o'tkazildi.",
        "Mijozning shikayatini hal qildik, qoniqish bildirdi.",
        "Yangi mahsulotni taqdim etdik, sinov muddatiga rozi bo'ldi.",
        "Uzoq muzokaralar natijasida shartnoma imzolandi.",
        "Mijoz qo'shimcha xizmatlar haqida so'radi.",
        "Bepul sinov muddatini taklif qildik.",
    ]
    outcomes = ["win", "likely", "likely", "likely", "lost", "win", "win"]
    languages = ["uz", "uz", "uz", "ru"]

    def random_score(base):
        return max(20, min(98, base + rng.randint(-20, 15)))

    now = datetime.now(timezone.utc)
    total_procedural = 4

    day_weights = []
    for d in range(60, 0, -1):
        day = now - timedelta(days=d)
        base_weight = max(1, 5 - (d // 15))
        if day.weekday() in (5, 6):
            base_weight = max(1, base_weight - 2)
        day_weights.append((d, base_weight))

    total_weight = sum(w for _, w in day_weights)
    calls_per_day = {}
    remaining = total_procedural
    for d, w in day_weights:
        n = max(0, round(total_procedural * w / total_weight))
        n = min(n, remaining)
        calls_per_day[d] = n
        remaining -= n
    for d in sorted(calls_per_day.keys(), reverse=True)[:remaining]:
        calls_per_day[d] += 1

    call_counter = 0
    for days_ago in sorted(calls_per_day.keys(), reverse=True):
        n_calls = calls_per_day[days_ago]
        if n_calls == 0:
            continue

        day_base = now - timedelta(days=days_ago)

        for _ in range(n_calls):
            if rng.random() < 0.80:
                user, utype = rng.choice(manager_users)
                topic = rng.choice(topics_manager)
                call_type = "manager"
                client_name = rng.choice(client_names) if rng.random() < 0.85 else None
                duration = rng.randint(120, 600)
            else:
                user, utype = rng.choice(receptionist_users)
                topic = rng.choice(topics_receptionist)
                call_type = "receptionist"
                client_name = None
                duration = rng.randint(45, 180)

            hour = rng.randint(9, 17)
            minute = rng.randint(0, 59)
            ts = day_base.replace(hour=hour, minute=minute, second=0, microsecond=0)

            lang = rng.choice(languages)
            score_base = rng.randint(55, 88)
            overall = random_score(score_base)
            talk_ratio = round(rng.uniform(0.30, 0.65), 2)
            outcome = rng.choice(outcomes)

            scorecard = {
                "opening": random_score(overall + rng.randint(-5, 5)),
                "discovery": random_score(overall + rng.randint(-10, 5)),
                "objection_handling": random_score(overall + rng.randint(-10, 5)),
                "value_prop": random_score(overall + rng.randint(-5, 5)),
                "closing": random_score(overall + rng.randint(-5, 5)),
                "rapport": random_score(overall + rng.randint(-5, 5)),
                "talk_ratio": round(talk_ratio * 100),
                "overall": overall,
            }

            rep_name = user["name"].split(" ")[0] if user else "Manager"
            analysis = {
                "topic": topic,
                "language": lang,
                "summary": rng.choice(summaries),
                "scorecard": scorecard,
                "rep_share_of_talk": talk_ratio,
                "outcome": outcome,
                "key_metrics": [
                    {"name": "Narx", "value": f"{rng.randint(100, 800)}K so'm"},
                    {"name": "Muddat", "value": f"{rng.randint(1, 12)} oy"},
                ],
                "strengths": ["Professional munosabat", "Aniq taqdimot"],
                "weaknesses": ["Ko'proq savol berish kerak edi"],
                "coaching_points": ["Mijoz ehtiyojini chuqurroq o'rganing"],
                "next_steps": ["Keyingi suhbatni belgilash"],
                "action_items": [{"description": "Keyingi qadamni belgilash", "due_date": None, "assignee": "manager", "priority": "medium"}],
            }

            call_name = f"{topic} — {rng.choice(['qo\'ng\'iroq', 'suhbat', 'muzokara', 'konsultatsiya'])} #{call_counter + 1}"
            if call_name in existing_names:
                call_counter += 1
                continue

            call_id = db.create_call(
                name=call_name,
                audio_path=str(wav_files[rng.randint(0, len(wav_files) - 1)]) if wav_files else "",
                duration_sec=duration,
                call_type=call_type,
                user_id=user["id"],
                client_id=client_map.get(client_name) if client_name else None,
                source_type="upload",
            )
            ts_iso = ts.isoformat()
            db.update_call(
                call_id,
                status="done",
                transcript=f"[Demo suhbat — {topic}]\nSotuvchi: {rep_name}.\nMijoz: Ha, eshitaman.\nSotuvchi: Bizning xizmatimiz haqida gaplashmoqchi edim.\nMijoz: Qiziq, davom eting.\nSotuvchi: Professional yechimlar taklif qilamiz.\nMijoz: Narxi qancha?\nSotuvchi: Sizga mos narxni belgilaymiz.\nMijoz: Yaxshi, o'ylab ko'raman.",
                language=lang,
                analysis=json.dumps(analysis, ensure_ascii=False),
                created_at=ts_iso,
                updated_at=ts_iso,
            )
            call_counter += 1

    # ─── A few "processing" and "error" calls for today ────────────────────
    today_users = [u for u, _ in all_users]
    processing_calls = [
        ("Yangi mijoz bilan dastlabki suhbat", today_users[0]["id"], "manager", "upload", 220),
        ("Texnik yordam so'rovi — javob kutmoqda", today_users[2]["id"], "manager", "upload", 180),
        ("Qo'ng'iroq transkripsiyasi", today_users[5]["id"], "receptionist", "upload", 90),
        ("Xizmat haqida ma'lumot", today_users[1]["id"], "manager", "upload", 150),
        ("Mijoz bilan muzokara — tahlil jarayonda", today_users[3]["id"], "manager", "upload", 310),
    ]

    for name_text, uid, ctype, stype, dur in processing_calls:
        if name_text in existing_names:
            continue
        ts_now = now.isoformat()
        call_id = db.create_call(
            name=name_text,
            audio_path="",
            duration_sec=dur,
            call_type=ctype,
            user_id=uid,
            client_id=client_map.get(rng.choice(client_names)) if rng.random() < 0.5 else None,
            source_type=stype,
        )
        db.update_call(call_id, status="transcribing", created_at=ts_now, updated_at=ts_now)
        existing_names.add(name_text)
        log.info("Seeded processing call: %s", name_text)

    error_calls = [
        ("Suvonly buzilgan audio fayl", today_users[0]["id"], "manager", "upload", 45),
        ("Tarmoq xatosi — qayta yuklash kerak", today_users[1]["id"], "manager", "telegram", 120),
    ]
    for name_text, uid, ctype, stype, dur in error_calls:
        if name_text in existing_names:
            continue
        ts_now = now.isoformat()
        call_id = db.create_call(
            name=name_text,
            audio_path="",
            duration_sec=dur,
            call_type=ctype,
            user_id=uid,
            source_type=stype,
        )
        db.update_call(call_id, status="error", created_at=ts_now, updated_at=ts_now)
        existing_names.add(name_text)
        log.info("Seeded error call: %s", name_text)

    with db.get_db() as conn:
        total = conn.execute("SELECT COUNT(*) FROM calls").fetchone()[0]
    log.info("Total demo calls after seeding: %d (+%d procedural, +%d processing, +%d error)",
             total, call_counter, len(processing_calls), len(error_calls))


FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="static-assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """Serve static files or fall back to index.html for SPA routing."""
        file_path = FRONTEND_DIST / full_path
        if full_path and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(FRONTEND_DIST / "index.html")