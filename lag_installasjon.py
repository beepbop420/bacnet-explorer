"""
Lager dist/NABE-Installasjon.zip (og en kopi med versjonsnummer).

    venv\Scripts\python.exe lag_installasjon.py

Den som pakker ut, ser én ting: «Installer NABE». Alt den trenger ligger i
en skjult mappe ved siden av. Dobbeltklikkes den inne i zip-fila uten å
pakke ut, sier den det i klartekst i stedet for å feile.

Hvorfor ikke én .exe: en hjemmebygget, usignert .exe ble stoppet av
sikkerhetsprogramvaren på jobb-PC-en - den fikk ikke engang leses. Det
vil skje hos alle andre også. En ekte .exe krever et kodesigneringssertifikat;
til da er dette den veien som faktisk virker.

Navnet uten versjon er det GitHub-lenken «siste versjon» peker på.
"""
import re
import shutil
import zipfile
from pathlib import Path

import lag_portabel

HER = Path(__file__).parent
DIST = HER / "dist"
INST = HER / "installasjon"

# The one visible file. Without the hidden folder next to it, it was
# opened from inside the zip: say how to unpack instead of failing.
START_INSTALLASJON = r"""@echo off
chcp 65001 >nul
if not exist "%~dp0.nabe\python\pythonw.exe" (
  powershell -NoProfile -WindowStyle Hidden -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('Pakk ut zip-fila først: høyreklikk den og velg «Pakk ut alle». Dobbeltklikk så «Installer NABE» i mappa som kommer fram.' + [char]10 + [char]10 + 'Unzip first: right-click the zip and choose «Extract All». Then double-click «Installer NABE» in the folder that appears.', 'NABE')" >nul
  exit /b
)
start "" "%~dp0.nabe\python\pythonw.exe" -s "%~dp0.nabe\installer.py" %*
"""
SKJULT = ".nabe"
# Windows' own unzip keeps the DOS attributes when the zip says it was made
# on DOS: hidden + system keeps the folder out of sight in Explorer.
SKJULT_ATTR = 0x02 | 0x04


def _skriv(z: zipfile.ZipFile, navn: str, data: bytes = None, kilde: Path = None, skjult: bool = False):
    info = zipfile.ZipInfo(navn, date_time=(2026, 1, 1, 0, 0, 0))
    info.create_system = 0
    info.compress_type = zipfile.ZIP_DEFLATED
    if skjult:
        info.external_attr = SKJULT_ATTR | (0x10 if navn.endswith("/") else 0)
    if navn.endswith("/"):
        z.writestr(info, b"")
    else:
        z.writestr(info, data if data is not None else kilde.read_bytes(), compresslevel=9)


def main():
    lag_portabel.main()
    mappe = lag_portabel.MAPPE
    for f in ("installer.py", "installer.html", "avinstaller.py", "vilkar.txt"):
        shutil.copy2(INST / f, mappe / f)

    versjon = re.search(r'VERSJON = "([^"]+)"', (HER / "server.py").read_text(encoding="utf-8")).group(1)
    maal = DIST / "NABE-Installasjon.zip"
    if maal.exists():
        maal.unlink()
    with zipfile.ZipFile(maal, "w") as z:
        _skriv(z, "Installer NABE.cmd", START_INSTALLASJON.replace("\n", "\r\n").encode("utf-8"))
        _skriv(z, SKJULT + "/", skjult=True)
        for f in sorted(mappe.rglob("*")):
            if f.is_file():
                _skriv(z, f"{SKJULT}/{f.relative_to(mappe).as_posix()}", kilde=f)
    med_versjon = DIST / f"NABE-Installasjon-{versjon}.zip"
    shutil.copy2(maal, med_versjon)
    print(f"Ferdig: {maal.name} og {med_versjon.name} ({maal.stat().st_size / 1e6:.0f} MB)")


if __name__ == "__main__":
    main()
