using System.Text.Json.Nodes;

namespace Deckwell;

/// Where a window goes for each snap spot. Platform-neutral so it can be unit tested.
/// The deck draws the same fractions in its window picker (WinPick.SPOTS in Model.kt). See docs/PROTOCOL.md.
public static class SnapSpots
{
    public readonly record struct Frac(double X, double Y, double W, double H);
    public readonly record struct Box(int X, int Y, int W, int H);

    /// Built-in spots in the order the deck and editor list them.
    public static readonly (string Id, string Name, Frac F)[] All =
    {
        ("max", "Maximize", new(0, 0, 1, 1)),
        ("left", "Left half", new(0, 0, 0.5, 1)), ("right", "Right half", new(0.5, 0, 0.5, 1)),
        ("top", "Top half", new(0, 0, 1, 0.5)), ("bottom", "Bottom half", new(0, 0.5, 1, 0.5)),
        ("third-l", "Left third", new(0, 0, 1 / 3.0, 1)), ("third-c", "Middle third", new(1 / 3.0, 0, 1 / 3.0, 1)), ("third-r", "Right third", new(2 / 3.0, 0, 1 / 3.0, 1)),
        ("two-l", "Left two-thirds", new(0, 0, 2 / 3.0, 1)), ("two-r", "Right two-thirds", new(1 / 3.0, 0, 2 / 3.0, 1)),
        ("tl", "Top left", new(0, 0, 0.5, 0.5)), ("tr", "Top right", new(0.5, 0, 0.5, 0.5)),
        ("bl", "Bottom left", new(0, 0.5, 0.5, 0.5)), ("br", "Bottom right", new(0.5, 0.5, 0.5, 0.5)),
        ("center", "Center", new(0.15, 0.1, 0.7, 0.8)),
    };

    /// The part of the screen for a spot: a built-in id, or "zone:&lt;id&gt;" for one of the monitor's custom zones.
    /// Null if the spot is unknown (a deleted zone, a typo).
    public static Frac? Find(string spot, IEnumerable<JsonNode>? zones)
    {
        foreach (var s in All) if (s.Id == spot) return s.F;
        if (spot.StartsWith("zone:") && zones != null)
        {
            var id = spot[5..];
            foreach (var z in zones)
                if (Str(z, "id") == id) return Clamp(new Frac(Num(z, "x"), Num(z, "y"), Num(z, "w", 1), Num(z, "h", 1)));
        }
        return null;
    }

    /// Name shown for a spot ("Left half", or the zone's own name).
    public static string Name(string spot, IEnumerable<JsonNode>? zones)
    {
        foreach (var s in All) if (s.Id == spot) return s.Name;
        if (spot.StartsWith("zone:") && zones != null)
            foreach (var z in zones) if (Str(z, "id") == spot[5..]) return Str(z, "name") is { Length: > 0 } n ? n : "Zone";
        return spot;
    }

    /// A zone drawn in the editor, kept inside the screen and at least 5% in each direction.
    public static Frac Clamp(Frac f)
    {
        double x = Math.Clamp(f.X, 0, 0.95), y = Math.Clamp(f.Y, 0, 0.95);
        double w = Math.Clamp(f.W, 0.05, 1 - x), h = Math.Clamp(f.H, 0.05, 1 - y);
        return new Frac(x, y, w, h);
    }

    /// Pixel box for a spot on a monitor's work area (the screen minus the taskbar). Edges are rounded so
    /// neighbouring spots (left half + right half) meet exactly with no gap or overlap.
    public static Box Place(Box work, Frac f)
    {
        int l = work.X + (int)Math.Round(work.W * f.X), t = work.Y + (int)Math.Round(work.H * f.Y);
        int r = work.X + (int)Math.Round(work.W * (f.X + f.W)), b = work.Y + (int)Math.Round(work.H * (f.Y + f.H));
        return new Box(l, t, Math.Max(1, r - l), Math.Max(1, b - t));
    }

    /// A window's box as fractions of a work area (for saved layouts), clamped to the screen.
    public static Frac ToFrac(Box work, Box win)
    {
        if (work.W <= 0 || work.H <= 0) return new Frac(0, 0, 1, 1);
        return Clamp(new Frac((win.X - work.X) / (double)work.W, (win.Y - work.Y) / (double)work.H, win.W / (double)work.W, win.H / (double)work.H));
    }

    static string Str(JsonNode? n, string k) { try { return n?[k]?.GetValue<string>() ?? ""; } catch { return ""; } }
    static double Num(JsonNode? n, string k, double def = 0)
    {
        try { return n?[k] is JsonValue v && v.TryGetValue<double>(out var d) ? d : n?[k] is JsonValue v2 && v2.TryGetValue<int>(out var i) ? i : def; }
        catch { return def; }
    }
}
