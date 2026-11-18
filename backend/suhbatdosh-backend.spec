# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for Suhbatdosh desktop sidecar (Windows & Linux)."""

from pathlib import Path

ROOT = Path(SPECPATH).resolve().parent
BACKEND = Path(SPECPATH).resolve()

datas = [
    (str(BACKEND / "config.yaml"), "."),
    (str(BACKEND / "app" / "ico" / "knowledge.md"), "app/ico"),
    (str(BACKEND / "app" / "ico" / "prompt.md"), "app/ico"),
    (str(BACKEND / "app" / "ico" / "org_profile.json"), "app/ico"),
]

binaries = []
try:
    from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs
    binaries.extend(collect_dynamic_libs("sherpa_onnx"))
    binaries.extend(collect_dynamic_libs("sherpa_onnx_core"))
    datas.extend(collect_data_files("sherpa_onnx"))
except Exception:
    pass

frontend_dist = ROOT / "frontend" / "dist"
if frontend_dist.exists():
    datas.append((str(frontend_dist), "frontend_dist"))

a = Analysis(
    [str(BACKEND / "run_server.py")],
    pathex=[str(BACKEND)],
    binaries=[],
    datas=datas,
    hiddenimports=[
        "uvicorn.logging",
        "uvicorn.loops",
        "uvicorn.loops.auto",
        "uvicorn.protocols",
        "uvicorn.protocols.http",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.websockets",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan",
        "uvicorn.lifespan.on",
        "apscheduler.schedulers.asyncio",
        "apscheduler.triggers.cron",
        "apscheduler.triggers.interval",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="suhbatdosh-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
)
