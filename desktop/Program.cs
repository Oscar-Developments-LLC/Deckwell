namespace Deckwell;

static class Program
{
    [STAThread]
    static void Main()
    {
        using var mutex = new Mutex(true, "Deckwell.Desktop.SingleInstance", out bool first);
        using var wake = new EventWaitHandle(false, EventResetMode.AutoReset, "Deckwell.Desktop.Wake");
        if (!first) { wake.Set(); return; }

        Paths.Ensure();
        Log.Write("Deckwell starting " + Application.ProductVersion);
        Application.ThreadException += (_, e) => Log.Write("ui: " + e.Exception);
        AppDomain.CurrentDomain.UnhandledException += (_, e) => Log.Write("fatal: " + e.ExceptionObject);

        ApplicationConfiguration.Initialize();
        var form = new MainForm();
        // A second launch just brings this window forward.
        new Thread(() =>
        {
            while (true)
            {
                wake.WaitOne();
                try { form.BeginInvoke(() => { if (form.WindowState == FormWindowState.Minimized) form.WindowState = FormWindowState.Normal; form.Activate(); }); } catch { }
            }
        }) { IsBackground = true }.Start();
        Application.Run(form);
    }
}
