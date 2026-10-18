# Inicia o Studio; libera somente a rede privada detectada, como na versão anterior.
param([ValidateRange(1,65535)][int]$Port = 8780, [string]$ComfyUrl = 'http://127.0.0.1:8188',
      [switch]$SemNavegador, [switch]$SomenteLocal, [switch]$Reiniciar)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$py = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $py)) { throw 'Rode scripts\instalar.ps1 primeiro.' }
$data = Join-Path $root 'data'
New-Item -ItemType Directory -Force -Path (Join-Path $data 'logs') | Out-Null
$pidFile = Join-Path $data 'studio.pid'

# Recompila a interface quando o código-fonte é mais novo que o build servido em frontend\dist.
$frontend = Join-Path $root 'frontend'
$builtIndex = Join-Path $frontend 'dist\index.html'
$sources = @(Get-ChildItem -LiteralPath (Join-Path $frontend 'src') -Recurse -File -ErrorAction SilentlyContinue) +
    @('index.html', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json' |
      ForEach-Object { Get-Item -LiteralPath (Join-Path $frontend $_) -ErrorAction SilentlyContinue })
$newest = ($sources | Where-Object { $_ } | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1)
$stale = -not (Test-Path -LiteralPath $builtIndex) -or
    ($newest -and $newest.LastWriteTimeUtc -gt (Get-Item -LiteralPath $builtIndex).LastWriteTimeUtc)
if ($stale) {
    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npm) { Write-Warning 'A interface mudou, mas o npm não foi encontrado; o Studio vai servir o build antigo.' }
    else {
        Write-Output 'Recompilando a interface (o código-fonte é mais novo que o build)...'
        Push-Location $frontend
        try {
            # Via cmd: no Windows PowerShell, a saída de erro de um programa nativo interromperia o script.
            $buildLog = Join-Path $data 'logs\frontend-build.log'
            if (-not (Test-Path -LiteralPath (Join-Path $frontend 'node_modules'))) {
                cmd.exe /d /c "npm ci --no-audit --no-fund > ""$buildLog"" 2>&1"
                if ($LASTEXITCODE -ne 0) { throw 'A instalação das dependências da interface falhou. Veja data\logs\frontend-build.log.' }
            }
            cmd.exe /d /c "npm run build > ""$buildLog"" 2>&1"
            if ($LASTEXITCODE -ne 0) { throw 'A compilação da interface falhou. Veja data\logs\frontend-build.log.' }
        } finally { Pop-Location }
        Write-Output 'Interface atualizada.'
    }
}
$infoFile = Join-Path $data 'studio-server.json'
if (Test-Path -LiteralPath $pidFile) {
    $oldId = [int](Get-Content -LiteralPath $pidFile)
    $old = Get-CimInstance Win32_Process -Filter "ProcessId = $oldId" -ErrorAction SilentlyContinue
    $sameStart = $true
    if ($old -and (Test-Path -LiteralPath $infoFile)) {
        $savedInfo = Get-Content -LiteralPath $infoFile -Raw | ConvertFrom-Json
        $running = Get-Process -Id $oldId -ErrorAction SilentlyContinue
        $sameStart = $running -and $savedInfo.pid -eq $oldId -and $savedInfo.startTicks -eq $running.StartTime.Ticks
    }
    if ($old -and $sameStart -and $old.Name -eq 'python.exe' -and $old.CommandLine -match '-m\s+prisma_studio\b') {
        if ($Reiniciar) { & (Join-Path $PSScriptRoot 'parar.ps1') }
        else {
            Write-Output 'O Studio já está em execução. Use -Reiniciar para aplicar outra configuração de rede.'
            if (Test-Path -LiteralPath $infoFile) {
                $saved = Get-Content -LiteralPath $infoFile -Raw | ConvertFrom-Json
                Write-Output "Local: http://127.0.0.1:$($saved.port)/"
                if ($saved.lanIp) { Write-Output "Rede local, sem senha: http://$($saved.lanIp):$($saved.port)/" }
                if ($saved.lanAlias) { Write-Output "Alias configurado: http://$($saved.lanAlias):$($saved.port)/" }
            }
            if (-not $SemNavegador) { Start-Process "http://127.0.0.1:$Port/" }
            return
        }
    }
}
$lanAddress = $null
if (-not $SomenteLocal) {
    $privateIndexes = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue |
        Where-Object NetworkCategory -eq 'Private' | Select-Object -ExpandProperty InterfaceIndex)
    $lanAddress = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
        $_.InterfaceIndex -in $privateIndexes -and $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*'
    } | Select-Object -First 1
}
$bindHost = '127.0.0.1'
$network = $null
$arguments = @('-m', 'prisma_studio', '--port', $Port)
$env:PRISMA_ALLOW_NETWORKS = ''
$env:PRISMA_LAN_HOSTS = ''
$env:PRISMA_LAN_ALIAS = ''
$lanAlias = $null
if ($lanAddress) {
    $network = & $py -c 'import ipaddress,sys; print(ipaddress.ip_network(sys.argv[1],strict=False))' "$($lanAddress.IPAddress)/$($lanAddress.PrefixLength)"
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível calcular a sub-rede local.' }
    $bindHost = '0.0.0.0'
    $lanAlias = 'studio.local'
    $arguments += @('--allow-network', $network, '--lan-ip', $lanAddress.IPAddress, '--lan-alias', $lanAlias)
}
$arguments += @('--host', $bindHost)
$env:PRISMA_COMFY_URL = $ComfyUrl
$env:PRISMA_DATA_DIR = $data
$process = Start-Process -FilePath $py -ArgumentList $arguments -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $data 'logs\studio.log') -RedirectStandardError (Join-Path $data 'logs\studio-erros.log')
Set-Content -LiteralPath $pidFile -Value $process.Id
@{pid=$process.Id; startTicks=$process.StartTime.Ticks; port=$Port; host=$bindHost;
  lanIp=$lanAddress.IPAddress; lanAlias=$lanAlias; allowedNetwork=$network} | ConvertTo-Json | Set-Content -LiteralPath $infoFile
$ready = $false
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    $process.Refresh()
    if ($process.HasExited) { throw 'O Studio encerrou durante a inicialização. Veja data\logs\studio-erros.log.' }
    try {
        $health = Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
        if (($lanAddress -and $health.network_access.mode -eq 'lan') -or
            (-not $lanAddress -and $health.network_access.mode -ne 'lan')) { $ready = $true; break }
    } catch { }
}
if (-not $ready) { throw 'O Studio não confirmou a inicialização. Veja data\logs\studio-erros.log.' }
Write-Output "Prisma Studio: http://127.0.0.1:$Port/"
if ($lanAddress) { Write-Output "Rede local, sem senha: http://$($lanAddress.IPAddress):$Port/ (somente $network)" }
else { Write-Output 'Acesso somente neste computador; nenhuma rede privada foi selecionada.' }
if ($lanAlias) {
    if ($health.network_access.mdns.status -eq 'advertising') { Write-Output "Alias mDNS: http://$($lanAlias):$Port/" }
    else { Write-Warning "Alias mDNS indisponível: $($health.network_access.mdns.error)" }
}
if (-not $SemNavegador) { Start-Process "http://127.0.0.1:$Port/" }
