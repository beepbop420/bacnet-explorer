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


def notater(versjon: str) -> str:
    src = (HER / "js" / "nabe-start.js").read_text(encoding="utf-8")
    m = re.search(r"'" + re.escape(versjon) + r"': \[(.*?)\n  \],", src, re.S)
    linjer = re.findall(r"\['(?:[^'\\]|\\.)*', '((?:[^'\\]|\\.)*)'\]", m.group(1)) if m else []
    tekst = "\n".join(f"- {l}" for l in linjer) or "- Improvements and fixes"
    return (f"{tekst}\n\n**Install:** download `NABE-Installasjon.zip`, right-click it and choose "
            "*Extract All*, then double-click **Installer NABE**. No administrator rights needed.")


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
               "--notes", notater(versjon), "--latest"]
    r = subprocess.run(cmd, cwd=HER, capture_output=True, text=True, encoding="utf-8")
    print(r.stdout.strip() or r.stderr.strip())
    sys.exit(r.returncode)


if __name__ == "__main__":
    main()
