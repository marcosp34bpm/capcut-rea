@echo off
setlocal
set "APP_DIR=C:\Users\marco\Documents\capcut-rea\app"
set "NODE_EXE=C:\Program Files\nodejs\node.exe"
set "PORT=8789"
set "CAPCUT_ROOT=C:\Users\marco\AppData\Local\CapCut\Apps\9.6.0.4097"
set "CAPCUT_DRAFT_PATH=%APP_DIR%\native\draft_content.json"

if not exist "%APP_DIR%\session" mkdir "%APP_DIR%\session"
cd /d "%APP_DIR%"

rem Start the real CapCut native engine in a minimized console with its own log.
start "CapCut Native Engine" /min cmd /c ""%NODE_EXE%" "%APP_DIR%\src\native-server.mjs" ^> "%APP_DIR%\session\native-engine.log" 2^>^&1"

rem Wait until the native engine answers before opening the browser.
set /a tries=0
:wait
set /a tries+=1
"%NODE_EXE%" -e "fetch('http://127.0.0.1:%PORT%/api/state').then(()=>process.exit(0)).catch(()=>process.exit(1))" >nul 2>&1
if not errorlevel 1 goto open
if %tries% lss 60 goto wait

echo The CapCut native engine did not start on port %PORT%.
echo Check that CapCut is installed at %CAPCUT_ROOT%.
pause
exit /b 1

:open
start "" "http://localhost:%PORT%/"
exit /b 0
