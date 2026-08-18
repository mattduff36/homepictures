#Requires -Version 5.1
<#
.SYNOPSIS
  Installs the official Tailscale Windows client with camera-safe policies.

.DESCRIPTION
  HomePictures camera-viewing installer. This script contains no passwords,
  Tailscale share links, camera URLs, auth keys, or other secrets.

  If Tailscale is already installed, the script makes no changes and tells
  you to return to the Camera Access page.

  If this PC already has Tailscale policies under
  HKLM\SOFTWARE\Policies\Tailscale, those policies are left untouched.

  On a fresh PC it downloads the current stable installer from
  https://pkgs.tailscale.com/stable/, verifies the SHA-256 checksum and a
  valid Tailscale Authenticode signature, writes camera-safe machine
  policies, then installs Tailscale. Sign-in stays the official Tailscale
  browser login. No auth key is used.

.NOTES
  Public, auditable script. Safe to read before running.
  Trusted state is stored only in C:\ProgramData\MPDEE-HomePictures.
  Restore script: C:\ProgramData\MPDEE-HomePictures\Restore-Tailscale-Defaults.ps1
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$OfficialPackageRoot = 'https://pkgs.tailscale.com/stable/'
$PolicyKeyPath = 'HKLM:\SOFTWARE\Policies\Tailscale'
$PolicyKeyDisplay = 'HKLM\SOFTWARE\Policies\Tailscale'
$StateDir = Join-Path $env:ProgramData 'MPDEE-HomePictures'
$RecordPath = Join-Path $StateDir 'homepictures-tailscale-record.json'
$RestorePath = Join-Path $StateDir 'Restore-Tailscale-Defaults.ps1'
$ExpectedSignerCn = 'Tailscale Inc.'

$CameraSafePolicies = @(
    @{ Name = 'UseTailscaleDNSSettings'; Value = 'always' }
    @{ Name = 'UseTailscaleSubnets'; Value = 'never' }
    @{ Name = 'AllowIncomingConnections'; Value = 'never' }
    @{ Name = 'AdvertiseExitNode'; Value = 'never' }
    @{ Name = 'ExitNodesPicker'; Value = 'hide' }
)

$script:TempDirectory = $null
$script:CreatedPolicyKey = $false
$script:CreatedStateDir = $false
$script:WroteStateFiles = $false
$script:WrotePolicyNames = New-Object System.Collections.Generic.List[string]
$script:PoliciesApplied = $false
$script:SkipWait = $false

function Write-Info {
    param([string]$Message)
    Write-Host $Message
}

function Write-Ok {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Green
}

function Write-WarnLine {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Yellow
}

function Wait-ForReader {
    $hostName = Get-StrictProperty -Object $Host -Name 'Name'
    if ($hostName -eq 'ConsoleHost') {
        Write-Host ""
        Write-Host "Press Enter to close this window."
        try {
            [void][Console]::ReadLine()
        } catch {
            Start-Sleep -Seconds 8
        }
    }
}

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-StrictProperty {
    param(
        $Object,
        [Parameter(Mandatory)][string]$Name
    )

    if ($null -eq $Object) {
        return $null
    }

    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $null
    }

    return $property.Value
}

function Test-IsTailscaleUninstallDisplayName {
    param($App)

    if ($null -eq $App) {
        return $false
    }

    $displayNameProperty = $App.PSObject.Properties['DisplayName']
    if ($null -eq $displayNameProperty) {
        return $false
    }

    $displayName = [string]$displayNameProperty.Value
    return ($displayName -eq 'Tailscale' -or $displayName -like 'Tailscale *')
}

function Get-NativeProcessorArchitecture {
    if ($env:PROCESSOR_ARCHITEW6432) {
        return $env:PROCESSOR_ARCHITEW6432
    }
    return $env:PROCESSOR_ARCHITECTURE
}

function Test-SupportedWindows {
    $os = Get-CimInstance -ClassName Win32_OperatingSystem
    $buildValue = Get-StrictProperty -Object $os -Name 'BuildNumber'
    $versionValue = Get-StrictProperty -Object $os -Name 'Version'
    $productType = Get-StrictProperty -Object $os -Name 'ProductType'
    $caption = Get-StrictProperty -Object $os -Name 'Caption'

    if ($null -eq $buildValue -or $null -eq $versionValue -or $null -eq $productType) {
        throw "Windows environment check failed because required operating-system properties were missing."
    }

    $build = [int]$buildValue
    $version = [version]$versionValue
    $captionText = if ($null -ne $caption) { [string]$caption } else { 'Windows' }

    if ([int]$productType -ne 1) {
        throw "This installer is for Windows 10 or Windows 11 PCs. Server editions are not supported."
    }

    if ($version.Major -lt 10 -or $build -lt 10240) {
        throw "Windows 10 or Windows 11 is required. Detected $captionText (build $build)."
    }

    Write-Info "Windows check passed: $captionText (build $build)."
}

function Test-TailscaleAlreadyInstalled {
    $installPaths = @(
        (Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe')
        (Join-Path $env:ProgramFiles 'Tailscale\tailscale-ipn.exe')
    )
    if (${env:ProgramFiles(x86)}) {
        $installPaths += @(
            (Join-Path ${env:ProgramFiles(x86)} 'Tailscale\tailscale.exe')
            (Join-Path ${env:ProgramFiles(x86)} 'Tailscale\tailscale-ipn.exe')
        )
    }

    foreach ($path in $installPaths) {
        if (Test-Path -LiteralPath $path) {
            return $true
        }
    }

    $services = @(Get-Service -ErrorAction SilentlyContinue)
    foreach ($service in $services) {
        $serviceName = [string](Get-StrictProperty -Object $service -Name 'Name')
        $serviceDisplayName = [string](Get-StrictProperty -Object $service -Name 'DisplayName')
        if ($serviceName -match 'tailscale' -or $serviceDisplayName -match 'tailscale') {
            return $true
        }
    }

    $processes = Get-Process -Name 'tailscale','tailscale-ipn' -ErrorAction SilentlyContinue
    if ($processes) {
        return $true
    }

    $uninstallRoots = @(
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )
    foreach ($root in $uninstallRoots) {
        $apps = @(Get-ItemProperty -Path $root -ErrorAction SilentlyContinue)
        foreach ($app in $apps) {
            if (Test-IsTailscaleUninstallDisplayName $app) {
                return $true
            }
        }
    }

    $stateRoots = @(
        'HKLM:\SOFTWARE\Tailscale IPN'
        'HKLM:\SOFTWARE\WOW6432Node\Tailscale IPN'
    )
    foreach ($root in $stateRoots) {
        if (Test-Path -LiteralPath $root) {
            return $true
        }
    }

    $command = Get-Command -Name tailscale -ErrorAction SilentlyContinue
    if ($command) {
        return $true
    }

    return $false
}

function Show-ExistingInstallMessage {
    Write-Host ""
    Write-Ok "Tailscale is already installed on this PC."
    Write-Host ""
    Write-Info "HomePictures has left your existing Tailscale installation untouched."
    Write-Info "No settings, registry policies, exit nodes, DNS, subnets, or login state were changed."
    Write-Info "Tailscale was not reinstalled and was not signed out."
    Write-Host ""
    Write-Info "Return to the Camera Access page and continue with Connect Camera Access."
}

function Get-ManagedPolicyInspection {
    try {
        if (-not (Test-Path -LiteralPath $PolicyKeyPath)) {
            return 'none'
        }

        $names = @((Get-Item -LiteralPath $PolicyKeyPath).GetValueNames())
        if ($names.Count -gt 0) {
            return 'managed'
        }
        return 'none'
    } catch {
        return 'unreadable'
    }
}

function Show-UnreadablePolicyMessage {
    Write-Host ""
    Write-WarnLine "This computer has a Tailscale policy location that could not be read."
    Write-Info "HomePictures will not request administrator permission or change settings."
    Write-Info "Nothing was installed and no settings were changed."
    Write-Host ""
    Write-Info "Return to the Camera Access page and continue with Connect Camera Access."
}

function Test-NotReparsePoint {
    param([Parameter(Mandatory)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    $item = Get-Item -LiteralPath $Path -Force
    $attributes = Get-StrictProperty -Object $item -Name 'Attributes'
    if ($null -eq $attributes) {
        throw "Could not read filesystem attributes for $Path."
    }
    if ($attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Refusing to use a reparse point at $Path."
    }
}

function New-AdminOnlyDirectoryAcl {
    $acl = New-Object System.Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $adminSid = New-Object System.Security.Principal.SecurityIdentifier 'S-1-5-32-544'
    $systemSid = New-Object System.Security.Principal.SecurityIdentifier 'S-1-5-18'
    $acl.SetOwner($adminSid)
    foreach ($sid in @($adminSid, $systemSid)) {
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            $sid,
            'FullControl',
            'ContainerInherit,ObjectInherit',
            'None',
            'Allow'
        )
        $acl.AddAccessRule($rule) | Out-Null
    }
    return $acl
}

function New-AdminOnlyFileAcl {
    $acl = New-Object System.Security.AccessControl.FileSecurity
    $acl.SetAccessRuleProtection($true, $false)
    $adminSid = New-Object System.Security.Principal.SecurityIdentifier 'S-1-5-32-544'
    $systemSid = New-Object System.Security.Principal.SecurityIdentifier 'S-1-5-18'
    $acl.SetOwner($adminSid)
    foreach ($sid in @($adminSid, $systemSid)) {
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            $sid,
            'FullControl',
            'Allow'
        )
        $acl.AddAccessRule($rule) | Out-Null
    }
    return $acl
}

function Resolve-IdentitySid {
    param($IdentityReference)

    if ($null -eq $IdentityReference) {
        return $null
    }

    try {
        return $IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
    } catch {
    }

    $value = [string](Get-StrictProperty -Object $IdentityReference -Name 'Value')
    if ($value -match '^S-\d-') {
        return $value
    }

    try {
        return (New-Object System.Security.Principal.NTAccount ([string]$IdentityReference)).Translate(
            [System.Security.Principal.SecurityIdentifier]
        ).Value
    } catch {
        return $null
    }
}

function Test-IsPrivilegedIdentity {
    param($IdentityReference)

    $sid = Resolve-IdentitySid $IdentityReference
    return $sid -in @('S-1-5-32-544', 'S-1-5-18')
}

function Get-WriteCapableRights {
    return [System.Security.AccessControl.FileSystemRights]::Write -bor
        [System.Security.AccessControl.FileSystemRights]::Modify -bor
        [System.Security.AccessControl.FileSystemRights]::FullControl -bor
        [System.Security.AccessControl.FileSystemRights]::CreateDirectories -bor
        [System.Security.AccessControl.FileSystemRights]::CreateFiles -bor
        [System.Security.AccessControl.FileSystemRights]::Delete -bor
        [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
        [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
        [System.Security.AccessControl.FileSystemRights]::TakeOwnership
}

function Get-DirectoryOwnerSid {
    param([Parameter(Mandatory)][string]$Path)

    $acl = Get-Acl -LiteralPath $Path
    try {
        $owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier])
        $sid = Get-StrictProperty -Object $owner -Name 'Value'
        if ($sid) {
            return $sid
        }
    } catch {
    }

    return Resolve-IdentitySid (Get-StrictProperty -Object $acl -Name 'Owner')
}

function Test-DirectoryOwnerIsPrivileged {
    param([Parameter(Mandatory)][string]$Path)

    return (Get-DirectoryOwnerSid $Path) -in @('S-1-5-32-544', 'S-1-5-18')
}

function Test-DirectoryIsAdminControlled {
    param([Parameter(Mandatory)][string]$Path)

    if (-not (Test-DirectoryOwnerIsPrivileged $Path)) {
        return $false
    }

    $writeRights = Get-WriteCapableRights
    $acl = Get-Acl -LiteralPath $Path
    $rules = Get-StrictProperty -Object $acl -Name 'Access'
    foreach ($rule in @($rules)) {
        $controlType = Get-StrictProperty -Object $rule -Name 'AccessControlType'
        if ($controlType -ne 'Allow') {
            continue
        }
        $identity = Get-StrictProperty -Object $rule -Name 'IdentityReference'
        if (Test-IsPrivilegedIdentity $identity) {
            continue
        }
        $rights = Get-StrictProperty -Object $rule -Name 'FileSystemRights'
        if ($null -ne $rights -and ($rights -band $writeRights) -ne 0) {
            return $false
        }
    }
    return $true
}

function Assert-ProtectedStateAcl {
    param([Parameter(Mandatory)][string]$Path)

    $acl = Get-Acl -LiteralPath $Path
    $protected = Get-StrictProperty -Object $acl -Name 'AreAccessRulesProtected'
    if ($protected -ne $true) {
        throw "The HomePictures state directory still inherits permissions. Installation stopped."
    }

    if (-not (Test-DirectoryOwnerIsPrivileged $Path)) {
        throw "The HomePictures state directory is not owned by Administrators or SYSTEM. Installation stopped."
    }

    if (-not (Test-DirectoryIsAdminControlled $Path)) {
        throw "The HomePictures state directory is writable by a non-administrator. Installation stopped."
    }

    $writeRights = Get-WriteCapableRights
    $fullControl = [System.Security.AccessControl.FileSystemRights]::FullControl
    $seenAdmin = $false
    $seenSystem = $false
    $rules = Get-StrictProperty -Object $acl -Name 'Access'
    foreach ($rule in @($rules)) {
        $controlType = Get-StrictProperty -Object $rule -Name 'AccessControlType'
        if ($controlType -ne 'Allow') {
            continue
        }
        $identity = Get-StrictProperty -Object $rule -Name 'IdentityReference'
        $rights = Get-StrictProperty -Object $rule -Name 'FileSystemRights'
        if ($null -eq $identity -or $null -eq $rights) {
            throw "The HomePictures state directory ACL could not be verified. Installation stopped."
        }
        if (-not (Test-IsPrivilegedIdentity $identity)) {
            if (($rights -band $writeRights) -ne 0) {
                throw "The HomePictures state directory grants write access to a non-administrator. Installation stopped."
            }
            continue
        }

        $sid = Resolve-IdentitySid $identity
        if (($rights -band $fullControl) -eq $fullControl) {
            if ($sid -eq 'S-1-5-32-544') { $seenAdmin = $true }
            if ($sid -eq 'S-1-5-18') { $seenSystem = $true }
        }
    }

    if (-not $seenAdmin -or -not $seenSystem) {
        throw "The HomePictures state directory must grant FullControl only to Administrators and SYSTEM. Installation stopped."
    }
}

function Assert-ExistingHomePicturesStateDir {
    if (-not (Test-Path -LiteralPath $StateDir -PathType Container)) {
        throw "C:\ProgramData\MPDEE-HomePictures exists and is not a directory. Installation stopped."
    }

    Test-NotReparsePoint $StateDir
    if (-not (Test-DirectoryIsAdminControlled $StateDir)) {
        throw "C:\ProgramData\MPDEE-HomePictures exists and is writable by a non-administrator. Installation stopped."
    }

    Test-NotReparsePoint $StateDir
    if (-not (Test-DirectoryIsAdminControlled $StateDir)) {
        throw "C:\ProgramData\MPDEE-HomePictures changed during verification. Installation stopped."
    }
}

function Assert-TrustedStateFile {
    param([Parameter(Mandatory)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    if (Test-Path -LiteralPath $Path -PathType Container) {
        throw "A HomePictures state file path exists and is not a file. Installation stopped."
    }

    Test-NotReparsePoint $Path
    if (-not (Test-DirectoryIsAdminControlled $Path)) {
        throw "A HomePictures state file is writable by a non-administrator. Installation stopped."
    }
}

function Protect-HomePicturesStateFile {
    param([Parameter(Mandatory)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "A HomePictures state file was not created as a real file. Installation stopped."
    }

    Test-NotReparsePoint $Path
    Set-Acl -LiteralPath $Path -AclObject (New-AdminOnlyFileAcl)
    Test-NotReparsePoint $Path
    if (-not (Test-DirectoryIsAdminControlled $Path)) {
        throw "A HomePictures state file is writable by a non-administrator. Installation stopped."
    }
}

function Protect-HomePicturesStateDir {
    if (Test-Path -LiteralPath $StateDir) {
        Assert-ExistingHomePicturesStateDir
        return
    }

    try {
        New-Item -ItemType Directory -Path $StateDir | Out-Null
        $script:CreatedStateDir = $true
    } catch {
        if (Test-Path -LiteralPath $StateDir) {
            Assert-ExistingHomePicturesStateDir
            return
        }
        throw
    }

    if (-not (Test-Path -LiteralPath $StateDir -PathType Container)) {
        throw "Failed to create a real HomePictures state directory. Installation stopped."
    }
    Test-NotReparsePoint $StateDir

    Set-Acl -LiteralPath $StateDir -AclObject (New-AdminOnlyDirectoryAcl)

    Test-NotReparsePoint $StateDir
    Assert-ProtectedStateAcl $StateDir

    $planted = @(Get-ChildItem -LiteralPath $StateDir -Force)
    if ($planted.Count -gt 0) {
        throw "The HomePictures state directory was not empty after creation. Installation stopped."
    }
}

function Show-ManagedPolicyMessage {
    Write-Host ""
    Write-WarnLine "This computer already has Tailscale policy settings under:"
    Write-Info "  $PolicyKeyDisplay"
    Write-Host ""
    Write-Info "HomePictures will not overwrite a managed configuration."
    Write-Info "Nothing was installed and no settings were changed."
    Write-Host ""
    Write-Info "If this is a work or school PC, keep using that Tailscale installation."
    Write-Info "Return to the Camera Access page and continue with Connect Camera Access."
}

function Restart-Elevated {
    $currentProcess = [System.Diagnostics.Process]::GetCurrentProcess()
    $mainModule = Get-StrictProperty -Object $currentProcess -Name 'MainModule'
    $hostPath = Get-StrictProperty -Object $mainModule -Name 'FileName'
    if (-not $hostPath) {
        throw "Cannot determine the PowerShell host path, so the installer cannot request administrator permission."
    }
    if (-not $PSCommandPath) {
        throw "Cannot determine the script path, so the installer cannot request administrator permission."
    }

    Write-Info "Administrator permission is required to install Tailscale for camera access."
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""

    try {
        $script:SkipWait = $true
        Start-Process -FilePath $hostPath -Verb RunAs -ArgumentList $arguments | Out-Null
    } catch {
        $script:SkipWait = $false
        throw "The Windows administrator prompt was declined or failed. No changes were made."
    }

    exit 0
}

function Assert-OfficialPackageUri {
    param([Parameter(Mandatory)][uri]$Uri)

    if ($Uri.Scheme -ne 'https') {
        throw "Refusing a non-HTTPS download: $Uri"
    }
    if ($Uri.Host -cne 'pkgs.tailscale.com') {
        throw "Refusing a download host other than pkgs.tailscale.com: $Uri"
    }
    if ($Uri.AbsolutePath -notlike '/stable/*') {
        throw "Refusing a download outside /stable/: $Uri"
    }
    if ($Uri.AbsolutePath -match '\.\.|%2e%2e') {
        throw "Refusing a download path that contains parent-directory segments."
    }
}

function Save-OfficialPackage {
    param(
        [Parameter(Mandatory)][uri]$Uri,
        [Parameter(Mandatory)][string]$Destination
    )

    Assert-OfficialPackageUri $Uri
    Write-Info "Downloading $($Uri.AbsoluteUri)"

    $request = [System.Net.HttpWebRequest]::Create($Uri)
    $request.Method = 'GET'
    $request.AllowAutoRedirect = $false
    $request.UserAgent = 'HomePictures-CCTV-Tailscale-Installer'
    $request.Timeout = 180000
    $request.ReadWriteTimeout = 180000

    $response = $null
    try {
        $response = $request.GetResponse()
        $status = [int]$response.StatusCode
        if ($status -ge 300 -and $status -lt 400) {
            throw "The official package server returned a redirect. Installation stopped without following it."
        }
        if ($status -ne 200) {
            throw "Download failed with HTTP $status."
        }

        $inputStream = $response.GetResponseStream()
        $outputStream = [System.IO.File]::Create($Destination)
        try {
            $inputStream.CopyTo($outputStream)
        } finally {
            $outputStream.Dispose()
            $inputStream.Dispose()
        }
    } finally {
        if ($response) {
            $response.Dispose()
        }
    }
}

function Get-StableInstallerTarget {
    $indexPath = Join-Path $script:TempDirectory 'stable-index.html'
    Save-OfficialPackage -Uri ([uri]$OfficialPackageRoot) -Destination $indexPath
    $html = Get-Content -LiteralPath $indexPath -Raw -Encoding UTF8

    $matches = [regex]::Matches($html, 'tailscale-setup-(\d+\.\d+\.\d+)\.exe')
    if ($matches.Count -eq 0) {
        throw "Could not determine the current stable Tailscale version from https://pkgs.tailscale.com/stable/."
    }

    $versions = $matches | ForEach-Object { [version]$_.Groups[1].Value } | Sort-Object -Unique
    $version = $versions[-1].ToString()

    $native = Get-NativeProcessorArchitecture
    $arch = switch ($native) {
        'AMD64' { 'amd64' }
        'ARM64' { 'arm64' }
        'x86' { 'x86' }
        default { throw "Unsupported Windows architecture: $native" }
    }

    $fileName = "tailscale-setup-$version-$arch.msi"
    if ($fileName -notmatch '^tailscale-setup-\d+\.\d+\.\d+-(amd64|arm64|x86)\.msi$') {
        throw "Refusing unexpected installer filename: $fileName"
    }

    return [pscustomobject]@{
        Version  = $version
        Arch     = $arch
        FileName = $fileName
        Uri      = [uri]($OfficialPackageRoot + $fileName)
        ShaUri   = [uri]($OfficialPackageRoot + $fileName + '.sha256')
    }
}

function Get-ExpectedSha256 {
    param([Parameter(Mandatory)][uri]$ShaUri)

    $shaPath = Join-Path $script:TempDirectory 'installer.sha256'
    Save-OfficialPackage -Uri $ShaUri -Destination $shaPath
    $text = (Get-Content -LiteralPath $shaPath -Raw -Encoding ASCII).Trim()
    if ($text -notmatch '([A-Fa-f0-9]{64})') {
        throw "The official checksum file did not contain a SHA-256 hash. Installation stopped."
    }
    return $Matches[1].ToLowerInvariant()
}

function Assert-FileSha256 {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Expected
    )

    $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -cne $Expected) {
        throw "SHA-256 mismatch. Expected $Expected, calculated $actual. Installation stopped."
    }
    Write-Info "SHA-256 checksum matched."
}

function Assert-TailscaleAuthenticode {
    param([Parameter(Mandatory)][string]$Path)

    $signature = Get-AuthenticodeSignature -FilePath $Path
    if (-not $signature) {
        throw "Authenticode signature could not be read. Installation stopped."
    }
    if ($signature.Status -ne 'Valid') {
        throw "Authenticode signature is not valid ($($signature.Status)). Installation stopped."
    }
    if (-not $signature.SignerCertificate) {
        throw "Authenticode signature has no signer certificate. Installation stopped."
    }

    $subject = Get-StrictProperty -Object $signature.SignerCertificate -Name 'Subject'
    if ($null -eq $subject) {
        throw "Authenticode signer subject could not be read. Installation stopped."
    }
    $commonName = $null
    if ($subject -match 'CN=([^,]+)') {
        $commonName = $Matches[1].Trim()
    }
    if ($commonName -cne $ExpectedSignerCn) {
        throw "Authenticode signer is not $ExpectedSignerCn (found: $subject). Installation stopped."
    }

    Write-Info "Authenticode signature is valid and belongs to $ExpectedSignerCn."
}

function Undo-HomePicturesPolicies {
    $shouldUndo = $script:PoliciesApplied -or
        $script:WrotePolicyNames.Count -gt 0 -or
        $script:CreatedPolicyKey -or
        $script:CreatedStateDir -or
        $script:WroteStateFiles
    if (-not $shouldUndo) {
        return
    }

    Write-WarnLine "Rolling back HomePictures Tailscale policies."

    if (Test-Path -LiteralPath $PolicyKeyPath) {
        foreach ($name in @($script:WrotePolicyNames)) {
            $valueNames = (Get-Item -LiteralPath $PolicyKeyPath).GetValueNames()
            if ($valueNames -contains $name) {
                Remove-ItemProperty -LiteralPath $PolicyKeyPath -Name $name -ErrorAction SilentlyContinue
            }
        }

        $remaining = @()
        if (Test-Path -LiteralPath $PolicyKeyPath) {
            $remaining = (Get-Item -LiteralPath $PolicyKeyPath).GetValueNames()
        }
        if ($script:CreatedPolicyKey -and $remaining.Count -eq 0 -and (Test-Path -LiteralPath $PolicyKeyPath)) {
            Remove-Item -LiteralPath $PolicyKeyPath -ErrorAction SilentlyContinue
        }
    }

    $stateDirSafe = $false
    if (Test-Path -LiteralPath $StateDir) {
        try {
            Test-NotReparsePoint $StateDir
            $stateDirSafe = $true
        } catch {
            $stateDirSafe = $false
        }
    }

    if ($stateDirSafe -and ($script:WroteStateFiles -or $script:CreatedStateDir)) {
        foreach ($path in @($RecordPath, $RestorePath)) {
            if (-not (Test-Path -LiteralPath $path)) {
                continue
            }
            try {
                Test-NotReparsePoint $path
            } catch {
                continue
            }
            Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
        }
    }

    if ($script:CreatedStateDir -and $stateDirSafe -and (Test-Path -LiteralPath $StateDir)) {
        try {
            Test-NotReparsePoint $StateDir
            if (Test-Path -LiteralPath $StateDir -PathType Container) {
                $children = @(Get-ChildItem -LiteralPath $StateDir -Force)
                if ($children.Count -eq 0) {
                    Remove-Item -LiteralPath $StateDir -Force
                }
            }
        } catch {
        }
    }

    $script:PoliciesApplied = $false
    $script:WroteStateFiles = $false
    $script:CreatedStateDir = $false
    $script:WrotePolicyNames.Clear()
}

function Write-RestoreScript {
    $restore = @'
#Requires -Version 5.1
<#
.SYNOPSIS
  Removes only Tailscale policies written by the HomePictures camera installer.

.DESCRIPTION
  Reads C:\ProgramData\MPDEE-HomePictures\homepictures-tailscale-record.json
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

$StateDir = Join-Path $env:ProgramData 'MPDEE-HomePictures'
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

function Get-StrictProperty {
    param(
        $Object,
        [Parameter(Mandatory)][string]$Name
    )

    if ($null -eq $Object) {
        return $null
    }

    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $null
    }

    return $property.Value
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

$appliedBy = Get-StrictProperty -Object $record -Name 'appliedBy'
$purpose = Get-StrictProperty -Object $record -Name 'purpose'
$schemaVersion = Get-StrictProperty -Object $record -Name 'schemaVersion'
$policyKey = Get-StrictProperty -Object $record -Name 'policyKey'
$policies = Get-StrictProperty -Object $record -Name 'policies'
$createdPolicyKey = Get-StrictProperty -Object $record -Name 'createdPolicyKey'

if ($appliedBy -ne 'HomePictures') {
    throw "The install record was not created by HomePictures. No policies were changed."
}

if ($purpose -ne 'camera-viewing-client') {
    throw "The install record is not a HomePictures camera-viewing record. No policies were changed."
}

if ($null -eq $schemaVersion -or [int]$schemaVersion -ne 1) {
    throw "The install record uses an unsupported schema. No policies were changed."
}

if ($policyKey -ne 'HKLM\SOFTWARE\Policies\Tailscale') {
    throw "The install record points at an unexpected policy key. No policies were changed."
}

if (-not $policies) {
    throw "The install record does not list any policies. No policies were changed."
}

$removed = New-Object System.Collections.Generic.List[string]
$leftAlone = New-Object System.Collections.Generic.List[string]

if (Test-Path -LiteralPath $PolicyKeyPath) {
    foreach ($policy in @($policies)) {
        $name = [string](Get-StrictProperty -Object $policy -Name 'name')
        $expected = [string](Get-StrictProperty -Object $policy -Name 'value')

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
    if ($remaining.Count -eq 0 -and $createdPolicyKey -eq $true) {
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
'@

    Set-Content -LiteralPath $RestorePath -Value $restore -Encoding UTF8
}

function Install-CameraSafePolicies {
    if (Test-TailscaleAlreadyInstalled) {
        Show-ExistingInstallMessage
        exit 0
    }

    $existingPolicies = Get-ManagedPolicyInspection
    if ($existingPolicies -eq 'managed') {
        Show-ManagedPolicyMessage
        exit 0
    }
    if ($existingPolicies -eq 'unreadable') {
        throw "The Tailscale policy key could not be inspected. Installation stopped."
    }

    Protect-HomePicturesStateDir

    if (-not (Test-Path -LiteralPath $PolicyKeyPath)) {
        New-Item -Path $PolicyKeyPath -Force | Out-Null
        $script:CreatedPolicyKey = $true
    }

    foreach ($policy in $CameraSafePolicies) {
        New-ItemProperty -Path $PolicyKeyPath -Name $policy.Name -Value $policy.Value -PropertyType String -Force | Out-Null
        $script:WrotePolicyNames.Add($policy.Name)
    }
    $script:PoliciesApplied = $true

    $record = [ordered]@{
        appliedBy        = 'HomePictures'
        purpose          = 'camera-viewing-client'
        schemaVersion    = 1
        appliedUtc       = [DateTime]::UtcNow.ToString('o')
        policyKey        = $PolicyKeyDisplay
        createdPolicyKey = $script:CreatedPolicyKey
        policies         = @(
            foreach ($policy in $CameraSafePolicies) {
                [ordered]@{ name = $policy.Name; value = $policy.Value }
            }
        )
    }

    Assert-ExistingHomePicturesStateDir
    Assert-TrustedStateFile $RecordPath
    Assert-TrustedStateFile $RestorePath

    $script:WroteStateFiles = $true
    $record | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $RecordPath -Encoding UTF8
    Write-RestoreScript

    Protect-HomePicturesStateFile $RecordPath
    Protect-HomePicturesStateFile $RestorePath
    Assert-ExistingHomePicturesStateDir
    Write-Info "Wrote camera-safe Tailscale policies and a restore script."
}

function Install-OfficialTailscale {
    param(
        [Parameter(Mandatory)]$Target,
        [Parameter(Mandatory)][string]$InstallerPath
    )

    $logPath = Join-Path $script:TempDirectory 'msiexec.log'
    $msiexec = Join-Path $env:SystemRoot 'System32\msiexec.exe'
    $arguments = "/i `"$InstallerPath`" /qn /norestart /L*v `"$logPath`""

    Write-Info "Installing official Tailscale $($Target.Version) ($($Target.Arch))."
    $process = Start-Process -FilePath $msiexec -ArgumentList $arguments -Wait -PassThru
    $code = Get-StrictProperty -Object $process -Name 'ExitCode'
    if ($null -eq $code) {
        throw "The official Tailscale installer did not report an exit code."
    }
    if ($code -ne 0 -and $code -ne 3010) {
        throw "The official Tailscale installer failed with exit code $code."
    }

    $installed = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
    if (-not (Test-Path -LiteralPath $installed)) {
        throw "The official installer finished, but Tailscale was not found in Program Files."
    }
}

function Test-TailscaleUiIsRunning {
    try {
        $processes = @(Get-Process -Name 'tailscale-ipn' -ErrorAction SilentlyContinue)
        return $processes.Count -gt 0
    } catch {
        return $false
    }
}

function Start-TailscaleClient {
    try {
        $pollAttempts = 10
        $pollDelayMs = 500
        for ($i = 0; $i -lt $pollAttempts; $i++) {
            if (Test-TailscaleUiIsRunning) {
                Write-Info "Tailscale client is already open."
                return
            }
            Start-Sleep -Milliseconds $pollDelayMs
        }

        if (Test-TailscaleUiIsRunning) {
            Write-Info "Tailscale client is already open."
            return
        }

        $uiPath = Join-Path $env:ProgramFiles 'Tailscale\tailscale-ipn.exe'
        if (-not (Test-Path -LiteralPath $uiPath)) {
            throw "The Tailscale UI executable was not found."
        }

        Start-Process -FilePath $uiPath | Out-Null
        Write-Info "Opened the Tailscale client."
    } catch {
        Write-WarnLine "Tailscale installed successfully, but the app could not be opened automatically. Open Tailscale from the Start menu."
    }
}

function Remove-TempDirectory {
    if ($script:TempDirectory -and (Test-Path -LiteralPath $script:TempDirectory)) {
        Remove-Item -LiteralPath $script:TempDirectory -Recurse -Force -ErrorAction SilentlyContinue
        $script:TempDirectory = $null
    }
}

function Show-SuccessMessage {
    Write-Host ""
    Write-Ok "Tailscale is installed with camera-safe network settings."
    Write-Info "Sign in using your own Tailscale account, then return to the Camera Access page."
    Write-Host ""
    Write-Info "To undo only the camera-specific policies later, run:"
    Write-Info "  $RestorePath"
}

#region HomePictures-Main
try {
    Write-Info "HomePictures camera-safe Tailscale installer"
    Write-Info "This script has no passwords, share links, camera URLs, or auth keys."
    Write-Host ""

    Test-SupportedWindows

    if (Test-TailscaleAlreadyInstalled) {
        Show-ExistingInstallMessage
        exit 0
    }

    $readablePolicies = Get-ManagedPolicyInspection
    if ($readablePolicies -eq 'managed') {
        Show-ManagedPolicyMessage
        exit 0
    }
    if ($readablePolicies -eq 'unreadable') {
        Show-UnreadablePolicyMessage
        exit 0
    }

    if (-not (Test-IsAdministrator)) {
        Restart-Elevated
    }

    if (Test-TailscaleAlreadyInstalled) {
        Show-ExistingInstallMessage
        exit 0
    }

    $existingPolicies = Get-ManagedPolicyInspection
    if ($existingPolicies -eq 'managed') {
        Show-ManagedPolicyMessage
        exit 0
    }
    if ($existingPolicies -eq 'unreadable') {
        throw "The Tailscale policy key could not be inspected. Installation stopped."
    }

    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

    $script:TempDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('hp-cctv-tailscale-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $script:TempDirectory -Force | Out-Null

    $target = Get-StableInstallerTarget
    Write-Info "Current stable Tailscale version: $($target.Version) ($($target.Arch))."

    $expectedHash = Get-ExpectedSha256 -ShaUri $target.ShaUri
    $installerPath = Join-Path $script:TempDirectory $target.FileName
    Save-OfficialPackage -Uri $target.Uri -Destination $installerPath
    Assert-FileSha256 -Path $installerPath -Expected $expectedHash
    Assert-TailscaleAuthenticode -Path $installerPath

    try {
        Install-CameraSafePolicies
        Install-OfficialTailscale -Target $target -InstallerPath $installerPath
    } catch {
        Undo-HomePicturesPolicies
        throw
    }

    Start-TailscaleClient
    Show-SuccessMessage
    exit 0
} catch {
    Write-Host ""
    Write-Host "Installation stopped. No fallback that weakens these checks will be used." -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
} finally {
    Remove-TempDirectory
    if (-not $script:SkipWait) {
        Wait-ForReader
    }
}
