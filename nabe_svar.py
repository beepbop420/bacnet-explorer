"""
NABE - Prøv og se svar: tall i stedet for øyemål.

Pådraget settes til 0, 50 og 100 % med pause imellom, og måleverdien leses hvert
sekund. For hvert trinn regnes ut hvor mye den endret seg, hvor lenge det gikk
før noe skjedde (dødtid), og hvor lang tid den brukte på 63 % av endringen.
Slik blir «reagerer sånn og sånn» en setning med tall.

Bare rene funksjoner her, uten nett, så de kan testes mot en regnet respons.
Selve skrivingen og slippingen gjøres av server.py.
"""
from typing import Any, Dict, List, Optional, Tuple


def snitt(x: List[float]) -> float:
    return sum(x) / len(x)


def stoy(baseline: List[float]) -> float:
    """Standardavvik i hvilen, for å vite hva som er støy."""
    v = [x for x in baseline if x is not None]
    if len(v) < 3:
        return 0.0
    m = snitt(v)
    return (sum((x - m) ** 2 for x in v) / (len(v) - 1)) ** 0.5


def analyser_steg(v0: float, serie: List[Tuple[float, Optional[float]]], fra: float, til: float, sd: float) -> Dict[str, Any]:
    """serie: (sekunder siden trinnet ble satt, måleverdi). v0: verdien like før."""
    pts = [(t, v) for t, v in serie if v is not None]
    ut: Dict[str, Any] = {"fra": fra, "til": til, "v0": v0, "slutt": None, "endring": None, "dode_s": None,
                          "t63_s": None, "stabil": None, "reagerte": False, "per_10": None, "antall": len(pts)}
    if len(pts) < 3:
        return ut
    terskel = max(5 * sd, 0.002 * max(abs(v0), 10.0), 1e-9)
    slutt = snitt([v for _, v in pts[-3:]])
    endring = slutt - v0
    ut["slutt"], ut["endring"] = round(slutt, 3), round(endring, 3)
    dode = None
    for i, (t, v) in enumerate(pts):
        neste_ok = i + 1 >= len(pts) or abs(pts[i + 1][1] - v0) > terskel
        if abs(v - v0) > terskel and neste_ok:
            dode = t
            break
    if abs(endring) <= terskel or dode is None:
        return ut
    ut["reagerte"] = True
    ut["dode_s"] = round(dode, 1)
    mal = v0 + 0.632 * endring
    for t, v in pts:
        if (endring > 0 and v >= mal) or (endring < 0 and v <= mal):
            ut["t63_s"] = round(t, 1)
            break
    sist = [v for _, v in pts[-5:]]
    ut["stabil"] = (max(sist) - min(sist)) <= max(2 * terskel, 0.1 * abs(endring))
    delta = til - fra
    if delta:
        ut["per_10"] = round(endring / delta * 10, 3)
    return ut


def _median(x: List[float]) -> Optional[float]:
    x = sorted(v for v in x if v is not None)
    if not x:
        return None
    n = len(x)
    return x[n // 2] if n % 2 else (x[n // 2 - 1] + x[n // 2]) / 2


def oppsummer(steg: List[Dict[str, Any]], pause_s: float) -> Dict[str, Any]:
    """Én dom for hele testen: ingen / treg / ok, retning og om svaret er lineært."""
    med_endring = [s for s in steg if s["til"] != s["fra"]]
    reag = [s for s in med_endring if s["reagerte"]]
    uten = [i for i, s in enumerate(steg) if s["til"] != s["fra"] and not s["reagerte"]]
    per10 = [s["per_10"] for s in reag if s["per_10"] is not None]
    res: Dict[str, Any] = {
        "dom": "ingen", "retning": None, "per_10": None, "dode_s": None, "t63_s": None,
        "lineaer": None, "uten_svar": uten, "reagerte": len(reag), "av": len(med_endring),
    }
    if not reag:
        return res
    mp = _median(per10)
    res["per_10"] = round(mp, 3) if mp is not None else None
    res["retning"] = "opp" if (mp or 0) > 0 else "ned"
    res["dode_s"] = _median([s["dode_s"] for s in reag])
    res["t63_s"] = _median([s["t63_s"] for s in reag])
    if len(per10) >= 2 and mp:
        res["lineaer"] = all(abs(x - mp) <= 0.35 * abs(mp) for x in per10)
    treg = (res["t63_s"] is not None and res["t63_s"] > 0.5 * pause_s) or any(s["stabil"] is False for s in reag)
    res["dom"] = "treg" if treg else "ok"
    return res
