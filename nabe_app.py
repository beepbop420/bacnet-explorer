"""
NABE som eget program: serveren og et eget vindu i én prosess.

Vinduet er WebView2, motoren som allerede ligger i Windows, så det er den
samme siden som i nettleseren - bare uten adresselinje og faner, med NABE
sitt eget ikon og navn på oppgavelinja. Lukker du vinduet, stopper NABE.

Startes av snarveien installasjonsprogrammet lager:
    python\\pythonw.exe -s nabe_app.py
"""
import ctypes
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

    vindu = webview.create_window(
        "NABE", base, width=1440, height=900, min_size=(960, 600),
        background_color="#111113", text_select=True)
    vindu.events.closed += lambda: setattr(server, "should_exit", True)
    vindu.events.shown += lambda: sett_ikon("NABE", HER / "nabe.ico")
    # The page keeps its settings, site memory in the browser and theme
    # between runs only if WebView2 is told where to keep them.
    webview.start(gui="edgechromium", private_mode=False,
                  storage_path=str(data / "webview"))
    server.should_exit = True
    traad.join(timeout=3)


if __name__ == "__main__":
    main()
