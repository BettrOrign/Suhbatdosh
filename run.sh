#!/usr/bin/env bash
#
# run.sh — one-command launcher for Suhbatdosh
#
# Starts:
#   - Backend API (FastAPI/uvicorn) on <host>:8123  (serves the built frontend)
#   - Frontend dev server (Vite)        on <host>:5173  (hot reload, proxies /api → backend)
#
# Login: ADMIN_EMAIL from backend/.env
#
# Usage:
#   ./run.sh              # launch both, localhost only
#   ./run.sh --netLAN     # listen on 0.0.0.0 — accessible from any device on the network
#   ./run.sh --stop       # stop previously launched backend + frontend
#   ./run.sh --help       # show this help message
#
set -uo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"
FRONTEND_DIR="$PROJECT_ROOT/frontend"

BACKEND_PORT="${SUHBATDOSH_PORT:-8123}"
FRONTEND_PORT="${SUHBATDOSH_FRONTEND_PORT:-5173}"

BACKEND_LOG="$PROJECT_ROOT/logs/server.log"
FRONTEND_LOG="$PROJECT_ROOT/logs/vite.log"
mkdir -p "$PROJECT_ROOT/logs"

# ---------- defaults ----------
HOST="127.0.0.1"
NET_LAN=false

# ---------- usage ----------
usage() {
    cat <<EOF
Suhbatdosh — Call Analytics Platform

Usage:
  ./run.sh [OPTIONS]

Options:
  --netLAN       Listen on 0.0.0.0 — accessible from any device on the local network
  --stop         Stop running Suhbatdosh servers
  --help, -h     Show this help message

Environment variables:
  SUHBATDOSH_PORT              Backend port  (default: 8123)
  SUHBATDOSH_FRONTEND_PORT     Frontend port (default: 5173)

Examples:
  ./run.sh                  Start on localhost only (127.0.0.1)
  ./run.sh --netLAN         Start accessible to everyone on the LAN
  ./run.sh --stop           Stop all Suhbatdosh servers

Login: ADMIN_EMAIL from backend/.env
EOF
}

# ---------- stop helper ----------
stop_servers() {
    echo "Stopping Suhbatdosh servers..."
    pkill -f "uvicorn app.main:app" 2>/dev/null || true
    pkill -f "vite" 2>/dev/null || true
    sleep 1
    echo "Stopped."
}

# ---------- parse args ----------
while [[ $# -gt 0 ]]; do
    case "$1" in
        --stop)
            stop_servers
            exit 0
            ;;
        --netLAN)
            HOST="0.0.0.0"
            NET_LAN=true
            shift
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            echo "Run './run.sh --help' for usage." >&2
            exit 1
            ;;
    esac
done

# avoid duplicates
pkill -f "uvicorn app.main:app" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
sleep 1

# ---------- backend deps ----------
echo "==> Checking backend dependencies (uv) ..."
cd "$BACKEND_DIR"
if ! command -v uv >/dev/null 2>&1; then
    echo "ERROR: 'uv' not found. Install from https://docs.astral.sh/uv/" >&2
    exit 1
fi
uv sync --quiet || { echo "ERROR: uv sync failed" >&2; exit 1; }

# ---------- frontend deps ----------
echo "==> Checking frontend dependencies (npm) ..."
cd "$FRONTEND_DIR"
if [[ ! -d node_modules ]] || [[ ! -x node_modules/.bin/tsc ]]; then
    echo "==> Installing frontend dependencies ..."
    if [[ -f package-lock.json ]]; then
        npm ci || { echo "ERROR: npm ci failed" >&2; exit 1; }
    else
        npm install || { echo "ERROR: npm install failed" >&2; exit 1; }
    fi
fi

# ---------- build frontend (so backend can serve it at :8123 too) ----------
echo "==> Building frontend for production (served at :$BACKEND_PORT) ..."
npm run build >/dev/null 2>&1 || { echo "ERROR: frontend build failed" >&2; exit 1; }

# ---------- start backend ----------
echo "==> Starting backend on http://$HOST:$BACKEND_PORT ..."
setsid bash -c "cd '$BACKEND_DIR' && uv run uvicorn app.main:app --host $HOST --port $BACKEND_PORT" \
    > "$BACKEND_LOG" 2>&1 < /dev/null &
BACKEND_PID=$!
disown 2>/dev/null || true

# wait for backend
echo "==> Waiting for backend..."
i=0
while ! curl -s -o /dev/null "http://127.0.0.1:$BACKEND_PORT/docs" 2>/dev/null; do
    i=$((i+1))
    if [ $i -ge 40 ]; then
        echo "ERROR: backend did not start (see $BACKEND_LOG)" >&2
        exit 1
    fi
    sleep 1
done

# ---------- start frontend dev server ----------
echo "==> Starting frontend dev server on http://$HOST:$FRONTEND_PORT ..."
setsid bash -c "cd '$FRONTEND_DIR' && npm run dev -- --host $HOST --port $FRONTEND_PORT" \
    > "$FRONTEND_LOG" 2>&1 < /dev/null &
FRONTEND_PID=$!
disown 2>/dev/null || true

# wait for frontend
i=0
while ! curl -s -o /dev/null "http://127.0.0.1:$FRONTEND_PORT" 2>/dev/null; do
    i=$((i+1))
    if [ $i -ge 40 ]; then
        echo "WARNING: frontend dev server did not start (see $FRONTEND_LOG)" >&2
        break
    fi
    sleep 1
done

# ---------- detect LAN IP ----------
LAN_IP=""
if $NET_LAN; then
    LAN_IP=$(ip -4 addr show scope global 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -1)
    if [[ -z "$LAN_IP" ]]; then
        LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
    fi
fi

# ---------- summary ----------
if $NET_LAN; then
    echo ""
    echo "============================================================"
    echo "  Suhbatdosh is up!  (LAN mode)"
    echo ""
    echo "  This machine's IP:  $LAN_IP"
    echo ""
    echo "  From OTHER devices, open in browser:"
    echo "    → http://${LAN_IP}:${BACKEND_PORT}"
    echo ""
    echo "  On THIS machine:"
    echo "    → http://127.0.0.1:${BACKEND_PORT}"
    echo "============================================================"
    echo "  Login: ADMIN_EMAIL from backend/.env"
    echo "  Logs:  backend  $BACKEND_LOG"
    echo "         frontend $FRONTEND_LOG"
    echo "  Stop:  ./run.sh --stop"
    echo "============================================================"
    echo ""
else
    echo ""
    echo "============================================================"
    echo "  Suhbatdosh is up!  (localhost only)"
    echo ""
    echo "  → http://127.0.0.1:${BACKEND_PORT}"
    echo ""
    echo "  To make it accessible on the LAN:"
    echo "    ./run.sh --stop && ./run.sh --netLAN"
    echo "============================================================"
    echo "  Login: ADMIN_EMAIL from backend/.env"
    echo "  Logs:  backend  $BACKEND_LOG"
    echo "         frontend $FRONTEND_LOG"
    echo "  Stop:  ./run.sh --stop"
    echo "============================================================"
    echo ""
fi
