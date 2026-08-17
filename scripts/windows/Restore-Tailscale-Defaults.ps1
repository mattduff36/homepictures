#Requires -Version 5.1
<#
.SYNOPSIS
  Removes only Tailscale policies written by the HomePictures camera installer.

.DESCRIPTION
  Reads C:\ProgramData\MPDEE\HomePictures\homepictures-tailscale-record.json
  and deletes a policy value only when all of these are true:

  - the record was created by HomePictures for the camera-viewing client
  - the name is one of the five camera-safe policies
  - the recorded value is the HomePictures camera value
  - the live registry value still matches that recorded value

  This script never uninstalls Tailscale, never signs anyone out, and never
  deletes Tailscale policies that HomePictures did not record.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$StateDir = Join-Path $env:ProgramData 'MPDEE\HomePictures'
$RecordPath = Join-Path $StateDir 'homepictures-tailscale-record.json'
$PolicyKeyPath = 'HKLM:\SOFTWARE\Policies\Tailscale'

$AllowedCameraPolicies = @{
    UseTailscaleDNSSettings   = 'always'
    UseTailscaleSubnets       = 'never'
    AllowIncomingConnections  = 'never'
    AdvertiseExitNode         = 'never'
    ExitNodesPicker           = 'hide'
}

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Write-Info {
    param([string]$Message)
    Write-Host $Message
}

if (-not (Test-IsAdministrator)) {
    throw "This restore script must be run from an elevated PowerShell window."
}

if (-not (Test-Path -LiteralPath $RecordPath)) {
    throw @"
No HomePictures install record was found at:
  $RecordPath

This script will not change Tailscale policies without that record.
"@
}

$record = Get-Content -LiteralPath $RecordPath -Raw -Encoding UTF8 | ConvertFrom-Json

if ($record.appliedBy -ne 'HomePictures') {
    throw "The install record was not created by HomePictures. No policies were changed."
}

if ($record.purpose -ne 'camera-viewing-client') {
    throw "The install record is not a HomePictures camera-viewing record. No policies were changed."
}

if ([int]$record.schemaVersion -ne 1) {
    throw "The install record uses an unsupported schema. No policies were changed."
}

if ($record.policyKey -ne 'HKLM\SOFTWARE\Policies\Tailscale') {
    throw "The install record points at an unexpected policy key. No policies were changed."
}

if (-not $record.policies) {
    throw "The install record does not list any policies. No policies were changed."
}

$removed = New-Object System.Collections.Generic.List[string]
$leftAlone = New-Object System.Collections.Generic.List[string]

if (Test-Path -LiteralPath $PolicyKeyPath) {
    foreach ($policy in $record.policies) {
        $name = [string]$policy.name
        $expected = [string]$policy.value

        if (-not $AllowedCameraPolicies.ContainsKey($name)) {
            $leftAlone.Add("$name (not a HomePictures camera policy)")
            continue
        }

        if ($expected -cne $AllowedCameraPolicies[$name]) {
            $leftAlone.Add("$name (record value is not a HomePictures camera value)")
            continue
        }

        $valueNames = (Get-Item -LiteralPath $PolicyKeyPath).GetValueNames()
        if ($valueNames -notcontains $name) {
            $leftAlone.Add("$name (already absent)")
            continue
        }

        $current = [string](Get-ItemPropertyValue -LiteralPath $PolicyKeyPath -Name $name)
        if ($current -cne $expected) {
            $leftAlone.Add("$name (value changed since HomePictures installed it)")
            continue
        }

        Remove-ItemProperty -LiteralPath $PolicyKeyPath -Name $name
        $removed.Add($name)
    }

    $remaining = (Get-Item -LiteralPath $PolicyKeyPath).GetValueNames()
    if ($remaining.Count -eq 0 -and $record.createdPolicyKey -eq $true) {
        Remove-Item -LiteralPath $PolicyKeyPath
        Write-Info "Removed the empty HomePictures-created policy key."
    }
} else {
    Write-Info "The Tailscale policy key is already absent."
}

Write-Info ""
Write-Info "Removed HomePictures camera policies: $(if ($removed.Count) { $removed -join ', ' } else { 'none' })"
if ($leftAlone.Count) {
    Write-Info "Left untouched: $($leftAlone -join '; ')"
}
Write-Info "Tailscale itself was not uninstalled or signed out."
