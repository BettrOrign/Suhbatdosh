#!/usr/bin/env python
"""Command-line transcription.

    python stt.py recording.ogg
    python stt.py a.wav b.mp3 --json
"""

from __future__ import annotations

import argparse
import json
import sys

import gigaam


def main():
    ap = argparse.ArgumentParser(description="Offline Uzbek/Russian speech-to-text")
    ap.add_argument("files", nargs="+")
    ap.add_argument("--json", action="store_true", help="emit JSON instead of text")
    args = ap.parse_args()

    gigaam.load()

    results = []
    for f in args.files:
        try:
            r = gigaam.transcribe_file(f)
        except Exception as exc:
            print(f"error: {f}: {exc}", file=sys.stderr)
            sys.exit(1)
        r["file"] = f
        results.append(r)
        if not args.json:
            print(f"\n=== {f}  ({r['duration_sec']}s audio, {r['process_sec']}s)")
            print(r["text"])

    if args.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()