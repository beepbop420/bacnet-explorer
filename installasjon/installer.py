"""
NABE sitt installasjonsprogram.

Kjøres fra den utpakkede installasjonspakken (se lag_installasjon.py):
    python\\pythonw.exe -s installer.py            veiviser i eget vindu
    python\\pythonw.exe -s installer.py --stille   uten vindu, med standardvalg

Installerer for den innloggede brukeren - ingen administratorrettigheter:
programmet i %LOCALAPPDATA%\\Programs\\NABE, snarveier i Start-menyen og på
skrivebordet, og en oppføring i «Apper» slik at det kan avinstalleres som
alt annet. Anleggsminne og notater ligger i %LOCALAPPDATA%\\NABE og
overlever både oppdatering og avinstallering.
"""
import json
import os
import shutil
import subprocess
import sys
import threading
import winreg
from pathlib import Path

KILDE = Path(__file__).parent
LOCAL = Path(os.environ.get("LOCALAPPDATA", str(Path.home())))
STANDARD_MAPPE = LOCAL / "Programs" / "NABE"
APP_ID = "Lillebo.NABE"
AVINST_NOKKEL = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\NABE"


def versjon() -> str:
    import re
    m = re.search(r'VERSJON = "([^"]+)"', (KILDE / "server.py").read_text(encoding="utf-8"))
    return m.group(1) if m else "?"


def skallmappe(csidl: int) -> Path:
    """Where Windows says a shell folder is. On a work PC the desktop is
    usually redirected into OneDrive, so the Desktop folder under the
    user profile is the wrong place."""
    import ctypes
    buf = ctypes.create_unicode_buffer(260)
    ctypes.windll.shell32.SHGetFolderPathW(None, csidl, None, 0, buf)
    return Path(buf.value)


def snarvei(lnk: Path, maal: Path, args: str, mappe: Path, ikon: Path, beskrivelse: str):
    """A .lnk through WScript.Shell, which every Windows has."""
    lnk.parent.mkdir(parents=True, exist_ok=True)
    ps = (
        "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:NABE_LNK);"
        "$s.TargetPath=$env:NABE_MAAL;$s.Arguments=$env:NABE_ARGS;"
        "$s.WorkingDirectory=$env:NABE_MAPPE;$s.IconLocation=$env:NABE_IKON;"
        "$s.Description=$env:NABE_BESKR;$s.Save()"
    )
    env = dict(os.environ, NABE_LNK=str(lnk), NABE_MAAL=str(maal), NABE_ARGS=args,
               NABE_MAPPE=str(mappe), NABE_IKON=str(ikon), NABE_BESKR=beskrivelse)
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], env=env, check=True,
                   capture_output=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))


def installer(mappe: Path, valg: dict, fremdrift=lambda n, av, tekst: None):
    mappe = Path(mappe)
    filer = [p for p in KILDE.rglob("*") if p.is_file() and p.name not in ("installer.py", "installer.html")]
    for i, f in enumerate(filer):
        til = mappe / f.relative_to(KILDE)
        til.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, til)
        if i % 40 == 0 or i == len(filer) - 1:
            fremdrift(i + 1, len(filer), str(f.relative_to(KILDE)))
    shutil.copy2(KILDE / "avinstaller.py", mappe / "avinstaller.py")

    pyw = mappe / "python" / "pythonw.exe"
    ikon = mappe / "nabe.ico"
    meny = skallmappe(0x02)          # Start-menyens Programmer
    skrivebord = skallmappe(0x10)    # the real desktop - often inside OneDrive
    laget = []
    if valg.get("meny", True):
        laget.append(meny / "NABE.lnk")
        snarvei(laget[-1], pyw, "-s nabe_app.py", mappe, ikon, "Not Another BACnet Explorer")
    if valg.get("skrivebord", True):
        laget.append(skrivebord / "NABE.lnk")
        snarvei(laget[-1], pyw, "-s nabe_app.py", mappe, ikon, "Not Another BACnet Explorer")
    if valg.get("nettleser", False):
        laget.append(meny / "NABE i nettleser.lnk")
        snarvei(laget[-1], mappe / "NABE i nettleser.bat", "", mappe, ikon,
                "NABE i nettleseren din i stedet for eget vindu")

    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, AVINST_NOKKEL) as k:
        for navn, verdi in {
            "DisplayName": "NABE – Not Another BACnet Explorer",
            "DisplayVersion": versjon(),
            "Publisher": "Martin Lillebø",
            "DisplayIcon": str(ikon),
            "InstallLocation": str(mappe),
            "UninstallString": f'"{pyw}" -s "{mappe / "avinstaller.py"}"',
            "QuietUninstallString": f'"{pyw}" -s "{mappe / "avinstaller.py"}" --stille',
        }.items():
            winreg.SetValueEx(k, navn, 0, winreg.REG_SZ, verdi)
        winreg.SetValueEx(k, "NoModify", 0, winreg.REG_DWORD, 1)
        winreg.SetValueEx(k, "NoRepair", 0, winreg.REG_DWORD, 1)
        storrelse = sum(f.stat().st_size for f in filer) // 1024
        winreg.SetValueEx(k, "EstimatedSize", 0, winreg.REG_DWORD, storrelse)
    # The local AI is fetched by NABE on its first start, with progress in Settings.
    if valg.get("ki"):
        data = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "NABE"
        data.mkdir(parents=True, exist_ok=True)
        (data / "ki.json").write_text(json.dumps({"valgt": True}), encoding="utf-8")
    (mappe / "snarveier.json").write_text(json.dumps([str(p) for p in laget]), encoding="utf-8")
    return mappe


class Api:
    def __init__(self):
        self.vindu = None

    def info(self):
        return {"versjon": versjon(), "mappe": str(STANDARD_MAPPE),
                "vilkar": (KILDE / "vilkar.txt").read_text(encoding="utf-8"),
                "finnes": (STANDARD_MAPPE / "server.py").exists()}

    def installer(self, mappe, valg):
        def fremdrift(n, av, tekst):
            self.vindu.evaluate_js(f"fremdrift({n}, {av}, {json.dumps(tekst)})")

        def jobb():
            try:
                installer(Path(mappe), valg, fremdrift)
                self.vindu.evaluate_js("ferdig()")
            except Exception as e:
                self.vindu.evaluate_js(f"feilet({json.dumps(str(e))})")
        threading.Thread(target=jobb, daemon=True).start()

    def start_nabe(self, mappe):
        m = Path(mappe)
        subprocess.Popen([str(m / "python" / "pythonw.exe"), "-s", "nabe_app.py"], cwd=m)

    def lukk(self):
        self.vindu.destroy()


def logg(tekst: str) -> None:
    """A line in %LOCALAPPDATA%\\NABE\\oppdatering.log, for the day an update goes wrong."""
    try:
        mappe = LOCAL / "NABE"
        mappe.mkdir(parents=True, exist_ok=True)
        with open(mappe / "oppdatering.log", "a", encoding="utf-8") as f:
            f.write(f"{__import__('time').strftime('%Y-%m-%d %H:%M:%S')}  {tekst}\n")
    except OSError:
        pass


def vent_paa_prosess(pid: int, maks_sek: int = 300) -> bool:
    """Wait until NABE has closed: no file of the old version is in use after that.
    True when it has closed (or was never running), False when it is still open."""
    import ctypes
    k = ctypes.windll.kernel32
    h = k.OpenProcess(0x00100000, False, int(pid))      # SYNCHRONIZE
    if not h:
        return True
    try:
        return k.WaitForSingleObject(h, int(maks_sek * 1000)) == 0     # WAIT_OBJECT_0
    finally:
        k.CloseHandle(h)


def start_nabe(mappe: Path) -> None:
    flagg = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
    subprocess.Popen([str(mappe / "python" / "pythonw.exe"), "-s", "nabe_app.py"], cwd=str(mappe),
                     creationflags=flagg, close_fds=True,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main():
    if "--stille" in sys.argv:
        mappe = STANDARD_MAPPE
        pid = None
        for a in sys.argv:
            if a.startswith("--mappe="):
                mappe = Path(a.split("=", 1)[1])
            elif a.startswith("--vent-pid="):
                pid = int(a.split("=", 1)[1])
        # Started by NABE's own update: wait for it to close first.
        if pid:
            logg(f"venter på at NABE (pid {pid}) lukkes")
            if not vent_paa_prosess(pid, 900):
                # Copying over a program that is still running would break it.
                logg("NABE ble ikke lukket innen 15 minutter. Oppdateringen er avbrutt og ingenting er endret.")
                return
            __import__("time").sleep(1.0)
        try:
            installer(mappe, {"meny": True, "skrivebord": "--uten-skrivebord" not in sys.argv,
                              "nettleser": "--nettleser" in sys.argv})
            logg(f"installert {versjon()} i {mappe}")
        except Exception as e:
            logg(f"installasjonen feilet: {type(e).__name__}: {e}")
        if "--start" in sys.argv:
            start_nabe(mappe)
        return
    import webview
    api = Api()
    api.vindu = webview.create_window(
        "Installer NABE", html=(KILDE / "installer.html").read_text(encoding="utf-8"),
        js_api=api, width=640, height=600, resizable=False, background_color="#111113")
    def ikon():
        sys.path.insert(0, str(KILDE))
        from nabe_app import sett_ikon
        sett_ikon("Installer NABE", KILDE / "nabe.ico")
    api.vindu.events.shown += ikon
    webview.start(gui="edgechromium", private_mode=True)


if __name__ == "__main__":
    main()
