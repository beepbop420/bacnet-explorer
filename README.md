# BACnet Explorer

A local BACnet/IP scanner and point browser for building automation work.
Runs on your own machine, talks straight to the plant, and needs nothing but
Python.

Point it at an IP range, it finds the controllers, reads every object on one,
and shows you the values — live, with trends, with the ability to write
setpoints. Built for the case where you reach a site only through a VPN and
the usual discovery does not work.

> **The interface is in Norwegian.** The code and comments are in English.

---

## What it does

- **Finds controllers** on an IP range — broadcast Who-Is, or a unicast sweep
  that works where broadcast is filtered.
- **Reads every object** on a device: values, descriptions, state texts,
  units, priority arrays, weekly schedules.
- **Follows values live** with a trend curve, and draws the matching setpoint
  as a reference line when one exists.
- **Writes setpoints** with a confirmation that shows the current value, the
  new one, and the priority — plus optional automatic release.
- **Exports** EDE 2.3 and CSV, and compares a live plant against an EDE file
  to find what drifted from the documentation.
- **Remembers sites** — which devices answered, your notes, and a snapshot you
  can diff against later.

---

## Install

Needs **Python 3.10 or newer**. On Windows, tick *Add Python to PATH* during
installation.

```
git clone https://github.com/martinlundelillebo-beep/bacnet-explorer.git
cd bacnet-explorer
start.bat
```

`start.bat` creates a virtual environment next to the files on first run,
installs the dependencies, and opens the browser at `http://127.0.0.1:8090`.

On macOS or Linux, or if you prefer to do it by hand:

```
python -m venv venv
venv/bin/pip install -r requirements.txt
venv/bin/python -m uvicorn server:app --host 127.0.0.1 --port 8090
```

---

## Scanning over a VPN

This is the part worth reading before you file a bug.

The three scan modes look interchangeable and are not. Measured on a hotel
VPN — a `/32` tunnel — across the same address range, one after another:

| Mode | What it does | Found |
|---|---|---:|
| **Who-Is** | One broadcast to the subnet's `.255` | **0** |
| **Sweep — fast** | Probes each address directly, **once** | **0** |
| **Sweep — thorough** | Re-probes whatever stayed silent | **4** |

All four controllers answered **ping** at the same time. The network was fine
throughout.

**Who-Is is a broadcast.** Routers and VPN concentrators generally do not
forward directed broadcast, so the request never arrives. From a `/32` there
is no subnet to broadcast to at all.

**Fast sweep probes each address once.** Reachability of an individual
controller drifts minute to minute — the same device answered six of eight
probes, then none half an hour later. A single silent probe means very little,
and which devices get missed changes between runs.

**Raising the timeout does not help.** A controller that answers at all
answers in about 90 ms. The fix is more attempts, not a longer wait — and long
timeouts only make empty addresses expensive.

> **Rule of thumb:** over a VPN, use thorough. On a local network in a plant
> room, fast is usually enough.

### When a scan finds nothing

The device pane explains itself rather than returning zero in silence: what
was tried, why it may have failed where you are, and the button that usually
fixes it. It recognises a `/32` tunnel and says so.

**Check with ping** tells two very different silences apart:

- **Ping answers, BACnet does not** — the devices are there and discovery is
  what is failing. Run the thorough sweep.
- **Nothing answers at all** — points at the route, a firewall, or the wrong
  network adapter.

Ping is not proof in both directions. On the same network one controller
answered BACnet without answering ping at all; plenty of devices and firewalls
drop ICMP. Treat a silent ping as a hint, not a verdict.

---

## Writing to a live plant

Every write is confirmed with the point name, the address, the current and new
value, and the priority. That includes the double-click shortcut in the table —
it saves the clicks up to the question, not the question.

- **Read-only mode** blocks all writing. It is in the command palette.
- **The write log** records everything written, with the value that was there
  before.
- **Automatic release** can be set when writing, so an override does not
  outlive your visit.

---

## Keyboard

Press <kbd>?</kbd> in the tool for the full list.

| Key | |
|---|---|
| <kbd>Ctrl</kbd>+<kbd>K</kbd> | Command palette — everything, one search field |
| <kbd>/</kbd> | Search points on this device |
| <kbd>Ctrl</kbd>+<kbd>F</kbd> | Search across every device read |
| <kbd>Ctrl</kbd>+<kbd>.</kbd> | Actions for the selected point |
| <kbd>Space</kbd> | Pin the point to the watch list |
| <kbd>L</kbd> / <kbd>Z</kbd> | Live updates / large value view |
| <kbd>F6</kbd> | Next pane — devices, points, watch |
| <kbd>g</kbd> <kbd>d</kbd> | Go to devices — also `g p`, `g o`, `g s` |

---

## Configuration

Everything is optional.

| Environment variable | |
|---|---|
| `NOTES_UPSTREAM` | Base URL of a shared instance. Notes are written locally either way, queued when the site network is closed, and pushed when the shared server is reachable again. Leave unset for a purely local install. |
| `CORS_ORIGINS` | Comma-separated extra origins, if you front the tool with something else. |

Drop a `logo.png` or `logo.svg` next to `server.py` and it appears in the top
bar. With no file present the tool shows a plain wordmark rather than
inventing a mark.

Appearance — colours, background images, density, light and dark — is set in
the tool under **Settings → Appearance** and stored in the browser.

---

## Not verified yet

Stated plainly so nobody is surprised in a plant room:

- **Weekly schedules** have only been tested against empty schedules.
- **Trend log reading** has not been tested against real equipment at all.
- **Device comparison** and **EDE comparison** have been exercised against one
  site, not many.

If something looks wrong when you meet equipment that has these, that is worth
an issue.

---

## How it is put together

```
server.py         HTTP API and static files (FastAPI)
bacnet_core.py    BACnet/IP - discovery, reads, writes, schedules (bacpypes3)
index.html        markup and the whole stylesheet
app.js            the entire client
```

No build step, no bundler, no framework. Open the files and the tool is what
you see. The client is one script because the tool is one screen, and a build
step would be one more thing to keep working on a machine in a plant room.

---

## Licence

MIT — see `LICENSE`.
