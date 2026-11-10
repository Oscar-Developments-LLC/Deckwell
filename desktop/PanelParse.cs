using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Deckwell;

/// Turns what a panel's command prints into the lines a Panel key shows. See docs/status-tiles.md.
/// Unlike a status tile (last line only), a panel shows all of the output, top to bottom.
public static class PanelParse
{
    public const int MaxLines = 60, MaxLineChars = 120;

    static readonly Regex Ansi = new(@"\x1B(\[[0-?]*[ -/]*[@-~]|\][^\x07\x1B]*(\x07|\x1B\\)|[@-Z\\-_])", RegexOptions.Compiled);

    /// Strips terminal color codes, expands tabs, drops trailing blank lines, and keeps the first 60 lines.
    public static string Clean(string? output)
    {
        var text = Ansi.Replace(output ?? "", "").Replace("\r\n", "\n").Replace('\r', '\n');
        var lines = new List<string>();
        foreach (var raw in text.Split('\n'))
        {
            var sb = new StringBuilder();
            foreach (var ch in raw)
            {
                if (ch == '\t') { do sb.Append(' '); while (sb.Length % 4 != 0); }
                else if (!char.IsControl(ch)) sb.Append(ch);
            }
            var line = sb.ToString().TrimEnd();
            if (line.Length > MaxLineChars) line = line[..(MaxLineChars - 1)] + "…";
            lines.Add(line);
        }
        while (lines.Count > 0 && lines[^1].Length == 0) lines.RemoveAt(lines.Count - 1);
        while (lines.Count > 0 && lines[0].Length == 0) lines.RemoveAt(0);
        if (lines.Count > MaxLines) { lines = lines.Take(MaxLines - 1).ToList(); lines.Add("…"); }
        return string.Join("\n", lines);
    }

    /// What the deck and editor receive for one panel. "up" is false when the command failed.
    public static JsonObject ToMessage(string keyId, string text, bool up) =>
        new() { ["t"] = "panel", ["id"] = keyId, ["text"] = text, ["up"] = up };
}
