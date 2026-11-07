// Serveur Node embarqué : localisation du payload et de node, choix du port (38300 d'abord : l'origine, donc le
// localStorage de l'interface, doit rester la même), lancement dans son propre groupe de processus, arrêt propre.

import Darwin
import Foundation

public enum BackendError: Error { case message(String) }

public final class Backend: @unchecked Sendable {
    public static let preferredPort: UInt16 = 38300
    public let root: URL
    public private(set) var port: UInt16 = 0
    private var pid: pid_t = 0
    private let lock = NSLock()

    public init(root: URL) { self.root = root }

    /// Dossier du moteur : MABBAJACK_HOME (développement), sinon Contents/Resources/payload de l'appli.
    public static func payloadDir() -> URL? {
        if let env = ProcessInfo.processInfo.environment["MABBAJACK_HOME"] { return URL(fileURLWithPath: (env as NSString).expandingTildeInPath) }
        if let res = Bundle.main.resourcePath {
            let p = URL(fileURLWithPath: res).appendingPathComponent("payload")
            if FileManager.default.fileExists(atPath: p.path) { return p }
        }
        return nil
    }

    public static func findNode(_ root: URL) -> String? {
        let fm = FileManager.default
        let bundled = root.appendingPathComponent("bin/node").path
        if fm.isExecutableFile(atPath: bundled) { return bundled }
        for dir in (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":") {
            let c = "\(dir)/node"
            if fm.isExecutableFile(atPath: c) { return c }
        }
        return ["/opt/homebrew/bin/node", "/usr/local/bin/node"].first { fm.isExecutableFile(atPath: $0) }
    }

    /// 38300 si libre, sinon un port libre quelconque.
    public static func pickPort(preferred: UInt16 = preferredPort) throws -> UInt16 {
        for want in [preferred, 0] {
            let s = socket(AF_INET, SOCK_STREAM, 0)
            guard s >= 0 else { continue }
            defer { close(s) }
            var addr = sockaddr_in()
            addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
            addr.sin_family = sa_family_t(AF_INET)
            addr.sin_port = want.bigEndian
            addr.sin_addr.s_addr = inet_addr("127.0.0.1")
            let ok = withUnsafePointer(to: &addr) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(s, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } }
            guard ok == 0 else { continue }
            var out = sockaddr_in()
            var len = socklen_t(MemoryLayout<sockaddr_in>.size)
            _ = withUnsafeMutablePointer(to: &out) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(s, $0, &len) } }
            return UInt16(bigEndian: out.sin_port)
        }
        throw BackendError.message(L("Aucun port local disponible."))
    }

    public static func portOpen(_ port: UInt16) -> Bool {
        let s = socket(AF_INET, SOCK_STREAM, 0)
        guard s >= 0 else { return false }
        defer { close(s) }
        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = port.bigEndian
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        return withUnsafePointer(to: &addr) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(s, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } } == 0
    }

    /// Lance node et attend (30 s au plus) que le port réponde. À appeler hors du fil principal.
    public func start() throws {
        let server = root.appendingPathComponent("server/server.js")
        guard FileManager.default.fileExists(atPath: server.path) else { throw BackendError.message(L("Serveur introuvable : {p}", ["p": server.path])) }
        guard let node = Backend.findNode(root) else { throw BackendError.message(L("Node.js introuvable (ni embarqué, ni installé).")) }
        port = try Backend.pickPort()
        try FileManager.default.createDirectory(at: Paths.logDir, withIntermediateDirectories: true)

        var env = ProcessInfo.processInfo.environment
        env["PORT"] = String(port)
        env["MABBAJACK_LOG_DIR"] = Paths.logDir.path
        env["MABBAJACK_BIN_DIR"] = root.appendingPathComponent("bin").path
        env["MABBAJACK_PARENT_PID"] = String(getpid())
        env["PATH"] = [root.appendingPathComponent("bin").path, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", env["PATH"] ?? ""].joined(separator: ":")

        var actions: posix_spawn_file_actions_t? = nil
        posix_spawn_file_actions_init(&actions)
        defer { posix_spawn_file_actions_destroy(&actions) }
        let logPath = Paths.logDir.appendingPathComponent("server-stdout.log").path
        posix_spawn_file_actions_addopen(&actions, 1, logPath, O_WRONLY | O_CREAT | O_APPEND, 0o644)
        posix_spawn_file_actions_adddup2(&actions, 1, 2)
        posix_spawn_file_actions_addchdir_np(&actions, root.path)
        var attr: posix_spawnattr_t? = nil
        posix_spawnattr_init(&attr)
        defer { posix_spawnattr_destroy(&attr) }
        posix_spawnattr_setflags(&attr, Int16(POSIX_SPAWN_SETSID))  // propre groupe de processus : arrêt de tous les enfants (7zz, unar…)

        let args = [node, server.path]
        var argv: [UnsafeMutablePointer<CChar>?] = args.map { strdup($0) } + [nil]
        var envp: [UnsafeMutablePointer<CChar>?] = env.map { strdup("\($0.key)=\($0.value)") } + [nil]
        defer { argv.forEach { free($0) }; envp.forEach { free($0) } }
        var child: pid_t = 0
        let rc = posix_spawn(&child, node, &actions, &attr, argv, envp)
        guard rc == 0 else { throw BackendError.message(L("Impossible de lancer le serveur : {m}", ["m": String(cString: strerror(rc))])) }
        lock.lock(); pid = child; lock.unlock()
        Log.write("moteur lancé : pid \(child), port \(port)")

        for _ in 0..<120 {
            var status: Int32 = 0
            if waitpid(child, &status, WNOHANG) == child {
                lock.lock(); pid = 0; lock.unlock()
                throw BackendError.message(L("Le serveur s'est arrêté (code {c}). Voir {d}.", ["c": Int((status >> 8) & 0xff), "d": Paths.logDir.path]))
            }
            if Backend.portOpen(port) { return }
            Thread.sleep(forTimeInterval: 0.25)
        }
        throw BackendError.message(L("Le serveur ne répond pas après 30 s."))
    }

    /// SIGTERM puis SIGKILL sur tout le groupe de node. Sans effet si le moteur n'est pas lancé.
    public func stop() {
        lock.lock(); let child = pid; pid = 0; lock.unlock()
        guard child > 0 else { return }
        func signalGroup(_ sig: Int32) { _ = killpg(child, sig) }
        func reaped(_ timeout: Double) -> Bool {
            let end = Date().addingTimeInterval(timeout)
            while Date() < end {
                var st: Int32 = 0
                let r = waitpid(child, &st, WNOHANG)
                if r == child || (r == -1 && errno == ECHILD) { return true }
                Thread.sleep(forTimeInterval: 0.05)
            }
            return false
        }
        signalGroup(SIGCONT)  // un processus suspendu ne reçoit pas SIGTERM
        signalGroup(SIGTERM)
        if !reaped(3) {
            signalGroup(SIGKILL)
            _ = reaped(2)
        }
        signalGroup(SIGKILL)  // enfants éventuels restés dans le groupe
        Log.write("moteur arrêté")
    }
}
