$ErrorActionPreference = 'Stop'
$studioRoot = $PSScriptRoot
$pythonPath = Join-Path (Split-Path $studioRoot -Parent) '.venv-mcp\Scripts\python.exe'
$pidFile = Join-Path $studioRoot 'servidor.json'
$privateIndexes = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object NetworkCategory -eq 'Private' | Select-Object -ExpandProperty InterfaceIndex)
$lanAddress = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.InterfaceIndex -in $privateIndexes -and $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1
if (Test-Path -LiteralPath $pidFile) {
    $saved = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
    $existing = Get-Process -Id $saved.pid -ErrorAction SilentlyContinue
    if ($existing -and $existing.StartTime.Ticks -eq $saved.startTicks) {
        Write-Output 'KPPB já está em http://127.0.0.1:8770/'
        if ($saved.lanIp) { Write-Output ('Rede local: http://'+$saved.lanIp+':8770/') }
        return
    }
}
if (-not (Test-Path -LiteralPath $pythonPath)) { throw 'Python do GeraImg não encontrado.' }
$serverPath = Join-Path $studioRoot 'server.py'
$arguments = @('-B', ('"' + $serverPath + '"'), '--port', '8770')
if ($lanAddress) { $arguments += @('--host','0.0.0.0','--lan-ip',$lanAddress.IPAddress,'--allow-network',($lanAddress.IPAddress+'/'+$lanAddress.PrefixLength)) }
$process = Start-Process -FilePath $pythonPath -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $studioRoot 'servidor.log') -RedirectStandardError (Join-Path $studioRoot 'servidor-erros.log')
@{pid=$process.Id; startTicks=$process.StartTime.Ticks; lanIp=$lanAddress.IPAddress} | ConvertTo-Json | Set-Content -LiteralPath $pidFile
Write-Output 'KPPB Image Studio: http://127.0.0.1:8770/'
if ($lanAddress) { Write-Output ('Rede local, sem senha: http://'+$lanAddress.IPAddress+':8770/') }
