# Executar uma vez com permissões administrativas para liberar somente a LAN privada.
param([ValidateRange(1,65535)][int]$Port = 8780)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$privateIndexes = @(Get-NetConnectionProfile | Where-Object NetworkCategory -eq 'Private' |
    Select-Object -ExpandProperty InterfaceIndex)
$lanAddress = Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
    $_.InterfaceIndex -in $privateIndexes -and $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*'
} | Select-Object -First 1
if (-not $lanAddress) { throw 'Nenhuma interface IPv4 em rede privada foi encontrada.' }
$py = Join-Path $root '.venv\Scripts\python.exe'
$network = & $py -c 'import ipaddress,sys; print(ipaddress.ip_network(sys.argv[1],strict=False))' "$($lanAddress.IPAddress)/$($lanAddress.PrefixLength)"
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível calcular a sub-rede local.' }
$ruleName = 'PrismaStudio-LAN-' + $Port + '-' + ($network -replace '[./:]', '-')
$existing = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
if (-not $existing) {
    New-NetFirewallRule -Name $ruleName -DisplayName "Prisma Studio LAN TCP $Port" -Group 'Prisma Studio' `
        -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -LocalAddress $lanAddress.IPAddress `
        -RemoteAddress $network -Profile Private -Enabled True -ErrorAction Stop | Out-Null
}
$confirmed = Get-NetFirewallRule -Name $ruleName -ErrorAction Stop
if ($confirmed.Enabled -ne 'True' -or $confirmed.Action -ne 'Allow' -or $confirmed.Profile -ne 'Private' -or
    $confirmed.Direction -ne 'Inbound') {
    throw 'A regra existente não corresponde ao acesso privado solicitado.'
}
$ports = $confirmed | Get-NetFirewallPortFilter -ErrorAction Stop
$addresses = $confirmed | Get-NetFirewallAddressFilter -ErrorAction Stop
$remoteAddresses = @($addresses.RemoteAddress)
if ($remoteAddresses.Count -ne 1) { throw 'A regra não está restrita a uma única sub-rede.' }
$confirmedNetwork = & $py -c 'import ipaddress,sys; print(ipaddress.ip_network(sys.argv[1],strict=False))' $remoteAddresses[0]
if ($LASTEXITCODE -ne 0 -or $confirmedNetwork -ne $network -or $ports.Protocol -ne 'TCP' -or
    [string]$ports.LocalPort -ne [string]$Port -or [string]$addresses.LocalAddress -ne $lanAddress.IPAddress) {
    throw 'A porta ou os endereços da regra existente não correspondem à LAN selecionada.'
}
Write-Output "Firewall: TCP $Port liberada na rede privada $network, endereço $($lanAddress.IPAddress)."
