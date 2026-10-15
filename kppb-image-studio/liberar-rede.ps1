#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
$ruleName = 'GeraImg-KPPB-Studio-LAN-8770'
$existing = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
if ($existing) {
    Set-NetFirewallRule -Name $ruleName -Enabled True -Profile Private -Action Allow -Direction Inbound
    $existing | Get-NetFirewallPortFilter | Set-NetFirewallPortFilter -Protocol TCP -LocalPort 8770
    $existing | Get-NetFirewallAddressFilter | Set-NetFirewallAddressFilter -RemoteAddress LocalSubnet
} else {
    New-NetFirewallRule -Name $ruleName -DisplayName 'GeraImg KPPB Studio - rede local (8770)' -Description 'Acesso ao Studio sem senha, somente sub-rede local no perfil Privado.' -Direction Inbound -Action Allow -Enabled True -Profile Private -Protocol TCP -LocalPort 8770 -RemoteAddress LocalSubnet | Out-Null
}
Get-NetFirewallRule -Name $ruleName | Select-Object Name,Enabled,Profile,Action | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'firewall-rede.json')
