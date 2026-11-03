"""
A release on GitHub in one go: builds the installer zip and publishes it as
v<version>, so the README's «Download» link gives the newest one.

    venv\\Scripts\\python.exe lag_release.py

Needs the GitHub CLI signed in once (gh auth login). The notes are the
«New in» lines of this version, in English. A release that already exists
gets its zip replaced instead.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

import lag_installasjon

HER = Path(__file__).parent


def _linjer(src: str, versjon: str):
    m = re.search(r"'" + re.escape(versjon) + r"': \[(.*?)\n  \],", src, re.S)
    return re.findall(r"\['(?:[^'\\]|\\.)*', '((?:[^'\\]|\\.)*)'\]", m.group(1)) if m else []


def _tall(v: str):
    return tuple(int(x) for x in re.findall(r"\d+", v))


def notater(versjon: str, forrige: str = "") -> str:
    """This version's «New in» lines, and those of every version since the
    last release, so nothing that was never published goes unmentioned."""
    src = (HER / "js" / "nabe-start.js").read_text(encoding="utf-8")
    deler = ["\n".join(f"- {l}" for l in _linjer(src, versjon)) or "- Improvements and fixes"]
    if forrige:
        imellom = sorted({v for v in re.findall(r"^  '(\d+(?:\.\d+)+)': \[", src, re.M)
                          if _tall(forrige) < _tall(v) < _tall(versjon)}, key=_tall, reverse=True)
        for v in imellom:
            deler.append(f"Also in {v}:\n" + "\n".join(f"- {l}" for l in _linjer(src, v)))
    return ("\n\n".join(deler) + "\n\n**Install:** download `NABE-Installasjon.zip`, right-click it and choose "
            "*Extract All*, then double-click **Installer NABE**. No administrator rights needed.")


def forrige_release() -> str:
    r = subprocess.run(["gh", "release", "list", "--limit", "1", "--json", "tagName"],
                       cwd=HER, capture_output=True, text=True, encoding="utf-8")
    try:
        return json.loads(r.stdout)[0]["tagName"].lstrip("v")
    except Exception:
        return ""


def main():
    versjon = re.search(r'VERSJON = "([^"]+)"', (HER / "server.py").read_text(encoding="utf-8")).group(1)
    tag = f"v{versjon}"
    lag_installasjon.main()
    zipfil = HER / "dist" / "NABE-Installasjon.zip"
    finnes = subprocess.run(["gh", "release", "view", tag], cwd=HER, capture_output=True).returncode == 0
    if finnes:
        cmd = ["gh", "release", "upload", tag, str(zipfil), "--clobber"]
    else:
        cmd = ["gh", "release", "create", tag, str(zipfil), "--title", f"NABE {versjon}",
               "--notes", notater(versjon, forrige_release()), "--latest"]
    r = subprocess.run(cmd, cwd=HER, capture_output=True, text=True, encoding="utf-8")
    print(r.stdout.strip() or r.stderr.strip())
    sys.exit(r.returncode)


if __name__ == "__main__":
    main()
