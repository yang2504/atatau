param([Parameter(Mandatory=$true)][string]$Zip)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$archive = (Resolve-Path -LiteralPath $Zip).Path
$temp = Join-Path ([System.IO.Path]::GetTempPath()) ('atatau-launcher-test-' + [guid]::NewGuid())
$previousDb = $env:ATATAU_DB
try {
    Expand-Archive -LiteralPath $archive -DestinationPath $temp
    $stage = Join-Path $temp 'Hostel-Atatau'
    if (!(Test-Path -LiteralPath (Join-Path $stage 'Atatau.exe'))) { throw 'Falta Atatau.exe en el ZIP.' }
    $testSource = Join-Path $temp 'LauncherTest.cs'
    @'
using System;
using System.Net;
using System.Threading.Tasks;
using System.Windows.Forms;
internal static class LauncherTest {
    [STAThread] private static int Main() {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        var form = (Form)Activator.CreateInstance(typeof(Atatau), true);
        Button open = null, stop = null;
        foreach (Control control in form.Controls) {
            if (control.Text == "Abrir recepción") open = control as Button;
            if (control.Text == "Cerrar Atatau") stop = control as Button;
        }
        if (open == null || stop == null) return 2;
        bool ready = false;
        form.Shown += async delegate {
            for (int attempt=0; attempt<100 && !open.Enabled; attempt++) await Task.Delay(100);
            ready = open.Enabled;
            stop.PerformClick();
        };
        Application.Run(form);
        if (!ready) return 3;
        try {
            var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:3001/api/health");
            request.Proxy = null; request.Timeout = 1000;
            using (request.GetResponse()) { return 4; }
        } catch (WebException) { return 0; }
    }
}
'@ | Set-Content -LiteralPath $testSource -Encoding UTF8
    $testExe = Join-Path $stage 'LauncherTest.exe'
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    & $compiler /nologo /target:winexe /platform:x64 /codepage:65001 /main:LauncherTest "/out:$testExe" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll (Join-Path $root 'scripts\windows\Atatau.cs') $testSource
    if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación de la prueba.' }
    $env:ATATAU_DB = Join-Path $temp 'qa.sqlite'
    $process = Start-Process -FilePath $testExe -WorkingDirectory $stage -WindowStyle Hidden -PassThru
    if (!$process.WaitForExit(30000)) { $process.Kill(); throw 'El iniciador no terminó en 30 segundos.' }
    if ($process.ExitCode -ne 0) { throw "Falló el inicio/cierre del iniciador (código $($process.ExitCode))." }
    Write-Output 'Prueba correcta: controles de Atatau, inicio de Node y botón Cerrar Atatau con apagado del servidor.'
} finally {
    $env:ATATAU_DB = $previousDb
    $tempParent = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\')
    $tempPath = [System.IO.Path]::GetFullPath($temp)
    if ((Split-Path -Parent $tempPath) -eq $tempParent -and (Split-Path -Leaf $tempPath) -match '^atatau-launcher-test-[0-9a-f-]{36}$' -and (Test-Path -LiteralPath $tempPath)) {
        Remove-Item -LiteralPath $tempPath -Recurse -Force
    }
}
