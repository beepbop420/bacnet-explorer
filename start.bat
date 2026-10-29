@echo off
setlocal
cd /d "%~dp0"
title NABE

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
  REM The packages travel in the folder, so a first start works on a site
  REM with no internet. The versions are the ones NABE was tested with.
  if exist "pakker\" (
    "venv\Scripts\python.exe" -m pip install --quiet --no-index --find-links pakker -r requirements.txt
  ) else (
    "venv\Scripts\python.exe" -m pip install --quiet -r requirements.txt
  )
  if errorlevel 1 (
    echo.
    echo   FEIL: Klarte ikke installere avhengigheter.
    echo   Pakkene i mappen "pakker" er laget for Python 3.14. Har PC-en
    echo   en annen versjon, trengs nett foerste gang.
    echo.
    pause
    exit /b 1
  )
  echo   Ferdig.
)


echo.
echo   NABE kjoerer paa http://127.0.0.1:8092
echo   Lukk dette vinduet for aa stoppe.
echo.

REM The browser waits until NABE answers. Opening it straight away raced the
REM server, and the page came up broken until it was refreshed.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for ($i = 0; $i -lt 100; $i++) { try { Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8092/api/status' -TimeoutSec 1 | Out-Null; Start-Process 'http://127.0.0.1:8092'; break } catch { Start-Sleep -Milliseconds 300 } }"
"venv\Scripts\python.exe" -m uvicorn server:app --host 127.0.0.1 --port 8092
