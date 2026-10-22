using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json.Nodes;

namespace Deckwell;

/// A tiny HTTP endpoint so your own scripts can push values into status tiles.
///
///   POST http://127.0.0.1:8770/status/<feed>      body: 72%|4 cores|0.72   (or JSON)
///   GET  http://127.0.0.1:8770/status/<feed>?value=72%25&sub=4%20cores&bar=0.72
///
/// Every request needs the token from %APPDATA%\Deckwell\push-token.txt, sent as
/// "Authorization: Bearer <token>", "X-Deckwell-Token: <token>", or ?token=<token>.
/// It only listens on this computer (127.0.0.1), never on your network. See docs/status-tiles.md.
sealed class PushServer : IDisposable
{
    public const int DefaultPort = 8770;
    const int MaxBody = 8192;

    readonly Func<string, string, int> _onPush; // (feed, text) -> tiles updated
    readonly TcpListener _listener;
    volatile bool _stop;

    public int Port { get; }
    public string Token { get; }
    public string? Error { get; private set; }

    public PushServer(string tokenPath, Func<string, string, int> onPush, int port = DefaultPort)
    {
        _onPush = onPush;
        Port = port;
        Token = LoadToken(tokenPath);
        _listener = new TcpListener(IPAddress.Loopback, port);
        try
        {
            _listener.Start();
            new Thread(AcceptLoop) { IsBackground = true, Name = "push" }.Start();
        }
        catch (Exception e) { Error = $"Port {port} is busy: {e.Message}"; Log.Write("push: " + Error); }
    }

    static string LoadToken(string path)
    {
        try
        {
            if (File.Exists(path)) { var t = File.ReadAllText(path).Trim(); if (t.Length >= 16) return t; }
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var tok = Crypto.Hex(Crypto.Random(16));
            File.WriteAllText(path, tok);
            return tok;
        }
        catch (Exception e) { Log.Write("push token: " + e.Message); return Crypto.Hex(Crypto.Random(16)); }
    }

    void AcceptLoop()
    {
        while (!_stop)
        {
            TcpClient c;
            try { c = _listener.AcceptTcpClient(); } catch { if (_stop) return; Thread.Sleep(200); continue; }
            ThreadPool.QueueUserWorkItem(_ => { using (c) { try { Handle(c); } catch (Exception e) { Log.Write("push: " + e.Message); } } });
        }
    }

    void Handle(TcpClient c)
    {
        c.ReceiveTimeout = 5000; c.SendTimeout = 5000;
        var s = c.GetStream();
        var (status, body) = Respond(ReadRequest(s));
        var bytes = Encoding.UTF8.GetBytes(body);
        var head = $"HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {bytes.Length}\r\nConnection: close\r\n\r\n";
        s.Write(Encoding.ASCII.GetBytes(head));
        s.Write(bytes);
    }

    public sealed record Request(string Method, string Path, Dictionary<string, string> Query, Dictionary<string, string> Headers, string Body);

    /// Reads one HTTP/1.1 request. Returns null for anything malformed or too big.
    static Request? ReadRequest(Stream s)
    {
        var buf = new List<byte>();
        int headEnd = -1;
        var one = new byte[1];
        while (headEnd < 0)
        {
            if (s.Read(one, 0, 1) <= 0 || buf.Count > 8192) return null;
            buf.Add(one[0]);
            int n = buf.Count;
            if (n >= 4 && buf[n - 4] == '\r' && buf[n - 3] == '\n' && buf[n - 2] == '\r' && buf[n - 1] == '\n') headEnd = n;
        }
        var lines = Encoding.ASCII.GetString(buf.ToArray()).Split("\r\n");
        var first = lines[0].Split(' ');
        if (first.Length < 2) return null;
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var l in lines.Skip(1)) { var i = l.IndexOf(':'); if (i > 0) headers[l[..i].Trim()] = l[(i + 1)..].Trim(); }
        int len = headers.TryGetValue("Content-Length", out var cl) && int.TryParse(cl, out var v) ? v : 0;
        if (len < 0 || len > MaxBody) return null;
        var body = new byte[len]; int got = 0;
        while (got < len) { int r = s.Read(body, got, len - got); if (r <= 0) break; got += r; }
        var target = first[1]; var q = target.IndexOf('?');
        var path = Uri.UnescapeDataString(q >= 0 ? target[..q] : target);
        var query = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (q >= 0)
            foreach (var kv in target[(q + 1)..].Split('&', StringSplitOptions.RemoveEmptyEntries))
            {
                var e = kv.IndexOf('=');
                string Un(string x) => Uri.UnescapeDataString(x.Replace('+', ' '));
                if (e > 0) query[Un(kv[..e])] = Un(kv[(e + 1)..]); else query[Un(kv)] = "";
            }
        return new Request(first[0].ToUpperInvariant(), path, query, headers, Encoding.UTF8.GetString(body, 0, got));
    }

    /// Decides the reply. Public so tests can drive it without a socket.
    public (string Status, string Body) Respond(Request? r)
    {
        static string J(object o) => System.Text.Json.JsonSerializer.Serialize(o);
        if (r == null) return ("400 Bad Request", J(new { ok = false, error = "bad request" }));
        if (r.Path == "/health") return ("200 OK", J(new { ok = true, app = "deckwell" }));
        if (!r.Path.StartsWith("/status/")) return ("404 Not Found", J(new { ok = false, error = "use /status/<feed>" }));

        string? tok = null;
        if (r.Headers.TryGetValue("Authorization", out var auth) && auth.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) tok = auth[7..].Trim();
        else if (r.Headers.TryGetValue("X-Deckwell-Token", out var xt)) tok = xt.Trim();
        else if (r.Query.TryGetValue("token", out var qt)) tok = qt;
        if (!Crypto.Same(tok, Token)) return ("401 Unauthorized", J(new { ok = false, error = "wrong or missing token" }));

        var feed = r.Path["/status/".Length..].Trim('/');
        if (feed.Length is 0 or > 40 || !feed.All(ch => char.IsLetterOrDigit(ch) || ch is '-' or '_' or '.'))
            return ("400 Bad Request", J(new { ok = false, error = "feed names use letters, numbers, - _ . (max 40)" }));

        string text;
        if (r.Method == "POST" || r.Method == "PUT") text = r.Body;
        else if (r.Method == "GET")
        {
            string Q(string k) => r.Query.TryGetValue(k, out var x) ? x.Replace("|", "/") : "";
            text = $"{Q("value")}|{Q("sub")}|{Q("bar")}|{Q("up")}";
        }
        else return ("405 Method Not Allowed", J(new { ok = false, error = "use GET or POST" }));

        int tiles = _onPush(feed, text);
        return ("200 OK", J(new { ok = true, feed, tiles }));
    }

    public void Dispose() { _stop = true; try { _listener.Stop(); } catch { } }
}
