"""
NABE - koble direkte til en enhet på kabelen.

Situasjonen: PC-en står rett i regulatoren (eller i en switch med bare
anleggsnettet), og Windows har gitt kortet en adresse i feil nett, eller
ingen i det hele tatt (169.254.x.x). Da må teknikeren sette en fast IP i samme
område som enheten, huske å gå tilbake etterpå, og huske hva som funket sist.

Dette modulet gjør det til tre trykk:
  1. finn: spør kabelen (Who-Is) og lytt, eller ta imot en IP du skriver
  2. foreslå: en ledig adresse i enhetens nett, gjerne den du brukte sist
  3. sett og angre: legg adressen på kortet og husk hvordan kortet var før

NABE skriver ikke til anlegg her. Det eneste som endres er PC-ens eget
nettverkskort, bare når teknikeren trykker, og Windows spør om
administratorrettigheter selv. Alt er også tilgjengelig som kommando
som kan kopieres, for PC-er der administrator er låst.

Rene funksjoner (forslag, skript, validering) holdes adskilt fra det som
rører nettet og Windows, slik at de kan testes uten kort og uten rettigheter.
"""
import ipaddress
import json
import os
import re
import select
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

WHOIS = bytes.fromhex("810b000c0120ffff00ff1008")
# Navn på kort som aldri er "kabelen": virtuelle kort og tunneler.
VIRTUELL = re.compile(r"loopback|bluetooth|vmware|virtualbox|vethernet|wsl|tailscale|wireguard|forti|vpn|\btap\b|hyper-v|docker|npcap|wg-|cellular|local area connection\*", re.I)
GYLDIG_NAVN = re.compile(r"^[\w .\-()]{1,64}$")
PREFERT = [200, 201, 202, 250, 199, 100, 101]


# ---------------------------------------------------------------- rene deler

def er_linklokal(ip: str) -> bool:
    return str(ip).startswith("169.254.")


def nett_for(ip: str, prefix: int) -> ipaddress.IPv4Network:
    return ipaddress.IPv4Network(f"{ip}/{prefix}", strict=False)


def foreslaa_ip(nett: ipaddress.IPv4Network, opptatt, husket: Optional[str] = None) -> Optional[str]:
    """En ledig adresse i nettet. Den du brukte sist vinner, ellers .200 og noen faste
    steder høyt i området, så ruller vi nedover fra toppen. Aldri enhetens egen."""
    opptatt = {str(x) for x in opptatt}
    hoste = set(nett.hosts()) if nett.num_addresses <= 65536 else None

    def ledig(ip) -> bool:
        s = str(ip)
        if s in opptatt:
            return False
        if hoste is not None:
            return ipaddress.IPv4Address(s) in hoste
        return ipaddress.IPv4Address(s) in nett and ipaddress.IPv4Address(s) not in (nett.network_address, nett.broadcast_address)

    if husket:
        try:
            if ipaddress.IPv4Address(husket) in nett and ledig(husket):
                return husket
        except ValueError:
            pass
    for siste in PREFERT:
        ip = nett.network_address + siste
        if ip in nett and ledig(ip):
            return str(ip)
    ip = nett.broadcast_address - 2
    for _ in range(min(nett.num_addresses, 4096)):
        if ip <= nett.network_address:
            break
        if ledig(ip):
            return str(ip)
        ip -= 1
    return None


def valider(kort: str, ip: str, prefix: int, kjente_kort: List[str]) -> Optional[str]:
    """Teksten på feilen, eller None. Brukes før noe blir sendt til Windows."""
    if kort not in kjente_kort or not GYLDIG_NAVN.match(kort or ""):
        return "Ukjent nettverkskort"
    try:
        a = ipaddress.IPv4Address(ip)
    except ValueError:
        return "Ugyldig IP-adresse"
    if not (8 <= int(prefix) <= 30):
        return "Prefikslengden må være mellom 8 og 30"
    if a.is_loopback or a.is_multicast or a.is_unspecified or a.is_link_local or a.is_reserved:
        return "Den adressen kan ikke brukes på et kort"
    n = nett_for(ip, int(prefix))
    if a in (n.network_address, n.broadcast_address):
        return "Adressen er nett- eller kringkastingsadresse"
    return None


def _q(s: str) -> str:
    return "'" + str(s).replace("'", "''") + "'"


def bygg_skript(modus: str, kort: str, ip: str = "", prefix: int = 24, for_dhcp: bool = True, fjern: str = "") -> str:
    """PowerShell som gjør endringen. Verdiene er validert på forhånd og siteres likevel.
    `fjern` er en adresse NABE satte tidligere og som skal vekk først."""
    topp = "$ErrorActionPreference = 'Stop'\n$n = " + _q(kort) + "\n"
    if fjern and modus in ("static", "legg_til"):
        topp += f"Remove-NetIPAddress -InterfaceAlias $n -IPAddress {_q(fjern)} -Confirm:$false -ErrorAction SilentlyContinue\n"
    if modus == "static":
        return (topp
                + "Set-NetIPInterface -InterfaceAlias $n -AddressFamily IPv4 -Dhcp Disabled\n"
                + "Get-NetIPAddress -InterfaceAlias $n -AddressFamily IPv4 -ErrorAction SilentlyContinue"
                + " | Where-Object { $_.IPAddress -notlike '169.254.*' }"
                + " | Remove-NetIPAddress -Confirm:$false -ErrorAction SilentlyContinue\n"
                + f"New-NetIPAddress -InterfaceAlias $n -AddressFamily IPv4 -IPAddress {_q(ip)} -PrefixLength {int(prefix)} | Out-Null\n")
    if modus == "legg_til":
        return (topp
                + f"New-NetIPAddress -InterfaceAlias $n -AddressFamily IPv4 -IPAddress {_q(ip)} -PrefixLength {int(prefix)} | Out-Null\n")
    if modus == "tilbake":
        s = topp
        if ip:
            s += f"Remove-NetIPAddress -InterfaceAlias $n -IPAddress {_q(ip)} -Confirm:$false -ErrorAction SilentlyContinue\n"
        if for_dhcp:
            s += ("Get-NetIPAddress -InterfaceAlias $n -AddressFamily IPv4 -ErrorAction SilentlyContinue"
                  " | Where-Object { $_.PrefixOrigin -eq 'Manual' } | Remove-NetIPAddress -Confirm:$false -ErrorAction SilentlyContinue\n"
                  "Set-DnsClientServerAddress -InterfaceAlias $n -ResetServerAddresses\n"
                  "Set-NetIPInterface -InterfaceAlias $n -AddressFamily IPv4 -Dhcp Enabled\n")
        return s
    raise ValueError("ukjent modus")


def kommando_tekst(modus: str, kort: str, ip: str = "", prefix: int = 24, for_dhcp: bool = True, fjern: str = "") -> str:
    """Samme som skriptet, men som en linje som kan limes inn i et administrator-vindu."""
    return bygg_skript(modus, kort, ip, prefix, for_dhcp, fjern).replace("$ErrorActionPreference = 'Stop'\n", "").replace("\n", "; ").strip("; ")


def les_i_am(data: bytes) -> Optional[int]:
    """Enhetsinstansen i en I-Am, eller None om pakka ikke er en."""
    if not data or data[0] != 0x81:
        return None
    i = data.find(b"\x10\x00\xc4")
    if i < 0 or len(data) < i + 7:
        return None
    obj = int.from_bytes(data[i + 3:i + 7], "big")
    return obj & 0x3FFFFF if (obj >> 22) == 8 else None


def utenfor(adresser: List[Dict[str, Any]], ip: str) -> bool:
    """True når ip ikke ligger i noen av nettene PC-en selv står i."""
    try:
        a = ipaddress.IPv4Address(ip)
    except ValueError:
        return False
    for k in adresser:
        try:
            if a in nett_for(k["ip"], int(k["prefix"])) and not er_linklokal(k["ip"]):
                return False
        except Exception:
            continue
    return True


def velg_kort(kort: List[Dict[str, Any]], via: Optional[str] = None) -> Optional[str]:
    """Kortet som mest sannsynlig sitter på kabelen: det enheten svarte på, ellers et
    kort uten ordentlig adresse, ellers første ekte kort som er oppe."""
    navn = {k["navn"] for k in kort}
    if via and via in navn:
        return via
    for k in kort:
        if k["kabel"] and k["linklokal"]:
            return k["navn"]
    for k in kort:
        if k["kabel"]:
            return k["navn"]
    return None


def lag_forslag(hort: List[Dict[str, Any]], kort: List[Dict[str, Any]], husket: Dict[str, Any],
                prefix_for: Optional[Dict[str, int]] = None, opptatt_ekstra=()) -> List[Dict[str, Any]]:
    """En rad per nett det finnes enheter i som PC-en ikke står i."""
    alle = [{"ip": a["ip"], "prefix": a["prefix"]} for k in kort for a in k["adresser"]]
    grupper: Dict[str, Dict[str, Any]] = {}
    for h in hort:
        ip = h["ip"]
        if not utenfor(alle, ip):
            continue
        pre = int((prefix_for or {}).get(ip, 0) or 24)
        n = nett_for(ip, pre)
        g = grupper.setdefault(str(n), {"nett": str(n), "prefix": pre, "enheter": [], "via": h.get("via")})
        g["enheter"].append({"ip": ip, "instans": h.get("instans")})
        if not g["via"]:
            g["via"] = h.get("via")
    ut = []
    for nokkel, g in grupper.items():
        n = ipaddress.IPv4Network(nokkel)
        h = husket.get(nokkel) or {}
        opptatt = [e["ip"] for e in g["enheter"]] + list(opptatt_ekstra)
        ip = foreslaa_ip(n, opptatt, h.get("ip"))
        kortnavn = velg_kort(kort, g["via"] or h.get("kort"))
        ut.append({
            "nett": nokkel, "prefix": g["prefix"], "enheter": g["enheter"], "ip": ip,
            "kort": kortnavn, "husket": bool(h.get("ip") and h.get("ip") == ip),
        })
    ut.sort(key=lambda r: (-len(r["enheter"]), r["nett"]))
    return ut


# ---------------------------------------------------------- Windows og nettet

def er_windows() -> bool:
    return sys.platform.startswith("win")


def er_admin() -> bool:
    try:
        if er_windows():
            import ctypes
            return bool(ctypes.windll.shell32.IsUserAnAdmin())
        return os.geteuid() == 0
    except Exception:
        return False


def kort_liste() -> List[Dict[str, Any]]:
    """Alle kort med adresser, også de som bare har 169.254.x.x."""
    import psutil
    try:
        stats = psutil.net_if_stats()
    except Exception:
        stats = {}
    ut = []
    for navn, addrs in psutil.net_if_addrs().items():
        adr = []
        for a in addrs:
            if a.family != socket.AF_INET or a.address.startswith("127."):
                continue
            try:
                pre = ipaddress.IPv4Network(f"0.0.0.0/{a.netmask}").prefixlen if a.netmask else 32
            except Exception:
                pre = 32
            adr.append({"ip": a.address, "prefix": pre})
        opp = bool(stats[navn].isup) if navn in stats else True
        if not adr and not opp:
            continue
        ut.append({
            "navn": navn, "opp": opp, "adresser": adr,
            "linklokal": bool(adr) and all(er_linklokal(a["ip"]) for a in adr),
            "virtuell": bool(VIRTUELL.search(navn)),
            # En kabel har et nett med flere adresser. /32 og /31 er tunneler og punkt-til-punkt.
            "kabel": opp and not VIRTUELL.search(navn) and (not adr or any(a["prefix"] < 31 for a in adr)),
        })
    return ut


def naboer() -> List[str]:
    """Adresser Windows allerede kjenner på nettene sine (arp). Brukes bare for å unngå dem."""
    try:
        r = subprocess.run(["arp", "-a"], capture_output=True, text=True, timeout=4,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return sorted(set(re.findall(r"\b(\d{1,3}(?:\.\d{1,3}){3})\b", r.stdout)))
    except Exception:
        return []


def lytt(kort: List[Dict[str, Any]], port: int, sek: float = 3.0) -> Dict[str, Any]:
    """Send Who-Is ut av hvert kort som er oppe og lytt. Gir alle avsendere som sa fra,
    også de som står i et annet nett. Bare lesing: Who-Is er et spørsmål, ikke en endring."""
    egne = {a["ip"] for k in kort for a in k["adresser"]}
    sendere: Dict[socket.socket, str] = {}
    rx: Optional[socket.socket] = None
    try:
        rx = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        rx.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        rx.bind(("", port))
    except OSError:
        if rx is not None:
            try:
                rx.close()
            except Exception:
                pass
        rx = None
    for k in kort:
        if not k["kabel"]:
            continue
        for a in k["adresser"]:
            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
                s.bind((a["ip"], 0))
                s.setblocking(False)
                sendere[s] = k["navn"]
            except OSError:
                continue
    def send():
        for s, navn in sendere.items():
            kort_adr = next((a for kk in kort if kk["navn"] == navn for a in kk["adresser"]), None)
            mal = ["255.255.255.255"]
            try:
                if kort_adr:
                    mal.append(str(nett_for(kort_adr["ip"], kort_adr["prefix"]).broadcast_address))
            except Exception:
                pass
            for m in dict.fromkeys(mal):
                try:
                    s.sendto(WHOIS, (m, port))
                except OSError:
                    pass
    hort: Dict[str, Dict[str, Any]] = {}
    lyttere = list(sendere) + ([rx] if rx else [])
    slutt = time.time() + sek
    send()
    sendt_igjen = False
    try:
        while time.time() < slutt and lyttere:
            if not sendt_igjen and time.time() > slutt - sek / 2:
                send()
                sendt_igjen = True
            klar, _, _ = select.select(lyttere, [], [], 0.25)
            for s in klar:
                try:
                    data, adr = s.recvfrom(1500)
                except OSError:
                    continue
                if not data or data[0] != 0x81 or adr[0] in egne or adr[0].startswith("127."):
                    continue
                h = hort.setdefault(adr[0], {"ip": adr[0], "instans": None, "via": None})
                inst = les_i_am(data)
                if inst is not None:
                    h["instans"] = inst
                if s in sendere:
                    h["via"] = sendere[s]
    finally:
        for s in lyttere:
            try:
                s.close()
            except Exception:
                pass
    return {"hort": sorted(hort.values(), key=lambda h: tuple(int(x) for x in h["ip"].split("."))), "rx": rx is not None,
            "kort": sorted({n for n in sendere.values()})}


def kort_dhcp(navn: str) -> Optional[bool]:
    """Bruker kortet automatisk adresse nå? None når det ikke kan leses."""
    if not er_windows() or not GYLDIG_NAVN.match(navn or ""):
        return None
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-Command",
                            f"(Get-NetIPInterface -InterfaceAlias {_q(navn)} -AddressFamily IPv4).Dhcp"],
                           capture_output=True, text=True, timeout=15,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        t = r.stdout.strip().lower()
        return True if t == "enabled" else False if t == "disabled" else None
    except Exception:
        return None


def kjor_skript(skript: str, data_dir: Path, timeout: int = 120) -> Dict[str, Any]:
    """Kjør skriptet med administratorrettigheter. Windows viser selv sin egen godkjenning;
    avslår teknikeren den, kommer det en feilmelding tilbake og ingenting er endret."""
    if not er_windows():
        return {"ok": False, "feil": "Bare Windows kan endre kortet herfra. Bruk kommandoen i stedet."}
    fil = Path(tempfile.mkdtemp(prefix="nabe-ip-", dir=str(data_dir))) / "sett.ps1"
    try:
        fil.write_text(skript, encoding="utf-8-sig")
        flagg = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        if er_admin():
            r = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(fil)],
                               capture_output=True, text=True, timeout=timeout, creationflags=flagg)
        else:
            ps = ("$p = Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden "
                  "-ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File'," + _q(str(fil)) + "; exit $p.ExitCode")
            r = subprocess.run(["powershell", "-NoProfile", "-Command", ps],
                               capture_output=True, text=True, timeout=timeout, creationflags=flagg)
        if r.returncode == 0:
            return {"ok": True}
        tekst = (r.stderr or r.stdout or "").strip()
        avbrutt = "canceled" in tekst.lower() or "avbrutt" in tekst.lower() or "cancelled" in tekst.lower()
        return {"ok": False, "avbrutt": avbrutt, "feil": tekst[:300] or f"Koden {r.returncode}"}
    except subprocess.TimeoutExpired:
        return {"ok": False, "feil": "Tok for lang tid. Godkjenningen kan ha blitt stående bak et annet vindu."}
    except Exception as e:
        return {"ok": False, "feil": str(e)[:300]}
    finally:
        try:
            fil.unlink()
            fil.parent.rmdir()
        except Exception:
            pass


# ------------------------------------------------------------------- minnet

def les(fil: Path) -> Dict[str, Any]:
    try:
        d = json.loads(fil.read_text(encoding="utf-8"))
        if isinstance(d, dict):
            d.setdefault("husket", {})
            d.setdefault("satt", {})
            return d
    except Exception:
        pass
    return {"v": 1, "husket": {}, "satt": {}}


def skriv(fil: Path, d: Dict[str, Any]) -> None:
    tmp = fil.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, fil)


def husk(d: Dict[str, Any], nett: str, ip: str, prefix: int, kort: str) -> None:
    d["husket"][nett] = {"ip": ip, "prefix": int(prefix), "kort": kort, "sist": int(time.time())}
    if len(d["husket"]) > 40:
        for k in sorted(d["husket"], key=lambda x: d["husket"][x].get("sist", 0))[:len(d["husket"]) - 40]:
            d["husket"].pop(k, None)


def staar_fortsatt(satt: Dict[str, Any], kort: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Bare det NABE har satt som fortsatt ligger på kortet. Resten er ryddet av andre."""
    ut = {}
    for navn, s in satt.items():
        k = next((x for x in kort if x["navn"] == navn), None)
        if k and any(a["ip"] == s.get("ip") for a in k["adresser"]):
            ut[navn] = s
    return ut
