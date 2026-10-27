"""Écran de lancement animé (règle Socle « Splash animé », modèle : splash de mORTEX).

Fenêtre sans cadre, transparente, centrée, 500 × 190 px. Chronologie :
  t = 0 splash visible → t = 2 s fenêtre principale → t = 4 s sortie animée (600 ms).
Si la fenêtre principale n'est pas prête à 2 s, elle s'ouvre dès qu'elle l'est et le splash attend
qu'elle soit affichée avant de sortir.
"""
from __future__ import annotations

import base64
import html
import sys
import threading
import time
from pathlib import Path

WIDTH, HEIGHT = 500, 190  # tokens Socle size-splash-width / size-splash-height
MAIN_AFTER_S = 2.0
SHOWN_S = 4.0
LEAVE_S = 0.65  # sortie animée de 600 ms + marge

# Le splash s'affiche avant l'interface web (et son i18n) : petit dictionnaire local, mêmes clés
TEXTS = {
    "fr": {"subtitle": "Installateur de modlists", "footer": "Non officiel · compatible Wabbajack"},
    "en": {"subtitle": "Modlist installer", "footer": "Unofficial · Wabbajack compatible"},
    "es": {"subtitle": "Instalador de modlists", "footer": "No oficial · compatible con Wabbajack"},
    "it": {"subtitle": "Installer di modlist", "footer": "Non ufficiale · compatibile con Wabbajack"},
}


def system_language() -> str:
    """Langue préférée du système parmi fr/en/es/it, anglais sinon."""
    try:
        from Foundation import NSLocale
        langs = [str(x) for x in NSLocale.preferredLanguages()]
    except Exception:
        import locale
        langs = [locale.getlocale()[0] or ""]
    code = (langs[0] if langs else "en")[:2].lower()
    return code if code in TEXTS else "en"


def assets_dir() -> Path:
    base = getattr(sys, "_MEIPASS", None)  # application compilée (PyInstaller --add-data)
    return Path(base) / "splash_assets" if base else Path(__file__).resolve().parent / "splash_assets"


def build_html(lang: str) -> str:
    d = assets_dir()
    icon = base64.b64encode((d / "icon.png").read_bytes()).decode()
    texts = TEXTS[lang]
    return ((d / "splash.html").read_text(encoding="utf-8")
            .replace("{{LANG}}", lang)
            .replace("{{ICON}}", f"data:image/png;base64,{icon}")
            .replace("{{SUBTITLE}}", html.escape(texts["subtitle"]))
            .replace("{{FOOTER}}", html.escape(texts["footer"])))


class Splash:
    """Pilote le splash et l'ouverture de la fenêtre principale (créée cachée)."""

    def __init__(self, webview, log) -> None:
        self.log = log
        self.main = None
        self.shown_at = 0.0
        self.visible = threading.Event()   # splash affiché (t = 0)
        self.app_ready = threading.Event()  # fenêtre principale prête à être montrée
        self.window = webview.create_window(
            "mABBAJACK", html=build_html(system_language()), width=WIDTH, height=HEIGHT,
            frameless=True, easy_drag=False, transparent=True, resizable=False, on_top=True,
            focus=False, background_color="#000000",
        )
        self.window.events.loaded += self._on_loaded

    def _on_loaded(self) -> None:
        if not self.visible.is_set():
            self.shown_at = time.monotonic()
            self.visible.set()
            self.log("splash : affiché (t = 0)")

    def _t(self) -> float:
        return time.monotonic() - self.shown_at

    def ready(self) -> None:
        """L'appli est prête : la fenêtre principale peut s'ouvrir (au plus tôt à t = 2 s)."""
        self.app_ready.set()

    def run(self, main) -> None:
        """À lancer dans un fil : ouvre la fenêtre principale puis fait sortir le splash."""
        self.visible.wait(10)
        if not self.visible.is_set():  # splash jamais chargé : on ne bloque pas l'appli
            self.shown_at = time.monotonic()
        time.sleep(max(0.0, MAIN_AFTER_S - self._t()))
        self.app_ready.wait()
        main.show()
        self.log(f"fenêtre principale affichée (t = {self._t():.2f} s)")
        time.sleep(max(0.0, SHOWN_S - self._t()))
        try:
            self.window.evaluate_js("window.splashLeave && window.splashLeave()")
        except Exception:
            pass
        self.log(f"splash : sortie (t = {self._t():.2f} s)")
        time.sleep(LEAVE_S)
        self.window.destroy()
        self.log(f"splash : fermé (t = {self._t():.2f} s)")
