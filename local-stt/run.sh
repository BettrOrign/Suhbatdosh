#!/usr/bin/env bash
# Start the local offline STT server.
#   ./run.sh                 -> http://127.0.0.1:8099
#   ./run.sh --port 9000     -> different port
#   ./run.sh --host 0.0.0.0  -> expose on the LAN
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

PY="${PYTHON:-$(dirname "${BASH_SOURCE[0]}")/.venv/bin/python}"
[ -x "$PY" ] || PY=python3
exec "$PY" server.py "$@"
