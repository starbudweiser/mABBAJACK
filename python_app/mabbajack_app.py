#!/usr/bin/env python3
"""mABBAJACK — application macOS autonome (fenêtre native, aucun navigateur).

Démarre le serveur Node embarqué puis affiche l'interface dans une fenêtre WKWebView
(pywebview). Aucune dépendance externe : Node, 7zz et unar sont dans l'application.

Ressources recherchées dans l'ordre :
  1. MABBAJACK_HOME (développement : dossier du projet, Node système) ;
  2. <app>/Contents/Resources/payload (application compilée) ;
  3. dossier parent de ce fichier (exécution directe, Node système).
"""
from __future__ import annotations

import atexit
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

import about_window
import lang_menu
import ui_mode
import updater
import webview
from splash import Splash

APP_NAME = "mABBAJACK"
UPDATER = None  # contrôleur de mise à jour (updater.start_webview), branché sur le menu Aide
DATA_NAME = "mAbbajack"  # dossiers de réglages et de journaux existants : ne pas renommer
PREFERRED_PORT = 38300  # port fixe : l'origine (donc le localStorage : clé Nexus, réglages) reste stable
LOG_DIR = Path.home() / "Library" / "Logs" / DATA_NAME
DATA_DIR = Path.home() / "Library" / "Application Support" / DATA_NAME
# Langue de l'interface : choix du menu « Langue » (« auto » = langue du Mac), dans DATA_DIR/language.json
LANG_STORE = lang_menu.FileStore(DATA_NAME)
# Présentation de l'interface : Simple ou Expert, dans DATA_DIR/ui_mode.json
MODE_STORE = ui_mode.ModeStore(DATA_DIR)

# Fenêtre par défaut : 1400 × 1100, centrée, réduite si l'écran est plus petit (ratio gardé, jamais sous le minimum).
# Dès 1380 px la galerie affiche les versions de jeu (1.5.97, 1.6.x…) dans ses filtres, ce qui demande ~1360 px ;
# en dessous elle les masque et la rangée tient en ~1170 px. Le minimum de 1200 px garantit donc que les boutons
# du haut ne passent jamais à la ligne.
WINDOW_W, WINDOW_H = 1400, 1100
WINDOW_MIN = (1200, 700)


def window_min() -> tuple[int, int]:
    """Taille minimale de la fenêtre, plafonnée au plus petit écran : sur un écran de 1080 px de large
    (portrait), un minimum de 1200 px ferait déborder la fenêtre hors de l'écran."""
    mw, mh = WINDOW_MIN
    try:
        mw = min(mw, min(int(s.width * 0.98) for s in webview.screens))
        mh = min(mh, min(int(s.height * 0.8) for s in webview.screens))
    except Exception:  # écrans non détectables
        pass
    return mw, mh


def initial_geometry() -> tuple[int, int, int | None, int | None]:
    """(largeur, hauteur, x, y) : taille par défaut réduite à l'écran en gardant le ratio, centrée.
    Si l'écran est inconnu, x/y = None : pywebview centre la fenêtre."""
    w, h = WINDOW_W, WINDOW_H
    try:
        scr = webview.screens[0]
        # marge pour la barre de menus et le Dock
        scale = min(1.0, (scr.width * 0.95) / w, (scr.height * 0.88) / h)
        mw, mh = window_min()
        w, h = max(mw, int(w * scale)), max(mh, int(h * scale))
        x = int(scr.x + (scr.width - w) / 2)
        y = int(scr.y + max(0, (scr.height - h) / 2))
        return w, h, x, y
    except Exception:  # écran non détectable
        return w, h, None, None

LOADING_HTML = """<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#1e1e1e;color:#dddddd;font-family:-apple-system,Helvetica,sans-serif;
display:flex;align-items:center;justify-content:center;flex-direction:column}
h1{color:#ffffff;font-size:20px;letter-spacing:.025em;margin:0 0 8px}p{color:#aaaaaa;font-size:12px;margin:0}
.d{margin-top:22px;width:28px;height:28px;border:3px solid #333333;border-top-color:#0ea5e9;border-radius:50%;
animation:s 1s linear infinite}@keyframes s{to{transform:rotate(360deg)}}
</style></head><body><h1>mABBAJACK</h1><p>Démarrage du moteur…</p><div class="d"></div></body></html>"""


def payload_dir() -> Path:
    env = os.environ.get("MABBAJACK_HOME")
    if env:
        return Path(env).expanduser()
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent.parent / "Resources" / "payload"
    return Path(__file__).resolve().parent.parent


def find_node(root: Path) -> str | None:
    bundled = root / "bin" / "node"
    if bundled.is_file() and os.access(bundled, os.X_OK):
        return str(bundled)
    found = shutil.which("node")
    if found:
        return found
    for cand in ("/opt/homebrew/bin/node", "/usr/local/bin/node"):
        if os.access(cand, os.X_OK):
            return cand
    return None


def pick_port() -> int:
    for port in (PREFERRED_PORT, 0):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return s.getsockname()[1]
            except OSError:
                continue
    raise RuntimeError("Aucun port local disponible.")


def port_open(port: int, timeout: float = 0.3) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=timeout):
            return True
    except OSError:
        return False


class Backend:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.proc: subprocess.Popen | None = None
        self.port = pick_port()

    def start(self) -> None:
        server = self.root / "server" / "server.js"
        if not server.is_file():
            raise RuntimeError(f"Serveur introuvable : {server}")
        node = find_node(self.root)
        if not node:
            raise RuntimeError("Node.js introuvable (ni embarqué, ni installé).")

        LOG_DIR.mkdir(parents=True, exist_ok=True)
        env = dict(os.environ)
        env.update(
            PORT=str(self.port),
            MABBAJACK_LOG_DIR=str(LOG_DIR),
            MABBAJACK_BIN_DIR=str(self.root / "bin"),
            MABBAJACK_PARENT_PID=str(os.getpid()),
            PATH=os.pathsep.join([str(self.root / "bin"), "/opt/homebrew/bin", "/usr/local/bin",
                                  "/usr/bin", "/bin", env.get("PATH", "")]),
        )
        out = open(LOG_DIR / "server-stdout.log", "ab")
        self.proc = subprocess.Popen(
            [node, str(server)], cwd=str(self.root), env=env,
            stdout=out, stderr=subprocess.STDOUT, start_new_session=True,
        )
        for _ in range(120):  # 30 s max
            if self.proc.poll() is not None:
                raise RuntimeError(f"Le serveur s'est arrêté (code {self.proc.returncode}). Voir {LOG_DIR}.")
            if port_open(self.port):
                return
            time.sleep(0.25)
        raise RuntimeError("Le serveur ne répond pas après 30 s.")

    def stop(self) -> None:
        proc = self.proc
        if not proc:
            return
        # Node tourne dans son propre groupe (start_new_session) : on vise tout le groupe
        # pour qu'aucun enfant (7zz, unar…) ne survive.
        pgid = proc.pid

        def _signal_group(sig: int) -> None:
            try:
                if pgid is not None:
                    os.killpg(pgid, sig)
                elif proc.poll() is None:
                    proc.send_signal(sig)
            except (ProcessLookupError, PermissionError, OSError):
                pass

        _signal_group(signal.SIGCONT)  # un processus suspendu (SIGSTOP) ne reçoit pas SIGTERM
        _signal_group(signal.SIGTERM)
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            pass
        _signal_group(signal.SIGKILL)
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            pass
        self.proc = None


def sync_apple_languages(choice: str) -> None:
    """Les entrées que macOS ajoute lui-même aux menus (Dictée, Emoji, « Quitter et garder les fenêtres »…) suivent
    AppleLanguages, lu par macOS avant ce code : un choix explicite du menu « Langue » y est inscrit pour l'appli
    seule, « auto » l'en retire (langue du Mac). Effet au lancement suivant, comme les autres menus natifs.
    Les arguments -AppleLanguages des essais restent prioritaires."""
    try:
        from Foundation import NSUserDefaults
        defaults = NSUserDefaults.standardUserDefaults()  # domaine de l'appli (identifiant du paquet)
        if lang_menu.normalize_choice(choice) == lang_menu.AUTO:
            defaults.removeObjectForKey_("AppleLanguages")
        else:
            defaults.setObject_forKey_([choice], "AppleLanguages")
    except Exception:
        pass


def set_language_choice(choice: str) -> None:
    LANG_STORE.set(choice)
    sync_apple_languages(choice)


# Langue des menus natifs : celle du menu « Langue » (« auto » = langue du Mac), lue au démarrage ;
# l'interface web change tout de suite, les menus natifs au lancement suivant.
sync_apple_languages(LANG_STORE.get())
MENU_LANG = lang_menu.resolve(LANG_STORE.get())

# Titres des menus : {texte français: (anglais, espagnol, italien)}
MENU_TEXTS = {
    "Fichier": ("File", "Archivo", "File"),
    "Ouvrir un fichier .wabbajack…": ("Open a .wabbajack file…", "Abrir un archivo .wabbajack…", "Apri un file .wabbajack…"),
    "Paramètres…": ("Settings…", "Ajustes…", "Impostazioni…"),
    "Affichage": ("View", "Visualización", "Vista"),
    "Interface simple": ("Simple interface", "Interfaz simple", "Interfaccia semplice"),
    "Interface experte": ("Expert interface", "Interfaz experta", "Interfaccia esperta"),
    "Galerie": ("Gallery", "Galería", "Galleria"),
    "Inspecteur": ("Inspector", "Inspector", "Ispettore"),
    "Installation": ("Installation", "Instalación", "Installazione"),
    "Progression": ("Progress", "Progreso", "Avanzamento"),
    "Actualiser le catalogue": ("Refresh catalog", "Actualizar el catálogo", "Aggiorna il catalogo"),
    "Aide": ("Help", "Ayuda", "Aiuto"),
    "Ouvrir le dossier des journaux": ("Open logs folder", "Abrir la carpeta de registros", "Apri la cartella dei log"),
}


def M(text: str) -> str:
    if MENU_LANG == "fr":
        return text
    return MENU_TEXTS.get(text, (text,) * 3)[("en", "es", "it").index(MENU_LANG)]


# Menus standard de macOS fournis par pywebview (en anglais par défaut)
MENU_LOCALIZATION = {"fr": {
    "global.quitConfirmation": "Voulez-vous vraiment quitter ?", "global.ok": "OK", "global.quit": "Quitter",
    "global.cancel": "Annuler", "global.saveFile": "Enregistrer le fichier",
    "cocoa.menu.about": "À propos de", "cocoa.menu.services": "Services", "cocoa.menu.view": "Présentation",
    "cocoa.menu.edit": "Édition", "cocoa.menu.hide": "Masquer", "cocoa.menu.hideOthers": "Masquer les autres",
    "cocoa.menu.showAll": "Tout afficher", "cocoa.menu.quit": "Quitter", "cocoa.menu.fullscreen": "Plein écran",
    "cocoa.menu.cut": "Couper", "cocoa.menu.copy": "Copier", "cocoa.menu.paste": "Coller",
    "cocoa.menu.selectAll": "Tout sélectionner",
}, "es": {
    "global.quitConfirmation": "¿Seguro que quieres salir?", "global.ok": "OK", "global.quit": "Salir",
    "global.cancel": "Cancelar", "global.saveFile": "Guardar el archivo",
    "cocoa.menu.about": "Acerca de", "cocoa.menu.services": "Servicios", "cocoa.menu.view": "Visualización",
    "cocoa.menu.edit": "Edición", "cocoa.menu.hide": "Ocultar", "cocoa.menu.hideOthers": "Ocultar otros",
    "cocoa.menu.showAll": "Mostrar todo", "cocoa.menu.quit": "Salir", "cocoa.menu.fullscreen": "Pantalla completa",
    "cocoa.menu.cut": "Cortar", "cocoa.menu.copy": "Copiar", "cocoa.menu.paste": "Pegar",
    "cocoa.menu.selectAll": "Seleccionar todo",
}, "it": {
    "global.quitConfirmation": "Vuoi davvero uscire?", "global.ok": "OK", "global.quit": "Esci",
    "global.cancel": "Annulla", "global.saveFile": "Salva il file",
    "cocoa.menu.about": "Informazioni su", "cocoa.menu.services": "Servizi", "cocoa.menu.view": "Vista",
    "cocoa.menu.edit": "Modifica", "cocoa.menu.hide": "Nascondi", "cocoa.menu.hideOthers": "Nascondi altre",
    "cocoa.menu.showAll": "Mostra tutte", "cocoa.menu.quit": "Esci", "cocoa.menu.fullscreen": "Schermo intero",
    "cocoa.menu.cut": "Taglia", "cocoa.menu.copy": "Copia", "cocoa.menu.paste": "Incolla",
    "cocoa.menu.selectAll": "Seleziona tutto",
}}


def push_language(code: str) -> None:
    """Langue choisie dans le menu « Langue » : appliquée à l'interface (window.mabbajackSetLanguage)."""
    if webview.windows:
        webview.windows[0].evaluate_js(f"window.mabbajackSetLanguage && window.mabbajackSetLanguage({json.dumps(code)})")


def push_mode(mode: str) -> None:
    """Présentation choisie : appliquée à l'interface (window.mabbajackSetMode)."""
    if webview.windows:
        webview.windows[0].evaluate_js(f"window.mabbajackSetMode && window.mabbajackSetMode({json.dumps(mode)})")


def mark_mode(mode: str) -> None:
    """Coche « Interface simple » ou « Interface experte » dans le menu Affichage. Fil principal."""
    try:
        from AppKit import NSApp
        from PyObjCTools import AppHelper
    except Exception:
        return

    def apply():
        main = NSApp.mainMenu() if NSApp else None
        top = main.itemWithTitle_(M("Affichage")) if main else None
        sub = top.submenu() if top else None
        if sub is None:
            return
        for title, value in ((M("Interface simple"), "simple"), (M("Interface experte"), "expert")):
            item = sub.itemWithTitle_(title)
            if item is not None:
                item.setState_(1 if value == mode else 0)

    AppHelper.callAfter(apply)


def set_ui_mode(mode: str) -> None:
    """Choix de présentation venu du menu ou des Paramètres de l'interface : mémorisé puis coché."""
    mode = ui_mode.normalize(mode)
    MODE_STORE.set(mode)
    mark_mode(mode)


def merge_view_menus() -> None:
    """pywebview ajoute son propre menu « Présentation » (Plein écran) à côté de notre « Affichage » :
    son entrée Plein écran rejoint notre menu et le sien disparaît (un seul menu d'affichage). Fil principal."""
    try:
        from AppKit import NSApp, NSMenuItem
        from PyObjCTools import AppHelper
    except Exception:
        return

    def apply():
        main = NSApp.mainMenu() if NSApp else None
        if main is None:
            return
        ours = main.itemWithTitle_(M("Affichage"))
        for i in range(main.numberOfItems()):
            top = main.itemAtIndex_(i)
            sub = top.submenu()
            if top is ours or sub is None or ours is None or ours.submenu() is None:
                continue
            full = next((sub.itemAtIndex_(j) for j in range(sub.numberOfItems())
                         if sub.itemAtIndex_(j).action() == "toggleFullScreen:"), None)
            if full is None:
                continue
            sub.removeItem_(full)
            ours.submenu().addItem_(NSMenuItem.separatorItem())
            ours.submenu().addItem_(full)
            main.removeItem_(top)
            return

    AppHelper.callAfter(apply)


def build_menu():
    """Menus macOS natifs : chaque entrée déclenche l'action de l'interface
    (pont window.mabbajackMenu défini dans web/src/state/uiMode.tsx)."""
    from webview.menu import Menu, MenuAction, MenuSeparator

    def item(title: str, action: str):
        def run():
            if webview.windows:
                webview.windows[0].evaluate_js(f"window.mabbajackMenu && window.mabbajackMenu('{action}')")
        return MenuAction(title, run)

    def choose_mode(mode: str):
        def run():
            set_ui_mode(mode)
            push_mode(mode)
        return run

    def open_logs():
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        subprocess.Popen(["open", str(LOG_DIR)])

    return [
        Menu(M("Fichier"), [
            item(M("Ouvrir un fichier .wabbajack…"), "open"),
            MenuSeparator(),
            item(M("Paramètres…"), "settings"),
        ]),
        Menu(M("Affichage"), [
            MenuAction(M("Interface simple"), choose_mode("simple")),
            MenuAction(M("Interface experte"), choose_mode("expert")),
            MenuSeparator(),
            item(M("Galerie"), "gallery"),
            item(M("Inspecteur"), "inspector"),
            item(M("Installation"), "installer"),
            item(M("Progression"), "progress"),
            MenuSeparator(),
            item(M("Actualiser le catalogue"), "refresh"),
        ]),
        lang_menu.web_menu(LANG_STORE.get, set_language_choice, push_language),
        Menu(M("Aide"), [
            MenuAction(M("Ouvrir le dossier des journaux"), open_logs),
            MenuAction(updater.texts(MENU_LANG)["menu"], lambda: UPDATER and UPDATER.check_manual()),
        ]),
    ]



class NxmRouter:
    """Liens nxm:// (bouton « Mod Manager Download » de Nexus) : macOS les envoie à l'appli par un
    événement Apple « GURL » ; on les transmet au serveur local, qui télécharge le fichier."""

    GURL = int.from_bytes(b"GURL", "big")  # classe et identifiant de l'événement « ouvrir une URL »

    def __init__(self, log) -> None:
        self.log = log
        self.port: int | None = None
        self.pending: list[str] = []
        self.lock = threading.Lock()
        self.handler = None

    def register(self) -> None:
        try:
            from Foundation import NSAppleEventManager, NSObject
            import objc
        except ImportError as exc:
            self.log(f"liens nxm indisponibles : {exc!r}")
            return
        router = self
        if self.handler is None:
            class _Handler(NSObject):
                def handleURL_withReply_(self, event, _reply):
                    url = event.paramDescriptorForKeyword_(int.from_bytes(b"----", "big")).stringValue()
                    router.receive(str(url or ""))
                handleURL_withReply_ = objc.selector(handleURL_withReply_, signature=b"v@:@@")
            self.handler = _Handler.alloc().init()
        NSAppleEventManager.sharedAppleEventManager().setEventHandler_andSelector_forEventClass_andEventID_(
            self.handler, "handleURL:withReply:", self.GURL, self.GURL)

    def receive(self, url: str) -> None:
        if not url.lower().startswith("nxm://"):
            return
        self.log("lien nxm reçu")
        with self.lock:
            if self.port is None:
                self.pending.append(url)
                return
        threading.Thread(target=self._send, args=(url,), daemon=True).start()

    def ready(self, port: int) -> None:
        with self.lock:
            self.port, urls, self.pending = port, self.pending, []
        for url in urls:
            threading.Thread(target=self._send, args=(url,), daemon=True).start()

    def _send(self, url: str) -> None:
        import urllib.request
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/api/nexus/nxm", data=json.dumps({"url": url}).encode(),
            headers={"Content-Type": "application/json"}, method="POST")
        for _ in range(20):  # le serveur peut encore démarrer
            try:
                urllib.request.urlopen(req, timeout=5).close()
                return
            except urllib.error.HTTPError as exc:
                self.log(f"lien nxm refusé : HTTP {exc.code}")
                return
            except OSError:
                time.sleep(0.5)
        self.log("lien nxm : serveur injoignable")


def main() -> None:
    root = payload_dir()
    backend = Backend(root)
    width, height, x, y = initial_geometry()
    # Splash d'abord (première fenêtre affichée) ; la fenêtre principale reste cachée jusqu'à t = 2 s
    splash = Splash(webview, lambda msg: launcher_log(msg))
    window = webview.create_window(
        APP_NAME, html=LOADING_HTML, width=width, height=height, x=x, y=y, min_size=window_min(),
        background_color="#1e1e1e", hidden=True,
    )
    app_url = ""
    window.expose(set_ui_mode)  # appelé par les Paramètres de l'interface (pywebview.api.set_ui_mode)

    def on_main_loaded() -> None:
        # l'interface est chargée : la fenêtre peut s'ouvrir sans page blanche
        if app_url and window.get_current_url() and window.get_current_url().startswith(app_url):
            splash.ready()

    def boot() -> None:
        try:
            backend.start()
        except Exception as exc:  # affichage d'erreur dans la fenêtre
            msg = str(exc).replace("<", "&lt;")
            window.load_html(LOADING_HTML.replace("Démarrage du moteur…", f"Erreur : {msg}")
                             .replace('<div class="d"></div>', ""))
            splash.ready()
            return
        nonlocal app_url
        app_url = f"http://127.0.0.1:{backend.port}"
        mode = f"&mode={MODE_STORE.get()}" if MODE_STORE.has_choice() else ""  # sinon l'interface décide (Simple)
        window.load_url(f"{app_url}/?ui={lang_menu.resolve(LANG_STORE.get())}{mode}")  # langue et mode lus par l'interface
        threading.Timer(15, splash.ready).start()  # page lente à charger : on ouvre quand même
        nxm.ready(backend.port)
        global UPDATER
        UPDATER = updater.start_webview(window, APP_NAME, brand='#38bdf8')  # « m » dans la couleur du logo

    def launcher_log(msg: str) -> None:
        try:
            LOG_DIR.mkdir(parents=True, exist_ok=True)
            with open(LOG_DIR / "launcher.log", "a", encoding="utf-8") as f:
                f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}\n")
        except OSError:
            pass

    def on_drop(event: dict) -> None:
        # L'API File du navigateur ne donne pas le chemin du fichier déposé ; pywebview, si.
        # L'interface analyse alors le fichier sur place au lieu de l'envoyer par HTTP.
        files = (event.get("dataTransfer") or {}).get("files") or []
        launcher_log(f"dépôt : {[(f.get('name'), f.get('pywebviewFullPath')) for f in files]}")
        for f in files:
            p = f.get("pywebviewFullPath")
            if p:
                window.evaluate_js(f"window.mabbajackDroppedPath && window.mabbajackDroppedPath({json.dumps(p)})")
                return

    def bind_drop() -> None:
        # Tous les écrans (window.screen ne donne que celui de la fenêtre) : sert à présélectionner
        # le format d'écran des options (21:9, 32:9…).
        try:
            screens = [[int(sc.width), int(sc.height)] for sc in webview.screens]
            window.evaluate_js(f"window.mabbajackScreens = {json.dumps(screens)}")
        except Exception:
            pass
        try:
            from webview.dom import DOMEventHandler
            window.dom.document.events.drop += DOMEventHandler(on_drop, False, False)
            launcher_log("écouteur de dépôt installé")
        except Exception as exc:  # repli : le serveur retrouve le fichier par nom et taille
            launcher_log(f"écouteur de dépôt indisponible : {exc!r}")

    nxm = NxmRouter(launcher_log)
    nxm.register()
    window.events.loaded += bind_drop
    window.events.loaded += on_main_loaded
    window.events.shown += lambda: lang_menu.cocoa_mark(LANG_STORE.get)  # coche du menu « Langue »
    window.events.shown += lambda: mark_mode(MODE_STORE.get())  # coche du menu « Affichage »
    window.events.shown += merge_view_menus
    window.events.shown += lambda: about_window.install(MENU_LANG)  # « À propos » : fenêtre Socle
    window.events.closed += backend.stop
    atexit.register(backend.stop)
    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(sig, lambda *_: (backend.stop(), os._exit(0)))
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    try:
        def start() -> None:
            # AppKit peut remplacer le gestionnaire au lancement : on le remet une fois l'appli démarrée.
            try:
                from PyObjCTools import AppHelper
                AppHelper.callAfter(nxm.register)
            except ImportError:
                pass
            threading.Thread(target=splash.run, args=(window,), daemon=True).start()
            boot()

        webview.start(start, private_mode=False, storage_path=str(DATA_DIR), menu=build_menu(), localization=MENU_LOCALIZATION.get(MENU_LANG, {}))
    finally:
        backend.stop()


if __name__ == "__main__":
    main()
