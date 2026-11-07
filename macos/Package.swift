// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "mABBAJACK",
    platforms: [.macOS(.v14)],
    targets: [
        // Moteur Node (lancement, port, arrêt), réglages de l'enveloppe, langue : sans interface (testable seul)
        .target(name: "MBCore"),
        .executableTarget(name: "mABBAJACK", dependencies: ["MBCore"]),
        .testTarget(name: "MBCoreTests", dependencies: ["MBCore"]),
    ],
    swiftLanguageModes: [.v5]
)
