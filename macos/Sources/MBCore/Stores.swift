// Réglages de l'enveloppe, dans les mêmes fichiers que la version Python : ~/Library/Application Support/mAbbajack
// (language.json, ui_mode.json) et journaux dans ~/Library/Logs/mAbbajack. Les noms de dossiers ne changent pas.

import Foundation

public enum Paths {
    public static let dataName = "mAbbajack"
    public static var dataDir: URL { FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/\(dataName)") }
    public static var logDir: URL { FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/\(dataName)") }
}

/// Choix de langue (« auto » ou fr/en/es/it) dans language.json.
public struct LanguageStore {
    public static let auto = "auto"
    let url: URL
    public init(dir: URL = Paths.dataDir) { url = dir.appendingPathComponent("language.json") }

    public static func normalize(_ c: String?) -> String {
        let c = (c ?? "").trimmingCharacters(in: .whitespaces)
        return I18n.langs[c] != nil ? c : auto
    }

    public func get() -> String {
        guard let d = try? Data(contentsOf: url), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return Self.auto }
        return Self.normalize(o["language"] as? String)
    }

    public func set(_ choice: String) {
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let o = ["language": Self.normalize(choice)]
        if let d = try? JSONSerialization.data(withJSONObject: o) { try? d.write(to: url) }
    }

    /// Langue à afficher : le choix, ou celle du Mac (« auto »), anglais si elle n'est pas prise en charge.
    public func resolve() -> String {
        let c = get()
        return c == Self.auto ? I18n.systemLang() : c
    }
}

/// Présentation de l'interface (simple ou expert) dans ui_mode.json.
public struct ModeStore {
    public static let modes = ["simple", "expert"]
    let url: URL
    public init(dir: URL = Paths.dataDir) { url = dir.appendingPathComponent("ui_mode.json") }

    public static func normalize(_ m: String?) -> String { modes.contains(m ?? "") ? m! : "simple" }

    public func get() -> String {
        guard let d = try? Data(contentsOf: url), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return "simple" }
        return Self.normalize(o["mode"] as? String)
    }

    /// Vrai une fois que l'utilisateur a choisi un mode (sinon l'interface décide).
    public func hasChoice() -> Bool { FileManager.default.fileExists(atPath: url.path) }

    public func set(_ mode: String) {
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let d = try? JSONSerialization.data(withJSONObject: ["mode": Self.normalize(mode)]) { try? d.write(to: url) }
    }
}

/// Journal du lanceur : ~/Library/Logs/mAbbajack/launcher.log.
public enum Log {
    nonisolated(unsafe) static let lock = NSLock()
    public static func write(_ msg: String) {
        lock.lock(); defer { lock.unlock() }
        let url = Paths.logDir.appendingPathComponent("launcher.log")
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd HH:mm:ss"
        guard let data = "\(f.string(from: Date())) \(msg)\n".data(using: .utf8) else { return }
        if let h = try? FileHandle(forWritingTo: url) {
            h.seekToEndOfFile(); h.write(data); try? h.close()
        } else {
            try? FileManager.default.createDirectory(at: Paths.logDir, withIntermediateDirectories: true)
            try? data.write(to: url)
        }
    }
}
