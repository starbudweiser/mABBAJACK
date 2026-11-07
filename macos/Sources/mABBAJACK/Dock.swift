// Jauge de progression dans l'icône du Dock pendant une installation (appelée par l'interface : set_dock_progress).

import AppKit

@MainActor
enum DockProgress {
    private static var view: NSImageView?
    private static var bar: NSProgressIndicator?
    private static var last: Int?
    private(set) static var active = false

    /// 0 à 100, ou nil pour rendre l'icône d'origine.
    static func set(_ percent: Int?) {
        guard percent != last else { return }
        last = percent
        active = percent != nil
        let tile = NSApp.dockTile
        guard let percent else {
            tile.contentView = nil
            tile.badgeLabel = nil
            tile.display()
            return
        }
        if view == nil {
            let size = tile.size
            let v = NSImageView(frame: NSRect(origin: .zero, size: size))
            v.image = NSApp.applicationIconImage
            let b = NSProgressIndicator(frame: NSRect(x: size.width * 0.1, y: size.height * 0.06, width: size.width * 0.8, height: size.height * 0.12))
            b.style = .bar
            b.isIndeterminate = false
            b.minValue = 0
            b.maxValue = 100
            v.addSubview(b)
            view = v
            bar = b
        }
        bar?.doubleValue = Double(percent)
        tile.contentView = view
        tile.badgeLabel = "\(percent) %"
        tile.display()
    }
}
