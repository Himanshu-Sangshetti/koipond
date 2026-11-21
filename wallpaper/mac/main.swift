// koipond wallpaper for macOS.
//
// One borderless window per display, pinned to the desktop layer (under the icons), showing the pond
// page in the system web view. Clicks pass straight through to the desktop; the app watches the mouse
// itself and forwards it to the pond, but only where the desktop is actually visible.
import Cocoa
import WebKit
import IOKit.ps
import ServiceManagement

// MARK: - settings

struct Settings: Codable {
    var look = "natural"
    var fish = 14
    var rain = true
    var pads = true
    var petals = true
    var interactive = true
    var paused = false

    static let key = "settings"
    static func load() -> Settings {
        guard let d = UserDefaults.standard.data(forKey: key), let s = try? JSONDecoder().decode(Settings.self, from: d) else { return Settings() }
        return s
    }
    func save() { if let d = try? JSONEncoder().encode(self) { UserDefaults.standard.set(d, forKey: Settings.key) } }
}

// MARK: - one wallpaper window per screen

final class LogBridge: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    static let shared = LogBridge()
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) { NSLog("koipond page: %@", "\(m.body)") }
    func webView(_ w: WKWebView, didFinish n: WKNavigation!) { NSLog("koipond: page loaded") }
    func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) { NSLog("koipond: page failed %@", e.localizedDescription) }
    func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { NSLog("koipond: page failed %@", e.localizedDescription) }
    func webViewWebContentProcessDidTerminate(_ w: WKWebView) { NSLog("koipond: web process ended, reloading"); w.reload() }
}

let debug = ProcessInfo.processInfo.environment["KOI_DEBUG"] != nil

final class PondWindow: NSWindow {
    let web: WKWebView
    let screenRef: NSScreen

    init(screen: NSScreen, page: URL, initJSON: String) {
        screenRef = screen
        let config = WKWebViewConfiguration()
        config.suppressesIncrementalRendering = true
        if debug, #available(macOS 14.0, *) { config.preferences.inactiveSchedulingPolicy = .none }
        // settings are in place before the page script runs
        config.userContentController.addUserScript(WKUserScript(source: "window.__koiInit = \(initJSON);", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        // page errors and console lines end up in the system log (Console.app → "koipond")
        config.userContentController.add(LogBridge.shared, name: "log")
        config.userContentController.addUserScript(WKUserScript(source: """
            (() => { const send = (...a) => { try { webkit.messageHandlers.log.postMessage(a.map(String).join(' ')) } catch {} };
              const w = console.warn, e = console.error; console.warn = (...a) => { send('warn', ...a); w(...a) }; console.error = (...a) => { send('error', ...a); e(...a) };
              addEventListener('error', (ev) => send('error', ev.message, ev.filename + ':' + ev.lineno)); })();
            """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web = WKWebView(frame: NSRect(origin: .zero, size: screen.frame.size), configuration: config)
        web.setValue(false, forKey: "drawsBackground")
        web.autoresizingMask = [.width, .height]
        web.navigationDelegate = LogBridge.shared
        super.init(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
        setFrame(screen.frame, display: false)
        level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)))
        if ProcessInfo.processInfo.environment["KOI_FLOAT"] != nil {
            // test mode: a small floating window instead of the desktop layer
            level = .floating; collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            setFrame(NSRect(x: screen.frame.maxX - 760, y: screen.frame.minY + 40, width: 720, height: 440), display: false)
        }
        collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenNone]
        ignoresMouseEvents = true
        isOpaque = true
        hasShadow = false
        backgroundColor = NSColor(red: 0.024, green: 0.165, blue: 0.2, alpha: 1)
        isReleasedWhenClosed = false
        contentView = web
        web.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent())
        if level == .floating { orderFrontRegardless() } else { orderBack(nil) }
    }

    func js(_ s: String) { web.evaluateJavaScript(s, completionHandler: nil) }

    /// Global mouse position (Cocoa, bottom-left origin) → CSS pixels in this window, or nil if off this screen.
    func local(_ p: NSPoint) -> NSPoint? {
        let f = frame
        guard f.contains(p) || (p.x == f.maxX || p.y == f.maxY) else { return nil }
        return NSPoint(x: p.x - f.minX, y: f.maxY - p.y)
    }
}

// MARK: - app

final class App: NSObject, NSApplicationDelegate, NSMenuDelegate {
    var settings = Settings.load()
    var windows: [PondWindow] = []
    var status: NSStatusItem!
    var page: URL!
    var timer: Timer?
    var lastMouse = NSPoint(x: -1, y: -1)
    var wasDown = false
    var overWindow: PondWindow?
    var coverCache: (at: TimeInterval, point: NSPoint, covered: Bool) = (0, .zero, true)
    var hiddenBySystem = false   // screen asleep / locked / desktop occluded
    var monitors: [Any] = []

    func applicationDidFinishLaunching(_ n: Notification) {
        guard let p = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web") else {
            NSLog("koipond: page missing from the app bundle"); NSApp.terminate(nil); return
        }
        page = p
        buildWindows()
        buildMenu()

        // the mouse: polled for position and buttons (no permissions needed); scroll from a global monitor
        if debug {
            Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
                if let w = self?.windows.first, ProcessInfo.processInfo.environment["KOI_SNAP"] != nil {
                    w.web.takeSnapshot(with: nil) { img, _ in
                        if let t = img?.tiffRepresentation, let r = NSBitmapImageRep(data: t), let png = r.representation(using: .png, properties: [:]) {
                            try? png.write(to: URL(fileURLWithPath: ProcessInfo.processInfo.environment["KOI_SNAP"]!))
                        }
                    }
                }
                self?.windows.first?.web.evaluateJavaScript("[window.__frames, document.querySelector('canvas')?.width, document.visibilityState].join(' ')") { r, e in NSLog("koipond: frames %@", "\(r ?? e ?? "nil")") }
            }
        }
        timer = Timer(timeInterval: 1.0 / 60, repeats: true) { [weak self] _ in self?.pollMouse() }
        RunLoop.main.add(timer!, forMode: .common)
        if let m = NSEvent.addGlobalMonitorForEvents(matching: .scrollWheel, handler: { [weak self] e in self?.scroll(e) }) { monitors.append(m) }

        let nc = NSWorkspace.shared.notificationCenter
        nc.addObserver(self, selector: #selector(systemHide), name: NSWorkspace.screensDidSleepNotification, object: nil)
        nc.addObserver(self, selector: #selector(systemHide), name: NSWorkspace.sessionDidResignActiveNotification, object: nil)
        nc.addObserver(self, selector: #selector(systemShow), name: NSWorkspace.screensDidWakeNotification, object: nil)
        nc.addObserver(self, selector: #selector(systemShow), name: NSWorkspace.sessionDidBecomeActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(screensChanged), name: NSApplication.didChangeScreenParametersNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(occlusionChanged), name: NSWindow.didChangeOcclusionStateNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(pushSettings), name: Notification.Name.NSProcessInfoPowerStateDidChange, object: nil)
        // battery ↔ power adapter
        let src = IOPSNotificationCreateRunLoopSource({ ctx in
            guard let ctx else { return }
            Unmanaged<App>.fromOpaque(ctx).takeUnretainedValue().pushSettings()
        }, Unmanaged.passUnretained(self).toOpaque()).takeRetainedValue()
        CFRunLoopAddSource(CFRunLoopGetMain(), src, .defaultMode)
    }

    // MARK: windows

    var initJSON: String { pageSettings() }

    func buildWindows() {
        windows.forEach { $0.close() }
        windows = NSScreen.screens.map { PondWindow(screen: $0, page: page, initJSON: initJSON) }
    }

    @objc func screensChanged() {
        // rebuild only when the set of displays or their frames really changed
        if NSScreen.screens.map({ $0.frame }) != windows.map({ $0.screenRef.frame }) { buildWindows() }
    }

    // MARK: settings → page

    var onBattery: Bool {
        guard let t = IOPSGetProvidingPowerSourceType(nil)?.takeRetainedValue() as String? else { return false }
        return t == kIOPSBatteryPowerValue
    }

    func pageSettings() -> String {
        let env = ProcessInfo.processInfo.environment
        var fps = (onBattery || ProcessInfo.processInfo.isLowPowerModeEnabled) ? 30 : 60
        if let f = env["KOI_FPS"].flatMap(Int.init) { fps = f }
        let dpr = env["KOI_DPR"] ?? "0"
        let paused = settings.paused || hiddenBySystem
        return "{\"look\":\"\(settings.look)\",\"fish\":\(settings.fish),\"rain\":\(settings.rain ? 0.5 : 0),\"pads\":\(settings.pads),\"petals\":\(settings.petals),\"fps\":\(fps),\"paused\":\(paused),\"dpr\":\(dpr)}"
    }

    @objc func pushSettings() {
        DispatchQueue.main.async {
            let s = self.pageSettings()
            self.windows.forEach { $0.js("window.koi && koi.set(\(s))") }
        }
    }

    @objc func systemHide() { hiddenBySystem = true; pushSettings() }
    @objc func systemShow() { hiddenBySystem = false; updateOcclusion() }
    @objc func occlusionChanged() { updateOcclusion() }

    func updateOcclusion() {
        // pause while no part of any pond can be seen (full-screen apps, everything maximised)
        let visible = debug || windows.contains { $0.occlusionState.contains(.visible) }
        if debug { NSLog("koipond: occlusion visible=%d", windows.contains { $0.occlusionState.contains(.visible) } ? 1 : 0) }
        hiddenBySystem = !visible
        pushSettings()
    }

    // MARK: mouse

    /// True when another app's window (or the Dock / menu bar) is under the point, so the desktop is not visible there.
    func covered(_ p: NSPoint) -> Bool {
        let now = ProcessInfo.processInfo.systemUptime
        if now - coverCache.at < 0.05 && hypot(p.x - coverCache.point.x, p.y - coverCache.point.y) < 6 { return coverCache.covered }
        // window bounds use top-left origin over the main display
        let mainH = NSScreen.screens.first?.frame.maxY ?? 0
        let q = CGPoint(x: p.x, y: mainH - p.y)
        let me = ProcessInfo.processInfo.processIdentifier
        var hit = false
        if let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] {
            for w in list {
                guard let pid = w[kCGWindowOwnerPID as String] as? Int32, pid != me,
                      let layer = w[kCGWindowLayer as String] as? Int, layer >= 0,
                      let alpha = w[kCGWindowAlpha as String] as? Double, alpha > 0.01,
                      let b = w[kCGWindowBounds as String] as? [String: CGFloat],
                      let rect = CGRect(dictionaryRepresentation: b as CFDictionary) else { continue }
                let owner = w[kCGWindowOwnerName as String] as? String ?? ""
                // the Dock keeps full-screen transparent windows around; only its real bar counts
                if owner == "Dock" && rect.height > 300 { continue }
                if owner == "Window Server" { continue }
                if rect.contains(q) { hit = true; break }
            }
        }
        coverCache = (now, p, hit)
        return hit
    }

    func pollMouse() {
        guard settings.interactive, !settings.paused, !hiddenBySystem else { return }
        let p = NSEvent.mouseLocation
        let down = NSEvent.pressedMouseButtons & 1 == 1
        let moved = p != lastMouse
        if !moved && down == wasDown { return }
        let target = windows.first { $0.local(p) != nil }
        let visible = target != nil && !covered(p)

        if let old = overWindow, old !== target || !visible { old.js("koi.leave()"); overWindow = nil }
        if let w = target, visible, let l = w.local(p) {
            overWindow = w
            let x = Int(l.x), y = Int(l.y)
            if down && !wasDown { w.js("koi.down(\(x),\(y))") }
            else if !down && wasDown { w.js("koi.up(\(x),\(y))") }
            if moved { w.js("koi.move(\(x),\(y))") }
        } else if !down && wasDown {
            windows.forEach { $0.js("koi.up(0,0)") }
        }
        lastMouse = p
        wasDown = down
    }

    func scroll(_ e: NSEvent) {
        guard settings.interactive, let w = overWindow else { return }
        let k: CGFloat = e.hasPreciseScrollingDeltas ? 1 : 12
        w.js("koi.wheel(\(-e.scrollingDeltaX * k),\(-e.scrollingDeltaY * k))")
    }

    // MARK: menu

    func buildMenu() {
        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let img = NSImage(systemSymbolName: "fish", accessibilityDescription: "koipond") {
            img.isTemplate = true
            status.button?.image = img
        } else { status.button?.title = "鯉" }
        let menu = NSMenu()
        menu.delegate = self
        status.menu = menu
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let title = NSMenuItem(title: "koipond", action: nil, keyEquivalent: "")
        title.isEnabled = false
        menu.addItem(title)
        menu.addItem(.separator())

        for (id, name) in [("natural", "Natural"), ("ink", "Ink"), ("violet", "Dither")] {
            menu.addItem(item(name, #selector(setLook(_:)), on: settings.look == id, rep: id))
        }
        menu.addItem(.separator())
        let koi = NSMenuItem(title: "Koi", action: nil, keyEquivalent: "")
        let sub = NSMenu()
        for n in [6, 10, 14, 18, 24] { sub.addItem(item("\(n)", #selector(setFish(_:)), on: settings.fish == n, rep: n)) }
        koi.submenu = sub
        menu.addItem(koi)
        menu.addItem(item("Rain", #selector(toggle(_:)), on: settings.rain, rep: "rain"))
        menu.addItem(item("Sakura", #selector(toggle(_:)), on: settings.petals, rep: "petals"))
        menu.addItem(item("Lily pads", #selector(toggle(_:)), on: settings.pads, rep: "pads"))
        menu.addItem(item("React to the mouse", #selector(toggle(_:)), on: settings.interactive, rep: "interactive"))
        menu.addItem(.separator())
        menu.addItem(item(settings.paused ? "Resume" : "Pause", #selector(togglePause), on: false))
        menu.addItem(item("Open at login", #selector(toggleLogin), on: loginEnabled))
        menu.addItem(.separator())
        menu.addItem(item("Quit koipond", #selector(quit), on: false, key: "q"))
    }

    func item(_ t: String, _ a: Selector, on: Bool, rep: Any? = nil, key: String = "") -> NSMenuItem {
        let i = NSMenuItem(title: t, action: a, keyEquivalent: key)
        i.target = self
        i.state = on ? .on : .off
        i.representedObject = rep
        return i
    }

    func changed() { settings.save(); pushSettings() }

    @objc func setLook(_ i: NSMenuItem) { settings.look = i.representedObject as! String; changed() }
    @objc func setFish(_ i: NSMenuItem) { settings.fish = i.representedObject as! Int; changed() }
    @objc func toggle(_ i: NSMenuItem) {
        switch i.representedObject as! String {
        case "rain": settings.rain.toggle()
        case "petals": settings.petals.toggle()
        case "pads": settings.pads.toggle()
        default:
            settings.interactive.toggle()
            if !settings.interactive { windows.forEach { $0.js("koi.leave()") } }
        }
        changed()
    }
    @objc func togglePause() { settings.paused.toggle(); changed() }
    @objc func quit() { NSApp.terminate(nil) }

    // MARK: open at login

    var loginEnabled: Bool { SMAppService.mainApp.status == .enabled }

    @objc func toggleLogin() {
        do {
            if loginEnabled { try SMAppService.mainApp.unregister() } else { try SMAppService.mainApp.register() }
        } catch {
            let a = NSAlert()
            a.messageText = "Couldn't change Open at login"
            a.informativeText = "Move koipond to Applications and try again.\n\n\(error.localizedDescription)"
            a.runModal()
        }
    }
}

let app = NSApplication.shared
let delegate = App()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
