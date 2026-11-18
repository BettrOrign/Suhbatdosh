"""Desktop/sidecar entrypoint for Suhbatdosh backend (Linux & Windows)."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import uvicorn


def _ensure_ffmpeg_on_path() -> None:
    """Include the executable's directory on PATH so bundled ffmpeg(.exe) is found."""
    exe_dir = str(Path(sys.executable).resolve().parent)
    cur_path = os.environ.get("PATH", "")
    if exe_dir not in cur_path.split(os.pathsep):
        os.environ["PATH"] = exe_dir + os.pathsep + cur_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Suhbatdosh desktop backend server")
    parser.add_argument("--host", default=os.getenv("HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("PORT", "8123")))
    args = parser.parse_args()

    _ensure_ffmpeg_on_path()

    # Ensure backend/ is importable when launched from any working directory
    backend_dir = str(Path(__file__).resolve().parent)
    if backend_dir not in sys.path:
        sys.path.insert(0, backend_dir)

    from app.main import app  # noqa: WPS433

    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
