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
    var quality = "balanced"   // smooth (60 fps) · balanced (30 fps) · saver (20 fps, lower resolution)
    var size = 0.18
    var rainAmount = 0.5
    var showIcon = true

    init() {}
    // older saves miss newer fields: keep what is there, default the rest
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self), z = Settings()
        look = (try? c.decode(String.self, forKey: .look)) ?? z.look
        fish = (try? c.decode(Int.self, forKey: .fish)) ?? z.fish
        rain = (try? c.decode(Bool.self, forKey: .rain)) ?? z.rain
        pads = (try? c.decode(Bool.self, forKey: .pads)) ?? z.pads
        petals = (try? c.decode(Bool.self, forKey: .petals)) ?? z.petals
        interactive = (try? c.decode(Bool.self, forKey: .interactive)) ?? z.interactive
        paused = (try? c.decode(Bool.self, forKey: .paused)) ?? z.paused
        quality = (try? c.decode(String.self, forKey: .quality)) ?? z.quality
        size = (try? c.decode(Double.self, forKey: .size)) ?? z.size
        rainAmount = (try? c.decode(Double.self, forKey: .rainAmount)) ?? z.rainAmount
        showIcon = (try? c.decode(Bool.self, forKey: .showIcon)) ?? z.showIcon
    }

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
let bench = ProcessInfo.processInfo.environment["KOI_BENCH"] != nil

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
        if bench { // keep drawing while covered (measuring only)
            let sel = NSSelectorFromString("_setWindowOcclusionDetectionEnabled:")
            if web.responds(to: sel), let m = class_getInstanceMethod(WKWebView.self, sel) {
                typealias F = @convention(c) (AnyObject, Selector, Bool) -> Void
                unsafeBitCast(method_getImplementation(m), to: F.self)(web, sel, false)
            } else { NSLog("koipond: occlusion switch unavailable") }
        }
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

// MARK: - the pop-up panel (looks, focus timer, settings)

final class PanelWindow: NSPanel {
    let web: WKWebView
    override var canBecomeKey: Bool { true }

    init(page: URL, handler: WKScriptMessageHandler) {
        let size = NSSize(width: 340, height: 664)
        let config = WKWebViewConfiguration()
        config.userContentController.add(handler, name: "koi")
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        web = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: config)
        web.setValue(false, forKey: "drawsBackground")
        web.autoresizingMask = [.width, .height]
        super.init(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        isOpaque = false
        backgroundColor = .clear
        hasShadow = true
        level = .statusBar
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        isReleasedWhenClosed = false
        hidesOnDeactivate = false
        // a real frosted backdrop under the page, with rounded corners
        let blur = NSVisualEffectView(frame: NSRect(origin: .zero, size: size))
        blur.material = .hudWindow; blur.blendingMode = .behindWindow; blur.state = .active
        blur.wantsLayer = true; blur.layer?.cornerRadius = 18; blur.layer?.masksToBounds = true
        blur.autoresizingMask = [.width, .height]
        blur.addSubview(web)
        contentView = blur
        web.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent())
    }

    func js(_ s: String) { web.evaluateJavaScript(s, completionHandler: nil) }
}


struct FocusTimer { var mode = "focus"; var left = 25 * 60; var running = false }

// MARK: - app

final class App: NSObject, NSApplicationDelegate, NSMenuDelegate, WKScriptMessageHandler {
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
    var panel: PanelWindow?
    var menu = NSMenu()
    var focus = FocusTimer()
    var tick: Timer?
    var edgeSince: TimeInterval? = nil

    func applicationDidFinishLaunching(_ n: Notification) {
        guard let p = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web") else {
            NSLog("koipond: page missing from the app bundle"); NSApp.terminate(nil); return
        }
        page = p
        // a menu-bar app has no main menu, and without an Edit menu Cmd+V/C/X/A do nothing in text fields
        let main = NSMenu(), editItem = NSMenuItem(), edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit; main.addItem(editItem); NSApp.mainMenu = main
        buildWindows()
        buildMenu()
        if let pp = Bundle.main.url(forResource: "panel", withExtension: "html", subdirectory: "web") {
            panel = PanelWindow(page: pp, handler: self)
            NotificationCenter.default.addObserver(self, selector: #selector(panelLostFocus), name: NSWindow.didResignKeyNotification, object: panel)
        }
        if ProcessInfo.processInfo.environment["KOI_PANEL"] != nil { DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { _ = self.applicationShouldHandleReopen(NSApp, hasVisibleWindows: false) } }
        tick = Timer(timeInterval: 1, repeats: true) { [weak self] _ in self?.timerTick() }
        RunLoop.main.add(tick!, forMode: .common)

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
        // the chosen level, one step lower on battery or in Low Power Mode
        let levels = ["saver", "balanced", "smooth"]
        var level = levels.firstIndex(of: settings.quality) ?? 1
        // on battery: Smooth eases to Balanced, never lower on its own (20 fps feels laggy)
        if (onBattery || ProcessInfo.processInfo.isLowPowerModeEnabled) && level == 2 { level = 1 }
        var fps = [20, 30, 60][level]
        if let f = env["KOI_FPS"].flatMap(Int.init) { fps = f }
        let dpr = env["KOI_DPR"] ?? (level == 0 ? "1.25" : "0")
        let scale = env["KOI_SCALE"] ?? "1"
        let paused = settings.paused || hiddenBySystem
        return "{\"look\":\"\(settings.look)\",\"fish\":\(settings.fish),\"rain\":\(settings.rain ? settings.rainAmount : 0),\"size\":\(settings.size),\"pads\":\(settings.pads),\"petals\":\(settings.petals),\"fps\":\(fps),\"paused\":\(paused),\"dpr\":\(dpr),\"scale\":\(scale)\(env["KOI_EXTRA"].map { "," + $0 } ?? "")}"
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
        let visible = debug || bench || windows.contains { $0.occlusionState.contains(.visible) }
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
        let p = NSEvent.mouseLocation
        edgeReveal(p)
        guard settings.interactive, !settings.paused, !hiddenBySystem else { return }
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

    /// Resting the cursor on the right edge of the desktop slides the panel out.
    var edgeNear: Double = -1
    func edgeReveal(_ p: NSPoint) {
        // the handle on the right edge brightens as the cursor comes within ~140 pt
        if let scr = NSScreen.screens.first(where: { NSMouseInRect(p, $0.frame, false) }) {
            let near = max(0, 1 - Double(scr.frame.maxX - p.x) / 140)
            let q = (near * 20).rounded() / 20
            if q != edgeNear { edgeNear = q; windows.forEach { $0.js("koi.edge && koi.edge(\($0.screenRef == scr ? q : 0))") } }
        }
        guard let panel, !panel.isVisible, let scr = NSScreen.screens.first(where: { NSMouseInRect(p, $0.frame, false) }) else { edgeSince = nil; return }
        let atEdge = p.x >= scr.frame.maxX - 2 && p.y > scr.frame.minY + 40 && p.y < scr.visibleFrame.maxY - 20
        if !atEdge || NSEvent.pressedMouseButtons != 0 || covered(p) { edgeSince = nil; return }
        let now = ProcessInfo.processInfo.systemUptime
        if edgeSince == nil { edgeSince = now }
        if now - edgeSince! > 0.45 {
            edgeSince = nil
            let f = panel.frame.size
            let y = min(max(p.y - f.height / 2, scr.visibleFrame.minY + 8), scr.visibleFrame.maxY - f.height - 8)
            showPanel(at: NSPoint(x: scr.frame.maxX - f.width - 10, y: y), slideFrom: scr.frame.maxX)
        }
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
        menu.delegate = self
        // click: the panel; right-click (or control-click): the menu
        status.button?.target = self
        status.button?.action = #selector(statusClicked)
        status.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
        status.isVisible = settings.showIcon
    }

    @objc func statusClicked() {
        let e = NSApp.currentEvent
        if e?.type == .rightMouseUp || e?.modifierFlags.contains(.control) == true {
            status.menu = menu; status.button?.performClick(nil); status.menu = nil
            return
        }
        if panel?.isVisible == true { hidePanel(); return }
        guard let b = status.button, let bw = b.window, let panel else { return }
        let r = bw.convertToScreen(b.convert(b.bounds, to: nil)), f = panel.frame.size
        let scr = bw.screen ?? NSScreen.main!
        let x = min(r.midX - f.width / 2, scr.visibleFrame.maxX - f.width - 8)
        showPanel(at: NSPoint(x: x, y: r.minY - f.height - 6), slideFrom: nil)
    }

    // MARK: panel

    func showPanel(at origin: NSPoint, slideFrom edgeX: CGFloat?) {
        guard let panel else { return }
        syncPanel()
        let end = NSRect(origin: origin, size: panel.frame.size)
        panel.setFrame(edgeX.map { NSRect(x: $0, y: origin.y, width: end.width, height: end.height) } ?? end.offsetBy(dx: 0, dy: 8), display: false)
        panel.alphaValue = 0
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
        NSAnimationContext.runAnimationGroup { c in
            c.duration = 0.22; c.timingFunction = CAMediaTimingFunction(name: .easeOut)
            panel.animator().setFrame(end, display: true); panel.animator().alphaValue = 1
        }
    }

    func hidePanel() {
        guard let panel, panel.isVisible else { return }
        NSAnimationContext.runAnimationGroup({ c in c.duration = 0.15; panel.animator().alphaValue = 0 }, completionHandler: { panel.orderOut(nil) })
    }

    @objc func panelLostFocus() { hidePanel() }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        // opening the app again (Spotlight, Finder) brings the panel up, even with the menu bar icon hidden
        if let scr = NSScreen.main, let panel { let f = panel.frame.size; showPanel(at: NSPoint(x: scr.visibleFrame.maxX - f.width - 10, y: scr.visibleFrame.maxY - f.height - 8), slideFrom: nil) }
        return false
    }

    func syncPanel() {
        let s: [String: Any] = ["look": settings.look, "fish": settings.fish, "size": settings.size, "rain": settings.rain, "rainAmount": settings.rainAmount,
                                "pads": settings.pads, "petals": settings.petals, "interactive": settings.interactive, "quality": settings.quality,
                                "login": loginEnabled, "showIcon": settings.showIcon]
        let state: [String: Any] = ["settings": s, "timer": ["mode": focus.mode, "left": focus.left, "running": focus.running]]
        if let d = try? JSONSerialization.data(withJSONObject: state), let j = String(data: d, encoding: .utf8) { panel?.js("window.panel && panel.sync(\(j))") }
    }

    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        guard let b = m.body as? [String: Any], let t = b["t"] as? String else { return }
        switch t {
        case "ready": syncPanel()
        case "close": hidePanel()
        case "open": if let u = (b["v"] as? String).flatMap(URL.init(string:)), u.scheme == "https" { NSWorkspace.shared.open(u); hidePanel() }
        case "quit": NSApp.terminate(nil)
        case "timer":
            if b["a"] as? String == "reset" { focus = FocusTimer() } else { focus.running.toggle() }
            showCountdown(); syncPanel()
        case "set":
            guard let k = b["k"] as? String else { return }
            let v = b["v"]
            switch k {
            case "look": settings.look = v as? String ?? settings.look
            case "fish": settings.fish = (v as? NSNumber)?.intValue ?? settings.fish
            case "size": settings.size = (v as? NSNumber)?.doubleValue ?? settings.size
            case "rainAmount": settings.rainAmount = (v as? NSNumber)?.doubleValue ?? settings.rainAmount; settings.rain = settings.rainAmount > 0.001
            case "pads": settings.pads = v as? Bool ?? settings.pads
            case "petals": settings.petals = v as? Bool ?? settings.petals
            case "interactive": settings.interactive = v as? Bool ?? settings.interactive; if !settings.interactive { windows.forEach { $0.js("koi.leave()") } }
            case "login": toggleLogin()
            case "showIcon": settings.showIcon = v as? Bool ?? settings.showIcon; status.isVisible = settings.showIcon
            case "quality": settings.quality = v as? String ?? settings.quality; settings.save(); buildWindows(); syncPanel(); return
            default: return
            }
            changed(); syncPanel()
        default: break
        }
    }

    // MARK: focus timer (25 min focus, 5 min break)

    func timerTick() {
        guard focus.running else { return }
        focus.left -= 1
        if focus.left <= 0 {
            // a session is over: rings spread from the middle of the pond and the koi gather there
            windows.forEach { $0.js("koi.gather && koi.gather()") }
            focus = focus.mode == "focus" ? FocusTimer(mode: "break", left: 5 * 60, running: true) : FocusTimer()
        }
        showCountdown()
        if panel?.isVisible == true { syncPanel() }
    }

    func showCountdown() {
        guard let b = status.button else { return }
        if focus.running || focus.left != 25 * 60 {
            status.length = NSStatusItem.variableLength
            b.imagePosition = .imageLeft
            b.font = NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .regular)
            b.title = String(format: " %02d:%02d", focus.left / 60, focus.left % 60)
        } else { b.title = ""; status.length = NSStatusItem.squareLength }
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        menu.addItem(item("Open panel", #selector(openPanelFromMenu), on: false))
        menu.addItem(item(focus.running ? "Pause focus timer" : "Start focus timer", #selector(toggleFocus), on: false))
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
        let perf = NSMenuItem(title: "Performance", action: nil, keyEquivalent: "")
        let ps = NSMenu()
        for (id, name) in [("smooth", "Smooth (60 fps)"), ("balanced", "Balanced (30 fps)"), ("saver", "Battery saver")] { ps.addItem(item(name, #selector(setQuality(_:)), on: settings.quality == id, rep: id)) }
        perf.submenu = ps
        menu.addItem(perf)
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

    func changed() { settings.save(); pushSettings(); syncPanel() }

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
    @objc func setQuality(_ i: NSMenuItem) {
        settings.quality = i.representedObject as! String; settings.save(); syncPanel()
        // resolution is read once when the page starts, so reload the ponds
        buildWindows()
    }
        @objc func togglePause() { settings.paused.toggle(); changed() }
    @objc func quit() { NSApp.terminate(nil) }
    @objc func openPanelFromMenu() { DispatchQueue.main.async { self.statusClicked() } }
    @objc func toggleFocus() { focus.running.toggle(); showCountdown(); syncPanel() }

    // MARK: open at login

    var loginEnabled: Bool { SMAppService.mainApp.status == .enabled }

    @objc func toggleLogin() {
        do {
            if loginEnabled { try SMAppService.mainApp.unregister() } else { try SMAppService.mainApp.register() }
            syncPanel()
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
