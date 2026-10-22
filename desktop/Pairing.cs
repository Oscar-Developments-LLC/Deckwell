using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace Deckwell;

/// Crypto for the v2 link protocol. Must match docs/PROTOCOL.md byte for byte (checked against shared/pairing-vector.json).
static class Crypto
{
    public static string B64(byte[] b) => Convert.ToBase64String(b);
    public static byte[] UnB64(string s) => Convert.FromBase64String(s);
    public static byte[] Random(int n = 16) => RandomNumberGenerator.GetBytes(n);
    public static string Hex(byte[] b) => Convert.ToHexString(b).ToLowerInvariant();

    public static byte[] Hmac(byte[] key, string msg) => HMACSHA256.HashData(key, Encoding.UTF8.GetBytes(msg));

    /// Constant-time compare of two b64 MACs.
    public static bool Same(string? a, string? b) =>
        a != null && b != null && CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(a), Encoding.ASCII.GetBytes(b));

    public static ECDiffieHellman NewKeyPair() => ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
    public static byte[] Spki(ECDiffieHellman k) => k.ExportSubjectPublicKeyInfo();
    public static byte[] Ecdh(ECDiffieHellman mine, byte[] otherSpki)
    {
        using var other = ECDiffieHellman.Create();
        other.ImportSubjectPublicKeyInfo(otherSpki, out _);
        return mine.DeriveRawSecretAgreement(other.PublicKey);
    }

    public static string Commit(byte[] spki, byte[] nonce) => B64(SHA256.HashData(spki.Concat(nonce).ToArray()));
    public static string Transcript(string pkD, string pkK, string nD2, string nK2) => $"{pkD}|{pkK}|{nD2}|{nK2}";
    public static byte[] PairKey(byte[] z, string t) => Hmac(z, "DW2 pair|" + t);
    public static string Code(string t)
    {
        var h = SHA256.HashData(Encoding.UTF8.GetBytes("DW2 code|" + t));
        uint v = (uint)h[0] << 24 | (uint)h[1] << 16 | (uint)h[2] << 8 | h[3];
        return (v % 1_000_000).ToString("D6");
    }
    public static string AuthMac(byte[] k, string role, string nK, string nD) => B64(Hmac(k, $"DW2 auth {role}|{nK}|{nD}"));
    public static byte[] SessionKey(byte[] k, string nK, string nD) => Hmac(k, $"DW2 session|{nK}|{nD}");
    public static string DoneMac(byte[] k, string role) => B64(Hmac(k, "DW2 done " + role));
    public static string EnvMac(byte[] s, string dir, long n, string p) => B64(Hmac(s, $"{dir}|{n}|{p}"));
}

/// This desktop's identity and the decks it is paired with: %APPDATA%\Deckwell\pairing.json.
sealed class PairStore
{
    readonly object _gate = new();
    readonly string _path;
    readonly JsonObject _doc;

    public PairStore(string path)
    {
        _path = path;
        JsonObject? doc = null;
        try { if (File.Exists(path)) doc = JsonNode.Parse(File.ReadAllText(path)) as JsonObject; }
        catch (Exception e) { Log.Write("pairing.json: " + e.Message); }
        _doc = doc ?? new JsonObject();
        if (Json.S(_doc, "desktopId").Length != 32) { _doc["desktopId"] = Crypto.Hex(Crypto.Random(16)); Save(); }
        if (_doc["decks"] is not JsonObject) { _doc["decks"] = new JsonObject(); Save(); }
    }

    public string DesktopId => Json.S(_doc, "desktopId");
    JsonObject Decks => (JsonObject)_doc["decks"]!;

    public byte[]? KeyFor(string deckId)
    {
        lock (_gate)
        {
            var k = Json.S(Decks[deckId], "key");
            try { return k.Length > 0 ? Crypto.UnB64(k) : null; } catch { return null; }
        }
    }

    public void Add(string deckId, string name, byte[] key)
    {
        lock (_gate) { Decks[deckId] = new JsonObject { ["key"] = Crypto.B64(key), ["name"] = name, ["pairedAt"] = DateTime.UtcNow.ToString("o") }; Save(); }
    }

    public void Remove(string deckId) { lock (_gate) { if (Decks.Remove(deckId)) Save(); } }

    /// The name the user gave this deck when pairing, or null if it isn't paired.
    public string? NameFor(string deckId) { lock (_gate) { var n = Json.S(Decks[deckId], "name"); return Decks[deckId] == null ? null : n; } }

    public bool Rename(string deckId, string name)
    {
        lock (_gate)
        {
            if (Decks[deckId] is not JsonObject d) return false;
            d["name"] = name; Save(); return true;
        }
    }

    void Save()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
            var tmp = _path + ".tmp";
            File.WriteAllText(tmp, _doc.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
            File.Move(tmp, _path, true);
        }
        catch (Exception e) { Log.Write("pairing.json save: " + e.Message); }
    }
}
