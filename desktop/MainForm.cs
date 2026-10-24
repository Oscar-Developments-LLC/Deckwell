using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Deckwell;

sealed class MainForm : Form
{
    // The editor (WebView2) only exists while the window is on screen. Minimized for SleepAfterMs, it is torn down
    // and every msedgewebview2 helper process exits; restoring the window rebuilds it. The deck link, sliders,
    // status tiles and Now Playing all live in Hub, so the deck keeps working while the editor sleeps.
    WebView2? _web;
    readonly System.Windows.Forms.Timer _sleepTimer = new() { Interval = SleepAfterMs };
    const int SleepAfterMs = 15000;
    bool _waking, _loaded;
    readonly Hub _hub;
    readonly KeyboardRecorder _recorder;
    readonly Dictionary<string, byte[]> _ui = new(StringComparer.OrdinalIgnoreCase);
    bool _ready;
    const int TopGrip = 4;

    public MainForm()
    {
        Text = "Deckwell";
        BackColor = Color.FromArgb(0x13, 0x15, 0x21);
        StartPosition = FormStartPosition.CenterScreen;
        Size = new Size(1320, 860);
        MinimumSize = new Size(1040, 640);
        FormBorderStyle = FormBorderStyle.Sizable;
        Padding = new Padding(0, TopGrip, 0, 0);
        try { Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath!); } catch { }

        _hub = new Hub(PostEvent);
        _recorder = new KeyboardRecorder((name, vk, down) => PostEvent("recKey", new { name, vk, down }));

        var asm = Assembly.GetExecutingAssembly();
        foreach (var n in asm.GetManifestResourceNames())
            if (n.StartsWith("ui/") || n.StartsWith("ui\\"))
            {
                using var s = asm.GetManifestResourceStream(n)!; using var ms = new MemoryStream(); s.CopyTo(ms);
                _ui[n[3..].Replace('\\', '/')] = ms.ToArray();
            }

        Load += async (_, _) => { _loaded = true; await WakeEditor(); };
        FormClosing += (_, _) => { _sleepTimer.Dispose(); _recorder.Dispose(); _hub.Dispose(); };
        Resize += async (_, _) =>
        {
            if (WindowState == FormWindowState.Minimized) { _sleepTimer.Stop(); _sleepTimer.Start(); return; }
            _sleepTimer.Stop();
            if (_loaded && _web == null) await WakeEditor();
            PostEvent("maximized", WindowState == FormWindowState.Maximized);
        };
        _sleepTimer.Tick += (_, _) => { _sleepTimer.Stop(); if (WindowState == FormWindowState.Minimized) SleepEditor(); };
        // In the background the editor gives memory back; it's restored when the window is used again.
        Activated += (_, _) => SetWebMemory(CoreWebView2MemoryUsageTargetLevel.Normal);
        Deactivate += (_, _) => SetWebMemory(CoreWebView2MemoryUsageTargetLevel.Low);
    }

    /* ---------------- editor sleep / wake ---------------- */
    async Task WakeEditor()
    {
        if (_web != null || _waking) return;
        _waking = true;
        try
        {
            _web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(0x1a, 0x1c, 0x29) };
            Controls.Add(_web);
            await InitWeb();
        }
        finally { _waking = false; }
    }

    void SleepEditor()
    {
        if (_web == null || _waking) return;
        _ready = false;
        try { _recorder.Stop(); } catch { }
        var web = _web; _web = null;
        Controls.Remove(web);
        try { web.Dispose(); } catch (Exception e) { Log.Write("editor sleep: " + e.Message); }
        Log.Write("editor asleep (window minimized)");
        Mem.Trim();
    }

    void SetWebMemory(CoreWebView2MemoryUsageTargetLevel level)
    {
        try { if (_ready && _web?.CoreWebView2 != null) _web.CoreWebView2.MemoryUsageTargetLevel = level; } catch { }
    }

    /* ---------------- custom chrome: keep native resize borders, drop the caption ---------------- */
    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        int round = 2; Native.DwmSetWindowAttribute(Handle, 33, ref round, sizeof(int)); // Win11 rounded corners
        int dark = 1; Native.DwmSetWindowAttribute(Handle, 20, ref dark, sizeof(int));  // dark frame
        var m = new Native.MARGINS { Top = 1 }; Native.DwmExtendFrameIntoClientArea(Handle, ref m);
        Native.SetWindowPos(Handle, IntPtr.Zero, 0, 0, 0, 0, 0x0027); // SWP_FRAMECHANGED|NOMOVE|NOSIZE|NOZORDER
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == Native.WM_NCCALCSIZE && m.WParam != IntPtr.Zero)
        {
            var p = Marshal.PtrToStructure<Native.NCCALCSIZE_PARAMS>(m.LParam);
            int top = p.r0.Top;
            base.WndProc(ref m);
            p = Marshal.PtrToStructure<Native.NCCALCSIZE_PARAMS>(m.LParam);
            // Maximized windows hang over the screen edge by the frame size; keep that part hidden.
            p.r0.Top = WindowState == FormWindowState.Maximized ? top + Native.GetSystemMetrics(33) + Native.GetSystemMetrics(92) : top;
            Marshal.StructureToPtr(p, m.LParam, false);
            m.Result = IntPtr.Zero;
            return;
        }
        if (m.Msg == Native.WM_NCHITTEST)
        {
            base.WndProc(ref m);
            if ((int)m.Result == Native.HTCLIENT && WindowState != FormWindowState.Maximized)
            {
                var pt = PointToClient(new Point(unchecked((short)(long)m.LParam), unchecked((short)((long)m.LParam >> 16))));
                if (pt.Y < TopGrip) m.Result = (IntPtr)(pt.X < 8 ? Native.HTTOPLEFT : pt.X > ClientSize.Width - 8 ? Native.HTTOPRIGHT : Native.HTTOP);
            }
            return;
        }
        base.WndProc(ref m);
    }

    /* ---------------- WebView2 ---------------- */
    async Task InitWeb()
    {
        try
        {
            // One renderer is plenty for a single local page, and none of Edge's background services are needed.
            var opts = new CoreWebView2EnvironmentOptions(
                "--renderer-process-limit=1 --disable-background-networking --disable-component-update --disable-sync " +
                "--disable-features=Translate,msSmartScreenProtection,msWebOOUI,msPdfOOUI,msEdgeShoppingAssistant");
            var env = await CoreWebView2Environment.CreateAsync(null, Paths.WebData, opts);
            if (_web == null) return;
            await _web.EnsureCoreWebView2Async(env);
        }
        catch (Exception e)
        {
            MessageBox.Show("Deckwell needs the Microsoft Edge WebView2 Runtime.\n\nGet it from https://go.microsoft.com/fwlink/p/?LinkId=2124703\n\n" + e.Message, "Deckwell", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close(); return;
        }
        if (_web?.CoreWebView2 == null) return;
        var w = _web.CoreWebView2;
        var dev = Environment.GetEnvironmentVariable("DECKWELL_DEV") == "1";
        w.Settings.AreDevToolsEnabled = dev;
        w.Settings.AreDefaultContextMenusEnabled = dev;
        w.Settings.AreBrowserAcceleratorKeysEnabled = dev;
        w.Settings.IsZoomControlEnabled = false;
        w.Settings.IsStatusBarEnabled = false;
        w.Settings.IsPinchZoomEnabled = false;
        try { w.Settings.IsNonClientRegionSupportEnabled = true; } catch { }
        w.AddWebResourceRequestedFilter("https://app.deckwell/*", CoreWebView2WebResourceContext.All);
        w.WebResourceRequested += OnResource;
        w.WebMessageReceived += OnMessage;
        w.NewWindowRequested += (_, e) => { e.Handled = true; try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(e.Uri) { UseShellExecute = true }); } catch { } };
        w.Navigate("https://app.deckwell/index.html");
        _ready = true;
    }

    void OnResource(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        var uri = new Uri(e.Request.Uri);
        var path = Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/'));
        byte[]? body = null;
        if (path.StartsWith("icons/")) body = Icons.Read(Path.GetFileNameWithoutExtension(path));
        else _ui.TryGetValue(path.Length == 0 ? "index.html" : path, out body);
        var env = _web?.CoreWebView2?.Environment; if (env == null) return;
        if (body == null) { e.Response = env.CreateWebResourceResponse(null, 404, "Not Found", ""); return; }
        var type = Path.GetExtension(path).ToLowerInvariant() switch
        {
            ".html" => "text/html; charset=utf-8", ".js" => "text/javascript; charset=utf-8", ".css" => "text/css; charset=utf-8",
            ".png" => "image/png", ".woff2" => "font/woff2", ".svg" => "image/svg+xml", _ => "application/octet-stream",
        };
        e.Response = env.CreateWebResourceResponse(new MemoryStream(body), 200, "OK", $"Content-Type: {type}\r\nCache-Control: no-cache");
    }

    void PostEvent(string name, object? data)
    {
        if (!IsHandleCreated) return;
        try
        {
            BeginInvoke(() =>
            {
                if (!_ready || _web?.CoreWebView2 == null) return;
                _web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { @event = name, data }, Json.Opts));
            });
        }
        catch { }
    }

    void Reply(object id, object? result, string? error = null)
    {
        var json = error == null ? JsonSerializer.Serialize(new { id, result }, Json.Opts) : JsonSerializer.Serialize(new { id, error }, Json.Opts);
        _web?.CoreWebView2?.PostWebMessageAsJson(json);
    }

    async void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        JsonNode? msg; try { msg = JsonNode.Parse(e.WebMessageAsJson); } catch { return; }
        if (msg == null) return;
        var id = msg["id"]?.GetValue<int>() ?? 0;
        var cmd = Json.S(msg, "cmd");
        var args = msg["args"];
        try { Reply(id, await HandleCommand(cmd, args)); }
        catch (Exception ex) { Log.Write($"cmd {cmd}: {ex}"); Reply(id, null, ex.Message); }
    }

    async Task<object?> HandleCommand(string cmd, JsonNode? a)
    {
        switch (cmd)
        {
            case "getState":
                PostEvent("maximized", WindowState == FormWindowState.Maximized); // editor may have just woken up
                PostEvent("np", _hub.NpForUi(_hub.Media.Current));
                PostEvent("sliders", _hub.SlidersSnapshot());
                foreach (var st in _hub.Feeds.Snapshot()) PostEvent("status", st);
                return new { config = _hub.Config, device = _hub.Deck.Current, sessions = _hub.Audio.Sessions.Select(s => new { name = s.Name, label = s.Label }) };
            case "saveConfig":
            {
                var cfg = a?["config"]?.DeepClone() ?? throw new Exception("No config");
                await Task.Run(() => _hub.SaveConfig(cfg));
                return new { deck = _hub.Deck.IsConnected };
            }
            case "pickFile":
            {
                var kind = Json.S(a, "kind");
                using var dlg = new OpenFileDialog
                {
                    Filter = kind switch { "exe" => "Programs (*.exe;*.lnk)|*.exe;*.lnk|All files|*.*", "py" => "Python (*.py;*.pyw)|*.py;*.pyw|All files|*.*", "ps1" => "PowerShell (*.ps1)|*.ps1|All files|*.*", _ => "All files|*.*" },
                    DereferenceLinks = true,
                };
                return dlg.ShowDialog(this) == DialogResult.OK ? dlg.FileName : null;
            }
            case "iconFromExe": { var p = Json.S(a, "path"); var idv = await Task.Run(() => Icons.FromExe(p)); return new { id = idv }; }
            case "uploadImage":
            {
                using var dlg = new OpenFileDialog { Filter = "Images (*.png;*.jpg;*.jpeg;*.bmp;*.gif;*.ico)|*.png;*.jpg;*.jpeg;*.bmp;*.gif;*.ico" };
                if (dlg.ShowDialog(this) != DialogResult.OK) return null;
                var f = dlg.FileName; var idv = await Task.Run(() => Icons.FromImageFile(f));
                if (idv == null) throw new Exception("Couldn't read that image");
                return new { id = idv };
            }
            case "runKey":
            {
                var key = a?["key"]?.DeepClone() ?? throw new Exception("No key");
                var cfg = _hub.Config ?? new JsonObject();
                var r = await _hub.Actions.Press(key, cfg);
                if (Json.S(key, "type") == "hotkey") { await Task.Delay(120); _hub.Actions.Release(key); }
                if (r != null) _hub.Feedback(key, r);
                return r == null ? new { ok = true, text = "Nothing to do" } : new { ok = r.Ok, text = r.Text };
            }
            case "reconnect": _hub.Deck.Reconnect(); return null;
            case "pairStart": { var err = await Task.Run(() => _hub.Deck.StartPairing()); return new { ok = err == null, error = err }; }
            case "pairCode": { var code = Json.S(a, "code"); var name = Json.S(a, "name"); var err = await Task.Run(() => _hub.Deck.SubmitCode(code, name)); return new { ok = err == null, error = err }; }
            case "openDocs":
            {
                // Only ever opens Deckwell's own guides on GitHub.
                var pg = new string(Json.S(a, "page").Where(ch => char.IsAsciiLetterLower(ch) || char.IsAsciiDigit(ch) || ch == '-').ToArray());
                var url = "https://github.com/Oscar-Developments-LLC/Deckwell/blob/main/docs/" + (pg.Length > 0 ? pg + ".md" : "README.md");
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(url) { UseShellExecute = true });
                return null;
            }
            case "pushInfo": return new { port = _hub.Push.Port, token = _hub.Push.Token, error = _hub.Push.Error };
            case "renameDeck": { var name = Json.S(a, "name"); var err = await Task.Run(() => _hub.Deck.Rename(name)); return new { ok = err == null, error = err }; }
            case "pairCancel": await Task.Run(() => _hub.Deck.CancelPairing()); return null;
            case "forgetDeck": await Task.Run(() => _hub.Deck.Forget()); return null;
            case "recordStart": _recorder.Start(); return null;
            case "recordStop": _recorder.Stop(); return null;
            case "window":
                switch (Json.S(a, "op"))
                {
                    case "min": WindowState = FormWindowState.Minimized; break;
                    case "max": WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized; break;
                    case "close": Close(); break;
                    case "drag": Native.ReleaseCapture(); Native.SendMessage(Handle, Native.WM_NCLBUTTONDOWN, (IntPtr)Native.HTCAPTION, IntPtr.Zero); break;
                    case "resize":
                    {
                        int ht = Json.S(a, "edge") switch { "n" => Native.HTTOP, "s" => Native.HTBOTTOM, "w" => Native.HTLEFT, "e" => Native.HTRIGHT, "nw" => Native.HTTOPLEFT, "ne" => Native.HTTOPRIGHT, "sw" => Native.HTBOTTOMLEFT, _ => Native.HTBOTTOMRIGHT };
                        Native.ReleaseCapture(); Native.SendMessage(Handle, Native.WM_NCLBUTTONDOWN, (IntPtr)ht, IntPtr.Zero); break;
                    }
                }
                return null;
        }
        throw new Exception("Unknown command " + cmd);
    }
}
