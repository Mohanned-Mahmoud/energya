@echo off
setlocal
cd /d "%~dp0"
call pnpm install --frozen-lockfile
call pnpm --dir artifacts\energya-photobooth build
start "Energya Photo Booth Server" /b cmd /c "node server\server.mjs"
:wait_for_server
powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/config.json -TimeoutSec 1; if ($r.StatusCode -eq 200) { exit 0 } } catch {} exit 1"
if errorlevel 1 (timeout /t 1 /nobreak >nul & goto wait_for_server)
start "Energya Photo Booth Kiosk" chrome.exe --kiosk --kiosk-printing --force-device-scale-factor=1 --use-fake-ui-for-media-stream --enable-gpu-rasterization --enable-zero-copy --ignore-gpu-blocklist --no-first-run --disable-session-crashed-bubble http://127.0.0.1:3000
