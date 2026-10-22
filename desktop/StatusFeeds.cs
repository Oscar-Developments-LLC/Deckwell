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

    /// A tile got a new reading: (key id, status message for the deck and editor).
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
            Publish(Json.S(k, "id"), StatusParse.Parse(text, 0));
            n++;
        }
        return n;
    }

    IEnumerable<JsonNode> Tiles() =>
        Json.Arr(_config(), "pages").SelectMany(p => Json.Arr(p, "keys")).Where(k => Json.S(k, "type") == "status");

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
                        try { Publish(id, Read(tile, cfg)); }
                        catch (Exception e) { Publish(id, new StatusParse.Reading("err", Short(e.Message), null, false)); }
                        finally { lock (_gate) _running.Remove(id); }
                    });
                }
            }
            catch (Exception e) { Log.Write("status: " + e.Message); }
            _wake.WaitOne(250);
        }
    }

    void Publish(string id, StatusParse.Reading r)
    {
        var msg = StatusParse.ToMessage(id, r);
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

    /* ---------------- this PC ---------------- */

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

    static (int, string) RunCommand(string shell, string command)
    {
        command = command.Trim();
        if (command.Length == 0) return (1, "—|no command set||down");
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
        if (!p.WaitForExit(15000)) { try { p.Kill(true); } catch { } return (1, "timeout|took over 15 s||down"); }
        p.WaitForExit();
        lock (outp) return (p.ExitCode, outp.ToString());
    }

    static (int, string) RunSsh(JsonNode tile, JsonNode? cfg)
    {
        var host = Json.Arr(cfg, "hosts").FirstOrDefault(h => Json.S(h, "id") == Json.S(tile, "hostId"));
        var command = Json.S(tile, "command").Trim();
        if (host == null) return (1, "—|no host picked||down");
        if (command.Length == 0) return (1, "—|no command set||down");
        var keyPath = Paths.Expand(Json.S(tile, "keyPath", "~/.ssh/id_ed25519"));
        if (!File.Exists(keyPath)) return (1, "—|key file not found||down");
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
        catch (Renci.SshNet.Common.SshOperationTimeoutException) { return (1, "timeout|ssh timed out||down"); }
        catch (Renci.SshNet.Common.SshAuthenticationException) { return (1, "auth|ssh login failed||down"); }
        catch (System.Net.Sockets.SocketException) { return (1, "offline|host unreachable||down"); }
    }

    static string Short(string s) { s = s.Replace('\n', ' ').Trim(); return s.Length <= 40 ? s : s[..39] + "…"; }

    public void Dispose() { _stop = true; _wake.Set(); }
}
