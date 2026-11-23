// Supporting koipond. The app is free and complete for everyone; paying is optional (pay what you want).
// A purchase comes with a key; entering it marks this PC as a supporter, which only stops the
// "pay what you want" card from appearing. Nothing is locked. Same store and rules as the Mac app.
//
// No secrets live here: the checkout link is public, and keys are checked against Dodo Payments'
// public license endpoint (no API key needed).
using System.Diagnostics;
using System.Net.Http.Json;
using System.Text.Json;

namespace Koipond;

static class Store
{
    public static readonly Dictionary<string, string> Products = new()
    {
        ["test"] = "pdt_0NsYCacmTCBksDKMSi7PX",
        ["live"] = "pdt_0NsYIva9ea1hMacA3xaaB",
    };
    /// Live once a live product id is set. KOI_STORE=test forces test mode for development.
    public static string Mode => Environment.GetEnvironmentVariable("KOI_STORE") == "test" || string.IsNullOrEmpty(Products["live"]) ? "test" : "live";
    public static string ProductID => Products[Mode];
    public static string ApiBase => Mode == "live" ? "https://live.dodopayments.com" : "https://test.dodopayments.com";
    public static string CheckoutURL
    {
        get
        {
            var host = Mode == "live" ? "checkout.dodopayments.com" : "test.checkout.dodopayments.com";
            return $"https://{host}/buy/{ProductID}?quantity=1&redirect_url={Uri.EscapeDataString("https://koipond-demo.vercel.app/?thanks")}";
        }
    }
    public static void OpenCheckout() => Process.Start(new ProcessStartInfo(CheckoutURL) { UseShellExecute = true });
}

sealed class Supporter
{
    public string Key { get; set; } = "";
    public string InstanceID { get; set; } = "";
    public string Email { get; set; } = "";
    public DateTime Since { get; set; }

    static string FilePath => Path.Combine(Settings.Dir, $"supporter-{Store.Mode}.json");
    public static Supporter? Load()
    {
        try { return JsonSerializer.Deserialize<Supporter>(File.ReadAllText(FilePath)); } catch { return null; }
    }
    public void Save()
    {
        try { Directory.CreateDirectory(Settings.Dir); File.WriteAllText(FilePath, JsonSerializer.Serialize(this)); } catch { }
    }
}

/// When to show the "pay what you want" card: the first time the app opens, and once more a week later.
static class SupportAsk
{
    public static bool Due(Settings s, DateTime now)
    {
        if (Supporter.Load() != null) return false;
        if (s.FirstSeen == null) { s.FirstSeen = now; s.Save(); }
        if (s.Asked == 0) return true;
        return s.Asked == 1 && now - s.FirstSeen.Value >= TimeSpan.FromDays(7);
    }
    public static void MarkAsked(Settings s) { s.Asked++; s.Save(); }
}

static class Activation
{
    static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(20) };

    /// Registers this PC against the key with Dodo Payments' public endpoint. Returns the supporter or an error message.
    public static async Task<(Supporter? ok, string? error)> Activate(string raw)
    {
        var key = raw.Trim();
        try
        {
            var r = await Http.PostAsJsonAsync($"{Store.ApiBase}/licenses/activate", new { license_key = key, name = Environment.MachineName });
            return Parse(await r.Content.ReadAsStringAsync(), (int)r.StatusCode, key);
        }
        catch (Exception e) { return (null, $"Couldn't reach the key server: {e.Message}"); }
    }

    public static (Supporter? ok, string? error) Parse(string body, int status, string key)
    {
        switch (status)
        {
            case 200 or 201: break;
            case 403: return (null, "That key has been turned off (for example after a refund).");
            case 404: return (null, "That key wasn't found. Check it was pasted in full.");
            case 422: return (null, "That key is already in use on 5 computers.");
            default: return (null, $"The key server had a problem ({status}). Try again in a minute.");
        }
        try
        {
            using var d = JsonDocument.Parse(body);
            var root = d.RootElement;
            if (root.GetProperty("product").GetProperty("product_id").GetString() != Store.ProductID)
                return (null, "That key is for a different product.");
            return (new Supporter
            {
                Key = key.Trim(),
                InstanceID = root.GetProperty("id").GetString() ?? "",
                Email = root.GetProperty("customer").GetProperty("email").GetString() ?? "",
                Since = DateTime.UtcNow,
            }, null);
        }
        catch { return (null, $"The key server had a problem ({status}). Try again in a minute."); }
    }
}

/// The small card: "koipond is free for everyone", Pay what you want / Continue free, and the key box.
sealed class SupportForm : Form
{
    static readonly Color Bg = Color.FromArgb(14, 30, 36), Fg = Color.FromArgb(232, 240, 238), Dim = Color.FromArgb(150, 175, 172), Accent = Color.FromArgb(240, 140, 90);
    readonly TextBox keyBox = new();
    readonly Button activate = new();
    readonly Label error = new();
    readonly FlowLayoutPanel keyRow = new();
    public Supporter? Activated { get; private set; }

    public SupportForm(bool keyFirst)
    {
        Text = "koipond";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        TopMost = true;
        BackColor = Bg; ForeColor = Fg;
        Font = new Font("Segoe UI", 10f);
        AutoSize = true; AutoSizeMode = AutoSizeMode.GrowAndShrink;
        Padding = new Padding(22);
        try { Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath!); } catch { }

        var col = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, AutoSize = true, WrapContents = false, BackColor = Bg };
        col.Controls.Add(new Label { Text = "koipond is free for everyone", Font = new Font("Segoe UI Semibold", 13f), AutoSize = true, Margin = new Padding(0, 0, 0, 6) });
        col.Controls.Add(new Label { Text = "If it makes your desk a little calmer, you can pay what you want.\nIt's optional and nothing is locked.", ForeColor = Dim, AutoSize = true, Margin = new Padding(0, 0, 0, 16) });

        var buttons = new FlowLayoutPanel { AutoSize = true, BackColor = Bg, Margin = new Padding(0) };
        var pay = Btn("Pay what you want", Accent, Color.FromArgb(20, 20, 20));
        pay.Click += (_, _) => { Store.OpenCheckout(); Close(); };
        var free = Btn("Continue free", Color.FromArgb(34, 52, 58), Fg);
        free.Click += (_, _) => Close();
        buttons.Controls.Add(pay); buttons.Controls.Add(free);
        col.Controls.Add(buttons);

        var haveKey = new LinkLabel { Text = "I have a key", AutoSize = true, LinkColor = Dim, ActiveLinkColor = Fg, Margin = new Padding(0, 14, 0, 0) };
        haveKey.LinkClicked += (_, _) => { keyRow.Visible = true; keyBox.Focus(); };
        col.Controls.Add(haveKey);

        keyRow.AutoSize = true; keyRow.BackColor = Bg; keyRow.Margin = new Padding(0, 8, 0, 0); keyRow.Visible = keyFirst;
        keyBox.Width = 300; keyBox.PlaceholderText = "Paste your key"; keyBox.BackColor = Color.FromArgb(24, 42, 48); keyBox.ForeColor = Fg; keyBox.BorderStyle = BorderStyle.FixedSingle;
        keyBox.KeyDown += (_, e) => { if (e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; TryActivate(); } };
        activate.Text = "Activate"; Style(activate, Color.FromArgb(34, 52, 58), Fg); activate.Click += (_, _) => TryActivate();
        keyRow.Controls.Add(keyBox); keyRow.Controls.Add(activate);
        col.Controls.Add(keyRow);
        error.AutoSize = true; error.ForeColor = Accent; error.MaximumSize = new Size(420, 0); error.Visible = false;
        col.Controls.Add(error);
        Controls.Add(col);
        if (keyFirst) Shown += (_, _) => keyBox.Focus();
    }

    static Button Btn(string text, Color bg, Color fg) { var b = new Button { Text = text }; Style(b, bg, fg); return b; }
    static void Style(Button b, Color bg, Color fg)
    {
        b.FlatStyle = FlatStyle.Flat; b.FlatAppearance.BorderSize = 0; b.BackColor = bg; b.ForeColor = fg;
        b.AutoSize = true; b.Padding = new Padding(10, 4, 10, 4); b.Margin = new Padding(0, 0, 10, 0); b.Cursor = Cursors.Hand;
    }

    async void TryActivate()
    {
        var key = keyBox.Text.Trim();
        if (key.Length == 0 || !activate.Enabled) return;
        activate.Enabled = false; activate.Text = "Checking…"; error.Visible = false;
        var (ok, err) = await Activation.Activate(key);
        activate.Enabled = true; activate.Text = "Activate";
        if (ok != null) { ok.Save(); Activated = ok; Close(); return; }
        error.Text = err; error.Visible = true;
    }
}
