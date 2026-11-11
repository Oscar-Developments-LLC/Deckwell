using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json.Nodes;
using NAudio.CoreAudioApi;

namespace Deckwell;

/// Master / per-app / mic volume. All Core Audio calls happen on one MTA worker thread.
///
/// Slider moves from the deck are applied as fast as they arrive: only the newest position per slider is used
/// (LatestValues), and the default devices and app sessions stay open between moves instead of being looked up
/// again each time. The worker reads the volumes back every 400 ms to follow changes made in Windows.
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
    readonly LatestValues<string, float> _moves = new();
    string _sessionsSig = "";

    // Owned by the worker thread only.
    MMDevice? _render, _capture;
    List<AudioSessionControl> _sessions = new();
    DateTime _sessionsAt = DateTime.MinValue;

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
                if (s != null) list.Add(new Slider(Json.S(s, "id"), Json.S(s, "control", "master"), Json.S(s, "app"), Json.D(s, "step", 1)));
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
        _moves.Set(sliderId, v); // replaces any older position that hasn't been applied yet
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
        var nextPoll = DateTime.MinValue;
        while (!_stop)
        {
            // Slider moves first, every time the worker wakes. Polling only runs on its own 400 ms beat,
            // so a stream of moves is never held up behind it.
            ApplyMoves(en);
            while (_work.TryDequeue(out var job)) job(en);
            var now = DateTime.UtcNow;
            if (now >= nextPoll)
            {
                bool refresh = now - lastSessions > TimeSpan.FromSeconds(2);
                try { Poll(en, refresh); } catch (Exception e) { Log.Write("audio poll: " + e.Message); DropDevices(); }
                if (refresh) lastSessions = now;
                nextPoll = DateTime.UtcNow.AddMilliseconds(400);
            }
            var wait = nextPoll - DateTime.UtcNow;
            _wake.WaitOne(wait > TimeSpan.Zero ? wait : TimeSpan.Zero);
        }
        DropDevices();
    }

    /// Sets the newest position of every slider that moved. Uses the open devices and sessions, so each call is quick.
    void ApplyMoves(MMDeviceEnumerator en)
    {
        if (_moves.IsEmpty) return;
        var sliders = _sliders;
        foreach (var (id, v) in _moves.TakeAll())
        {
            var s = sliders.FirstOrDefault(x => x.Id == id); if (s == null) continue;
            try
            {
                if (s.Control == "master") Render(en).AudioEndpointVolume.MasterVolumeLevelScalar = v;
                else if (s.Control == "mic") { var mic = Capture(en); if (mic != null) mic.AudioEndpointVolume.MasterVolumeLevelScalar = v; }
                else
                {
                    var hits = _sessions.Where(x => Matches(x, s.App)).ToList();
                    // The app may have started playing since the last look. Look again, but at most twice a second.
                    if (hits.Count == 0 && DateTime.UtcNow - _sessionsAt > TimeSpan.FromMilliseconds(500)) { RefreshSessions(en); hits = _sessions.Where(x => Matches(x, s.App)).ToList(); }
                    foreach (var ses in hits) ses.SimpleAudioVolume.Volume = v;
                }
            }
            catch (Exception e) { Log.Write("audio set: " + e.Message); DropDevices(); } // a device went away; open the new default next time
        }
    }

    MMDevice Render(MMDeviceEnumerator en) => _render ??= en.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
    MMDevice? Capture(MMDeviceEnumerator en)
    {
        if (_capture != null) return _capture;
        try { return _capture = en.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Multimedia); } catch { return null; } // no mic
    }

    /// Re-reads the app sessions on the current output device.
    void RefreshSessions(MMDeviceEnumerator en)
    {
        foreach (var x in _sessions) x.Dispose();
        _sessions = new List<AudioSessionControl>();
        var mgr = Render(en).AudioSessionManager; mgr.RefreshSessions();
        for (int i = 0; i < mgr.Sessions.Count; i++) _sessions.Add(mgr.Sessions[i]);
        _sessionsAt = DateTime.UtcNow;
    }

    /// Follows a change of default device (headphones plugged in, and so on): reopens it if it's a different one.
    void FollowDefaults(MMDeviceEnumerator en)
    {
        var r = en.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
        if (_render != null && _render.ID == r.ID) r.Dispose();
        else { foreach (var x in _sessions) x.Dispose(); _sessions = new(); _sessionsAt = DateTime.MinValue; _render?.Dispose(); _render = r; }
        MMDevice? c = null;
        try { c = en.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Multimedia); } catch { }
        if (c == null) { _capture?.Dispose(); _capture = null; }
        else if (_capture != null && _capture.ID == c.ID) c.Dispose();
        else { _capture?.Dispose(); _capture = c; }
    }

    void DropDevices()
    {
        foreach (var x in _sessions) { try { x.Dispose(); } catch { } }
        _sessions = new(); _sessionsAt = DateTime.MinValue;
        try { _render?.Dispose(); } catch { }
        try { _capture?.Dispose(); } catch { }
        _render = null; _capture = null;
    }

    void Poll(MMDeviceEnumerator en, bool refreshSessions)
    {
        var sliders = _sliders;
        FollowDefaults(en);
        var render = Render(en);
        var mic = _capture;
        // Walking the session list creates a pile of COM objects, so only do it when an app slider needs it
        // (every poll) or when the editor's app list is due a refresh (every 2 s).
        if (refreshSessions || sliders.Any(s => s.Control is not ("master" or "mic"))) RefreshSessions(en);
        var sesList = _sessions;

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
        if (changed.Count > 0) SlidersChanged?.Invoke(changed);

        if (refreshSessions)
        {
            var names = sesList.Select(x => ProcName(x.GetProcessID)).Where(n => n.Length > 0 && !n.Equals("audiodg", StringComparison.OrdinalIgnoreCase))
                .Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(n => n, StringComparer.OrdinalIgnoreCase).ToList();
            var sig = string.Join("|", names);
            if (sig != _sessionsSig) { _sessionsSig = sig; Sessions = names.Select(n => new Session(n, Pretty(n))).ToList(); SessionsChanged?.Invoke(Sessions); }
            lock (ProcNames) if (ProcNames.Count > 500) ProcNames.Clear();
        }
    }

    public void Dispose() { _stop = true; _wake.Set(); }
}
