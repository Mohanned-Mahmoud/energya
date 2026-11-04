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
    where node >nul 2>nul
    if %ERRORLEVEL% equ 0 (
        echo Starting Energya local server in background...
        start /min "Energya Server" cmd /c "cd /d "%~dp0" && node server/server.mjs"
        timeout /t 2 /nobreak >nul
    ) else (
        echo [Info] Standalone mode: Energya Desktop will run its built-in server automatically.
    )
)

echo Launching Energya Photobooth Desktop Kiosk...
cd /d "%~dp0build"
start "" "Energya-Photobooth.exe"
