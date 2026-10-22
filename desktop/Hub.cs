using System.Text.Json.Nodes;

namespace Deckwell;

/// Owns the config and wires the editor, the deck link, and the services together.
sealed class Hub : IDisposable
{
    public readonly DeckLink Deck = new();
    public readonly Audio Audio = new();
    public readonly Media Media = new();
    public readonly Actions Actions;
    public readonly StatusFeeds Feeds;
    public readonly PushServer Push;
    readonly Action<string, object?> _toUi;
    JsonNode? _config;
    readonly object _cfgLock = new();

    public Hub(Action<string, object?> toUi)
    {
        _toUi = toUi;
        Actions = new Actions(Audio, Media);
        _config = LoadConfig();
        if (_config != null) Apply(_config);
        Feeds = new StatusFeeds(() => Config);
        Feeds.Updated += (_, msg) => { _toUi("status", msg); Deck.Send(msg.DeepClone()); };
        Push = new PushServer(Paths.PushToken, Feeds.Push);

        Deck.StatusChanged += s => _toUi("device", s);
        Deck.Connected += PushAll;
        Deck.Disconnected += () => Actions.ReleaseAll(_config);
        Deck.Message += OnDeckMessage;
        Audio.SlidersChanged += ch =>
        {
            var obj = new JsonObject();
            foreach (var (id, st) in ch) obj[id] = new JsonObject { ["value"] = st.Value, ["enabled"] = st.Enabled, ["muted"] = st.Muted };
            _toUi("sliders", obj);
            Deck.Send(new JsonObject { ["t"] = "sliders", ["v"] = obj.DeepClone() });
        };
        Audio.SessionsChanged += list => _toUi("sessions", list.Select(s => new { name = s.Name, label = s.Label }).ToList());
        Media.Changed += np => { _toUi("np", NpForUi(np)); Deck.Send(NpForDeck(np)); };
    }

    public JsonNode? Config { get { lock (_cfgLock) return _config; } }

    static JsonNode? LoadConfig()
    {
        JsonNode? cfg;
        try { cfg = File.Exists(Paths.Config) ? JsonNode.Parse(File.ReadAllText(Paths.Config)) : null; }
        catch (Exception e)
        {
            Log.Write("config load: " + e.Message);
            Backup(".broken-" + DateTime.Now.ToString("yyyyMMdd-HHmmss"));
            return null;
        }
        if (Migrate.IsV1(cfg))
        {
            Backup(".v1.json", keepExisting: true);
            try
            {
                var v2 = Migrate.FromV1(cfg!);
                File.WriteAllText(Paths.Config, v2.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
                Log.Write($"config: migrated v1 -> v2 ({Json.Arr(v2, "pages").Count()} pages)");
                return v2;
            }
            catch (Exception e) { Log.Write("config migrate failed: " + e); return null; }
        }
        if (cfg is not JsonObject || cfg["pages"] is not JsonArray arr || arr.Count == 0)
        {
            if (cfg != null) { Log.Write("config: unrecognized shape, starting fresh"); Backup(".unknown-" + DateTime.Now.ToString("yyyyMMdd-HHmmss")); }
            return null;
        }
        return cfg;
    }

    static void Backup(string suffix, bool keepExisting = false)
    {
        try
        {
            var dest = Paths.Config.Replace(".json", "") + suffix;
            if (!dest.EndsWith(".json")) dest += ".json";
            if (keepExisting && File.Exists(dest)) return;
            File.Copy(Paths.Config, dest, true);
        }
        catch (Exception e) { Log.Write("config backup: " + e.Message); }
    }

    public void SaveConfig(JsonNode cfg)
    {
        lock (_cfgLock) _config = cfg;
        var tmp = Paths.Config + ".tmp";
        File.WriteAllText(tmp, cfg.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
        File.Move(tmp, Paths.Config, true);
        Apply(cfg);
        PushLayout();
        Feeds.ConfigChanged();
    }

    void Apply(JsonNode cfg)
    {
        Deck.ManualIp = Json.S(cfg, "deckIp");
        Deck.Mode = Json.S(cfg, "linkMode", "auto");
        Audio.SetSliders(cfg);
    }

    /* ---------- editor-facing ---------- */
    public object? NpForUi(Media.NowPlaying? np) => np == null ? null : new
    {
        title = np.Title, artist = np.Artist, source = np.Source, pos = np.Pos, dur = np.Dur, playing = np.Playing,
        art = np.ArtId == null ? null : $"https://app.deckwell/icons/{np.ArtId}.png",
    };

    public JsonObject SlidersSnapshot()
    {
        var obj = new JsonObject();
        foreach (var (id, st) in Audio.Snapshot()) obj[id] = new JsonObject { ["value"] = st.Value, ["enabled"] = st.Enabled, ["muted"] = st.Muted };
        return obj;
    }

    /* ---------- deck-facing ---------- */
    static JsonObject NpForDeck(Media.NowPlaying? np) => np == null
        ? new JsonObject { ["t"] = "np", ["none"] = true }
        : new JsonObject { ["t"] = "np", ["title"] = np.Title, ["artist"] = np.Artist, ["source"] = np.Source, ["pos"] = np.Pos, ["dur"] = np.Dur, ["playing"] = np.Playing, ["art"] = np.ArtId };

    void PushAll()
    {
        PushLayout();
        Deck.Send(NpForDeck(Media.Current));
        Deck.Send(new JsonObject { ["t"] = "sliders", ["v"] = SlidersSnapshot() });
        foreach (var st in Feeds.Snapshot()) Deck.Send(st);
    }

    void PushLayout()
    {
        var cfg = Config; if (cfg == null) return;
        var pages = new JsonArray();
        foreach (var p in Json.Arr(cfg, "pages"))
        {
            var keys = new JsonArray();
            foreach (var k in Json.Arr(p, "keys"))
            {
                var type = Json.S(k, "type");
                var face = k["face"];
                var o = new JsonObject
                {
                    ["id"] = Json.S(k, "id"), ["row"] = (int)Json.D(k, "row"), ["col"] = (int)Json.D(k, "col"),
                    ["span"] = type == "nowplaying" ? 2 : 1,
                    ["kind"] = type == "nowplaying" ? "np" : type == "status" ? "status" : "key",
                    ["label"] = Json.S(k, "label"), ["labelPos"] = Json.S(k, "labelPos", "bottom"),
                };
                if (face?["glyph"] is JsonNode g && g.GetValueKind() == System.Text.Json.JsonValueKind.String) o["glyph"] = g.GetValue<string>();
                if (face?["sub"] is JsonNode sb && sb.GetValueKind() == System.Text.Json.JsonValueKind.String) o["sub"] = sb.GetValue<string>();
                if (face?["mono"] is JsonNode mn && mn.GetValueKind() == System.Text.Json.JsonValueKind.String) o["mono"] = mn.GetValue<string>();
                if (face?["caps"] is JsonArray caps) o["caps"] = caps.DeepClone();
                var icon = k["icon"]?["id"]; if (icon != null) o["icon"] = icon.GetValue<string>();
                if (type is "folder" or "goto")
                {
                    o["nav"] = Json.S(k, "target");
                    if (Json.Arr(k, "steps").Any()) o["fire"] = true; // deck also reports the press so the extra steps run
                }
                else
                {
                    var go = Json.S(k, "goPage");
                    if (go.Length > 0 && Json.Arr(cfg, "pages").Any(x => Json.S(x, "id") == go)) o["go"] = go;
                }
                if (type == "hotkey" && Json.S(k, "sendAs") == "hold") o["hold"] = true;
                if (type == "status") { o["title"] = Json.S(k, "title", Json.S(k, "label")); o["show"] = Json.S(k, "show", "valuebar"); }
                keys.Add(o);
            }
            var strip = new JsonArray();
            var side = Json.S(p, "sliders");
            if (side is "right" or "left")
                foreach (var s in (p["strip"] as JsonArray ?? new JsonArray()).Take(6))
                    strip.Add(s == null ? null : new JsonObject
                    {
                        ["id"] = Json.S(s, "id"), ["control"] = Json.S(s, "control", "master"), ["button"] = Json.S(s, "button", "mute"),
                        ["label"] = Json.S(s, "control") switch { "master" => "Master", "mic" => "Mic", _ => Json.S(s, "appLabel", Json.S(s, "app", "App")) },
                        ["step"] = Json.D(s, "step", 2),
                    });
            pages.Add(new JsonObject
            {
                ["id"] = Json.S(p, "id"), ["name"] = Json.S(p, "name"), ["parent"] = p["parentId"]?.GetValue<string>(),
                ["cols"] = (int)Json.D(p, "cols", 5), ["rows"] = (int)Json.D(p, "rows", 3), ["keys"] = keys, ["strip"] = strip,
                ["side"] = side == "left" ? "left" : "right",
            });
        }
        var ok = Deck.Send(new JsonObject { ["t"] = "layout", ["pages"] = pages });
        _toUi("synced", new { deck = ok });
    }

    JsonNode? FindKey(string id)
    {
        foreach (var p in Json.Arr(Config, "pages")) foreach (var k in Json.Arr(p, "keys")) if (Json.S(k, "id") == id) return k;
        return null;
    }

    void OnDeckMessage(JsonNode m)
    {
        switch (Json.S(m, "t"))
        {
            case "down":
            {
                var k = FindKey(Json.S(m, "key")); if (k == null) return;
                _ = Task.Run(async () =>
                {
                    var r = await Actions.Press(k, Config!);
                    if (r != null) Feedback(k, r);
                });
                break;
            }
            case "up": { var k = FindKey(Json.S(m, "key")); if (k != null) Actions.Release(k); break; }
            case "set": Audio.Set(Json.S(m, "id"), Json.D(m, "value")); break;
            case "sbtn": Audio.ToggleMute(Json.S(m, "id")); break;
            case "need":
                foreach (var idNode in (m["ids"] as JsonArray ?? new JsonArray()))
                {
                    var id = idNode?.GetValue<string>(); if (id == null) continue;
                    var bytes = Icons.Read(id);
                    Deck.Send(bytes == null ? new JsonObject { ["t"] = "icon", ["id"] = id, ["missing"] = true } : new JsonObject { ["t"] = "icon", ["id"] = id, ["png"] = Convert.ToBase64String(bytes) });
                }
                break;
        }
    }

    public void Feedback(JsonNode key, KeyResult r)
    {
        var type = Json.S(key, "type");
        if (type is "ssh" or "script" || !r.Ok)
            Deck.Send(new JsonObject { ["t"] = "fb", ["key"] = Json.S(key, "id"), ["ok"] = r.Ok, ["ring"] = r.Ring, ["badge"] = r.Badge, ["line"] = r.Line, ["toast"] = r.Toast });
        if (r.LastRun != null || type is "ssh" or "script")
            _toUi("keyResult", new { id = Json.S(key, "id"), ok = r.Ok, text = r.Text, lastRun = r.LastRun });
    }

    public void Dispose() { Deck.Dispose(); Audio.Dispose(); Media.Dispose(); Feeds.Dispose(); Push.Dispose(); }
}
