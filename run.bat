@echo off
setlocal enabledelayedexpansion

set "PROJECT_ROOT=%~dp0"
if "%PROJECT_ROOT:~-1%"=="\" set "PROJECT_ROOT=%PROJECT_ROOT:~0,-1%"
set "BACKEND_DIR=%PROJECT_ROOT%\backend"
set "FRONTEND_DIR=%PROJECT_ROOT%\frontend"

set "BACKEND_PORT=8123"
set "FRONTEND_PORT=5173"
set "HOST=127.0.0.1"

if "%1"=="--help" goto :usage
if "%1"=="-h" goto :usage
if "%1"=="--stop" goto :stop_servers
if "%1"=="--desktop" goto :desktop_dev
if "%1"=="--desktop-build" goto :desktop_build
if "%1"=="--netLAN" set "HOST=0.0.0.0"

call :stop_servers_quiet

echo ==> Checking backend dependencies (uv / python) ...
if exist "%BACKEND_DIR%\.venv\Scripts\python.exe" (
    set "PYTHON_EXE=%BACKEND_DIR%\.venv\Scripts\python.exe"
) else (
    where uv >nul 2>&1
    if !errorlevel! equ 0 (
        cd /d "%BACKEND_DIR%" && uv sync --quiet
        set "PYTHON_EXE=%BACKEND_DIR%\.venv\Scripts\python.exe"
    ) else (
        set "PYTHON_EXE=python"
    )
)

echo ==> Checking frontend dependencies (npm) ...
cd /d "%FRONTEND_DIR%"
if not exist "node_modules\" (
    npm install
)

echo ==> Starting backend on http://!HOST!:!BACKEND_PORT! ...
cd /d "%BACKEND_DIR%"
start /b "" "!PYTHON_EXE!" run_server.py --host !HOST! --port !BACKEND_PORT!

echo ==> Starting frontend on http://!HOST!:!FRONTEND_PORT! ...
cd /d "%FRONTEND_DIR%"
npm run dev
goto :eof

:desktop_dev
call :stop_servers_quiet
echo ==> Launching Suhbatdosh Desktop Window (Tauri dev) ...
cd /d "%PROJECT_ROOT%"
if not exist "%FRONTEND_DIR%\node_modules\.bin\tauri.cmd" (
    cd /d "%FRONTEND_DIR%" && npm install
)
cd /d "%PROJECT_ROOT%"
call "%FRONTEND_DIR%\node_modules\.bin\tauri.cmd" dev
goto :eof

:desktop_build
echo ==> Building Suhbatdosh Desktop Bundle (Tauri build) ...
cd /d "%PROJECT_ROOT%"
if not exist "%FRONTEND_DIR%\node_modules\.bin\tauri.cmd" (
    cd /d "%FRONTEND_DIR%" && npm install
)
call "%FRONTEND_DIR%\node_modules\.bin\tauri.cmd" build
goto :eof

:stop_servers
echo Stopping Suhbatdosh servers...
call :stop_servers_quiet
echo Stopped.
goto :eof

:stop_servers_quiet
taskkill /F /IM "suhbatdosh.exe" >nul 2>&1
taskkill /F /IM "suhbatdosh-backend.exe" >nul 2>&1
for /f "tokens=2" %%p in ('tasklist /nh /fi "imagename eq python.exe" 2^>nul ^| findstr /i "python"') do (
    taskkill /F /PID %%p >nul 2>&1
)
for /f "tokens=2" %%p in ('tasklist /nh /fi "imagename eq node.exe" 2^>nul ^| findstr /i "node"') do (
    taskkill /F /PID %%p >nul 2>&1
)
goto :eof

:usage
echo Suhbatdosh -- Call Analytics Platform (Windows)
echo.
echo Usage:
echo   run.bat [OPTIONS]
echo.
echo Options:
echo   --desktop        Launch Suhbatdosh in its own Tauri desktop window (dev mode)
echo   --desktop-build  Build release desktop installer (.msi / .exe)
echo   --netLAN         Listen on 0.0.0.0
echo   --stop           Stop running Suhbatdosh servers
echo   --help, -h       Show this help message
goto :eof
