using System.Net.Sockets;
using System.Text;
using Deckwell;
using Xunit;

public class StatusParseTests
{
    [Fact]
    public void PipeFormat()
    {
        var r = StatusParse.Parse("some log line\n72%|4 cores|0.72\n\n", 0);
        Assert.Equal("72%", r.Value); Assert.Equal("4 cores", r.Sub); Assert.Equal(0.72, r.Bar!.Value, 3); Assert.True(r.Up);
    }

    [Fact]
    public void ValueOnlyPercentFillsBar()
    {
        var r = StatusParse.Parse("45%", 0);
        Assert.Equal(0.45, r.Bar!.Value, 3);
        Assert.Null(StatusParse.Parse("61°C|RTX", 0).Bar);
    }

    [Fact]
    public void BarAcceptsPercentAndHundreds()
    {
        Assert.Equal(0.5, StatusParse.Parse("x||50", 0).Bar!.Value, 3);
        Assert.Equal(0.5, StatusParse.Parse("x||50%", 0).Bar!.Value, 3);
        Assert.Equal(1.0, StatusParse.Parse("x||1", 0).Bar!.Value, 3);
        Assert.Equal(1.0, StatusParse.Parse("x||250", 0).Bar!.Value, 3);
        Assert.Null(StatusParse.Parse("x||abc", 0).Bar);
    }

    [Fact]
    public void UpFromWordOrExitCode()
    {
        Assert.False(StatusParse.Parse("nginx|web||down", 0).Up);
        Assert.True(StatusParse.Parse("nginx|web||up", 1).Up);
        Assert.False(StatusParse.Parse("nginx", 3).Up);
        Assert.True(StatusParse.Parse("", 0).Up);
        Assert.Null(StatusParse.Parse("   \n", 0).Value);
    }

    [Fact]
    public void Json()
    {
        var r = StatusParse.Parse("{\"value\":12,\"sub\":\"containers\",\"bar\":\"80%\",\"up\":false}", 0);
        Assert.Equal("12", r.Value); Assert.Equal("containers", r.Sub); Assert.Equal(0.8, r.Bar!.Value, 3); Assert.False(r.Up);
    }

    [Fact]
    public void MessageLeavesOutMissingParts()
    {
        var m = StatusParse.ToMessage("k1", StatusParse.Parse("ok", 0)).ToJsonString();
        Assert.Contains("\"value\":\"ok\"", m);
        Assert.DoesNotContain("bar", m);
        Assert.DoesNotContain("sub", m);
    }

    [Fact]
    public void LongValuesAreClipped() => Assert.Equal(24, StatusParse.Parse(new string('x', 80), 0).Value!.Length);
}

public class PushServerTests
{
    static (PushServer, List<(string, string)>) Make(int port)
    {
        var got = new List<(string, string)>();
        var path = Path.Combine(Path.GetTempPath(), "dw-push-" + Guid.NewGuid().ToString("N"), "push-token.txt");
        var s = new PushServer(path, (f, t) => { lock (got) got.Add((f, t)); return 1; }, port);
        return (s, got);
    }

    static string Send(int port, string raw)
    {
        using var c = new TcpClient("127.0.0.1", port);
        var st = c.GetStream();
        st.Write(Encoding.ASCII.GetBytes(raw));
        using var r = new StreamReader(st);
        return r.ReadToEnd();
    }

    [Fact]
    public void PostWithBearerToken()
    {
        var (s, got) = Make(18771);
        using (s)
        {
            var body = "72%|4 cores|0.72";
            var resp = Send(18771, $"POST /status/gpu-temp HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer {s.Token}\r\nContent-Length: {body.Length}\r\n\r\n{body}");
            Assert.StartsWith("HTTP/1.1 200", resp);
            Assert.Contains("\"tiles\":1", resp);
            Assert.Equal(("gpu-temp", body), got.Single());
        }
    }

    [Fact]
    public void GetWithQueryToken()
    {
        var (s, got) = Make(18772);
        using (s)
        {
            var resp = Send(18772, $"GET /status/disk?token={s.Token}&value=62%25&sub=C%3A%20free&bar=0.62 HTTP/1.1\r\n\r\n");
            Assert.StartsWith("HTTP/1.1 200", resp);
            Assert.Equal(("disk", "62%|C: free|0.62|"), got.Single());
        }
    }

    [Fact]
    public void RejectsWrongTokenAndBadFeed()
    {
        var (s, got) = Make(18773);
        using (s)
        {
            Assert.StartsWith("HTTP/1.1 401", Send(18773, "POST /status/x HTTP/1.1\r\nAuthorization: Bearer nope\r\nContent-Length: 2\r\n\r\nhi"));
            Assert.StartsWith("HTTP/1.1 401", Send(18773, "POST /status/x HTTP/1.1\r\nContent-Length: 2\r\n\r\nhi"));
            Assert.StartsWith("HTTP/1.1 400", Send(18773, $"POST /status/a%20b HTTP/1.1\r\nX-Deckwell-Token: {s.Token}\r\nContent-Length: 2\r\n\r\nhi"));
            Assert.StartsWith("HTTP/1.1 404", Send(18773, "GET /nope HTTP/1.1\r\n\r\n"));
            Assert.StartsWith("HTTP/1.1 400", Send(18773, $"POST /status/x HTTP/1.1\r\nX-Deckwell-Token: {s.Token}\r\nContent-Length: 999999\r\n\r\n"));
            Assert.Empty(got);
        }
    }

    [Fact]
    public void TokenIsKeptBetweenRuns()
    {
        var path = Path.Combine(Path.GetTempPath(), "dw-push-" + Guid.NewGuid().ToString("N"), "push-token.txt");
        string t1; using (var a = new PushServer(path, (_, _) => 0, 18774)) t1 = a.Token;
        using var b = new PushServer(path, (_, _) => 0, 18775);
        Assert.Equal(t1, b.Token);
        Assert.Equal(32, t1.Length);
    }
}
