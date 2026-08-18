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

$script:UiAlreadyRunning = $false
$script:UiExeExists = $false
$script:UiLaunchShouldThrow = $false
$script:UiLaunchStarted = $null
$script:SleepCalls = 0
$script:GetProcessNames = New-Object System.Collections.Generic.List[string]

function Get-Process {
    [CmdletBinding()]
    param(
        [Parameter(Position = 0)]
        [string[]]$Name
    )

    foreach ($processName in @($Name)) {
        $script:GetProcessNames.Add($processName)
        if ($processName -eq 'tailscale' -or $processName -like 'tailscale.exe') {
            throw 'Start-TailscaleClient must not query tailscale.exe as a UI process.'
        }
    }

    if ($script:UiAlreadyRunning) {
        return @([pscustomobject]@{ Name = 'tailscale-ipn'; Id = 4242 })
    }
    return @()
}

function Start-Process {
    [CmdletBinding()]
    param([string]$FilePath)

    if ($FilePath -like '*\tailscale.exe') {
        throw 'Start-TailscaleClient must not launch tailscale.exe as a GUI fallback.'
    }
    if ($script:UiLaunchShouldThrow) {
        throw 'simulated UI launch failure'
    }
    $script:UiLaunchStarted = $FilePath
}

function Start-Sleep {
    [CmdletBinding()]
    param(
        [int]$Milliseconds,
        [int]$Seconds
    )
    $script:SleepCalls++
}

function Test-Path {
    [CmdletBinding()]
    param(
        [string]$LiteralPath,
        [string]$Path,
        [string]$PathType
    )

    $target = $LiteralPath
    if (-not $target) {
        $target = $Path
    }
    if ($target -like '*\Tailscale\tailscale.exe') {
        throw 'Start-TailscaleClient must not use tailscale.exe as a GUI fallback.'
    }
    if ($target -like '*\Tailscale\tailscale-ipn.exe') {
        return [bool]$script:UiExeExists
    }
    return $false
}

function Reset-UiLaunchTestState {
    $script:UiAlreadyRunning = $false
    $script:UiExeExists = $false
    $script:UiLaunchShouldThrow = $false
    $script:UiLaunchStarted = $null
    $script:SleepCalls = 0
    $script:GetProcessNames.Clear()
}

Set-StrictMode -Version Latest

Reset-UiLaunchTestState
$script:UiAlreadyRunning = $true
$alreadyOpen = Start-TailscaleClient *>&1 | Out-String
Assert-True ($null -eq $script:UiLaunchStarted) 'An already-running tailscale-ipn UI must not be launched again.'
Assert-True ($script:SleepCalls -eq 0) 'An already-running UI must not wait before reporting that it is open.'
Assert-True ($alreadyOpen -match 'Tailscale client is already open') 'An already-running UI must print a clean informational message.'
Assert-True ($script:GetProcessNames -contains 'tailscale-ipn') 'Start-TailscaleClient must look for an existing tailscale-ipn process.'
Assert-False ($script:GetProcessNames -contains 'tailscale') 'Start-TailscaleClient must not treat tailscale.exe as a UI process.'

Reset-UiLaunchTestState
$script:UiExeExists = $true
$opened = Start-TailscaleClient *>&1 | Out-String
Assert-True ($script:SleepCalls -ge 10) 'Start-TailscaleClient must wait briefly for an MSI-started UI before launching one.'
Assert-True ($script:UiLaunchStarted -like '*\Tailscale\tailscale-ipn.exe') 'Only tailscale-ipn.exe may be launched as the Tailscale UI.'
Assert-False ($script:UiLaunchStarted -like '*\tailscale.exe') 'tailscale.exe must not be used as a GUI fallback.'
Assert-True ($opened -match 'Opened the Tailscale client') 'A successful convenience launch must print that the client was opened.'

Reset-UiLaunchTestState
$missing = $null
try {
    $missing = Start-TailscaleClient *>&1 | Out-String
} catch {
    throw 'A missing Tailscale UI executable must not fail the successful installation.'
}
Assert-True ($null -eq $script:UiLaunchStarted) 'A missing UI executable must not launch anything.'
Assert-True ($missing -match 'could not be opened automatically') 'A missing UI executable must print a non-fatal warning.'
Assert-False ($missing -match 'Installation stopped') 'UI-launch failure must not report that installation stopped.'

Reset-UiLaunchTestState
$script:UiExeExists = $true
$script:UiLaunchShouldThrow = $true
$failedLaunch = $null
try {
    $failedLaunch = Start-TailscaleClient *>&1 | Out-String
} catch {
    throw 'A Tailscale UI launch exception must stay inside Start-TailscaleClient.'
}
Assert-True ($failedLaunch -match 'could not be opened automatically') 'A UI launch exception must print a non-fatal warning.'
Assert-False ($failedLaunch -match 'Installation stopped') 'A UI launch exception must not report that installation stopped.'

Write-Output 'START_TAILSCALE_CLIENT_TESTS_PASSED'
