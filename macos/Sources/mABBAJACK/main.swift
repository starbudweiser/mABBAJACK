// Point d'entrée de mABBAJACK : lance le serveur Node embarqué (dossier payload), affiche l'interface dans une fenêtre
// WKWebView à http://127.0.0.1:38300 (même origine qu'avant : clé Nexus et réglages conservés), splash animé, menus
// natifs, liens nxm://, jauge du Dock, mise à jour automatique.
//
// Essais en arrière-plan : MABBAJACK_QUIET=1 lance l'appli sans prendre le focus.

import AppKit
import MBCore
import SwiftUI

let quiet = ProcessInfo.processInfo.environment["MABBAJACK_QUIET"] != nil
let brandColor = Color(red: 0x38 / 255, green: 0xbd / 255, blue: 0xf8 / 255)

// Fenêtre par défaut : 1400 × 1100, centrée, réduite si l'écran est plus petit (ratio gardé, jamais sous le minimum).
// Dès 1380 px la galerie affiche les versions de jeu dans ses filtres ; le minimum de 1200 px garantit que les boutons
// du haut ne passent jamais à la ligne.
let WINDOW_SIZE = NSSize(width: 1400, height: 1100)
let WINDOW_MIN = NSSize(width: 1200, height: 700)
// Splash animé (règle Socle) : t = 0 splash visible → t = 2 s fenêtre de l'appli (ou dès qu'elle est prête)
// → t = 3 s début de la sortie animée (600 ms), jamais avant que la fenêtre soit affichée.
let SPLASH_SIZE = NSSize(width: 500, height: 190)
let SPLASH_MAIN_AT = 2.0, SPLASH_LEAVE_AT = 3.0, SPLASH_LEAVE_S = 0.6

/// Taille minimale, plafonnée au plus petit écran (portrait : 1200 px ferait déborder la fenêtre).
@MainActor func windowMin() -> NSSize {
    var w = WINDOW_MIN.width, h = WINDOW_MIN.height
    for s in NSScreen.screens {
        w = min(w, (s.frame.width * 0.98).rounded(.down))
        h = min(h, (s.frame.height * 0.8).rounded(.down))
    }
    return NSSize(width: w, height: h)
}

/// Taille par défaut réduite à l'écran en gardant le ratio.
@MainActor func initialSize() -> NSSize {
    guard let scr = NSScreen.screens.first?.frame else { return WINDOW_SIZE }
    let scale = min(1, scr.width * 0.95 / WINDOW_SIZE.width, scr.height * 0.88 / WINDOW_SIZE.height)
    let m = windowMin()
    return NSSize(width: max(m.width, (WINDOW_SIZE.width * scale).rounded(.down)), height: max(m.height, (WINDOW_SIZE.height * scale).rounded(.down)))
}

func loadingHTML(_ text: String, spinner: Bool = true) -> String {
    let safe = text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
    return """
    <!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:#1e1e1e;color:#dddddd;font-family:-apple-system,Helvetica,sans-serif;
    display:flex;align-items:center;justify-content:center;flex-direction:column}
    h1{color:#ffffff;font-size:20px;letter-spacing:.025em;margin:0 0 8px}h1 span{color:#38bdf8}p{color:#aaaaaa;font-size:12px;margin:0;max-width:640px;text-align:center}
    .d{margin-top:22px;width:28px;height:28px;border:3px solid #333333;border-top-color:#0ea5e9;border-radius:50%;
    animation:s 1s linear infinite}@keyframes s{to{transform:rotate(360deg)}}
    </style></head><body><h1><span>m</span>ABBAJACK</h1><p>\(safe)</p>\(spinner ? "<div class=\"d\"></div>" : "")</body></html>
    """
}

/// Splash : modèle HTML de Resources/splash.html, remplissage des textes et de l'icône.
func splashHTML(lang: String) -> String? {
    guard let res = Bundle.main.resourcePath ?? Optional(CommandLine.arguments[0]),
          var html = try? String(contentsOfFile: res + "/splash.html", encoding: .utf8),
          let icon = try? Data(contentsOf: URL(fileURLWithPath: res + "/splash-icon.png")) else { return nil }
    func esc(_ s: String) -> String { s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;") }
    html = html.replacingOccurrences(of: "{{LANG}}", with: lang)
        .replacingOccurrences(of: "{{ICON}}", with: "data:image/png;base64," + icon.base64EncodedString())
        .replacingOccurrences(of: "{{SUBTITLE}}", with: esc(L("Installateur de modlists")))
        .replacingOccurrences(of: "{{FOOTER}}", with: esc(L("Non officiel · compatible Wabbajack")))
    return html
}

// MARK: - Application

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WebBridge {
    let langStore = LanguageStore()
    let modeStore = ModeStore()
    var backend: Backend?
    var main: WebHost!
    var mainWindow: NSWindow!
    var splash: WebHost?
    var splashWindow: NSWindow?
    var appReady = false
    var nxmPending: [String] = []
    var nxmPort: UInt16?
    var signalSources: [DispatchSourceSignal] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        Socle.apply()
        Socle.brand("mABBAJACK", color: brandColor)  // « m » dans la couleur du logo
        try? FileManager.default.createDirectory(at: Paths.dataDir, withIntermediateDirectories: true)

        // Arrêt propre du moteur sur SIGTERM / SIGINT / SIGHUP
        for sig in [SIGTERM, SIGINT, SIGHUP] {
            signal(sig, SIG_IGN)
            let src = DispatchSource.makeSignalSource(signal: sig, queue: .main)
            src.setEventHandler { [weak self] in self?.backend?.stop(); exit(0) }
            src.resume()
            signalSources.append(src)
        }

        buildMenu()
        let lang = I18n.lang

        // Fenêtre principale (cachée jusqu'au splash) : page d'attente puis interface
        main = WebHost(bridged: true)
        main.bridge = self
        let size = initialSize()
        mainWindow = NSWindow(contentRect: NSRect(origin: .zero, size: size),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        mainWindow.title = "mABBAJACK"
        mainWindow.contentView = main.webView
        mainWindow.isReleasedWhenClosed = false
        mainWindow.delegate = self
        mainWindow.backgroundColor = NSColor(srgbRed: 0x1e / 255, green: 0x1e / 255, blue: 0x1e / 255, alpha: 1)
        mainWindow.contentMinSize = windowMin()
        mainWindow.setContentSize(size)
        mainWindow.socleCenter()
        mainWindow.collectionBehavior.insert(.fullScreenPrimary)
        main.loadHTML(loadingHTML(L("Démarrage du moteur…")))
        main.onLoaded = { [self] in
            // L'interface est chargée : la fenêtre peut s'ouvrir sans page blanche
            if main.showsApp { appReady = true }
        }

        // Splash animé
        let sp = WebHost(transparent: true)
        splash = sp
        let w = NSWindow(contentRect: NSRect(origin: .zero, size: SPLASH_SIZE), styleMask: [.borderless], backing: .buffered, defer: false)
        w.isReleasedWhenClosed = false
        w.isOpaque = false
        w.backgroundColor = .clear
        w.hasShadow = false
        w.contentView = sp.webView
        w.level = quiet ? .normal : .floating
        w.socleCenter()
        splashWindow = w
        if let html = splashHTML(lang: lang) { sp.loadHTML(html) } else { Log.write("splash : modèle introuvable") }
        runSplash(sp)

        boot()
    }

    // MARK: Moteur

    private func boot() {
        guard let root = Backend.payloadDir() else {
            showError(L("Serveur introuvable : {p}", ["p": "payload"]))
            return
        }
        let be = Backend(root: root)
        backend = be
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            do {
                try be.start()
                DispatchQueue.main.async { MainActor.assumeIsolated { self.engineReady(be.port) } }
            } catch {
                let msg: String
                if case BackendError.message(let m) = error { msg = m } else { msg = "\(error)" }
                DispatchQueue.main.async { MainActor.assumeIsolated { self.showError(msg) } }
            }
        }
    }

    private func engineReady(_ port: UInt16) {
        let origin = "http://127.0.0.1:\(port)"
        main.setOrigin(origin)
        let mode = modeStore.hasChoice() ? "&mode=\(modeStore.get())" : ""  // sinon l'interface décide (Simple)
        main.load("/?ui=\(langStore.resolve())\(mode)")  // langue et mode lus par l'interface
        DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [self] in appReady = true }  // page lente : on ouvre quand même
        // Liens nxm:// reçus pendant le démarrage
        nxmPort = port
        for u in nxmPending { sendNxm(u, port: port) }
        nxmPending = []
        UpdateEngine.shared.configure(repo: "mABBAJACK", lang: { I18n.lang }, brandName: "mABBAJACK")
        UpdateEngine.shared.canInstall = { !DockProgress.active }  // jamais pendant une installation de modlist
        UpdateEngine.shared.start()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { UpdateEngine.shared.installAppMenuItem() }
    }

    private func showError(_ message: String) {
        Log.write("erreur : \(message)")
        main.loadHTML(loadingHTML(L("Erreur : {m}", ["m": message]), spinner: false))
        appReady = true
    }

    // MARK: Liens nxm:// (bouton « Mod Manager Download » de Nexus)

    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls where url.absoluteString.lowercased().hasPrefix("nxm://") {
            Log.write("lien nxm reçu")
            if let port = nxmPort { sendNxm(url.absoluteString, port: port) } else { nxmPending.append(url.absoluteString) }
        }
    }

    private func sendNxm(_ url: String, port: UInt16) {
        Task.detached {
            var req = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/api/nexus/nxm")!, timeoutInterval: 5)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try? JSONSerialization.data(withJSONObject: ["url": url])
            for _ in 0..<20 {  // le serveur peut encore démarrer
                do {
                    let (_, resp) = try await URLSession.shared.data(for: req)
                    if let code = (resp as? HTTPURLResponse)?.statusCode, code >= 400 { Log.write("lien nxm refusé : HTTP \(code)") }
                    return
                } catch { try? await Task.sleep(for: .milliseconds(500)) }
            }
            Log.write("lien nxm : serveur injoignable")
        }
    }

    // MARK: Ponts JS

    func setUiMode(_ mode: String) {
        let m = ModeStore.normalize(mode)
        modeStore.set(m)
        markMode(m)
    }

    func setDockProgress(_ percent: Int?) { DockProgress.set(percent) }

    // MARK: Splash

    private func showWindow(_ w: NSWindow) {
        if quiet { w.orderBack(nil) } else { w.orderFrontRegardless() }
    }

    private func runSplash(_ sp: WebHost) {
        var splashLoaded = false
        var started = false
        let t0 = Date()
        func showMain(waited: Double) {
            // fenêtre dès que l'interface est chargée (45 s au plus : 30 s de démarrage du moteur + 15 s de chargement)
            if !appReady && waited < 45 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { showMain(waited: waited + 0.1) }
                return
            }
            if quiet { mainWindow.orderBack(nil) } else { mainWindow.makeKeyAndOrderFront(nil); NSApp.activate() }
            Log.write(String(format: "splash : fenêtre affichée à %.2f s", Date().timeIntervalSince(t0)))
            let wait = max(0, SPLASH_LEAVE_AT - Date().timeIntervalSince(t0))
            DispatchQueue.main.asyncAfter(deadline: .now() + wait) { [self] in
                sp.js("window.splashLeave && window.splashLeave()")
                DispatchQueue.main.asyncAfter(deadline: .now() + SPLASH_LEAVE_S + 0.05) { [self] in
                    splashWindow?.close()
                    splashWindow = nil
                    splash = nil
                    Log.write(String(format: "splash : fermé à %.2f s", Date().timeIntervalSince(t0)))
                }
            }
        }
        let begin = { [self] in
            guard !started else { return }
            started = true
            showWindow(splashWindow!)
            Log.write("splash : affiché")
            DispatchQueue.main.asyncAfter(deadline: .now() + SPLASH_MAIN_AT) { showMain(waited: 0) }
        }
        sp.onLoaded = { splashLoaded = true; begin() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { _ = splashLoaded; begin() }
    }

    // MARK: Fenêtre et fin

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func windowWillClose(_ notification: Notification) {
        if (notification.object as? NSWindow) === mainWindow { NSApp.terminate(nil) }
    }

    func applicationWillTerminate(_ notification: Notification) { backend?.stop() }

    // MARK: Menus

    @objc func chooseLanguage(_ sender: NSMenuItem) {
        let choice = LanguageStore.normalize(sender.representedObject as? String)
        langStore.set(choice)
        syncAppleLanguages(choice)
        let code = I18n.setLang(langStore.resolve())
        buildMenu()
        UpdateEngine.shared.installAppMenuItem()
        main?.js("window.mabbajackSetLanguage && window.mabbajackSetLanguage(\"\(code)\")")
    }

    /// Les entrées que macOS ajoute lui-même aux menus (Dictée, Emoji…) suivent AppleLanguages, lu avant ce code :
    /// un choix explicite y est inscrit pour l'appli seule, « auto » l'en retire. Effet au lancement suivant.
    func syncAppleLanguages(_ choice: String) {
        if choice == LanguageStore.auto { UserDefaults.standard.removeObject(forKey: "AppleLanguages") }
        else { UserDefaults.standard.set([choice], forKey: "AppleLanguages") }
    }

    @objc func showAbout(_ sender: Any?) { About.show() }

    /// Chaque entrée appelle window.mabbajackMenu('<action>') (pont défini dans web/src/state/uiMode.tsx).
    @objc func webAction(_ sender: NSMenuItem) {
        guard let action = sender.representedObject as? String else { return }
        main?.js("window.mabbajackMenu && window.mabbajackMenu('\(action)')")
    }

    @objc func chooseMode(_ sender: NSMenuItem) {
        guard let mode = sender.representedObject as? String else { return }
        setUiMode(mode)
        main?.js("window.mabbajackSetMode && window.mabbajackSetMode('\(mode)')")
    }

    @objc func openLogs(_ sender: Any?) {
        try? FileManager.default.createDirectory(at: Paths.logDir, withIntermediateDirectories: true)
        NSWorkspace.shared.open(Paths.logDir)
    }

    private var modeItems: [NSMenuItem] = []

    private func markMode(_ mode: String) {
        for item in modeItems { item.state = (item.representedObject as? String) == mode ? .on : .off }
    }

    private func buildMenu() {
        let bar = NSMenu()
        modeItems = []

        // Menu de l'appli : pas de couleur dans les menus, le nom de l'appli y est en texte normal
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: L("À propos de mABBAJACK"), action: #selector(showAbout), keyEquivalent: "").target = self
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: L("Masquer mABBAJACK"), action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let others = appMenu.addItem(withTitle: L("Masquer les autres"), action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        others.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: L("Tout afficher"), action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: L("Quitter mABBAJACK"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        bar.addItem(submenuItem(appMenu))

        func action(_ menu: NSMenu, _ title: String, _ name: String) {
            let item = menu.addItem(withTitle: L(title), action: #selector(webAction), keyEquivalent: "")
            item.target = self
            item.representedObject = name
        }
        func titled(_ title: String, _ fill: (NSMenu) -> Void) -> NSMenuItem {
            let m = NSMenu(title: L(title))
            fill(m)
            return submenuItem(m)
        }

        bar.addItem(titled("Fichier") { m in
            action(m, "Ouvrir un fichier .wabbajack…", "open")
            m.addItem(.separator())
            action(m, "Paramètres…", "settings")
        })

        bar.addItem(titled("Édition") { m in
            m.addItem(withTitle: L("Couper"), action: #selector(NSText.cut(_:)), keyEquivalent: "x")
            m.addItem(withTitle: L("Copier"), action: #selector(NSText.copy(_:)), keyEquivalent: "c")
            m.addItem(withTitle: L("Coller"), action: #selector(NSText.paste(_:)), keyEquivalent: "v")
            m.addItem(withTitle: L("Tout sélectionner"), action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        })

        let current = modeStore.get()
        bar.addItem(titled("Affichage") { m in
            for (title, mode) in [("Interface simple", "simple"), ("Interface experte", "expert")] {
                let item = m.addItem(withTitle: L(title), action: #selector(chooseMode), keyEquivalent: "")
                item.target = self
                item.representedObject = mode
                item.state = mode == current ? .on : .off
                modeItems.append(item)
            }
            m.addItem(.separator())
            action(m, "Galerie", "gallery")
            action(m, "Inspecteur", "inspector")
            action(m, "Installation", "installer")
            action(m, "Progression", "progress")
            m.addItem(.separator())
            action(m, "Actualiser le catalogue", "refresh")
            m.addItem(.separator())
            let fs = m.addItem(withTitle: L("Plein écran"), action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
            fs.keyEquivalentModifierMask = [.command, .control]
        })

        // Menu « Langue » : Automatique + 4 langues, coche sur le choix courant
        bar.addItem(titled("Langue") { m in
            let choice = langStore.get()
            func add(_ title: String, _ code: String) {
                let item = m.addItem(withTitle: title, action: #selector(chooseLanguage), keyEquivalent: "")
                item.target = self
                item.representedObject = code
                item.state = code == choice ? .on : .off
            }
            add(L("Automatique (système)"), LanguageStore.auto)
            m.addItem(.separator())
            for code in ["fr", "en", "es", "it"] { add(I18n.langs[code]!, code) }
        })

        let win = titled("Fenêtre") { m in
            m.addItem(withTitle: L("Réduire"), action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        }
        bar.addItem(win)

        bar.addItem(titled("Aide") { m in
            let item = m.addItem(withTitle: L("Ouvrir le dossier des journaux"), action: #selector(openLogs), keyEquivalent: "")
            item.target = self
        })

        NSApp.mainMenu = bar
        NSApp.windowsMenu = win.submenu
    }

    private func submenuItem(_ menu: NSMenu) -> NSMenuItem {
        let item = NSMenuItem()
        item.submenu = menu
        return item
    }
}

// Langue : choix du menu « Langue » (« auto » = langue du Mac). Les menus natifs que macOS complète lui-même
// suivent AppleLanguages (inscrit à chaque changement de langue).
let languageStore = LanguageStore()
I18n.setLang(languageStore.resolve())

MainActor.assumeIsolated {
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.regular)
    app.run()
}
