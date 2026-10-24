using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json.Nodes;
using NAudio.CoreAudioApi;

namespace Deckwell;

/// Master / per-app / mic volume. All Core Audio calls happen on one MTA worker thread.
sealed class Audio : IDisposable
{
    public record Slider(string Id, string Control, string App, double Step);
    public record Session(string Name, string Label);
    public record State(int Value, bool Enabled, bool Muted);

    readonly ConcurrentQueue<Action<MMDeviceEnumerator>> _work = new();
    readonly AutoResetEvent _wake = new(false);
    readonly Thread _thread;
    volatile bool _stop;
    volatile Slider[] _sliders = Array.Empty<Slider>();
    readonly Dictionary<string, State> _last = new();
    readonly ConcurrentDictionary<string, DateTime> _holdUntil = new();
    string _sessionsSig = "";

    public event Action<Dictionary<string, State>>? SlidersChanged;
    public event Action<List<Session>>? SessionsChanged;
    public List<Session> Sessions { get; private set; } = new();

    public Audio()
    {
        _thread = new Thread(Loop) { IsBackground = true, Name = "audio" };
        _thread.SetApartmentState(ApartmentState.MTA);
        _thread.Start();
    }

    public void SetSliders(JsonNode? config)
    {
        var list = new List<Slider>();
        foreach (var p in Json.Arr(config, "pages"))
            foreach (var s in (p["strip"] as JsonArray ?? new JsonArray()))
                if (s != null) list.Add(new Slider(Json.S(s, "id"), Json.S(s, "control", "master"), Json.S(s, "app"), Json.D(s, "step", 2)));
        _sliders = list.ToArray();
        lock (_last) _last.Clear();
        _wake.Set();
    }

    public Dictionary<string, State> Snapshot() { lock (_last) return new Dictionary<string, State>(_last); }

    public void Set(string sliderId, double value)
    {
        var s = _sliders.FirstOrDefault(x => x.Id == sliderId); if (s == null) return;
        float v = (float)Math.Clamp(value / 100.0, 0, 1);
        _holdUntil[sliderId] = DateTime.UtcNow.AddMilliseconds(700);
        lock (_last) if (_last.TryGetValue(sliderId, out var old)) _last[sliderId] = old with { Value = (int)Math.Round(value) };
        _work.Enqueue(en => Apply(en, s, dev => dev.AudioEndpointVolume.MasterVolumeLevelScalar = v, sv => sv.Volume = v));
        _wake.Set();
    }

    public void ToggleMute(string sliderId)
    {
        var s = _sliders.FirstOrDefault(x => x.Id == sliderId); if (s == null) return;
        _work.Enqueue(en => Apply(en, s, dev => dev.AudioEndpointVolume.Mute = !dev.AudioEndpointVolume.Mute, null, toggleAppMute: true));
        _wake.Set();
    }

    public void ToggleMic() => ToggleMute(new Slider("__mic", "mic", "", 2));
    void ToggleMute(Slider s) { _work.Enqueue(en => Apply(en, s, dev => dev.AudioEndpointVolume.Mute = !dev.AudioEndpointVolume.Mute, null, true)); _wake.Set(); }

    static void Apply(MMDeviceEnumerator en, Slider s, Action<MMDevice> endpoint, Action<SimpleAudioVolume>? session, bool toggleAppMute = false)
    {
        try
        {
            if (s.Control == "master" || s.Control == "mic")
            {
                using var dev = en.GetDefaultAudioEndpoint(s.Control == "mic" ? DataFlow.Capture : DataFlow.Render, Role.Multimedia);
                endpoint(dev);
                return;
            }
            using var d = en.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
            var sessions = d.AudioSessionManager; sessions.RefreshSessions();
            bool? newMute = null;
            for (int i = 0; i < sessions.Sessions.Count; i++)
            {
                var ses = sessions.Sessions[i];
                if (!Matches(ses, s.App)) continue;
                if (toggleAppMute) { newMute ??= !ses.SimpleAudioVolume.Mute; ses.SimpleAudioVolume.Mute = newMute.Value; }
                else session?.Invoke(ses.SimpleAudioVolume);
            }
        }
        catch (Exception e) { Log.Write("audio apply: " + e.Message); }
    }

    static readonly Dictionary<uint, string> ProcNames = new();
    static string ProcName(uint pid)
    {
        if (pid == 0) return "";
        lock (ProcNames)
        {
            if (ProcNames.TryGetValue(pid, out var n)) return n;
            try { n = Process.GetProcessById((int)pid).ProcessName; } catch { n = ""; }
            ProcNames[pid] = n; return n;
        }
    }

    static bool Matches(AudioSessionControl ses, string app)
    {
        if (string.IsNullOrEmpty(app)) return false;
        var want = Path.GetFileNameWithoutExtension(app).ToLowerInvariant();
        return ProcName(ses.GetProcessID).ToLowerInvariant() == want;
    }

    public static string Pretty(string procName)
    {
        var known = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        { ["msedge"] = "Edge", ["chrome"] = "Chrome", ["firefox"] = "Firefox", ["obs64"] = "OBS", ["vlc"] = "VLC", ["steamwebhelper"] = "Steam", ["steam"] = "Steam", ["Teams"] = "Teams", ["ms-teams"] = "Teams" };
        if (known.TryGetValue(procName, out var k)) return k;
        return procName.Length > 0 ? char.ToUpper(procName[0]) + procName[1..] : procName;
    }

    void Loop()
    {
        using var en = new MMDeviceEnumerator();
        var lastSessions = DateTime.MinValue;
        while (!_stop)
        {
            while (_work.TryDequeue(out var job)) job(en);
            try { Poll(en, DateTime.UtcNow - lastSessions > TimeSpan.FromSeconds(2)); } catch (Exception e) { Log.Write("audio poll: " + e.Message); }
            if (DateTime.UtcNow - lastSessions > TimeSpan.FromSeconds(2)) lastSessions = DateTime.UtcNow;
            _wake.WaitOne(400);
        }
    }

    void Poll(MMDeviceEnumerator en, bool refreshSessions)
    {
        var sliders = _sliders;
        using var render = en.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
        MMDevice? mic = null;
        try { mic = en.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Multimedia); } catch { }
        // Walking the session list creates a pile of COM objects, so only do it when an app slider needs it
        // (every poll) or when the editor's app list is due a refresh (every 2 s).
        var sesList = new List<AudioSessionControl>();
        if (refreshSessions || sliders.Any(s => s.Control is not ("master" or "mic")))
        {
            var mgr = render.AudioSessionManager; mgr.RefreshSessions();
            for (int i = 0; i < mgr.Sessions.Count; i++) sesList.Add(mgr.Sessions[i]);
        }

        var changed = new Dictionary<string, State>();
        foreach (var s in sliders)
        {
            State st;
            if (s.Control == "master") st = new State((int)Math.Round(render.AudioEndpointVolume.MasterVolumeLevelScalar * 100), true, render.AudioEndpointVolume.Mute);
            else if (s.Control == "mic") st = mic == null ? new State(0, false, false) : new State((int)Math.Round(mic.AudioEndpointVolume.MasterVolumeLevelScalar * 100), true, mic.AudioEndpointVolume.Mute);
            else
            {
                var match = sesList.FirstOrDefault(x => Matches(x, s.App));
                st = match == null ? new State(0, false, false) : new State((int)Math.Round(match.SimpleAudioVolume.Volume * 100), true, match.SimpleAudioVolume.Mute);
            }
            if (_holdUntil.TryGetValue(s.Id, out var until) && DateTime.UtcNow < until) continue;
            lock (_last) { if (!_last.TryGetValue(s.Id, out var old) || old != st) { _last[s.Id] = st; changed[s.Id] = st; } }
        }
        mic?.Dispose();
        if (changed.Count > 0) SlidersChanged?.Invoke(changed);

        if (refreshSessions)
        {
            var names = sesList.Select(x => ProcName(x.GetProcessID)).Where(n => n.Length > 0 && !n.Equals("audiodg", StringComparison.OrdinalIgnoreCase))
                .Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(n => n, StringComparer.OrdinalIgnoreCase).ToList();
            var sig = string.Join("|", names);
            if (sig != _sessionsSig) { _sessionsSig = sig; Sessions = names.Select(n => new Session(n, Pretty(n))).ToList(); SessionsChanged?.Invoke(Sessions); }
            lock (ProcNames) if (ProcNames.Count > 500) ProcNames.Clear();
        }
        foreach (var x in sesList) x.Dispose();
    }

    public void Dispose() { _stop = true; _wake.Set(); }
}
