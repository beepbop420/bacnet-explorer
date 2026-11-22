"""
NABE - Excel files (.xlsx) without a library.

An .xlsx is a zip of a few XML files. This writes the plain kind a technician
wants from a point list: a header row in bold and frozen, a filter on it,
columns as wide as their content, and numbers as numbers, so a sum or a sort
in Excel works without turning text into numbers first. Text goes in as inline
strings, which every reader handles. Read back with nabe_modbus.read_xlsx in
the self-test.
"""
import io
import re
import zipfile
from typing import Any, Dict, List
from xml.sax.saxutils import escape

_FORBUDT = re.compile(r"[\[\]\*\?/\\:]")
_KONTROLL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def _kol(i: int) -> str:
    """0 -> A, 25 -> Z, 26 -> AA."""
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def arknavn(navn: str, brukt: List[str]) -> str:
    """Excel allows 31 characters, none of []*?/\\: and no two sheets with the same name (case aside)."""
    n = _FORBUDT.sub(" ", str(navn or "Ark")).strip("' ").strip() or "Ark"
    n = n[:31]
    base, k = n, 2
    while n.lower() in (b.lower() for b in brukt):
        suff = f" ({k})"
        n = base[:31 - len(suff)] + suff
        k += 1
    return n


def _celle(ref: str, v: Any, stil: int = 0) -> str:
    s = f' s="{stil}"' if stil else ""
    if v is None or v == "":
        return ""
    if isinstance(v, bool):
        return f'<c r="{ref}" t="b"{s}><v>{int(v)}</v></c>'
    if isinstance(v, (int, float)) and v == v and abs(v) != float("inf"):
        return f'<c r="{ref}"{s}><v>{repr(v) if isinstance(v, float) else v}</v></c>'
    t = _KONTROLL.sub("", str(v))
    return f'<c r="{ref}" t="inlineStr"{s}><is><t xml:space="preserve">{escape(t)}</t></is></c>'


def _bredde(rader: List[List[Any]], i: int) -> float:
    n = 0
    for r in rader[:400]:
        if i < len(r) and r[i] not in (None, ""):
            n = max(n, len(str(r[i]).splitlines()[0]) if str(r[i]) else 0)
    return float(min(60, max(8, n + 2)))


def _ark_xml(rader: List[List[Any]]) -> str:
    bredder = max((len(r) for r in rader), default=1)
    ut = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">']
    if len(rader) > 1:
        sist = f"{_kol(bredder - 1)}{len(rader)}"
        ut.append(f'<dimension ref="A1:{sist}"/>')
        ut.append('<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>')
    ut.append('<sheetFormatPr defaultRowHeight="15"/><cols>')
    for i in range(bredder):
        ut.append(f'<col min="{i + 1}" max="{i + 1}" width="{_bredde(rader, i)}" customWidth="1"/>')
    ut.append('</cols><sheetData>')
    for n, r in enumerate(rader, 1):
        celler = "".join(_celle(f"{_kol(i)}{n}", v, 1 if n == 1 else 0) for i, v in enumerate(r))
        ut.append(f'<row r="{n}">{celler}</row>')
    ut.append('</sheetData>')
    if len(rader) > 1:
        ut.append(f'<autoFilter ref="A1:{_kol(bredder - 1)}{len(rader)}"/>')
    ut.append('</worksheet>')
    return "".join(ut)


STILER = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
          '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>'
          '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
          '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
          '<fill><patternFill patternType="solid"><fgColor rgb="FFEEF1F5"/></patternFill></fill></fills>'
          '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
          '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
          '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
          '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>'
          '</styleSheet>')


def skriv_xlsx(ark: List[Dict[str, Any]]) -> bytes:
    """`ark` is [{"navn": "Punkter", "rader": [[header...], [row...], ...]}, ...]. The first row of each sheet is the header."""
    if not ark:
        ark = [{"navn": "Ark", "rader": [[]]}]
    navn: List[str] = []
    for a in ark:
        navn.append(arknavn(a.get("navn", "Ark"), navn))
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Default Extension="xml" ContentType="application/xml"/>'
                   '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                   '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
                   + "".join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                             for i in range(1, len(ark) + 1))
                   + '</Types>')
        z.writestr("_rels/.rels",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
                   '</Relationships>')
        z.writestr("xl/workbook.xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                   'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
                   + "".join(f'<sheet name="{escape(n, {chr(34): "&quot;"})}" sheetId="{i}" r:id="rId{i}"/>' for i, n in enumerate(navn, 1))
                   + '</sheets></workbook>')
        z.writestr("xl/_rels/workbook.xml.rels",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   + "".join(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>'
                             for i in range(1, len(ark) + 1))
                   + f'<Relationship Id="rId{len(ark) + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
                   '</Relationships>')
        z.writestr("xl/styles.xml", STILER)
        for i, a in enumerate(ark, 1):
            z.writestr(f"xl/worksheets/sheet{i}.xml", _ark_xml(a.get("rader") or [[]]))
    return buf.getvalue()
