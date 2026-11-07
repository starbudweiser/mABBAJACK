// Fenêtre de l'interface : WKWebView qui affiche http://127.0.0.1:<port> (origine du stockage de l'utilisateur : clé Nexus
// et réglages), avec les boîtes de dialogue JavaScript, le choix de fichiers, les téléchargements, le glisser-déposer qui
// transmet le chemin complet à l'interface et la couche de compatibilité window.pywebview.api (ponts vers l'appli).

import AppKit
import MBCore
import WebKit

/// WKWebView qui, au dépôt d'un fichier, transmet son chemin complet à l'interface (window.mabbajackDroppedPath) :
/// le DOM, lui, ne le donne pas.
final class DropWebView: WKWebView {
    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        let urls = (sender.draggingPasteboard.readObjects(forClasses: [NSURL.self],
                    options: [.urlReadingFileURLsOnly: true]) as? [URL]) ?? []
        let ok = super.performDragOperation(sender)
        if let path = urls.first?.path {
            Log.write("dépôt : \(urls.map { $0.lastPathComponent })")
            let json = (try? JSONSerialization.data(withJSONObject: path, options: .fragmentsAllowed)).map { String(decoding: $0, as: UTF8.self) } ?? "\"\""
            evaluateJavaScript("window.mabbajackDroppedPath && window.mabbajackDroppedPath(\(json))")
        }
        return ok
    }
}

/// Ponts JS → appli (webkit.messageHandlers.<nom>).
@MainActor
protocol WebBridge: AnyObject {
    func setUiMode(_ mode: String)
    func setDockProgress(_ percent: Int?)
}

@MainActor
final class WebHost: NSObject, WKUIDelegate, WKNavigationDelegate, WKDownloadDelegate, WKScriptMessageHandler {
    let webView: DropWebView
    var onLoaded: (() -> Void)?
    weak var bridge: WebBridge?
    private(set) var origin: String

    init(origin: String = "", transparent: Bool = false, bridged: Bool = false) {
        self.origin = origin
        let config = WKWebViewConfiguration()
        // Magasin par défaut (identifiant com.mabbajack.app) : c'est là que sont la clé Nexus et les réglages
        config.websiteDataStore = .default()
        webView = DropWebView(frame: .zero, configuration: config)
        super.init()
        if bridged {
            // Couche de compatibilité : l'interface appelle toujours window.pywebview.api.set_ui_mode / set_dock_progress
            let screens = NSScreen.screens.map { [Int($0.frame.width), Int($0.frame.height)] }
            let screensJS = (try? JSONSerialization.data(withJSONObject: screens)).map { String(decoding: $0, as: UTF8.self) } ?? "[]"
            let js = """
            window.mabbajackScreens = \(screensJS);
            window.pywebview = { api: {
              set_ui_mode: function (m) { window.webkit.messageHandlers.setUiMode.postMessage(String(m)); },
              set_dock_progress: function (p) { window.webkit.messageHandlers.dockProgress.postMessage(p === null || p === undefined ? -1 : Number(p)); }
            } };
            """
            config.userContentController.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true))
            config.userContentController.add(self, name: "setUiMode")
            config.userContentController.add(self, name: "dockProgress")
        }
        webView.uiDelegate = self
        webView.navigationDelegate = self
        webView.allowsMagnification = false
        webView.allowsBackForwardNavigationGestures = false
        if transparent { webView.setValue(false, forKey: "drawsBackground") }
        else { webView.underPageBackgroundColor = NSColor(srgbRed: 0x1e / 255, green: 0x1e / 255, blue: 0x1e / 255, alpha: 1) }
        if ProcessInfo.processInfo.environment["MABBAJACK_DEBUG"] != nil { webView.isInspectable = true }
    }

    func setOrigin(_ o: String) { origin = o }
    func load(_ path: String) { webView.load(URLRequest(url: URL(string: origin + path)!)) }
    func loadHTML(_ html: String) { webView.loadHTMLString(html, baseURL: nil) }
    func js(_ code: String) { webView.evaluateJavaScript(code) }

    /// Vrai quand la page affichée est l'interface du moteur (et non la page d'attente).
    var showsApp: Bool { !origin.isEmpty && (webView.url?.absoluteString.hasPrefix(origin) ?? false) }

    // MARK: Ponts

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        switch message.name {
        case "setUiMode": if let m = message.body as? String { bridge?.setUiMode(m) }
        case "dockProgress":
            if let p = (message.body as? NSNumber)?.doubleValue { bridge?.setDockProgress(p < 0 ? nil : max(0, min(100, Int(p.rounded())))) }
        default: break
        }
    }

    // MARK: Navigation

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { onLoaded?() }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        if navigationAction.shouldPerformDownload { return decisionHandler(.download) }
        if let url = navigationAction.request.url, let scheme = url.scheme, ["http", "https", "mailto"].contains(scheme),
           origin.isEmpty || !url.absoluteString.hasPrefix(origin) {
            NSWorkspace.shared.open(url)  // lien externe : navigateur du Mac
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping @MainActor (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { NSWorkspace.shared.open(url) }
        return nil
    }

    // MARK: Téléchargements (<a download>, blob:) : sélecteur d'enregistrement natif

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping @MainActor (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        panel.directoryURL = FileManager.default.urls(for: .desktopDirectory, in: .userDomainMask).first
        guard panel.runModal() == .OK, let url = panel.url else { return completionHandler(nil) }
        try? FileManager.default.removeItem(at: url)
        completionHandler(url)
    }

    // MARK: Boîtes de dialogue JavaScript

    private func alert(_ message: String, buttons: [String]) -> NSApplication.ModalResponse {
        let a = NSAlert()
        a.messageText = message
        for b in buttons { a.addButton(withTitle: b) }
        return a.runModal()
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping @MainActor () -> Void) {
        _ = alert(message, buttons: [L("OK")])
        completionHandler()
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping @MainActor (Bool) -> Void) {
        completionHandler(alert(message, buttons: [L("OK"), L("Annuler")]) == .alertFirstButtonReturn)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (String?) -> Void) {
        let a = NSAlert()
        a.messageText = prompt
        a.addButton(withTitle: L("OK"))
        a.addButton(withTitle: L("Annuler"))
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
        field.stringValue = defaultText ?? ""
        a.accessoryView = field
        completionHandler(a.runModal() == .alertFirstButtonReturn ? field.stringValue : nil)
    }

    // <input type="file"> : sélecteur natif
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping @MainActor ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        completionHandler(panel.runModal() == .OK ? panel.urls : nil)
    }
}
