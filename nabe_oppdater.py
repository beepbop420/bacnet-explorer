r"""
Self-update for an installed NABE.

The newest release is looked up on GitHub, downloaded, and checked against the
signature the maintainer made (nabe_signatur.py): the zip must hash to what was
signed, for exactly that version, with the NABE key. Only then is it unpacked,
and only then is the installer inside it run - after NABE itself has closed, so
no file is in use. Anything that fails leaves the installed version untouched.

Only an installed NABE (in %LOCALAPPDATA%\Programs\NABE) updates itself. A copy
run from a source folder or a portable zip is never overwritten.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path
from urllib.parse import urlparse

import nabe_signatur

REPO = "beepbop420/bacnet-explorer"
ZIPNAVN = "NABE-Installasjon.zip"
SIGNAVN = ZIPNAVN + ".sig"
MAKS_STORRELSE = 120 * 1024 * 1024
UA = "NABE-oppdatering"


class Feil(Exception):
    """Something the user should read: the update stopped, nothing was changed."""


def tall(v) -> tuple:
    return tuple(int(x) for x in re.findall(r"\d+", str(v)))


def installert_mappe() -> Path:
    return Path(os.environ.get("LOCALAPPDATA") or "") / "Programs" / "NABE"


def er_installert(her: Path) -> bool:
    try:
        return bool(os.environ.get("LOCALAPPDATA")) and Path(her).resolve() == installert_mappe().resolve()
    except OSError:
        return False


def _tillatt_vert(url: str) -> bool:
    u = urlparse(url)
    h = (u.hostname or "").lower()
    return u.scheme == "https" and (h == "github.com" or h.endswith(".github.com") or h.endswith(".githubusercontent.com"))


def http_json(url: str, timeout: float = 10.0) -> dict:
    if not _tillatt_vert(url):
        raise Feil("Uventet adresse for oppdatering")
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read(2_000_000).decode("utf-8"))


def siste_utgivelse(hent=http_json) -> dict:
    """{versjon, notater, zip, sig}: the newest release, with the two files an update needs."""
    d = hent(f"https://api.github.com/repos/{REPO}/releases/latest")
    filer = {a["name"]: a["browser_download_url"] for a in d.get("assets") or []}
    return {"versjon": str(d.get("tag_name", "")).lstrip("v"), "notater": d.get("body") or "",
            "zip": filer.get(ZIPNAVN), "sig": filer.get(SIGNAVN)}


def last_ned(url: str, mal: Path, maks: int = MAKS_STORRELSE, fremdrift=None) -> str:
    """Download to `mal`, return the SHA-256. https from GitHub only, size capped."""
    if not _tillatt_vert(url):
        raise Feil("Uventet adresse for oppdatering")
    import hashlib
    h = hashlib.sha256()
    mal.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r, open(mal, "wb") as f:
        if not _tillatt_vert(r.geturl()):
            raise Feil("Nedlastingen ble sendt til en uventet adresse")
        total = int(r.headers.get("Content-Length") or 0)
        if total and total > maks:
            raise Feil("Filen er større enn forventet")
        gjort = 0
        for blokk in iter(lambda: r.read(1 << 18), b""):
            gjort += len(blokk)
            if gjort > maks:
                raise Feil("Filen er større enn forventet")
            h.update(blokk)
            f.write(blokk)
            if fremdrift:
                fremdrift(gjort, total)
    return h.hexdigest()


def pakk_ut(zipfil: Path, mal: Path) -> Path:
    """Unpack, refusing anything that would land outside `mal`."""
    if mal.exists():
        shutil.rmtree(mal)
    mal.mkdir(parents=True)
    rot = mal.resolve()
    with zipfile.ZipFile(zipfil) as z:
        for info in z.infolist():
            ut = (mal / info.filename).resolve()
            if rot != ut and rot not in ut.parents:
                shutil.rmtree(mal, ignore_errors=True)
                raise Feil("Pakken inneholder en filsti utenfor mappa. Ingenting er installert.")
        z.extractall(mal)
    if not (mal / ".nabe" / "installer.py").is_file():
        shutil.rmtree(mal, ignore_errors=True)
        raise Feil("Pakken mangler installasjonen")
    return mal


def start_hjelper(ut: Path, pid: int) -> None:
    """The installer from the new version, started apart from NABE. It waits for
    NABE to close, installs, and starts NABE again."""
    py = ut / ".nabe" / "python" / "pythonw.exe"
    inst = ut / ".nabe" / "installer.py"
    if os.name != "nt" or not py.is_file():
        raise Feil("Oppdatering i appen virker bare på Windows med den vanlige installasjonen")
    flagg = (getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
             | getattr(subprocess, "CREATE_NO_WINDOW", 0))
    subprocess.Popen([str(py), "-s", str(inst), "--stille", f"--vent-pid={pid}", "--start"],
                     cwd=str(ut), creationflags=flagg, close_fds=True,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def oppdater(her_versjon: str, her_mappe: Path, arbeid: Path, pid: int, melding=lambda tekst: None,
             hent_json=http_json, last=last_ned, offentlig_hex: str = None, start=True) -> dict:
    """Download, verify, unpack and hand over to the installer. Raises Feil."""
    if not er_installert(her_mappe):
        raise Feil("Oppdatering i appen virker bare for installert NABE")
    melding("Ser etter ny versjon")
    u = siste_utgivelse(hent_json)
    if tall(u["versjon"]) <= tall(her_versjon):
        raise Feil("Du har allerede den nyeste versjonen")
    if not u["zip"] or not u["sig"]:
        raise Feil("Utgivelsen har ingen signatur, så den installeres ikke av appen")
    arbeid.mkdir(parents=True, exist_ok=True)
    sigfil = arbeid / SIGNAVN
    zipfil = arbeid / f"NABE-Installasjon-{u['versjon']}.zip"
    try:
        melding("Laster ned")
        last(u["sig"], sigfil)
        sha = last(u["zip"], zipfil)
        melding("Sjekker signaturen")
        try:
            sig = json.loads(sigfil.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            sig = {}
        if not nabe_signatur.sjekk_signatur(sig, sha, u["versjon"], offentlig_hex):
            raise Feil("Signaturen stemmer ikke. Ingenting er installert.")
        melding("Pakker ut")
        ut = pakk_ut(zipfil, arbeid / f"ut-{u['versjon']}")
    except Feil:
        zipfil.unlink(missing_ok=True)
        raise
    except OSError as e:
        raise Feil(f"Fikk ikke hentet oppdateringen: {e}")
    if start:
        melding("Starter installasjonen")
        start_hjelper(ut, pid)
    return {"versjon": u["versjon"], "mappe": str(ut)}
