param([string]$Python = 'python')
$ErrorActionPreference = 'Stop'
$environmentPath = Join-Path $PSScriptRoot '.venv-mcp'
$pythonPath = Join-Path $environmentPath 'Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) {
    & $Python -m venv $environmentPath
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível criar o ambiente Python.' }
}
& $pythonPath -m pip install -r (Join-Path $PSScriptRoot 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível instalar as dependências.' }
Write-Output 'Ambiente pronto. Inicie o Studio com kppb-image-studio\iniciar.ps1.'
