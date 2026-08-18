#Requires -Version 5.1
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$paths = @(
    (Join-Path $root 'public\Install-CCTV-Tailscale.ps1')
    (Join-Path $root 'scripts\windows\Restore-Tailscale-Defaults.ps1')
    (Join-Path $root 'scripts\windows\state-directory.test.ps1')
    (Join-Path $root 'scripts\windows\strict-mode-properties.test.ps1')
    (Join-Path $root 'scripts\windows\start-tailscale-client.test.ps1')
    (Join-Path $root 'scripts\windows\parse-check.ps1')
)

$failed = $false
foreach ($path in $paths) {
    $errors = $null
    $null = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$null, [ref]$errors)
    if ($errors -and $errors.Count -gt 0) {
        $failed = $true
        Write-Host "PARSE FAIL $path"
        foreach ($parseError in $errors) {
            Write-Host $parseError.ToString()
        }
    } else {
        Write-Host "PARSE OK $path"
    }
}

if ($failed) {
    exit 1
}

Write-Output 'POWERSHELL_PARSE_CHECKS_PASSED'
