@echo off
setlocal
cd /d "%~dp0"
title BACnet Explorer - autostart

echo.
echo   BACnet Explorer - start automatisk ved paalogging
echo   ================================================
echo.
echo   En nettside kan ikke starte et program paa PC-en din - det er en
echo   sikkerhetsgrense i alle nettlesere. Loesningen er at Explorer
echo   allerede kjoerer naar du trenger den.
echo.
echo   Dette legger en snarvei i Oppstart-mappen. Den starter minimert,
echo   og portalen finner den med en gang.
echo.

set "OPPSTART=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SNARVEI=%OPPSTART%\BACnet Explorer.lnk"

if /I "%~1"=="fjern" goto :fjern

echo   Mappe : %~dp0
echo   Snarvei: %SNARVEI%
echo.
choice /C JN /N /M "   Legge inn autostart? [J/N] "
if errorlevel 2 goto :avbrutt

REM Snarveien peker paa den stille starteren, ikke paa start.bat, slik at
REM det ikke ligger et konsollvindu aapent hele dagen.
powershell -NoProfile -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%SNARVEI%');" ^
  "$s.TargetPath='%~dp0start-stille.vbs';" ^
  "$s.WorkingDirectory='%~dp0';" ^
  "$s.Description='BACnet Explorer';" ^
  "$s.Save()"

if exist "%SNARVEI%" (
  echo.
  echo   Ferdig. Explorer starter naa automatisk ved paalogging.
  echo   Vil du starte den med en gang, kjoer start.bat.
  echo.
  echo   Angre: kjoer denne filen paa nytt med ordet  fjern
  echo   f.eks.  "Installer autostart.bat" fjern
) else (
  echo.
  echo   FEIL: klarte ikke lage snarveien.
)
echo.
pause
exit /b 0

:fjern
if exist "%SNARVEI%" (
  del "%SNARVEI%"
  echo   Autostart fjernet.
) else (
  echo   Autostart var ikke satt opp.
)
echo.
pause
exit /b 0

:avbrutt
echo.
echo   Avbrutt - ingenting er endret.
echo.
pause
exit /b 0
