"""Jauge de progression dans l'icône du Dock pendant une installation (macOS, AppKit).

L'interface web appelle pywebview.api.set_dock_progress(pourcentage), ou avec null en fin d'installation.
L'icône reçoit une barre de progression et une pastille « 42 % » ; null rend l'icône d'origine.
"""

from __future__ import annotations

_tile_view = None  # (vue de l'icône, barre de progression), créées au premier appel
_last: int | None = None


def _apply(percent: int | None) -> None:
    """Fil principal uniquement."""
    global _tile_view
    from AppKit import NSApp, NSImageView, NSMakeRect, NSProgressIndicator

    tile = NSApp.dockTile()
    if percent is None:
        tile.setContentView_(None)
        tile.setBadgeLabel_(None)
        tile.display()
        return
    if _tile_view is None:
        size = tile.size()
        view = NSImageView.alloc().initWithFrame_(NSMakeRect(0, 0, size.width, size.height))
        view.setImage_(NSApp.applicationIconImage())
        bar = NSProgressIndicator.alloc().initWithFrame_(
            NSMakeRect(size.width * 0.1, size.height * 0.06, size.width * 0.8, size.height * 0.12))
        bar.setStyle_(0)  # NSProgressIndicatorStyleBar
        bar.setIndeterminate_(False)
        bar.setMinValue_(0)
        bar.setMaxValue_(100)
        view.addSubview_(bar)
        _tile_view = (view, bar)
    view, bar = _tile_view
    bar.setDoubleValue_(percent)
    tile.setContentView_(view)
    tile.setBadgeLabel_(f"{percent} %")
    tile.display()


def set_dock_progress(percent=None) -> None:
    """Exposé à l'interface (pywebview.api.set_dock_progress) : 0 à 100, ou None pour effacer."""
    global _last
    value = None if percent is None else max(0, min(100, int(round(float(percent)))))
    if value == _last:
        return
    _last = value
    try:
        from PyObjCTools import AppHelper
        AppHelper.callAfter(_apply, value)
    except Exception:
        pass  # hors macOS ou AppKit indisponible : pas de jauge
