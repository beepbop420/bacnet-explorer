# NABE – Not Another BACnet Explorer

Yes, another one. YABE was taken.

NABE is a BACnet/IP scanner and point browser for building automation work.
It runs on your own machine, talks straight to the plant, and was built for
the awkward cases: plants you only reach through a VPN, buildings that share
one VPN with fifty others, and controllers that refuse to answer a Who-Is.

It also has a small, deeply unimpressed controller for a mascot. It watches
your mouse, falls asleep when you leave, and has opinions about priority 1.

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
- **Picks the right network adapter itself**, from the routing table, and
  re-binds on its own when WireGuard or FortiClient connects or drops.
- **Reads every object** on a device: values, descriptions, state texts,
  units, priority arrays, weekly schedules, trend logs, **active alarms**.
- **Live values by COV** where the controller allows it, polling otherwise.
- **Writes with care:** confirmation, priority shown, optional automatic
  release, and a write log for handover.
- **Exports** EDE 2.3, CSV, and a **BTG «Variabel» file** for Niagara NTI
  import - with the device field right.
- **Diagnoses silence:** port conflicts, the wrong adapter, the Windows
  firewall, and the plant you can only reach from a remote desktop.
- **Remembers sites:** devices, notes, the scan mode that worked, and how many
  points were left overridden when you went home.

---

## Getting it

### The app (Windows)

```
python lag_installasjon.py
```

builds `dist/NABE-Installasjon-<version>.zip`. Unzip it and double-click
**Installer NABE**. It installs for the current user only - no administrator
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
| `selvtest.py` | The self-test |

---

## License

MIT - see [LICENSE](LICENSE). © Martin Lillebø.
Complaints go to YABE.
