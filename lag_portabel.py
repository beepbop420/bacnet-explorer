"""
Lager NABE-portabel-<versjon>.zip: NABE med sin egen Python, klar til å
pakkes ut og kjøres på en maskin uten Python og uten administratorrettigheter -
typisk fjernskrivebordsmaskinen som er den eneste som når anlegget.

    venv\\Scripts\\python.exe lag_portabel.py

Python hentes fra installasjonen denne kjører på, så ingenting lastes ned.
Pakkene kommer fra mappa «pakker», med de versjonene NABE er testet med.
"""
import os
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

HER = Path(__file__).parent
DIST = HER / "dist"
MAPPE = DIST / "NABE"
PY_KILDE = Path(getattr(sys, "_base_executable", sys.executable)).parent

APPFILER = ["server.py", "bacnet_core.py", "app.js", "index.html", "requirements.txt",
            "requirements-app.txt", "nabe_app.py"]
# Det en kjørende NABE aldri bruker. Uten dette er Python fire ganger så stor.
HOPP_OVER = {"test", "tests", "idlelib", "tkinter", "turtledemo", "ensurepip", "lib2to3",
             "__pycache__", "site-packages", "venv", "pydoc_data"}

START = r"""@echo off
setlocal
cd /d "%~dp0"
title NABE
set PYTHONPATH=
set PYTHONHOME=
echo.
echo   NABE kjoerer paa http://127.0.0.1:8092
echo   Lukk dette vinduet for aa stoppe.
echo.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for ($i = 0; $i -lt 100; $i++) { try { Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8092/api/status' -TimeoutSec 1 | Out-Null; Start-Process 'http://127.0.0.1:8092'; break } catch { Start-Sleep -Milliseconds 300 } }"
"python\python.exe" -s -m uvicorn server:app --host 127.0.0.1 --port 8092
"""

APP_START = r"""@echo off
cd /d "%~dp0"
start "" "python\pythonw.exe" -s nabe_app.py
"""

LES_MEG = """NABE - Not Another BACnet Explorer, portabel utgave
====================================================

Pakk ut mappa hvor som helst og dobbeltklikk NABE.bat for eget vindu,
eller «NABE i nettleser.bat» hvis du heller vil ha den i nettleseren.
Ingen installasjon, ingen administratorrettigheter, ingen nett.

Laget for maskinen som faktisk når anlegget - for eksempel en
fjernskrivebordsmaskin bak FortiClient. Kopier zip-fila over
fjernskrivebordet, pakk ut og start.

Anleggsminne, notater og skrivelogg lagres i mappa, ved siden av
server.py. Ta med mappa tilbake hvis du vil beholde dem.
"""


def kopier_python(til: Path):
    til.mkdir(parents=True)
    for f in PY_KILDE.iterdir():
        if f.is_file() and (f.suffix.lower() in (".exe", ".dll") or f.name.endswith("._pth")):
            shutil.copy2(f, til / f.name)
    shutil.copytree(PY_KILDE / "DLLs", til / "DLLs",
                    ignore=shutil.ignore_patterns("*_test*", "_tkinter*", "tcl*", "tk*"))
    shutil.copytree(PY_KILDE / "Lib", til / "Lib",
                    ignore=lambda d, navn: [n for n in navn if n in HOPP_OVER])
    (til / "Lib" / "site-packages").mkdir()


def main():
    versjon = re.search(r'VERSJON = "([^"]+)"', (HER / "server.py").read_text(encoding="utf-8")).group(1)
    if MAPPE.exists():
        shutil.rmtree(MAPPE)
    print(f"Python fra {PY_KILDE}")
    kopier_python(MAPPE / "python")
    print("Pakker fra «pakker»")
    subprocess.run([str(MAPPE / "python" / "python.exe"), "-s", "-m", "pip", "--version"],
                   capture_output=True)
    subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "--no-index",
                    "--find-links", str(HER / "pakker"), "-r", str(HER / "requirements-app.txt"),
                    "--target", str(MAPPE / "python" / "Lib" / "site-packages")], check=True)
    for f in APPFILER:
        shutil.copy2(HER / f, MAPPE / f)
    shutil.copytree(HER / "js", MAPPE / "js")
    (MAPPE / "NABE i nettleser.bat").write_text(START.replace("\n", "\r\n"), encoding="ascii")
    (MAPPE / "NABE.bat").write_text(APP_START.replace("\n", "\r\n"), encoding="ascii")
    shutil.copy2(HER / "installasjon" / "nabe.ico", MAPPE / "nabe.ico")
    (MAPPE / "LES MEG.txt").write_text(LES_MEG.replace("\n", "\r\n"), encoding="utf-8")

    zipnavn = DIST / f"NABE-portabel-{versjon}.zip"
    if zipnavn.exists():
        zipnavn.unlink()
    with zipfile.ZipFile(zipnavn, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for rot, _, filer in os.walk(MAPPE):
            for f in filer:
                full = Path(rot) / f
                z.write(full, Path("NABE") / full.relative_to(MAPPE))
    mb = zipnavn.stat().st_size / 1e6
    print(f"Ferdig: {zipnavn.name} ({mb:.0f} MB)")


if __name__ == "__main__":
    main()
