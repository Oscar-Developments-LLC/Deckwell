using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Deckwell;
using Xunit;

/// The desktop's crypto must match shared/pairing-vector.json, which every Deckwell app is checked against.
public class PairingVectorTests
{
    static readonly JsonNode V = JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "pairing-vector.json")))!;
    static string S(string k) => V[k]!.GetValue<string>();

    static ECDiffieHellman Priv(string k)
    {
        var e = ECDiffieHellman.Create();
        e.ImportPkcs8PrivateKey(Crypto.UnB64(S(k)), out _);
        return e;
    }

    [Fact]
    public void MatchesSharedVector()
    {
        using var dD = Priv("desktopPrivPkcs8");
        using var dK = Priv("deckPrivPkcs8");
        Assert.Equal(S("pkD"), Crypto.B64(Crypto.Spki(dD)));
        Assert.Equal(S("pkK"), Crypto.B64(Crypto.Spki(dK)));

        var z = Crypto.Ecdh(dD, Crypto.UnB64(S("pkK")));
        Assert.Equal(z, Crypto.Ecdh(dK, Crypto.UnB64(S("pkD"))));
        Assert.Equal(S("Z"), Crypto.B64(z));

        Assert.Equal(S("commit"), Crypto.Commit(Crypto.UnB64(S("pkK")), Crypto.UnB64(S("nK2"))));
        var t = Crypto.Transcript(S("pkD"), S("pkK"), S("nD2"), S("nK2"));
        var k = Crypto.PairKey(z, t);
        Assert.Equal(S("K"), Crypto.B64(k));
        Assert.Equal(S("code"), Crypto.Code(t));
        Assert.Equal(S("authDesk"), Crypto.AuthMac(k, "desk", S("nK"), S("nD")));
        Assert.Equal(S("authDeck"), Crypto.AuthMac(k, "deck", S("nK"), S("nD")));
        Assert.Equal(S("doneDesk"), Crypto.DoneMac(k, "desk"));
        Assert.Equal(S("doneDeck"), Crypto.DoneMac(k, "deck"));
        var sess = Crypto.SessionKey(k, S("nK"), S("nD"));
        Assert.Equal(S("S"), Crypto.B64(sess));
        Assert.Equal(S("envMac"), Crypto.EnvMac(sess, S("envDir"), V["envN"]!.GetValue<long>(), S("envP")));
    }

    [Fact]
    public void SameIsStrict()
    {
        Assert.True(Crypto.Same("abc=", "abc="));
        Assert.False(Crypto.Same("abc=", "abd="));
        Assert.False(Crypto.Same("abc", "abc="));
        Assert.False(Crypto.Same(null, "abc="));
    }

    [Fact]
    public void PairStoreKeepsIdentityAndKeys()
    {
        var path = Path.Combine(Path.GetTempPath(), "dw-test-" + Guid.NewGuid().ToString("N"), "pairing.json");
        var a = new PairStore(path);
        Assert.Equal(32, a.DesktopId.Length);
        Assert.Null(a.KeyFor("deck1"));
        a.Add("deck1", "Kindle", new byte[] { 1, 2, 3 });
        var b = new PairStore(path);
        Assert.Equal(a.DesktopId, b.DesktopId);
        Assert.Equal(new byte[] { 1, 2, 3 }, b.KeyFor("deck1"));
        b.Remove("deck1");
        Assert.Null(new PairStore(path).KeyFor("deck1"));
    }
}
