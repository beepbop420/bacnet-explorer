"""
Avinstallerer NABE. Startes fra «Apper» i Windows, eller med --stille.

Fjerner snarveiene, oppføringen i «Apper» og programmappa. Anleggsminne,
notater og skrivelogg i %LOCALAPPDATA%\\NABE blir liggende, med mindre du
sier ja til å slette dem - de er arbeidet ditt, ikke programmet.
"""
import ctypes
import json
import os
import shutil
import subprocess
import sys
import winreg
from pathlib import Path

HER = Path(__file__).parent
DATA = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "NABE"
NOKKEL = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\NABE"


def spor(tekst: str, tittel: str = "Avinstaller NABE", knapper: int = 4) -> int:
    """MessageBox. 4 = Ja/Nei, svar 6 er Ja."""
    return ctypes.windll.user32.MessageBoxW(None, tekst, tittel, knapper | 0x20)


def main():
    stille = "--stille" in sys.argv
    if not stille and spor("Vil du virkelig avinstallere NABE?\n\n"
                           "Den kommer til å huske dette.") != 6:
        return
    slett_data = (not stille) and DATA.exists() and spor(
        "Skal anleggsminnet, notatene og skriveloggen også slettes?\n\n"
        "Velg Nei hvis du kanskje kommer tilbake. Det gjør folk.") == 6

    try:
        for lnk in json.loads((HER / "snarveier.json").read_text(encoding="utf-8")):
            Path(lnk).unlink(missing_ok=True)
    except Exception:
        pass
    try:
        winreg.DeleteKey(winreg.HKEY_CURRENT_USER, NOKKEL)
    except OSError:
        pass
    if slett_data:
        shutil.rmtree(DATA, ignore_errors=True)

    # The folder holds the Python running this script, so it cannot remove
    # itself. A detached cmd waits for us to exit and then takes it away.
    subprocess.Popen(
        f'cmd /c ping -n 3 127.0.0.1 >nul & rmdir /s /q "{HER}"',
        creationflags=0x08000000 | 0x00000008, close_fds=True)
    if not stille:
        spor("NABE er avinstallert.\n\nYABE sender sine hilsener.", knapper=0)


if __name__ == "__main__":
    main()
