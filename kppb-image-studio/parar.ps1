$ErrorActionPreference = 'Stop'
$pidFile = Join-Path $PSScriptRoot 'servidor.json'
if (-not (Test-Path -LiteralPath $pidFile)) { return }
$saved = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
$process = Get-Process -Id $saved.pid -ErrorAction SilentlyContinue
if ($process -and $process.StartTime.Ticks -eq $saved.startTicks) {
    Stop-Process -Id $process.Id
    Write-Output 'Servidor do KPPB encerrado.'
}
