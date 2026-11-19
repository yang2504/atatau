using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

internal sealed class Atatau : Form
{
    private const string Address = "http://127.0.0.1:3001";
    private readonly string root = AppDomain.CurrentDomain.BaseDirectory;
    private readonly Label status = new Label();
    private readonly Button open = new Button();
    private readonly Button stop = new Button();
    private Process server;
    private bool closing;
    private bool stopped;

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
        Text = "Hostel Atatau";
        ClientSize = new Size(450, 205);
        AutoScaleMode = AutoScaleMode.Dpi;
        Font = new Font("Segoe UI", 10);
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        var title = new Label { Text = "Hostel Atatau", Font = new Font("Segoe UI", 18, FontStyle.Bold),
            Location = new Point(22, 18), Size = new Size(400, 40) };
        status.Text = "Iniciando la recepción…";
        status.SetBounds(24, 70, 400, 65);
        open.Text = "Abrir recepción";
        open.SetBounds(24, 150, 180, 34);
        open.Enabled = false;
        open.Click += delegate { TryOpenBrowser(); };
        stop.Text = "Cerrar Atatau";
        stop.SetBounds(224, 150, 200, 34);
        stop.Click += delegate { Close(); };
        Controls.AddRange(new Control[] { title, status, open, stop });
        Shown += async delegate { await StartServer(); };
        FormClosing += async delegate(object sender, FormClosingEventArgs args)
        {
            if (stopped) return;
            if (server == null) { closing = stopped = true; return; }
            args.Cancel = true;
            if (closing) return;
            closing = true;
            open.Enabled = stop.Enabled = false;
            status.Text = "Cerrando Atatau y guardando el estado del turno…";
            try
            {
                if (!server.HasExited)
                {
                    try { server.StandardInput.WriteLine("shutdown"); server.StandardInput.Close(); }
                    catch (IOException) { }
                    await Task.Run(delegate { server.WaitForExit(); });
                }
            }
            catch (InvalidOperationException) { }
            finally { server.Dispose(); stopped = true; Close(); }
        };
    }

    private async Task StartServer()
    {
        try
        {
            bool alreadyRunning = await Task.Run((Func<bool>)Healthy);
            if (closing) return;
            if (alreadyRunning)
            {
                status.Text = "Atatau ya estaba funcionando. Esta ventana no cerrará esa otra instancia.";
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
                    status.Text = "La recepción está abierta en tu navegador.\nMantén esta aplicación abierta mientras trabajas.";
                    open.Enabled = true;
                    TryOpenBrowser();
                    return;
                }
                await Task.Delay(250);
            }
            if (!closing) status.Text = "No se pudo iniciar Atatau. Cierra otra versión que esté abierta y vuelve a intentarlo. Verifica también que la carpeta de datos se pueda escribir.";
        }
        catch (Exception error)
        {
            if (!closing) status.Text = error is FileNotFoundException ? error.Message
                : "No se pudo abrir Atatau. Extrae el ZIP completo y comprueba que Windows permita ejecutar la aplicación.";
        }
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
        catch { MessageBox.Show(this, "Abre " + Address + " en tu navegador.", "Atatau", MessageBoxButtons.OK, MessageBoxIcon.Information); }
    }
}
