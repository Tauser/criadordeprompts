# Encerra somente a instância confirmada do Studio; não toca no ComfyUI.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$pidFile = Join-Path $root 'data\studio.pid'
$infoFile = Join-Path $root 'data\studio-server.json'
if (-not (Test-Path -LiteralPath $pidFile)) { Write-Output 'O Studio não está em execução.'; return }
$studioId = [int](Get-Content -LiteralPath $pidFile)
$owner = Get-CimInstance Win32_Process -Filter "ProcessId = $studioId" -ErrorAction SilentlyContinue
if ($owner) {
    if ($owner.Name -ne 'python.exe' -or $owner.CommandLine -notmatch '-m\s+prisma_studio\b') {
        throw 'O PID salvo pertence a outro processo. Nenhum processo foi encerrado.'
    }
    if (Test-Path -LiteralPath $infoFile) {
        $saved = Get-Content -LiteralPath $infoFile -Raw | ConvertFrom-Json
        $current = Get-Process -Id $studioId -ErrorAction Stop
        if ($saved.pid -ne $studioId -or $saved.startTicks -ne $current.StartTime.Ticks) {
            throw 'O PID foi reutilizado desde a inicialização. Nenhum processo foi encerrado.'
        }
    }
    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $studioId" |
        Where-Object { $_.Name -eq 'python.exe' -and $_.CommandLine -match '-m\s+prisma_studio\b' })
    foreach ($child in $children) { Stop-Process -Id $child.ProcessId -ErrorAction SilentlyContinue }
    Stop-Process -Id $studioId -ErrorAction SilentlyContinue
    Write-Output 'Studio encerrado.'
} else { Write-Output 'O processo já havia terminado.' }
Remove-Item -LiteralPath $pidFile -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $infoFile -ErrorAction SilentlyContinue
