using System.Diagnostics;
using System.Security.Cryptography;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json.Nodes;

namespace Deckwell;

/// Connection to the deck device. The deck runs a TCP server on :8765 and broadcasts a UDP beacon on :8766.
/// Nothing reaches the rest of the app until the deck passes auth (or the user pairs it). After that every
/// message both ways is signed. See docs/PROTOCOL.md.
/// Mode "auto": Wi-Fi first (beacon or saved IP), USB fallback through `adb forward` (Android 4.4 has no `adb reverse`).
/// Mode "wifi" / "usb": only that link is tried.
sealed class DeckLink : IDisposable
{
    public const int DeckPort = 8765, BeaconPort = 8766, UsbLocalPort = 18765;

    public sealed class Status
    {
        public bool Connected { get; set; }
        public string? Link { get; set; }
        public int Rtt { get; set; }
        public string Ip { get; set; } = "";
        public bool Usb { get; set; }
        public bool Adb { get; set; }
        /// The name the user gave the deck while pairing. Empty until a paired deck connects.
        public string Name { get; set; } = "";
        /// The device's model (e.g. "Pixel 7"), only used to tell new decks apart before they are named.
        public string Model { get; set; } = "";
        // diagnostics for the device card
        public string Mode { get; set; } = "auto";
        public string AdbPath { get; set; } = "";
        public string UsbState { get; set; } = "";
        public string Beacon { get; set; } = "";
        public int BeaconAge { get; set; } = -1;
        public string LastTry { get; set; } = "";
        public string LastError { get; set; } = "";
        // pairing: "" (paired or no deck) | "unpaired" | "starting" | "code" | "wait-deck" | "outdated"
        public string PairState { get; set; } = "";
        public string PairError { get; set; } = "";
        public bool DeckApproved { get; set; }
        public string DeckId { get; set; } = "";
    }

    enum Hs { Hello, Authing, Unpaired, Pairing, Authed }

    readonly object _sendLock = new();
    readonly AutoResetEvent _kick = new(false);
    TcpClient? _client;
    StreamWriter? _writer;
    string? _link;
    volatile bool _stop;
    DateTime _lastRx = DateTime.MinValue, _lastWifiTry = DateTime.MinValue, _lastAdbPoll = DateTime.MinValue;
    string? _beaconIp; DateTime _beaconAt = DateTime.MinValue;
    readonly string? _adbPath;
    string? _serial;
    int _rtt;
    string _mode = "auto";

    // handshake state for the current connection (guarded by _hsLock)
    readonly object _hsLock = new();
    readonly PairStore _store = new(Paths.Pairing);
    readonly HashSet<string> _autoPaired = new();
    Hs _hs = Hs.Hello;
    DateTime _attachedAt;
    string _deckId = "", _nK = "", _nD = "";
    byte[]? _key, _sess;
    long _sendN, _recvN;
    ECDiffieHellman? _ecdh;
    string _pkD = "", _commit = "", _nD2 = "", _code = "";
    byte[]? _pKey;
    bool _codeOk;
    string _pendingName = "";
    int _tries;

    public string ManualIp { get; set; } = "";
    public Status Current { get; } = new();

    public event Action<Status>? StatusChanged;
    public event Action<JsonNode>? Message;
    public event Action? Connected;
    public event Action? Disconnected;

    public DeckLink()
    {
        _adbPath = FindAdb();
        Current.Adb = _adbPath != null;
        Current.AdbPath = _adbPath ?? "";
        Current.UsbState = _adbPath == null ? "adb.exe not found" : "checking…";
        new Thread(BeaconListener) { IsBackground = true, Name = "beacon" }.Start();
        new Thread(Supervisor) { IsBackground = true, Name = "deck-link" }.Start();
    }

    public bool IsConnected => _client != null && _hs == Hs.Authed;

    /// "auto" | "wifi" | "usb". Switching drops a link that doesn't match the forced mode.
    public string Mode
    {
        get => _mode;
        set
        {
            var m = value is "wifi" or "usb" ? value : "auto";
            if (m == _mode) return;
            _mode = m; Current.Mode = m;
            Log.Write("deck: mode " + m);
            if (_client != null && m != "auto" && _link != m) Drop();
            Publish(); Kick();
        }
    }

    /// Retry right now instead of waiting for the next 2 s tick.
    public void Kick() { _lastAdbPoll = DateTime.MinValue; _kick.Set(); }

    public void Reconnect() { if (_client != null) Drop(); Kick(); }

    static string? FindAdb()
    {
        var cands = new List<string>
        {
            Path.Combine(AppContext.BaseDirectory, "adb", "adb.exe"),
            Path.Combine(AppContext.BaseDirectory, "adb.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Android", "Sdk", "platform-tools", "adb.exe"),
        };
        var home = Environment.GetEnvironmentVariable("ANDROID_HOME") ?? Environment.GetEnvironmentVariable("ANDROID_SDK_ROOT");
        if (!string.IsNullOrEmpty(home)) cands.Add(Path.Combine(home, "platform-tools", "adb.exe"));
        foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';')) try { cands.Add(Path.Combine(dir.Trim(), "adb.exe")); } catch { }
        return cands.FirstOrDefault(File.Exists);
    }

    void BeaconListener()
    {
        while (!_stop)
        {
            try
            {
                using var udp = new UdpClient();
                udp.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
                udp.Client.Bind(new IPEndPoint(IPAddress.Any, BeaconPort));
                while (!_stop)
                {
                    var ep = new IPEndPoint(IPAddress.Any, 0);
                    var data = udp.Receive(ref ep);
                    var msg = Encoding.UTF8.GetString(data);
                    if (!msg.StartsWith("DECKWELL1") && !msg.StartsWith("LABDECK1")) continue; // LABDECK1 = pre-rename deck builds
                    bool first = _beaconIp == null;
                    _beaconIp = ep.Address.ToString(); _beaconAt = DateTime.UtcNow;
                    if (first) { Log.Write("deck: beacon from " + _beaconIp); Kick(); }
                }
            }
            catch (Exception e) { Log.Write("beacon: " + e.Message); Current.LastError = "UDP 8766: " + e.Message; Thread.Sleep(3000); }
        }
    }

    void Supervisor()
    {
        while (!_stop)
        {
            try
            {
                if (_adbPath != null && DateTime.UtcNow - _lastAdbPoll > TimeSpan.FromSeconds(4)) { _lastAdbPoll = DateTime.UtcNow; PollAdb(); }
                Current.Beacon = _beaconIp ?? "";
                Current.BeaconAge = _beaconIp == null ? -1 : (int)(DateTime.UtcNow - _beaconAt).TotalSeconds;

                if (_client == null) TryConnect();
                else if (_hs != Hs.Authed)
                {
                    // A deck that never answers the handshake gets dropped. Pairing and "not paired" wait for the user.
                    if (_hs is Hs.Hello or Hs.Authing && DateTime.UtcNow - _attachedAt > TimeSpan.FromSeconds(10)) { Current.LastError = "no answer to the handshake"; Drop(); continue; }
                }
                else
                {
                    if (DateTime.UtcNow - _lastRx > TimeSpan.FromSeconds(7)) { Log.Write("deck: heartbeat lost"); Current.LastError = "heartbeat lost"; Drop(); continue; }
                    Send(new JsonObject { ["t"] = "ping", ["ts"] = Now(), ["rtt"] = _rtt, ["link"] = _link });
                    // In auto mode, move USB -> Wi-Fi when the deck shows up on the network.
                    if (_mode == "auto" && _link == "usb" && WifiCandidate() is string ip && DateTime.UtcNow - _lastWifiTry > TimeSpan.FromSeconds(15))
                    {
                        _lastWifiTry = DateTime.UtcNow;
                        var (c, _) = Dial(ip, DeckPort, 1200);
                        if (c != null) { Drop(silent: true); Attach(c, "wifi", ip); }
                    }
                }
                Publish();
            }
            catch (Exception e) { Log.Write("supervisor: " + e.Message); }
            _kick.WaitOne(2000);
        }
    }

    string? WifiCandidate()
    {
        if (!string.IsNullOrWhiteSpace(ManualIp)) return ManualIp.Trim();
        if (_beaconIp != null && DateTime.UtcNow - _beaconAt < TimeSpan.FromSeconds(15)) return _beaconIp;
        return null;
    }

    void TryConnect()
    {
        if (_mode != "usb")
        {
            var ip = WifiCandidate() ?? _beaconIp;
            if (ip != null)
            {
                Current.LastTry = $"Wi-Fi {ip}:{DeckPort}";
                var (c, err) = Dial(ip, DeckPort, 1500);
                if (c != null) { Attach(c, "wifi", ip); return; }
                Current.LastError = err;
            }
            else if (_mode == "wifi") { Current.LastTry = "Wi-Fi"; Current.LastError = "no beacon heard and no Deck IP set"; }
        }
        if (_mode != "wifi")
        {
            if (_adbPath == null) { if (_mode == "usb") { Current.LastTry = "USB"; Current.LastError = "adb.exe not found"; } return; }
            if (_serial == null) { if (_mode == "usb") { Current.LastTry = "USB"; Current.LastError = Current.UsbState; } return; }
            var fwd = Adb($"-s {_serial} forward tcp:{UsbLocalPort} tcp:{DeckPort}");
            if (fwd.Contains("error", StringComparison.OrdinalIgnoreCase)) { Current.LastTry = "USB adb forward"; Current.LastError = fwd.Trim(); return; }
            Current.LastTry = $"USB 127.0.0.1:{UsbLocalPort} → deck :{DeckPort}";
            var (c, err) = Dial("127.0.0.1", UsbLocalPort, 1500);
            if (c != null) { Attach(c, "usb", Current.Ip); return; }
            Current.LastError = err.Length > 0 ? err + " (is Deckwell open on the deck?)" : "no answer (is Deckwell open on the deck?)";
        }
    }

    static (TcpClient?, string) Dial(string host, int port, int timeoutMs)
    {
        var c = new TcpClient { NoDelay = true };
        try
        {
            var t = c.ConnectAsync(host, port);
            if (!t.Wait(timeoutMs)) { c.Dispose(); return (null, "timed out"); }
            if (!c.Connected) { c.Dispose(); return (null, "not connected"); }
            return (c, "");
        }
        catch (Exception e)
        {
            c.Dispose();
            var inner = e is AggregateException ae && ae.InnerException != null ? ae.InnerException : e;
            return (null, inner is SocketException se ? se.SocketErrorCode switch
            {
                SocketError.ConnectionRefused => "connection refused",
                SocketError.HostUnreachable or SocketError.NetworkUnreachable => "host unreachable",
                SocketError.TimedOut => "timed out",
                _ => se.SocketErrorCode.ToString(),
            } : inner.Message);
        }
    }

    void Attach(TcpClient c, string link, string ip)
    {
        lock (_sendLock)
        {
            _client = c; _link = link;
            _writer = new StreamWriter(c.GetStream(), new UTF8Encoding(false)) { AutoFlush = false, NewLine = "\n" };
        }
        _lastRx = DateTime.UtcNow; _attachedAt = DateTime.UtcNow;
        lock (_hsLock) { _hs = Hs.Hello; _sess = null; _sendN = 0; _recvN = 0; ResetPairing(); }
        Current.Link = link; Current.LastError = ""; if (link == "wifi") Current.Ip = ip;
        Log.Write($"deck: link up via {link} {ip}, waiting for hello");
        new Thread(() => Reader(c)) { IsBackground = true, Name = "deck-rx" }.Start();
        Publish();
    }

    void Reader(TcpClient c)
    {
        try
        {
            using var r = new StreamReader(c.GetStream(), Encoding.UTF8);
            string? line;
            while (!_stop && (line = r.ReadLine()) != null)
            {
                JsonNode? m; try { m = JsonNode.Parse(line); } catch { continue; }
                if (m == null) continue;
                if (_hs != Hs.Authed) { Handshake(m); continue; }
                var inner = Open(m);
                if (inner == null) { Log.Write("deck: bad signature, hanging up"); Current.LastError = "bad signature from the deck"; break; }
                _lastRx = DateTime.UtcNow;
                if (Json.S(inner, "t") == "pong") { _rtt = (int)Math.Max(1, Now() - (long)Json.D(inner, "ts")); Current.Rtt = _rtt; Publish(); continue; }
                Message?.Invoke(inner);
            }
        }
        catch (Exception e) { if (!_stop) Log.Write("deck rx: " + e.Message); }
        if (_client == c) { if (Current.LastError.Length == 0) Current.LastError = "link closed"; Drop(); }
    }

    /* ---------------- handshake (docs/PROTOCOL.md) ---------------- */

    void Handshake(JsonNode m)
    {
        bool connected = false;
        lock (_hsLock)
        {
            try
            {
                switch (Json.S(m, "t"))
                {
                    case "hello":
                    {
                        Current.Model = Json.S(m, "model");
                        var ip = Json.S(m, "ip"); if (ip.Length > 0 && ip != "0.0.0.0") Current.Ip = ip;
                        if (Json.D(m, "proto") < 2)
                        {
                            Current.PairState = "outdated";
                            Current.LastError = "The deck app is out of date. Install the latest Deckwell app on it.";
                            Task.Run(() => Drop()); break;
                        }
                        _deckId = Json.S(m, "id"); _nK = Json.S(m, "nonce"); Current.DeckId = _deckId;
                        Current.Name = _store.NameFor(_deckId) ?? "";
                        _key = _store.KeyFor(_deckId);
                        if (_key != null) SendAuth();
                        else NotPaired();
                        break;
                    }
                    case "auth-ok":
                        if (_hs != Hs.Authing || _key == null) break;
                        if (!Crypto.Same(Json.S(m, "mac"), Crypto.AuthMac(_key, "deck", _nK, _nD)))
                        {
                            Current.LastError = "the deck failed the pairing check";
                            Task.Run(() => Drop()); break;
                        }
                        _sess = Crypto.SessionKey(_key, _nK, _nD);
                        _hs = Hs.Authed; _lastRx = DateTime.UtcNow;
                        Current.Connected = true; Current.PairState = ""; Current.PairError = ""; Current.LastError = "";
                        connected = true;
                        break;
                    case "auth-fail":
                        // The deck no longer knows this computer (reset, reinstalled, or paired elsewhere).
                        Log.Write("deck: auth refused (" + Json.S(m, "reason") + "), forgetting its key");
                        _store.Remove(_deckId); _key = null;
                        if (Json.S(m, "reason") == "bad-mac") { Task.Run(() => Drop()); break; }
                        NotPaired();
                        break;
                    case "pair-commit":
                        if (_hs != Hs.Pairing || _ecdh == null) break;
                        _commit = Json.S(m, "c");
                        _nD2 = Crypto.B64(Crypto.Random());
                        Raw(new JsonObject { ["t"] = "pair-nonce", ["n"] = _nD2 });
                        break;
                    case "pair-reveal":
                    {
                        if (_hs != Hs.Pairing || _ecdh == null || _commit.Length == 0) break;
                        var pkK = Json.S(m, "pk"); var nK2 = Json.S(m, "n");
                        if (!Crypto.Same(_commit, Crypto.Commit(Crypto.UnB64(pkK), Crypto.UnB64(nK2))))
                        {
                            PairFailed("The deck's answer didn't check out. Try pairing again.", sendCancel: true); break;
                        }
                        var t = Crypto.Transcript(_pkD, pkK, _nD2, nK2);
                        _pKey = Crypto.PairKey(Crypto.Ecdh(_ecdh, Crypto.UnB64(pkK)), t);
                        _code = Crypto.Code(t);
                        Current.PairState = "code";
                        break;
                    }
                    case "pair-approve":
                        if (_hs != Hs.Pairing || _pKey == null) break;
                        Current.DeckApproved = true;
                        if (_codeOk) SendPairDone();
                        break;
                    case "pair-ok":
                        if (_hs != Hs.Pairing || _pKey == null) break;
                        if (!Crypto.Same(Json.S(m, "mac"), Crypto.DoneMac(_pKey, "deck"))) { PairFailed("The deck's answer didn't check out. Try pairing again.", sendCancel: true); break; }
                        Current.Name = _pendingName.Length > 0 ? _pendingName : (Current.Model.Length > 0 ? Current.Model : "Deck");
                        _store.Add(_deckId, Current.Name, _pKey);
                        Log.Write($"deck: paired with {Current.Name} ({_deckId})");
                        _key = _pKey;
                        ResetPairing();
                        SendAuth();
                        break;
                    case "pair-cancel":
                        if (_hs != Hs.Pairing) break;
                        PairFailed(Json.S(m, "reason") switch
                        {
                            "user" => "Pairing was cancelled on the deck.",
                            "busy" => "The deck is pairing with another computer right now.",
                            _ => "The deck stopped pairing. Try again.",
                        }, sendCancel: false);
                        break;
                }
            }
            catch (Exception e) { Log.Write("handshake: " + e.Message); PairFailed("Something went wrong while pairing. Try again.", sendCancel: true); }
        }
        Publish();
        if (connected)
        {
            Log.Write($"deck: authenticated {Current.Name} via {_link}");
            Send(new JsonObject { ["t"] = "hello", ["link"] = _link, ["desktop"] = Environment.MachineName });
            Connected?.Invoke();
        }
    }

    void SendAuth()
    {
        _nD = Crypto.B64(Crypto.Random());
        _hs = Hs.Authing; _attachedAt = DateTime.UtcNow;
        Raw(new JsonObject { ["t"] = "auth", ["desk"] = _store.DesktopId, ["nonce"] = _nD, ["mac"] = Crypto.AuthMac(_key!, "desk", _nK, _nD) });
    }

    void NotPaired()
    {
        _hs = Hs.Unpaired;
        Current.PairState = "unpaired";
        // Start pairing by itself the first time this deck shows up; after a cancel, wait for the Pair button.
        if (_deckId.Length > 0 && _autoPaired.Add(_deckId)) BeginPairing();
    }

    void BeginPairing()
    {
        ResetPairing();
        _ecdh = Crypto.NewKeyPair();
        _pkD = Crypto.B64(Crypto.Spki(_ecdh));
        _hs = Hs.Pairing;
        Current.PairState = "starting"; Current.PairError = "";
        Raw(new JsonObject { ["t"] = "pair-start", ["desk"] = _store.DesktopId, ["dname"] = Environment.MachineName, ["pk"] = _pkD });
    }

    void SendPairDone() => Raw(new JsonObject { ["t"] = "pair-done", ["mac"] = Crypto.DoneMac(_pKey!, "desk") });

    void PairFailed(string why, bool sendCancel)
    {
        if (sendCancel) Raw(new JsonObject { ["t"] = "pair-cancel", ["reason"] = "error" });
        ResetPairing();
        _hs = Hs.Unpaired;
        Current.PairState = "unpaired"; Current.PairError = why;
    }

    void ResetPairing()
    {
        _ecdh?.Dispose(); _ecdh = null;
        _pkD = _commit = _nD2 = _code = _pendingName = ""; _pKey = null; _codeOk = false; _tries = 0;
        Current.DeckApproved = false;
    }

    /// Editor: "Pair" button. Starts (or restarts) pairing with the deck that is connected but not paired.
    public string? StartPairing()
    {
        lock (_hsLock)
        {
            if (_client == null || _deckId.Length == 0) return "No deck is connected. Open Deckwell on the deck first.";
            if (_hs == Hs.Authed) return "This deck is already paired.";
            BeginPairing();
        }
        Publish();
        return null;
    }

    /// Editor: the user typed the code shown on the deck. Returns an error message, or null when it matched.
    public string? SubmitCode(string typed, string name)
    {
        string? err = null;
        name = (name ?? "").Trim();
        if (name.Length > 40) name = name[..40];
        lock (_hsLock)
        {
            var digits = new string((typed ?? "").Where(char.IsDigit).ToArray());
            if (name.Length == 0) err = "Give the deck a name first.";
            else if (_hs != Hs.Pairing || _code.Length == 0) err = "Pairing isn't ready yet. Wait for the code to show on the deck.";
            else if (Crypto.Same(digits, _code))
            {
                _codeOk = true; Current.PairError = ""; _pendingName = name;
                if (Current.DeckApproved) SendPairDone(); else Current.PairState = "wait-deck";
            }
            else if (++_tries >= 3) { PairFailed("Too many wrong codes. Start pairing again.", sendCancel: true); err = Current.PairError; }
            else err = "That code doesn't match the deck. Check it and try again.";
        }
        Publish();
        return err;
    }

    /// Editor: Cancel while pairing.
    public void CancelPairing()
    {
        lock (_hsLock)
        {
            if (_hs != Hs.Pairing) return;
            Raw(new JsonObject { ["t"] = "pair-cancel", ["reason"] = "user" });
            ResetPairing(); _hs = Hs.Unpaired;
            Current.PairState = "unpaired"; Current.PairError = "";
        }
        Publish();
    }

    /// Editor: rename the connected, paired deck.
    public string? Rename(string name)
    {
        name = (name ?? "").Trim();
        if (name.Length == 0) return "The name can't be empty.";
        if (name.Length > 40) name = name[..40];
        var id = Current.DeckId;
        if (id.Length == 0 || !_store.Rename(id, name)) return "Pair a deck before renaming it.";
        Current.Name = name;
        Publish();
        return null;
    }

    /// Editor: "Forget this deck". It will have to pair again to connect.
    public void Forget()
    {
        var id = Current.DeckId;
        if (id.Length > 0) { _store.Remove(id); _autoPaired.Add(id); Log.Write("deck: forgot " + id); }
        Current.Name = "";
        Drop();
    }

    /// Checks a signed envelope from the deck and returns the inner message, or null if forged or replayed.
    JsonNode? Open(JsonNode m)
    {
        if (Json.S(m, "t") != "s" || _sess == null) return null;
        long n = (long)Json.D(m, "n", -1); var p = Json.S(m, "p"); var h = Json.S(m, "h");
        if (n <= _recvN || !Crypto.Same(h, Crypto.EnvMac(_sess, "k2d", n, p))) return null;
        _recvN = n;
        try { return JsonNode.Parse(p); } catch { return null; }
    }

    /// Unsigned write, for handshake messages only.
    void Raw(JsonNode msg)
    {
        lock (_sendLock)
        {
            if (_writer == null) return;
            try { _writer.WriteLine(msg.ToJsonString()); _writer.Flush(); }
            catch (Exception e) { Log.Write("deck tx: " + e.Message); }
        }
    }

    void Drop(bool silent = false)
    {
        TcpClient? c;
        lock (_sendLock) { c = _client; _client = null; _writer = null; _link = null; }
        try { c?.Close(); } catch { }
        bool wasAuthed;
        lock (_hsLock)
        {
            wasAuthed = _hs == Hs.Authed;
            _hs = Hs.Hello; _sess = null; ResetPairing();
            if (Current.PairState != "outdated") Current.PairState = "";
        }
        if (silent) return;
        Current.Connected = false; Current.Link = null; Current.Rtt = 0;
        if (!wasAuthed) { Publish(); return; }
        Publish();
        Disconnected?.Invoke();
    }

    /// Signed send to the deck. Returns false (and sends nothing) until the deck has passed auth.
    public bool Send(JsonNode msg)
    {
        lock (_sendLock)
        {
            var sess = _sess;
            if (_writer == null || _hs != Hs.Authed || sess == null) return false;
            try
            {
                var p = msg.ToJsonString();
                var n = ++_sendN;
                _writer.WriteLine(new JsonObject { ["t"] = "s", ["n"] = n, ["p"] = p, ["h"] = Crypto.EnvMac(sess, "d2k", n, p) }.ToJsonString());
                _writer.Flush(); return true;
            }
            catch (Exception e) { Log.Write("deck tx: " + e.Message); }
        }
        Task.Run(() => Drop());
        return false;
    }

    void Publish() => StatusChanged?.Invoke(Current);
    static long Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    /// `adb devices -l`: prefer a Kindle Fire (model KF*) if several devices are attached.
    void PollAdb()
    {
        var o = Adb("devices -l");
        var rows = o.Split('\n').Skip(1).Select(l => l.Trim()).Where(l => l.Length > 0 && !l.StartsWith("*"))
            .Select(l => l.Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries)).Where(p => p.Length >= 2).ToList();
        var ready = rows.Where(p => p[1] == "device").ToList();
        var pick = ready.FirstOrDefault(p => p.Any(x => x.StartsWith("model:KF", StringComparison.OrdinalIgnoreCase))) ?? ready.FirstOrDefault();
        _serial = pick?[0];
        string state;
        if (pick != null) { var model = pick.FirstOrDefault(x => x.StartsWith("model:"))?[6..] ?? pick[0]; state = $"{model} ready"; }
        else if (rows.Any(p => p[1] == "unauthorized")) state = "unauthorized: tap Allow on the deck device";
        else if (rows.Any(p => p[1] == "offline")) state = "offline: replug the cable";
        else if (o.Length == 0) state = "adb didn't answer";
        else state = "no device (USB debugging on? USB driver installed?)";
        Current.Usb = pick != null;
        Current.UsbState = state;
    }

    string Adb(string args)
    {
        try
        {
            var psi = new ProcessStartInfo(_adbPath!, args) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            using var p = Process.Start(psi)!;
            var o = p.StandardOutput.ReadToEnd() + p.StandardError.ReadToEnd();
            p.WaitForExit(8000);
            return o;
        }
        catch (Exception e) { Log.Write("adb: " + e.Message); return ""; }
    }

    public void Dispose()
    {
        _stop = true;
        _kick.Set();
        Drop(silent: true);
    }
}
