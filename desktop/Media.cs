using System.Net.Http;
using System.Text.Json.Nodes;
using Windows.Media.Control;

namespace Deckwell;

/// Now Playing via Windows' System Media Transport Controls, with an iTunes artwork fallback.
sealed class Media : IDisposable
{
    public record NowPlaying(string Title, string Artist, string Source, double Pos, double Dur, bool Playing, string? ArtId);

    GlobalSystemMediaTransportControlsSessionManager? _mgr;
    readonly CancellationTokenSource _cts = new();
    NowPlaying? _last;
    string _artKey = "";
    string? _artId;
    readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(6) };
    readonly Dictionary<string, string?> _itunesCache = new();

    public event Action<NowPlaying?>? Changed;
    public NowPlaying? Current => _last;

    public Media() { _ = Task.Run(Loop); }

    async Task Loop()
    {
        while (!_cts.IsCancellationRequested)
        {
            try { await Poll(); } catch (Exception e) { Log.Write("media: " + e.Message); _mgr = null; }
            try { await Task.Delay(1000, _cts.Token); } catch { }
        }
    }

    async Task Poll()
    {
        _mgr ??= await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
        var s = _mgr.GetCurrentSession();
        if (s == null) { Publish(null); return; }
        var props = await s.TryGetMediaPropertiesAsync();
        var tl = s.GetTimelineProperties();
        var pb = s.GetPlaybackInfo();
        bool playing = pb.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
        double dur = (tl.EndTime - tl.StartTime).TotalSeconds;
        double pos = (tl.Position - tl.StartTime).TotalSeconds;
        if (playing && tl.LastUpdatedTime.Year > 2000) pos += (DateTimeOffset.Now - tl.LastUpdatedTime).TotalSeconds;
        if (dur > 0) pos = Math.Clamp(pos, 0, dur); else { dur = 0; pos = 0; }
        var title = props?.Title ?? ""; var artist = props?.Artist ?? "";
        if (string.IsNullOrEmpty(artist)) artist = props?.AlbumArtist ?? "";

        var key = artist + "\u0001" + title;
        if (key != _artKey)
        {
            _artKey = key; _artId = null;
            try
            {
                if (props?.Thumbnail != null)
                {
                    using var ras = await props.Thumbnail.OpenReadAsync();
                    using var st = ras.AsStreamForRead();
                    using var ms = new MemoryStream(); await st.CopyToAsync(ms);
                    if (ms.Length > 0) _artId = Icons.FromArtBytes(ms.ToArray());
                }
            }
            catch (Exception e) { Log.Write("thumb: " + e.Message); }
            if (_artId == null && title.Length > 0) _artId = await ITunesArt(artist, title);
        }
        Publish(new NowPlaying(title, artist, SourceName(s.SourceAppUserModelId), Math.Round(pos), Math.Round(dur), playing, _artId));
    }

    async Task<string?> ITunesArt(string artist, string title)
    {
        var q = (artist + " " + title).Trim();
        if (_itunesCache.TryGetValue(q, out var c)) return c;
        string? id = null;
        try
        {
            var json = await _http.GetStringAsync("https://itunes.apple.com/search?entity=song&limit=1&term=" + Uri.EscapeDataString(q));
            var results = JsonNode.Parse(json)?["results"] as JsonArray;
            var url = results is { Count: > 0 } ? results[0]?["artworkUrl100"]?.GetValue<string>() : null;
            if (url != null) id = Icons.FromArtBytes(await _http.GetByteArrayAsync(url.Replace("100x100", "512x512")));
        }
        catch (Exception e) { Log.Write("itunes: " + e.Message); }
        _itunesCache[q] = id;
        return id;
    }

    void Publish(NowPlaying? np)
    {
        if (Equals(np, _last)) return;
        _last = np; Changed?.Invoke(np);
    }

    static string SourceName(string? aumid)
    {
        if (string.IsNullOrEmpty(aumid)) return "";
        var a = aumid.ToLowerInvariant();
        if (a.Contains("spotify")) return "Spotify";
        if (a.Contains("chrome")) return "Chrome";
        if (a.Contains("msedge") || a.Contains("microsoftedge")) return "Edge";
        if (a.Contains("firefox")) return "Firefox";
        if (a.Contains("zunemusic")) return "Media Player";
        if (a.Contains("applemusic") || a.Contains("itunes")) return "Apple Music";
        if (a.Contains("vlc")) return "VLC";
        if (a.Contains("discord")) return "Discord";
        var s = aumid.Contains('!') ? aumid[(aumid.LastIndexOf('!') + 1)..] : aumid;
        s = s.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? s[..^4] : s;
        s = s.Split('\\', '/').Last();
        s = s.Contains('.') ? s[(s.LastIndexOf('.') + 1)..] : s;
        return Audio.Pretty(s);
    }

    public async Task TogglePlayPause()
    {
        try
        {
            _mgr ??= await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
            var s = _mgr.GetCurrentSession();
            if (s != null) await s.TryTogglePlayPauseAsync(); else Input.Tap(new ushort[] { Input.VK_MEDIA_PLAY_PAUSE });
        }
        catch { Input.Tap(new ushort[] { Input.VK_MEDIA_PLAY_PAUSE }); }
    }

    public void Dispose() { _cts.Cancel(); _http.Dispose(); }
}
