"""
Lager NABE-mini-<versjon>.zip: NABE for fjernskrivebordet.

Samme BACnet-verktøy, uten det en fjernskrivebordsmaskin ikke trenger eller
ikke får lov til: ingen lokal KI, ingen selvoppdatering, ingen kall ut på
internett og ikke eget vindu (det krever WebView2 og .NET). Den kjører i
nettleseren som alt står på maskinen. Pakk ut, dobbeltklikk NABE.bat. Ingen
installasjon og ingen administratorrettigheter.

    venv\\Scripts\\python.exe lag_mini.py

Python og pakkene hentes som i lag_portabel.py, så ingenting lastes ned.
"""
import os
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

import lag_portabel as lp

HER = Path(__file__).parent
MAPPE = lp.DIST / "NABE-mini"
APPFILER = ["server.py", "bacnet_core.py", "app.js", "index.html", "nabe.css", "nabe_sim.py", "nabe_modbus.py"]

LES_MEG = """NABE Mini - Not Another BACnet Explorer for fjernskrivebordet
=============================================================

Pakk ut hele zip-fila (høyreklikk, «Pakk ut alle») og dobbeltklikk NABE.bat i
mappa som kommer fram. Ikke åpne den inne i zip-fila. NABE åpner seg i
nettleseren på http://127.0.0.1:8092. Lukk det svarte vinduet for å stoppe.
Hvis vinduet viser en feil, blir det stående så du kan lese den.

Ingen installasjon, ingen administratorrettigheter, ingen internett.
Maskinen trenger Edge eller Chrome.

Mini er hele BACnet-verktøyet, uten lokal KI og uten selvoppdatering.
Ny versjon får du ved å kopiere over en ny zip.

Anleggsminne, notater, besøk og skrivelogg lagres i denne mappa. Ta med
mappa tilbake hvis du vil beholde dem.
"""


def main():
    versjon = re.search(r'VERSJON = "([^"]+)"', (HER / "server.py").read_text(encoding="utf-8")).group(1)
    if MAPPE.exists():
        shutil.rmtree(MAPPE)
    print(f"Python fra {lp.PY_KILDE}")
    lp.kopier_python(MAPPE / "python")
    print("Pakker fra «pakker» (uten eget vindu)")
    subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "--no-index",
                    "--find-links", str(HER / "pakker"), "-r", str(HER / "requirements.txt"),
                    "--target", str(MAPPE / "python" / "Lib" / "site-packages")], check=True)
    for f in APPFILER:
        shutil.copy2(HER / f, MAPPE / f)
    shutil.copytree(HER / "js", MAPPE / "js")
    # The file that makes it Mini: server.py looks for it.
    (MAPPE / "MINI").write_text("NABE Mini\r\n", encoding="ascii")
    (MAPPE / "NABE.bat").write_text(lp.START.replace("\n", "\r\n"), encoding="ascii")
    shutil.copy2(HER / "installasjon" / "nabe.ico", MAPPE / "nabe.ico")
    (MAPPE / "LES MEG.txt").write_text(LES_MEG.replace("\n", "\r\n"), encoding="utf-8")

    zipnavn = lp.DIST / f"NABE-mini-{versjon}.zip"
    if zipnavn.exists():
        zipnavn.unlink()
    with zipfile.ZipFile(zipnavn, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for rot, _, filer in os.walk(MAPPE):
            for f in filer:
                full = Path(rot) / f
                z.write(full, Path("NABE-mini") / full.relative_to(MAPPE))
    mb = zipnavn.stat().st_size / 1e6
    print(f"Ferdig: {zipnavn.name} ({mb:.0f} MB)")


if __name__ == "__main__":
    main()
