# Suhbatdosh — Call Analytics Platform

Suhbatdosh is a full-stack call analytics platform that provides real-time transcription, analysis, and visualization of voice calls.

## Features

- **Real-time Transcription** — Stream audio to Gemini for live transcription
- **Call Analytics** — Scorecards, sentiment analysis, and summaries
- **Dashboard** — Interactive charts and call history
- **Telegram Bot Integration** — Ingest YouTube videos and manage calls via Telegram
- **Multi-user Support** — Client, manager, and admin roles

## Tech Stack

- **Frontend:** React + TypeScript + Vite + Tailwind CSS + shadcn/ui
- **Backend:** FastAPI + Python (Gemini API, SQLite)
- **Database:** SQLite
- **Other:** Gemini AI, yt-dlp, ffmpeg

## Quick Start

### Prerequisites

- Python 3.12+ and [uv](https://docs.astral.sh/uv/)
- Node.js 18+ and npm
- ffmpeg

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd Suhbatdosh

# Copy environment template and configure secrets
cp backend/.env.example backend/.env
# Edit backend/.env with your API keys

# Ensure run.sh is executable
chmod +x run.sh

# Start both frontend and backend
./run.sh
```

### Access

- **Frontend (dev):** http://localhost:5173
- **Backend API:** http://localhost:8123
- **API Docs:** http://localhost:8123/docs

### First Login

No account exists until you set one. Add to `backend/.env` before first run:

```
ADMIN_EMAIL=you@yourcompany.com
ADMIN_PASSWORD=<a strong password>
```

That admin is created once, on an empty database. Demo accounts and demo
calls are **off** by default; they only appear if you opt in with
`SEED_DEMO_USERS=true` / `SEED_DEMO_CALLS=true`.

## Project Structure

```
Suhbatdosh/
├── backend/          # FastAPI backend application
│   ├── app/          # Python source code
│   ├── pyproject.toml
│   └── uv.lock
├── frontend/         # React + Vite frontend
│   ├── src/          # TypeScript source code
│   ├── components.json
│   └── package.json
├── data/             # SQLite DB and audio artifacts (gitignored)
├── logs/             # Application logs (gitignored)
├── run.sh            # One-command launcher
└── .env              # Environment variables (gitignored)
```

## Running

```bash
# Start on localhost only
./run.sh

# Start accessible on LAN
./run.sh --netLAN

# Stop servers
./run.sh --stop
```

## License

MIT
