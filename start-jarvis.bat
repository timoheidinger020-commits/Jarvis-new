@echo off
REM JARVIS starten (Doppelklick unter Windows)
cd /d "%~dp0"
where node >/dev/null 2>nul
if errorlevel 1 (
  echo Node.js ist nicht installiert. Bitte zuerst Node.js installieren: https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules (
  echo Erster Start: benoetigte Pakete werden installiert ...
  call npm install
)
if not exist .env (
  echo Die Datei .env fehlt. Bitte .env.example kopieren, in .env umbenennen und ausfuellen.
  pause
  exit /b 1
)
REM Browser nach 3 Sekunden oeffnen (Port anpassen, falls in .env geaendert)
start "" cmd /c "timeout /t 3 >/dev/null & start http://localhost:3000"
call npm start
pause
