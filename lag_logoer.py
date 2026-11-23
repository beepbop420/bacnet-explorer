"""Gjør leverandørlogoer om til NABE-merker.

Legg en SVG per leverandør i logoer/ (filnavnet er søkenøkkelen, f.eks. beckhoff.svg), og kjør

    venv\\Scripts\\python.exe lag_logoer.py

Hver SVG gjøres om til en gråtonemaske: det som er farget blir blekk, det som er hvitt blir hull, og alt som er
tekst, bilde eller skript kastes. Resultatet er js/nabe-lev-logo.js, som tegner merket i appens egen tekstfarge,
så det følger lys og mørk visning uten egne farger. Logoer som ikke lar seg gjøre om (tekst som skrift, innebygde bilder,
over 14 kB) hoppes over og står som ordmerke, slik de gjorde før.

Logoene er varemerker for hver sin eier. De vises bare for å kjenne igjen enheten.
"""
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

HER = Path(__file__).parent
MAPPE = HER / "logoer"
UT = HER / "js" / "nabe-lev-logo.js"
MAKS = 14000

NAVNEROM = "http://www.w3.org/2000/svg"
KASTES = {"title", "desc", "metadata", "script", "image", "foreignObject", "text", "tspan", "style"}
FARGENAVN = {"white": (255, 255, 255), "black": (0, 0, 0), "red": (255, 0, 0), "blue": (0, 0, 255), "green": (0, 128, 0),
             "gray": (128, 128, 128), "grey": (128, 128, 128), "yellow": (255, 255, 0), "orange": (255, 165, 0), "silver": (192, 192, 192)}


def farge_rgb(v: str):
    v = v.strip().lower()
    if v in FARGENAVN:
        return FARGENAVN[v]
    m = re.fullmatch(r"#([0-9a-f]{3})", v)
    if m:
        return tuple(int(c * 2, 16) for c in m.group(1))
    m = re.fullmatch(r"#([0-9a-f]{6})([0-9a-f]{2})?", v)
    if m:
        h = m.group(1)
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
    m = re.fullmatch(r"rgba?\(([^)]*)\)", v)
    if m:
        d = [x.strip() for x in re.split(r"[ ,/]+", m.group(1)) if x.strip()]
        try:
            rgb = []
            for x in d[:3]:
                rgb.append(round(float(x[:-1]) * 2.55) if x.endswith("%") else round(float(x)))
            return tuple(max(0, min(255, c)) for c in rgb)
        except ValueError:
            return None
    return None


def gra(v: str) -> str:
    """En farge som en grå: mørkt og fargerikt er blekk (hvitt i masken), lyst og blekt er hull."""
    if v.strip().lower() in ("none", "transparent"):
        return v
    if v.strip().lower().startswith("url("):
        return v
    rgb = farge_rgb(v)
    if rgb is None:
        return "#fff"            # currentColor, inherit og annet vi ikke kjenner: blekk
    lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255
    metning = (max(rgb) - min(rgb)) / 255
    ink = 1.0 if (metning > 0.35 and lum < 0.97) else max(0.0, min(1.0, (0.9 - lum) / 0.45))
    n = round(ink * 255)
    return "#%02x%02x%02x" % (n, n, n)


def stil_om(tekst: str) -> str:
    def rett(m):
        return f"{m.group(1)}:{gra(m.group(2))}"
    return re.sub(r"(fill|stroke|stop-color|flood-color)\s*:\s*([^;\"']+)", rett, tekst)


def lokal(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def rens(el, ut_liste):
    """Går gjennom treet og gjør det om. Gir False hvis noe gjør logoen ubrukelig."""
    for barn in list(el):
        navn = lokal(barn.tag)
        if navn in KASTES:
            if navn in ("text", "image", "foreignObject"):
                ut_liste.append(navn)
            el.remove(barn)
            continue
        if barn.tag.startswith("{") and not barn.tag.startswith("{" + NAVNEROM + "}"):
            el.remove(barn)          # inkscape, sodipodi og andre
            continue
        for a in list(barn.attrib):
            la = lokal(a)
            if a.startswith("{") and "w3.org/1999/xlink" not in a and "w3.org/XML" not in a:
                del barn.attrib[a]
                continue
            if la in ("fill", "stroke", "stop-color", "flood-color"):
                barn.attrib[a] = gra(barn.attrib[a])
            elif la == "style":
                barn.attrib[a] = stil_om(barn.attrib[a])
            elif la in ("class", "id", "filter", "clip-path") and False:
                pass
            elif la.startswith("on"):
                del barn.attrib[a]
        rens(barn, ut_liste)


def tall(s):
    m = re.match(r"\s*(-?[0-9.]+)", s or "")
    return float(m.group(1)) if m else None


def ett(fil: Path):
    rot = ET.fromstring(fil.read_bytes())
    if lokal(rot.tag) != "svg":
        return None, "ikke svg"
    kastet = []
    # Stilark med klasser: fargene stå i <style>; gjør dem om først
    for st in rot.iter("{%s}style" % NAVNEROM):
        pass
    css = "".join((st.text or "") for st in rot.iter("{%s}style" % NAVNEROM))
    klasser = {}
    for m in re.finditer(r"\.([A-Za-z0-9_-]+)\s*\{([^}]*)\}", css):
        klasser[m.group(1)] = m.group(2)
    if klasser:
        for el in rot.iter():
            kl = (el.attrib.get("class") or "").split()
            if kl:
                stil = ";".join(klasser[k] for k in kl if k in klasser)
                if stil:
                    el.attrib["style"] = stil + ";" + el.attrib.get("style", "")
    rens(rot, kastet)
    if kastet:
        return None, "inneholder " + ",".join(sorted(set(kastet)))
    for a in list(rot.attrib):
        if a not in ("viewBox", "width", "height", "xmlns"):
            del rot.attrib[a]
    vb = rot.attrib.get("viewBox")
    if not vb:
        b, h = tall(rot.attrib.get("width")), tall(rot.attrib.get("height"))
        if not b or not h:
            return None, "mangler viewBox"
        vb = f"0 0 {b:g} {h:g}"
    rot.attrib["viewBox"] = vb
    rot.attrib.pop("width", None)
    rot.attrib.pop("height", None)
    rot.attrib["xmlns"] = NAVNEROM
    rot.attrib["fill"] = "#fff"          # det som ikke har egen farge er blekk (hvitt i masken)
    ET.register_namespace("", NAVNEROM)
    s = ET.tostring(rot, encoding="unicode")
    s = re.sub(r"<(/?)ns0:", r"<\1", s).replace("xmlns:ns0=", "xmlns=")
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r">\s+<", "><", s)
    if len(s) > MAKS:
        return None, f"for stor ({len(s)} byte)"
    return s, ""


def main():
    ut = {}
    avvist = {}
    for f in sorted(MAPPE.glob("*.svg")):
        try:
            s, grunn = ett(f)
        except ET.ParseError as e:
            s, grunn = None, f"ugyldig svg ({e})"
        if s:
            ut[f.stem.lower()] = s
        else:
            avvist[f.stem] = grunn
    kropp = ("/* Laget av lag_logoer.py fra logoer/*.svg. Ikke rediger for hånd. */\n"
             "const LEV_LOGO = " + json.dumps(ut, ensure_ascii=False, separators=(",", ":")) + ";\n")
    UT.write_text(kropp, encoding="utf-8")
    print(f"{len(ut)} logoer i {UT.name} ({len(kropp) // 1024} kB)")
    for k, g in avvist.items():
        print(f"  hoppet over {k}: {g}")


if __name__ == "__main__":
    sys.exit(main())
