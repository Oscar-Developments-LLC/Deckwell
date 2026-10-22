using System.Text.Json;
using System.Text.Json.Nodes;

namespace Deckwell;

// Minimal stand-ins for the helpers in desktop/Core.cs, which also holds Windows-only code.
static class Log { public static void Write(string msg) { } }

static class Json
{
    public static string S(JsonNode? n, string key, string def = "")
    {
        try { var v = n?[key]; return v == null ? def : v.GetValueKind() == JsonValueKind.String ? v.GetValue<string>() : v.ToJsonString(); } catch { return def; }
    }
    public static double D(JsonNode? n, string key, double def = 0) { try { return n?[key] is JsonValue v ? v.GetValue<double>() : def; } catch { return def; } }
}
