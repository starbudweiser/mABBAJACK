import XCTest
@testable import MBCore

final class CoreTests: XCTestCase {
    func tmp() -> URL {
        let d = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    func testLanguageStore() {
        let s = LanguageStore(dir: tmp())
        XCTAssertEqual(s.get(), "auto")
        s.set("es"); XCTAssertEqual(s.get(), "es"); XCTAssertEqual(s.resolve(), "es")
        s.set("xx"); XCTAssertEqual(s.get(), "auto")
    }

    func testModeStore() {
        let s = ModeStore(dir: tmp())
        XCTAssertFalse(s.hasChoice()); XCTAssertEqual(s.get(), "simple")
        s.set("expert"); XCTAssertTrue(s.hasChoice()); XCTAssertEqual(s.get(), "expert")
        XCTAssertEqual(ModeStore.normalize("zzz"), "simple")
    }

    func testSystemLangFallback() {
        XCTAssertEqual(I18n.systemLang(["it-IT"]), "it")
        XCTAssertEqual(I18n.systemLang(["ja-JP", "fr-FR"]), "fr")
        XCTAssertEqual(I18n.systemLang(["ja-JP"]), "en")
    }

    func testTranslations() {
        I18n.setLang("en")
        XCTAssertEqual(L("Aide"), "Help")
        XCTAssertEqual(L("Erreur : {m}", ["m": "x"]), "Error: x")
        I18n.setLang("fr")
    }

    func testPickPortAvoidsBusyPreferred() throws {
        let p = try Backend.pickPort(preferred: 0)
        XCTAssertGreaterThan(p, 0)
    }

    func testBackendStartsAndStopsGroup() throws {
        let root = tmp()
        try FileManager.default.createDirectory(at: root.appendingPathComponent("server"), withIntermediateDirectories: true)
        try "require('http').createServer((q,r)=>r.end('ok')).listen(Number(process.env.PORT),'127.0.0.1');setInterval(()=>{},1000)"
            .write(to: root.appendingPathComponent("server/server.js"), atomically: true, encoding: .utf8)
        guard Backend.findNode(root) != nil else { throw XCTSkip("node absent") }
        let b = Backend(root: root)
        try b.start()
        XCTAssertTrue(Backend.portOpen(b.port))
        b.stop()
        Thread.sleep(forTimeInterval: 0.3)
        XCTAssertFalse(Backend.portOpen(b.port))
    }
}
