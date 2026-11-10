using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json.Nodes;
using Renci.SshNet;

namespace Deckwell;

/// Keeps every status tile fed. Each tile picks a source in the editor:
///   pc       this computer's CPU or RAM (built in)
///   command  a PowerShell or cmd command, run every N seconds
///   ssh      a command on one of your hosts, run every N seconds
///   push     your own script sends values to Deckwell (see PushServer)
/// Output goes through StatusParse. See docs/status-tiles.md.
/// Panel keys use the same sources but show all of the output (PanelParse), and "This PC" means top apps.
sealed class StatusFeeds : IDisposable
{
    readonly Func<JsonNode?> _config;
    readonly object _gate = new();
    readonly Dictionary<string, JsonObject> _last = new();
    readonly Dictionary<string, DateTime> _due = new();
    readonly HashSet<string> _running = new();
    readonly AutoResetEvent _wake = new(false);
    volatile bool _stop;
    double? _cpu;

    /// A tile got a new reading: (key id, "status" or "panel" message for the deck and editor).
    public event Action<string, JsonObject>? Updated;

    public StatusFeeds(Func<JsonNode?> config)
    {
        _config = config;
        new Thread(Loop) { IsBackground = true, Name = "status" }.Start();
        if (OperatingSystem.IsWindows()) new Thread(CpuSampler) { IsBackground = true, Name = "cpu" }.Start();
    }

    /// Call after the config is saved: new and edited tiles refresh right away.
    public void ConfigChanged()
    {
        lock (_gate) _due.Clear();
        _wake.Set();
    }

    /// Latest reading of every tile, for a deck that just connected.
    public List<JsonObject> Snapshot() { lock (_gate) return _last.Values.Select(v => (JsonObject)v.DeepClone()).ToList(); }

    /// A pushed value for a feed name. Returns how many tiles use that feed.
    public int Push(string feed, string text)
    {
        int n = 0;
        foreach (var k in Tiles().Where(k => Json.S(k, "source") == "push" && string.Equals(Json.S(k, "feed").Trim(), feed, StringComparison.OrdinalIgnoreCase)))
        {
            var id = Json.S(k, "id");
            Publish(id, IsPanel(k) ? PanelParse.ToMessage(id, PanelParse.Clean(text), true) : StatusParse.ToMessage(id, StatusParse.Parse(text, 0)));
            n++;
        }
        return n;
    }

    IEnumerable<JsonNode> Tiles() =>
        Json.Arr(_config(), "pages").SelectMany(p => Json.Arr(p, "keys")).Where(k => Json.S(k, "type") is "status" or "panel");

    static bool IsPanel(JsonNode k) => Json.S(k, "type") == "panel";

    void Loop()
    {
        while (!_stop)
        {
            try
            {
                var now = DateTime.UtcNow;
                var cfg = _config();
                foreach (var k in Tiles().ToList())
                {
                    var id = Json.S(k, "id"); var src = Json.S(k, "source");
                    if (src is not ("pc" or "command" or "ssh")) continue;
                    var every = TimeSpan.FromSeconds(Math.Clamp(Json.D(k, "refresh", src == "ssh" ? 10 : 5), 1, 3600));
                    lock (_gate)
                    {
                        if (_running.Contains(id) || (_due.TryGetValue(id, out var due) && now < due)) continue;
                        _running.Add(id); _due[id] = now + every;
                    }
                    var tile = k.DeepClone();
                    Task.Run(() =>
                    {
                        try { Publish(id, IsPanel(tile) ? ReadPanel(tile, cfg) : StatusParse.ToMessage(id, Read(tile, cfg))); }
                        catch (Exception e) { Publish(id, IsPanel(tile) ? PanelParse.ToMessage(id, "error: " + Short(e.Message), false) : StatusParse.ToMessage(id, new StatusParse.Reading("err", Short(e.Message), null, false))); }
                        finally { lock (_gate) _running.Remove(id); }
                    });
                }
            }
            catch (Exception e) { Log.Write("status: " + e.Message); }
            _wake.WaitOne(250);
        }
    }

    void Publish(string id, JsonObject msg)
    {
        lock (_gate)
        {
            if (_last.TryGetValue(id, out var old) && JsonNode.DeepEquals(old, msg)) return;
            _last[id] = msg;
        }
        Updated?.Invoke(id, (JsonObject)msg.DeepClone());
    }

    StatusParse.Reading Read(JsonNode tile, JsonNode? cfg)
    {
        switch (Json.S(tile, "source"))
        {
            case "pc": return Json.S(tile, "metric", "cpu") == "ram" ? Ram() : Cpu();
            case "command": { var (code, outp) = RunCommand(Json.S(tile, "shell", "powershell"), Json.S(tile, "command")); return StatusParse.Parse(outp, code); }
            case "ssh": { var (code, outp) = RunSsh(tile, cfg); return StatusParse.Parse(outp, code); }
        }
        return new StatusParse.Reading(null, null, null, false);
    }

    JsonObject ReadPanel(JsonNode tile, JsonNode? cfg)
    {
        var id = Json.S(tile, "id");
        switch (Json.S(tile, "source"))
        {
            case "pc": return PanelParse.ToMessage(id, Json.S(tile, "metric", "topcpu") == "topmem" ? TopMemory() : TopCpu(), true);
            case "command": { var (code, outp) = RunCommand(Json.S(tile, "shell", "powershell"), Json.S(tile, "command"), panel: true); return PanelParse.ToMessage(id, PanelParse.Clean(outp), code == 0); }
            case "ssh": { var (code, outp) = RunSsh(tile, cfg, panel: true); return PanelParse.ToMessage(id, PanelParse.Clean(outp), code == 0); }
        }
        return PanelParse.ToMessage(id, "", false);
    }

    /* ---------------- this PC ---------------- */

    /// Top apps by memory, with processes of the same app added together.
    static string TopMemory()
    {
        var rows = new List<(string name, long bytes, int n)>();
        foreach (var g in Process.GetProcesses().GroupBy(p => p.ProcessName))
        {
            long sum = 0; int n = 0;
            foreach (var p in g) { try { sum += p.WorkingSet64; n++; } catch { } finally { p.Dispose(); } }
            if (n > 0 && g.Key != "Idle" && g.Key != "System") rows.Add((g.Key, sum, n));
        }
        return "MEMORY    APP\n" + string.Join("\n", rows.OrderByDescending(r => r.bytes).Take(15)
            .Select(r => $"{Size(r.bytes),8}  {r.name}{(r.n > 1 ? $" ({r.n})" : "")}"));
    }

    static string Size(long b) => b >= 1L << 30 ? $"{b / 1073741824.0:0.0} GB" : $"{b / 1048576.0:0} MB";

    readonly Dictionary<int, TimeSpan> _cpuPrev = new();
    DateTime _cpuPrevAt;

    /// Top apps by CPU since the last refresh, with processes of the same app added together.
    string TopCpu()
    {
        var now = DateTime.UtcNow; var cur = new Dictionary<int, TimeSpan>(); var byName = new Dictionary<string, double>();
        double secs = (now - _cpuPrevAt).TotalSeconds * Environment.ProcessorCount;
        foreach (var p in Process.GetProcesses())
        {
            try
            {
                if (p.Id == 0) continue;
                var t = p.TotalProcessorTime; cur[p.Id] = t;
                if (_cpuPrev.TryGetValue(p.Id, out var old) && secs > 0)
                    byName[p.ProcessName] = byName.GetValueOrDefault(p.ProcessName) + (t - old).TotalSeconds / secs;
            }
            catch { }
            finally { p.Dispose(); }
        }
        bool first = _cpuPrev.Count == 0;
        lock (_cpuPrev) { _cpuPrev.Clear(); foreach (var kv in cur) _cpuPrev[kv.Key] = kv.Value; _cpuPrevAt = now; }
        if (first) return "measuring…";
        return "  CPU   APP\n" + string.Join("\n", byName.Where(kv => kv.Value > 0.0005).OrderByDescending(kv => kv.Value).Take(15)
            .Select(kv => $"{kv.Value * 100,5:0.0}%  {kv.Key}"));
    }

    StatusParse.Reading Cpu()
    {
        var v = _cpu;
        if (v == null) return new StatusParse.Reading(null, "measuring…", null, true);
        return new StatusParse.Reading($"{Math.Round(v.Value * 100)}%", $"{Environment.ProcessorCount} threads", v, true);
    }

    static StatusParse.Reading Ram()
    {
        if (!OperatingSystem.IsWindows()) return new StatusParse.Reading(null, "Windows only", null, false);
        var m = new MEMORYSTATUSEX { dwLength = (uint)Marshal.SizeOf<MEMORYSTATUSEX>() };
        if (!GlobalMemoryStatusEx(ref m) || m.ullTotalPhys == 0) return new StatusParse.Reading("err", "couldn't read memory", null, false);
        double used = m.ullTotalPhys - m.ullAvailPhys;
        double frac = used / m.ullTotalPhys;
        return new StatusParse.Reading($"{Math.Round(frac * 100)}%", $"{used / 1073741824.0:0.0} / {m.ullTotalPhys / 1073741824.0:0} GB", frac, true);
    }

    void CpuSampler()
    {
        ulong pi = 0, pk = 0, pu = 0;
        while (!_stop)
        {
            if (GetSystemTimes(out var idle, out var kernel, out var user))
            {
                ulong i = idle.Value, k = kernel.Value, u = user.Value;
                if (pk != 0)
                {
                    ulong total = (k - pk) + (u - pu);   // kernel time includes idle time
                    if (total > 0) _cpu = Math.Clamp(1.0 - (double)(i - pi) / total, 0, 1);
                }
                pi = i; pk = k; pu = u;
            }
            Thread.Sleep(1000);
        }
    }

    [StructLayout(LayoutKind.Sequential)] struct FILETIME64 { public ulong Value; }
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetSystemTimes(out FILETIME64 idle, out FILETIME64 kernel, out FILETIME64 user);

    [StructLayout(LayoutKind.Sequential)]
    struct MEMORYSTATUSEX
    {
        public uint dwLength, dwMemoryLoad;
        public ulong ullTotalPhys, ullAvailPhys, ullTotalPageFile, ullAvailPageFile, ullTotalVirtual, ullAvailVirtual, ullAvailExtendedVirtual;
    }
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX m);

    /* ---------------- commands ---------------- */

    static (int, string) RunCommand(string shell, string command, bool panel = false)
    {
        command = command.Trim();
        if (command.Length == 0) return (1, panel ? "no command set" : "—|no command set||down");
        var psi = shell == "cmd"
            ? new ProcessStartInfo("cmd.exe", "/d /c " + command)
            // -EncodedCommand (UTF-16LE base64) keeps quotes and multi-line scripts intact.
            : new ProcessStartInfo("powershell.exe", "-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand " + Convert.ToBase64String(Encoding.Unicode.GetBytes("[Console]::OutputEncoding = [Text.Encoding]::UTF8\n" + command)));
        psi.UseShellExecute = false; psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true; psi.RedirectStandardError = true;
        psi.StandardOutputEncoding = Encoding.UTF8; psi.StandardErrorEncoding = Encoding.UTF8;
        using var p = Process.Start(psi)!;
        var outp = new StringBuilder();
        p.OutputDataReceived += (_, e) => { if (e.Data != null) lock (outp) outp.AppendLine(e.Data); };
        p.ErrorDataReceived += (_, e) => { if (e.Data != null && e.Data.Trim().Length > 0) Log.Write("status cmd: " + e.Data); };
        p.BeginOutputReadLine(); p.BeginErrorReadLine();
        if (!p.WaitForExit(15000)) { try { p.Kill(true); } catch { } return (1, panel ? "timed out after 15 s" : "timeout|took over 15 s||down"); }
        p.WaitForExit();
        lock (outp) return (p.ExitCode, outp.ToString());
    }

    static (int, string) RunSsh(JsonNode tile, JsonNode? cfg, bool panel = false)
    {
        var host = Json.Arr(cfg, "hosts").FirstOrDefault(h => Json.S(h, "id") == Json.S(tile, "hostId"));
        var command = Json.S(tile, "command").Trim();
        string Err(string value, string sub) => panel ? sub : $"{value}|{sub}||down";
        if (host == null) return (1, Err("—", "no host picked"));
        if (command.Length == 0) return (1, Err("—", "no command set"));
        var keyPath = Paths.Expand(Json.S(tile, "keyPath", "~/.ssh/id_ed25519"));
        if (!File.Exists(keyPath)) return (1, Err("—", "key file not found"));
        var timeout = TimeSpan.FromSeconds(10);
        try
        {
            using var pk = new PrivateKeyFile(keyPath);
            var user = Json.S(host, "user", "root");
            var ci = new ConnectionInfo(Json.S(host, "address"), (int)Json.D(host, "port", 22), user, new PrivateKeyAuthenticationMethod(user, pk)) { Timeout = timeout };
            using var client = new SshClient(ci);
            client.Connect();
            using var cmd = client.CreateCommand(command);
            cmd.CommandTimeout = timeout;
            var outp = cmd.Execute();
            return (cmd.ExitStatus ?? -1, outp);
        }
        catch (Renci.SshNet.Common.SshOperationTimeoutException) { return (1, Err("timeout", "ssh timed out")); }
        catch (Renci.SshNet.Common.SshAuthenticationException) { return (1, Err("auth", "ssh login failed")); }
        catch (System.Net.Sockets.SocketException) { return (1, Err("offline", "host unreachable")); }
    }

    static string Short(string s) { s = s.Replace('\n', ' ').Trim(); return s.Length <= 40 ? s : s[..39] + "…"; }

    public void Dispose() { _stop = true; _wake.Set(); }
}
