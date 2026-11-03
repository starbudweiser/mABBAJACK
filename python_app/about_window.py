"""Fenêtre « À propos de mABBAJACK » (Socle, section « Fenêtre « À propos » », modèle swift/AboutWindow.swift).

Fenêtre AppKit à nous plutôt que le panneau standard (orderFrontStandardAboutPanel), dont la zone de texte a une
hauteur fixe qui rogne les textes longs. Ouverte par l'entrée « À propos de mABBAJACK » du menu de l'appli.
"""
from __future__ import annotations

APP_NAME = "mABBAJACK"
BRAND_COLOR = (0x38, 0xBD, 0xF8)  # couleur du « m », comme dans l'interface web (main.tsx)
AUTHORS = "Starbudweiser & Claude Code (Anthropic)"

# Mêmes clés dans chaque langue ; le nom de l'appli et la ligne des auteurs ne sont pas traduits.
TEXTS = {
    "fr": {
        "about.menu": "À propos de mABBAJACK",
        "about.version": "Version {v} ({b})",
        "about.tagline": "Installateur de modlists Wabbajack natif pour macOS.",
        "about.license": "Licence MIT. © 2026 Starbudweiser.",
        "about.disclaimer": "Fourni en l'état, sans garantie.",
        "about.credit": "Inspiré de Wabbajack, sans lien avec ses auteurs.",
    },
    "en": {
        "about.menu": "About mABBAJACK",
        "about.version": "Version {v} ({b})",
        "about.tagline": "Native Wabbajack modlist installer for macOS.",
        "about.license": "MIT License. © 2026 Starbudweiser.",
        "about.disclaimer": "Provided as is, without warranty.",
        "about.credit": "Inspired by Wabbajack, not affiliated with its authors.",
    },
    "es": {
        "about.menu": "Acerca de mABBAJACK",
        "about.version": "Versión {v} ({b})",
        "about.tagline": "Instalador nativo de modlists de Wabbajack para macOS.",
        "about.license": "Licencia MIT. © 2026 Starbudweiser.",
        "about.disclaimer": "Se proporciona tal cual, sin garantía.",
        "about.credit": "Inspirado en Wabbajack, sin relación con sus autores.",
    },
    "it": {
        "about.menu": "Informazioni su mABBAJACK",
        "about.version": "Versione {v} ({b})",
        "about.tagline": "Installer nativo di modlist Wabbajack per macOS.",
        "about.license": "Licenza MIT. © 2026 Starbudweiser.",
        "about.disclaimer": "Fornito così com'è, senza garanzia.",
        "about.credit": "Ispirato a Wabbajack, senza legami con i suoi autori.",
    },
}

SIDE_MARGIN = 28
TEXT_WIDTH = 300

_window = None
_target = None
_lang = "en"


def texts(lang: str) -> dict:
    return TEXTS.get(lang, TEXTS["en"])


def _label(text, size=12, bold=False, secondary=False):
    from AppKit import NSColor, NSFont, NSTextAlignmentCenter, NSTextField
    field = NSTextField.wrappingLabelWithString_(text)
    field.setFont_(NSFont.boldSystemFontOfSize_(size) if bold else NSFont.systemFontOfSize_(size))
    field.setTextColor_(NSColor.secondaryLabelColor() if secondary else NSColor.labelColor())
    field.setAlignment_(NSTextAlignmentCenter)
    field.setPreferredMaxLayoutWidth_(TEXT_WIDTH)
    field.setSelectable_(False)
    field.setTranslatesAutoresizingMaskIntoConstraints_(False)
    field.widthAnchor().constraintLessThanOrEqualToConstant_(TEXT_WIDTH).setActive_(True)
    return field


def _name_label():
    """Nom de l'appli, son « m » initial à la couleur du logo."""
    from AppKit import (NSColor, NSFont, NSFontAttributeName, NSForegroundColorAttributeName,
                        NSMutableAttributedString)
    field = _label(APP_NAME, size=17, bold=True)
    text = NSMutableAttributedString.alloc().initWithString_attributes_(
        APP_NAME, {NSFontAttributeName: NSFont.boldSystemFontOfSize_(17),
                   NSForegroundColorAttributeName: NSColor.labelColor()})
    r, g, b = (c / 255 for c in BRAND_COLOR)
    text.addAttribute_value_range_(NSForegroundColorAttributeName,
                                   NSColor.colorWithSRGBRed_green_blue_alpha_(r, g, b, 1.0), (0, 1))
    field.setAttributedStringValue_(text)
    field.setAlignment_(2)  # NSTextAlignmentCenter (l'attributed string ne la porte pas)
    return field


def _make_window(lang: str):
    from AppKit import (NSApp, NSBackingStoreBuffered, NSEdgeInsets, NSImageScaleProportionallyUpOrDown,
                        NSImageView, NSLayoutAttributeCenterX, NSStackView, NSUserInterfaceLayoutOrientationVertical,
                        NSView, NSWindow, NSWindowStyleMaskClosable, NSWindowStyleMaskTitled)
    from Foundation import NSBundle, NSMakeRect
    t = texts(lang)
    info = NSBundle.mainBundle().infoDictionary() or {}
    version = str(info.get("CFBundleShortVersionString") or "?")
    build = str(info.get("CFBundleVersion") or "?")

    icon = NSImageView.imageViewWithImage_(NSApp.applicationIconImage())
    icon.setImageScaling_(NSImageScaleProportionallyUpOrDown)
    icon.setTranslatesAutoresizingMaskIntoConstraints_(False)
    icon.widthAnchor().constraintEqualToConstant_(84).setActive_(True)
    icon.heightAnchor().constraintEqualToConstant_(84).setActive_(True)
    views = [
        icon,
        _name_label(),
        _label(t["about.version"].format(v=version, b=build), secondary=True),
        _label(t["about.tagline"]),
        _label(AUTHORS, bold=True),
        _label(t["about.license"]),
        _label(t["about.disclaimer"], secondary=True),
        _label(t["about.credit"], secondary=True),
    ]
    stack = NSStackView.stackViewWithViews_(views)
    stack.setOrientation_(NSUserInterfaceLayoutOrientationVertical)
    stack.setAlignment_(NSLayoutAttributeCenterX)
    stack.setSpacing_(12)
    stack.setCustomSpacing_afterView_(6, views[1])
    stack.setCustomSpacing_afterView_(18, views[2])
    stack.setEdgeInsets_(NSEdgeInsets(SIDE_MARGIN, SIDE_MARGIN, SIDE_MARGIN, SIDE_MARGIN))
    stack.setTranslatesAutoresizingMaskIntoConstraints_(False)
    # Largeur fixée : le texte garde ses marges de chaque côté quelle que soit la langue.
    stack.widthAnchor().constraintEqualToConstant_(TEXT_WIDTH + 2 * SIDE_MARGIN).setActive_(True)

    window = NSWindow.alloc().initWithContentRect_styleMask_backing_defer_(
        NSMakeRect(0, 0, 10, 10), NSWindowStyleMaskTitled | NSWindowStyleMaskClosable, NSBackingStoreBuffered, False)
    window.setTitle_(t["about.menu"])
    window.setReleasedWhenClosed_(False)
    content = NSView.alloc().init()
    content.addSubview_(stack)
    for a, b in ((stack.topAnchor(), content.topAnchor()), (stack.leadingAnchor(), content.leadingAnchor()),
                 (stack.trailingAnchor(), content.trailingAnchor()), (stack.bottomAnchor(), content.bottomAnchor())):
        a.constraintEqualToAnchor_(b).setActive_(True)
    window.setContentView_(content)
    content.layoutSubtreeIfNeeded()
    content.layoutSubtreeIfNeeded()  # les textes à la ligne ne connaissent leur hauteur qu'après une première passe
    window.setContentSize_(content.fittingSize())
    return window


def show(lang: str) -> None:
    """Affiche la fenêtre (une seule instance, réaffichée si elle est déjà ouverte). Fil principal."""
    global _window
    from AppKit import NSApp
    if _window is None:
        _window = _make_window(lang)
    _window.center()
    NSApp.activateIgnoringOtherApps_(True)  # ouverte par l'utilisateur depuis le menu : elle vient devant
    _window.makeKeyAndOrderFront_(None)


def install(lang: str) -> None:
    """Retitre l'entrée « À propos » du menu de l'appli (pywebview la crée) et la branche sur notre fenêtre."""
    try:
        from AppKit import NSApp
        from Foundation import NSObject
        from PyObjCTools import AppHelper
    except Exception:
        return

    global _target, _lang
    _lang = lang
    if _target is None:
        class MabbajackAboutTarget(NSObject):
            def showAbout_(self, _sender):
                show(_lang)
        _target = MabbajackAboutTarget.alloc().init()

    def apply():
        main = NSApp.mainMenu() if NSApp else None
        app_menu = main.itemAtIndex_(0).submenu() if main is not None and main.numberOfItems() else None
        if app_menu is None:
            return
        for i in range(app_menu.numberOfItems()):
            item = app_menu.itemAtIndex_(i)
            if item.action() == "orderFrontStandardAboutPanel:":
                item.setTitle_(texts(lang)["about.menu"])
                item.setTarget_(_target)
                item.setAction_("showAbout:")
                return

    AppHelper.callAfter(apply)
