r"""
Signatures for NABE updates.

A new version is downloaded by the program itself, so it has to be sure the
file is the one that was released. The release is signed with a private key that
only the maintainer holds; every installed NABE carries the matching public key
and refuses anything that does not verify.

This is Ed25519 as in RFC 8032, in plain Python, so nothing has to be installed
for it. It signs a short message (version and SHA-256 of the zip), so speed does
not matter. The public key below is not secret.

    python nabe_signatur.py ny-nokkel        make a key pair (once), print the public key
    python nabe_signatur.py signer fil.zip   write fil.zip.sig for the version in server.py
    python nabe_signatur.py sjekk            check the implementation against RFC 8032

This is not a Windows code-signing certificate. It does not change what Windows
or a virus scanner thinks of a file; it makes the self-update trustworthy.
"""
import base64
import hashlib
import json
import os
import re
import secrets
import sys
from pathlib import Path

# The public key of the NABE releases (32 bytes, hex).
PUBLIKK_NOKKEL = "d454ab60da7ba410d198c63c4026c72efc7ff762c699ce013b30cc314e56fe43"

STANDARD_NOKKELFIL = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "NABE-signering" / "privat.key"

# ------------------------------------------------------------------ Ed25519
_p = 2 ** 255 - 19
_q = 2 ** 252 + 27742317777372353535851937790883648493


def _inv(x):
    return pow(x, _p - 2, _p)


_d = -121665 * _inv(121666) % _p
_sqrt_m1 = pow(2, (_p - 1) // 4, _p)


def _sha512(s):
    return hashlib.sha512(s).digest()


def _sha512_modq(s):
    return int.from_bytes(_sha512(s), "little") % _q


def _add(P, Q):
    A, B = (P[1] - P[0]) * (Q[1] - Q[0]) % _p, (P[1] + P[0]) * (Q[1] + Q[0]) % _p
    C, D = 2 * P[3] * Q[3] * _d % _p, 2 * P[2] * Q[2] % _p
    E, F, G, H = B - A, D - C, D + C, B + A
    return (E * F % _p, G * H % _p, F * G % _p, E * H % _p)


def _mul(s, P):
    Q = (0, 1, 1, 0)
    while s > 0:
        if s & 1:
            Q = _add(Q, P)
        P = _add(P, P)
        s >>= 1
    return Q


def _lik(P, Q):
    return (P[0] * Q[2] - Q[0] * P[2]) % _p == 0 and (P[1] * Q[2] - Q[1] * P[2]) % _p == 0


def _recover_x(y, sign):
    if y >= _p:
        return None
    x2 = (y * y - 1) * _inv(_d * y * y + 1)
    if x2 == 0:
        return None if sign else 0
    x = pow(x2, (_p + 3) // 8, _p)
    if (x * x - x2) % _p != 0:
        x = x * _sqrt_m1 % _p
    if (x * x - x2) % _p != 0:
        return None
    if (x & 1) != sign:
        x = _p - x
    return x


_gy = 4 * _inv(5) % _p
_gx = _recover_x(_gy, 0)
_G = (_gx, _gy, 1, _gx * _gy % _p)


def _komprimer(P):
    zinv = _inv(P[2])
    x, y = P[0] * zinv % _p, P[1] * zinv % _p
    return int.to_bytes(y | ((x & 1) << 255), 32, "little")


def _dekomprimer(s):
    if len(s) != 32:
        return None
    y = int.from_bytes(s, "little")
    sign = y >> 255
    y &= (1 << 255) - 1
    x = _recover_x(y, sign)
    return None if x is None else (x, y, 1, x * y % _p)


def _utvid(hemmelig):
    if len(hemmelig) != 32:
        raise ValueError("Nøkkelen må være 32 byte")
    h = _sha512(hemmelig)
    a = int.from_bytes(h[:32], "little")
    a &= (1 << 254) - 8
    a |= 1 << 254
    return a, h[32:]


def offentlig_fra(hemmelig: bytes) -> bytes:
    a, _ = _utvid(hemmelig)
    return _komprimer(_mul(a, _G))


def signer_bytes(hemmelig: bytes, melding: bytes) -> bytes:
    a, prefiks = _utvid(hemmelig)
    A = _komprimer(_mul(a, _G))
    r = _sha512_modq(prefiks + melding)
    Rs = _komprimer(_mul(r, _G))
    h = _sha512_modq(Rs + A + melding)
    return Rs + int.to_bytes((r + h * a) % _q, 32, "little")


def verifiser_bytes(offentlig: bytes, melding: bytes, signatur: bytes) -> bool:
    if len(offentlig) != 32 or len(signatur) != 64:
        return False
    A = _dekomprimer(offentlig)
    Rs = signatur[:32]
    R = _dekomprimer(Rs)
    if A is None or R is None:
        return False
    s = int.from_bytes(signatur[32:], "little")
    if s >= _q:
        return False
    h = _sha512_modq(Rs + offentlig + melding)
    return _lik(_mul(s, _G), _add(R, _mul(h, A)))


# ------------------------------------------------------------------ releases
def melding(versjon: str, sha256: str) -> bytes:
    """What is signed: the version and the hash, so an old release cannot be
    passed off as a new one, nor a different file as this one."""
    return f"NABE|{versjon}|{sha256.lower()}".encode("utf-8")


def sha256_fil(fil) -> str:
    h = hashlib.sha256()
    with open(fil, "rb") as f:
        for blokk in iter(lambda: f.read(1 << 20), b""):
            h.update(blokk)
    return h.hexdigest()


def lag_signatur(fil, versjon: str, hemmelig: bytes) -> dict:
    sha = sha256_fil(fil)
    return {"versjon": versjon, "sha256": sha,
            "signatur": base64.b64encode(signer_bytes(hemmelig, melding(versjon, sha))).decode("ascii")}


def sjekk_signatur(sig: dict, sha256: str, versjon: str, offentlig_hex: str = None) -> bool:
    """True only if `sig` is a valid signature, by the NABE key, of exactly this
    version and this hash."""
    try:
        if str(sig.get("versjon")) != str(versjon) or str(sig.get("sha256", "")).lower() != sha256.lower():
            return False
        nokkel = bytes.fromhex(offentlig_hex or PUBLIKK_NOKKEL)
        return verifiser_bytes(nokkel, melding(versjon, sha256), base64.b64decode(sig["signatur"]))
    except Exception:
        return False


def les_hemmelig(fil=None) -> bytes:
    f = Path(fil or os.environ.get("NABE_SIGNERING_NOKKEL") or STANDARD_NOKKELFIL)
    return bytes.fromhex(f.read_text(encoding="ascii").strip())


# ------------------------------------------------------------------ command line
RFC_HEMMELIG = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"
RFC_OFFENTLIG = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"
RFC_SIGNATUR = ("e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46"
                "bd25bf5f0595bbe24655141438e7a100b")


def _sjekk_rfc() -> bool:
    h = bytes.fromhex(RFC_HEMMELIG)
    return (offentlig_fra(h).hex() == RFC_OFFENTLIG
            and signer_bytes(h, b"").hex() == RFC_SIGNATUR
            and verifiser_bytes(bytes.fromhex(RFC_OFFENTLIG), b"", bytes.fromhex(RFC_SIGNATUR)))


def main(argv):
    kmd = argv[1] if len(argv) > 1 else ""
    if kmd == "sjekk":
        print("RFC 8032 testvektor: " + ("OK" if _sjekk_rfc() else "FEIL"))
        return 0 if _sjekk_rfc() else 1
    if kmd == "ny-nokkel":
        fil = Path(argv[2]) if len(argv) > 2 else STANDARD_NOKKELFIL
        if fil.exists():
            print(f"{fil} finnes allerede. Slett den selv hvis du virkelig vil ha en ny nøkkel.")
            return 1
        fil.parent.mkdir(parents=True, exist_ok=True)
        h = secrets.token_bytes(32)
        fil.write_text(h.hex(), encoding="ascii")
        print(f"Privat nøkkel: {fil}\nTa en sikkerhetskopi av den. Uten den kan ingen nye versjoner signeres.")
        print(f"Offentlig nøkkel (legg i PUBLIKK_NOKKEL): {offentlig_fra(h).hex()}")
        return 0
    if kmd == "signer" and len(argv) > 2:
        fil = Path(argv[2])
        server = Path(__file__).parent / "server.py"
        versjon = re.search(r'VERSJON = "([^"]+)"', server.read_text(encoding="utf-8")).group(1)
        sig = lag_signatur(fil, versjon, les_hemmelig())
        ut = fil.with_name(fil.name + ".sig")
        ut.write_text(json.dumps(sig), encoding="utf-8")
        print(f"{ut}  ({versjon}, {sig['sha256'][:12]}...)")
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
