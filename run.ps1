<#
.SYNOPSIS
    Suhbatdosh — Call Analytics Platform (PowerShell launcher for Windows)
.EXAMPLE
    .\run.ps1
    .\run.ps1 -Desktop
    .\run.ps1 -DesktopBuild
    .\run.ps1 -Stop
#>

[CmdletBinding()]
param(
    [switch]$Desktop,
    [switch]$DesktopBuild,
    [switch]$NetLAN,
    [switch]$Stop,
    [switch]$Help
)

if ($Help) {
    Write-Host "Suhbatdosh — Call Analytics Platform (Windows)" -ForegroundColor Cyan
    Write-Host "Usage:"
    Write-Host "  .\run.ps1                # Start web app"
    Write-Host "  .\run.ps1 -Desktop       # Start native desktop window (Tauri dev)"
    Write-Host "  .\run.ps1 -DesktopBuild  # Build Windows installer (.msi / .exe)"
    Write-Host "  .\run.ps1 -Stop          # Stop all running servers"
    Write-Host "  .\run.ps1 -NetLAN        # Listen on 0.0.0.0"
    exit 0
}

$ProjectRoot = $PSScriptRoot
$BackendDir = Join-Path $ProjectRoot "backend"
$FrontendDir = Join-Path $ProjectRoot "frontend"

function Stop-Servers {
    Write-Host "Stopping Suhbatdosh processes..." -ForegroundColor Yellow
    Get-Process -Name "suhbatdosh", "suhbatdosh-backend" -ErrorAction SilentlyContinue | Stop-Process -Force
    Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*run_server.py*" -or $_.CommandLine -like "*vite*" } | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

if ($Stop) {
    Stop-Servers
    Write-Host "Stopped." -ForegroundColor Green
    exit 0
}

Stop-Servers

if ($Desktop -or $DesktopBuild) {
    $TauriBin = Join-Path $FrontendDir "node_modules\.bin\tauri.cmd"
    if (-not (Test-Path $TauriBin)) {
        Write-Host "==> Installing frontend dependencies ..." -ForegroundColor Cyan
        Set-Location $FrontendDir
        npm install
    }
    Set-Location $ProjectRoot
    if ($Desktop) {
        Write-Host "==> Launching Suhbatdosh Desktop Window (Tauri dev) ..." -ForegroundColor Green
        & $TauriBin dev
    } else {
        Write-Host "==> Building Suhbatdosh Desktop Installer (Tauri build) ..." -ForegroundColor Green
        & $TauriBin build
    }
    exit 0
}

# Web Server Mode
$HostAddr = if ($NetLAN) { "0.0.0.0" } else { "127.0.0.1" }
$PyExe = Join-Path $BackendDir ".venv\Scripts\python.exe"
if (-not (Test-Path $PyExe)) {
    if (Get-Command uv -ErrorAction SilentlyContinue) {
        Write-Host "==> Preparing backend environment with uv ..." -ForegroundColor Cyan
        Set-Location $BackendDir
        uv sync --quiet
    } else {
        $PyExe = "python"
    }
}

Write-Host "==> Starting backend on http://${HostAddr}:8123 ..." -ForegroundColor Green
Start-Process -FilePath $PyExe -ArgumentList "run_server.py --host $HostAddr --port 8123" -WorkingDirectory $BackendDir

Write-Host "==> Starting frontend on http://${HostAddr}:5173 ..." -ForegroundColor Green
Set-Location $FrontendDir
npm run dev
