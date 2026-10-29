"""
BACnet IP Range Scanner — minimal FastAPI backend built directly on bacpypes3.

Two scan modes:
  - "broadcast": classic Who-Is directed broadcast, collects I-Am replies.
    Fast (one request for the whole range), but many firewalls/VPNs
    (Fortinet IPS/DPI, some full-tunnel setups) silently drop Who-Is
    broadcast (and even unicast Who-Is) as "scanning" traffic while still
    allowing normal point-to-point BACnet traffic through.
  - "unicast_sweep": probes every host in the range individually with a
    direct ReadProperty against the well-known wildcard device instance
    4194303 ("instance unknown" per the BACnet spec - a device receiving
    this addressed to it is expected to treat it as its own Device
    object). This is slower (one round trip per host) but works over
    connections where Who-Is is blocked, since it's indistinguishable
    from a normal property read.

Endpoints:
  POST /api/start   { local_address?: "192.168.2.50/24" }  -> starts local BACnet/IP stack
  POST /api/stop                                            -> stops it
  POST /api/scan     { subnet, timeout?, mode?, per_host_timeout?, concurrency? } -> scans and returns devices
  GET  /api/status                                          -> current proxy state
  GET  /                                                     -> serves the web UI (index.html)
"""
import asyncio
import errno
import datetime
import ipaddress
import re
import subprocess
import json
import os
import socket
import urllib.request
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from bacpypes3.pdu import Address, IPv4Address
from bacpypes3.object import DeviceObject
from bacpypes3.ipv4.app import NormalApplication, ForeignApplication
from bacpypes3.apdu import WhoIsRequest, GetEventInformationRequest
from bacpypes3.service.device import WhoIsFuture

import bacnet_core as bc
from bacnet_core import COMM_ERRORS
from bacpypes3.apdu import ErrorRejectAbortNack

app = FastAPI(title="NABE")
# app.js and the page are 700 kB of text and compress to about a fifth. On
# 127.0.0.1 that is nothing; through a remote desktop or the shared server it
# is the difference between a page that is there and one that arrives.
app.add_middleware(GZipMiddleware, minimum_size=2048)

# ---------------------------------------------------------------- security
# This service commands building plant: a POST to /api/write moves a setpoint
# in a real building. It ran with allow_origins=["*"], allow_methods=["*"] and
# no authentication, which meant any web page the engineer happened to have
# open could write to whatever plant the tool was connected to - the browser
# was being told, explicitly, that this was allowed.
#
# The fix is scoped to keep everything that legitimately works: the Portal
# still probes /api/status across origins, and the local copy still syncs
# notes to the shared server (server-to-server, so no browser and no CORS).
# What is closed is a foreign page being permitted to change anything.
#
# This is origin enforcement, not authentication. It stops the browser-based
# attack; it does not stop someone who is already on the network and using
# curl. Real credentials are a separate decision - see LES MEG.txt.

# Origins allowed to read across origins. Everything else may still call the
# API same-origin, which is how the tool's own UI works.
# Where site memory, notes, the write log and projects live. Next to the
# program by default, as it always was; the installed app points this at the
# user's own folder, because the program folder is not the place for data
# that must survive an update or an uninstall.
DATA_DIR = Path(os.environ.get("NABE_DATA") or Path(__file__).parent)
DATA_DIR.mkdir(parents=True, exist_ok=True)


def _env(navn: str, standard: str = "") -> str:
    """NABE_<navn>, with the old NM_<navn> still honoured so existing
    start scripts keep working."""
    return os.environ.get("NABE_" + navn, os.environ.get("NM_" + navn, standard))


ALLOWED_ORIGINS = {
    o.strip().rstrip("/")
    for o in _env(
        "ALLOWED_ORIGINS",
        "http://127.0.0.1:8092,http://localhost:8092",
    ).split(",")
    if o.strip()
}

# Endpoints that only read. Anything not listed changes something - the proxy
# binding, a setpoint, read-only mode, a saved site - and is refused unless
# the request comes from the tool's own page.
READ_ONLY_PATHS = {"/api/sites",
                   
    "/api/status", "/api/interfaces", "/api/readonly", "/api/mine", "/api/ny-versjon",
    "/api/writelog", "/api/notes", "/download", "/logo",
}


def _origin_ok(request) -> bool:
    origin = (request.headers.get("origin") or "").rstrip("/")
    if not origin:
        # No Origin header: not a browser cross-origin request. Same-origin
        # GETs and server-to-server calls (the notes sync) land here.
        return True
    if origin in ALLOWED_ORIGINS:
        return True
    # Same-origin requests carry an Origin that matches the host we answer on.
    host = request.headers.get("host", "")
    return origin.endswith("//" + host)


@app.middleware("http")
async def guard_and_cors(request, call_next):
    """
    Answers Private Network Access preflights, keeps cross-origin reads
    working for the Portal, and refuses cross-origin writes.

    Chrome's Private Network Access rules block a page on a public/private
    origin from reaching 127.0.0.1 unless the target opts in on the preflight.
    Starlette's CORSMiddleware has no setting for this and actively rejects
    such preflights with 400 "Disallowed CORS private-network", so the
    preflight is answered here and never reaches it.
    """
    origin = (request.headers.get("origin") or "").rstrip("/")
    tillatt = _origin_ok(request)

    if request.method == "OPTIONS":
        # Preflight. Only advertise permission to origins we actually accept;
        # anything else is told plainly that it may not.
        if not tillatt:
            return Response(status_code=403, content="Origin ikke tillatt")
        headers = {
            "Access-Control-Allow-Origin": origin or "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": request.headers.get(
                "access-control-request-headers", "content-type"
            ),
            "Access-Control-Max-Age": "600",
        }
        if request.headers.get("access-control-request-private-network") == "true":
            headers["Access-Control-Allow-Private-Network"] = "true"
        return Response(status_code=200, headers=headers)

    sti = request.url.path
    skriver = request.method != "GET" or sti not in READ_ONLY_PATHS
    if origin and not tillatt and skriver:
        return JSONResponse(
            status_code=403,
            content={"status": "error",
                     "error": "Avvist: forespørselen kom fra et annet nettsted."},
        )

    response = await call_next(request)
    if tillatt and origin:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
    return response

VERSJON = "1.15"

state = {"app": None, "local_address": None, "read_only": False, "bbmd": None}


def route_source_ip(target: str) -> str:
    """
    The local IP Windows would send from to reach `target`.

    connect() on a UDP socket sends nothing; it only asks the routing table.
    Asking about the plant itself is the point. The old question was "which
    adapter reaches 8.8.8.8", and on site that is Wi-Fi or the 4G modem - the
    one adapter guaranteed NOT to be the cable into the plant - and with no
    internet at all it fails outright.
    """
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect((target, 47808))
        return s.getsockname()[0]
    finally:
        s.close()


def kort_for(target: str) -> str:
    """
    The local IP to send from to reach `target`: an adapter that sits on the
    target's own subnet first, Windows' answer only when none does.

    Windows' answer alone was wrong on site. Its destination cache remembers
    the path it last used per address, so a sweep made while the cable had no
    link sent the whole subnet out through the 4G modem's default route - and
    after the cable came up, 192.168.2.1 still went to the modem while .50
    went down the cable. A subnet the cable is on is never behind the modem.
    """
    try:
        mal = ipaddress.IPv4Address(target)
        treff = [e for e in list_interfaces()
                 if e["prefix"] < 32 and mal in ipaddress.IPv4Network(e["cidr"], strict=False)]
    except Exception:
        treff = []
    if treff:
        via = route_source_ip(target)
        # Two adapters on the same subnet (cable and office Wi-Fi): Windows'
        # pick between them stands, otherwise the narrowest network wins.
        if any(e["ip"] == via for e in treff):
            return via
        return max(treff, key=lambda e: e["prefix"])["ip"]
    return route_source_ip(target)


def detect_local_ip() -> str:
    return route_source_ip("8.8.8.8")


def list_interfaces() -> List[Dict[str, Any]]:
    """
    Every usable IPv4 interface with its REAL prefix length.

    This matters: a VPN tunnel adapter is typically /32, and assuming /24
    makes bacpypes3 treat the target as off-link, so requests are built for
    a subnet the host isn't actually on and every reply is lost - the app
    looks connected but reads nothing back.
    """
    import psutil

    out: List[Dict[str, Any]] = []
    try:
        stats = psutil.net_if_stats()
    except Exception:
        stats = {}
    for name, addrs in psutil.net_if_addrs().items():
        # Windows keeps a static address on an adapter with no link: Wi-Fi
        # out of range, FortiClient disconnected. Binding there sends nothing,
        # and Wi-Fi on the office subnet would compete with the cable.
        if name in stats and not stats[name].isup:
            continue
        for a in addrs:
            if a.family != socket.AF_INET:
                continue
            ip = a.address
            if ip.startswith("127.") or ip.startswith("169.254."):
                continue
            try:
                prefix = ipaddress.IPv4Network(f"0.0.0.0/{a.netmask}").prefixlen if a.netmask else 32
            except Exception:
                prefix = 32
            out.append({
                "interface": name,
                "ip": ip,
                "prefix": prefix,
                "cidr": f"{ip}/{prefix}",
            })
    try:
        primary = detect_local_ip()
    except Exception:
        primary = None
    out.sort(key=lambda e: (e["ip"] != primary, e["interface"]))
    return out


# BACnet reserves UDP 47808-47823 so several BACnet applications can share a
# host. Where 47808 is already taken by another BACnet program, NABE can be
# given its own port with NABE_BACNET_PORT.
BACNET_PORT = int(_env("BACNET_PORT", "47808"))


def _with_port(cidr: str) -> str:
    """Append the configured local UDP port unless one was given explicitly."""
    host = cidr.split("/")[0]
    if ":" in cidr or ":" in host:
        return cidr
    return f"{cidr}:{BACNET_PORT}" if BACNET_PORT != 47808 else cidr


def resolve_local_address(requested: Optional[str]) -> str:
    """Turn user input (or nothing) into a CIDR bacpypes3 can bind correctly."""
    ifaces = list_interfaces()
    if requested:
        req = requested.strip()
        if "/" in req:
            return _with_port(req)
        # Bare IP: attach the interface's true prefix rather than guessing /24.
        for e in ifaces:
            if e["ip"] == req:
                return _with_port(e["cidr"])
        return _with_port(req)
    if ifaces:
        return _with_port(ifaces[0]["cidr"])
    return _with_port(f"{detect_local_ip()}/24")


def build_device_object(instance: int = 599123) -> DeviceObject:
    # Advertise segmentation + the largest standard APDU so controllers may
    # send us big responses; we still batch conservatively because most
    # controllers cannot segment their own replies.
    return DeviceObject(
        objectIdentifier=("device", instance),
        objectName="nm-bacnet-explorer",
        maxApduLengthAccepted=1476,
        segmentationSupported="segmentedBoth",
        maxSegmentsAccepted=64,
        vendorIdentifier=999,
    )


def _enlarge_socket_buffers(bacnet_app, size: int = 4 * 1024 * 1024) -> int:
    """
    Grow the UDP receive buffer on the BACnet sockets.

    The default is 64 kB. A ReadPropertyMultiple reply is around 1.4 kB, so
    only about 45 of them fit before the kernel starts discarding datagrams -
    and a discarded reply is indistinguishable from a device that never
    answered. Returns the size actually granted.
    """
    import socket as _socket

    granted = 0
    seen = set()

    def walk(obj, depth=0):
        nonlocal granted
        if id(obj) in seen or depth > 6:
            return
        seen.add(id(obj))
        for name in dir(obj):
            if name.startswith("__"):
                continue
            try:
                val = getattr(obj, name)
            except Exception:
                continue
            if isinstance(val, asyncio.DatagramTransport):
                sock = val.get_extra_info("socket")
                if sock is None:
                    continue
                try:
                    sock.setsockopt(_socket.SOL_SOCKET, _socket.SO_RCVBUF, size)
                    granted = max(granted, sock.getsockopt(_socket.SOL_SOCKET, _socket.SO_RCVBUF))
                except OSError:
                    pass
            elif hasattr(val, "__dict__") and not callable(val):
                walk(val, depth + 1)

    walk(bacnet_app)
    return granted


class StartBody(BaseModel):
    local_address: Optional[str] = None


class ScanBody(BaseModel):
    subnet: str
    timeout: float = 4.0
    mode: str = "broadcast"  # "broadcast" | "unicast_sweep"
    per_host_timeout: float = 0.6
    concurrency: int = 40
    thorough: bool = True
    plan: Optional[List[List[float]]] = None


MAX_SWEEP_HOSTS = 4096
SISTE_ENHETER: List[str] = []      # addresses found this session, for router discovery


def parse_target(spec: str):
    """
    "10.1.2.0/24", "10.1.2.7", "10.1.2.10-40" or "10.1.2.10-10.1.2.40".

    Returns (hosts, net). net is the smallest network that covers the hosts:
    it is what a Who-Is is aimed at, and the sweep only ever touches `hosts`.

    Ranges exist for the VPN case. One FortiClient tunnel often reaches many
    buildings in the same address block, and a /24 or /16 would then probe
    other customers' plants. Typing exactly the addresses you mean is the
    only scan that stays inside your own building.
    """
    s = str(spec).strip()
    if "-" in s and "/" not in s:
        a, b = (x.strip() for x in s.split("-", 1))
        start = ipaddress.IPv4Address(a)
        if "." in b:
            end = ipaddress.IPv4Address(b)
        else:
            end = ipaddress.IPv4Address(int(start) - (int(start) & 0xFF) + int(b))
        if int(end) < int(start):
            raise ValueError(f"{s}: slutten er lavere enn starten")
        hosts = [str(ipaddress.IPv4Address(i)) for i in range(int(start), int(end) + 1)]
        # At least the /24 around it: that is the subnet a building actually
        # has, and a Who-Is aimed at a /26 would go to the wrong .63.
        net = ipaddress.ip_network(f"{start}/24", strict=False)
        while end not in net:
            net = net.supernet()
        return hosts, net
    net = ipaddress.ip_network(s, strict=False)
    if net.num_addresses > 65536:
        # Only a Who-Is can cover a block this size; listing it would not.
        return None, net
    hosts = [str(ip) for ip in net.hosts()] or [str(net.network_address)]
    return hosts, net


@app.get("/api/status")
def status():
    return {
        "running": state["app"] is not None,
        "versjon": VERSJON,
        "local_address": state["local_address"],
        "bbmd": state.get("bbmd"),
        "port_advarsel": port_advarsel(port_naboer()) if state["app"] else None,
    }


@app.get("/api/interfaces")
def interfaces():
    try:
        return {"status": "done", "interfaces": list_interfaces()}
    except Exception as e:
        return {"status": "error", "error": str(e), "interfaces": []}


@app.get("/api/route")
def route(target: str):
    """Which of our interfaces the OS would use to reach `target`."""
    try:
        hosts, net = parse_target(target)
        first = hosts[0] if hosts else str(net.network_address + 1)
        ip = kort_for(first)
    except Exception as e:
        return {"status": "error", "error": str(e)}
    for e in list_interfaces():
        if e["ip"] == ip:
            return {"status": "done", "target": first, **e}
    return {"status": "done", "target": first, "ip": ip, "cidr": f"{ip}/32",
            "interface": None, "prefix": 32}


_RUTE_LINJE = re.compile(
    r"^\s*(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)\s+(.+?)\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+)\s*$")


def ruter_via(ip: str) -> List[Dict[str, Any]]:
    """
    The networks Windows sends out through the adapter that has `ip`.

    This is where the plant usually is. A WireGuard tunnel's AllowedIPs and a
    FortiClient split tunnel both end up here as routes, so the building's own
    range is in the routing table before anyone has typed it. Headers are
    localised, so lines are matched on their shape instead.
    """
    try:
        ut = subprocess.run(["route", "print", "-4"], capture_output=True, timeout=4,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        tekst = ut.stdout.decode("oem" if os.name == "nt" else "utf-8", errors="replace")
    except Exception:
        return []
    egen = ipaddress.IPv4Address(ip)
    sett, ut_liste = set(), []
    for linje in tekst.splitlines():
        m = _RUTE_LINJE.match(linje)
        if not m or m.group(4) != ip:
            continue
        try:
            net = ipaddress.IPv4Network(f"{m.group(1)}/{m.group(2)}", strict=False)
        except ValueError:
            continue
        # Hosts, the default route, multicast, loopback and link-local say
        # nothing about where a building is; a /8 is a whole company.
        if not 9 <= net.prefixlen <= 30 or net.is_multicast or net.is_loopback or net.is_link_local:
            continue
        if str(net) in sett:
            continue
        sett.add(str(net))
        ut_liste.append({"cidr": str(net), "egen": egen in net})
    # Behind the tunnel first: the adapter's own subnet is the tunnel itself
    # on a VPN, and only on a cable is it the plant.
    ut_liste.sort(key=lambda r: (r["egen"], -ipaddress.IPv4Network(r["cidr"]).prefixlen))
    return ut_liste[:8]


# ------------------------------------------------------------- saving files
# A download in the window always lands in Downloads. NABO's files belong
# where BTG puts them, or wherever the project keeps its NTI files, so the
# server writes them there itself.

_ULOVLIG_FILNAVN = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def _btg_mappe() -> Optional[str]:
    """BTG's own export folder, where it already is."""
    hjem = Path.home()
    kandidater = [*hjem.glob("OneDrive*/Desktop/BTG-Export"), hjem / "Desktop" / "BTG-Export"]
    for k in kandidater:
        if k.is_dir():
            return str(k)
    return None


def _nedlastinger() -> Optional[str]:
    """The Downloads folder Windows actually uses - often moved, sometimes
    into OneDrive, so home/Downloads is only the guess when asking fails."""
    if os.name == "nt":
        try:
            import ctypes
            from ctypes import wintypes

            class GUID(ctypes.Structure):
                _fields_ = [("a", wintypes.DWORD), ("b", wintypes.WORD), ("c", wintypes.WORD), ("d", ctypes.c_ubyte * 8)]
            fid = GUID(0x374DE290, 0x123F, 0x4565, (ctypes.c_ubyte * 8)(0x91, 0x64, 0x39, 0xC4, 0x92, 0x5E, 0x46, 0x7B))
            p = ctypes.c_wchar_p()
            if ctypes.windll.shell32.SHGetKnownFolderPath(ctypes.byref(fid), 0, None, ctypes.byref(p)) == 0:
                sti = p.value
                ctypes.windll.ole32.CoTaskMemFree(p)
                if sti and Path(sti).is_dir():
                    return sti
        except Exception:
            pass
    d = Path.home() / "Downloads"
    return str(d) if d.is_dir() else None


@app.get("/api/mapper")
def mapper():
    return {"status": "done", "nedlastinger": _nedlastinger(), "btg": _btg_mappe()}


class LagreBody(BaseModel):
    mappe: str
    navn: str
    data: str      # base64


@app.post("/api/lagre")
def lagre_fil(body: LagreBody):
    """Write one file into a folder you chose. Never over an existing file:
    the same name gets (2), (3) as a browser download would."""
    import base64
    mappe = Path(body.mappe)
    if not mappe.is_absolute() or not mappe.is_dir():
        return {"status": "error", "error": f"Fant ikke mappa {body.mappe}"}
    navn = body.navn.strip()
    if not navn or navn in (".", "..") or _ULOVLIG_FILNAVN.search(navn):
        return {"status": "error", "error": "Ugyldig filnavn"}
    try:
        data = base64.b64decode(body.data, validate=True)
    except Exception:
        return {"status": "error", "error": "Ugyldig innhold"}
    maal = mappe / navn
    stamme, ending = maal.stem, maal.suffix
    n = 2
    while maal.exists():
        maal = mappe / f"{stamme} ({n}){ending}"
        n += 1
    try:
        maal.write_bytes(data)
    except OSError as e:
        return {"status": "error", "error": str(e)}
    return {"status": "done", "sti": str(maal)}


class StiBody(BaseModel):
    sti: str = ""


@app.post("/api/vis-fil")
def vis_fil(body: StiBody):
    """Open Explorer with the file selected."""
    p = Path(body.sti)
    if not p.is_absolute() or not p.exists():
        return {"status": "error", "error": "Fila finnes ikke"}
    if os.name == "nt":
        subprocess.Popen(["explorer", "/select,", str(p)])
    return {"status": "done"}


@app.post("/api/velg-mappe")
async def velg_mappe(body: StiBody):
    """Windows' own folder dialog, for when NABE runs in a browser and has no
    window of its own to ask. Shown on top, since nothing owns it."""
    if os.name != "nt":
        return {"status": "error", "error": "Bare på Windows"}
    start = body.sti if body.sti and Path(body.sti).is_dir() else str(Path.home())
    ps = (
        "Add-Type -AssemblyName System.Windows.Forms;"
        "$f = New-Object System.Windows.Forms.Form -Property @{TopMost=$true; ShowInTaskbar=$false};"
        "$d = New-Object System.Windows.Forms.FolderBrowserDialog;"
        "$d.Description = 'Hvor skal NABO lagre filene?';"
        f"$d.SelectedPath = '{start.replace(chr(39), chr(39) * 2)}';"
        "if ($d.ShowDialog($f) -eq 'OK') { [Console]::OutputEncoding = [Text.Encoding]::UTF8; $d.SelectedPath }"
    )

    def kjor():
        ut = subprocess.run(["powershell", "-NoProfile", "-STA", "-Command", ps], capture_output=True,
                            timeout=600, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return ut.stdout.decode("utf-8", errors="replace").strip()

    try:
        valgt = await asyncio.get_event_loop().run_in_executor(None, kjor)
    except Exception as e:
        return {"status": "error", "error": str(e)}
    return {"status": "done", "mappe": valgt or None}


@app.get("/api/forslag")
def forslag(ip: str):
    """Ranges worth scanning from this adapter: its routes, and the sites
    remembered here that Windows would reach through it."""
    try:
        ipaddress.IPv4Address(ip)
    except ValueError:
        return {"status": "error", "error": "Ugyldig IP"}
    ruter = ruter_via(ip)
    nett = [ipaddress.IPv4Network(r["cidr"]) for r in ruter]
    anlegg = []
    for key, s in sorted(SITES.items(), key=lambda kv: -(kv[1].get("sist") or 0)):
        # Through a route of this adapter, or scanned from this address before.
        # Not via the default route: that would put every site of every VPN
        # under Wi-Fi as soon as the tunnel is down.
        try:
            hosts, net = parse_target((s.get("ranges") or key.split(" "))[0])
            forste = ipaddress.IPv4Address(hosts[0] if hosts else str(net.network_address + 1))
        except Exception:
            continue
        lokal = str(s.get("lokal") or "").split("/")[0]
        if lokal != ip and not any(forste in n for n in nett):
            continue
        anlegg.append({"key": key, "navn": s.get("navn") or "",
                       "enheter": len(s.get("enheter") or []), "sist": s.get("sist")})
        if len(anlegg) >= 4:
            break
    return {"status": "done", "ruter": ruter, "anlegg": anlegg}



# --------------------------------------------------------------- port sharing
# The failure this catches took a site visit to understand.
#
# BACnet/IP is a fixed port, so every BACnet tool on the machine wants UDP
# 47808. On Windows a second bind to it does not fail - it is accepted, and
# then one of the two processes quietly stops receiving. bacpypes3 builds its
# transports in a background task, so even a bind that does fail never reaches
# the try/except around the call; /api/start answers "done" either way.
#
# The result is a tool that says it is connected, shows the right adapter, and
# finds nothing. Which is exactly what it looks like when the cable is in the
# wrong port, so that is where you go looking.
#
# Our own colleagues hit the same shape of problem with YABE, where the fix is
# Udp_ExclusiveUseOfSocket=False. Same root: two programs, one socket.
def port_naboer(port: int = None) -> List[Dict[str, Any]]:
    """Other processes holding the BACnet port on the interface we are using.

    The interface matters. Two programs bound to 47808 on different adapters
    do not collide - the server copy on one NIC and this one on the VPN is a
    normal arrangement, and warning about it would teach people to ignore the
    warning that matters. Only the same address collides, or 0.0.0.0, which
    takes every adapter including ours.
    """
    port = port or BACNET_PORT
    meg = os.getpid()
    ut: List[Dict[str, Any]] = []
    try:
        import psutil
    except Exception:
        return ut
    min_ip = (state.get("local_address") or "").split("/")[0].split(":")[0]
    try:
        for c in psutil.net_connections(kind="udp4"):
            if not c.laddr or c.laddr.port != port:
                continue
            if not c.pid or c.pid == meg:
                continue
            deres = c.laddr.ip
            if min_ip and deres not in (min_ip, "0.0.0.0") and min_ip != "0.0.0.0":
                continue
            try:
                navn = psutil.Process(c.pid).name()
            except Exception:
                navn = "ukjent program"
            if not any(x["pid"] == c.pid for x in ut):
                ut.append({"pid": c.pid, "name": navn, "ip": c.laddr.ip})
    except Exception:
        # psutil trenger rettigheter for enkelte prosesser; da er delvis svar
        # bedre enn ingen, og ingen svar bedre enn en feilmelding.
        pass
    return ut


def port_advarsel(naboer: List[Dict[str, Any]]) -> Optional[str]:
    if not naboer:
        return None
    hvem = ", ".join(f"{n['name']} (PID {n['pid']})" for n in naboer[:3])
    return (
        f"Et annet program lytter også på UDP {BACNET_PORT}: {hvem}. "
        "Windows tillater det, men da er det tilfeldig hvem av dere som får "
        "svarene fra anlegget - og den andre finner ingenting uten å si fra. "
        "Lukk det andre BACnet-verktøyet og trykk «Koble til på nytt», eller "
        f"gi denne en egen port med NABE_BACNET_PORT=47809 i start.bat."
    )


def device_address(spec) -> Address:
    """Turn whatever a device reported about itself back into an Address.

    This used to be `device_address(spec)` in eleven places, which looks
    harmless because 47808 is the default anyway. It is not harmless: it is
    string concatenation onto something that is not always a bare IP, and
    Address then refuses the result outright.

      10.121.42.84          -> fine either way, 47808 is the default
      10.121.42.84:47809    -> ValueError, a plant on a non-standard port
      50:2                  -> ValueError, a device behind a gateway

    The last one is the one that cost us a site visit. A router or a protocol
    gateway - a FieldServer ProtoNode, say - presents the equipment behind it
    as devices on its own BACnet network, and an I-Am from one of those has a
    remote station as its source, printed "network:mac", not an IP. Who-Is
    found them, they appeared in the list, and every read failed, because the
    address they came back on was never a valid address again.

    Address already understands all three forms. Handing it the string
    unchanged is both shorter and correct.
    """
    return Address(str(spec).strip())


async def _open_app(local_address: str, bbmd: Optional[str] = None):
    """
    Bind the BACnet stack, as an ordinary device or as a foreign device.

    A foreign device registers with a BBMD and hands it its broadcasts, which
    the BBMD then repeats on its own network. That is how one Who-Is over a
    VPN reaches a whole building - MS/TP behind routers included - and only
    that building, however many others share the tunnel.
    """
    addr = IPv4Address(local_address)
    device_obj = build_device_object()
    if bbmd:
        bacnet_app = ForeignApplication(device_obj, addr)
        bacnet_app.register(IPv4Address(bbmd), 300)
    else:
        bacnet_app = NormalApplication(device_obj, addr)
    # The transports are created asynchronously; give them a moment to
    # exist before resizing their buffers.
    await asyncio.sleep(0.3)
    rcvbuf = _enlarge_socket_buffers(bacnet_app)
    state["app"] = bacnet_app
    state["local_address"] = local_address
    state["bbmd"] = bbmd
    return bacnet_app, rcvbuf


def _close_app() -> None:
    a = state["app"]
    if a is None:
        return
    _cov_stopp_alle()
    try:
        if state.get("bbmd"):
            a.unregister()
    except Exception:
        pass
    try:
        a.close()
    except Exception:
        pass
    state["app"] = None
    state["local_address"] = None
    state["bbmd"] = None


async def _switch_bbmd(bbmd: Optional[str]):
    """Rebind on the same local address, registered with `bbmd` or not."""
    if state["app"] is not None and state.get("bbmd") == bbmd:
        return state["app"]
    local = state["local_address"]
    _close_app()
    # The old socket has to be gone before the same port is bound again.
    await asyncio.sleep(0.2)
    bacnet_app, _ = await _open_app(local, bbmd)
    return bacnet_app


async def _wait_registration(bacnet_app, timeout: float = 6.0) -> int:
    """-1 no answer, 0 accepted, >0 the BBMD's NAK code."""
    loop = asyncio.get_event_loop()
    end = loop.time() + timeout
    while loop.time() < end:
        status = bacnet_app.foreign.bbmdRegistrationStatus
        if status >= 0:
            return status
        await asyncio.sleep(0.1)
    return -1


@app.post("/api/start")
async def start_proxy(body: StartBody):
    if state["app"] is not None:
        return {"status": "already-running", "local_address": state["local_address"]}
    try:
        local_address = resolve_local_address(body.local_address)
        bacnet_app, rcvbuf = await _open_app(local_address)
        naboer = port_naboer()
        return {"status": "done", "local_address": local_address,
                "rcvbuf": rcvbuf, "port_naboer": naboer,
                "port_advarsel": port_advarsel(naboer)}
    except OSError as e:
        # The one failure worth explaining rather than reporting. BACnet/IP is
        # a fixed port, so any other BACnet program on this PC - YABE, a vendor
        # tool, a second copy of this one - holds it and this bind fails. The
        # raw text is "[Errno 10048] Only one usage of each socket address...",
        # which tells a technician standing in a plant room nothing at all.
        opptatt = getattr(e, "winerror", None) == 10048 or e.errno in (
            errno.EADDRINUSE, errno.EACCES)
        if not opptatt:
            return {"status": "error", "error": str(e)}
        return {
            "status": "error",
            "error": (
                f"UDP-port {BACNET_PORT} er opptatt av et annet program.\n\n"
                "BACnet/IP har fast port, så bare ett program om gangen kan "
                "lytte på den. Lukk andre BACnet-verktøy - YABE, "
                "leverandørverktøy, eller en annen kopi av denne - og prøv igjen.\n\n"
                "Hvem som har den: åpne ledetekst og kjør\n"
                f"    netstat -ano | findstr {BACNET_PORT}\n"
                "    tasklist /FI \"PID eq <tallet>\"\n\n"
                "Må de kjøre samtidig, kan denne bruke en annen port: sett "
                "NABE_BACNET_PORT=47809 i start.bat. Da lytter den på 47809, "
                "mens den fortsatt snakker med anlegget på 47808."
            ),
            "port_opptatt": True,
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}


@app.post("/api/stop")
async def stop_proxy():
    _close_app()
    return {"status": "done"}


def _local_network() -> Optional[ipaddress.IPv4Network]:
    """The subnet we are bound on, or None for a /32 tunnel address."""
    lokal = state.get("local_address")
    if not lokal:
        return None
    try:
        nett = ipaddress.ip_interface(lokal.split(":")[0]).network
    except ValueError:
        return None
    return nett if nett.prefixlen < 32 else None


def _is_local(net: ipaddress.IPv4Network) -> bool:
    lokal = _local_network()
    return lokal is not None and net.subnet_of(lokal)


async def scan_broadcast(bacnet_app, net: ipaddress.IPv4Network, timeout: float,
                         hosts: Optional[List[str]] = None):
    """
    Who-Is, sent the way the network in question can actually carry it.

    On our own subnet it goes out as a real BACnet broadcast to every network
    (DNET 65535). Routers repeat that onto their MS/TP side, and devices that
    ignore a unicast frame which merely happens to be addressed to .255 still
    answer it. The directed .255 form the tool used to send alone was, as far
    as BACnet is concerned, a unicast to one odd address - so locally it
    missed exactly the controllers behind routers.

    Through a BBMD it is handed to the BBMD to repeat in its own building.
    Off-subnet without one, the directed .255 is the only thing left to try.
    """
    if state.get("bbmd"):
        destination = Address("*:*")
        broadcast_ip = f"BBMD {state['bbmd']}"
    elif _is_local(net):
        destination = Address("*:*")
        broadcast_ip = "*:* (lokal kringkasting)"
    else:
        destination = None
        broadcast_ip = str(net.broadcast_address)
    devices = await _who_is(bacnet_app, destination or device_address(broadcast_ip), timeout)
    if hosts is not None and not state.get("bbmd"):
        # A range like .10-40 still gets a whole-subnet broadcast; keep what
        # was asked for. Devices behind a router have no IP and are kept.
        wanted = set(hosts)
        devices = [d for d in devices if d["address"] in wanted
                   or not _plain_ip(d["address"])]
    return devices, broadcast_ip


def _plain_ip(a: str) -> bool:
    try:
        ipaddress.IPv4Address(a.split(":")[0])
        return ":" not in a or a.split(":")[1].isdigit()
    except ValueError:
        return False


async def _who_is(bacnet_app, destination, timeout: float):

    # Build the Who-Is request manually and send it as a *directed broadcast*
    # to the target subnet's broadcast address. We deliberately do NOT use
    # bacpypes3's app.who_is(address=...) helper here: passing a destination
    # address to who_is() also makes it *filter incoming I-Am replies by
    # that exact source address* (it assumes you're probing one specific
    # device), which would silently reject every real device response,
    # since devices reply from their own unicast IP, never from the
    # broadcast address itself. Building the WhoIsFuture with address=None
    # collects all I-Am replies while still targeting the chosen subnet.
    who_is = WhoIsRequest(destination=destination)

    if not hasattr(bacnet_app, "_who_is_futures"):
        bacnet_app._who_is_futures = []

    who_is_future = WhoIsFuture(bacnet_app, None, None, None, timeout)
    bacnet_app._who_is_futures.append(who_is_future)
    bacnet_app.request(who_is)

    try:
        i_ams = await asyncio.wait_for(who_is_future.future, timeout=timeout + 2)
    except asyncio.TimeoutError:
        i_ams = []

    devices = []
    for i_am in i_ams or []:
        try:
            devices.append({
                "device_instance": i_am.iAmDeviceIdentifier[1],
                "address": str(i_am.pduSource),
                "object_name": None,
                "max_apdu": i_am.maxAPDULengthAccepted,
                "segmentation": str(i_am.segmentationSupported),
                "vendor_id": i_am.vendorID,
            })
        except Exception:
            continue
    return devices


class Pacer:
    """Spread outgoing probes over time instead of firing them in a burst.

    A semaphore limits how many probes are *in flight*; it does nothing about
    how fast they leave. With 40 permits, 40 datagrams hit the tunnel in the
    same millisecond. This hands out send slots no closer together than
    `interval`, so the packet rate is bounded independently of concurrency.
    """

    def __init__(self, interval: float):
        self.interval = max(0.0, interval)
        self._next = 0.0
        self._lock = asyncio.Lock()

    async def wait(self):
        if not self.interval:
            return
        async with self._lock:
            now = asyncio.get_event_loop().time()
            delay = self._next - now
            self._next = max(now, self._next) + self.interval
        if delay > 0:
            await asyncio.sleep(delay)


async def probe_host_unicast(bacnet_app, ip: str, per_host_timeout: float,
                             sem: asyncio.Semaphore, pacer=None):
    async with sem:
        if pacer is not None:
            await pacer.wait()
        addr = device_address(ip)
        try:
            # 4194303 is the BACnet "instance unknown" wildcard: a device
            # receiving a request addressed to device,4194303 is expected
            # to respond as if it were addressed by its own real instance.
            oid = await asyncio.wait_for(
                bacnet_app.read_property(addr, "device,4194303", "object-identifier"),
                timeout=per_host_timeout,
            )
            device_instance = oid[1] if oid is not None else None
        except ErrorRejectAbortNack:
            # Something answered - it just refused the wildcard. Some
            # controllers (and every bacpypes3 simulator) do. A Who-Is sent
            # straight to the address gets its real instance instead.
            try:
                i_ams = await asyncio.wait_for(
                    bacnet_app.who_is(address=addr, timeout=max(1, int(per_host_timeout + 0.5))),
                    timeout=per_host_timeout + 1.5)
            except COMM_ERRORS:
                return None
            if not i_ams:
                return None
            device_instance = i_ams[0].iAmDeviceIdentifier[1]
        except COMM_ERRORS:
            return None

        # Ask for name and vendor addressed to the real instance. Some
        # controllers answer the wildcard only for object-identifier and
        # reject everything else sent to 4194303, which is how a device
        # ended up listed as "Ukjent" with no name.
        real = f"device,{device_instance}" if device_instance is not None else "device,4194303"
        object_name = None
        vendor_name = None
        for objid in (real, "device,4194303"):
            if object_name is None:
                try:
                    object_name = await bc.read_retry(
                        bacnet_app, addr, objid, "object-name",
                        attempts=2, timeout=max(per_host_timeout, 2.0))
                except COMM_ERRORS:
                    pass
            if vendor_name is None:
                try:
                    vendor_name = await bc.read_retry(
                        bacnet_app, addr, objid, "vendor-name",
                        attempts=2, timeout=max(per_host_timeout, 2.0))
                except COMM_ERRORS:
                    pass
            if object_name is not None and vendor_name is not None:
                break

        return {
            "device_instance": device_instance,
            "address": ip,
            "object_name": str(object_name) if object_name is not None else None,
            "vendor_name": str(vendor_name) if vendor_name is not None else None,
        }


async def berik_navn(bacnet_app, devices: List[Dict[str, Any]], timeout: float = 2.0,
                     samtidig: int = 16):
    """
    Ask each device found by Who-Is for its name and vendor.

    An I-Am carries the instance and a vendor number, nothing else. The sweep
    asks for the name as part of probing, but a Who-Is on our own subnet or
    through a BBMD did not ask at all - so a Beckhoff on the cable came up as
    "-" while the same controller over a VPN had its name.
    """
    sem = asyncio.Semaphore(samtidig)

    async def en(d):
        if d.get("object_name") is not None or d.get("device_instance") is None:
            return
        async with sem:
            addr = device_address(d["address"])
            objid = f"device,{d['device_instance']}"
            for prop, felt in (("object-name", "object_name"), ("vendor-name", "vendor_name")):
                if d.get(felt) is not None:
                    continue
                try:
                    v = await bc.read_retry(bacnet_app, addr, objid, prop,
                                            attempts=2, timeout=timeout)
                    if v is not None:
                        d[felt] = str(v)
                except COMM_ERRORS:
                    pass
                except Exception:
                    pass

    await asyncio.gather(*(en(d) for d in devices))


async def scan_unicast_sweep(bacnet_app, hosts: List[str],
                             per_host_timeout: float, concurrency: int,
                             thorough: bool = True, job=None,
                             plan_override=None):
    """
    Sweep the range, then re-probe whatever stayed silent.

    Timings come from a hotel VPN, which is the hard case. Two things were
    measured there and both shape this:

    1. A device that answers at all answers in about 90 ms. Waiting 2.5-4 s
       per address therefore buys nothing from live devices and costs the
       whole scan, because an empty address always burns the full timeout
       and most addresses in a /24 are empty. Short timeouts, not clever
       concurrency, are what make a sweep fast.
    2. Reachability of an individual device drifts minute to minute. The
       same controller answered 6/8 probes, then 0/8 half an hour later,
       while a scan running in between found it every time. So a single
       silent probe means very little, and the fix for that is more
       attempts - not a longer wait on each one.
    """
    found: Dict[str, Dict[str, Any]] = {}
    pending = list(hosts)

    # (concurrency, timeout) per pass.
    if plan_override:
        plan = [(int(r[0]), float(r[1]), float(r[2]) if len(r) > 2 else 0.0)
                for r in plan_override]
    else:
        plan = [(concurrency, per_host_timeout, 0.0)]
        if thorough:
            # Three short, gentle passes over the silent addresses beat one
            # long patient pass: measured 104 s against 2-4 minutes for the
            # old 4-concurrent/12-second retry, with more attempts per
            # address rather than fewer.
            plan += [(6, 1.0, 0.0)] * 3

    total_work = sum(len(hosts) if i == 0 else 0 for i in range(len(plan))) or len(hosts)
    if job is not None:
        job["total"] = len(hosts)
        job["done"] = 0

    for p, (conc, timeout, pace) in enumerate(plan):
        if not pending:
            break
        if job is not None:
            job["phase"] = "søker" if p == 0 else "sjekker stille adresser"
            job["total"] = len(pending) if p else len(hosts)
            job["done"] = 0
        sem = asyncio.Semaphore(max(1, conc))
        pacer = Pacer(pace)
        done = 0

        async def one(ip):
            nonlocal done
            r = await probe_host_unicast(bacnet_app, ip, timeout, sem, pacer)
            # Record the hit immediately so the running count is truthful;
            # collecting only after the pass finished made the UI report
            # "0 funnet" for minutes while devices were being discovered.
            if r is not None:
                found[ip] = r
                # Publish the device itself, not just a count: five seconds of
                # a progress bar with an empty list beside it reads as frozen,
                # while controllers appearing one by one reads as working.
                if job is not None:
                    job["devices"] = _sorted_devices(found)
            done += 1
            if job is not None:
                job["done"] = done
                job["found"] = len(found)
            return r

        results = await asyncio.gather(*[one(ip) for ip in pending])
        pending = [ip for ip, r in zip(pending, results) if r is None]
        if job is not None:
            job["found"] = len(found)

    return list(found.values()), len(hosts)


def _les_bdt(bbmd: str, timeout: float = 2.0) -> Optional[List[str]]:
    """
    Read-Broadcast-Distribution-Table, sent straight as BVLC.

    The table lists every BBMD the building's BBMDs forward broadcasts to - in
    practice, where the rest of the plant is. bacpypes3 has the service but
    does not wire it into an application, and the request is four bytes, so it
    goes out on its own short-lived socket instead.

    Returns the peers as "ip" or "ip:port", [] for a BBMD with an empty table,
    or None when the address does not act as a BBMD at all.
    """
    host, _, port = bbmd.partition(":")
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(timeout)
    try:
        s.sendto(bytes([0x81, 0x02, 0x00, 0x04]), (host, int(port or 47808)))
        while True:
            data, _ = s.recvfrom(1500)
            if len(data) < 4 or data[0] != 0x81:
                continue
            if data[1] == 0x00:          # BVLC-Result: a NAK, so not a BBMD
                return None
            if data[1] != 0x03:
                continue
            peers = []
            for i in range(4, len(data) - 9, 10):
                ip = ".".join(str(b) for b in data[i:i + 4])
                p = int.from_bytes(data[i + 4:i + 6], "big")
                peers.append(ip if p == 47808 else f"{ip}:{p}")
            return peers
    except OSError:
        return None
    finally:
        s.close()


async def _scan_via_bbmd(job, body: "ScanBody", hosts: List[str]):
    """
    Register with the BBMD at the one address given and Who-Is through it.

    Returns (devices, note, bbmd_status). When the address turns out not to be
    a BBMD - no answer, or a NAK because foreign devices are switched off - the
    stack goes back to normal and the address is at least read on its own, so
    typing one IP never comes back with nothing to show for it.
    """
    bbmd = hosts[0]
    job["phase"] = f"leser BBMD-tabellen hos {bbmd}"
    loop = asyncio.get_event_loop()
    bdt = await loop.run_in_executor(None, _les_bdt, bbmd)
    job["bdt"] = bdt
    job["phase"] = f"registrerer hos BBMD {bbmd}"
    bacnet_app = await _switch_bbmd(bbmd)
    status = await _wait_registration(bacnet_app)
    if status == 0:
        job["phase"] = "who-is via BBMD"
        devices = await _who_is(bacnet_app, Address("*:*"), max(body.timeout, 6.0))
        if not any(d["address"] == bbmd for d in devices):
            # A JACE acting as BBMD does not always answer its own Who-Is.
            r = await probe_host_unicast(bacnet_app, bbmd, 2.0, asyncio.Semaphore(1))
            if r:
                devices.append(r)
        return devices, f"Registrert hos BBMD {bbmd}" + _bdt_tekst(bbmd, bdt), status

    bacnet_app = await _switch_bbmd(None)
    if status == -1:
        note = (f"{bbmd} svarte ikke på registrering som foreign device - "
                "den er trolig ikke BBMD. Leste adressen alene.")
    else:
        # 0x30 is what every BACnet/IP device that is not a BBMD answers with,
        # and also what a BBMD with foreign registration switched off says.
        note = (f"{bbmd} avviste registreringen (kode 0x{status:02X}). Den er "
                "enten ikke BBMD, eller tar ikke imot foreign devices. "
                "Leste adressen alene.")
    job["phase"] = f"leser {bbmd}"
    r = await probe_host_unicast(bacnet_app, bbmd, 2.0, asyncio.Semaphore(1))
    return ([r] if r else []), note + _bdt_tekst(bbmd, bdt), status


def _bdt_tekst(bbmd: str, bdt: Optional[List[str]]) -> str:
    """One sentence about the other BBMDs, or nothing."""
    andre = [p for p in (bdt or []) if p.split(":")[0] != bbmd.split(":")[0]]
    if not andre:
        return ""
    return (f". Bygget har {len(andre) + 1} BBMD-er - de andre er "
            + ", ".join(andre) + ". Skann dem i BBMD-modus for resten av anlegget.")


async def _run_scan(job, body: "ScanBody", hosts: List[str], net):
    mode = body.mode
    note = None
    bbmd_status = None
    broadcast_ip = None
    hosts_scanned = len(hosts) if hosts else net.num_addresses
    # A typed range (.10-40) is answered by a whole-subnet broadcast; only
    # then are the replies trimmed back to what was asked for.
    only = hosts if "-" in body.subnet else None

    if mode == "bbmd":
        devices, note, bbmd_status = await _scan_via_bbmd(job, body, hosts)
        broadcast_ip = f"BBMD {hosts[0]}" if bbmd_status == 0 else None
    else:
        # Anything else is a scan of addresses, not of a building behind a
        # BBMD, so a registration left over from earlier would only send the
        # Who-Is to the wrong place.
        bacnet_app = await _switch_bbmd(None)
        if mode == "auto":
            # On our own subnet a broadcast reaches everything in seconds and
            # the link does not drift, so the patient VPN passes buy nothing.
            # Anywhere else broadcasts do not arrive and the sweep is the scan.
            mode = "lokal" if _is_local(net) else "unicast_sweep"
        if mode == "lokal":
            job["phase"] = "who-is"
            devices, broadcast_ip = await scan_broadcast(bacnet_app, net, body.timeout, only)
            seen = {d["address"] for d in devices}
            rest = [h for h in (hosts or []) if h not in seen][:MAX_SWEEP_HOSTS]
            # One quick pass for devices that ignore broadcasts. Locally an
            # empty address costs one ARP timeout, not a VPN round trip.
            more, _ = await scan_unicast_sweep(
                bacnet_app, rest, body.per_host_timeout, body.concurrency,
                thorough=False, job=job)
            devices += more
        elif mode == "unicast_sweep":
            devices, hosts_scanned = await scan_unicast_sweep(
                bacnet_app, hosts, body.per_host_timeout, body.concurrency,
                thorough=body.thorough, job=job, plan_override=body.plan,
            )
        else:
            job["phase"] = "who-is"
            devices, broadcast_ip = await scan_broadcast(bacnet_app, net, body.timeout, only)
            hosts_scanned = net.num_addresses

    if state["app"] is not None and any(d.get("object_name") is None for d in devices):
        job["phase"] = "henter navn"
        await berik_navn(state["app"], devices)

    devices.sort(key=lambda d: (d["device_instance"] is None, d["device_instance"]))
    for d in devices:
        if d.get("address") and d["address"] not in SISTE_ENHETER:
            SISTE_ENHETER.append(d["address"])
    return {
        "status": "done",
        "subnet": body.subnet,
        "mode": body.mode,
        "mode_used": mode,
        "broadcast": broadcast_ip,
        "hosts_scanned": hosts_scanned,
        "count": len(devices),
        "devices": devices,
        "note": note,
        "bbmd_status": bbmd_status,
        "bdt": job.get("bdt"),
    }


@app.post("/api/scan")
async def scan_subnet(body: ScanBody):
    """
    Start the scan as a job. A thorough sweep of a /24 over a VPN takes
    minutes, and a request that just hangs for that long is indistinguishable
    from a crash - so progress and cancel are part of the contract.
    """
    if state["app"] is None:
        return {"status": "error", "error": "Proxy er ikke startet. Kall /api/start først."}
    try:
        spec = body.subnet.strip()
        if body.mode == "bbmd" and spec.count(":") == 1:
            # A BBMD on a non-standard port: 10.0.0.5:47809.
            ip, port = spec.split(":")
            net = ipaddress.ip_network(ip)
            hosts = [f"{net.network_address}:{int(port)}"]
        else:
            hosts, net = parse_target(spec)
    except Exception as e:
        return {"status": "error", "error": f"Ugyldig subnet/IP-range: {e}"}
    if body.mode == "bbmd" and (hosts is None or len(hosts) != 1):
        return {"status": "error",
                "error": "BBMD-modus tar én IP: adressen til byggets BBMD, "
                         "som oftest JACE-en eller hovedsentralen."}
    sweep = body.mode == "unicast_sweep" or (body.mode == "auto" and not _is_local(net))
    if sweep and (hosts is None or len(hosts) > MAX_SWEEP_HOSTS):
        return {
            "status": "error",
            "error": f"Rangen er for stor for unicast-sweep ({net.num_addresses} adresser, "
                     f"maks {MAX_SWEEP_HOSTS}). Bruk et mindre subnet.",
        }

    job = _new_job("scan")
    job["found"] = 0

    async def run():
        try:
            job["result"] = await _run_scan(job, body, hosts, net)
            job["status"] = "done"
        except asyncio.CancelledError:
            job["status"] = "cancelled"
            raise
        except COMM_ERRORS as e:
            job["status"] = "error"
            job["error"] = f"{type(e).__name__}: {e}"
        except Exception as e:
            job["status"] = "error"
            job["error"] = f"{type(e).__name__}: {e}"

    job["task"] = asyncio.create_task(run())
    return {"status": "started", "job_id": job["id"]}


class LoadPointsBody(BaseModel):
    address: str
    device_instance: int
    include_all_types: bool = False
    # Prefetching reads devices the user has not asked for yet, so it yields
    # to any load they are actually waiting for.
    background: bool = False


class PollBody(BaseModel):
    # {"10.42.12.10": ["analog-input,10000", ...], ...}
    targets: Dict[str, List[str]]


class DetailBody(BaseModel):
    address: str
    objid: str


class WriteBody(BaseModel):
    address: str
    objid: str
    value: Optional[Any] = None
    prop: str = "present-value"
    priority: Optional[int] = None
    release: bool = False
    # Minutes after which the written priority is released again. Overriding
    # a point during commissioning and then being called away is how plants
    # get left in a forced state; this makes the override self-cancelling.
    auto_release_min: Optional[float] = None


class ReadOnlyBody(BaseModel):
    enabled: bool


# Every write and release is recorded so it can be handed over with the
# commissioning report - and so "who forced this?" has an answer.
#
# That promise only holds if the record outlives the process. This ran as a
# plain list for a while, which meant a colleague restarting the shared
# service erased the evidence of what had been done to a plant that day.
# It is now appended to a file as each write happens, one JSON object per
# line: an append cannot corrupt what is already there, and a half-written
# last line loses one entry rather than the whole log.
WRITE_LOG: List[Dict[str, Any]] = []
MAX_WRITE_LOG = 500
WRITE_LOG_FILE = DATA_DIR / "writelog.jsonl"
# Roughly a year of heavy use before rotation; the file is a few hundred
# bytes per entry.
MAX_WRITE_LOG_FILE = 20000
# Pending auto-releases keyed by "ip|objid|priority" so a newer write to the
# same slot supersedes an older timer instead of both firing.
#
# Written to disk as well as held in memory. The whole point of an auto-release
# is that a plant does not stay commanded because someone forgot - and a timer
# that only exists in one process breaks that promise twice over: the service
# restarts and the release is gone, or the VPN drops at the moment it fires and
# the old code simply returned, silently, leaving the point forced with nothing
# in the log to say so.
_release_tasks: Dict[str, asyncio.Task] = {}
RELEASE_FILE = DATA_DIR / "pending-releases.json"
# How long to keep trying when the plant is unreachable at release time. The
# link on a site VPN comes and goes in bursts, so giving up on the first miss
# is giving up far too early.
RELEASE_RETRY_SECONDS = 30
RELEASE_MAX_WAIT = 6 * 3600


def _load_pending() -> Dict[str, Any]:
    if not RELEASE_FILE.exists():
        return {}
    try:
        d = json.loads(RELEASE_FILE.read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _save_pending(data: Dict[str, Any]) -> None:
    try:
        tmp = RELEASE_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp, RELEASE_FILE)
    except OSError as e:
        print(f"ADVARSEL: kunne ikke lagre ventende frigivelser: {e}")


def _pending_add(key: str, entry: Dict[str, Any]) -> None:
    d = _load_pending()
    d[key] = entry
    _save_pending(d)


def _pending_remove(key: str) -> None:
    d = _load_pending()
    if d.pop(key, None) is not None:
        _save_pending(d)


def _load_write_log() -> None:
    """Read the log back at start-up so the UI shows history, not a blank slate."""
    if not WRITE_LOG_FILE.exists():
        return
    lines = []
    try:
        with WRITE_LOG_FILE.open("r", encoding="utf-8") as fh:
            lines = fh.readlines()[-MAX_WRITE_LOG:]
    except OSError:
        return
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            WRITE_LOG.append(json.loads(line))
        except json.JSONDecodeError:
            # A torn last line from a hard kill - skip it and keep the rest.
            continue


def _rotate_write_log() -> None:
    """Keep the file from growing without bound, without losing the record."""
    try:
        with WRITE_LOG_FILE.open("r", encoding="utf-8") as fh:
            lines = fh.readlines()
        if len(lines) <= MAX_WRITE_LOG_FILE:
            return
        stamp = time.strftime("%Y%m%d-%H%M%S")
        WRITE_LOG_FILE.rename(WRITE_LOG_FILE.with_suffix(f".{stamp}.jsonl"))
    except OSError:
        pass


def log_write(entry: Dict[str, Any]) -> None:
    entry["ts"] = time.time()
    WRITE_LOG.append(entry)
    del WRITE_LOG[:-MAX_WRITE_LOG]
    # Written as it happens rather than on shutdown: the case this exists for
    # is the one where the process does not get to shut down cleanly.
    try:
        with WRITE_LOG_FILE.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + chr(10))
            fh.flush()
            os.fsync(fh.fileno())
    except OSError as e:
        print(f"ADVARSEL: kunne ikke skrive til skriveloggen: {e}")
    _rotate_write_log()


def _require_app():
    if state["app"] is None:
        return None
    return state["app"]


# -------------------------------------------------------------------- jobs
# Loading a large controller can take a while and must be interruptible, so
# it runs as a tracked task the UI can poll and cancel rather than as one
# long blocking request.
JOBS: Dict[str, Dict[str, Any]] = {}
_job_seq = 0


def _new_job(kind: str) -> Dict[str, Any]:
    global _job_seq
    _job_seq += 1
    job = {
        "id": str(_job_seq),
        "kind": kind,
        "status": "running",   # running | done | error | cancelled
        "done": 0, "total": 0, "phase": "", "found": 0,
        "result": None, "error": None,
        "task": None,
        "started": time.time(),
    }
    JOBS[job["id"]] = job
    # Keep the table from growing without bound over a long session.
    if len(JOBS) > 40:
        for jid, j in sorted(JOBS.items(), key=lambda kv: kv[1]["started"])[:10]:
            if j["status"] != "running":
                JOBS.pop(jid, None)
    return job


def _sorted_devices(found: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Same order the finished scan returns, so the list does not reshuffle
    itself the moment the scan completes."""
    return sorted(found.values(),
                  key=lambda d: (d["device_instance"] is None, d["device_instance"]))


def _job_public(job: Dict[str, Any]) -> Dict[str, Any]:
    out = {k: job[k] for k in ("id", "kind", "status", "done", "total", "phase", "found", "result", "error")}
    # Available a second before the points are, so the wait can show it.
    for k in ("counts", "identity", "devices"):
        if job.get(k):
            out[k] = job[k]
    return out


@app.get("/api/job/{job_id}")
def job_status(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        return {"status": "error", "error": "Ukjent jobb"}
    return _job_public(job)


@app.post("/api/job/{job_id}/cancel")
def job_cancel(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        return {"status": "error", "error": "Ukjent jobb"}
    t = job.get("task")
    if t and not t.done():
        t.cancel()
    job["status"] = "cancelled"
    return _job_public(job)


# Reads the user is waiting for take precedence over background prefetching.
# Everything shares one BACnet socket and, more to the point, the controllers
# themselves are the bottleneck - a foreground load of a 1300-point device
# reached its first rows in 2.9 s alone but 13.3 s with three background reads
# running. Rather than cancelling that background work and throwing it away,
# it parks between requests and picks up where it left off.
_FOREGROUND = 0


def _gate_for(job):
    async def gate():
        while job.get("background") and _FOREGROUND > 0:
            await asyncio.sleep(0.15)
    return gate


# How often a running load may push what it has to the UI. Each publish costs
# the browser a full table render, so this trades a little work for the table
# appearing seconds earlier. The first couple go out quickly - getting
# something on screen is what the wait feels like - then it backs off.
IDENTITY_PROPS = ["model-name", "firmware-revision",
                  "application-software-version", "location", "description",
                  "local-date", "local-time"]


_bacnet_datetime = bc.bacnet_datetime


CLOCK_DRIFT_WARN_SECONDS = 120


def _type_counts(objids) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for o in objids:
        t = o.split(",")[0]
        out[t] = out.get(t, 0) + 1
    return out


async def _read_identity(bacnet_app, addr, device_objid) -> Dict[str, Any]:
    """Model, firmware and where it sits - one request, best effort.

    Anything missing is simply left out: plenty of controllers answer only
    some of these, and a half-filled card is still worth more than none."""
    try:
        data = await bc._rpm_chunk(bacnet_app, addr, [device_objid], IDENTITY_PROPS, 4.0)
    except COMM_ERRORS:
        return {}
    vals = (data or {}).get(device_objid) or {}
    out = {}
    for k, v in vals.items():
        if k in ("local-date", "local-time"):
            continue
        sv = bc.serialize(v)
        if sv not in (None, ""):
            out[k] = sv

    # A controller whose clock is wrong runs its schedules at the wrong time
    # and stamps its trend logs with fiction. It costs nothing to check here,
    # since the date and time ride along in the request we already send.
    dev_now = _bacnet_datetime(vals.get("local-date"), vals.get("local-time"))
    if dev_now is not None:
        drift = (dev_now - datetime.datetime.now()).total_seconds()
        out["device-time"] = dev_now.isoformat(timespec="seconds")
        out["clock-drift"] = round(drift)
    return out


PARTIAL_PUBLISH_FIRST = 0.5
PARTIAL_PUBLISH_SECONDS = 1.5
PARTIAL_PUBLISH_EAGER = 2


async def _load_points(job, bacnet_app, body: "LoadPointsBody"):
    addr = device_address(body.address)
    device_objid = f"device,{body.device_instance}"

    def list_progress(done, total):
        job["done"] = min(done, total)
        job["total"] = total
        job["phase"] = "objektliste"

    gate = _gate_for(job)
    objids = await bc.read_object_list(
        bacnet_app, addr, device_objid, progress=list_progress, gate=gate)
    if not objids:
        raise RuntimeError(
            "Enheten svarte ikke på objektlisten. Prøv igjen - over VPN "
            "hender det at svaret går tapt.")
    job["phase"] = "punkter"

    # The object list already says what kind of controller this is, a second
    # before any point value arrives. Publishing it here means the wait shows
    # something true about the device instead of only a bar. The identity read
    # is one extra request and stays useful in the inspector afterwards.
    job["counts"] = _type_counts(objids)
    job["identity"] = await _read_identity(bacnet_app, addr, device_objid)

    # A schedule is a point: it has a present-value, it says what the plant is
    # doing, and an operator looking for "when does 360.003 run" expects to
    # find it in the list rather than behind a display toggle. Trend logs,
    # programs and the device object stay behind the toggle - there are 502 of
    # the first on this controller alone, and they would bury the list.
    SYNLIG = bc.VALUE_TYPES | {"schedule"}
    wanted = objids if body.include_all_types else [
        o for o in objids if o.split(",")[0] in SYNLIG
    ]
    # Reset the counter before the new total, never after: a status poll that
    # landed between the two saw the previous phase's count against the new
    # total and reported well over 100%.
    job["done"] = 0
    job["total"] = len(wanted)

    # One cheap probe decides the strategy for the whole load instead of
    # every batch failing its way to the same conclusion.
    caps = await bc.probe_capabilities(bacnet_app, addr, wanted)

    type_counts = _type_counts(objids)

    # Publish what has arrived every so often, so the table fills in while the
    # read runs instead of after it. On a 1300-point controller the read takes
    # several seconds, and a blank progress bar for that long is what makes a
    # tool feel unusable. Rate-limited because each publish costs the browser
    # a full table render.
    raw: Dict[str, Dict[str, Any]] = {}
    last_publish = [time.monotonic()]
    publishes = [0]

    def publish_partial():
        got = [o for o in wanted if o in raw]
        if not got:
            return
        publishes[0] += 1
        job["result"] = {
            "status": "done", "partial": True,
            "address": body.address, "device_instance": body.device_instance,
            "total_objects": len(objids), "type_counts": type_counts,
            "count": len(got), "unread": 0, "rpm": caps.get("rpm"),
            "identity": job.get("identity") or {},
            "points": [bc.shape_point(o, raw[o]) for o in got],
        }

    def on_progress(done, total):
        job["done"] = done
        job["total"] = total
        now = time.monotonic()
        gap = (PARTIAL_PUBLISH_FIRST if publishes[0] < PARTIAL_PUBLISH_EAGER
               else PARTIAL_PUBLISH_SECONDS)
        if now - last_publish[0] >= gap:
            last_publish[0] = now
            publish_partial()

    await bc.read_objects_bulk(bacnet_app, addr, wanted, progress=on_progress,
                               out=raw, gate=gate)
    points = [bc.shape_point(o, raw.get(o, {})) for o in wanted]

    def _points_result(partial: bool) -> Dict[str, Any]:
        # A point we never got an answer for is not the same as one that has
        # no value; flag it so the UI can say so instead of showing a blank.
        for pt in points:
            if pt["objid"] not in raw:
                pt["unread"] = True
        return {
            "status": "done",
            "partial": partial,
            "address": body.address,
            "device_instance": body.device_instance,
            "total_objects": len(objids),
            "type_counts": type_counts,
            "count": len(points),
            "unread": sum(1 for pt in points if pt.get("unread")),
            "rpm": caps.get("rpm"),
            "identity": job.get("identity") or {},
            "points": points,
        }

    # Descriptions and status flags are read in a second pass so the table can
    # be on screen while they arrive; asking for them up front doubled the
    # time before anything was visible.
    #
    # The second pass only pays off if the caller can actually use the first
    # one, so the points are published on the job now, while it keeps
    # running. The UI renders this immediately and swaps in the completed
    # set when the descriptions land. Before this, the job returned nothing
    # until all three passes were finished and the whole point of splitting
    # them was lost.
    job["result"] = _points_result(partial=True)
    job["done"] = 0
    job["total"] = len(wanted)
    job["phase"] = "beskrivelser"

    def extra_progress(done, total):
        job["done"] = done

    extra = await bc.read_objects_bulk(
        bacnet_app, addr, wanted, props=tuple(bc.EXTRA_PROPS),
        progress=extra_progress, gate=gate)

    # State texts belong with the point, not behind a click. A multi-state
    # value reading "3" means nothing on its own; "3 = Hoy hastighet" is the
    # answer. They are read here, in the pass that already runs after the
    # table is on screen, and only for the objects that can have them - so
    # they cost nothing the user waits for, and they end up in the exports
    # the same way YABE lists them.
    by_id = {p["objid"]: p for p in points}
    ms = [o for o in wanted if o.split(",")[0] in bc.MULTISTATE_TYPES]
    if ms:
        job["phase"] = "tilstandstekster"
        job["done"] = 0
        job["total"] = len(ms)

        def st_progress(done, total):
            job["done"] = done

        try:
            st = await bc.read_objects_bulk(
                bacnet_app, addr, ms, props=("state-text",),
                progress=st_progress, gate=gate)
        except COMM_ERRORS:
            st = {}
        for oid, vals in st.items():
            pt = by_id.get(oid)
            if pt is None:
                continue
            tekster = bc.serialize(vals.get("state-text"))
            if isinstance(tekster, list) and tekster:
                pt["state_text"] = [str(x) for x in tekster]

    # A binary point carries its labels as inactive-text/active-text rather
    # than a state-text array, and those are state texts too - both YABE and
    # Beckhoff put them in the same companion file, where they make up the
    # bulk of the references (on one site, 2004 of 2031). Leaving them out
    # meant our EDE said nothing about what "active" means on an alarm point.
    bins = [o for o in wanted if o.split(",")[0] in bc.BINARY_TYPES]
    if bins:
        job["phase"] = "av/pa-tekster"
        job["done"] = 0
        job["total"] = len(bins)

        def bt_progress(done, total):
            job["done"] = done

        try:
            bt = await bc.read_objects_bulk(
                bacnet_app, addr, bins, props=("inactive-text", "active-text"),
                progress=bt_progress, gate=gate)
        except COMM_ERRORS:
            bt = {}
        for oid, vals in bt.items():
            pt = by_id.get(oid)
            if pt is None:
                continue
            av = bc.serialize(vals.get("inactive-text"))
            paa = bc.serialize(vals.get("active-text"))
            # Only when the device actually named them; "inactive"/"active"
            # invented by us would be noise in the export.
            if isinstance(av, str) and isinstance(paa, str) and (av or paa):
                pt["state_text"] = [av, paa]
    # A schedule row showing "1" says nothing. What a technician needs is what
    # it is on right now and when that changes, and both come out of the weekly
    # schedule - so it is read here, in the same background pass, for the
    # handful of schedule objects a controller has.
    sched = [o for o in wanted if o.split(",")[0] == "schedule"]
    if sched:
        job["phase"] = "ukeprogram"
        job["done"] = 0
        job["total"] = len(sched)
        for i, oid in enumerate(sched):
            pt = by_id.get(oid)
            if pt is None:
                continue
            try:
                ws = await asyncio.wait_for(
                    bacnet_app.read_property(addr, oid, "weekly-schedule"),
                    timeout=8.0)
                pt["weekly"] = bc.decode_weekly_schedule(ws)
            except COMM_ERRORS:
                pt["weekly"] = []
            job["done"] = i + 1

    for oid, vals in extra.items():
        pt = by_id.get(oid)
        if not pt:
            continue
        pt["description"] = bc.serialize(vals.get("description"))
        pt["status"] = bc.status_flags_to_list(vals.get("status-flags"))

    return _points_result(partial=False)


@app.post("/api/device/points")
async def device_points(body: LoadPointsBody):
    """Start the load as a job; the UI polls /api/job/{id} for progress."""
    bacnet_app = _require_app()
    if bacnet_app is None:
        return {"status": "error", "error": "Proxy er ikke startet."}

    job = _new_job("points")
    job["background"] = bool(body.background)

    async def run():
        global _FOREGROUND
        if not job["background"]:
            _FOREGROUND += 1
        try:
            job["result"] = await _load_points(job, bacnet_app, body)
            job["status"] = "done"
        except asyncio.CancelledError:
            job["status"] = "cancelled"
            raise
        except COMM_ERRORS as e:
            job["status"] = "error"
            job["error"] = f"{type(e).__name__}: {e}"
        finally:
            # Promotion (below) can flip this mid-flight, so the job carries
            # its own flag for whether it is currently counted.
            if not job["background"] and job.get("counted", True):
                _FOREGROUND = max(0, _FOREGROUND - 1)

    job["counted"] = not job["background"]
    job["task"] = asyncio.create_task(run())
    return {"status": "started", "job_id": job["id"]}


@app.post("/api/job/{job_id}/promote")
def job_promote(job_id: str):
    """Turn a background read into a foreground one.

    Clicking the device the prefetch happens to be reading adopts that job
    rather than starting a second read of the same controller - but it then
    has to stop yielding to other foreground work, and start holding others
    back itself."""
    global _FOREGROUND
    job = JOBS.get(job_id)
    if not job:
        return {"status": "error", "error": "Ukjent jobb"}
    if job.get("background"):
        job["background"] = False
        if job["status"] == "running":
            job["counted"] = True
            _FOREGROUND += 1
        else:
            job["counted"] = False
    return {"status": "done"}


@app.post("/api/poll")
async def poll(body: PollBody):
    bacnet_app = _require_app()
    if bacnet_app is None:
        return {"status": "error", "error": "Proxy er ikke startet."}

    out: Dict[str, Dict[str, Any]] = {}

    async def one_device(ip: str, objids: List[str]):
        addr = device_address(ip)
        fra_cov, les = _cov_del(bacnet_app, ip, objids)
        try:
            out[ip] = await bc.poll_values(bacnet_app, addr, les) if les else {}
        except COMM_ERRORS:
            out[ip] = {}
        out[ip].update(fra_cov)

    await asyncio.gather(*[one_device(ip, oids) for ip, oids in body.targets.items() if oids])
    return {"status": "done", "ts": time.time(), "values": out,
            "cov": sum(1 for c in COV.values() if c.get("ok"))}


@app.post("/api/object/detail")
async def object_detail(body: DetailBody):
    bacnet_app = _require_app()
    if bacnet_app is None:
        return {"status": "error", "error": "Proxy er ikke startet."}
    addr = device_address(body.address)
    try:
        props = await bc.read_object_detail(bacnet_app, addr, body.objid)
    except COMM_ERRORS as e:
        return {"status": "error", "error": str(e)}
    return {"status": "done", "objid": body.objid, "properties": props}


async def _auto_release(addr: Address, objid: str, prop: str,
                        priority: int, delay_s: float, ip: str,
                        key: Optional[str] = None) -> None:
    """Release a commanded priority again after `delay_s`.

    Keeps trying if the plant is unreachable when the time comes. The previous
    version returned as soon as the proxy was disconnected, which on these
    links is a normal event - and it left the point commanded with no record
    that the release had been skipped.
    """
    key = key or f"{ip}|{objid}|{priority}"
    try:
        if delay_s > 0:
            await asyncio.sleep(delay_s)
    except asyncio.CancelledError:
        return

    frist = time.time() + RELEASE_MAX_WAIT
    forsok = 0
    while True:
        bacnet_app = state["app"]
        if bacnet_app is not None:
            try:
                result = await bc.write_value(
                    bacnet_app, addr, objid, None, prop=prop, priority=priority
                )
            except COMM_ERRORS as e:
                result = {"status": "error", "error": f"{type(e).__name__}: {e}"}
            if result.get("status") == "done":
                _pending_remove(key)
                log_write({
                    "address": ip, "objid": objid, "prop": prop, "priority": priority,
                    "action": "auto-release", "value": None,
                    "status": "done", "error": None,
                    "attempts": forsok + 1,
                })
                return
        forsok += 1
        if time.time() > frist:
            # Recorded rather than dropped: someone has to be able to see that
            # this point may still be commanded.
            _pending_remove(key)
            log_write({
                "address": ip, "objid": objid, "prop": prop, "priority": priority,
                "action": "auto-release", "value": None, "status": "error",
                "error": f"Ga opp etter {forsok} forsok over "
                         f"{RELEASE_MAX_WAIT // 3600} timer - punktet kan fortsatt vaere tvunget",
                "attempts": forsok,
            })
            print(f"ADVARSEL: klarte ikke frigi {ip} {objid} @pri {priority}")
            return
        try:
            await asyncio.sleep(RELEASE_RETRY_SECONDS)
        except asyncio.CancelledError:
            return


async def _restore_pending_releases() -> None:
    """Pick up timers that were running when the service last stopped.

    Anything already overdue is released as soon as the proxy is up; the rest
    keeps the time it had left.
    """
    d = _load_pending()
    if not d:
        return
    naa = time.time()
    for key, e in list(d.items()):
        try:
            igjen = max(0.0, float(e["due_ts"]) - naa)
            addr = device_address(e['address'])
            _release_tasks[key] = asyncio.create_task(
                _auto_release(addr, e["objid"], e.get("prop", "present-value"),
                              int(e["priority"]), igjen, e["address"], key)
            )
        except (KeyError, ValueError, TypeError):
            _pending_remove(key)
    print(f"Gjenopptok {len(d)} ventende frigivelse(r) etter omstart")


@app.get("/api/readonly")
def get_readonly():
    return {"enabled": state["read_only"]}


@app.post("/api/readonly")
def set_readonly(body: ReadOnlyBody):
    state["read_only"] = bool(body.enabled)
    return {"enabled": state["read_only"]}


_load_write_log()


@app.get("/api/writelog")
def get_writelog():
    return {"status": "done", "entries": list(reversed(WRITE_LOG))}


def mine_overstyringer() -> List[Dict[str, Any]]:
    """
    What this NABE has written and not handed back: the last word in the
    write log for each point and priority, where that word was a write.
    A release or an auto-release cancels it. This is the list that has to be
    empty before you leave a plant.
    """
    aktive: Dict[tuple, Dict[str, Any]] = {}
    for e in WRITE_LOG:
        if e.get("prop", "present-value") != "present-value" or e.get("priority") is None:
            continue
        if e.get("status") != "done":
            continue
        k = (e.get("address"), e.get("objid"), e.get("priority"))
        if e.get("action") == "write":
            aktive[k] = e
        elif e.get("action") in ("release", "auto-release"):
            aktive.pop(k, None)
    return [{"address": k[0], "objid": k[1], "priority": k[2], "value": e.get("value"),
             "ts": e.get("ts")} for k, e in aktive.items()]


@app.get("/api/mine")
def get_mine():
    return {"status": "done", "overstyrt": mine_overstyringer()}


NY_VERSJON: Dict[str, Any] = {"t": 0.0, "versjon": None}


@app.get("/api/ny-versjon")
async def ny_versjon():
    """The version on GitHub, checked at most once an hour. Never blocks:
    without internet the answer is simply that nothing is known."""
    if time.time() - NY_VERSJON["t"] > 3600:
        NY_VERSJON["t"] = time.time()

        def hent():
            import re as _re
            url = "https://raw.githubusercontent.com/beepbop420/bacnet-explorer/main/server.py"
            with urllib.request.urlopen(url, timeout=4) as r:
                m = _re.search(r'VERSJON = "([^"]+)"', r.read(200000).decode("utf-8", "replace"))
                return m.group(1) if m else None
        try:
            NY_VERSJON["versjon"] = await asyncio.get_event_loop().run_in_executor(None, hent)
        except Exception:
            NY_VERSJON["versjon"] = None
    return {"status": "done", "her": VERSJON, "github": NY_VERSJON["versjon"]}


class SchedBody(BaseModel):
    address: str
    device_instance: int


class TrendBody(BaseModel):
    address: str
    objid: str
    limit: int = 500


@app.post("/api/device/schedules")
async def device_schedules(body: SchedBody):
    bacnet_app = _require_app()
    if bacnet_app is None:
        return {"status": "error", "error": "Proxy er ikke startet."}
    addr = device_address(body.address)
    try:
        objids = await bc.read_object_list(
            bacnet_app, addr, f"device,{body.device_instance}")
    except COMM_ERRORS as e:
        return {"status": "error", "error": str(e)}

    sched = [o for o in objids if o.startswith("schedule,")]
    trends = [o for o in objids if o.startswith("trend-log")]
    if not sched:
        return {"status": "done", "schedules": [], "trend_logs": trends}
    items = await bc.read_schedules(bacnet_app, addr, sched)
    return {"status": "done", "schedules": items, "trend_logs": trends}


@app.post("/api/object/trendlog")
async def object_trendlog(body: TrendBody):
    bacnet_app = _require_app()
    if bacnet_app is None:
        return {"status": "error", "error": "Proxy er ikke startet."}
    addr = device_address(body.address)
    try:
        data = await bc.read_trend_log(bacnet_app, addr, body.objid, limit=body.limit)
    except COMM_ERRORS as e:
        return {"status": "error", "error": str(e)}
    return {"status": "done", **data}


class SchedWriteBody(BaseModel):
    address: str
    objid: str
    dager: List[List[Dict[str, Any]]]


@app.post("/api/schedule/write")
async def schedule_write(body: SchedWriteBody):
    """Write a whole weekly schedule back to the controller."""
    if state["read_only"]:
        return {"status": "error", "error": "Lesemodus er pa - skriving er blokkert."}
    bacnet_app = _require_app()
    if bacnet_app is None:
        return {"status": "error", "error": "Proxy er ikke startet."}
    addr = device_address(body.address)
    try:
        res = await bc.write_weekly_schedule(bacnet_app, addr, body.objid, body.dager)
    except COMM_ERRORS as e:
        res = {"status": "error", "error": f"{type(e).__name__}: {e}"}

    # A schedule write changes when plant runs for the rest of the week. It
    # belongs in the same log as every other write, with enough detail to see
    # afterwards what was actually sent.
    log_write({
        "address": body.address, "objid": body.objid, "prop": "weekly-schedule",
        "priority": None, "action": "schedule-write",
        "value": f"{res.get('skift', 0)} skift over 7 dager",
        "status": res.get("status"), "error": res.get("error"),
    })
    return res


class ClockBody(BaseModel):
    address: str


class ForcedBody(BaseModel):
    address: str
    objids: List[str]


@app.post("/api/points/forced")
async def points_forced(body: ForcedBody):
    """
    Which priority is holding each of these points, and at what value.

    "Overridden" tells you a point is not following its own logic. It does not
    tell you who took it, and that is the question on a commissioning job -
    priority 8 is a person with a keyboard, 16 is a program. Read on demand for
    a handful of points rather than for every point on every load: a
    priority-array is sixteen values per object.
    """
    bacnet_app = _require_app()
    if bacnet_app is None:
        return {"status": "error", "error": "Proxy er ikke startet."}
    if not body.objids:
        return {"status": "done", "forced": {}}
    addr = device_address(body.address)
    try:
        vals = await bc.read_objects_bulk(
            bacnet_app, addr, body.objids[:400], props=("priority-array",))
    except COMM_ERRORS as e:
        return {"status": "error", "error": f"{type(e).__name__}: {e}"}

    ut = {}
    for oid, v in vals.items():
        raa = v.get("priority-array")
        if raa is None or bc.is_error(raa):
            # The object answered, but not about this: an input has no
            # priority array at all.
            ut[oid] = {"pri": None, "grunn": "ingen prioritetstabell"}
            continue
        arr = bc.serialize_priority_array(raa)
        # Highest slot with something in it is the one in control.
        traff = next(((i + 1, x) for i, x in enumerate(arr) if x is not None), None)
        if traff:
            ut[oid] = {"pri": traff[0], "verdi": traff[1]}
        else:
            # Every slot empty, yet the device flags it overridden. In BACnet
            # that is the local override: a hand switch on the module or the
            # controller's own out-of-service handling. No amount of releasing
            # priorities will clear it, and saying so saves a wasted trip.
            ut[oid] = {"pri": None, "grunn": "lokal overstyring pa enheten"}
    for oid in body.objids:
        # Anything the device never answered for is reported as such rather
        # than quietly left out, or it reads as "nothing is holding it".
        if oid not in ut and oid in body.objids[:400]:
            ut[oid] = {"pri": None, "grunn": "enheten svarte ikke"}
    return {"status": "done", "forced": ut}


@app.post("/api/device/clock")
async def device_clock(body: ClockBody):
    """Set one controller's clock from this PC."""
    if state["read_only"]:
        return {"status": "error", "error": "Lesemodus er pa - skriving er blokkert."}
    bacnet_app = _require_app()
    if bacnet_app is None:
        return {"status": "error", "error": "Proxy er ikke startet."}
    addr = device_address(body.address)
    try:
        res = await bc.sync_clock(bacnet_app, addr)
    except COMM_ERRORS as e:
        res = {"status": "error", "error": f"{type(e).__name__}: {e}"}

    # A clock change moves every schedule and every trend timestamp on the
    # device, so it belongs in the same log as any other write.
    log_write({
        "address": body.address, "objid": f"device,{res.get('device_instance', '?')}",
        "prop": "local-date/local-time", "priority": None, "action": "clock-sync",
        "value": res.get("sendt"),
        "status": res.get("status"),
        "error": res.get("error") or res.get("advarsel"),
    })
    return res


@app.post("/api/write")
async def write(body: WriteBody):
    bacnet_app = _require_app()
    if bacnet_app is None:
        return {"status": "error", "error": "Proxy er ikke startet."}
    if state["read_only"]:
        return {"status": "error", "error": "Lesemodus er på - skriving er blokkert."}

    addr = device_address(body.address)
    value = None if body.release else body.value
    if not body.release and value is None:
        return {"status": "error", "error": "Ingen verdi angitt."}

    # Read the value back first so the log (and the UI's confirmation) records
    # what the point actually stood at before it was touched.
    before = None
    try:
        before = bc.serialize(await asyncio.wait_for(
            bacnet_app.read_property(addr, body.objid, body.prop), timeout=5
        ))
    except COMM_ERRORS:
        pass

    result = await bc.write_value(
        bacnet_app, addr, body.objid, value,
        prop=body.prop, priority=body.priority,
    )

    key = f"{body.address}|{body.objid}|{body.priority}"
    existing = _release_tasks.pop(key, None)
    if existing and not existing.done():
        existing.cancel()
    # A new write or a manual release supersedes whatever was owed on this
    # slot, so the stored timer goes too.
    _pending_remove(key)

    scheduled = None
    if (
        result.get("status") == "done"
        and not body.release
        and body.priority is not None
        and body.auto_release_min
        and body.auto_release_min > 0
    ):
        delay = float(body.auto_release_min) * 60.0
        # Persisted before the task starts: if the process dies a second later
        # the release is still owed, and start-up will pick it up.
        _pending_add(key, {
            "address": body.address, "objid": body.objid, "prop": body.prop,
            "priority": body.priority, "due_ts": time.time() + delay,
        })
        _release_tasks[key] = asyncio.create_task(
            _auto_release(addr, body.objid, body.prop, body.priority,
                          delay, body.address, key)
        )
        scheduled = body.auto_release_min

    log_write({
        "address": body.address, "objid": body.objid, "prop": body.prop,
        "priority": body.priority,
        "action": "release" if body.release else "write",
        "before": before, "value": value,
        "auto_release_min": scheduled,
        "status": result.get("status"), "error": result.get("error"),
    })

    result["before"] = before
    result["auto_release_min"] = scheduled
    return result


# ---------------------------------------------------------------- projects
# A site is saved as one JSON file so a visit can be reopened later and
# compared against how the plant looked last time.
# ---------------------------------------------------------------- notes
# Notes on a controller outlive the session they were written in, which is the
# whole point: you find something at ten and write the report at four. Kept on
# the server rather than in the browser so they survive a cleared cache and a
# new laptop, and so a colleague opening the same instance sees them.
#
# Rewritten whole on each save via a temp file and an atomic replace - notes
# are edited rather than appended, so a half-written file would lose the lot.
# ---------------------------------------------------------------- sites
# What was scanned, where, and what answered.
#
# Coming back to a building a month later, the question is always the same:
# what was the range here, and what did I find. That answer lived in the
# technician's head or in a text file, and the tool started every visit blank.
# It is kept on disk rather than in the browser so it survives a cleared cache
# and follows the shared server if the tool is run from one.
SITES_FILE = DATA_DIR / "sites.json"
SITES: Dict[str, Any] = {}
SITES_MAX = 200


def _load_sites() -> None:
    if not SITES_FILE.exists():
        return
    try:
        data = json.loads(SITES_FILE.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            SITES.update(data)
    except (OSError, json.JSONDecodeError) as e:
        print(f"ADVARSEL: kunne ikke lese anleggsminnet: {e}")


def _save_sites() -> bool:
    tmp = SITES_FILE.with_suffix(".tmp")
    try:
        tmp.write_text(json.dumps(SITES, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp, SITES_FILE)
        return True
    except OSError as e:
        print(f"ADVARSEL: kunne ikke lagre anleggsminnet: {e}")
        return False


class SiteBody(BaseModel):
    ranges: List[str]
    devices: List[Dict[str, Any]] = []
    local_address: Optional[str] = None
    name: Optional[str] = None
    # A building reached through its BBMD has to be scanned that way again;
    # swept as an address it is one controller instead of the whole site.
    mode: Optional[str] = None
    # The tag generator's settings belong to the building, not to the PC: it is
    # the same prefix and cluster every time you come back to it.
    tagging: Optional[Dict[str, Any]] = None


def _site_key(ranges: List[str]) -> str:
    return " ".join(sorted(r.strip() for r in ranges if r.strip()))


@app.get("/api/sites")
async def sites_list():
    return {"status": "done", "sites": SITES}


@app.post("/api/sites")
async def sites_record(body: SiteBody):
    """Remember a scan: which ranges, what answered, and when."""
    key = _site_key(body.ranges)
    if not key:
        return {"status": "error", "error": "Ingen omrader oppgitt"}

    naa = time.time()
    site = SITES.get(key) or {"forste": naa, "ganger": 0, "navn": ""}
    site["ranges"] = [r.strip() for r in body.ranges if r.strip()]
    site["sist"] = naa
    site["ganger"] = int(site.get("ganger", 0)) + 1
    if body.local_address:
        site["lokal"] = body.local_address
    if body.name is not None:
        site["navn"] = body.name
    if body.mode:
        site["modus"] = body.mode
    if body.tagging is not None:
        site["tagging"] = body.tagging

    # Only the fields that identify a controller - a whole point list belongs
    # in a project, not in a list you skim to remember where you were.
    site["enheter"] = [
        {k: d.get(k) for k in ("address", "device_instance", "object_name", "vendor")}
        for d in (body.devices or [])[:400]
    ]
    SITES[key] = site

    if len(SITES) > SITES_MAX:
        eldst = sorted(SITES.items(), key=lambda kv: kv[1].get("sist", 0))
        for k, _ in eldst[:len(SITES) - SITES_MAX]:
            SITES.pop(k, None)

    _save_sites()
    return {"status": "done", "key": key, "site": site}


class SiteNameBody(BaseModel):
    key: str
    name: str


class TaggingBody(BaseModel):
    key: str
    tagging: Dict[str, Any]


@app.post("/api/sites/tagging")
async def sites_tagging(body: TaggingBody):
    """Store the tag generator's settings against a site."""
    site = SITES.get(body.key)
    if not site:
        # A site you have not scanned in this session is still a site you may
        # want to prepare settings for.
        site = {"forste": time.time(), "sist": time.time(), "ganger": 0,
                "navn": "", "ranges": body.key.split(), "enheter": []}
        SITES[body.key] = site
    site["tagging"] = body.tagging
    _save_sites()
    return {"status": "done", "site": site}


@app.post("/api/sites/name")
async def sites_name(body: SiteNameBody):
    site = SITES.get(body.key)
    if not site:
        return {"status": "error", "error": "Ukjent anlegg"}
    site["navn"] = body.name.strip()[:80]
    _save_sites()
    return {"status": "done", "site": site}


class SiteKeyBody(BaseModel):
    key: str


@app.post("/api/sites/delete")
async def sites_delete(body: SiteKeyBody):
    if SITES.pop(body.key, None) is None:
        return {"status": "error", "error": "Ukjent anlegg"}
    _save_sites()
    return {"status": "done"}


NOTES_FILE = DATA_DIR / "notes.json"
NOTES: Dict[str, Dict[str, Any]] = {}


def _load_notes() -> None:
    if not NOTES_FILE.exists():
        return
    try:
        data = json.loads(NOTES_FILE.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            NOTES.update(data)
    except (OSError, json.JSONDecodeError) as e:
        print(f"ADVARSEL: kunne ikke lese notater: {e}")


def _save_notes() -> bool:
    tmp = NOTES_FILE.with_suffix(".tmp")
    try:
        tmp.write_text(json.dumps(NOTES, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp, NOTES_FILE)
        return True
    except OSError as e:
        print(f"ADVARSEL: kunne ikke lagre notater: {e}")
        return False


# A copy running on a technician's own PC keeps its notes on that PC, which
# would mean two people on the same plant never see each other's. So a local
# copy also talks to the shared instance: it pulls on start-up and pushes on
# every save. Measured from a customer VPN, a shared server on the office
# network answered in 30 ms - split tunnels leave it reachable - but the sync
# is strictly best-effort and never blocks saving locally.
#
# Off unless NABE_NOTES_UPSTREAM is set. Leave it empty on the shared server
# itself so it does not try to sync with itself.
NOTES_UPSTREAM = _env("NOTES_UPSTREAM", "").rstrip("/")
NOTES_SYNC: Dict[str, Any] = {"state": "av", "detail": "", "ts": 0.0, "pending": 0}
# Some public-sector sites close the network completely - no route to
# the office at all. A note written there must not be lost and must not need
# remembering: the key is queued on disk, and the queue is flushed the moment
# the shared server answers again, which is usually when the laptop is back on
# the office network.
NOTES_QUEUE_FILE = DATA_DIR / "notes-queue.json"
NOTES_QUEUE: set = set()
NOTES_FLUSH_SECONDS = 60


def _load_queue() -> None:
    if not NOTES_QUEUE_FILE.exists():
        return
    try:
        data = json.loads(NOTES_QUEUE_FILE.read_text(encoding="utf-8"))
        if isinstance(data, list):
            NOTES_QUEUE.update(str(k) for k in data)
    except (OSError, json.JSONDecodeError):
        pass


def _save_queue() -> None:
    try:
        tmp = NOTES_QUEUE_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(sorted(NOTES_QUEUE)), encoding="utf-8")
        os.replace(tmp, NOTES_QUEUE_FILE)
    except OSError:
        pass


_load_queue()


def _merge_notes(fremmed: Dict[str, Any]) -> int:
    """Newest wins per device. Notes are short and rarely touched by two
    people at once, so a timestamp comparison is honest enough - and far
    better than one side silently overwriting the other."""
    endret = 0
    for key, note in (fremmed or {}).items():
        if not isinstance(note, dict) or "text" not in note:
            continue
        vaar = NOTES.get(key)
        if not vaar or float(note.get("updated", 0)) > float(vaar.get("updated", 0)):
            NOTES[key] = {"text": note["text"], "updated": float(note.get("updated", 0))}
            endret += 1
    return endret


async def _pull_notes() -> None:
    if not NOTES_UPSTREAM:
        return
    try:
        def hent():
            with urllib.request.urlopen(NOTES_UPSTREAM + "/api/notes", timeout=6) as r:
                return json.loads(r.read().decode("utf-8"))
        data = await asyncio.get_event_loop().run_in_executor(None, hent)
        n = _merge_notes(data.get("notes") or {})
        if n:
            _save_notes()
        NOTES_SYNC.update(state="ok", detail=f"hentet {n} fra fellesserveren", ts=time.time())
    except Exception as e:
        NOTES_SYNC.update(state="frakoblet", detail=str(e)[:120], ts=time.time())


async def _push_note(key: str, note: Optional[Dict[str, Any]]) -> bool:
    if not NOTES_UPSTREAM:
        return True
    try:
        payload = json.dumps({"key": key, "text": note["text"] if note else ""}).encode()
        def send():
            req = urllib.request.Request(
                NOTES_UPSTREAM + "/api/notes", payload,
                {"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=6) as r:
                return r.status
        await asyncio.get_event_loop().run_in_executor(None, send)
        NOTES_QUEUE.discard(key)
        _save_queue()
        NOTES_SYNC.update(state="ok", detail="delt med fellesserveren",
                          ts=time.time(), pending=len(NOTES_QUEUE))
        return True
    except Exception as e:
        # The note is already safe on disk; only the sharing failed. Queue it
        # and stop worrying about it - the flush loop will get it through.
        NOTES_QUEUE.add(key)
        _save_queue()
        NOTES_SYNC.update(state="i ko", detail=str(e)[:120],
                          ts=time.time(), pending=len(NOTES_QUEUE))
        return False


async def _flush_queue() -> int:
    """Push everything waiting. Runs on a timer and on demand."""
    if not NOTES_UPSTREAM or not NOTES_QUEUE:
        return 0
    sendt = 0
    for key in list(NOTES_QUEUE):
        if await _push_note(key, NOTES.get(key)):
            sendt += 1
        else:
            break          # upstream is still down; try again next round
    return sendt


async def _flush_loop() -> None:
    while True:
        await asyncio.sleep(NOTES_FLUSH_SECONDS)
        try:
            if NOTES_QUEUE:
                n = await _flush_queue()
                if n:
                    print(f"Notater: {n} delt med fellesserveren etter ventetid")
        except Exception:
            pass


_load_notes()


class NoteBody(BaseModel):
    key: str
    text: str


@app.on_event("startup")
async def _sites_startup():
    _load_sites()


@app.on_event("startup")
async def _releases_startup():
    await _restore_pending_releases()


@app.on_event("startup")
async def _notes_startup():
    # Pulled once at start-up rather than on a timer: notes change a few times
    # a day, and a technician opening the tool is exactly when they need to be
    # current. Anything queued from a closed site goes out in the same breath.
    NOTES_SYNC["pending"] = len(NOTES_QUEUE)
    await _flush_queue()
    await _pull_notes()
    asyncio.create_task(_flush_loop())


@app.get("/api/notes")
def get_notes():
    return {"status": "done", "notes": NOTES, "sync": NOTES_SYNC,
            "upstream": NOTES_UPSTREAM}


@app.post("/api/notes/sync")
async def sync_notes():
    sendt = await _flush_queue()
    await _pull_notes()
    NOTES_SYNC["pending"] = len(NOTES_QUEUE)
    return {"status": "done", "notes": NOTES, "sync": NOTES_SYNC, "sent": sendt}


@app.post("/api/notes")
async def set_note(body: NoteBody):
    key = body.key.strip()
    if not key:
        return {"status": "error", "error": "Mangler nokkel."}
    text = body.text.strip()
    if text:
        NOTES[key] = {"text": text, "updated": time.time()}
    else:
        # Clearing the field deletes the note rather than storing an empty one,
        # so the device stops showing a note marker.
        NOTES.pop(key, None)
    if not _save_notes():
        return {"status": "error", "error": "Kunne ikke skrive notatfilen."}
    # Saved locally first, shared second: the sharing is allowed to fail.
    await _push_note(key, NOTES.get(key))
    return {"status": "done", "notes": NOTES, "sync": NOTES_SYNC}


PROJECT_DIR = DATA_DIR / "projects"


def _safe_name(name: str) -> str:
    """Keep saved files inside PROJECT_DIR regardless of what is typed."""
    cleaned = "".join(c for c in (name or "").strip() if c.isalnum() or c in " _-.")
    cleaned = cleaned.strip(" .") or "uten-navn"
    return cleaned[:80]


class ProjectBody(BaseModel):
    name: str
    data: Dict[str, Any]


@app.get("/api/projects")
def list_projects():
    PROJECT_DIR.mkdir(exist_ok=True)
    out = []
    for f in sorted(PROJECT_DIR.glob("*.json")):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
            out.append({
                "name": f.stem,
                "saved": d.get("saved"),
                "devices": len(d.get("devices") or []),
                "watch": len(d.get("watch") or []),
                "snapshots": len(d.get("snapshots") or []),
            })
        except Exception:
            continue
    return {"status": "done", "projects": out}


@app.post("/api/projects/save")
def save_project(body: ProjectBody):
    PROJECT_DIR.mkdir(exist_ok=True)
    name = _safe_name(body.name)
    path = PROJECT_DIR / f"{name}.json"

    data = dict(body.data or {})
    data["saved"] = time.time()

    # Snapshots accumulate so two visits can be compared; keep the last 10.
    if path.is_file():
        try:
            prev = json.loads(path.read_text(encoding="utf-8"))
            snaps = list(prev.get("snapshots") or [])
        except Exception:
            snaps = []
    else:
        snaps = []
    new_snap = data.pop("snapshot", None)
    if new_snap:
        snaps.append({"ts": data["saved"], "values": new_snap})
    data["snapshots"] = snaps[-10:]

    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return {"status": "done", "name": name, "snapshots": len(data["snapshots"])}


@app.get("/api/projects/{name}")
def load_project(name: str):
    path = PROJECT_DIR / f"{_safe_name(name)}.json"
    if not path.is_file():
        return {"status": "error", "error": "Fant ikke prosjektet"}
    return {"status": "done", "data": json.loads(path.read_text(encoding="utf-8"))}


@app.post("/api/projects/{name}/delete")
def delete_project(name: str):
    path = PROJECT_DIR / f"{_safe_name(name)}.json"
    if path.is_file():
        path.unlink()
    return {"status": "done"}


# The UI is served straight off disk and gets updated in place, so caching it
# only produces confusing half-old sessions after a deploy. These files are a
# few hundred kB on a LAN - not worth the cache.
NO_CACHE = {"Cache-Control": "no-store, must-revalidate"}




class PingBody(BaseModel):
    subnet: str
    timeout_ms: int = 700
    concurrency: int = 60


async def _ping_one(ip: str, timeout_ms: int, sem: asyncio.Semaphore) -> bool:
    """
    One ICMP echo, through the OS ping command.

    Raw ICMP sockets need administrator rights on Windows, and this tool is
    meant to run as whoever is logged in. The OS ping binary already has the
    privilege, so shelling out is the option that works without asking the
    user to elevate anything.
    """
    async with sem:
        if os.name == "nt":
            cmd = ["ping", "-n", "1", "-w", str(timeout_ms), ip]
        else:
            # -W is seconds on Linux, and it will not take a fraction.
            cmd = ["ping", "-c", "1", "-W", str(max(1, timeout_ms // 1000)), ip]
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0,
            )
            # The timeout is ping's own, but a hung process must not hold the
            # sweep - so there is a ceiling on top of it.
            await asyncio.wait_for(proc.wait(), timeout=(timeout_ms / 1000) + 2)
            return proc.returncode == 0
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
            return False



async def _tjenester(ip: str) -> Dict[str, Any]:
    """
    Does anything at all answer on this address?

    Separates the two silences that look the same from a BACnet tool: a VPN
    that lets web and Workbench through but not UDP 47808, and an address
    that this PC simply cannot reach - the plant that is only reachable from
    a remote desktop on the other side of the tunnel.
    """
    porter = {80: "nettside", 443: "nettside (https)", 4911: "Niagara Fox",
              3011: "Niagara Fox", 3389: "fjernskrivebord", 22: "SSH"}
    host = ip.split(":")[0]

    async def prov(p):
        try:
            _, w = await asyncio.wait_for(asyncio.open_connection(host, p), timeout=1.2)
            w.close()
            return p
        except Exception:
            return None
    apne = [p for p in await asyncio.gather(*[prov(p) for p in porter]) if p]
    if not apne:
        return {"status": "feil", "detalj": "Ingenting svarer på denne adressen",
                "forklaring": "Verken nettside, Workbench, fjernskrivebord eller BACnet svarer. "
                              "Da slipper ikke VPN-en deg fram hit. Når du anlegget bare via "
                              "fjernskrivebord til en maskin der ute, må NABE kjøre på den "
                              "maskinen - bruk den portable utgaven."}
    navn = ", ".join(sorted({porter[p] for p in apne}))
    return {"status": "advarsel", "detalj": f"Svarer på {navn}",
            "forklaring": "Adressen nås, men hvis BACnet over ikke svarte, slipper VPN-en "
                          "trolig TCP men ikke UDP 47808. Be den som drifter VPN-en åpne "
                          "UDP 47808 til dette nettet."}


# ------------------------------------------------------------------- alarms
class AlarmBody(BaseModel):
    address: str


@app.post("/api/device/alarms")
async def device_alarms(body: AlarmBody):
    """
    The device's own list of active and unacknowledged events.

    One GetEventInformation request returns every object that is not normal
    or still waiting for an acknowledgement - which is the list a service
    visit starts from - instead of reading status flags off every point.
    Devices that do not implement the service say so, and the page falls back
    to the flags it already has.
    """
    bacnet_app = _require_app()
    if bacnet_app is None:
        return {"status": "error", "error": "Ikke tilkoblet."}
    addr = device_address(body.address)
    ut: List[Dict[str, Any]] = []
    siste = None
    try:
        for _ in range(20):
            req = GetEventInformationRequest(destination=addr)
            if siste is not None:
                req.lastReceivedObjectIdentifier = siste
            ack = await asyncio.wait_for(bacnet_app.request(req), timeout=6)
            for e in ack.listOfEventSummaries or []:
                siste = e.objectIdentifier
                kvitt = e.acknowledgedTransitions
                ukvittert = [n for i, n in enumerate(("til unormal", "til feil", "til normal"))
                             if kvitt is not None and len(kvitt) > i and not kvitt[i]]
                ut.append({
                    "objid": bc.objid_str(e.objectIdentifier),
                    "tilstand": str(e.eventState),
                    "ukvittert": ukvittert,
                    "type": str(e.notifyType),
                })
            if not ack.moreEvents:
                break
    except asyncio.TimeoutError:
        return {"status": "error", "error": "Ingen svar på alarmspørringen."}
    except COMM_ERRORS as e:
        tekst = f"{type(e).__name__}: {e}"
        if "unrecognized" in tekst.lower() or "service" in tekst.lower() or "reject" in tekst.lower():
            return {"status": "unsupported", "error": "Enheten støtter ikke alarmlister."}
        return {"status": "error", "error": tekst}
    return {"status": "done", "alarmer": ut}


# ------------------------------------------------------------------ routers
@app.get("/api/routers")
async def routers():
    """
    Which routers are out there, and which BACnet networks sit behind them.

    On our own subnet one broadcast asks everybody. Over a VPN broadcasts do
    not arrive, so each device already found is asked directly instead -
    routers answer a unicast too.
    """
    bacnet_app = _require_app()
    if bacnet_app is None:
        return {"status": "error", "error": "Ikke tilkoblet."}
    funn: Dict[str, set] = {}

    async def spor(dest):
        try:
            svar = await asyncio.wait_for(
                bacnet_app.nse.who_is_router_to_network(destination=dest), timeout=3)
        except Exception:
            return
        for _adapter, npdu in svar or []:
            nett = getattr(npdu, "iartnNetworkList", None) or []
            funn.setdefault(str(npdu.pduSource), set()).update(int(n) for n in nett)

    lokal = _local_network()
    if lokal is not None and not state.get("bbmd"):
        await spor(None)
    else:
        ips = [d for d in SISTE_ENHETER if _plain_ip(d)][:64]
        await asyncio.gather(*[spor(Address(ip)) for ip in ips])
    return {"status": "done",
            "rutere": [{"ruter": r, "nett": sorted(n)} for r, n in sorted(funn.items()) if n]}


# ---------------------------------------------------------------------- COV
# Live values by subscription where the device allows it. The page keeps
# asking /api/poll as before; behind it, a point that accepted a COV
# subscription is answered from what the device last pushed, and only the
# rest are read over the wire. On a VPN that is most of the traffic gone.
COV: Dict[tuple, Dict[str, Any]] = {}
COV_IKKE_FOR = 600.0          # a refusal is not asked again for ten minutes
COV_STILLE = 90.0             # unpolled this long: the subscription is dropped


def _cov_del(bacnet_app, ip: str, objids: List[str]):
    naa = time.time()
    fra_cov: Dict[str, Any] = {}
    les: List[str] = []
    for oid in objids:
        k = (ip, oid)
        c = COV.get(k)
        if c is None or (not c.get("ok") and naa - c.get("feilet", 0) > COV_IKKE_FOR and not c.get("task")):
            COV[k] = c = {"ok": False, "verdi": None, "sist_spurt": naa}
            c["task"] = asyncio.ensure_future(_cov_lytt(bacnet_app, ip, oid, c))
        c["sist_spurt"] = naa
        if c.get("ok") and c.get("har"):
            fra_cov[oid] = c["verdi"]
        else:
            les.append(oid)
    for k, c in list(COV.items()):
        if naa - c.get("sist_spurt", 0) > COV_STILLE:
            t = c.get("task")
            if t:
                t.cancel()
            COV.pop(k, None)
    return fra_cov, les


async def _cov_lytt(bacnet_app, ip: str, oid: str, c: Dict[str, Any]):
    try:
        async with bacnet_app.change_of_value(
                device_address(ip), oid, issue_confirmed_notifications=False, lifetime=300) as scm:
            c["ok"] = True
            while True:
                prop, verdi = await scm.get_value()
                if str(prop) in ("present-value", "presentValue"):
                    c["verdi"] = bc.serialize(verdi)
                    c["har"] = True
    except asyncio.CancelledError:
        raise
    except Exception:
        c["ok"] = False
        c["feilet"] = time.time()
    finally:
        c["task"] = None


def _cov_stopp_alle() -> None:
    for c in COV.values():
        t = c.get("task")
        if t:
            t.cancel()
    COV.clear()


def _brannmur_sjekk() -> Dict[str, Any]:
    """
    Will Windows let the plant's answers in?

    Replies to what we sent get in on any profile - the firewall keeps state.
    What does not get in is an I-Am a controller sends as a broadcast, which is
    how many answer Who-Is, unless an inbound rule allows it. Windows files an
    unknown plant network as Public, and the rule it offers on first start is
    often ticked for Private only. So the question is: which profile is the
    adapter on, and is there an allow rule for this Python on that profile?
    """
    if os.name != "nt":
        return {"status": "ok", "detalj": "Ikke Windows", "forklaring": "Ingen Windows-brannmur å sjekke."}
    import sys
    lokal = (state.get("local_address") or "").split("/")[0].split(":")[0]
    alias = next((e["interface"] for e in list_interfaces() if e["ip"] == lokal), None)
    exe = getattr(sys, "_base_executable", None) or sys.executable
    ps = (
        "$ErrorActionPreference='SilentlyContinue';"
        f"$kat = if ('{alias or ''}') {{ (Get-NetConnectionProfile -InterfaceAlias '{alias or ''}').NetworkCategory }} else {{ '' }};"
        f"$r = @(Get-NetFirewallApplicationFilter -Program '{exe}' | Get-NetFirewallRule | "
        "Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' } | "
        "ForEach-Object { [string]$_.Profile });"
        "@{kat=[string]$kat; profiler=$r} | ConvertTo-Json -Compress"
    )
    try:
        ut = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True,
                            text=True, timeout=20,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        data = json.loads(ut.stdout.strip() or "{}")
    except Exception as e:
        return {"status": "advarsel", "detalj": "Kunne ikke lese brannmuren", "forklaring": str(e)}
    kat = (data.get("kat") or "").strip()
    profiler = data.get("profiler") or []
    if isinstance(profiler, str):
        profiler = [profiler]
    dekket = any(p == "Any" or (kat and kat in p) for p in profiler)
    kommando = (f'New-NetFirewallRule -DisplayName "NABE BACnet" -Direction Inbound '
                f'-Program "{exe}" -Protocol UDP -LocalPort {BACNET_PORT} -Action Allow -Profile Any')
    if dekket:
        return {"status": "ok", "detalj": f"Tillatt på {kat or 'nettet'}",
                "forklaring": "Svar som kommer som kringkasting slipper inn."}
    return {"status": "advarsel",
            "detalj": f"{alias or 'Kortet'} er {kat or 'ukjent'}, og Python har ingen regel der",
            "forklaring": "Direkte svar slipper inn, men I-Am som kringkastes stoppes - "
                          "Who-Is kan da gå glipp av enheter, mens sweep virker. "
                          "Kjør dette i PowerShell som administrator for å åpne: " + kommando,
            "kommando": kommando}


class DiagnoseBody(BaseModel):
    address: str
    step: str
    timeout_ms: int = 1500


# --------------------------------------------------------------- diagnostics
# One step per call rather than one call that does everything. The steps take
# very different amounts of time - the port check is instant, a BACnet read
# against a silent address takes the full timeout - and a technician standing
# in a plant room wants to see the fast answers immediately, not stare at a
# spinner until the slowest one finishes.
#
# The order is deliberate. Each step only means something once the one before
# it passed, and the last two are the pair that actually tells you where the
# problem is: ping answers but BACnet does not is a different fault entirely
# from neither answering.
@app.post("/api/diagnose")
async def diagnose(body: DiagnoseBody):
    ip = (body.address or "").strip()
    steg = body.step

    if steg == "port":
        naboer = port_naboer()
        if not naboer:
            return {"status": "ok",
                    "detalj": f"UDP {BACNET_PORT} er vår alene",
                    "forklaring": "Ingen andre programmer kjemper om porten."}
        hvem = ", ".join(f"{n['name']} (PID {n['pid']})" for n in naboer[:3])
        return {"status": "feil", "detalj": f"{hvem} har også UDP {BACNET_PORT}",
                "forklaring": port_advarsel(naboer)}

    if steg == "kort":
        lokal = state.get("local_address")
        if not lokal:
            return {"status": "feil", "detalj": "Ingen forbindelse startet",
                    "forklaring": "Velg nettverkskort øverst til venstre og koble til."}
        try:
            nett = ipaddress.ip_interface(lokal).network
            mal = ipaddress.ip_address(ip)
        except ValueError:
            return {"status": "ok", "detalj": f"Sender fra {lokal}",
                    "forklaring": "Adressen er ikke en vanlig IP - trolig en enhet "
                                  "bak en gateway. Da går trafikken via ruteren, "
                                  "og samme subnett gjelder ikke."}
        try:
            via = kort_for(ip)
        except OSError:
            via = None
        bundet = lokal.split("/")[0]
        if via and via != bundet and bundet != "0.0.0.0":
            return {"status": "feil",
                    "detalj": f"Windows sender til {ip} fra {via}, ikke fra {bundet}",
                    "forklaring": "Verktøyet er koblet til feil nettverkskort for "
                                  "denne adressen, så forespørslene kommer aldri "
                                  "fram. Skann på nytt - da byttes kortet "
                                  "automatisk - eller velg kortet med " + via + "."}
        if mal in nett:
            return {"status": "ok", "detalj": f"{ip} er i samme subnett som {lokal}",
                    "forklaring": "Trafikken går direkte, uten ruter."}
        return {"status": "advarsel",
                "detalj": f"{ip} er utenfor {nett}",
                "forklaring": "Den må rutes. Det kan gå helt fint, men da må "
                              "ruteren slippe BACnet gjennom - og kringkasting "
                              "(Who-Is) stopper som regel her. Bruk sweep."}

    if steg == "tjenester":
        return await _tjenester(ip)

    if steg == "brannmur":
        return await asyncio.get_event_loop().run_in_executor(None, _brannmur_sjekk)

    if steg == "ping":
        sem = asyncio.Semaphore(1)
        svar = await _ping_one(ip, body.timeout_ms, sem)
        if svar:
            return {"status": "ok", "detalj": f"{ip} svarer på ping",
                    "forklaring": "Adressen er i live og nås herfra."}
        return {"status": "advarsel", "detalj": f"{ip} svarer ikke på ping",
                "forklaring": "Det er ikke fasit. Mange regulatorer og brannmurer "
                              "slipper ikke ICMP, og svarer likevel på BACnet. "
                              "Se hva neste steg sier før du konkluderer."}

    if steg == "bacnet":
        bacnet_app = state["app"]
        if bacnet_app is None:
            return {"status": "feil", "detalj": "Ikke tilkoblet",
                    "forklaring": "Start forbindelsen først."}
        sem = asyncio.Semaphore(1)
        try:
            funn = await probe_host_unicast(
                bacnet_app, ip, max(1.0, body.timeout_ms / 1000.0), sem)
        except Exception as e:
            return {"status": "feil", "detalj": "Oppslaget feilet",
                    "forklaring": str(e)}
        if funn:
            navn = funn.get("object_name") or "uten navn"
            lev = funn.get("vendor_name") or "ukjent leverandør"
            return {"status": "ok",
                    "detalj": f"Enhet {funn.get('device_instance')} - {navn}",
                    "forklaring": f"{lev}. Den svarer på BACnet og kan leses.",
                    "enhet": funn}
        return {"status": "feil", "detalj": f"Ingen BACnet-svar fra {ip}",
                "forklaring": "Adressen svarer ikke på UDP 47808. Er det riktig "
                              "IP? Bruker anlegget en annen BACnet-port? Sitter "
                              "enheten bak en gateway, er det gatewayens IP du "
                              "skal spørre, ikke enhetens."}

    return {"status": "feil", "detalj": "Ukjent steg", "forklaring": steg}


@app.post("/api/ping")
async def ping_range(body: PingBody):
    """
    Which addresses answer ICMP.

    This exists to tell two very different silences apart. A BACnet sweep that
    finds nothing can mean the addresses are empty, or that the devices are
    there and the BACnet conversation is what is failing - and over a VPN the
    second is far more common. Ping answers that question directly: if six
    addresses reply to ping but none replied to Who-Is, the network is fine and
    the discovery is not.

    Read-only, and no BACnet traffic at all.
    """
    try:
        net = ipaddress.ip_network(body.subnet, strict=False)
    except Exception as e:
        return {"status": "error", "error": f"Ugyldig subnet/IP-range: {e}"}

    hosts = [str(ip) for ip in net.hosts()] or [str(net.network_address)]
    if len(hosts) > 1024:
        return {"status": "error", "error": "For stort område for ping (maks 1024 adresser)"}

    sem = asyncio.Semaphore(max(1, min(200, body.concurrency)))
    svar = await asyncio.gather(
        *[_ping_one(ip, body.timeout_ms, sem) for ip in hosts]
    )
    lever = [ip for ip, ok in zip(hosts, svar) if ok]
    return {"status": "done", "checked": len(hosts), "alive": lever}


@app.get("/")
def index():
    return FileResponse(Path(__file__).parent / "index.html", headers=NO_CACHE)


@app.get("/js/{navn}.js")
def nabe_js(navn: str):
    """The parts of the interface that live beside app.js. Only plain names
    from the js folder - nothing that walks out of it."""
    import re as _re
    fil = Path(__file__).parent / "js" / f"{navn}.js"
    if not _re.fullmatch(r"[a-z0-9-]+", navn) or not fil.is_file():
        return JSONResponse({"detail": "Not Found"}, status_code=404)
    return FileResponse(fil, media_type="application/javascript", headers=NO_CACHE)


@app.get("/app.js")
def app_js():
    return FileResponse(
        Path(__file__).parent / "app.js",
        media_type="application/javascript",
        headers=NO_CACHE,
    )


README_TXT = """NABE - Not Another BACnet Explorer
===================================

Kjør denne på din egen PC når du skal skanne et anlegg du bare når
gjennom VPN. Serverversjonen ser aldri kundens nett; det gjør din maskin.

SLIK STARTER DU
  1. Pakk ut mappen et sted du finner igjen.
  2. Dobbeltklikk start.bat
     Første gang tar det et par minutter (setter opp Python-miljø).
  3. Nettleseren åpnes på http://127.0.0.1:8092

KRAV
  Python 3.10 eller nyere fra python.org.
  Husk å huke av "Add Python to PATH" under installasjonen.

KOM I GANG
  1. Skriv området i feltet over enhetslista, f.eks. 10.75.1.0/24,
     én IP eller 10.75.1.10-40, og trykk Skann. Kortet velges selv.
  2. Bygg på delt VPN: velg «BBMD — via én IP» og skriv byggets BBMD.
  3. Klikk en enhet for å laste punktene.
  4. Klikk et punkt for detaljer, live trend og skriving.

  Auto er standard: Who-Is på eget nett, grundig sweep over VPN.

HURTIGTASTER
  /            søk i punktene
  ? / Ctrl+F   søk på tvers av alle åpnede enheter
  pil opp/ned  bla mellom punkter
  mellomrom    fest punkt til overvåking
  L            live av/på
  Z            stor visning av valgt punkt
  Ctrl-klikk   velg enkeltrad   Shift: område   Ctrl+A: alle

VELGE FLERE PUNKTER
  Ctrl-klikk eller Shift-klikk rader. Eksport (CSV/EDE) og
  festing gjelder da kun utvalget. Kopier legger dem på
  utklippstavlen klart for Excel.

MENYEN ⋯ (øverst til høyre)
  Lagre / åpne anlegg    enheter, overvåking og snapshot per kunde
  Skrivelogg             alt som er skrevet, med før- og etterverdi
  Lesemodus              blokkerer all skriving
  Tett visning           flere rader på skjermen

EKSPORT-MENYEN
  Snapshot               lagrer alle verdier for sammenligning
  CSV / EDE 2.3          punktliste for overlevering
  Sammenlign med EDE     finner avvik mot levert dokumentasjon
  Ukeprogram             viser skjema som ukesrutenett

SKRIVING - LES DETTE
  Skriving endrer et anlegg i drift. Bekreftelsen viser både
  nåværende og ny verdi. Bruk auto-frigi (standard 15 min) så
  overstyringen slipper seg selv om du blir avbrutt.
  Alt som skrives havner i skriveloggen.

IKKE VERIFISERT ENNÅ
  Ukeprogram er kun testet mot tomme skjema, og trendlogglesing
  er ikke testet mot utstyr i det hele tatt. Si fra hvis noe
  ser feil ut når du møter et anlegg som har dette.
"""


@app.get("/download")
def download():
    """
    Zip the local version on the fly from the files actually running here,
    so the download can never drift out of sync with the deployed code.
    """
    import io
    import zipfile

    here = Path(__file__).parent
    wanted = ["server.py", "bacnet_core.py", "index.html", "app.js",
              "start.bat", "start-stille.vbs", "Installer autostart.bat",
              "logo.png"]

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name in wanted:
            p = here / name
            if p.is_file():
                z.write(p, f"bacnet-explorer/{name}")
        z.writestr("bacnet-explorer/LES MEG.txt", README_TXT)

    buf.seek(0)
    return Response(
        content=buf.read(),
        media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="nabe.zip"',
            "Cache-Control": "no-store",
        },
    )


@app.get("/logo")
def logo():
    """
    Serve the official logo if someone drops one next to this file.
    Nothing is invented here: with no file present the UI falls back to a
    plain wordmark rather than an approximation of the real mark.
    """
    here = Path(__file__).parent
    # No-store on both branches: the file can be dropped in while the server
    # is running, and a cached 404 would otherwise keep the logo hidden until
    # the browser cache is cleared.
    headers = {"Cache-Control": "no-store"}
    for name, mime in (
        ("logo.svg", "image/svg+xml"),
        ("logo.png", "image/png"),
        ("logo.webp", "image/webp"),
    ):
        p = here / name
        if p.is_file():
            return FileResponse(p, media_type=mime, headers=headers)
    return Response(status_code=404, headers=headers)
