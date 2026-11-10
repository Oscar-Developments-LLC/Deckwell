using System.Text;
using System.Text.Json.Nodes;

namespace Deckwell;

/// Builds the command line for an Open terminal key. Platform-neutral so it can be unit tested.
///
/// program  wt (a Windows Terminal profile) | powershell | pwsh | cmd | wsl | ssh
/// openIn   window | tab   (a new Windows Terminal window, or a new tab in the last one used)
/// profile  Windows Terminal profile name (optional; the default profile if empty)
/// folder   start folder (optional)
/// command  runs when it opens; the terminal stays open afterwards (not for "wt")
/// admin    run as administrator
/// Without Windows Terminal installed, the shell opens in its own classic console window instead.
public static class TerminalCmd
{
    public sealed record Launch(string Exe, string Args, string? WorkDir, bool Admin);

    public static Launch Build(JsonNode key, JsonNode? host, bool hasWt, string folder, string keyPath)
    {
        var program = S(key, "program", "wt");
        var openIn = S(key, "openIn", "window");
        var profile = S(key, "profile").Trim();
        var command = S(key, "command").Trim();
        bool admin = key["admin"] is JsonValue a && a.TryGetValue<bool>(out var ab) && ab;
        folder = folder.Trim();

        // The shell part: what runs inside the terminal.
        string? exe = null; var args = new List<string>();
        switch (program)
        {
            case "powershell": case "pwsh":
                exe = program == "pwsh" ? "pwsh.exe" : "powershell.exe";
                args.Add("-NoLogo");
                if (command.Length > 0) { args.Add("-NoExit"); args.Add("-EncodedCommand"); args.Add(Convert.ToBase64String(Encoding.Unicode.GetBytes(command))); }
                break;
            case "cmd":
                exe = "cmd.exe";
                if (command.Length > 0) { args.Add("/k"); args.Add(command); }
                break;
            case "wsl":
                exe = "wsl.exe";
                if (!hasWt && folder.Length > 0) { args.Add("--cd"); args.Add(folder); }
                if (command.Length > 0) { args.Add("-e"); args.Add("bash"); args.Add("-lc"); args.Add(command + "; exec bash -l"); }
                break;
            case "ssh":
            {
                exe = "ssh.exe";
                if (host == null) throw new ArgumentException("No host picked");
                args.Add("-t");
                if (keyPath.Length > 0) { args.Add("-i"); args.Add(keyPath); }
                var port = S(host, "port", "22"); if (port != "22" && port.Length > 0) { args.Add("-p"); args.Add(port); }
                args.Add(S(host, "user", "root") + "@" + S(host, "address"));
                if (command.Length > 0) args.Add(command + "; exec $SHELL -l");
                break;
            }
            default: program = "wt"; break;
        }

        if (!hasWt)
        {
            if (exe == null) throw new ArgumentException("Windows Terminal isn't installed. Pick PowerShell, cmd, WSL or SSH instead.");
            // Classic console window. wsl gets its folder through --cd above; the others start in WorkDir.
            return new Launch(exe, Join(args), folder.Length > 0 && program != "ssh" ? folder : null, admin);
        }

        var wt = new List<string> { "-w", openIn == "tab" ? "0" : "new" };
        if (openIn == "tab") wt.Add("nt");
        if (profile.Length > 0) { wt.Add("-p"); wt.Add(profile); }
        if (folder.Length > 0 && program != "ssh") { wt.Add("-d"); wt.Add(folder); }
        var line = Join(wt);
        // Windows Terminal splits its arguments on ';', so the shell's own semicolons are escaped.
        if (exe != null) line += " " + Quote(exe) + (args.Count > 0 ? " " + Join(args).Replace(";", "\\;") : "");
        return new Launch("wt.exe", line, null, admin);
    }

    static string S(JsonNode? n, string k, string def = "")
    {
        try { var v = n?[k]; return v == null ? def : v.GetValueKind() == System.Text.Json.JsonValueKind.String ? v.GetValue<string>() : v.ToJsonString(); }
        catch { return def; }
    }

    public static string Join(IEnumerable<string> args) => string.Join(" ", args.Select(Quote));

    /// Quotes one argument the way Windows programs split command lines (CommandLineToArgvW rules).
    public static string Quote(string s)
    {
        if (s.Length > 0 && s.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return s;
        var sb = new StringBuilder("\"");
        int slashes = 0;
        foreach (var ch in s)
        {
            if (ch == '\\') { slashes++; continue; }
            if (ch == '"') { sb.Append('\\', slashes * 2 + 1); sb.Append('"'); }
            else { sb.Append('\\', slashes); sb.Append(ch); }
            slashes = 0;
        }
        sb.Append('\\', slashes * 2).Append('"');
        return sb.ToString();
    }
}
