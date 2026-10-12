# SHARED CONTRACT — do not change without coordinating

Both agents (frontend + backend) build against this exactly. If either side thinks
this needs to change, stop and say so rather than diverging.

## Repository layout

```
backend/     FastAPI + SQLite + Gemini + python-telegram-bot   <- BACKEND AGENT OWNS
frontend/    Vite 8 + React 19 + TS + Tailwind v4 + shadcn/ui <- FRONTEND AGENT OWNS
local-stt/   Portable offline STT service (GigaAM 220M int8)  <- READ-ONLY, nobody edits
docs/        Research notes
```

**Concurrency rules**
- Backend agent touches `backend/` only.
- Frontend agent touches `frontend/src/` only.
- `local-stt/` is read-only for both. If a change is needed there, report it instead.
- Neither agent runs `git commit` / `git add` / `git checkout` / `git stash`.
  Leave changes in the working tree.
- Neither agent modifies the other's directory, even to "fix" a typo.

## Processing mode — the API contract

Two modes:

- `online`   — transcription AND analysis via Gemini (cloud). Current behaviour, unchanged.
- `private`  — transcription via the **local GigaAM model** on this server; the resulting
  **transcript still goes to Gemini** for analysis. Audio never leaves the machine.
  This is the privacy guarantee: *audio stays local*. Be honest about this in UI copy —
  do not claim the transcript is also private.

### Endpoints (backend implements, frontend consumes)

```http
GET /api/settings
```
Auth: any authenticated user.
```json
{
  "mode": "private",
  "stt": {
    "provider": "local",
    "model": "GigaAM-Multilingual 220M int8",
    "available": true,
    "languages": ["uz", "ru", "en", "kk", "ky"]
  },
  "analysis": { "provider": "gemini", "model": "gemini-2.5-flash" },
  "updated_at": "2026-10-12T12:00:00Z"
}
```
- `available: false` when the local model is missing or the dependency is absent.
  The frontend must render a clear warning and offer a one-click fallback to `online`.

```http
PATCH /api/settings
```
Auth: **admin only** (403 otherwise). Body — any subset:
```json
{ "mode": "private" }
```
Returns the same shape as GET. Validates `mode ∈ {online, private}`, else 400.

### Persistence

Store in the existing `bot_settings` table (`db.get_bot_setting` / `db.set_bot_setting`),
key `processing_mode`, values `online` | `private`. Default `online` when unset.

Do **not** reuse `/api/bot/settings` in `routes_sources.py` — it is half-broken (its GET
ignores what its POST writes) and is a security liability (it can write arbitrary keys
into the same table that stores Zadarma secrets in plaintext). Add a clean
`backend/app/routes_settings.py` instead and register it in `main.py`.

### Frontend behaviour

- `lib/mode.ts` currently persists to `localStorage`. Change it to read/write the API.
  Keep the same module boundary — it is the single seam. Optimistic update, revert on failure.
- A non-admin must be able to READ the current mode (so the UI can show it) but must never
  be able to change it. The switcher renders read-only/disabled for them.
- Never let the UI claim offline operation it does not have.

## Local STT wiring (backend)

- `backend/app/transcribe.py` currently only calls Gemini. Add a mode-aware branch.
- Private mode transcribes locally; online mode is byte-for-byte the existing Gemini path.
- Prefer **in-process** sherpa-onnx over calling the `local-stt` HTTP service, so
  `./run.sh` stays the single entrypoint for deployment. Lazy-import sherpa-onnx so the
  backend still boots if the dependency or model is absent (degrade, don't crash).
- Default model dir: `<repo>/local-stt/model`. Make it overridable via env
  (`LOCAL_STT_MODEL_DIR`) and `.env` via the existing `config.py:_resolve` pattern.
- If local STT is unavailable in private mode: fall back to Gemini and record why
  (logger warning + set a flag the caller can surface). Do not silently produce nothing.
- Keep the status machine intact: `queued → transcribing → transcribed → analyzing → done | error`.

## Verification

- Backend agent: exercise every endpoint with `curl` against a running server
  (`./run.sh --stop && ./run.sh`, logs at `logs/server.log`). Include the admin-only 403 case
  and the non-admin 403 case. Verify private mode end-to-end by ingesting an audio file and
  confirming the transcript comes from the local model, not Gemini.
- Frontend agent: `cd frontend && npm run build` (this is the typecheck — `strict` is OFF so
  it is weak; be careful) and `npm run lint`. Then confirm the app still renders.
- Neither of you can fully verify your half alone. State clearly what you verified and
  what still needs the other side.