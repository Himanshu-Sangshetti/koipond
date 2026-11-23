// koipond wallpaper for Windows.
//
// One borderless window per display, attached behind the desktop icons (the WorkerW layer), showing the
// pond page in Edge WebView2. The desktop keeps every click; the app watches the mouse itself and forwards
// it to the pond, but only when the pointer is over the visible desktop.
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

namespace Koipond;

sealed class Settings
{
    public string Look { get; set; } = "natural";
    public int Fish { get; set; } = 14;
    public bool Rain { get; set; } = true;
    public bool Pads { get; set; } = true;
    public bool Petals { get; set; } = true;
    public bool Interactive { get; set; } = true;
    public bool Paused { get; set; }

    static readonly string Dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "koipond");
    static readonly string FilePath = Path.Combine(Dir, "settings.json");
    public static Settings Load()
    {
        try { return JsonSerializer.Deserialize<Settings>(File.ReadAllText(FilePath)) ?? new Settings(); } catch { return new Settings(); }
    }
    public void Save()
    {
        try { Directory.CreateDirectory(Dir); File.WriteAllText(FilePath, JsonSerializer.Serialize(this)); } catch { }
    }
}

static class Native
{
    public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string? cls, string? name);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string? cls, string? name);
    [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc proc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern IntPtr SetParent(IntPtr child, IntPtr parent);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, System.Text.StringBuilder buf, int max);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT r);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hwnd, int index, int value);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern IntPtr SetWindowsHookEx(int id, LowLevelMouseProc proc, IntPtr mod, uint thread);
    [DllImport("user32.dll")] public static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr GetModuleHandle(string? name);
    public delegate IntPtr LowLevelMouseProc(int code, IntPtr w, IntPtr l);

    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct MSLLHOOKSTRUCT { public POINT pt; public int mouseData, flags, time; public IntPtr extra; }

    public static string ClassOf(IntPtr h)
    {
        var sb = new System.Text.StringBuilder(64);
        GetClassName(h, sb, sb.Capacity);
        return sb.ToString();
    }

    /// The window that sits behind the desktop icons. Asks Explorer to create it if needed.
    public static IntPtr DesktopLayer()
    {
        var progman = FindWindow("Progman", null);
        SendMessageTimeout(progman, 0x052C, new IntPtr(0xD), new IntPtr(0x1), 0, 1000, out _);
        IntPtr worker = IntPtr.Zero;
        // classic layout: the icons live in a WorkerW; the next WorkerW after it is the wallpaper layer
        EnumWindows((top, _) =>
        {
            if (FindWindowEx(top, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero)
                worker = FindWindowEx(IntPtr.Zero, top, "WorkerW", null);
            return true;
        }, IntPtr.Zero);
        if (worker != IntPtr.Zero) return worker;
        // Windows 11 24H2+: the layer is a WorkerW inside Progman, under the icons
        var inner = FindWindowEx(progman, IntPtr.Zero, "WorkerW", null);
        return inner != IntPtr.Zero ? inner : progman;
    }
}

sealed class PondForm : Form
{
    public readonly Screen Display;
    readonly WebView2 web = new();
    bool ready;
    readonly string initJson;
    readonly string pageDir;

    public PondForm(Screen display, string pageDir, string initJson)
    {
        Display = display;
        this.pageDir = pageDir;
        this.initJson = initJson;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        BackColor = Color.FromArgb(6, 42, 51);
        Bounds = display.Bounds;
        web.Dock = DockStyle.Fill;
        web.DefaultBackgroundColor = BackColor;
        Controls.Add(web);
    }

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= 0x80 /* TOOLWINDOW: no alt-tab */ | 0x08000000 /* NOACTIVATE */ | 0x20 /* TRANSPARENT: clicks pass */;
            return cp;
        }
    }

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        Attach();
        var dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "koipond", "WebView2");
        var env = await CoreWebView2Environment.CreateAsync(null, dataDir);
        await web.EnsureCoreWebView2Async(env);
        var core = web.CoreWebView2;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
        core.SetVirtualHostNameToFolderMapping("koipond.local", pageDir, CoreWebView2HostResourceAccessKind.Allow);
        await core.AddScriptToExecuteOnDocumentCreatedAsync($"window.__koiInit = {initJson};");
        core.NavigationCompleted += (_, _) => ready = true;
        core.ProcessFailed += (_, _) => core.Reload();
        core.Navigate("https://koipond.local/index.html");
        // testing: KOI_SMOKE=<file> writes what the pond is doing after a few seconds, then quits
        var smoke = Environment.GetEnvironmentVariable("KOI_SMOKE");
        if (smoke != null && Display.Primary)
        {
            await Task.Delay(4000);
            var f1 = await web.ExecuteScriptAsync("window.__frames || 0");
            await Task.Delay(4000);
            var state = await web.ExecuteScriptAsync("JSON.stringify({frames: window.__frames || 0, canvas: document.querySelector('canvas') ? document.querySelector('canvas').width : 0, title: document.title})");
            var layer = Native.DesktopLayer();
            File.WriteAllText(smoke, $"{{\"ready\": {(ready ? "true" : "false")}, \"framesBefore\": {f1}, \"page\": {state}, \"layer\": {(layer != IntPtr.Zero ? "true" : "false")}, \"parented\": {(Native.GetAncestor(Handle, 1 /* GA_PARENT */) == layer ? "true" : "false")}, \"parentClass\": \"{Native.ClassOf(Native.GetAncestor(Handle, 1))}\", \"layerClass\": \"{Native.ClassOf(layer)}\", \"os\": \"{Environment.OSVersion.VersionString}\", \"webview\": \"{CoreWebView2Environment.GetAvailableBrowserVersionString()}\"}}");
            Application.Exit();
        }
    }

    /// Put the window behind the desktop icons, covering its display.
    public void Attach()
    {
        var layer = Native.DesktopLayer();
        Native.SetParent(Handle, layer);
        // child coordinates are relative to the layer, which starts at the top-left of the virtual screen
        Native.GetWindowRect(layer, out var lr);
        var b = Display.Bounds;
        Native.SetWindowPos(Handle, IntPtr.Zero, b.X - lr.Left, b.Y - lr.Top, b.Width, b.Height, 0x0010 /* NOACTIVATE */ | 0x0040 /* SHOWWINDOW */);
    }

    public void Js(string script) { if (ready) _ = web.ExecuteScriptAsync(script); }

    /// Physical screen pixels → CSS pixels in this pond, or null when the point is on another display.
    public (int x, int y)? Local(Native.POINT p)
    {
        var b = Display.Bounds;
        if (p.X < b.Left || p.X >= b.Right || p.Y < b.Top || p.Y >= b.Bottom) return null;
        var scale = Native.GetDpiForWindow(Handle) / 96.0;
        if (scale <= 0) scale = 1;
        return ((int)((p.X - b.Left) / scale), (int)((p.Y - b.Top) / scale));
    }
}

sealed class App : ApplicationContext
{
    Settings settings = Settings.Load();
    readonly List<PondForm> ponds = new();
    readonly NotifyIcon tray = new();
    readonly System.Windows.Forms.Timer mouse = new() { Interval = 16 };
    readonly System.Windows.Forms.Timer watch = new() { Interval = 1000 };
    readonly string pageDir = Path.Combine(AppContext.BaseDirectory, "web");
    Native.POINT last = new() { X = int.MinValue };
    bool wasDown;
    PondForm? over;
    bool hidden;     // a full-screen or maximised app covers the desktop
    IntPtr hook;
    readonly Native.LowLevelMouseProc hookProc;

    public App()
    {
        BuildPonds();
        tray.Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath!) ?? SystemIcons.Application;
        tray.Text = "koipond";
        tray.Visible = true;
        tray.ContextMenuStrip = new ContextMenuStrip();
        tray.ContextMenuStrip.Opening += (_, _) => BuildMenu(tray.ContextMenuStrip);
        BuildMenu(tray.ContextMenuStrip);

        mouse.Tick += (_, _) => PollMouse();
        mouse.Start();
        watch.Tick += (_, _) => WatchDesktop();
        watch.Start();
        // scrolling over the desktop pushes the water (a low-level hook: no admin, read only)
        hookProc = OnMouseHook;
        hook = Native.SetWindowsHookEx(14 /* WH_MOUSE_LL */, hookProc, Native.GetModuleHandle(null), 0);

        SystemEvents.DisplaySettingsChanged += (_, _) => BuildPonds();
        SystemEvents.PowerModeChanged += (_, e) =>
        {
            if (e.Mode == PowerModes.Suspend) { hidden = true; }
            if (e.Mode == PowerModes.Resume) { hidden = false; BuildPonds(); }
            Push();
        };
        SystemEvents.SessionSwitch += (_, e) =>
        {
            hidden = e.Reason is SessionSwitchReason.SessionLock or SessionSwitchReason.ConsoleDisconnect;
            Push();
        };
    }

    void BuildPonds()
    {
        foreach (var p in ponds) p.Close();
        ponds.Clear();
        foreach (var s in Screen.AllScreens)
        {
            var f = new PondForm(s, pageDir, PageSettings());
            f.Show();
            ponds.Add(f);
        }
    }

    static bool OnBattery => SystemInformation.PowerStatus.PowerLineStatus == PowerLineStatus.Offline;

    string PageSettings()
    {
        var fps = OnBattery ? 30 : 60;
        var paused = settings.Paused || hidden;
        return JsonSerializer.Serialize(new { look = settings.Look, fish = settings.Fish, rain = settings.Rain ? 0.5 : 0, pads = settings.Pads, petals = settings.Petals, fps, paused });
    }

    void Push()
    {
        var s = PageSettings();
        foreach (var p in ponds) p.Js($"window.koi && koi.set({s})");
    }

    // --- is the desktop visible?
    static readonly HashSet<string> DesktopClasses = new() { "Progman", "WorkerW", "SHELLDLL_DefView", "SysListView32" };

    bool OverDesktop(Native.POINT p)
    {
        var h = Native.GetAncestor(Native.WindowFromPoint(p), 2 /* GA_ROOT */);
        if (h == IntPtr.Zero) return false;
        if (DesktopClasses.Contains(Native.ClassOf(h))) return true;
        return ponds.Any(f => f.Handle == h);
    }

    void WatchDesktop()
    {
        // pause while the foreground app fills its whole display (full screen / maximised games, video)
        var fg = Native.GetForegroundWindow();
        var covers = false;
        if (fg != IntPtr.Zero && Native.IsWindowVisible(fg) && !DesktopClasses.Contains(Native.ClassOf(fg)) && Native.GetWindowRect(fg, out var r))
        {
            var scr = Screen.FromHandle(fg).Bounds;
            covers = r.Left <= scr.Left && r.Top <= scr.Top && r.Right >= scr.Right && r.Bottom >= scr.Bottom && Screen.AllScreens.Length == 1;
        }
        if (covers != hidden) { hidden = covers; Push(); }
    }

    void PollMouse()
    {
        if (!settings.Interactive || settings.Paused || hidden) return;
        Native.GetCursorPos(out var p);
        var down = (Native.GetAsyncKeyState(0x01) & 0x8000) != 0;
        var moved = p.X != last.X || p.Y != last.Y;
        if (!moved && down == wasDown) return;
        var target = ponds.FirstOrDefault(f => f.Local(p) != null);
        var visible = target != null && OverDesktop(p);
        if (over != null && (over != target || !visible)) { over.Js("koi.leave()"); over = null; }
        if (target != null && visible && target.Local(p) is (int x, int y))
        {
            over = target;
            if (down && !wasDown) target.Js($"koi.down({x},{y})");
            else if (!down && wasDown) target.Js($"koi.up({x},{y})");
            if (moved) target.Js($"koi.move({x},{y})");
        }
        else if (!down && wasDown) foreach (var f in ponds) f.Js("koi.up(0,0)");
        last = p;
        wasDown = down;
    }

    IntPtr OnMouseHook(int code, IntPtr w, IntPtr l)
    {
        if (code >= 0 && (int)w is 0x020A or 0x020E && settings.Interactive && over != null)
        {
            var info = Marshal.PtrToStructure<Native.MSLLHOOKSTRUCT>(l);
            var delta = (short)(info.mouseData >> 16);
            var target = over;
            var js = (int)w == 0x020A ? $"koi.wheel(0,{-delta})" : $"koi.wheel({delta},0)";
            target.BeginInvoke(new Action(() => target.Js(js)));
        }
        return Native.CallNextHookEx(hook, code, w, l);
    }

    // --- tray menu
    void BuildMenu(ContextMenuStrip m)
    {
        m.Items.Clear();
        m.Items.Add(new ToolStripMenuItem("koipond") { Enabled = false });
        m.Items.Add(new ToolStripSeparator());
        foreach (var (id, name) in new[] { ("natural", "Natural"), ("ink", "Ink"), ("violet", "Dither") })
            m.Items.Add(Item(name, settings.Look == id, () => settings.Look = id));
        m.Items.Add(new ToolStripSeparator());
        var koi = new ToolStripMenuItem("Koi");
        foreach (var n in new[] { 6, 10, 14, 18, 24 }) koi.DropDownItems.Add(Item(n.ToString(), settings.Fish == n, () => settings.Fish = n));
        m.Items.Add(koi);
        m.Items.Add(Item("Rain", settings.Rain, () => settings.Rain = !settings.Rain));
        m.Items.Add(Item("Sakura", settings.Petals, () => settings.Petals = !settings.Petals));
        m.Items.Add(Item("Lily pads", settings.Pads, () => settings.Pads = !settings.Pads));
        m.Items.Add(Item("React to the mouse", settings.Interactive, () => { settings.Interactive = !settings.Interactive; foreach (var f in ponds) f.Js("koi.leave()"); }));
        m.Items.Add(new ToolStripSeparator());
        m.Items.Add(Item(settings.Paused ? "Resume" : "Pause", false, () => settings.Paused = !settings.Paused));
        m.Items.Add(new ToolStripMenuItem("Open at login", null, (_, _) => ToggleLogin()) { Checked = LoginEnabled });
        m.Items.Add(new ToolStripSeparator());
        m.Items.Add(new ToolStripMenuItem("Quit koipond", null, (_, _) => Quit()));
    }

    ToolStripMenuItem Item(string text, bool on, Action change) =>
        new(text, null, (_, _) => { change(); settings.Save(); Push(); }) { Checked = on };

    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    static bool LoginEnabled => Registry.CurrentUser.OpenSubKey(RunKey)?.GetValue("koipond") != null;
    static void ToggleLogin()
    {
        using var k = Registry.CurrentUser.CreateSubKey(RunKey);
        if (LoginEnabled) k.DeleteValue("koipond", false); else k.SetValue("koipond", $"\"{Environment.ProcessPath}\"");
    }

    void Quit()
    {
        tray.Visible = false;
        if (hook != IntPtr.Zero) Native.UnhookWindowsHookEx(hook);
        foreach (var p in ponds) p.Close();
        // Explorer repaints the normal wallpaper once our windows are gone
        ExitThread();
    }
}

static class Program
{
    [STAThread]
    static void Main()
    {
        using var single = new Mutex(true, "koipond-wallpaper", out var first);
        if (!first) return;
        ApplicationConfiguration.Initialize();
        Application.Run(new App());
    }
}
