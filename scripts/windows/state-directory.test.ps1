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

function Use-TestStateDir {
    param([Parameter(Mandatory)][string]$Path)

    $realStateDir = Join-Path $env:ProgramData 'MPDEE-HomePictures'
    if ($Path -eq $realStateDir -or $Path.StartsWith(($realStateDir + [IO.Path]::DirectorySeparatorChar))) {
        throw "Test refused to use the real state directory: $Path"
    }

    Set-Variable -Name StateDir -Value $Path -Scope Script
    Set-Variable -Name RecordPath -Value (Join-Path $Path 'homepictures-tailscale-record.json') -Scope Script
    Set-Variable -Name RestorePath -Value (Join-Path $Path 'Restore-Tailscale-Defaults.ps1') -Scope Script
}

function Enable-TestDirectoryCleanup {
    param([Parameter(Mandatory)][string]$Path)

    $acl = New-Object System.Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $self = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        $self,
        'FullControl',
        'ContainerInherit,ObjectInherit',
        'None',
        'Allow'
    )
    $acl.AddAccessRule($rule) | Out-Null
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Grant-UsersModify {
    param([Parameter(Mandatory)][string]$Path)

    $acl = Get-Acl -LiteralPath $Path
    $users = New-Object System.Security.Principal.SecurityIdentifier 'S-1-5-32-545'
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        $users,
        'Modify',
        'ContainerInherit,ObjectInherit',
        'None',
        'Allow'
    )
    $acl.AddAccessRule($rule) | Out-Null
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Get-WriteCapableSids {
    param([Parameter(Mandatory)][string]$Path)

    $writeRights = Get-WriteCapableRights
    $acl = Get-Acl -LiteralPath $Path
    $sids = New-Object System.Collections.Generic.List[string]
    foreach ($rule in @($acl.Access)) {
        if ($rule.AccessControlType -ne 'Allow') {
            continue
        }
        if (($rule.FileSystemRights -band $writeRights) -eq 0) {
            continue
        }
        try {
            $sid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
        } catch {
            $sid = [string]$rule.IdentityReference
        }
        if (-not $sids.Contains($sid)) {
            $sids.Add($sid)
        }
    }
    return @($sids)
}

function Reset-HomePicturesUndoFlags {
    $script:PoliciesApplied = $false
    $script:WroteStateFiles = $false
    $script:CreatedStateDir = $false
    $script:CreatedPolicyKey = $false
    $script:WrotePolicyNames.Clear()
}

Set-StrictMode -Version Latest

$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('hp-state-dir-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
$testError = $null

function Set-AdminOnlyDaclKeepOwner {
    param([Parameter(Mandatory)][string]$Path)

    $acl = New-Object System.Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $adminSid = New-Object System.Security.Principal.SecurityIdentifier 'S-1-5-32-544'
    $systemSid = New-Object System.Security.Principal.SecurityIdentifier 'S-1-5-18'
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
    Set-Acl -LiteralPath $Path -AclObject $acl
}

try {
    Assert-True ($StateDir -eq (Join-Path $env:ProgramData 'MPDEE-HomePictures')) 'Installer state directory must default to %ProgramData%\MPDEE-HomePictures.'
    Assert-False ($StateDir -like '*\MPDEE\HomePictures') 'Installer state directory must not be the legacy MPDEE\HomePictures path.'

    $templateAcl = New-AdminOnlyDirectoryAcl
    Assert-True ($templateAcl.AreAccessRulesProtected -eq $true) 'The created-directory ACL template must disable inheritance.'
    $templateOwner = $templateAcl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
    Assert-True ($templateOwner -eq 'S-1-5-32-544') 'The created-directory ACL template must set the owner to Administrators.'
    $templateWriteSids = New-Object System.Collections.Generic.List[string]
    $writeRights = Get-WriteCapableRights
    foreach ($rule in @($templateAcl.GetAccessRules($true, $false, [System.Security.Principal.SecurityIdentifier]))) {
        if ($rule.AccessControlType -ne 'Allow') { continue }
        if (($rule.FileSystemRights -band $writeRights) -eq 0) { continue }
        $sid = $rule.IdentityReference.Value
        if (-not $templateWriteSids.Contains($sid)) { $templateWriteSids.Add($sid) }
    }
    foreach ($sid in $templateWriteSids) {
        Assert-True ($sid -in @('S-1-5-32-544', 'S-1-5-18')) 'The created-directory ACL template may grant write-capable rights only to Administrators and SYSTEM.'
    }
    Assert-True ($templateWriteSids -contains 'S-1-5-32-544') 'The created-directory ACL template must grant Administrators write-capable rights.'
    Assert-True ($templateWriteSids -contains 'S-1-5-18') 'The created-directory ACL template must grant SYSTEM write-capable rights.'

    $unrelatedMpdee = Join-Path $testRoot 'MPDEE'
    New-Item -ItemType Directory -Path $unrelatedMpdee | Out-Null
    Grant-UsersModify $unrelatedMpdee
    Assert-False (Test-DirectoryIsAdminControlled $unrelatedMpdee) 'The unrelated MPDEE directory must stay user-writable for this test.'

    $legacyDir = Join-Path $unrelatedMpdee 'HomePictures'
    New-Item -ItemType Directory -Path $legacyDir | Out-Null
    $legacyCanary = Join-Path $legacyDir 'do-not-read.txt'
    Set-Content -LiteralPath $legacyCanary -Value 'legacy-canary' -Encoding ASCII

    $createdDir = Join-Path $testRoot 'MPDEE-HomePictures'
    Use-TestStateDir $createdDir
    Reset-HomePicturesUndoFlags
    $createError = $null
    try {
        Protect-HomePicturesStateDir
    } catch {
        $createError = $_
    }

    Assert-True (Test-Path -LiteralPath $legacyCanary) 'The installer must not delete the legacy MPDEE\HomePictures tree.'
    Assert-True ((Get-Content -LiteralPath $legacyCanary -Raw).Trim() -eq 'legacy-canary') 'The installer must not read or rewrite the legacy MPDEE\HomePictures tree.'
    if ($createError) {
        Assert-False ([string]$createError.Exception.Message -match 'C:\\ProgramData\\MPDEE exists') 'A writable unrelated MPDEE directory must not block installation.'
        if (Test-Path -LiteralPath $createdDir) {
            Enable-TestDirectoryCleanup $createdDir
        }
        Undo-HomePicturesPolicies
    } else {
        Assert-True (Test-Path -LiteralPath $createdDir -PathType Container) 'Protect-HomePicturesStateDir must create the dedicated state directory.'
        Assert-True $script:CreatedStateDir 'Creating the dedicated state directory must set CreatedStateDir.'
        $createdAcl = Get-Acl -LiteralPath $createdDir
        Assert-True ($createdAcl.AreAccessRulesProtected -eq $true) 'A created state directory must disable inherited permissions.'
        Assert-True (Test-DirectoryOwnerIsPrivileged $createdDir) 'A created state directory must be owned by Administrators or SYSTEM.'
        $createdWriteSids = Get-WriteCapableSids $createdDir
        foreach ($sid in $createdWriteSids) {
            Assert-True ($sid -in @('S-1-5-32-544', 'S-1-5-18')) 'A created state directory may grant write-capable rights only to Administrators and SYSTEM.'
        }
        Assert-True ($createdWriteSids -contains 'S-1-5-32-544') 'A created state directory must grant Administrators write-capable rights.'
        Assert-True ($createdWriteSids -contains 'S-1-5-18') 'A created state directory must grant SYSTEM write-capable rights.'
        Assert-ProtectedStateAcl $createdDir
        Enable-TestDirectoryCleanup $createdDir
        Undo-HomePicturesPolicies
        Assert-False (Test-Path -LiteralPath $createdDir) 'Rollback must remove an empty state directory created in this run.'
    }
    Assert-True (Test-Path -LiteralPath $legacyCanary) 'Rollback must leave the legacy MPDEE\HomePictures tree alone.'

    $ownerTrap = Join-Path $testRoot 'owner-trap'
    New-Item -ItemType Directory -Path $ownerTrap | Out-Null
    Set-AdminOnlyDaclKeepOwner $ownerTrap
    Assert-False (Test-DirectoryOwnerIsPrivileged $ownerTrap) 'A non-administrator owner must not count as privileged.'
    Assert-False (Test-DirectoryIsAdminControlled $ownerTrap) 'A safe-looking DACL must not hide a non-administrator owner.'
    Use-TestStateDir $ownerTrap
    Reset-HomePicturesUndoFlags
    $ownerFailed = $false
    try {
        Protect-HomePicturesStateDir
    } catch {
        $ownerFailed = $_.Exception.Message -match 'writable by a non-administrator'
    }
    Assert-True $ownerFailed 'A pre-existing directory owned by a non-administrator must cause a safe failure.'
    Assert-False $script:CreatedStateDir 'A rejected owner-trap directory must not be marked as created.'
    Assert-True (Test-Path -LiteralPath $ownerTrap -PathType Container) 'A rejected owner-trap directory must be left in place.'
    Enable-TestDirectoryCleanup $ownerTrap

    if (Test-IsAdministrator) {
        $preexistingSecured = Join-Path $testRoot 'preexisting-secured'
        New-Item -ItemType Directory -Path $preexistingSecured | Out-Null
        Set-Acl -LiteralPath $preexistingSecured -AclObject (New-AdminOnlyDirectoryAcl)
        $securedSddl = (Get-Acl -LiteralPath $preexistingSecured).Sddl
        Use-TestStateDir $preexistingSecured
        Reset-HomePicturesUndoFlags
        Protect-HomePicturesStateDir
        Assert-False $script:CreatedStateDir 'A pre-existing secured directory must not be treated as created by this run.'
        Assert-True ((Get-Acl -LiteralPath $preexistingSecured).Sddl -eq $securedSddl) 'A pre-existing secured directory must not have its ACL rewritten.'
        Enable-TestDirectoryCleanup $preexistingSecured
    }

    $preexistingWritable = Join-Path $testRoot 'preexisting-keep'
    New-Item -ItemType Directory -Path $preexistingWritable | Out-Null
    Use-TestStateDir $preexistingWritable
    Reset-HomePicturesUndoFlags
    Set-Content -LiteralPath $RecordPath -Value '{}' -Encoding UTF8
    Set-Content -LiteralPath $RestorePath -Value '# restore' -Encoding UTF8
    $script:WroteStateFiles = $true
    Undo-HomePicturesPolicies
    Assert-True (Test-Path -LiteralPath $preexistingWritable -PathType Container) 'Rollback must never remove a pre-existing state directory.'
    Assert-False (Test-Path -LiteralPath $RecordPath) 'Rollback may remove state files written in this run.'
    Assert-False (Test-Path -LiteralPath $RestorePath) 'Rollback may remove the restore script written in this run.'

    $writableExisting = Join-Path $testRoot 'writable-existing'
    New-Item -ItemType Directory -Path $writableExisting | Out-Null
    Grant-UsersModify $writableExisting
    Use-TestStateDir $writableExisting
    Reset-HomePicturesUndoFlags
    $writableFailed = $false
    try {
        Protect-HomePicturesStateDir
    } catch {
        $writableFailed = $_.Exception.Message -match 'writable by a non-administrator'
    }
    Assert-True $writableFailed 'A pre-existing writable MPDEE-HomePictures directory must cause a safe failure.'
    Assert-False $script:CreatedStateDir 'A rejected pre-existing directory must not be marked as created.'
    Assert-True (Test-Path -LiteralPath $writableExisting -PathType Container) 'A rejected pre-existing directory must be left in place.'

    $reparseTarget = Join-Path $testRoot 'reparse-target'
    $reparseDir = Join-Path $testRoot 'reparse-state'
    New-Item -ItemType Directory -Path $reparseTarget | Out-Null
    New-Item -ItemType Junction -Path $reparseDir -Value $reparseTarget | Out-Null
    Use-TestStateDir $reparseDir
    Reset-HomePicturesUndoFlags
    $reparseFailed = $false
    try {
        Protect-HomePicturesStateDir
    } catch {
        $reparseFailed = $_.Exception.Message -match 'reparse point'
    }
    Assert-True $reparseFailed 'A pre-existing reparse-point MPDEE-HomePictures path must cause a safe failure.'
    Assert-False $script:CreatedStateDir 'A rejected reparse point must not be marked as created.'
    Assert-True (Test-Path -LiteralPath $reparseDir) 'A rejected reparse point must be left in place.'

    $leafTarget = Join-Path $testRoot 'leaf-target'
    $leafParent = Join-Path $testRoot 'leaf-parent'
    New-Item -ItemType Directory -Path $leafTarget | Out-Null
    New-Item -ItemType Directory -Path $leafParent | Out-Null
    $leafCanary = Join-Path $leafTarget 'keep.txt'
    Set-Content -LiteralPath $leafCanary -Value 'keep' -Encoding ASCII
    Use-TestStateDir $leafParent
    New-Item -ItemType Junction -Path $RestorePath -Value $leafTarget | Out-Null
    $leafFailed = $false
    try {
        Assert-TrustedStateFile $RestorePath
    } catch {
        $leafFailed = $_.Exception.Message -match 'reparse point|not a file'
    }
    Assert-True $leafFailed 'A restore-script reparse point must be rejected before write or delete.'

    $ownedLeafDir = Join-Path $testRoot 'owned-leaf-dir'
    New-Item -ItemType Directory -Path $ownedLeafDir | Out-Null
    Use-TestStateDir $ownedLeafDir
    Set-Content -LiteralPath $RestorePath -Value 'attacker' -Encoding ASCII
    $ownedLeafFailed = $false
    try {
        Assert-TrustedStateFile $RestorePath
    } catch {
        $ownedLeafFailed = $_.Exception.Message -match 'writable by a non-administrator'
    }
    Assert-True $ownedLeafFailed 'An attacker-owned regular state file must be rejected before write.'
    Assert-True ((Get-Content -LiteralPath $RestorePath -Raw).Trim() -eq 'attacker') 'A rejected attacker-owned state file must be left unchanged.'
    Reset-HomePicturesUndoFlags
    $script:CreatedStateDir = $true
    $script:WroteStateFiles = $true
    Undo-HomePicturesPolicies
    Assert-True (Test-Path -LiteralPath $leafCanary) 'Rollback must not delete through a leaf reparse point.'
    Assert-True (Test-Path -LiteralPath $RestorePath) 'Rollback must leave a leaf reparse point in place.'

    $emptyPreexisting = Join-Path $testRoot 'empty-preexisting'
    New-Item -ItemType Directory -Path $emptyPreexisting | Out-Null
    Use-TestStateDir $emptyPreexisting
    Reset-HomePicturesUndoFlags
    Undo-HomePicturesPolicies
    Assert-True (Test-Path -LiteralPath $emptyPreexisting -PathType Container) 'Rollback before state-directory creation must not remove a pre-existing directory.'

    $createdThenFailed = Join-Path $testRoot 'created-then-failed'
    New-Item -ItemType Directory -Path $createdThenFailed | Out-Null
    Use-TestStateDir $createdThenFailed
    Reset-HomePicturesUndoFlags
    Set-Content -LiteralPath $RecordPath -Value '{}' -Encoding UTF8
    Set-Content -LiteralPath $RestorePath -Value '# restore' -Encoding UTF8
    $script:CreatedStateDir = $true
    $script:WroteStateFiles = $true
    Undo-HomePicturesPolicies
    Assert-False (Test-Path -LiteralPath $createdThenFailed) 'Rollback after this run created the directory and wrote state files must remove the empty directory.'
    Assert-False (Test-Path -LiteralPath $RecordPath) 'Rollback after restore-script creation must remove the install record.'
    Assert-False (Test-Path -LiteralPath $RestorePath) 'Rollback after restore-script creation must remove the restore script.'
} catch {
    $testError = $_
} finally {
    $ErrorActionPreference = 'SilentlyContinue'
    if (Test-Path -LiteralPath $testRoot) {
        Get-ChildItem -LiteralPath $testRoot -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object {
            try { Enable-TestDirectoryCleanup $_.FullName } catch { }
        }
        Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if ($testError) {
    throw $testError
}

Write-Output 'STATE_DIRECTORY_TESTS_PASSED'
