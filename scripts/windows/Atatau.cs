using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

internal sealed class Atatau : ApplicationContext
{
    private const string Address = "http://127.0.0.1:3001";
    private readonly string root = AppDomain.CurrentDomain.BaseDirectory;
    private readonly NotifyIcon tray;
    private readonly ContextMenuStrip menu = new ContextMenuStrip();
    private readonly ToolStripMenuItem open = new ToolStripMenuItem("Abrir recepción") { Enabled = false };
    private readonly ToolStripMenuItem stop = new ToolStripMenuItem("Cerrar Atatau");
    private readonly Icon icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
    private Process server;
    private bool closing;

    [STAThread]
    private static int Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        using (var mutex = new Mutex(false, @"Local\HostelAtatau.Desktop"))
        {
            bool acquired;
            try { acquired = mutex.WaitOne(0); }
            catch (AbandonedMutexException) { acquired = true; }
            if (!acquired)
            {
                if (Healthy()) OpenBrowser();
                return 0;
            }
            try { Application.Run(new Atatau()); }
            finally { mutex.ReleaseMutex(); }
        }
        return 0;
    }

    private Atatau()
    {
        tray = new NotifyIcon { Text = "Hostel Atatau", Icon = icon ?? SystemIcons.Application, ContextMenuStrip = menu };
        menu.Items.AddRange(new ToolStripItem[] { open, stop });
        open.Click += delegate { TryOpenBrowser(); };
        tray.DoubleClick += delegate { if (open.Enabled) TryOpenBrowser(); };
        stop.Click += async delegate { await StopServer(); };
        tray.Visible = true;
        var startup = new System.Windows.Forms.Timer { Interval = 1 };
        startup.Tick += async delegate
        {
            startup.Dispose();
            await StartServer();
        };
        startup.Start();
    }

    private async Task StopServer()
    {
        if (closing) return;
        closing = true;
        open.Enabled = stop.Enabled = false;
        try
        {
            if (server != null && !server.HasExited)
            {
                try { server.StandardInput.Close(); }
                catch (IOException) { }
                await Task.Run(delegate { server.WaitForExit(); });
            }
        }
        catch (InvalidOperationException) { }
        finally
        {
            if (server != null) server.Dispose();
            tray.Dispose();
            menu.Dispose();
            if (icon != null) icon.Dispose();
            ExitThread();
        }
    }

    private async Task StartServer()
    {
        try
        {
            bool alreadyRunning = await Task.Run((Func<bool>)Healthy);
            if (closing) return;
            if (alreadyRunning)
            {
                stop.Text = "Salir del iniciador";
                open.Enabled = true;
                TryOpenBrowser();
                return;
            }
            foreach (string file in new[] { @"runtime\node.exe", @"backend\src\server.js", @"frontend\dist\index.html" })
                if (!File.Exists(Path.Combine(root, file)))
                    throw new FileNotFoundException("Extrae toda la carpeta del ZIP y abre Atatau.exe desde allí.");
            var info = new ProcessStartInfo(Path.Combine(root, @"runtime\node.exe"),
                "\"" + Path.Combine(root, @"backend\src\server.js") + "\" --desktop")
            {
                WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true
            };
            if (String.IsNullOrWhiteSpace(info.EnvironmentVariables["ATATAU_DB"]))
                info.EnvironmentVariables["ATATAU_DB"] = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"HostelAtatau\data\atatau.sqlite");
            server = new Process { StartInfo = info };
            server.OutputDataReceived += delegate { };
            server.ErrorDataReceived += delegate { };
            server.Start();
            server.BeginOutputReadLine();
            server.BeginErrorReadLine();
            for (int attempt = 0; attempt < 80 && !closing; attempt++)
            {
                if (server.HasExited) break;
                if (await Task.Run((Func<bool>)Healthy))
                {
                    if (closing) return;
                    open.Enabled = true;
                    TryOpenBrowser();
                    return;
                }
                await Task.Delay(250);
            }
            if (!closing) throw new InvalidOperationException();
        }
        catch (Exception error)
        {
            if (closing) return;
            MessageBox.Show(error is FileNotFoundException ? error.Message
                : "No se pudo iniciar Atatau. Revisa si otra versión está abierta o si la carpeta de datos permite escritura.",
                "Hostel Atatau", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        await StopServer();
    }

    private static bool Healthy()
    {
        try
        {
            var request = (HttpWebRequest)WebRequest.Create(Address + "/api/health");
            request.Proxy = null;
            request.Timeout = request.ReadWriteTimeout = 500;
            using (var response = request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream()))
            {
                string body = reader.ReadToEnd();
                return body.Contains("\"ok\":true") && body.Contains("\"app\":\"hostel-atatau\"");
            }
        }
        catch (WebException) { return false; }
    }

    private static void OpenBrowser() { Process.Start(new ProcessStartInfo(Address) { UseShellExecute = true }); }
    private void TryOpenBrowser()
    {
        try { OpenBrowser(); }
        catch { MessageBox.Show("Abre " + Address + " en tu navegador.", "Atatau", MessageBoxButtons.OK, MessageBoxIcon.Information); }
    }
}
