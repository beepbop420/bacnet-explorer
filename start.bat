@echo off
setlocal
cd /d "%~dp0"
title BACnet Explorer

REM First run sets up an isolated Python environment next to this file.
if not exist "venv\Scripts\python.exe" (
  echo.
  echo   Setter opp foerste gang - dette tar et par minutter...
  echo.
  python -m venv venv
  if errorlevel 1 (
    echo.
    echo   FEIL: Fant ikke Python. Installer Python 3.10 eller nyere
    echo   fra python.org og huk av "Add Python to PATH".
    echo.
    pause
    exit /b 1
  )
  "venv\Scripts\python.exe" -m pip install --quiet --upgrade pip
  "venv\Scripts\python.exe" -m pip install --quiet fastapi uvicorn pydantic bacpypes3 psutil
  if errorlevel 1 (
    echo.
    echo   FEIL: Klarte ikke installere avhengigheter.
    echo.
    pause
    exit /b 1
  )
  echo   Ferdig.
)

REM Sett NOTES_UPSTREAM hvis notater skal deles med en felles server.

echo.
echo   BACnet Explorer kjoerer paa http://127.0.0.1:8090
echo   Lukk dette vinduet for aa stoppe.
echo.

start "" http://127.0.0.1:8090
"venv\Scripts\python.exe" -m uvicorn server:app --host 127.0.0.1 --port 8090
