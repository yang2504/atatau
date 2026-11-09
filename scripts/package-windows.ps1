param(
    [string]$Output = (Join-Path (Get-Location) 'Hostel-Atatau-Windows-x64.zip')
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$outputPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Output)
if (Test-Path -LiteralPath $outputPath) { throw "El archivo ya existe: $outputPath" }
$nodeVersion = 'v22.23.4'
$nodeArchive = "node-$nodeVersion-win-x64.zip"
$nodeDist = "https://nodejs.org/dist/$nodeVersion"
$temp = Join-Path ([System.IO.Path]::GetTempPath()) ('atatau-package-' + [guid]::NewGuid())
$stage = Join-Path $temp 'Hostel-Atatau'

Push-Location $root
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación.' }

    New-Item -ItemType Directory -Path $stage, "$stage/backend", "$stage/frontend", "$stage/runtime" | Out-Null
    Copy-Item -LiteralPath package.json, package-lock.json, README.md -Destination $stage
    Copy-Item -LiteralPath docs -Destination $stage -Recurse
    Copy-Item -LiteralPath backend/package.json, backend/src -Destination "$stage/backend" -Recurse
    Copy-Item -LiteralPath frontend/package.json, frontend/dist -Destination "$stage/frontend" -Recurse
    Copy-Item -LiteralPath scripts/windows/Iniciar-Atatau.cmd -Destination $stage
    Push-Location $stage
    try {
        npm ci --omit=dev --workspace backend --include-workspace-root=false
        if ($LASTEXITCODE -ne 0) { throw 'Falló la instalación de dependencias del paquete.' }
    } finally { Pop-Location }

    $download = Join-Path $temp $nodeArchive
    Invoke-WebRequest -UseBasicParsing -Uri "$nodeDist/$nodeArchive" -OutFile $download
    $checksums = (Invoke-WebRequest -UseBasicParsing -Uri "$nodeDist/SHASUMS256.txt").Content
    $line = ($checksums -split '\r?\n') | Where-Object { $_.EndsWith("  $nodeArchive") }
    if (!$line -or (Get-FileHash -Algorithm SHA256 -LiteralPath $download).Hash -ne ($line -split '\s+')[0]) {
        throw 'La descarga de Node.js no coincide con su suma SHA-256.'
    }
    Expand-Archive -LiteralPath $download -DestinationPath $temp
    $nodeFolder = Join-Path $temp "node-$nodeVersion-win-x64"
    Copy-Item -LiteralPath "$nodeFolder/node.exe", "$nodeFolder/LICENSE" -Destination "$stage/runtime"
    Compress-Archive -LiteralPath $stage -DestinationPath $outputPath
    Get-Item -LiteralPath $outputPath
} finally {
    Pop-Location
    $tempParent = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\')
    $tempPath = [System.IO.Path]::GetFullPath($temp)
    if ((Split-Path -Parent $tempPath) -eq $tempParent -and (Split-Path -Leaf $tempPath) -match '^atatau-package-[0-9a-f-]{36}$' -and (Test-Path -LiteralPath $tempPath)) {
        Remove-Item -LiteralPath $tempPath -Recurse -Force
    }
}
