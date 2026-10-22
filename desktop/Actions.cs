using System.Diagnostics;
using System.Text;
using System.Text.Json.Nodes;
using Renci.SshNet;

namespace Deckwell;

sealed record KeyResult(bool Ok, string Text, string? Toast = null, string? Badge = null, string? Line = null, bool Ring = false, JsonObject? LastRun = null);

/// Executes what a key does. Pure desktop side: the deck only reports presses.
sealed class Actions
{
    readonly Audio _audio;
    readonly Media _media;
    readonly HashSet<string> _held = new();

    public Actions(Audio audio, Media media) { _audio = audio; _media = media; }

    static IList<ushort> Vks(JsonNode key) => Json.Arr(key, "keys").Select(k => (ushort)Json.D(k, "vk")).Where(v => v != 0).ToList();

    /// Called on touch-down (and for Test in the editor with down=true, up follows immediately).
    /// Runs the key's own action, then its extra steps in order. A failure stops the chain.
    public async Task<KeyResult?> Press(JsonNode key, JsonNode config)
    {
        var type = Json.S(key, "type");
        var steps = Json.Arr(key, "steps").ToList();
        bool nav = type is "folder" or "goto";
        KeyResult? main = nav ? (steps.Count == 0 ? new KeyResult(true, "Navigation keys work on the deck") : null) : await Run(key, config, isMain: true);
        if (steps.Count == 0 || main is { Ok: false }) return main;

        var label = Json.S(key, "label");
        for (int i = 0; i < steps.Count; i++)
        {
            var s = steps[i];
            if (Json.S(s, "type") == "wait") { await Task.Delay((int)Math.Clamp(Json.D(s, "ms", 500), 0, 30000)); continue; }
            var r = await Run(s, config, isMain: false);
            if (r is { Ok: false })
            {
                Log.Write($"key {label}: step {i + 1} failed: {r.Text}");
                return r with { Text = $"Step {i + 1}: {r.Text}", Toast = $"⚠ {label} · step {i + 1} · {Short(r.Text, 50)}", Badge = r.Badge ?? $"step {i + 1}" };
            }
        }
        return main ?? new KeyResult(true, $"Ran {steps.Count} step{(steps.Count == 1 ? "" : "s")}");
    }

    async Task<KeyResult?> Run(JsonNode a, JsonNode config, bool isMain)
    {
        var type = Json.S(a, "type");
        try
        {
            switch (type)
            {
                case "app": return LaunchApp(a);
                case "hotkey":
                {
                    var vks = Vks(a);
                    if (vks.Count == 0) return new KeyResult(false, "No shortcut recorded", Badge: "no keys");
                    // Only the key itself can be held; steps are always a quick press.
                    if (isMain && Json.S(a, "sendAs") == "hold") { lock (_held) _held.Add(Json.S(a, "id")); Input.Down(vks); }
                    else Input.Tap(vks);
                    return new KeyResult(true, "Sent " + string.Join("+", Json.Arr(a, "keys").Select(k => Json.S(k, "n"))));
                }
                case "media": return MediaKey(Json.S(a, "media", "playpause"));
                case "url": return OpenUrl(Json.S(a, "url"));
                case "script": return await Task.Run(() => RunScript(a));
                case "ssh": return await Task.Run(() => RunSsh(a, config));
                case "status": { var u = Json.S(a, "onTap"); return string.IsNullOrWhiteSpace(u) ? null : OpenUrl(u); }
                case "nowplaying": await _media.TogglePlayPause(); return new KeyResult(true, "Play / pause");
                default: return new KeyResult(true, "Navigation keys work on the deck");
            }
        }
        catch (Exception e)
        {
            Log.Write($"key {type}: {e}");
            return new KeyResult(false, e.Message, Badge: "error", Toast: "⚠ " + Json.S(a, "label") + " · " + Short(e.Message, 60));
        }
    }

    public void Release(JsonNode key)
    {
        var id = Json.S(key, "id");
        bool was; lock (_held) was = _held.Remove(id);
        if (was) Input.Up(Vks(key));
    }

    public void ReleaseAll(JsonNode? config)
    {
        List<string> ids; lock (_held) { ids = _held.ToList(); _held.Clear(); }
        foreach (var p in Json.Arr(config, "pages")) foreach (var k in Json.Arr(p, "keys")) if (ids.Contains(Json.S(k, "id"))) Input.Up(Vks(k));
    }

    KeyResult MediaKey(string m)
    {
        switch (m)
        {
            case "playpause": Input.Tap(new[] { Input.VK_MEDIA_PLAY_PAUSE }); break;
            case "next": Input.Tap(new[] { Input.VK_MEDIA_NEXT }); break;
            case "prev": Input.Tap(new[] { Input.VK_MEDIA_PREV }); break;
            case "stop": Input.Tap(new[] { Input.VK_MEDIA_STOP }); break;
            case "volup": Input.Tap(new[] { Input.VK_VOLUME_UP }); break;
            case "voldown": Input.Tap(new[] { Input.VK_VOLUME_DOWN }); break;
            case "mute": Input.Tap(new[] { Input.VK_VOLUME_MUTE }); break;
            case "mic": _audio.ToggleMic(); break;
        }
        return new KeyResult(true, "Media: " + m);
    }

    static KeyResult OpenUrl(string url)
    {
        url = url.Trim();
        if (url.Length == 0 || url == "https://") return new KeyResult(false, "No URL set", Badge: "no url");
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        return new KeyResult(true, "Opened " + url);
    }

    static KeyResult LaunchApp(JsonNode key)
    {
        var raw = Json.S(key, "exe").Trim().Trim('"');
        var args = Json.S(key, "args");
        if (raw.Length == 0) return new KeyResult(false, "No executable set", Badge: "no path");
        var label = Json.S(key, "label");
        if (label.Length == 0) label = Path.GetFileNameWithoutExtension(raw.Split('!')[0]); // steps have no label
        var mode = Json.S(key, "ifRunning", "focus"); // focus | new | minimize | toggle

        // Work out how to recognise the app's windows: Store app ID, or the exe's process name.
        string? aumid = null, procName = null, exe = null;
        bool store = raw.StartsWith("shell:", StringComparison.OrdinalIgnoreCase);
        if (store)
        {
            var i = raw.IndexOf('\\');
            aumid = i >= 0 ? raw[(i + 1)..] : null;
        }
        else
        {
            exe = Paths.Expand(raw);
            if (!File.Exists(exe)) return new KeyResult(false, "Not found: " + exe, Badge: "not found", Toast: "⚠ " + label + " · file not found");
            // For a shortcut, look at what it points to so the running app can be found.
            var target = exe.EndsWith(".lnk", StringComparison.OrdinalIgnoreCase) ? ShortcutTarget(exe) : exe;
            if (!string.IsNullOrEmpty(target)) procName = Path.GetFileNameWithoutExtension(target);
            // Squirrel-style launchers (Discord's Update.exe --processStart Discord.exe) run a different process.
            var m = System.Text.RegularExpressions.Regex.Match(args, @"--processStart\s+""?([^""\s]+)");
            if (m.Success) procName = Path.GetFileNameWithoutExtension(m.Groups[1].Value);
        }

        if (mode != "new" && (procName != null || aumid != null))
        {
            var wins = AppWindows.Find(procName, aumid);
            if (wins.Count > 0)
            {
                bool minimize = mode == "minimize" || (mode == "toggle" && AppWindows.IsInFront(wins));
                if (minimize) { AppWindows.Minimize(wins); return new KeyResult(true, "Minimized " + label); }
                AppWindows.Focus(wins);
                return new KeyResult(true, "Focused " + label);
            }
        }

        if (store) Process.Start(new ProcessStartInfo("explorer.exe", raw) { UseShellExecute = true });
        else Process.Start(new ProcessStartInfo(exe!, args) { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(exe) ?? "" });
        return new KeyResult(true, "Started " + label);
    }

    static string ShortcutTarget(string lnk)
    {
        try
        {
            var t = Type.GetTypeFromProgID("WScript.Shell"); if (t == null) return "";
            dynamic shell = Activator.CreateInstance(t)!;
            dynamic sc = shell.CreateShortcut(lnk);
            return (string)sc.TargetPath;
        }
        catch { return ""; }
    }

    static string Short(string s, int n) { s = s.Replace('\n', ' ').Replace('\r', ' ').Trim(); return s.Length <= n ? s : s[..(n - 1)] + "…"; }
    static string LastLine(string s) => s.Split('\n').Select(l => l.TrimEnd('\r').Trim()).LastOrDefault(l => l.Length > 0) ?? "";
    static string Secs(Stopwatch sw) => (sw.Elapsed.TotalSeconds).ToString(sw.Elapsed.TotalSeconds < 10 ? "0.0" : "0");

    KeyResult RunScript(JsonNode key)
    {
        var file = Paths.Expand(Json.S(key, "file"));
        var label = Json.S(key, "label");
        if (!File.Exists(file)) return new KeyResult(false, "Script not found: " + file, Badge: "not found", Toast: "⚠ " + label + " · script not found");
        bool py = Json.S(key, "runtime") == "python";
        var window = Json.S(key, "window", "hidden");
        string exe, args;
        if (py) { exe = FindPython(); args = $"\"{file}\""; }
        else { exe = "powershell.exe"; args = $"-NoProfile -ExecutionPolicy Bypass -File \"{file}\""; }
        var psi = new ProcessStartInfo(exe, args) { WorkingDirectory = Path.GetDirectoryName(file) ?? "" };
        bool capture = window == "hidden";
        if (window == "admin") { psi.UseShellExecute = true; psi.Verb = "runas"; }
        else if (capture) { psi.UseShellExecute = false; psi.CreateNoWindow = true; psi.RedirectStandardOutput = true; psi.RedirectStandardError = true; psi.StandardOutputEncoding = Encoding.UTF8; psi.StandardErrorEncoding = Encoding.UTF8; }
        else { psi.UseShellExecute = false; psi.CreateNoWindow = false; }

        var sw = Stopwatch.StartNew();
        using var p = Process.Start(psi)!;
        var output = new StringBuilder();
        if (capture)
        {
            p.OutputDataReceived += (_, e) => { if (e.Data != null) lock (output) output.AppendLine(e.Data); };
            p.ErrorDataReceived += (_, e) => { if (e.Data != null) lock (output) output.AppendLine(e.Data); };
            p.BeginOutputReadLine(); p.BeginErrorReadLine();
        }
        if (!p.WaitForExit(TimeSpan.FromMinutes(10))) { try { p.Kill(true); } catch { } return new KeyResult(false, "Timed out after 10 min", Badge: "timeout"); }
        p.WaitForExit();
        sw.Stop();
        int code = p.ExitCode;
        string line; lock (output) line = LastLine(output.ToString());
        var lastRun = new JsonObject { ["time"] = DateTime.Now.ToString("HH:mm"), ["exit"] = code, ["dur"] = Secs(sw), ["line"] = capture ? line : window == "admin" ? "(ran as admin, output not captured)" : "(visible window, output not captured)" };
        bool ok = code == 0;
        var toast = $"{(ok ? "✓" : "⚠")} {Path.GetFileName(file)} · exit {code} · {Secs(sw)} s";
        return new KeyResult(ok, toast[2..], Toast: toast, Badge: ok ? null : $"exit {code}", Ring: ok, Line: capture && line.Length > 0 ? line : null, LastRun: lastRun);
    }

    static string FindPython()
    {
        foreach (var name in new[] { "py.exe", "python.exe" })
            foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
                try { var f = Path.Combine(dir.Trim(), name); if (File.Exists(f) && !f.Contains("WindowsApps")) return f; } catch { }
        return "python.exe";
    }

    KeyResult RunSsh(JsonNode key, JsonNode config)
    {
        var host = Json.Arr(config, "hosts").FirstOrDefault(h => Json.S(h, "id") == Json.S(key, "hostId"));
        var command = Json.S(key, "command").Trim();
        var after = Json.S(key, "after", "ring");
        if (host == null) return new KeyResult(false, "No host picked", Badge: "no host");
        if (command.Length == 0) return new KeyResult(false, "No command set", Badge: "no cmd");
        var hostName = Json.S(host, "name");
        var keyPath = Paths.Expand(Json.S(key, "keyPath", "~/.ssh/id_ed25519"));
        var timeout = TimeSpan.FromSeconds(Math.Clamp(Json.D(key, "timeout", 10), 1, 600));
        var sw = Stopwatch.StartNew();
        string Toast(string mark, string tail) => $"{mark} {hostName} · {Short(command, 40)} · {tail}";
        try
        {
            if (!File.Exists(keyPath)) return new KeyResult(false, "Key file not found: " + keyPath, Badge: "no key", Toast: Toast("⚠", "key file not found"));
            using var pk = new PrivateKeyFile(keyPath);
            var ci = new ConnectionInfo(Json.S(host, "address"), (int)Json.D(host, "port", 22), Json.S(host, "user", "root"), new PrivateKeyAuthenticationMethod(Json.S(host, "user", "root"), pk)) { Timeout = timeout };
            using var client = new SshClient(ci);
            client.Connect();
            using var cmd = client.CreateCommand(command);
            cmd.CommandTimeout = timeout;
            var outp = cmd.Execute() + "\n" + cmd.Error;
            sw.Stop();
            int code = cmd.ExitStatus ?? -1;
            var line = LastLine(outp);
            bool ok = code == 0;
            var toast = Toast(ok ? "✓" : "⚠", ok ? Secs(sw) + " s" : $"exit {code}");
            return new KeyResult(ok, ok ? (line.Length > 0 ? line : "Done in " + Secs(sw) + " s") : $"exit {code}: {line}", Toast: toast,
                Badge: ok ? null : $"exit {code}", Ring: ok && after == "ring", Line: after == "lastline" && line.Length > 0 ? Short(line, 80) : null);
        }
        catch (Renci.SshNet.Common.SshOperationTimeoutException) { return new KeyResult(false, "Timed out", Badge: "timeout", Toast: Toast("⚠", "timed out")); }
        catch (Renci.SshNet.Common.SshAuthenticationException) { return new KeyResult(false, "Auth failed (is the key on the host?)", Badge: "auth", Toast: Toast("⚠", "auth failed")); }
        catch (Renci.SshNet.Common.SshPassPhraseNullOrEmptyException) { return new KeyResult(false, "That key needs a passphrase. Use a key without one.", Badge: "passphrase", Toast: Toast("⚠", "key has a passphrase")); }
        catch (System.Net.Sockets.SocketException e) { return new KeyResult(false, e.Message, Badge: "offline", Toast: Toast("⚠", "host unreachable")); }
    }
}
