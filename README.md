# NABE – Not Another BACnet Explorer

Yes, another one. YABE was taken.

NABE is a BACnet/IP scanner and point browser for building automation work.
It runs on your own machine, talks straight to the plant, and was built for
the awkward cases: plants you only reach through a VPN, buildings that share
one VPN with fifty others, and controllers that refuse to answer a Who-Is.

It also has a small, deeply unimpressed controller for a mascot. It watches
your mouse, falls asleep when you leave, and has opinions about priority 1.

## ⬇ Download

**[Download NABE for Windows](https://github.com/beepbop420/bacnet-explorer/releases/latest/download/NABE-Installasjon.zip)** (≈20 MB)

1. Right-click the zip and choose **Extract All**.
2. Double-click **Installer NABE** in the folder that appears.
3. Done - NABE is in the Start menu.

No administrator rights needed. Everything else in the zip is tucked away;
**Installer NABE** is the only thing you see.

> The interface is in English by default, with Norwegian one click away.
> Code comments are in English, with some Norwegian where the trade speaks it.

---

## What it does

- **Finds controllers the way the network allows.** *Auto* sends a real
  BACnet broadcast on your own subnet (so MS/TP devices behind routers answer
  too) and a patient unicast sweep over VPN, where broadcasts never arrive.
- **One building on a shared VPN.** *BBMD mode* registers as a foreign device
  with the building's BBMD and finds that building only - and tells you which
  other BBMDs the building has.
- **Ranges the way you think of them:** `10.0.1.0/24`, a single IP, or
  `10.0.1.10-40`.
- **Uses several network adapters at once.** Every address goes out of the
  adapter the routing table sends it through, so a FortiClient tunnel, a
  WireGuard tunnel and the cable can all be scanned and read at the same time.
  It opens each adapter when it is needed and drops one when its tunnel goes.
- **Reads every object** on a device: values, descriptions, state texts,
  units, priority arrays, weekly schedules, trend logs, **active alarms**.
- **Live values by COV** where the controller allows it, polling otherwise.
- **Writes with care:** confirmation, priority shown, optional automatic
  release, and a write log for handover.
- **Exports** EDE 2.3, CSV, and a **«Variabel» file** for Niagara NTI
  import - with the device field right.
- **Diagnoses silence:** port conflicts, the wrong adapter, the Windows
  firewall, and the plant you can only reach from a remote desktop.
- **Remembers sites:** devices, notes, the scan mode that worked, and how many
  points were left overridden when you went home.
- **Picks up where you left off:** the points you pinned to Watch come back
  the next time that site is opened.
- **Runs a site without the plant.** The *Simulator* starts what you have read
  as BACnet devices on this PC (127.0.0.x): same names, descriptions, units and
  values, writable, and with RT/SB loops that can be made to hunt. It is saved,
  so you can practise, demonstrate or test name checks without a VPN. It is
  marked SIMULATOR everywhere and never remembered as a site.
- **Updates itself, and checks the signature first.** An installed NABE says when
  a new release is out. One button downloads it, verifies the maintainer's
  signature, closes NABE, installs and starts it again. A file that does not
  verify is thrown away and nothing changes.

---

## Getting it

### The app (Windows)

```
python lag_installasjon.py
```

builds `dist/NABE-Installasjon.zip` (and a copy with the version in the
name). Unzip it and double-click **Installer NABE** - the only file in it
you can see; the rest sits in a hidden folder next to it. It installs for the current user only - no administrator
rights - with Start menu and desktop shortcuts, an entry in *Apps*, and an
uninstaller that keeps your site memory. The terms and conditions are worth
reading. Nobody does.

NABE runs in its own window (WebView2, already part of Windows 10 and 11).

### In the browser

```
start.bat
```

sets up a virtual environment the first time (from the bundled `pakker/`
folder, so it works offline) and opens NABE at `http://127.0.0.1:8092`.

### Portable

```
python lag_portabel.py
```

builds `dist/NABE-portabel-<version>.zip` with its own Python. Unzip anywhere,
double-click `NABE.bat` (window) or `NABE i nettleser.bat` (browser). Made for
the remote desktop that is the only machine able to reach the plant.

Built and tested with Python 3.14 on Windows 11. `pakker/` holds the exact
package versions NABE is tested with.

---

## Before you change anything

```
python selvtest.py
```

starts three simulated BACnet devices on `127.0.0.2-4` and runs what a
technician does - connect, scan, read, write, release, live, alarms, routers,
diagnostics - against them. Green means go.

`git config core.hooksPath hooks` makes every commit run it first.

---

## Releasing

`venv\Scripts\python.exe lag_release.py` builds the installer and publishes it as
a GitHub release. The release is signed with the maintainer's private key
(`%LOCALAPPDATA%\NABE-signering\privat.key`, made once with
`python nabe_signatur.py ny-nokkel`; keep a backup, it cannot be recreated).
Every NABE carries the public key in `nabe_signatur.py` and installs only what
verifies. This is not a Windows code-signing certificate: it does not change what
SmartScreen or a virus scanner thinks of a file, it makes the self-update
trustworthy. The installer is a zip with a script rather than an unsigned
.exe for that reason; a real certificate would allow a signed .exe later.

---

## Files

| | |
|---|---|
| `server.py` | FastAPI backend: scanning, reading, writing, COV, diagnostics |
| `bacnet_core.py` | BACnet helpers on top of bacpypes3 |
| `index.html`, `app.js` | The interface, one page |
| `js/` | The rest of it: start screen, tools, field safety, and the jokes |
| `nabe_app.py` | The desktop window around it |
| `installasjon/` | The installer, uninstaller, icon and the terms |
| `lag_installasjon.py`, `lag_portabel.py` | Build scripts |
| `nabe_sim.py` | The simulator: a scanned site as BACnet devices on 127.0.0.x |
| `nabe_oppdater.py`, `nabe_signatur.py` | Self-update and the Ed25519 signature it checks |
| `selvtest.py` | The self-test |

---

## License

MIT - see [LICENSE](LICENSE). © Martin Lillebø.
Complaints go to YABE.
