using System.Text.Json.Nodes;

namespace Deckwell;

/// Converts a v1 config from the original WPF build (PascalCase: Pages/Buttons/Slot/IconBase64) into the v2 shape.
static class Migrate
{
    public static bool IsV1(JsonNode? n) => n is JsonObject o && o.ContainsKey("Pages") && !o.ContainsKey("pages");

    static string Id() => Guid.NewGuid().ToString("N")[..8];

    public static JsonObject FromV1(JsonNode v1)
    {
        var pages = new JsonArray();
        foreach (var p in Json.Arr(v1, "Pages"))
        {
            int cols = Math.Clamp((int)Json.D(p, "Columns", 5), 1, 8);
            int rows = Math.Clamp((int)Json.D(p, "Rows", 3), 1, 6);
            var buttons = Json.Arr(p, "Buttons").OrderBy(b => Json.D(b, "Slot")).ToList();
            // v1 could hold buttons past its grid; grow rows (max 6) so nothing is lost.
            int maxRow = buttons.Select(b => (int)Json.D(b, "Slot") / cols).DefaultIfEmpty(0).Max();
            rows = Math.Clamp(Math.Max(rows, maxRow + 1), 1, 6);
            var keys = new JsonArray();
            var taken = new HashSet<int>();
            var nowPlaying = new List<JsonNode>();
            foreach (var b in buttons)
            {
                if (b["ShowNowPlaying"]?.GetValue<bool>() == true) { nowPlaying.Add(b); continue; }
                int slot = (int)Json.D(b, "Slot");
                int row = slot / cols, col = slot % cols;
                if (row >= rows || !taken.Add(row * 16 + col)) continue;
                var label = Json.S(b, "Label").Split('\n')[0].Trim();
                var param = Json.S(b, "ActionParam");
                var k = new JsonObject { ["id"] = Id(), ["row"] = row, ["col"] = col, ["labelPos"] = "bottom" };
                switch ((int)Json.D(b, "Action"))
                {
                    case 3: k["type"] = "media"; k["media"] = "playpause"; break;
                    case 4: k["type"] = "media"; k["media"] = "next"; break;
                    case 5: k["type"] = "media"; k["media"] = "prev"; break;
                    default:
                        if (param.StartsWith("http", StringComparison.OrdinalIgnoreCase)) { k["type"] = "url"; k["url"] = param; }
                        else { k["type"] = "app"; k["exe"] = param; k["args"] = ""; k["ifRunning"] = "focus"; }
                        break;
                }
                k["label"] = label.Length > 0 ? label : (string)k["type"]!;
                var b64 = Json.S(b, "IconBase64");
                if (b64.Length > 100)
                {
                    try
                    {
                        var iconId = Icons.FromImageBytes(Convert.FromBase64String(b64));
                        if (iconId != null) k["icon"] = new JsonObject { ["kind"] = "image", ["id"] = iconId };
                    }
                    catch (Exception e) { Log.Write("migrate icon: " + e.Message); }
                }
                keys.Add(k);
            }
            // Now Playing needs two side-by-side keys: use its own slot if free, else the first free pair, else add a row.
            foreach (var b in nowPlaying.Take(1))
            {
                if (cols < 2) break;
                int slot = (int)Json.D(b, "Slot");
                var cands = new List<(int r, int c)> { (slot / cols, Math.Min(slot % cols, cols - 2)) };
                for (int r = 0; r < rows; r++) for (int c = 0; c + 1 < cols; c++) cands.Add((r, c));
                (int r, int c) spot = cands.Where(x => x.r < rows && !taken.Contains(x.r * 16 + x.c) && !taken.Contains(x.r * 16 + x.c + 1)).DefaultIfEmpty((-1, -1)).First();
                if (spot.r < 0 && rows < 6) { rows++; spot = (rows - 1, 0); }
                if (spot.r < 0) break;
                taken.Add(spot.r * 16 + spot.c); taken.Add(spot.r * 16 + spot.c + 1);
                keys.Add(new JsonObject { ["id"] = Id(), ["row"] = spot.r, ["col"] = spot.c, ["type"] = "nowplaying", ["label"] = "Now Playing", ["labelPos"] = "hidden" });
            }

            // v1 sliders were plain volume sliders; bring them over as Master volume in the strip.
            var strip = new JsonArray { null, null, null };
            int si = 0;
            foreach (var _ in Json.Arr(p, "Sliders").Take(3))
                strip[si++] = new JsonObject { ["id"] = Id(), ["control"] = "master", ["app"] = "", ["appLabel"] = "", ["step"] = 2, ["button"] = "mute" };

            pages.Add(new JsonObject
            {
                ["id"] = Id(), ["name"] = Json.S(p, "Name", "Page"), ["parentId"] = null, ["cols"] = cols, ["rows"] = rows,
                ["sliders"] = si > 0 ? "right" : "off", ["strip"] = strip, ["keys"] = keys,
            });
        }
        if (pages.Count == 0) throw new Exception("v1 config had no pages");
        return new JsonObject
        {
            ["version"] = 1, ["deckIp"] = "", ["linkMode"] = "auto", ["migratedFromV1"] = true,
            ["hosts"] = new JsonArray(),
            ["pages"] = pages,
        };
    }
}
