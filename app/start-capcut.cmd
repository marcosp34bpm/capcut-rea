@echo off
setlocal
set "APP_DIR=C:\Users\marco\Documents\capcut-rea\app"
set "NODE_EXE=C:\Program Files\nodejs\node.exe"
set "PORT=8787"
set "CAPCUT_REA_SESSION=%APP_DIR%\session\draft.json"

if not exist "%APP_DIR%\session" mkdir "%APP_DIR%\session"
cd /d "%APP_DIR%"

rem Start the server detached, with its own minimized console and its own log file.
start "CapCut Reconstruction Server" /min cmd /c ""%NODE_EXE%" "%APP_DIR%\src\server.mjs" ^> "%APP_DIR%\session\server.log" 2^>^&1"

rem Wait until the server answers before opening the browser.
set /a tries=0
:wait
set /a tries+=1
"%NODE_EXE%" -e "fetch('http://127.0.0.1:%PORT%/api/state').then(()=>process.exit(0)).catch(()=>process.exit(1))" >nul 2>&1
if not errorlevel 1 goto open
if %tries% lss 40 goto wait

echo CapCut Reconstruction server did not start on port %PORT%.
pause
exit /b 1

:open
start "" "http://localhost:%PORT%/"
exit /b 0
