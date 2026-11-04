@echo off
setlocal
set ELECTRON_RUN_AS_NODE=
title Energya Industries Photobooth
echo ===================================================
echo Starting Energya Industries Photobooth...
echo ===================================================

:: Check if local web server on port 3000 is already active
netstat -ano | findstr ":3000 " | findstr "LISTENING" >nul
if %ERRORLEVEL% equ 0 (
    echo Local Web Server is already running on http://127.0.0.1:3000
) else (
    echo Starting Energya local server in background...
    start /min "Energya Server" cmd /c "cd /d "%~dp0" && node server/server.mjs"
    echo Waiting for server to initialize...
    timeout /t 3 /nobreak >nul
)

echo Launching Energya Photobooth Desktop Kiosk...
if exist "%~dp0scripts\configure_printer.py" (
    echo Auto-configuring printer to 102x152mm Glossy Borderless...
    python "%~dp0scripts\configure_printer.py"
)
cd /d "%~dp0build"
start "" "Energya-Photobooth.exe"

