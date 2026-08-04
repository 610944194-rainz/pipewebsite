param(
  [Parameter(Mandatory = $true)]
  [string]$StateRoot,
  [Parameter(Mandatory = $true)]
  [string]$CycleId,
  [Parameter(Mandatory = $true)]
  [string]$BundleRoot,
  [string]$ReleaseRoot = "C:\Users\NING MEI\Desktop\pipewebsite-smokingpipes-release",
  [string]$RuntimeRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [switch]$NoPush
)

$ErrorActionPreference = "Stop"

function Invoke-Git {
  param(
    [string]$Directory,
    [string[]]$Arguments,
    [int[]]$AllowedExitCodes = @(0)
  )
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    # Git can emit an informational CRLF conversion warning on stderr while
    # succeeding. Preserve it for diagnostics without treating it as a
    # PowerShell terminating error.
    $ErrorActionPreference = "Continue"
    $output = @(& git -C $Directory @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($exitCode -notin $AllowedExitCodes) {
    throw "git command failed: git -C '$Directory' $($Arguments -join ' '); gitExitCode=$exitCode; stderr-tail=$($output | Select-Object -Last 20 | Out-String)"
  }
  return ($output | Out-String).Trim()
}

function Write-PublisherResult {
  param(
    [string]$Status,
    [string]$BundleId,
    [string]$CommitSha = "",
    [int]$PublishedCount = 0,
    [string[]]$StagedFiles = @(),
    [string]$Error = "",
    [int]$ExitCode = 1
  )
  $result = [ordered]@{ status=$Status; bundleId=$BundleId; commitSha=$CommitSha; publishedCount=$PublishedCount; stagedFiles=@($StagedFiles); sourceNetworkAccessed=$false; error=$Error; exitCode=$ExitCode }
  Write-Output ("SMOKINGPIPES_PUBLISHER_RESULT_JSON=" + ($result | ConvertTo-Json -Compress -Depth 8))
  exit $ExitCode
}

function Get-FileSha256 {
  param([string]$Path)
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}

$manifestPath = Join-Path $BundleRoot "manifest.json"
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw "bundle manifest is missing: $manifestPath"
}
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
if (-not $manifest.bundleId -or -not $manifest.baseMainSha) {
  throw "bundle manifest is incomplete"
}
$bundleId = [string]$manifest.bundleId
$outputFiles = @($manifest.outputFileHashes.PSObject.Properties.Name)
if (-not $outputFiles.Count) { throw "bundle has no owned output files" }
foreach ($relativeFile in $outputFiles) {
  $normalized = ([string]$relativeFile).Replace("\\", "/")
  $isOwned = (
    $normalized -eq "data/products/smokingpipes-products.json" -or
    $normalized -eq "data/products/unified-products-staging.json" -or
    $normalized.StartsWith("data/generated/public-products/", [StringComparison]::Ordinal)
  )
  if (-not $isOwned -or $normalized.StartsWith("/") -or $normalized.Split("/") -contains "..") {
    throw "bundle owns an unsafe or non-Smokingpipes output path: $relativeFile"
  }
}
if ($outputFiles | Where-Object { $_ -match '(^|/)featured\.json$' }) {
  throw "Smokingpipes bundle must not own featured.json"
}

$releasePrepared = $false
$commitSha = ""
try {
  if (-not (Test-Path -LiteralPath $ReleaseRoot)) {
    $origin = Invoke-Git -Directory $RuntimeRoot -Arguments @("remote", "get-url", "origin")
    Invoke-Git -Directory $RuntimeRoot -Arguments @("clone", $origin, $ReleaseRoot) | Out-Null
  }
  if (-not (Test-Path -LiteralPath (Join-Path $ReleaseRoot ".git"))) {
    throw "release root must be an independent Git clone: $ReleaseRoot"
  }
  $dirty = Invoke-Git -Directory $ReleaseRoot -Arguments @("status", "--porcelain", "--untracked-files=all")
  if ($dirty) { throw "release clone is not clean: $dirty" }
  Invoke-Git -Directory $ReleaseRoot -Arguments @("fetch", "origin") | Out-Null
  $remoteMain = Invoke-Git -Directory $ReleaseRoot -Arguments @("rev-parse", "origin/main")
  $head = Invoke-Git -Directory $ReleaseRoot -Arguments @("rev-parse", "HEAD")
  $bundleTrailer = "Smokingpipes-Bundle-Id: $bundleId"
  $headMessage = Invoke-Git -Directory $ReleaseRoot -Arguments @("log", "-1", "--format=%B", "HEAD")
  $remoteMessage = Invoke-Git -Directory $ReleaseRoot -Arguments @("log", "-1", "--format=%B", "origin/main")
  if ($remoteMessage -match [regex]::Escape($bundleTrailer)) {
    [pscustomobject]@{
      status = "published"
      bundleId = $bundleId
      commitSha = $remoteMain
      publishedCount = [int]$manifest.actualAppliedCount
      sourceNetworkAccessed = $false
    } | ConvertTo-Json -Depth 8
     Write-PublisherResult -Status "published" -BundleId $bundleId -CommitSha $remoteMain -PublishedCount ([int]$manifest.actualAppliedCount) -ExitCode 0
  }
  if ($headMessage -match [regex]::Escape($bundleTrailer)) {
    $remoteIsAncestor = @(& git -C $ReleaseRoot merge-base --is-ancestor origin/main HEAD 2>&1)
    if ($LASTEXITCODE -ne 0) {
      throw "retained release commit no longer descends from origin/main; refusing to overwrite remote history"
    }
    $commitSha = $head
    if ($NoPush) {
      [pscustomobject]@{
        status = "commit-created-no-push"
        bundleId = $bundleId
        commitSha = $commitSha
        sourceNetworkAccessed = $false
      } | ConvertTo-Json -Depth 8
       Write-PublisherResult -Status "commit-created-no-push" -BundleId $bundleId -CommitSha $commitSha -ExitCode 1
    }
    $previousErrorActionPreference = $ErrorActionPreference
    try {
      $ErrorActionPreference = "Continue"
      $retryPushOutput = @(& git -C $ReleaseRoot push "origin" "HEAD:main" 2>&1)
      $retryPushExitCode = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($retryPushExitCode -ne 0) {
      [pscustomobject]@{
        status = "push-retryable"
        bundleId = $bundleId
        commitSha = $commitSha
        sourceNetworkAccessed = $false
        error = ($retryPushOutput | Select-Object -Last 20 | Out-String).Trim()
      } | ConvertTo-Json -Depth 8
       Write-PublisherResult -Status "push-retryable" -BundleId $bundleId -CommitSha $commitSha -Error (($retryPushOutput | Select-Object -Last 20 | Out-String).Trim()) -ExitCode 3
    }
    [pscustomobject]@{
      status = "published"
      bundleId = $bundleId
      commitSha = $commitSha
      publishedCount = [int]$manifest.actualAppliedCount
      stagedFiles = @()
      sourceNetworkAccessed = $false
    } | ConvertTo-Json -Depth 8
     Write-PublisherResult -Status "published" -BundleId $bundleId -CommitSha $commitSha -PublishedCount ([int]$manifest.actualAppliedCount) -ExitCode 0
  }
  if ($remoteMain -ne [string]$manifest.baseMainSha) {
    [pscustomobject]@{
      status = "stale-base"
      bundleId = $bundleId
      baseMainSha = $manifest.baseMainSha
      remoteMainSha = $remoteMain
      sourceNetworkAccessed = $false
    } | ConvertTo-Json -Depth 8
     Write-PublisherResult -Status "stale-base" -BundleId $bundleId -Error "origin/main changed after bundle creation" -ExitCode 2
  }
  Invoke-Git -Directory $ReleaseRoot -Arguments @("reset", "--hard", $manifest.baseMainSha) | Out-Null
  $releasePrepared = $true

  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $validatorOutput = @(& node (Join-Path $RuntimeRoot "scripts/inventory/validate-smokingpipes-release-bundle-v2.mjs") "--bundle-root=$BundleRoot" "--runtime-root=$ReleaseRoot" 2>&1)
    $validatorExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($validatorExitCode -ne 0) {
    throw "bundle validator failed: $($validatorOutput | Out-String)"
  }
  foreach ($relativeFile in $outputFiles) {
    $source = Join-Path (Join-Path $BundleRoot "outputs") $relativeFile
    $destination = Join-Path $ReleaseRoot $relativeFile
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
      throw "bundle output is missing: $relativeFile"
    }
    $expectedHash = [string]$manifest.outputFileHashes.PSObject.Properties[$relativeFile].Value
    if (-not $expectedHash -or (Get-FileSha256 -Path $source) -ne $expectedHash) {
      throw "bundle output hash mismatch before copy: $relativeFile"
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Force
    if ((Get-FileSha256 -Path $destination) -ne $expectedHash) {
      throw "bundle output hash mismatch after copy: $relativeFile"
    }
  }
  $projectValidator = Join-Path $ReleaseRoot "scripts/validate-public-product-indexes-v1.mjs"
  $inventoryDefaultTest = Join-Path $ReleaseRoot "scripts/test-public-products-inventory-default-v1.mjs"
  foreach ($command in @(
    @("node", $projectValidator),
    @("node", $inventoryDefaultTest),
    @("git", "-C", $ReleaseRoot, "diff", "--check"),
    @("npm.cmd", "--prefix", $ReleaseRoot, "run", "build")
  )) {
    $program = $command[0]
    $arguments = @($command | Select-Object -Skip 1)
    $previousErrorActionPreference = $ErrorActionPreference
    try {
      $ErrorActionPreference = "Continue"
      $output = @(& $program @arguments 2>&1)
      $exitCode = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($exitCode -ne 0) {
      throw "release production gate failed: $program $($arguments -join ' '); $($output | Select-Object -Last 40 | Out-String)"
    }
  }
  Invoke-Git -Directory $ReleaseRoot -Arguments (@("add", "--") + $outputFiles) | Out-Null
  $staged = @((Invoke-Git -Directory $ReleaseRoot -Arguments @("diff", "--cached", "--name-only")) -split [Environment]::NewLine | Where-Object { $_ })
  if (-not $staged.Count) {
    throw "bundle has no staged product change; it must not be published"
  }
  $unexpected = @($staged | Where-Object { $_ -notin $outputFiles })
  if ($unexpected.Count) {
    throw "staged file whitelist mismatch; unexpected=$($unexpected -join ',')"
  }
  $subject = "chore(inventory): publish Smokingpipes cycle $CycleId"
  $body = "Smokingpipes-Bundle-Id: $bundleId" + [Environment]::NewLine + "Smokingpipes-Applied-Count: $($manifest.actualAppliedCount)"
  Invoke-Git -Directory $ReleaseRoot -Arguments @("commit", "-m", $subject, "-m", $body) | Out-Null
  $commitSha = Invoke-Git -Directory $ReleaseRoot -Arguments @("rev-parse", "HEAD")
  if ($NoPush) {
    [pscustomobject]@{
      status = "commit-created-no-push"
      bundleId = $bundleId
      commitSha = $commitSha
      sourceNetworkAccessed = $false
    } | ConvertTo-Json -Depth 8
     Write-PublisherResult -Status "commit-created-no-push" -BundleId $bundleId -CommitSha $commitSha -StagedFiles $staged -ExitCode 1
  }
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $pushOutput = @(& git -C $ReleaseRoot push "origin" "HEAD:main" 2>&1)
    $pushExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($pushExitCode -ne 0) {
    [pscustomobject]@{
      status = "push-retryable"
      bundleId = $bundleId
      commitSha = $commitSha
      sourceNetworkAccessed = $false
      error = ($pushOutput | Select-Object -Last 20 | Out-String).Trim()
    } | ConvertTo-Json -Depth 8
     Write-PublisherResult -Status "push-retryable" -BundleId $bundleId -CommitSha $commitSha -StagedFiles $staged -Error (($pushOutput | Select-Object -Last 20 | Out-String).Trim()) -ExitCode 3
  }
  [pscustomobject]@{
    status = "published"
    bundleId = $bundleId
    commitSha = $commitSha
    publishedCount = [int]$manifest.actualAppliedCount
    stagedFiles = $staged
    sourceNetworkAccessed = $false
  } | ConvertTo-Json -Depth 8
   Write-PublisherResult -Status "published" -BundleId $bundleId -CommitSha $commitSha -PublishedCount ([int]$manifest.actualAppliedCount) -StagedFiles $staged -ExitCode 0
 } catch {
  $message = $_.Exception.Message
  if ($releasePrepared -and -not $commitSha) {
    $cleanupErrors = @()
    try {
      Invoke-Git -Directory $ReleaseRoot -Arguments @("reset", "--hard", "origin/main") | Out-Null
    } catch {
      $cleanupErrors += "reset failed: $($_.Exception.Message)"
    }
    try {
      Invoke-Git -Directory $ReleaseRoot -Arguments @("clean", "-fd", "--") | Out-Null
    } catch {
      $cleanupErrors += "release clone clean failed: $($_.Exception.Message)"
    }
    try {
      $remaining = Invoke-Git -Directory $ReleaseRoot -Arguments @("status", "--porcelain", "--untracked-files=all")
      if ($remaining) { $cleanupErrors += "release clone remains dirty after cleanup: $remaining" }
    } catch {
      $cleanupErrors += "post-clean status failed: $($_.Exception.Message)"
    }
    if ($cleanupErrors.Count) {
      $message = "$message; $($cleanupErrors -join '; ')"
    }
  }
  [pscustomobject]@{
    status = "release-retryable"
    bundleId = $bundleId
    commitSha = $commitSha
    sourceNetworkAccessed = $false
    error = $message
  } | ConvertTo-Json -Depth 8
   Write-PublisherResult -Status "release-retryable" -BundleId $bundleId -CommitSha $commitSha -Error $message -ExitCode 1
}
