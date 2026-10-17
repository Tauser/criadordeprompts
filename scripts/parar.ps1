# Encerra o Studio. Trabalhos em andamento continuam no ComfyUI e são reconciliados no próximo início.
$root = Split-Path $PSScriptRoot -Parent
$pidFile = Join-Path $root 'data\studio.pid'
if (-not (Test-Path $pidFile)) { Write-Output 'O Studio não está em execução.'; exit 0 }
$process = Get-Process -Id (Get-Content $pidFile) -ErrorAction SilentlyContinue
if ($process) { Stop-Process -Id $process.Id; Write-Output 'Studio encerrado.' } else { Write-Output 'O processo já havia terminado.' }
Remove-Item $pidFile -ErrorAction SilentlyContinue
