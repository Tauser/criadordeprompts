# Verificação completa sem GPU: lint, testes do servidor e, se o Node estiver instalado, da interface.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$py = Join-Path $root '.venv\Scripts\python.exe'
Push-Location (Join-Path $root 'backend')
try {
    & $py -m ruff check src tests ..\scripts
    if ($LASTEXITCODE -ne 0) { throw 'Lint do servidor falhou.' }
    & $py -m pytest -q
    if ($LASTEXITCODE -ne 0) { throw 'Testes do servidor falharam.' }
} finally { Pop-Location }
if (Get-Command npm -ErrorAction SilentlyContinue) {
    Push-Location (Join-Path $root 'frontend')
    try {
        if (-not (Test-Path node_modules)) { npm ci --no-audit --no-fund }
        npm run typecheck; if ($LASTEXITCODE -ne 0) { throw 'Tipos da interface com erro.' }
        npm test; if ($LASTEXITCODE -ne 0) { throw 'Testes da interface falharam.' }
    } finally { Pop-Location }
} else { Write-Output 'Node não encontrado: testes da interface ignorados.' }
Write-Output 'Verificação concluída sem enviar trabalhos ao ComfyUI.'
