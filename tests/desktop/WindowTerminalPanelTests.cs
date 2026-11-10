using System.Text.Json.Nodes;
using Deckwell;
using Xunit;

public class SnapSpotTests
{
    static readonly SnapSpots.Box Work = new(0, 0, 2560, 1400);

    [Fact]
    public void HalvesMeetWithNoGap()
    {
        var l = SnapSpots.Place(Work, SnapSpots.Find("left", null)!.Value);
        var r = SnapSpots.Place(Work, SnapSpots.Find("right", null)!.Value);
        Assert.Equal(new SnapSpots.Box(0, 0, 1280, 1400), l);
        Assert.Equal(l.X + l.W, r.X); Assert.Equal(2560, r.X + r.W);
    }

    [Fact]
    public void ThirdsCoverTheWholeWidth()
    {
        var w = new SnapSpots.Box(-1920, 20, 1921, 1040); // a left-hand monitor with an odd width
        var a = SnapSpots.Place(w, SnapSpots.Find("third-l", null)!.Value);
        var b = SnapSpots.Place(w, SnapSpots.Find("third-c", null)!.Value);
        var c = SnapSpots.Place(w, SnapSpots.Find("third-r", null)!.Value);
        Assert.Equal(-1920, a.X); Assert.Equal(a.X + a.W, b.X); Assert.Equal(b.X + b.W, c.X); Assert.Equal(1, c.X + c.W);
    }

    [Fact]
    public void ZonesAreFoundAndClamped()
    {
        var zones = JsonNode.Parse("""[{"id":"z1","name":"Code","x":0,"y":0,"w":0.7,"h":1},{"id":"z2","name":"Bad","x":0.9,"y":-1,"w":2,"h":0.01}]""")!.AsArray().Select(x => x!);
        Assert.Equal(new SnapSpots.Frac(0, 0, 0.7, 1), SnapSpots.Find("zone:z1", zones));
        var bad = SnapSpots.Find("zone:z2", zones)!.Value;
        Assert.Equal(0.9, bad.X, 6); Assert.Equal(0, bad.Y); Assert.Equal(0.1, bad.W, 6); Assert.Equal(0.05, bad.H, 6);
        Assert.Equal("Code", SnapSpots.Name("zone:z1", zones));
        Assert.Null(SnapSpots.Find("zone:gone", zones));
        Assert.Null(SnapSpots.Find("nope", null));
    }

    [Fact]
    public void LayoutFractionsRoundTrip()
    {
        var win = new SnapSpots.Box(640, 0, 1280, 700);
        var f = SnapSpots.ToFrac(Work, win);
        Assert.Equal(win, SnapSpots.Place(Work, f));
    }
}

public class TerminalCmdTests
{
    static JsonNode Key(string json) => JsonNode.Parse(json)!;

    [Fact]
    public void WindowsTerminalProfileInNewTab()
    {
        var l = TerminalCmd.Build(Key("""{"program":"wt","openIn":"tab","profile":"Ubuntu"}"""), null, true, @"C:\My Projects", "");
        Assert.Equal("wt.exe", l.Exe);
        Assert.Equal(@"-w 0 nt -p Ubuntu -d ""C:\My Projects""", l.Args);
    }

    [Fact]
    public void PowerShellCommandIsEncodedSoSemicolonsSurvive()
    {
        var l = TerminalCmd.Build(Key("""{"program":"powershell","openIn":"window","command":"cd C:\\; dir"}"""), null, true, "", "");
        Assert.StartsWith("-w new powershell.exe -NoLogo -NoExit -EncodedCommand ", l.Args);
        var b64 = l.Args.Split(' ').Last();
        Assert.Equal(@"cd C:\; dir", System.Text.Encoding.Unicode.GetString(Convert.FromBase64String(b64)));
    }

    [Fact]
    public void SemicolonsAreEscapedForWindowsTerminal()
    {
        var l = TerminalCmd.Build(Key("""{"program":"cmd","command":"echo a & echo b; echo c"}"""), null, true, "", "");
        Assert.Equal(@"-w new cmd.exe /k ""echo a & echo b\; echo c""", l.Args);
    }

    [Fact]
    public void SshUsesHostAndKey()
    {
        var host = Key("""{"name":"box","address":"10.0.0.5","user":"pi","port":2222}""");
        var l = TerminalCmd.Build(Key("""{"program":"ssh","openIn":"window","command":"htop"}"""), host, false, "", @"C:\Users\me\.ssh\id_ed25519");
        Assert.Equal("ssh.exe", l.Exe); Assert.Null(l.WorkDir);
        Assert.Equal(@"-t -i C:\Users\me\.ssh\id_ed25519 -p 2222 pi@10.0.0.5 ""htop; exec $SHELL -l""", l.Args);
    }

    [Fact]
    public void ClassicWindowWithoutWindowsTerminal()
    {
        var l = TerminalCmd.Build(Key("""{"program":"pwsh","admin":true}"""), null, false, @"D:\work", "");
        Assert.Equal("pwsh.exe", l.Exe); Assert.Equal("-NoLogo", l.Args); Assert.Equal(@"D:\work", l.WorkDir); Assert.True(l.Admin);
        Assert.Throws<ArgumentException>(() => TerminalCmd.Build(Key("""{"program":"wt"}"""), null, false, "", ""));
        Assert.Throws<ArgumentException>(() => TerminalCmd.Build(Key("""{"program":"ssh"}"""), null, true, "", ""));
    }

    [Fact]
    public void QuotingFollowsWindowsRules()
    {
        Assert.Equal("plain", TerminalCmd.Quote("plain"));
        Assert.Equal("\"\"", TerminalCmd.Quote(""));
        Assert.Equal(@"""a \""b\"" c""", TerminalCmd.Quote("a \"b\" c"));
        Assert.Equal(@"""C:\dir with space\\""", TerminalCmd.Quote(@"C:\dir with space\"));
    }
}

public class PanelParseTests
{
    [Fact]
    public void StripsColorsTabsAndBlankEdges()
    {
        var t = PanelParse.Clean("\n\n\u001b[1;32mOK\u001b[0m\tdone\r\nline 2   \n\n\n");
        Assert.Equal("OK  done\nline 2", t);
    }

    [Fact]
    public void LimitsLinesAndWidth()
    {
        var many = string.Join("\n", Enumerable.Range(1, 100).Select(i => "row " + i));
        var lines = PanelParse.Clean(many).Split('\n');
        Assert.Equal(PanelParse.MaxLines, lines.Length); Assert.Equal("…", lines[^1]); Assert.Equal("row 1", lines[0]);
        var wide = PanelParse.Clean(new string('x', 500));
        Assert.Equal(PanelParse.MaxLineChars, wide.Length); Assert.EndsWith("…", wide);
    }

    [Fact]
    public void MessageShape()
    {
        var m = PanelParse.ToMessage("k1", "a\nb", false);
        Assert.Equal("panel", m["t"]!.GetValue<string>()); Assert.Equal("a\nb", m["text"]!.GetValue<string>()); Assert.False(m["up"]!.GetValue<bool>());
    }
}
