"""
Lager dist/NABE-Installasjon-<versjon>.zip.

    venv\\Scripts\\python.exe lag_installasjon.py

Pakk ut zip-fila og dobbeltklikk «Installer NABE». Veiviseren kjøres av den
signerte Python-en som følger med, så den går også på låste jobb-PC-er.

Hvorfor ikke én .exe: en hjemmebygget, usignert .exe ble stoppet av
sikkerhetsprogramvaren på jobb-PC-en - den fikk ikke engang leses. Det
vil skje hos alle andre også. En ekte .exe krever et kodesigneringssertifikat;
til da er dette den veien som faktisk virker.
"""
import re
import shutil
import zipfile
from pathlib import Path

import lag_portabel

HER = Path(__file__).parent
DIST = HER / "dist"
INST = HER / "installasjon"

START_INSTALLASJON = r"""@echo off
start "" "%~dp0NABE\python\pythonw.exe" -s "%~dp0NABE\installer.py" %*
"""


def main():
    lag_portabel.main()
    mappe = lag_portabel.MAPPE
    for f in ("installer.py", "installer.html", "avinstaller.py", "vilkar.txt"):
        shutil.copy2(INST / f, mappe / f)

    versjon = re.search(r'VERSJON = "([^"]+)"', (HER / "server.py").read_text(encoding="utf-8")).group(1)
    maal = DIST / f"NABE-Installasjon-{versjon}.zip"
    if maal.exists():
        maal.unlink()
    with zipfile.ZipFile(maal, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        z.writestr("Installer NABE.cmd", START_INSTALLASJON.replace("\n", "\r\n"))
        for f in mappe.rglob("*"):
            if f.is_file():
                z.write(f, Path("NABE") / f.relative_to(mappe))
    print(f"Ferdig: {maal.name} ({maal.stat().st_size / 1e6:.0f} MB)")


if __name__ == "__main__":
    main()
