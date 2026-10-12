# AGENTS.md — Suhbatdosh (a.k.a. ViaCall repo dir)

Read this before touching anything. It is the map of the codebase.

## What the product is

**Suhbatdosh** = AI call-analytics SaaS for training centres / call centres in Uzbekistan.

Flow: **Zadarma PBX records a call → Suhbatdosh downloads it → transcribes (Gemini,
or locally in private mode) → Gemini scores & coaches → dashboard + Telegram show
the result.**

The business pitch: a manager or receptionist takes a call, the centre wants to find
*where the rep lost the client* (a "flaw" / nuqson) and fix it fast. So the unit of
value is the **scorecard + coaching points** on a call, not the transcript.

Language reality: UI is `uz` + `en`. **All AI prompts are Uzbek** and instruct the
model to answer in Uzbek, even for Russian-language calls. Keep that contract.

## Repo layout

```
backend/          FastAPI + SQLite + Gemini + python-telegram-bot
  app/
    main.py       App assembly + lifespan + ~450 lines of DEMO SEEDING (see gotchas)
    api.py        /api/calls + /api/stats  (the core read/write surface)
    db.py         All SQL + init_db() migrations + analytics queries (946 lines)
    auth.py       PBKDF2 passwords, sessions, get_current_user, require_role
    analysis.py   Gemini scoring → CallAnalysis pydantic schema
    prompts.py    SCORING_SYSTEM_PROMPT (Uzbek). Add new prompts here.
    transcribe.py Mode-aware transcription → transcript + segments (Gemini or local)
    local_stt.py  Offline GigaAM via sherpa-onnx, lazy-loaded, for private mode
    live.py       Gemini Live streaming transcription — CURRENTLY ORPHANED, see gotchas
    audio.py      ffmpeg normalisation to 16k mono WAV
    zadarma.py    Zadarma REST client (HMAC-SHA1 signing)
    routes_*.py   auth, clients, ingest, managers, notifications, settings,
                  sources, zadarma
    telegram_bot.py  1671 lines: full Telegram UI + APScheduler digests
    reports.py    Telegram text report formatters (consumed only by the bot)
    youtube.py    yt-dlp ingestion
  config.yaml     Non-secret defaults. env (.env) always wins. See config.py:_resolve
frontend/         Vite 8 + React 19 + TS + Tailwind v4 + shadcn/ui
  src/lib/        api.ts (single fetch wrapper), auth.tsx, types.ts, format.ts
  src/pages/      Analytics, Calls, CallDetail, Clients, ManagersList,
                  ManagersDirections, ManagersAdmin, Users, Login
  src/i18n/       i18n.tsx + translations.ts (349 flat keys, en/uz, symmetric)
nginx/            suhbatdosh.conf, suhbatdoshai.conf (prod vhosts)
run.sh            One-command launcher. ./run.sh | --netLAN | --stop
```

Runtime dirs are **gitignored**: `data/` (SQLite + audio + pcm), `logs/`.

## Running it

```bash
cp backend/.env.example backend/.env   # set GEMINI_API_KEY at minimum
./run.sh                               # backend :8123, vite :5173
./run.sh --stop
```

- Backend serves `frontend/dist` too, so `:8123` alone is a working app.
- Vite proxies `/api` → `127.0.0.1:8123` (`frontend/vite.config.ts:14`).
- Lint: `cd frontend && npm run lint` (oxlint). Typecheck: `npm run build`.
- Backend tests: `cd backend && uv run pytest` (34 tests, `TestClient`).
- Private-mode STT needs `sherpa-onnx` **and** `sherpa-onnx-core` (the latter ships
  the native `.so` the former dlopens — installing only `sherpa-onnx` gives a
  confusing `ImportError: /usr/lib/libonnxruntime.so: version VERS_1.28.2 not found`).

## Data model (db.py)

11 tables, no ORM, raw sqlite3 with a thread-local connection (`db.py:21`), WAL on.

- `users` — `role ∈ {admin, manager, receptionist, yonalish}`. `yonalish` = supervisor
  ("Masul" in the UI). Also holds `api_token` for machine ingestion.
- `sessions` — 7-day TTL bearer tokens.
- `calls` — the hub. `audio_path` is an **absolute** string path into `data/audio`.
  `transcript`, `segments`, `analysis`, `source_meta` are **JSON text columns**.
  `call_type ∈ {manager, receptionist}`. `source_type ∈ {upload, ingest,
  telegram_voice, telegram_audio, telegram_video, youtube, zadarma}`.
- `clients` — customer records, `manager_id` owner.
- `notifications` — in-app bell + action-item rows.
- `telegram_users`, `tags`, `call_tags`, `youtube_whitelist`, `bot_settings`.

Migrations: **no Alembic**. `db.init_db()` does `CREATE TABLE IF NOT EXISTS` then
`PRAGMA table_info` + `ALTER TABLE ADD COLUMN`. To add a column, append an ALTER in
`init_db()` — `db.py:176-200` is the pattern. **ALTER-only**: you cannot rename,
retype, or drop anything.

## The pipeline (the thing you'll break if careless)

Ingest (upload / ingest API / Zadarma sync / Zadarma webhook / Telegram / YouTube)
→ `_process_call` (api.py:53) → `_analyze_call` (api.py:98).

Status flow:
`queued → transcribing → transcribed → analyzing → done | error`

- `_process_call`: `Transcriber().transcribe_wav()` via `asyncio.run(wait_for(…,120))`,
  3 retries with 2/4/8s backoff on 503/429/UNAVAILABLE.
- **Processing modes.** `bot_settings.processing_mode` is `online` (default) or
  `private`. `private` transcribes audio locally with GigaAM (`local_stt.py`,
  sherpa-onnx, model in the read-only `local-stt/model`); audio never leaves the
  machine, but the **transcript still goes to Gemini** for analysis. If the local
  model is unusable it logs a warning and falls back to Gemini — a call never
  hangs. Read/written via `GET|PATCH /api/settings` (`routes_settings.py`).
  `Transcriber`'s Gemini client is built lazily for exactly this reason.
- `_analyze_call`: polls up to 30×1s for a transcript, then `Analyzer().analyze()`
  (60s timeout, 5 retries), then a **second** Gemini call `extract_action_items` that
  fans out into `notifications` rows. On success the call's `name` is overwritten by
  the LLM's `topic`.
- Background execution is inconsistent on purpose-ish: `BackgroundTasks` in some
  paths, raw `threading.Thread` in `routes_zadarma.py`, a throwaway
  `ThreadPoolExecutor(max_workers=2)` per Telegram message. **Every path spawns both
  `_process_call` and `_analyze_call` separately** — `_analyze_call` just waits.
  If you add an ingest path, you must spawn both or the call hangs in `queued`.

Each task constructs its own `Transcriber()`/`Analyzer()` because the async genai
client cannot cross `asyncio.run()` loops (see the comment at `api.py:20`).

### Tests

`cd backend && uv run pytest` — `tests/` uses `TestClient` against the real app with a
temp `DATA_DIR` (set in `conftest.py` before the app import) and `APP_ENV=prod` so no
demo accounts are seeded.

## The scorecard contract

`analysis.py:15` `Scorecard` + `analysis.py:44` `CallAnalysis` are passed to Gemini as
a **response_schema**. Changing them changes the persisted JSON shape, which
`ScoreDistributionChart`, `ScorecardView`, `Analytics`, `db.get_problem_calls` and
`db.get_manager_rankings` all read via `json_extract(analysis, '$.scorecard.overall')`.
**If you change a field name, you must migrate `calls.analysis` rows and the SQL.**

Rubric dims: `opening, discovery, objection_handling, value_prop, closing, rapport,
talk_ratio, overall` — all 0-100. Also `rep_share_of_talk` (0-1), `outcome`
(win/likely/uncertain/unknown), `key_metrics[]`, `coaching_points[]`, `next_steps[]`,
`action_items[]`.

Two derived business concepts live in SQL, not code:
- **Problem call** = `overall < 50` (`db.py:860`).
- **Solved vs unsolved problem** = whether `lower(analysis)` contains the Uzbek
  substring `'hal qilindi'` (`db.py:905-915`). That is a string match against
  free-text model output. It is fragile and you should probably replace it with a
  real column — but know that the Xodimlar leaderboard depends on it.

## Zadarma integration

- Credentials: env `ZADARMA_API_KEY` / `ZADARMA_API_SECRET`, falling back to
  `bot_settings` rows `zadarma_api_key` / `zadarma_api_secret` (**plaintext at rest**,
  `routes_zadarma.py:40`).
- `zadarma.py` signs requests: HMAC-SHA1 over `method + params + md5(params)`, hex,
  base64, sent as `Authorization: key:sig`.
- Two entry paths: `POST /api/zadarma/sync` (paginated pull of `GET /v1/statistics/pbx/`,
  admin only) and `POST /api/zadarma/webhook` (Zadarma `NOTIFY_RECORD` push,
  authenticated by the `ZADARMA_WEBHOOK_SECRET` shared secret).
  Both dedupe on `zadarma_call_id` stored in `source_meta`.

## Auth & roles

- Sessions: `Authorization: Bearer <token>` or a `token` query param.
- Passwords: PBKDF2-HMAC-SHA256, 100k iters, `salt$digest` (`auth.py:12`).
- Backend access control lives in `_check_call_access` (`api.py:238`) and inline
  role branches in `db.list_calls` / `db.list_clients`. **Frontend guards are cosmetic**
  — in-page 403 cards, not router guards. Never rely on the frontend for security.
- Two independent admin models: HTTP uses DB `role='admin'`; Telegram uses env
  `TELEGRAM_ADMIN_IDS`.

## Frontend conventions

- `api.ts` `request<T>()` is the only fetch wrapper. It attaches the bearer token
  from `localStorage['suhbatdosh_token']` and on 401 clears it and fires a window
  `auth:logout` event that `auth.tsx` listens for. Add endpoints there, not inline.
- No React Query / Redux / Zustand. `useState` + `useEffect` + hand-rolled polling
  (Calls every 3s, CallDetail every 10s, NotificationBell every 30s). Match this.
- `tsconfig.app.json` has `noUnusedLocals`/`noUnusedParameters` but **`strict` is OFF**.
  Several pages `as unknown as Client[]` across the user/client type boundary. This is
  why some real bugs typecheck.
- Score thresholds (`≥70` good / `≥40` bad) are hardcoded in ~6 files instead of
  `lib/format.ts`. Prefer `lib/format.ts` for anything new.
- i18n: add keys to **both** `translations.en` and `translations.uz` in
  `i18n/translations.ts`. Keys are flat dotted strings.
- UI is bilingual en/uz; `lib/format.ts:scoreLabel` returns Uzbek unconditionally —
  a known wart, don't propagate it.

## Known landmines — read before you debug

These are real, verified. Fix opportunistically, but don't be surprised by them.

**Security / correctness**
1. ~~`auth.py` / `routes_auth.py` logout never deleted the session~~ — **FIXED**.
   `get_current_user` now uses `Query` for `token` and logout reads the header
   via `auth.session_token_from`.
2. ~~`POST /api/zadarma/webhook` was unauthenticated~~ — **FIXED**. It now
   requires `ZADARMA_WEBHOOK_SECRET` (`X-Webhook-Secret` header, `webhook_secret`
   form field, or `?zd_echo=`). With no secret configured it returns 503.
3. ~~Tag endpoints had no `_check_call_access`~~ — **FIXED**.
4. ~~`GET /api/clients/{id}` had no ownership check~~ — **FIXED**.
5. ~~`/api/stats/*` returned org-wide data to any role~~ — **FIXED**; now
   `admin`/`yonalish` only. Managers must be shown an empty/403 state.
6. ~~Demo seeding was unconditional~~ — **FIXED**. `SEED_DEMO_USERS` /
   `SEED_DEMO_CALLS` default to `APP_ENV in (dev, unset)`; `APP_ENV=prod` seeds nothing.
7. ~~CORS was `allow_origins=["*"]`~~ — **FIXED**; now `config.CORS_ORIGINS`
   from the `CORS_ORIGINS` env var (comma-separated, `*` when unset).
8. `api.audioUrl` puts the bearer token in a query string (`api.ts:91`) — leaks into
   logs/history. Unavoidable for `<audio>`, but know it.

**Logic**
9. ~~`_reanalyse_done_calls` re-ran Gemini over the whole DB on every start~~ —
   **FIXED**: one SQL query, capped at 50 per boot.
10. `_match_sip_to_user` (`routes_zadarma.py`) does `email LIKE '%<sip>%'`.
    Effectively always `None`, so **every synced Zadarma call lands with
    `user_id=NULL`** and is invisible in manager listings. This is the single biggest
    gap in the Zadarma flow.
11. Zadarma `call_type` is hardcoded `"manager"` (`routes_zadarma.py:249`); client is
    always `None`.
12. `_import_webhook_recording` does an unconditional `time.sleep(45)` per event.
13. Zadarma webhook dedupe is a raw `source_meta LIKE '%id%'` substring match.
14. Zadarma sync sends UTC bounds; Zadarma expects account-local time.
15. **YouTube-ingested calls never get processed** — `youtube.py` creates the row and
    sets `queued` but nobody spawns `_process_call`/`_analyze_call`. They hang forever.
16. `transcribe.py:66` hardcodes `language_code = None`, so `calls.language` is always
    NULL from that path even though `live.py` configures `uz-Latn-UZ`/`en-US`.
17. `ManagersAdmin.tsx` calls `api.createClient`/`updateClient` when creating **users**
    (lines 81,84) while delete correctly uses `deleteUser` (171). It also has no role
    guard, and its search filter has an operator-precedence bug (282-287).
18. `ManagersDirections.tsx` casts `User[]` to `Manager[]` (319) so its
    `total_calls`/`avg_score` are `NaN`/undefined.
19. `Users.tsx:39` `ROLES` omits `'yonalish'` — you cannot assign that role in the UI.
20. `Calls.tsx:509-517` — the "slow down polling to 10s" branch is unreachable; it
    polls every 3s forever.
21. `CallDetail.tsx:234-238` — dead "stop polling" block with an empty body.

**Dead code you can delete**
22. `api.py:24-50` — `_transcriber` / `_rest_transcriber` / `_analyzer` singletons and
    their getters are never called. `live.py` (159 lines, the entire Gemini Live
    streaming path) is unreachable — there is no WebSocket endpoint registered.
23. `zadarma.py:56` `_request_post` never called. `audio.py:57` `pcm_chunks` never used.
24. `db.list_users_by_role` (`db.py:249`) never called. `db.list_calls(role=...)`
    takes a `role` param it never uses (`db.py:471`).
25. Frontend: 18 API helpers in `api.ts` have zero call sites — tags, YouTube,
    Telegram link, and **the entire Zadarma UI does not exist**.
    `CallTypePieChart.tsx` and `ScoreDistributionChart.tsx` are unused files
    (Analytics reimplements the latter inline).
26. `ManagersList.tsx` / `ManagersDirections.tsx` are ~95% duplicated (~480 lines
    each). `ManagersAdmin.tsx` is a copy-paste of `Clients.tsx`.
27. `/status` Telegram command is advertised in `/help` and `post_init` but never
    registered.
28. `main.py:1018` catch-all `GET /{path}` returns `index.html` for any unmatched
    path, so typo'd API URLs get HTML 200 instead of 404.

## Conventions

- Python: module docstrings on route files that mirror the FastAPI `/docs` text
  (see `routes_zadarma.py:1`). Typed signatures. `logger = logging.getLogger("suhbatdosh.<area>")`
  per module. No comments unless the *why* is non-obvious.
- Any new AI prompt goes in `prompts.py` and must request **Uzbek** output.
- New API route → add to the relevant `routes_*.py` (or `api.py` for calls/stats),
  register the router in `main.py`, and add a typed helper to `frontend/src/lib/api.ts`.
- `backend/tests/` now exists (pytest + `TestClient`, temp `DATA_DIR`, no mocks
  beyond monkeypatching Gemini). Add a case there rather than shipping untested.

## Naming note

The repo directory is `ViaCall` and `Layout.tsx:195` still renders "ViaCall", but the
product is **Suhbatdosh** (`translations.ts` `brand.name`). Domains:
`suhbatdosh.uz`, `suhbatdoshai.uz`. Don't get confused by the mismatch.