#Requires -Version 5.1
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$installerPath = Join-Path $PSScriptRoot '..\..\public\Install-CCTV-Tailscale.ps1'
$installerPath = [System.IO.Path]::GetFullPath($installerPath)
if (-not (Test-Path -LiteralPath $installerPath)) {
    throw "Installer not found at $installerPath"
}

$source = Get-Content -LiteralPath $installerPath -Raw -Encoding UTF8
$parts = $source -split '#region HomePictures-Main'
if ($parts.Count -lt 2) {
    throw 'Installer is missing the HomePictures-Main region used for function tests.'
}

$prefix = $parts[0]
$prefix = $prefix -replace '#Requires -Version 5\.1', ''
$prefix = $prefix -replace '\[CmdletBinding\(\)\]\s*param\(\)', ''

. ([scriptblock]::Create($prefix))

function Assert-True {
    param([bool]$Value, [string]$Message)
    if (-not $Value) {
        throw $Message
    }
}

function Assert-False {
    param([bool]$Value, [string]$Message)
    if ($Value) {
        throw $Message
    }
}

Set-StrictMode -Version Latest

$missingDisplayName = [pscustomobject]@{
    PSChildName = 'NoDisplayName'
    Publisher   = 'Contoso'
}

$threwOnDirectAccess = $false
try {
    $null = $missingDisplayName.DisplayName
} catch {
    $threwOnDirectAccess = $_.Exception.Message -match 'DisplayName'
}
Assert-True $threwOnDirectAccess 'StrictMode should still reject a direct missing DisplayName read.'

$skipped = Test-IsTailscaleUninstallDisplayName $missingDisplayName
Assert-False $skipped 'An uninstall object without DisplayName must be skipped, not treated as Tailscale.'
Assert-False (Test-IsTailscaleUninstallDisplayName $null) 'A null uninstall object must be skipped.'

$nullDisplayName = [pscustomobject]@{ DisplayName = $null }
Assert-False (Test-IsTailscaleUninstallDisplayName $nullDisplayName) 'A null DisplayName must not match Tailscale.'

$emptyDisplayName = [pscustomobject]@{ DisplayName = '' }
Assert-False (Test-IsTailscaleUninstallDisplayName $emptyDisplayName) 'An empty DisplayName must not match Tailscale.'

$unrelated = [pscustomobject]@{ DisplayName = 'Notepad++' }
Assert-False (Test-IsTailscaleUninstallDisplayName $unrelated) 'An unrelated DisplayName must not match Tailscale.'

$exact = [pscustomobject]@{ DisplayName = 'Tailscale' }
Assert-True (Test-IsTailscaleUninstallDisplayName $exact) 'DisplayName Tailscale must match.'

$prefixed = [pscustomobject]@{ DisplayName = 'Tailscale 1.84.0' }
Assert-True (Test-IsTailscaleUninstallDisplayName $prefixed) 'A DisplayName beginning Tailscale must match.'

$mixed = @(
    $missingDisplayName
    $nullDisplayName
    $emptyDisplayName
    $unrelated
    $exact
)
$found = $false
foreach ($app in $mixed) {
    if (Test-IsTailscaleUninstallDisplayName $app) {
        $found = $true
        break
    }
}
Assert-True $found 'A mixed uninstall list must find Tailscale after skipping incomplete entries.'

$missingValue = Get-StrictProperty -Object $missingDisplayName -Name 'DisplayName'
if ($null -ne $missingValue) {
    throw 'Get-StrictProperty must return null when DisplayName is absent.'
}

$installed = Test-TailscaleAlreadyInstalled
if ($installed -isnot [bool]) {
    throw 'Test-TailscaleAlreadyInstalled must return a boolean on this machine.'
}

Write-Output 'STRICT_MODE_PROPERTY_TESTS_PASSED'
