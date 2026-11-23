"""
NABE - mobiltilgang for igangkjøring.

På en igangkjøring er det sjelden VPN, og PC-en står gjerne langt fra tavla.
I stedet for å fjernstyre PC-en fra telefonen kan telefonen snakke med NABE
direkte, på PC-ens eget hotspot eller samme nett.

Hovedappen lytter fortsatt bare på denne PC-en. Mobiltilgang er en EGEN port
(standard 8093) med en smal port inn: den slipper bare gjennom de kallene
telefonen trenger, krever en engangskode, og begrenser alt som skrives:

  - skriving er av til PC-eieren slår den på, bortsett fra å slippe
  - prioritet 8 eller svakere, aldri nødprioritetene
  - hver verdi telefonen setter slippes av seg selv etter høyst N minutter,
    og den tiden ligger i NABE, ikke i telefonen. Mister du dekning, ryddes det
  - alt telefonen gjør ligger i en logg som PC-en kan se
  - porten slår seg av etter noen timer og er av til du slår den på

Rene funksjoner (regler, kode, adresser) er holdt adskilt fra serveren så de
kan testes uten nett.
"""
import asyncio
import collections
import hashlib
import hmac
import json
import os
import re
import secrets
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import lokalnett as ln

HER = Path(__file__).parent
PORT_STD = int(os.environ.get("NABE_MOBIL_PORT", "8093") or 8093)
OKT_LEVETID = 8 * 3600
KODE_LEVETID = 600
AV_ETTER = int(os.environ.get("NABE_MOBIL_AV_S", "") or 4 * 3600)
MAKS_MIN_STD = 10
MAKS_OKTER = 5
BRANNMUR_NAVN = "NABE mobil"

M: Dict[str, Any] = {
    "server": None, "tradd": None, "port": PORT_STD, "hoved": 8092,
    "kode": None, "kode_til": 0.0, "okter": {}, "skriv": False,
    "maks_min": MAKS_MIN_STD, "til": 0.0, "logg": collections.deque(maxlen=200),
    "feil_ip": {}, "feil_alle": [], "brannmur": (0.0, None),
}
LAAS = threading.Lock()

ID = r"[A-Za-z0-9_-]{1,64}"
GET_OK = [re.compile(p) for p in (
    r"^/api/status$", r"^/api/anlegg$", r"^/api/mine$", r"^/api/readonly$", r"^/api/sites$",
    rf"^/api/job/{ID}$", r"^/api/writelog$", rf"^/api/test/svar/{ID}$", r"^/api/test/svar-historikk$",
)]
POST_LES = [re.compile(p) for p in (
    r"^/api/poll$", r"^/api/device/points$", r"^/api/object/detail$", r"^/api/device/alarms$",
    rf"^/api/job/{ID}/cancel$", rf"^/api/test/svar/{ID}/avbryt$",
)]
POST_SKRIV = [re.compile(p) for p in (r"^/api/write$", r"^/api/test/svar$")]


# ---------------------------------------------------------------- rene deler

def ny_kode() -> str:
    return "%06d" % secrets.randbelow(10 ** 6)


def _klem(x: Any, lo: float, hi: float, standard: float) -> float:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return standard
    return max(lo, min(hi, v))


def regler(metode: str, sti: str, body: Optional[Dict[str, Any]], skriv: bool, maks_min: float) -> Dict[str, Any]:
    """Avgjør om telefonen får gjøre dette kallet, og skriver det om så grensene holder.
    Gir {"ok": True, "body": {...}} eller {"ok": False, "status": 403, "feil": "..."}."""
    if metode == "GET":
        if any(r.match(sti) for r in GET_OK):
            return {"ok": True, "body": None}
        return {"ok": False, "status": 403, "feil": "Ikke tillatt fra mobil"}
    if metode != "POST":
        return {"ok": False, "status": 405, "feil": "Ikke tillatt"}
    if any(r.match(sti) for r in POST_LES):
        return {"ok": True, "body": body}
    if not any(r.match(sti) for r in POST_SKRIV):
        return {"ok": False, "status": 403, "feil": "Ikke tillatt fra mobil"}
    b = dict(body or {})
    if sti == "/api/write":
        if b.get("release"):
            b["prop"] = "present-value"
            return {"ok": True, "body": b}
        if not skriv:
            return {"ok": False, "status": 403, "feil": "Skriving fra mobil er av. Slå den på i NABE på PC-en."}
        if str(b.get("prop") or "present-value") != "present-value":
            return {"ok": False, "status": 403, "feil": "Bare present-value kan settes fra mobil"}
        b["prop"] = "present-value"
        b["priority"] = int(_klem(b.get("priority"), 8, 16, 8))
        b["auto_release_min"] = _klem(b.get("auto_release_min") or maks_min, 0.5, maks_min, maks_min)
        return {"ok": True, "body": b}
    if sti == "/api/test/svar":
        if not skriv:
            return {"ok": False, "status": 403, "feil": "Skriving fra mobil er av. Slå den på i NABE på PC-en."}
        b["prioritet"] = int(_klem(b.get("prioritet"), 8, 16, 8))
        trinn = b.get("trinn") or [0, 50, 100]
        if not isinstance(trinn, list) or not (1 <= len(trinn) <= 8):
            return {"ok": False, "status": 400, "feil": "Mellom 1 og 8 trinn"}
        b["trinn"] = [_klem(x, 0, 100, 0) for x in trinn]
        b["pause_s"] = _klem(b.get("pause_s"), 5, 120, 30)
        if 16 + len(b["trinn"]) * b["pause_s"] > maks_min * 60:
            return {"ok": False, "status": 400, "feil": f"Testen tar lengre tid enn grensen på {maks_min:g} min. Færre trinn eller kortere pause."}
        return {"ok": True, "body": b}
    return {"ok": False, "status": 403, "feil": "Ikke tillatt fra mobil"}


def adresser(port: int) -> List[Dict[str, Any]]:
    """Adressene telefonen kan prøve, hotspot først: den virker uten noe annet nett."""
    ut = []
    for k in ln.kort_liste():
        if not k["opp"] or k["virtuell"]:
            continue
        for a in k["adresser"]:
            if ln.er_linklokal(a["ip"]) or a["prefix"] >= 31:
                continue
            hot = a["ip"].startswith("192.168.137.")
            ut.append({"kort": k["navn"], "ip": a["ip"], "type": "hotspot" if hot else "lan",
                       "url": f"http://{a['ip']}:{port}"})
    ut.sort(key=lambda x: (x["type"] != "hotspot", x["kort"]))
    return ut


def okt_id(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()[:8]


# --------------------------------------------------------------- innlogging

def _rens(naa: float) -> None:
    for t in [t for t, o in M["okter"].items() if o["til"] < naa]:
        M["okter"].pop(t, None)


LOGG_FIL: Optional[Path] = None   # settes av server.py; uten fil huskes loggen bare til mobiltilgangen slås av
LOGG_MAKS = 500


def logg(okt: str, tekst: str, **felt: Any) -> None:
    """Én linje i loggen. Felt (type, navn, ip, enhet, punkt, verdi, ok) gjør den til noe du kan søke i og
    legge ved en rapport. Linjene ligger også i en fil, så de overlever at mobiltilgangen slås av."""
    rad = {"t": int(time.time()), "okt": okt, "tekst": tekst}
    rad.update({k: v for k, v in felt.items() if v is not None})
    M["logg"].append(rad)
    if LOGG_FIL:
        try:
            with LAAS_LOGG:
                with LOGG_FIL.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(rad, ensure_ascii=False) + "\n")
                if LOGG_FIL.stat().st_size > 400_000:
                    ny = LOGG_FIL.read_text(encoding="utf-8").splitlines()[-LOGG_MAKS:]
                    LOGG_FIL.write_text("\n".join(ny) + "\n", encoding="utf-8")
        except OSError:
            pass


LAAS_LOGG = threading.Lock()


def logg_historikk(n: int = LOGG_MAKS) -> List[Dict[str, Any]]:
    """Det som er logget, nyeste først. Fra filen hvis den finnes, ellers fra minnet."""
    rader: List[Dict[str, Any]] = []
    if LOGG_FIL:
        try:
            with LAAS_LOGG:
                linjer = LOGG_FIL.read_text(encoding="utf-8").splitlines()[-n:]
            for linje in linjer:
                try:
                    r = json.loads(linje)
                    if isinstance(r, dict):
                        rader.append(r)
                except ValueError:
                    continue
        except OSError:
            pass
    if not rader:
        rader = list(M["logg"])[-n:]
    return rader[::-1]


def logg_inn(kode: str, ip: str, navn: str = "", ua: str = "") -> Dict[str, Any]:
    """Bytter koden mot en økt. Fem feil på ett minutt sperrer den adressen, femten
    feil totalt gjør koden ugyldig, så den ikke kan gjettes."""
    naa = time.time()
    with LAAS:
        _rens(naa)
        f = [t for t in M["feil_ip"].get(ip, []) if naa - t < 60]
        M["feil_ip"][ip] = f
        if len(f) >= 5:
            return {"ok": False, "feil": "For mange forsøk. Vent ett minutt."}
        gyldig = bool(M["kode"]) and naa < M["kode_til"] and hmac.compare_digest(str(kode or "").strip(), M["kode"])
        if not gyldig:
            f.append(naa)
            M["feil_alle"] = [t for t in M["feil_alle"] if naa - t < 300] + [naa]
            if len(M["feil_alle"]) >= 15:
                M["kode"] = None
            return {"ok": False, "feil": "Feil kode, eller koden er utløpt."}
        token = _ny_okt(ip, navn or navn_fra_ua(ua), ua, naa)
        logg(okt_id(token), f"Logget inn fra {ip}")
        return {"ok": True, "token": token}


# ------------------------------------------------------------ telefoner NABE husker
# En telefon som er koblet til én gang kan huskes på MAC-adressen sin. Neste gang den er på
# PC-ens hotspot, kjenner NABE den igjen og logger den inn uten kode og uten QR. Det løser også
# at en app lagt på hjemskjermen har en egen cookie-boks og ellers måtte logge inn på nytt.
#
# Hva dette stoler på: hotspotet har et Wi-Fi-passord, så den som er der har allerede kommet seg
# inn. MAC-adressen sier hvilken telefon det er. Den kan forfalskes, så den teller bare på
# hotspotets eget nett (192.168.137.x) om ikke PC-eieren selv har slått på «også på vanlig Wi-Fi».
# Å huske en telefon er alltid et trykk på PC-en, og skriving styres fortsatt derfra.
PAR_FIL: Optional[Path] = None
HOTSPOT_NETT = "192.168.137."
_ARP: Dict[str, Any] = {"t": 0.0, "d": {}}


def mac_normaliser(s: Any) -> str:
    t = str(s or "").strip().lower().replace("-", ":")
    return t if re.fullmatch(r"[0-9a-f]{2}(:[0-9a-f]{2}){5}", t) else ""


def arp_tabell() -> Dict[str, str]:
    """IP til MAC for naboene Windows kjenner nå. Hurtigbuffret noen sekunder."""
    if time.time() - _ARP["t"] < 4:
        return _ARP["d"]
    d: Dict[str, str] = {}
    try:
        r = subprocess.run(["arp", "-a"], capture_output=True, text=True, timeout=5, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        for m in re.finditer(r"(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-fA-F]{2}(?:[-:][0-9a-fA-F]{2}){5})", r.stdout):
            mac = mac_normaliser(m.group(2))
            if mac and mac != "00:00:00:00:00:00" and not mac.startswith(("ff:ff", "01:00:5e", "33:33")):
                d[m.group(1)] = mac
    except Exception:
        pass
    _ARP["t"], _ARP["d"] = time.time(), d
    return d


def mac_for(ip: str) -> str:
    # NABE_MOBIL_MAC_TEST="127.0.0.1=02:00:00:aa:bb:cc" lar selvtesten tilordne en MAC til loopback.
    for par in (os.environ.get("NABE_MOBIL_MAC_TEST") or "").split(","):
        if "=" in par and par.split("=", 1)[0].strip() == ip:
            return mac_normaliser(par.split("=", 1)[1])
    return arp_tabell().get(ip, "")


def navn_fra_ua(ua: str) -> str:
    u = ua or ""
    if "iPhone" in u:
        return "iPhone"
    if "iPad" in u:
        return "iPad"
    m = re.search(r"Android [\d.]+; ([^;)]+)", u)
    if m:
        return m.group(1).strip()[:24]
    return "Android" if "Android" in u else "Mobil"


def par_les() -> Dict[str, Any]:
    try:
        d = json.loads(PAR_FIL.read_text(encoding="utf-8")) if PAR_FIL else {}
        if isinstance(d, dict):
            d.setdefault("enheter", [])
            d.setdefault("lan", False)
            return d
    except Exception:
        pass
    return {"v": 1, "enheter": [], "lan": False}


def par_skriv(d: Dict[str, Any]) -> None:
    if not PAR_FIL:
        return
    tmp = PAR_FIL.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, PAR_FIL)


def _ny_okt(ip: str, navn: str, ua: str = "", naa: Optional[float] = None) -> str:
    naa = naa or time.time()
    token = secrets.token_urlsafe(24)
    if len(M["okter"]) >= MAKS_OKTER:
        eldste = min(M["okter"], key=lambda t: M["okter"][t]["laget"])
        M["okter"].pop(eldste, None)
    M["okter"][token] = {"navn": (navn or "Mobil")[:24], "laget": naa, "sist": naa, "ip": ip, "til": naa + OKT_LEVETID, "ua": ua[:200]}
    return token


def auto_logg_inn(ip: str, ua: str = "") -> Optional[str]:
    """En økt for en husket telefon, uten kode. Bare når mobiltilgang er på og adressen er kjent."""
    if not M["server"]:
        return None
    d = par_les()
    if not d["enheter"]:
        return None
    if not str(ip).startswith(HOTSPOT_NETT) and not d.get("lan"):
        return None
    mac = mac_for(ip)
    treff = next((e for e in d["enheter"] if mac and e.get("mac") == mac), None)
    if not treff:
        return None
    with LAAS:
        token = _ny_okt(ip, treff.get("navn") or navn_fra_ua(ua), ua)
        logg(okt_id(token), f"Kjente igjen {treff.get('navn')} og logget inn")
    treff["sist"], treff["ip"] = int(time.time()), ip
    par_skriv(d)
    return token


def par_ny(id_: str) -> Dict[str, Any]:
    """Husk telefonen bak en innlogget økt, på MAC-adressen den har nå."""
    with LAAS:
        tok = next((t for t in M["okter"] if okt_id(t) == id_), None)
        o = M["okter"].get(tok) if tok else None
    if not o:
        return {"ok": False, "feil": "Fant ikke telefonen. Den må være koblet til nå."}
    mac = mac_for(o["ip"])
    if not mac:
        return {"ok": False, "feil": "Fant ikke MAC-adressen til telefonen. Prøv igjen når den er på hotspotet eller samme Wi-Fi."}
    d = par_les()
    ny_ = {"id": hashlib.sha1(mac.encode()).hexdigest()[:8], "navn": o["navn"], "mac": mac, "laget": int(time.time()), "sist": int(time.time()), "ip": o["ip"]}
    d["enheter"] = [e for e in d["enheter"] if e.get("mac") != mac] + [ny_]
    par_skriv(d)
    logg("pc", f"Husket {o['navn']}")
    return {"ok": True, "enhet": ny_}


def par_glem(id_: str) -> None:
    d = par_les()
    d["enheter"] = [e for e in d["enheter"] if e.get("id") != id_]
    par_skriv(d)
    logg("pc", "Glemte en telefon")


def par_lan(tillat: bool) -> None:
    d = par_les()
    d["lan"] = bool(tillat)
    par_skriv(d)


def par_status() -> Dict[str, Any]:
    d = par_les()
    naa = time.time()
    levende = {o["ip"] for o in M["okter"].values() if o["til"] > naa}
    maskert = lambda m: m[:2] + ":••:••:••:" + m[-5:] if len(m) == 17 else m
    return {"liste": [{"id": e["id"], "navn": e.get("navn", "Mobil"), "mac": maskert(e.get("mac", "")), "sist": e.get("sist", 0),
                       "tilkoblet": e.get("ip") in levende} for e in d["enheter"]], "lan": bool(d.get("lan"))}


def gruppe_okter(kopi: List[Tuple[str, Dict[str, Any]]]) -> List[Tuple[str, Dict[str, Any]]]:
    """Én rad per telefon: hver innlogging lager en økt, men en telefon har én adresse."""
    nyest: Dict[str, Tuple[str, Dict[str, Any]]] = {}
    for oid, o in kopi:
        g = nyest.get(o["ip"])
        if g is None or o["sist"] >= g[1]["sist"]:
            nyest[o["ip"]] = (oid, o)
    return sorted(nyest.values(), key=lambda x: -x[1]["sist"])


def kast_telefon(id_: str) -> int:
    """Kaster ut telefonen bak en økt, med alle øktene den har. Gir antall som ble fjernet."""
    with LAAS:
        tok = next((t for t in M["okter"] if okt_id(t) == id_), None)
        if not tok:
            return 0
        ip = M["okter"][tok]["ip"]
        borte = [t for t, o in M["okter"].items() if o["ip"] == ip]
        for t in borte:
            M["okter"].pop(t, None)
    return len(borte)


def okt_for(token: Optional[str]) -> Optional[Dict[str, Any]]:
    if not token:
        return None
    naa = time.time()
    with LAAS:
        o = M["okter"].get(token)
        if not o or o["til"] < naa or not M["server"]:
            return None
        o["sist"] = naa
        return o


# ----------------------------------------------------------------- serveren

def _hent(metode: str, sti: str, body: Optional[bytes], sprak: str) -> Tuple[int, bytes, str]:
    url = f"http://127.0.0.1:{M['hoved']}{sti}"
    req = urllib.request.Request(url, data=body if metode == "POST" else None, method=metode,
                                 headers={"Content-Type": "application/json", "X-Sprak": sprak or "nb"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read(), r.headers.get("content-type", "application/json")
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers.get("content-type", "application/json")
    except Exception as e:
        return 502, json.dumps({"status": "error", "error": f"NABE svarer ikke: {e}"}).encode(), "application/json"


# ------------------------------------------------------------- app-ikon og manifest
# Siden skal kunne legges på hjemskjermen og åpnes uten nettleserramme, som en app. Det trenger et
# ikon og et manifest. Ikonet er NABE-ansiktet, tegnet her uten bildebibliotek: kantene glattes
# ved å ta flere prøver per punkt, og PNG-en skrives for hånd.
_IKON_CACHE: Dict[int, bytes] = {}


def _rundrekt(x: float, y: float, cx: float, cy: float, hw: float, hh: float, r: float) -> float:
    dx = abs(x - cx) - (hw - r)
    dy = abs(y - cy) - (hh - r)
    ut = (max(dx, 0.0) ** 2 + max(dy, 0.0) ** 2) ** 0.5
    return ut + min(max(dx, dy), 0.0) - r


def _linje_avstand(x: float, y: float, x1: float, y1: float, x2: float, y2: float) -> float:
    vx, vy = x2 - x1, y2 - y1
    t = max(0.0, min(1.0, ((x - x1) * vx + (y - y1) * vy) / (vx * vx + vy * vy or 1.0)))
    return ((x - (x1 + t * vx)) ** 2 + (y - (y1 + t * vy)) ** 2) ** 0.5


def ikon_png(px: int) -> bytes:
    """NABE-ansiktet som app-ikon, px x px. Fylt til kantene: iOS og Android runder hjørnene selv."""
    if px in _IKON_CACHE:
        return _IKON_CACHE[px]
    import struct
    import zlib
    ss = 3 if px <= 256 else 2
    bakgrunn_topp, bakgrunn_bunn = (22, 32, 46), (12, 14, 18)
    hvit, mork, aksent = (238, 241, 245), (16, 20, 25), (90, 162, 255)
    rader = []
    for j in range(px):
        rad = bytearray([0])
        for i in range(px):
            r = g = b = 0
            for sj in range(ss):
                for si in range(ss):
                    x = (i + (si + 0.5) / ss) / px
                    y = (j + (sj + 0.5) / ss) / px
                    t = y
                    c = tuple(bakgrunn_topp[k] + (bakgrunn_bunn[k] - bakgrunn_topp[k]) * t for k in range(3))
                    if _rundrekt(x, y, 0.5, 0.56, 0.31, 0.25, 0.14) < 0:
                        c = hvit
                        if ((x - 0.38) ** 2 + (y - 0.54) ** 2) ** 0.5 < 0.055 or ((x - 0.62) ** 2 + (y - 0.54) ** 2) ** 0.5 < 0.055:
                            c = mork
                        elif _linje_avstand(x, y, 0.43, 0.68, 0.57, 0.68) < 0.014:
                            c = mork
                    elif _linje_avstand(x, y, 0.5, 0.31, 0.5, 0.2) < 0.014:
                        c = hvit
                    if ((x - 0.5) ** 2 + (y - 0.17) ** 2) ** 0.5 < 0.045:
                        c = aksent
                    r += c[0]
                    g += c[1]
                    b += c[2]
            n = ss * ss
            rad += bytes((int(r / n + 0.5), int(g / n + 0.5), int(b / n + 0.5)))
        rader.append(bytes(rad))
    data = b"".join(rader)

    def chunk(navn: bytes, innhold: bytes) -> bytes:
        return struct.pack(">I", len(innhold)) + navn + innhold + struct.pack(">I", zlib.crc32(navn + innhold) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", px, px, 8, 2, 0, 0, 0)) \
        + chunk(b"IDAT", zlib.compress(data, 9)) + chunk(b"IEND", b"")
    _IKON_CACHE[px] = png
    return png


MANIFEST = {
    "name": "NABE", "short_name": "NABE", "description": "Not Another BACnet Explorer, på telefonen",
    "start_url": "/m", "scope": "/", "display": "standalone", "orientation": "portrait",
    "background_color": "#000000", "theme_color": "#000000",
    "icons": [{"src": "/m/ikon/192.png", "sizes": "192x192", "type": "image/png"},
              {"src": "/m/ikon/512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"}],
}


def lag_app():
    from fastapi import FastAPI, Request
    from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    COOKIE = "nabe_mobil"

    def hode(r):
        r.headers["Cache-Control"] = "no-store"
        r.headers["X-Content-Type-Options"] = "nosniff"
        r.headers["Referrer-Policy"] = "no-referrer"
        r.headers["X-Frame-Options"] = "DENY"
        r.headers["Content-Security-Policy"] = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
        return r

    def sett_cookie(r, token):
        r.set_cookie(COOKIE, token, max_age=OKT_LEVETID, httponly=True, samesite="strict", path="/")
        return r

    def klient(request: Request) -> str:
        return request.client.host if request.client else "?"

    @app.get("/")
    def rot():
        return hode(RedirectResponse("/m"))

    @app.get("/m")
    def side(request: Request, k: str = ""):
        if k:
            r = logg_inn(k, klient(request), "", request.headers.get("user-agent", ""))
            if r["ok"]:
                return hode(sett_cookie(RedirectResponse("/m", status_code=303), r["token"]))
            return hode(RedirectResponse("/m?feil=1", status_code=303))
        try:
            html = (HER / "nabe_mobil.html").read_text(encoding="utf-8")
        except OSError:
            html = "<p>nabe_mobil.html mangler</p>"
        svar = hode(HTMLResponse(html))
        if not okt_for(request.cookies.get(COOKIE)):
            tok = auto_logg_inn(klient(request), request.headers.get("user-agent", ""))
            if tok:
                sett_cookie(svar, tok)
        return svar

    @app.get("/m/manifest.webmanifest")
    def manifest():
        return hode(Response(content=json.dumps(MANIFEST), media_type="application/manifest+json"))

    @app.get("/m/ikon/{px}.png")
    def ikon(px: int):
        if px not in (180, 192, 512):
            return hode(Response(status_code=404))
        r = hode(Response(content=ikon_png(px), media_type="image/png"))
        r.headers["Cache-Control"] = "public, max-age=86400"
        return r

    @app.post("/m/logginn")
    async def logginn(request: Request):
        if request.headers.get("x-nabe") != "1":
            return hode(JSONResponse({"ok": False, "feil": "Avvist"}, status_code=403))
        try:
            b = await request.json()
        except Exception:
            b = {}
        r = logg_inn(str(b.get("kode") or ""), klient(request), str(b.get("navn") or ""), request.headers.get("user-agent", ""))
        if not r["ok"]:
            return hode(JSONResponse(r, status_code=403))
        return hode(sett_cookie(JSONResponse({"ok": True}), r["token"]))

    @app.get("/m/me")
    def meg(request: Request):
        o = okt_for(request.cookies.get(COOKIE))
        ny_tok = None
        if not o:
            ny_tok = auto_logg_inn(klient(request), request.headers.get("user-agent", ""))
            o = okt_for(ny_tok)
        if not o:
            return hode(JSONResponse({"ok": False}, status_code=401))
        svar = hode(JSONResponse({"ok": True, "skriv": M["skriv"], "maks_min": M["maks_min"], "navn": o["navn"], "kjent": bool(ny_tok)}))
        if ny_tok:
            sett_cookie(svar, ny_tok)
        return svar

    @app.api_route("/api/{rest:path}", methods=["GET", "POST"])
    async def proxy(request: Request, rest: str):
        token = request.cookies.get(COOKIE)
        o = okt_for(token)
        if not o:
            return hode(JSONResponse({"status": "error", "error": "Ikke innlogget"}, status_code=401))
        sti = "/api/" + rest
        body = None
        raa = b""
        if request.method == "POST":
            if request.headers.get("x-nabe") != "1":
                return hode(JSONResponse({"status": "error", "error": "Avvist"}, status_code=403))
            raa = await request.body()
            if len(raa) > 200_000:
                return hode(JSONResponse({"status": "error", "error": "For stor"}, status_code=413))
            try:
                body = json.loads(raa or b"{}")
            except Exception:
                return hode(JSONResponse({"status": "error", "error": "Ugyldig JSON"}, status_code=400))
        vurd = regler(request.method, sti, body, M["skriv"], M["maks_min"])
        if not vurd["ok"]:
            return hode(JSONResponse({"status": "error", "error": vurd["feil"]}, status_code=vurd["status"]))
        send = json.dumps(vurd["body"]).encode() if request.method == "POST" else None
        q = ("?" + request.url.query) if request.url.query else ""
        status, data, ctype = await asyncio.to_thread(_hent, request.method, sti + q, send, request.headers.get("x-sprak", "nb"))
        if request.method == "POST" and sti in ("/api/write", "/api/test/svar"):
            b = vurd["body"] or {}
            try:
                svar_status = json.loads(data).get("status")
            except Exception:
                svar_status = None
            ok = svar_status in ("done", "started")
            if sti == "/api/write":
                tekst = ("Slapp " if b.get("release") else f"Satte {b.get('value')} på ") + f"{b.get('objid')} @ {b.get('address')}"
                if not b.get("release"):
                    tekst += f" (prio {b.get('priority')}, slippes etter {b.get('auto_release_min'):g} min)"
                typ, punkt, verdi = ("slipp" if b.get("release") else "skriv"), b.get("objid"), (None if b.get("release") else b.get("value"))
            else:
                tekst = f"Prøv-og-se-svar på {b.get('padrag')} @ {b.get('address')}, trinn {b.get('trinn')}"
                typ, punkt, verdi = "test", b.get("padrag"), None
            if not ok:
                tekst += " - avvist"
            logg(okt_id(token), tekst, type=typ, navn=o["navn"], ip=o["ip"], enhet=b.get("address"), punkt=punkt, verdi=verdi, ok=ok)
        return hode(Response(content=data, status_code=status, media_type=ctype.split(";")[0]))

    return app


def start(hoved_port: int, port: Optional[int] = None) -> Dict[str, Any]:
    import uvicorn

    if M["server"]:
        return status()
    M["hoved"] = hoved_port
    M["port"] = port or PORT_STD
    M["kode"], M["kode_til"] = ny_kode(), time.time() + KODE_LEVETID
    M["til"] = time.time() + AV_ETTER
    M["okter"].clear()
    M["feil_alle"] = []
    M["feil_ip"] = {}

    class S(uvicorn.Server):
        def install_signal_handlers(self):  # tråd: ingen signaler
            pass

    cfg = uvicorn.Config(lag_app(), host="0.0.0.0", port=M["port"], log_level="warning", access_log=False)
    srv = S(cfg)
    tr = threading.Thread(target=srv.run, daemon=True, name="nabe-mobil")
    tr.start()
    for _ in range(50):
        if srv.started:
            break
        if not tr.is_alive():
            break
        time.sleep(0.1)
    if not srv.started:
        M["kode"] = None
        return {"status": "error", "error": f"Porten {M['port']} er opptatt eller kunne ikke åpnes."}
    M["server"], M["tradd"] = srv, tr
    logg("pc", "Mobiltilgang slått på")
    threading.Thread(target=_vakt, daemon=True, name="nabe-mobil-vakt").start()
    return status()


def stopp() -> Dict[str, Any]:
    srv = M["server"]
    if srv:
        logg("pc", "Mobiltilgang slått av")
        srv.should_exit = True
        tr = M["tradd"]
        if tr:
            tr.join(timeout=5)
    M["server"] = M["tradd"] = None
    M["kode"] = None
    M["okter"].clear()
    M["skriv"] = False
    if M.get("hotspot_vaar"):
        # Det NABE slo på, slår NABE av igjen. Det tar noen sekunder, så det skjer i bakgrunnen.
        M["hotspot_vaar"] = False
        threading.Thread(target=lambda: hotspot_sett(False), daemon=True, name="nabe-mobil-hotspot-av").start()
    return status()


def _vakt() -> None:
    """Slår porten av når tiden er ute, så den ikke blir stående åpen over natta."""
    while M["server"]:
        if time.time() > M["til"]:
            stopp()
            return
        time.sleep(min(15, max(0.2, AV_ETTER / 4)))


HOTSPOT_SETT_PS = r"""param([string]$Handling = 'paa', [switch]$Torr)
$ErrorActionPreference = 'Stop'
$VIRTUELL = 'virtual|vpn|tunnel|fortinet|wireguard|tailscale|cisco|pangp|anyconnect|loopback|hyper-v|vmware|virtualbox|wan miniport|bluetooth'
function Ut($o) { ($o | ConvertTo-Json -Compress -Depth 4); exit 0 }
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType = WindowsRuntime]
  $null = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager, Windows.Networking.NetworkOperators, ContentType = WindowsRuntime]
  $null = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult, Windows.Networking.NetworkOperators, ContentType = WindowsRuntime]
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  function Vent($op, $type) {
    $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
    if (-not $t.Wait(45000)) { throw 'Windows svarte ikke i tide' }
    $t.Result
  }
  $TM = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]
  $profiler = @([Windows.Networking.Connectivity.NetworkInformation]::GetConnectionProfiles())

  # Står hotspot allerede på? Da brukes den som den er.
  $paa = $null
  foreach ($p in $profiler) {
    try {
      $m = $TM::CreateFromConnectionProfile($p)
      if ("$($m.TetheringOperationalState)" -eq 'On') { $paa = $m; break }
    } catch { }
  }

  if ($Handling -eq 'av') {
    if (-not $paa) { Ut @{ok = $true; paa = $false; status = 'AlleredeAv'} }
    if ($Torr) { Ut @{ok = $true; torr = $true; paa = $true; status = 'Torr'} }
    $r = Vent ($paa.StopTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
    Ut @{ok = ("$($r.Status)" -eq 'Success'); paa = $false; status = "$($r.Status)"; melding = "$($r.AdditionalErrorMessage)"}
  }

  if ($paa) {
    $c = $paa.GetCurrentAccessPointConfiguration()
    Ut @{ok = $true; paa = $true; allerede = $true; status = 'AlleredePaa'; ssid = $c.Ssid; passord = $c.Passphrase}
  }

  # Velg hva som deles. NABE trenger ikke internett, bare at telefonen når PC-en, så kilden er
  # underordnet: en ekte kabel går foran Wi-Fi, og tunneler og virtuelle kort velges bare til slutt.
  $adaptere = @{}
  try { Get-NetAdapter -IncludeHidden -ErrorAction SilentlyContinue | ForEach-Object { $adaptere[$_.InterfaceGuid.ToLower()] = $_ } } catch { }
  $kand = @()
  foreach ($p in $profiler) {
    try {
      if ("$($TM::GetTetheringCapabilityFromConnectionProfile($p))" -ne 'Enabled') { continue }
      $na = $p.NetworkAdapter
      if (-not $na) { continue }
      $niva = "$($p.GetNetworkConnectivityLevel())"
      $guid = "{$($na.NetworkAdapterId)}".ToLower()
      $beskr = ''
      if ($adaptere.ContainsKey($guid)) { $beskr = "$($adaptere[$guid].InterfaceDescription)" }
      $virt = ($beskr -match $VIRTUELL) -or ($p.ProfileName -match $VIRTUELL)
      $skal = 0
      if ($niva -eq 'InternetAccess') { $skal += 8 } elseif ($niva -eq 'LocalAccess') { $skal += 6 } elseif ($niva -eq 'ConstrainedInternetAccess') { $skal += 4 }
      if ($na.IanaInterfaceType -eq 6) { $skal += 5 } elseif ($na.IanaInterfaceType -eq 71) { $skal += 3 }
      if ($virt) { $skal -= 30 }
      $kand += [pscustomobject]@{p = $p; navn = $p.ProfileName; niva = $niva; skal = $skal; virt = $virt; beskr = $beskr; type = [int]$na.IanaInterfaceType}
    } catch { }
  }
  # Samme adapter kan ha mange lagrede profiler (Wi-Fi-nett): bare de som er tilkoblet teller, med mindre ingenting er det.
  $levende = @($kand | Where-Object { $_.niva -ne 'None' })
  if ($levende.Count -gt 0) { $kand = $levende }
  $sortert = @($kand | Sort-Object -Property skal -Descending)
  if ($sortert.Count -eq 0) { Ut @{ok = $false; status = 'IngenKilde'} }
  $valgt = $sortert[0]
  $liste = @($sortert | Select-Object -First 5 | ForEach-Object { "{0} ({1}, {2}, {3})" -f $_.navn, $_.beskr, $_.niva, $_.skal })

  if ($Torr) { Ut @{ok = $true; torr = $true; paa = $false; status = 'Torr'; kilde = $valgt.navn; kandidater = $liste} }

  $m = $TM::CreateFromConnectionProfile($valgt.p)
  $r = Vent ($m.StartTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
  $st = "$($r.Status)"
  if ($st -ne 'Success') { Ut @{ok = $false; paa = $false; status = $st; melding = "$($r.AdditionalErrorMessage)"; kilde = $valgt.navn} }
  $c = $m.GetCurrentAccessPointConfiguration()
  Ut @{ok = $true; paa = $true; status = 'Success'; ssid = $c.Ssid; passord = $c.Passphrase; kilde = $valgt.navn}
} catch {
  Ut @{ok = $false; paa = $false; status = 'Feil'; melding = "$($_.Exception.Message)"}
}
"""

HOTSPOT_FEIL = {
    "WiFiDeviceOff": ("Wi-Fi er slått av på PC-en. Slå det på, så prøver vi igjen.", "Wi-Fi is off on this PC. Turn it on and we try again."),
    "BluetoothDeviceOff": ("Bluetooth er slått av på PC-en, og Windows vil ha det på for hotspot.", "Bluetooth is off on this PC, and Windows wants it on for the hotspot."),
    "MobileBroadbandDeviceOff": ("Mobilt bredbånd er slått av.", "Mobile broadband is off."),
    "OperationInProgress": ("Windows holder allerede på med hotspot. Vent litt og prøv igjen.", "Windows is already working on the hotspot. Wait a moment and try again."),
    "NetworkLimitedConnectivity": ("Windows har ingen forbindelse å dele akkurat nå. Koble til kabelen eller et Wi-Fi først, eller slå på hotspot på telefonen og koble PC-en til det.",
                                   "Windows has no connection to share right now. Connect the cable or a Wi-Fi first, or turn on the hotspot on the phone and join the PC to it."),
    "IngenKilde": ("Windows har ingen forbindelse å dele akkurat nå. Koble til kabelen eller et Wi-Fi først, eller slå på hotspot på telefonen og koble PC-en til det.",
                   "Windows has no connection to share right now. Connect the cable or a Wi-Fi first, or turn on the hotspot on the phone and join the PC to it."),
    "EntitlementCheckTimeout": ("Windows fikk ikke svar fra operatøren om hotspot er tillatt.", "Windows got no answer from the operator on whether the hotspot is allowed."),
    "EntitlementCheckFailure": ("Hotspot er ikke tillatt på denne PC-en (operatør eller IT-regler).", "The hotspot is not allowed on this PC (operator or IT rules)."),
    "Unknown": ("Windows sier nei uten grunn. Det er nesten alltid IT-regler på en PC styrt av organisasjonen. Slå på hotspot på telefonen og koble PC-en til det i stedet.",
                "Windows says no without a reason. On a PC managed by an organisation that is almost always IT rules. Turn on the hotspot on the phone and join the PC to it instead."),
}


def tolk_hotspot(stdout: str, returncode: int = 0) -> Dict[str, Any]:
    """Gjør skriptets svar om til noe serveren kan bruke. Alt som ikke er et tydelig JSON-svar er en feil."""
    try:
        d = json.loads((stdout or "").strip().splitlines()[-1])
        if not isinstance(d, dict):
            raise ValueError
    except Exception:
        return {"ok": False, "status": "Feil", "melding": "Fikk ikke noe svar fra Windows"}
    d["ok"] = bool(d.get("ok"))
    return d


def hotspot_feiltekst(d: Dict[str, Any]) -> Tuple[str, str]:
    st = str(d.get("status") or "Feil")
    if st in HOTSPOT_FEIL:
        return HOTSPOT_FEIL[st]
    m = str(d.get("melding") or "").strip()
    return (f"Windows ville ikke slå på hotspot ({st}). {m}".strip(), f"Windows would not turn the hotspot on ({st}). {m}".strip())


def hotspot_sett(paa: bool, torr: bool = False) -> Dict[str, Any]:
    """Slår Windows' mobile hotspot på eller av, som bryteren i innstillingene. Bare PC-ens eget nett
    endres, bare på trykk, og bare det NABE selv slo på slås av igjen når mobiltilgang stenges."""
    if not ln.er_windows():
        return {"ok": False, "status": "Feil", "melding": "Bare Windows har hotspot"}
    fil = None
    try:
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".ps1", delete=False, encoding="utf-8-sig") as f:
            f.write(HOTSPOT_SETT_PS)
            fil = f.name
        args = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fil, "-Handling", "paa" if paa else "av"] + (["-Torr"] if torr else [])
        r = subprocess.run(args, capture_output=True, text=True, timeout=75, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        d = tolk_hotspot(r.stdout, r.returncode)
    except subprocess.TimeoutExpired:
        return {"ok": False, "status": "Feil", "melding": "Windows svarte ikke i tide"}
    except Exception as e:
        return {"ok": False, "status": "Feil", "melding": str(e)[:200]}
    finally:
        if fil:
            try:
                os.unlink(fil)
            except OSError:
                pass
    if not d["ok"] and paa and not torr and str(d.get("status")) in ("Unknown", "EntitlementCheckFailure"):
        # Windows sier nei uten en grunn man kan gjøre noe med. På en PC styrt av IT er det reglene deres.
        M["hotspot_sperret"] = True
    if d["ok"] and not torr:
        M["hotspot_sperret"] = False
        if paa:
            if d.get("paa") and not d.get("allerede"):
                M["hotspot_vaar"] = True
            M["hotspot"] = (time.time(), {"paa": bool(d.get("paa")), "ssid": d.get("ssid"), "passord": d.get("passord"), "kan": True, "klienter": 0})
        else:
            M["hotspot_vaar"] = False
            M["hotspot"] = (time.time(), {"paa": False, "ssid": None, "passord": None, "kan": True, "klienter": 0})
    return d


def _ved_avslutning() -> None:
    """Lukkes NABE mens hotspotet NABE slo på fortsatt går, slås det av igjen. Rydder ikke etter krasj eller drap."""
    if M.get("hotspot_vaar"):
        try:
            hotspot_sett(False)
        except Exception:
            pass


import atexit
atexit.register(_ved_avslutning)


def wifi_klient() -> Optional[str]:
    """Navnet på Wi-Fi-kortet hvis PC-en er koblet til et Wi-Fi nå. Hotspot på samme kort kan kutte den tilkoblingen en stund."""
    try:
        for k in ln.kort_liste():
            if k["opp"] and re.search(r"wi-?fi|wlan|wireless", k["navn"], re.I):
                if any(not ln.er_linklokal(a["ip"]) and not a["ip"].startswith("192.168.137.") for a in k["adresser"]):
                    return k["navn"]
    except Exception:
        pass
    return None


def _ferske(nokkel: str, fn, maks_alder: float):
    """Gir det siste kjente svaret med en gang, og henter et nytt i bakgrunnen når det er gammelt.
    Windows-oppslagene tar et sekund eller to, og dialogen skal ikke vente på dem."""
    t, v = M.get(nokkel, (0.0, None))
    if time.time() - t >= maks_alder and not M.get(nokkel + "_kjorer"):
        M[nokkel + "_kjorer"] = True

        def jobb():
            try:
                fn()
            except Exception:
                pass
            finally:
                M[nokkel + "_kjorer"] = False
        threading.Thread(target=jobb, daemon=True, name="nabe-mobil-" + nokkel).start()
    return v


def brannmur_finnes() -> Optional[bool]:
    t, v = M["brannmur"]
    if time.time() - t < 20:
        return v
    v = None
    if ln.er_windows():
        try:
            r = subprocess.run(["powershell", "-NoProfile", "-Command",
                                f"@(Get-NetFirewallRule -DisplayName '{BRANNMUR_NAVN}' -ErrorAction SilentlyContinue).Count"],
                               capture_output=True, text=True, timeout=15, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            v = int(r.stdout.strip() or 0) > 0
        except Exception:
            v = None
    M["brannmur"] = (time.time(), v)
    return v


def nettprofil_hent() -> Dict[str, Dict[str, str]]:
    """Hva Windows kaller hvert nett (navn og om det er offentlig eller privat), per kort. På et offentlig nett
    stenger brannmuren for alt utenfra uten en regel, og det er den vanligste grunnen til at telefonen ikke når PC-en."""
    ut: Dict[str, Dict[str, str]] = {}
    if ln.er_windows():
        try:
            r = subprocess.run(["powershell", "-NoProfile", "-Command",
                                "Get-NetConnectionProfile | Select-Object Name,InterfaceAlias,@{n='kat';e={\"$($_.NetworkCategory)\"}} | ConvertTo-Json -Compress"],
                               capture_output=True, text=True, timeout=15, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            d = json.loads(r.stdout.strip() or "[]")
            for p in (d if isinstance(d, list) else [d]):
                if isinstance(p, dict) and p.get("InterfaceAlias"):
                    ut[str(p["InterfaceAlias"])] = {"navn": str(p.get("Name") or ""), "kat": str(p.get("kat") or "")}
        except Exception:
            pass
    M["nettprofil"] = (time.time(), ut)
    return ut


def wifi_profil() -> Optional[Dict[str, str]]:
    """Profilen til Wi-Fi-nettet PC-en er på, fra siste oppslag (nytt hentes i bakgrunnen)."""
    p = _ferske("nettprofil", nettprofil_hent, 30) or {}
    k = wifi_klient()
    return p.get(k) if k else None


HOTSPOT_PS = r"""$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType = WindowsRuntime]
  $null = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager, Windows.Networking.NetworkOperators, ContentType = WindowsRuntime]
  $ut = @{paa = $false; ssid = $null; passord = $null; kan = $false; klienter = 0}
  $profiler = [Windows.Networking.Connectivity.NetworkInformation]::GetConnectionProfiles()
  foreach ($p in $profiler) {
    try {
      $cap = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::GetTetheringCapabilityFromConnectionProfile($p)
      if ("$cap" -eq 'Enabled') { $ut.kan = $true }
      $m = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($p)
      if ("$($m.TetheringOperationalState)" -eq 'On') {
        $c = $m.GetCurrentAccessPointConfiguration()
        $ut.paa = $true; $ut.ssid = $c.Ssid; $ut.passord = $c.Passphrase; try { $ut.klienter = [int]$m.ClientCount } catch { }
        break
      }
    } catch { }
  }
  $ut | ConvertTo-Json -Compress
} catch { '{"paa":false,"kan":false}' }
"""


def hotspot_status() -> Dict[str, Any]:
    """Står Windows' mobile hotspot på, og hva heter det og hvilket passord har det?
    Bare lesing: NABE slår ikke hotspot av eller på. Hurtigbuffret i noen sekunder."""
    t, v = M.get("hotspot", (0.0, None))
    if time.time() - t < 6 and v is not None:
        return v
    v = {"paa": False, "ssid": None, "passord": None, "kan": False, "klienter": 0}
    if ln.er_windows():
        fil = None
        try:
            import tempfile
            with tempfile.NamedTemporaryFile("w", suffix=".ps1", delete=False, encoding="utf-8-sig") as f:
                f.write(HOTSPOT_PS)
                fil = f.name
            r = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fil],
                               capture_output=True, text=True, timeout=20, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            d = json.loads(r.stdout.strip().splitlines()[-1])
            v = {"paa": bool(d.get("paa")), "ssid": d.get("ssid"), "passord": d.get("passord"), "kan": bool(d.get("kan")), "klienter": int(d.get("klienter") or 0)}
        except Exception:
            pass
        finally:
            if fil:
                try:
                    os.unlink(fil)
                except OSError:
                    pass
    M["hotspot"] = (time.time(), v)
    return v


def brannmur_skript(port: int) -> str:
    return ("$ErrorActionPreference = 'Stop'\n"
            f"Get-NetFirewallRule -DisplayName '{BRANNMUR_NAVN}' -ErrorAction SilentlyContinue | Remove-NetFirewallRule\n"
            f"New-NetFirewallRule -DisplayName '{BRANNMUR_NAVN}' -Direction Inbound -Protocol TCP -LocalPort {int(port)} "
            "-Action Allow -RemoteAddress LocalSubnet -Profile Any | Out-Null\n")


# ------------------------------------------------------------- test oppsettet

def sjekkliste(f: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Fra fakta om denne PC-en til en liste med hva som er i orden og hva som ikke er det.
    Ren funksjon: ingen oppslag, så den kan testes uten nett. Status er ok, merk, feil eller ukjent,
    og hver linje sier selv hva du kan gjøre (fiks: start, brannmur, hotspot, lokal)."""
    ut: List[Dict[str, Any]] = []

    def legg(id_: str, status_: str, tittel: Tuple[str, str], detalj: Tuple[str, str] = ("", ""), fiks: str = "") -> None:
        ut.append({"id": id_, "status": status_, "tittel": list(tittel), "detalj": list(detalj), "fiks": fiks})

    kabel = [k for k in f.get("kort", []) if k.get("kabel") and not re.search(r"wi-?fi|wlan|wireless", k.get("navn", ""), re.I)]
    kabel_opp = [k for k in kabel if k.get("opp")]
    ekte = [k for k in kabel_opp if any(not ln.er_linklokal(a["ip"]) for a in k.get("adresser", []))]
    if ekte:
        k = ekte[0]
        ip = next(a["ip"] for a in k["adresser"] if not ln.er_linklokal(a["ip"]))
        legg("kabel", "ok", ("Kabel tilkoblet", "Cable connected"), (f"{k['navn']}, {ip}", f"{k['navn']}, {ip}"))
    elif kabel_opp:
        legg("kabel", "merk", ("Kabelen mangler adresse", "The cable has no address"),
             ("Kortet er oppe, men har bare en selvtildelt adresse. Bruk Koble direkte for å sette en adresse i samme område som enheten.",
              "The adapter is up but only has a self-assigned address. Use Connect directly to set an address in the same range as the device."), "lokal")
    else:
        legg("kabel", "merk", ("Ingen kabel tilkoblet", "No cable connected"),
             ("Det går fint med Wi-Fi, men på en igangkjøring er kabel til enheten tryggest.", "Wi-Fi works, but on a commissioning a cable to the device is safest."))

    paa = bool(f.get("mobil_paa"))
    if paa:
        legg("mobil", "ok", ("Mobiltilgang er på", "Mobile access is on"), (f"Port {f.get('port')}", f"Port {f.get('port')}"))
    else:
        legg("mobil", "merk", ("Mobiltilgang er av", "Mobile access is off"),
             ("Slå den på for å få kode og QR.", "Turn it on to get a code and QR."), "start")

    if paa:
        nar = f.get("nar") or {}
        if not nar:
            legg("nar", "merk", ("Ingen adresse å nå telefonen på", "No address to reach the phone on"),
                 ("PC-en har ikke noe nett telefonen kan bli med i. Slå på hotspot, eller koble PC-en til samme Wi-Fi som telefonen.",
                  "The PC has no network the phone can join. Turn on the hotspot, or put the PC on the same Wi-Fi as the phone."), "hotspot")
        else:
            feil = [ip for ip, ok in nar.items() if not ok]
            if feil:
                legg("nar", "feil", ("Porten svarer ikke", "The port does not answer"),
                     ("Ikke nådd på " + ", ".join(feil) + ". Brannmuren eller et annet program kan stå i veien.",
                      "Not reached on " + ", ".join(feil) + ". The firewall or another program may be in the way."), "brannmur")
            else:
                legg("nar", "ok", ("Porten svarer på PC-ens adresser", "The port answers on the PC's addresses"),
                     (", ".join(nar), ", ".join(nar)))

    bm = f.get("brannmur")
    if bm is True:
        legg("brannmur", "ok", ("Brannmuren slipper inn lokalt", "The firewall lets the local network in"))
    elif bm is False:
        wp = f.get("wifi_profil") or {}
        if str(wp.get("kat")) == "Public":
            legg("brannmur", "feil", ("Windows slipper ikke telefonen inn", "Windows does not let the phone in"),
                 (f"Nettet «{wp.get('navn') or ''}» er satt som offentlig, og da stenger Windows for alt som kommer utenfra. Trykk Åpne, så lager NABE en regel bare for det lokale nettet. Windows spør om administrator.",
                  f"The network “{wp.get('navn') or ''}” is set as public, and then Windows shuts out everything from outside. Press Open and NABE makes a rule for the local network only. Windows asks for an administrator."), "brannmur")
        else:
            legg("brannmur", "merk", ("Ingen brannmurregel for NABE", "No firewall rule for NABE"),
                 ("Windows kan stoppe telefonen første gang. Regelen gjelder bare det lokale nettet.", "Windows may stop the phone the first time. The rule only covers the local network."), "brannmur")
    else:
        legg("brannmur", "ukjent", ("Brannmuren ble ikke sjekket", "The firewall was not checked"),
             ("Windows ga ikke svar. Det går ofte bra likevel.", "Windows gave no answer. It often works anyway."))

    wp = f.get("wifi_profil") or {}
    if wp.get("navn") and re.search(r"gjest|guest|iot|visitor|besøk|public|hotel|hotell|free", str(wp["navn"]), re.I):
        legg("wifi_iso", "merk", ("Wi-Fi-et ser ut som et gjeste- eller IoT-nett", "The Wi-Fi looks like a guest or IoT network"),
             (f"«{wp['navn']}». Slike nett skjuler ofte enhetene for hverandre, og da når ikke telefonen PC-en selv om alt her er riktig. Bruk hotspot på telefonen og koble PC-en til det.",
              f"“{wp['navn']}”. Such networks often hide devices from each other, and then the phone cannot reach the PC even when everything here is right. Use the hotspot on the phone and join the PC to it."))

    h = f.get("hotspot") or {}
    if f.get("hotspot_sperret") and not h.get("paa"):
        legg("hotspot", "merk", ("Hotspot er sperret på denne PC-en", "The hotspot is blocked on this PC"),
             ("Windows sa nei da NABE prøvde, og innstillingen er styrt av organisasjonen. Slå på hotspot på telefonen og koble PC-en til det, eller bruk USB-deling fra telefonen.",
              "Windows said no when NABE tried, and the setting is managed by the organisation. Turn on the hotspot on the phone and join the PC to it, or use USB tethering from the phone."))
    elif h.get("paa"):
        n = int(h.get("klienter") or 0)
        legg("hotspot", "ok", ("Hotspot er på", "Hotspot is on"),
             (f"{h.get('ssid') or ''}, {n} tilkoblet", f"{h.get('ssid') or ''}, {n} connected"))
    elif h.get("kan"):
        legg("hotspot", "merk", ("Hotspot er av", "Hotspot is off"), ("NABE kan slå det på. Det deler PC-ens nett.", "NABE can turn it on. It shares the PC's network."), "hotspot")
    else:
        legg("hotspot", "merk", ("Hotspot kan ikke deles herfra", "The hotspot cannot be shared from here"),
             ("Windows sier at det ikke finnes noe nett å dele, eller at kortet ikke kan. Samme Wi-Fi fungerer likevel.",
              "Windows says there is no network to share, or that the adapter cannot. The same Wi-Fi works anyway."))

    if f.get("wifi") and not ekte and not h.get("paa"):
        legg("wifi", "merk", ("PC-en er på Wi-Fi", "The PC is on Wi-Fi"),
             (f"{f['wifi']}. Hotspot på samme kort kan kutte den tilkoblingen en stund. En kabel til enheten og Wi-Fi til hotspot går bra.",
              f"{f['wifi']}. A hotspot on the same adapter can cut that connection for a while. A cable to the device and Wi-Fi for the hotspot works fine."))

    n_arp = int(f.get("arp") or 0)
    if n_arp:
        legg("arp", "ok", ("Telefoner kan kjennes igjen", "Phones can be recognised"), (f"{n_arp} naboer sett", f"{n_arp} neighbours seen"))
    else:
        legg("arp", "ukjent", ("Ingen naboer sett ennå", "No neighbours seen yet"),
             ("Husk-funksjonen kjenner telefonen på MAC-adressen, og den vises først når telefonen har snakket med PC-en.",
              "Remember recognises the phone by its MAC address, which shows up once the phone has talked to the PC."))

    if f.get("skriv"):
        legg("skriv", "merk", ("Skriving fra mobil er på", "Writing from the phone is on"),
             ("Alt telefonen setter slippes av seg selv.", "Everything the phone sets is released by itself."))
    else:
        legg("skriv", "ok", ("Skriving fra mobil er av", "Writing from the phone is off"),
             ("Slå den på når du skal prøve pådrag.", "Turn it on when you want to try outputs."))
    return ut


def sjekk_sammendrag(liste: List[Dict[str, Any]]) -> Dict[str, int]:
    ut = {"ok": 0, "merk": 0, "feil": 0, "ukjent": 0}
    for r in liste:
        ut[r["status"]] = ut.get(r["status"], 0) + 1
    return ut


def _naa(ip: str, port: int) -> bool:
    try:
        with socket.create_connection((ip, port), timeout=1.5):
            return True
    except OSError:
        return False


def samle_fakta() -> Dict[str, Any]:
    kort = ln.kort_liste()
    paa = bool(M["server"])
    nar = {a["ip"]: _naa(a["ip"], M["port"]) for a in adresser(M["port"])} if paa else {}
    hot = hotspot_status() if ln.er_windows() else {}
    return {"kort": kort, "mobil_paa": paa, "port": M["port"], "nar": nar, "skriv": bool(M["skriv"]),
            "brannmur": brannmur_finnes() if paa else None, "hotspot": hot, "arp": len(arp_tabell()), "wifi": wifi_klient(),
            "wifi_profil": (nettprofil_hent() or {}).get(wifi_klient() or ""), "hotspot_sperret": bool(M.get("hotspot_sperret"))}


def oppsettsjekk() -> Dict[str, Any]:
    liste = sjekkliste(samle_fakta())
    return {"status": "done", "sjekk": liste, "sammendrag": sjekk_sammendrag(liste), "t": int(time.time())}


def status() -> Dict[str, Any]:
    naa = time.time()
    paa = bool(M["server"])
    with LAAS:
        _rens(naa)
        kopi = [(okt_id(t), dict(o)) for t, o in M["okter"].items()]
    kopi = gruppe_okter(kopi)
    # MAC-oppslaget kan ta et sekund, og skal ikke holde låsen mens telefoner prøver å logge inn.
    par_macs = {e.get("mac") for e in par_les()["enheter"]}
    okter = []
    for oid, o in kopi:
        mac = mac_for(o["ip"])
        okter.append({"id": oid, "navn": o["navn"], "ip": o["ip"], "sist": int(o["sist"]), "laget": int(o["laget"]),
                      "par": bool(mac and mac in par_macs), "kan_pare": bool(mac and mac not in par_macs)})
    return {
        "status": "done", "paa": paa, "port": M["port"], "skriv": M["skriv"], "maks_min": M["maks_min"],
        "kode": M["kode"] if paa and M["kode"] and naa < M["kode_til"] else None,
        "kode_rest_s": max(0, int(M["kode_til"] - naa)) if paa else 0,
        "av_rest_s": max(0, int(M["til"] - naa)) if paa else 0,
        "adresser": adresser(M["port"]) if paa else [],
        "okter": okter, "par": par_status(), "logg": list(M["logg"])[-40:][::-1],
        "brannmur": _ferske("brannmur", brannmur_finnes, 20) if paa else None,
        "hotspot": _ferske("hotspot", hotspot_status, 3) if paa else None,
        "hotspot_vaar": bool(M.get("hotspot_vaar")),
        "hotspot_sperret": bool(M.get("hotspot_sperret")),
        "wifi_profil": wifi_profil() if paa else None,
        "wifi_klient": _ferske("wifi_klient", lambda: M.__setitem__("wifi_klient", (time.time(), wifi_klient())), 8) if paa else None,
    }
