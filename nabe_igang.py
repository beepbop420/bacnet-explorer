"""
Igangkjøringsprotokoller fra FastEL (PHB-M0801): leses og fylles ut.

Protokollen er en Excel-arbeidsbok med makroer og skjemaknapper, ett ark per tavle («Aut 360.001»), pluss skjulte
maler. openpyxl lagrer om hele boka og mister skjemaknappene, så her leses arkene med zipfile/ElementTree, og
utfylling gjøres som tekstredigering i arkenes XML. Alt annet i fila (makroer, kontroller, bilder, formler,
formatering) følger med uendret.

Regler som gjør utfylling trygg:
  - Bare tomme celler fylles. Det noen har skrevet selv overskrives aldri.
  - Bare navngitte felt skrives (I/O, Prog.-funksjon, Merknader ...), ikke vilkårlige celler.
  - Celler med formel røres ikke.
  - Boka settes til å regne ut på nytt når den åpnes, slik at tellerne øverst stemmer.
"""
from __future__ import annotations

import io
import re
import zipfile
import xml.etree.ElementTree as ET
from typing import Any, Dict, List, Optional, Tuple

M = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS = {"m": M}


def _kol_tall(k: str) -> int:
    n = 0
    for ch in k:
        n = n * 26 + (ord(ch) - 64)
    return n


def _tall_kol(n: int) -> str:
    s = ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def _del(ref: str) -> Tuple[str, int]:
    m = re.fullmatch(r"([A-Z]+)(\d+)", ref)
    return m.group(1), int(m.group(2))


def _norm(t: Any) -> str:
    return re.sub(r"[^a-z0-9æøå]+", "", str(t or "").lower())


# Overskriftene i protokollen, normalisert, mot feltene NABE kjenner. Eldre og nyere maler staver litt ulikt
# («Bilde (CP)», «Bilde (Citect)», «Bilde (SD)»), så det er starten av navnet som teller.
FELT = [
    ("modul", lambda n: n == "modul"),
    ("kanal", lambda n: n == "kanalnr"),
    ("system", lambda n: n == "systemnr"),
    ("komp", lambda n: n == "komponent"),
    ("plass", lambda n: n == "plassering"),
    ("funk", lambda n: n == "funksjon"),
    ("io", lambda n: n == "io"),
    ("prog", lambda n: n.startswith("progfunksjon")),
    ("bilde", lambda n: n.startswith("bilde")),
    ("merk", lambda n: n == "merknader"),
    ("testet", lambda n: n.startswith("testet")),
    ("intern", lambda n: n.startswith("merknadforintern")),
    ("feilbesk", lambda n: n.startswith("beskrivelseavfeil")),
]
# Hvilke felt NABE har lov til å skrive i en rad
SKRIVBARE = {"io", "prog", "merk", "testet", "intern", "feilbesk"}


def _strenger(z: zipfile.ZipFile) -> List[str]:
    if "xl/sharedStrings.xml" not in z.namelist():
        return []
    ut = []
    for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
        ut.append("".join(t.text or "" for t in si.iter("{%s}t" % M)))
    return ut


def _ark_filer(z: zipfile.ZipFile) -> List[Dict[str, str]]:
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    ut = []
    for s in wb.find("m:sheets", NS):
        mål = rels.get(s.get("{%s}id" % R), "")
        sti = "xl/" + mål.lstrip("/").replace("xl/", "", 1) if not mål.startswith("/xl/") else mål.lstrip("/")
        ut.append({"navn": s.get("name") or "", "tilstand": s.get("state") or "", "sti": sti})
    return ut


def _celler(xml: bytes, tekster: List[str]) -> Tuple[Dict[int, Dict[str, str]], List[str], set]:
    """Verdiene i et ark som {rad: {kolonne: tekst}}, flettede områder, og cellene som har formel."""
    rot = ET.fromstring(xml)
    rader: Dict[int, Dict[str, str]] = {}
    formler = set()
    for rad in rot.iter("{%s}row" % M):
        for c in rad.findall("m:c", NS):
            ref = c.get("r") or ""
            k, nr = _del(ref)
            if c.find("m:f", NS) is not None:
                formler.add(ref)
            v, isel, t = c.find("m:v", NS), c.find("m:is", NS), c.get("t")
            val = None
            if t == "s" and v is not None:
                try:
                    val = tekster[int(v.text)]
                except (ValueError, IndexError):
                    val = None
            elif t == "inlineStr" and isel is not None:
                val = "".join(x.text or "" for x in isel.iter("{%s}t" % M))
            elif v is not None:
                val = v.text
            if val not in (None, ""):
                rader.setdefault(nr, {})[k] = str(val)
    flett = [m.get("ref") for m in rot.iter("{%s}mergeCell" % M) if m.get("ref")]
    return rader, flett, formler


def _flett_slutt(flett: List[str], ref: str) -> str:
    """Siste kolonne i det flettede området som starter i `ref` (eller kolonnen selv)."""
    k, nr = _del(ref)
    for f in flett:
        a, _, b = f.partition(":")
        if a == ref and b:
            return _del(b)[0]
    return k


def _verdi_celle(flett: List[str], ref: str) -> str:
    """Cellen til høyre for en etikett, forbi etikettens flettede område: der verdien skal stå."""
    k, nr = _del(ref)
    slutt = _flett_slutt(flett, ref)
    # Etiketten er flettet over flere kolonner (Merknad): verdien står rett etter. Ikke flettet (Ferdig igangkjørt,
    # Ansvarlig): malen har etiketten i B og skrivefeltet i E, med to kolonner mellom.
    steg = 1 if slutt != k else 3
    return _tall_kol(_kol_tall(slutt) + steg) + str(nr)


def les(data: bytes) -> Dict[str, Any]:
    """Protokollarkene i boka: tavle, anlegg, kolonnene og radene, og hvor toppfeltene står."""
    z = zipfile.ZipFile(io.BytesIO(data))
    tekster = _strenger(z)
    ut = []
    for a in _ark_filer(z):
        if a["tilstand"] in ("hidden", "veryHidden") or a["sti"] not in z.namelist():
            continue
        rader, flett, formler = _celler(z.read(a["sti"]), tekster)
        # Overskriftsraden: den som har Kanalnr., Systemnr. og Prog.-funksjon. Elektroarkene har ikke den siste, og hoppes over.
        hode = None
        for nr in sorted(rader):
            n = {_norm(v) for v in rader[nr].values()}
            # «Kontrollpanel» er oversiktstabellen makroene bygger (Tavlenr., Anleggsnavn ...), ikke en protokoll
            if "kanalnr" in n and "systemnr" in n and "tavlenr" not in n and any(x.startswith("progfunksjon") for x in n):
                hode = nr
                break
        if hode is None:
            continue
        kol: Dict[str, str] = {}
        for k, v in rader[hode].items():
            nv = _norm(v)
            for felt, test in FELT:
                if felt not in kol and test(nv):
                    kol[felt] = k
        info = {"anlegg": "", "tavle": "", "prosjekt": ""}
        topp: Dict[str, Dict[str, str]] = {}
        for nr in sorted(rader):
            if nr >= hode:
                break
            for k, v in rader[nr].items():
                nv = _norm(v)
                ref = f"{k}{nr}"
                if nv == "anlegg":
                    info["anlegg"] = rader[nr].get(_tall_kol(_kol_tall(k) + 1), "")
                elif nv == "tavle":
                    info["tavle"] = rader[nr].get(_tall_kol(_kol_tall(k) + 1), "")
                elif nv == "prosjektnummer":
                    info["prosjekt"] = rader[nr].get(_del(_verdi_celle(flett, ref))[0], "") or rader[nr].get(_tall_kol(_kol_tall(k) + 1), "")
                elif nv.startswith("ferdigigangkjørt"):
                    c = _verdi_celle(flett, ref)
                    topp["ferdig"] = {"ref": c, "verdi": rader[nr].get(_del(c)[0], "")}
                elif nv.startswith("ansvarligforigangkjøring"):
                    c = _verdi_celle(flett, ref)
                    topp["ansvarlig"] = {"ref": c, "verdi": rader[nr].get(_del(c)[0], "")}
                elif nv == "merknad" and nr < 12:
                    c = _verdi_celle(flett, ref)
                    topp["merknad"] = {"ref": c, "verdi": rader[nr].get(_del(c)[0], "")}
        punkter: List[Dict[str, Any]] = []
        tomme = 0
        for nr in range(hode + 1, max(rader) + 1):
            r = rader.get(nr, {})
            rad = {f: r.get(k, "") for f, k in kol.items()}
            if not any(rad.get(f) for f in ("modul", "kanal", "system", "komp")):
                tomme += 1
                if tomme >= 3:
                    break
                continue
            tomme = 0
            rad["rad"] = nr
            rad["ledig"] = not (rad.get("system") or rad.get("komp"))
            # Hvilke av feltene NABE kan skrive som er tomme og uten formel: det er bare dem utfylling rører
            rad["fri"] = [f for f in SKRIVBARE if f in kol and not r.get(kol[f]) and f"{kol[f]}{nr}" not in formler]
            punkter.append(rad)
        ut.append({"navn": a["navn"], "sti": a["sti"], "kolonner": kol, "hode": hode, "info": info, "topp": topp, "rader": punkter})
    return {"ark": ut}


# ------------------------------------------------------------------ utfylling

def _xml_tekst(t: str) -> str:
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _sett_celle(xml: str, ref: str, tekst: str) -> Tuple[str, bool]:
    """Skriver tekst i en tom celle uten å røre noe annet i arket. Gir (ny xml, om det ble skrevet)."""
    k, nr = _del(ref)
    rm = re.search(r'<row\b[^>]*?\br="%d"[^>]*?(?:/>|>.*?</row>)' % nr, xml, re.S)
    if not rm:
        return xml, False
    rad = rm.group(0)
    cm = re.search(r'<c\b[^>]*?\br="%s"[^>]*?(?:/>|>.*?</c>)' % ref, rad, re.S)
    ny_tekst = '<is><t xml:space="preserve">%s</t></is>' % _xml_tekst(tekst)
    if cm:
        gammel = cm.group(0)
        if "<v>" in gammel or "<is>" in gammel or "<f>" in gammel or "<f " in gammel:
            return xml, False                                    # ikke tom, eller formel
        s = re.search(r'\bs="(\d+)"', gammel.split(">", 1)[0])
        ny = '<c r="%s"%s t="inlineStr">%s</c>' % (ref, f' s="{s.group(1)}"' if s else "", ny_tekst)
        ny_rad = rad.replace(gammel, ny, 1)
    else:
        ny = '<c r="%s" t="inlineStr">%s</c>' % (ref, ny_tekst)
        # Inn på riktig plass: før første celle med høyere kolonne, ellers sist i raden
        pos = None
        for m in re.finditer(r'<c\b[^>]*?\br="([A-Z]+)%d"' % nr, rad):
            if _kol_tall(m.group(1)) > _kol_tall(k):
                pos = m.start()
                break
        if rad.endswith("/>"):                                   # tom rad uten celler
            ny_rad = rad[:-2] + ">" + ny + "</row>"
        elif pos is None:
            ny_rad = rad[: rad.rfind("</row>")] + ny + "</row>"
        else:
            ny_rad = rad[:pos] + ny + rad[pos:]
    return xml[: rm.start()] + ny_rad + xml[rm.end():], True


def fyll(data: bytes, fyllinger: List[Dict[str, Any]]) -> Tuple[bytes, Dict[str, int]]:
    """
    Gir en kopi av boka med feltene fylt inn. Hver fylling er {ark, rad, felt, verdi} for en rad,
    eller {ark, topp, verdi} for toppfeltene (ferdig, ansvarlig, merknad).
    """
    innhold = les(data)
    per_ark = {a["navn"]: a for a in innhold["ark"]}
    z = zipfile.ZipFile(io.BytesIO(data))
    nye: Dict[str, str] = {}
    telling = {"fylt": 0, "hoppet": 0}
    for f in fyllinger:
        a = per_ark.get(str(f.get("ark")))
        verdi = str(f.get("verdi") if f.get("verdi") is not None else "").strip()
        if not a or not verdi:
            telling["hoppet"] += 1
            continue
        if f.get("topp"):
            t = a["topp"].get(str(f["topp"]))
            ref = t["ref"] if t and not t["verdi"] else None
        else:
            felt = str(f.get("felt"))
            rad = next((r for r in a["rader"] if r["rad"] == f.get("rad")), None)
            ref = f"{a['kolonner'][felt]}{rad['rad']}" if rad and felt in SKRIVBARE and felt in rad["fri"] and felt in a["kolonner"] else None
        if not ref:
            telling["hoppet"] += 1
            continue
        xml = nye.get(a["sti"]) or z.read(a["sti"]).decode("utf-8")
        xml, ok = _sett_celle(xml, ref, verdi)
        nye[a["sti"]] = xml
        telling["fylt" if ok else "hoppet"] += 1
        # Samme celle skal ikke fylles to ganger i én kjøring
        if ok and not f.get("topp"):
            rad["fri"].remove(felt)
        elif ok:
            a["topp"][str(f["topp"])]["verdi"] = verdi
    ut = io.BytesIO()
    with zipfile.ZipFile(ut, "w", zipfile.ZIP_DEFLATED) as w:
        for info in z.infolist():
            b = z.read(info.filename)
            if info.filename in nye:
                b = nye[info.filename].encode("utf-8")
            elif info.filename == "xl/workbook.xml" and nye:
                s = b.decode("utf-8")
                if "<calcPr" in s and "fullCalcOnLoad" not in s:
                    s = s.replace("<calcPr", '<calcPr fullCalcOnLoad="1"', 1)
                elif "<calcPr" not in s:
                    s = s.replace("</workbook>", '<calcPr fullCalcOnLoad="1"/></workbook>')
                b = s.encode("utf-8")
            w.writestr(info, b, compress_type=zipfile.ZIP_DEFLATED)
    return ut.getvalue(), telling
