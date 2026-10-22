using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Deckwell;

/// Turns what a status script prints into what a status tile shows. See docs/status-tiles.md.
///
/// The last non-empty line of output is used. It is either
///   value|subtitle|bar|up        e.g.  72%|4 cores|0.72      or  online|nginx|  |up
/// or a JSON object
///   {"value":"72%","sub":"4 cores","bar":0.72,"up":true}
/// Every part after the value is optional. bar is 0-1, or 0-100, or "72%".
/// When the value itself looks like "72%" and there is no bar, the bar follows the value.
/// When up isn't given, it is true if the command exited with 0.
public static class StatusParse
{
    public sealed record Reading(string? Value, string? Sub, double? Bar, bool Up);

    public static Reading Parse(string? output, int exitCode)
    {
        var line = (output ?? "").Split('\n').Select(l => l.Trim()).LastOrDefault(l => l.Length > 0) ?? "";
        bool exitUp = exitCode == 0;
        if (line.Length == 0) return new Reading(null, null, null, exitUp);

        string? value, sub = null, barText = null, upText = null;
        if (line.StartsWith('{'))
        {
            try
            {
                var o = JsonNode.Parse(line) as JsonObject;
                value = Text(o?["value"]); sub = Text(o?["sub"]); barText = Text(o?["bar"]); upText = Text(o?["up"]);
            }
            catch { value = line; }
        }
        else
        {
            var parts = line.Split('|');
            value = parts[0].Trim();
            if (parts.Length > 1) sub = parts[1].Trim();
            if (parts.Length > 2) barText = parts[2].Trim();
            if (parts.Length > 3) upText = parts[3].Trim();
        }

        var bar = Fraction(barText);
        if (bar == null && value != null && value.EndsWith('%')) bar = Fraction(value);
        bool up = Flag(upText) ?? exitUp;
        return new Reading(Clip(Empty(value), 24), Clip(Empty(sub), 48), bar, up);
    }

    /// "0.72" -> 0.72, "72" -> 0.72, "72%" -> 0.72. Clamped to 0..1. Null if not a number.
    public static double? Fraction(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        s = s.Trim();
        bool pct = s.EndsWith('%');
        if (pct) s = s[..^1].Trim();
        if (!double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var v) || double.IsNaN(v)) return null;
        if (pct || v > 1) v /= 100;
        return Math.Clamp(v, 0, 1);
    }

    static bool? Flag(string? s) => (s ?? "").Trim().ToLowerInvariant() switch
    {
        "up" or "ok" or "true" or "1" or "yes" or "online" or "on" => true,
        "down" or "fail" or "failed" or "false" or "0" or "no" or "offline" or "off" or "error" => false,
        _ => null,
    };

    static string? Text(JsonNode? n)
    {
        if (n == null) return null;
        return n.GetValueKind() switch
        {
            JsonValueKind.String => n.GetValue<string>(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            JsonValueKind.Null => null,
            _ => n.ToJsonString(),
        };
    }

    static string? Empty(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
    static string? Clip(string? s, int n) => s == null || s.Length <= n ? s : s[..(n - 1)] + "…";

    /// What the deck and editor receive for one tile.
    /// Missing parts are left out, not sent as null (the deck treats "bar": null as a number).
    public static JsonObject ToMessage(string keyId, Reading r)
    {
        var o = new JsonObject { ["t"] = "status", ["id"] = keyId, ["up"] = r.Up };
        if (r.Value != null) o["value"] = r.Value;
        if (r.Sub != null) o["sub"] = r.Sub;
        if (r.Bar is double b) o["bar"] = b;
        return o;
    }
}
