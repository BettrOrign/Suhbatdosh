#!/usr/bin/env python
"""Local STT HTTP server — GigaAM 220M int8 on sherpa-onnx.

    python server.py [--port 8099] [--host 127.0.0.1]

Endpoints
    GET  /health    -> {"status":"ok","model":"..."}
    POST /transcribe -> raw audio body OR multipart/form-data
                        -> {"text": "...", "turns": [{"start","end","text"}],
                            "duration_sec": ..., ...}

Fully offline: no network calls, no API keys, CPU only.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import tempfile
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import gigaam

logger = logging.getLogger("local-stt")

MAX_UPLOAD_BYTES = 200 * 1024 * 1024  # 200 MB, matches Suhbatdosh's ingest cap


class Handler(BaseHTTPRequestHandler):
    server_version = "local-stt/1.0"

    def log_message(self, fmt, *args):
        logger.info("%s - %s", self.address_string(), fmt % args)

    def _send(self, code: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.rstrip("/") in ("/health", ""):
            self._send(200, {
                "status": "ok",
                "model": "GigaAM-Multilingual 220M int8",
                "languages": ["uz", "ru", "en", "kk", "ky"],
                "offline": True,
            })
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path.rstrip("/") != "/transcribe":
            self._send(404, {"error": "not found"})
            return

        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            self._send(400, {"error": "invalid Content-Length"})
            return

        if length <= 0:
            self._send(400, {"error": "empty request body"})
            return
        if length > MAX_UPLOAD_BYTES:
            self._send(413, {"error": f"audio exceeds {MAX_UPLOAD_BYTES // (1024*1024)} MB"})
            return

        body = self.rfile.read(length)
        started = time.perf_counter()

        try:
            audio = self._extract_audio(body)
            result = gigaam.transcribe_array(*audio)
        except Exception as exc:
            logger.exception("transcription failed")
            self._send(400, {"error": str(exc)})
            return

        duration = result["duration_sec"]
        elapsed = time.perf_counter() - started
        self._send(200, {
            "text": result["text"],
            "turns": result["turns"],
            "duration_sec": duration,
            "process_sec": round(elapsed, 2),
            "rtf": round(elapsed / duration, 3) if duration else None,
            "language": "uz/ru",
        })

    def _extract_audio(self, body: bytes):
        """Return (float32 mono array, sample_rate) from raw or multipart body."""
        ctype = self.headers.get("Content-Type", "")
        data = body
        ext = os.path.splitext(self.headers.get("X-Filename", ""))[1] or ".wav"

        if "multipart/form-data" in ctype:
            data, ext = self._extract_multipart(body, ctype)

        tmp = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
        try:
            tmp.write(data)
            tmp.close()
            return gigaam.to_16k_mono(tmp.name)
        finally:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass

    @staticmethod
    def _extract_multipart(body: bytes, ctype: str) -> tuple[bytes, str]:
        """Pull the first file part out of a multipart body. Returns (data, extension)."""
        match = re.search(r'boundary="?([^";\r\n]+)"?', ctype, re.I)
        if not match:
            raise ValueError("multipart request has no boundary")

        for part in body.split(b"--" + match.group(1).encode()):
            if b"\r\n\r\n" not in part:
                continue
            head, payload = part.split(b"\r\n\r\n", 1)
            headers = head.decode("latin-1").lower()
            if "filename=" not in headers:
                continue
            fname = re.search(r'filename="([^"]*)"', head.decode("latin-1"))
            ext = os.path.splitext(fname.group(1))[1] if fname else ".wav"
            return payload.rsplit(b"\r\n", 1)[0], ext or ".wav"

        raise ValueError("no file part found in multipart body")


def main():
    ap = argparse.ArgumentParser(description="Local offline STT server")
    ap.add_argument("--port", type=int, default=8099)
    ap.add_argument("--host", default="127.0.0.1",
                    help="default 127.0.0.1 (local only); use 0.0.0.0 to expose")
    ap.add_argument("--threads", type=int, default=8)
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    logger.info("loading model (this takes a few seconds)...")
    started = time.perf_counter()
    gigaam.load(num_threads=args.threads)
    logger.info("model ready in %.1fs", time.perf_counter() - started)

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    logger.info("listening on http://%s:%d", args.host, args.port)
    logger.info("  GET  /health")
    logger.info("  POST /transcribe   (raw audio body, or multipart/form-data)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("shutting down")
        server.shutdown()


if __name__ == "__main__":
    main()