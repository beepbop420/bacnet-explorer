"""
NABE som eget program: serveren og et eget vindu i én prosess.

Vinduet er WebView2, motoren som allerede ligger i Windows, så det er den
samme siden som i nettleseren - bare uten adresselinje og faner, med NABE
sitt eget ikon og navn på oppgavelinja. Lukker du vinduet, stopper NABE.

Startes av snarveien installasjonsprogrammet lager:
    python\\pythonw.exe -s nabe_app.py
"""
import ctypes
import json
import os
import socket
import sys
import threading
import time
from pathlib import Path

HER = Path(__file__).parent
APP_ID = "Lillebo.NABE"


def ledig_port(foretrukket: int = 8092) -> int:
    """8092 hvis den er ledig, ellers hva som helst - nettleserversjonen kan
    godt kjøre samtidig."""
    for port in (foretrukket, 0):
        s = socket.socket()
        try:
            s.bind(("127.0.0.1", port))
            return s.getsockname()[1]
        except OSError:
            continue
        finally:
            s.close()
    return foretrukket


def sett_tittellinje(tittel: str, bak: str, tekst: str, kant: str, mork: bool):
    """Paint Windows' own title bar in the app's colours, so the window reads
    as one surface. Colours the system takes are hex; anything else is left."""
    try:
        def ref(f):
            f = f.strip().lstrip("#")
            return int(f[4:6] + f[2:4] + f[0:2], 16) if len(f) == 6 else None
        u = ctypes.windll.user32
        u.FindWindowW.restype = ctypes.c_void_p
        hwnd = u.FindWindowW(None, tittel)
        if not hwnd:
            return
        dwm = ctypes.windll.dwmapi
        dwm.DwmSetWindowAttribute.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_void_p, ctypes.c_uint]
        # 20 dark mode, 34 border, 35 caption, 36 caption text.
        for attr, verdi in ((20, 1 if mork else 0), (34, ref(kant)), (35, ref(bak)), (36, ref(tekst))):
            if verdi is not None:
                v = ctypes.c_int(verdi)
                dwm.DwmSetWindowAttribute(hwnd, attr, ctypes.byref(v), 4)
    except Exception:
        pass


def sett_ikon(tittel: str, ikon: Path):
    """Put NABE's own icon on the window and its taskbar button. WebView2
    windows otherwise carry the icon of the program that opened them -
    here that is Python's."""
    try:
        u = ctypes.windll.user32
        u.FindWindowW.restype = ctypes.c_void_p
        u.LoadImageW.restype = ctypes.c_void_p
        u.SendMessageW.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_void_p, ctypes.c_void_p]
        hwnd = u.FindWindowW(None, tittel)
        if not hwnd:
            return
        stor = u.LoadImageW(None, str(ikon), 1, 48, 48, 0x10)
        liten = u.LoadImageW(None, str(ikon), 1, 16, 16, 0x10)
        u.SendMessageW(hwnd, 0x80, 1, stor)
        u.SendMessageW(hwnd, 0x80, 0, liten)
    except Exception:
        pass


def allerede_aapen() -> bool:
    """One NABE at a time. A second window would share the same WebView2
    profile, which the first holds locked - the second then opens nothing.
    So a second start brings the first one forward instead."""
    try:
        u = ctypes.windll.user32
        u.FindWindowW.restype = ctypes.c_void_p
        hwnd = u.FindWindowW(None, "NABE")
        if not hwnd:
            return False
        u.ShowWindow(ctypes.c_void_p(hwnd), 9)          # SW_RESTORE
        u.SetForegroundWindow(ctypes.c_void_p(hwnd))
        return True
    except Exception:
        return False


def main():
    if allerede_aapen():
        return
    data = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "NABE"
    data.mkdir(parents=True, exist_ok=True)
    port = ledig_port()
    base = f"http://127.0.0.1:{port}"
    os.environ["NABE_DATA"] = str(data)
    os.environ.setdefault("NABE_ALLOWED_ORIGINS", base)

    # Without its own id, Windows files the window under python.exe and shows
    # the Python icon on the taskbar. With one, it takes the shortcut's.
    try:
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(APP_ID)
    except Exception:
        pass

    # A console-less pythonw has no stdout; uvicorn's logger must not trip on it.
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w")
    if sys.stderr is None:
        sys.stderr = open(data / "nabe.log", "a", encoding="utf-8")

    sys.path.insert(0, str(HER))
    os.chdir(HER)
    import uvicorn
    import webview

    config = uvicorn.Config("server:app", host="127.0.0.1", port=port,
                            log_level="warning", lifespan="on")
    server = uvicorn.Server(config)
    traad = threading.Thread(target=server.run, daemon=True)
    traad.start()
    for _ in range(200):
        if server.started:
            break
        time.sleep(0.05)

    # The window comes back where it was left - maximised if it was, and
    # maximised the first time. A position Windows gives a minimised window
    # (-32000) or one off every screen is no place to come back to.
    geo_fil = data / "vindu.json"
    try:
        geo = json.loads(geo_fil.read_text(encoding="utf-8"))
    except Exception:
        geo = {}
    if not isinstance(geo.get("x"), int) or not isinstance(geo.get("y"), int) or min(geo["x"], geo["y"]) < -2000:
        geo.pop("x", None); geo.pop("y", None)
    if geo.get("b", 0) < 960 or geo.get("h", 0) < 600:
        geo.pop("b", None); geo.pop("h", None)
    TILSTAND = {"maks": geo.get("maks", True), "min": False}

    class Api:
        """What the page can ask of the window."""
        tillat_lukking = False

        def lukk(self):
            Api.tillat_lukking = True
            vindu.destroy()

        def tittellinje(self, bak, tekst, kant, mork):
            sett_tittellinje("NABE", bak, tekst, kant, bool(mork))

        def velg_mappe(self, start=""):
            """Windows' folder dialog, owned by this window."""
            valgt = vindu.create_file_dialog(webview.FOLDER_DIALOG, directory=start or "")
            return valgt[0] if valgt else None

    vindu = webview.create_window(
        "NABE", base, width=geo.get("b", 1440), height=geo.get("h", 900),
        x=geo.get("x"), y=geo.get("y"), min_size=(960, 600), maximized=TILSTAND["maks"],
        background_color="#111113", text_select=True, js_api=Api())

    # Whether it is maximised or minimised now, from the window's own events.
    def _maks():
        TILSTAND["maks"] = True; TILSTAND["min"] = False

    def _min():
        TILSTAND["min"] = True

    def _vanlig():
        TILSTAND["maks"] = False; TILSTAND["min"] = False
    for navn, f in (("maximized", _maks), ("minimized", _min), ("restored", _vanlig)):
        ev = getattr(vindu.events, navn, None)
        if ev is not None:
            ev += f

    def lukker():
        """
        The plug that will not come out. Closing with points still commanded
        by this NABE is how a plant gets left in manual - so the page is
        asked to show what is still overridden, and closes itself once you
        have chosen. With nothing outstanding the window simply closes.
        """
        try:
            ny = dict(geo)
            ny["maks"] = TILSTAND["maks"]
            # Minimised or maximised, the size and place are not the window's
            # own: the last normal ones are kept.
            if not TILSTAND["min"] and not TILSTAND["maks"] and min(vindu.x, vindu.y) > -2000:
                ny.update({"b": vindu.width, "h": vindu.height, "x": vindu.x, "y": vindu.y})
            json.dump(ny, geo_fil.open("w", encoding="utf-8"))
        except Exception:
            pass
        if Api.tillat_lukking:
            return True
        try:
            import urllib.request
            with urllib.request.urlopen(base + "/api/mine", timeout=1) as r:
                mine = json.loads(r.read()).get("overstyrt", [])
        except Exception:
            mine = []
        # Only what can be released from here stops the window: a point on a
        # network you have left waits for the next visit, where NABE reminds
        # you on start.
        if not any(o.get("naabar", True) for o in mine):
            return True
        # Asked from another thread, after this handler has returned. Called
        # here, evaluate_js waits for the window's own thread - which is the
        # one sitting in this handler waiting for it: Windows then marks NABE
        # "not responding" and the guard never shows. Seen with one point
        # still overridden at pri 8.
        threading.Thread(target=lambda: vindu.evaluate_js(
            "typeof visLukkVakt === 'function' ? visLukkVakt() : window.pywebview.api.lukk()"),
            daemon=True).start()
        return False

    vindu.events.closing += lukker
    vindu.events.closed += lambda: setattr(server, "should_exit", True)
    vindu.events.shown += lambda: sett_ikon("NABE", HER / "nabe.ico")
    # Without this, WebView2 in pywebview drops every download from the page
    # without a word - the EDE and CSV exports would go nowhere.
    webview.settings["ALLOW_DOWNLOADS"] = True
    # The page keeps its settings, site memory in the browser and theme
    # between runs only if WebView2 is told where to keep them.
    webview.start(gui="edgechromium", private_mode=False,
                  storage_path=str(data / "webview"))
    server.should_exit = True
    traad.join(timeout=3)
    # Gone when the window is gone. Python would otherwise wait at exit for
    # every worker thread still in a call - a ping to a dead address, a read
    # from a controller behind a tunnel that dropped - and NABE would hang
    # on with no window. Everything worth keeping is written as it happens.
    try:
        sys.stderr.flush()
    except Exception:
        pass
    os._exit(0)


if __name__ == "__main__":
    main()
