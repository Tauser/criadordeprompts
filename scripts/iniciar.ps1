# Inicia o Studio em segundo plano e abre o navegador.
param([int]$Port = 8780, [string]$ComfyUrl = 'http://127.0.0.1:8188', [switch]$SemNavegador)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$py = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path $py)) { throw 'Rode scripts\instalar.ps1 primeiro.' }
$data = Join-Path $root 'data'
New-Item -ItemType Directory -Force -Path (Join-Path $data 'logs') | Out-Null
$pidFile = Join-Path $data 'studio.pid'
if (Test-Path $pidFile) {
    $old = Get-Process -Id (Get-Content $pidFile) -ErrorAction SilentlyContinue
    if ($old) { Write-Output "O Studio já está em http://127.0.0.1:$Port/"; if (-not $SemNavegador) { Start-Process "http://127.0.0.1:$Port/" }; exit 0 }
}
$env:KPPB_COMFY_URL = $ComfyUrl
$env:KPPB_DATA_DIR = $data
$process = Start-Process -FilePath $py -ArgumentList @('-m', 'kppb', '--port', $Port) -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $data 'logs\studio.log') -RedirectStandardError (Join-Path $data 'logs\studio-erros.log')
Set-Content -Path $pidFile -Value $process.Id
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    try { Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 2 | Out-Null; break } catch { }
}
Write-Output "KPPB Studio: http://127.0.0.1:$Port/"
if (-not $SemNavegador) { Start-Process "http://127.0.0.1:$Port/" }
