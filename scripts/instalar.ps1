# Cria o ambiente Python do Studio em .venv e instala as dependências.
param([string]$Python = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
if (-not $Python) {
    $candidates = @()
    if (Get-Command py -ErrorAction SilentlyContinue) {
        foreach ($v in '3.13', '3.12', '3.11', '3.10') {
            $exe = & py "-$v" -c 'import sys; print(sys.executable)' 2>$null
            if ($LASTEXITCODE -eq 0 -and $exe) { $candidates += $exe.Trim() }
        }
    }
    $candidates += @((Get-Command python -ErrorAction SilentlyContinue).Source,
                     "$env:USERPROFILE\.platformio\python3\python.exe") | Where-Object { $_ }
    foreach ($candidate in $candidates) {
        if (-not (Test-Path -LiteralPath $candidate)) { continue }
        $ok = & $candidate -c 'import sys, venv; print(sys.version_info >= (3, 10))' 2>$null
        if ($ok -eq 'True') { $Python = $candidate; break }
    }
}
if (-not $Python) { throw 'Python 3.10 ou mais novo não encontrado. Informe -Python caminho\python.exe.' }
$venv = Join-Path $root '.venv'
if (-not (Test-Path (Join-Path $venv 'Scripts\python.exe'))) {
    & $Python -m venv $venv
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível criar o ambiente Python.' }
}
$py = Join-Path $venv 'Scripts\python.exe'
& $py -m pip install --upgrade pip --quiet
& $py -m pip install -e "$root\backend[dev]" --quiet
if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar as dependências.' }
Write-Output "Ambiente pronto em $venv. Inicie com scripts\iniciar.ps1."
