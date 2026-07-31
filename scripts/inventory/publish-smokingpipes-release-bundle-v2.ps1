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
  $output = @(& git -C $Directory @Arguments 2>&1)
  $exitCode = $LASTEXITCODE
  if ($exitCode -notin $AllowedExitCodes) {
    throw "git command failed: git -C '$Directory' $($Arguments -join ' '); gitExitCode=$exitCode; stderr-tail=$($output | Select-Object -Last 20 | Out-String)"
  }
  return ($output | Out-String).Trim()
}

function Complete-ReleaseState {
  param(
    [string]$Status,
    [string]$BundleId,
    [string]$CommitSha = "",
    [string]$Reason = ""
  )
  $arguments = @(
    (Join-Path $RuntimeRoot "scripts\inventory\smokingpipes-release-state-v2.mjs"),
    "--state-root=$StateRoot",
    "--cycle-id=$CycleId",
    "--bundle-id=$BundleId",
    "--status=$Status"
  )
  if ($CommitSha) { $arguments += "--commit-sha=$CommitSha" }
  if ($Reason) { $arguments += "--reason=$Reason" }
  $output = @(& node @arguments 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw "release state update failed: $($output | Out-String)"
  }
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
    $cloneOutput = @(& git clone $origin $ReleaseRoot 2>&1)
    if ($LASTEXITCODE -ne 0) {
      throw "release clone creation failed: $($cloneOutput | Out-String)"
    }
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
    Complete-ReleaseState -Status "published" -BundleId $bundleId -CommitSha $remoteMain
    [pscustomobject]@{
      status = "published"
      bundleId = $bundleId
      commitSha = $remoteMain
      publishedCount = [int]$manifest.actualAppliedCount
      sourceNetworkAccessed = $false
    } | ConvertTo-Json -Depth 8
    exit 0
  }
  if ($headMessage -match [regex]::Escape($bundleTrailer)) {
    $remoteIsAncestor = @(& git -C $ReleaseRoot merge-base --is-ancestor origin/main HEAD 2>&1)
    if ($LASTEXITCODE -ne 0) {
      throw "retained release commit no longer descends from origin/main; refusing to overwrite remote history"
    }
    $commitSha = $head
    if ($NoPush) {
      Complete-ReleaseState -Status "release-retryable" -BundleId $bundleId -CommitSha $commitSha -Reason "commit retained; push explicitly disabled"
      [pscustomobject]@{
        status = "commit-created-no-push"
        bundleId = $bundleId
        commitSha = $commitSha
        sourceNetworkAccessed = $false
      } | ConvertTo-Json -Depth 8
      exit 0
    }
    $retryPushOutput = @(& git -C $ReleaseRoot push "HEAD:main" 2>&1)
    if ($LASTEXITCODE -ne 0) {
      Complete-ReleaseState -Status "release-retryable" -BundleId $bundleId -CommitSha $commitSha -Reason "retained commit push failed; retry push only"
      [pscustomobject]@{
        status = "push-retryable"
        bundleId = $bundleId
        commitSha = $commitSha
        sourceNetworkAccessed = $false
        error = ($retryPushOutput | Select-Object -Last 20 | Out-String).Trim()
      } | ConvertTo-Json -Depth 8
      exit 3
    }
    Complete-ReleaseState -Status "published" -BundleId $bundleId -CommitSha $commitSha
    [pscustomobject]@{
      status = "published"
      bundleId = $bundleId
      commitSha = $commitSha
      publishedCount = [int]$manifest.actualAppliedCount
      sourceNetworkAccessed = $false
    } | ConvertTo-Json -Depth 8
    exit 0
  }
  if ($remoteMain -ne [string]$manifest.baseMainSha) {
    [pscustomobject]@{
      status = "stale-base"
      bundleId = $bundleId
      baseMainSha = $manifest.baseMainSha
      remoteMainSha = $remoteMain
      sourceNetworkAccessed = $false
    } | ConvertTo-Json -Depth 8
    exit 2
  }
  Invoke-Git -Directory $ReleaseRoot -Arguments @("reset", "--hard", $manifest.baseMainSha) | Out-Null
  $releasePrepared = $true

  $validatorOutput = @(& node (Join-Path $RuntimeRoot "scripts/inventory/validate-smokingpipes-release-bundle-v2.mjs") "--bundle-root=$BundleRoot" "--runtime-root=$ReleaseRoot" 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw "bundle validator failed: $($validatorOutput | Out-String)"
  }
  foreach ($relativeFile in $outputFiles) {
    $source = Join-Path (Join-Path $BundleRoot "outputs") $relativeFile
    $destination = Join-Path $ReleaseRoot $relativeFile
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
      throw "bundle output is missing: $relativeFile"
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Force
  }
  $projectValidator = Join-Path $ReleaseRoot "scripts/validate-public-product-indexes-v1.mjs"
  $inventoryDefaultTest = Join-Path $ReleaseRoot "scripts/test-public-products-inventory-default-v1.mjs"
  foreach ($command in @(
    @("node", $projectValidator),
    @("node", $inventoryDefaultTest),
    @("git", "-C", $ReleaseRoot, "diff", "--check"),
    @("npm.cmd", "run", "build")
  )) {
    $program = $command[0]
    $arguments = @($command | Select-Object -Skip 1)
    $output = @(& $program @arguments 2>&1)
    if ($LASTEXITCODE -ne 0) {
      throw "release production gate failed: $program $($arguments -join ' '); $($output | Select-Object -Last 40 | Out-String)"
    }
  }
  Invoke-Git -Directory $ReleaseRoot -Arguments (@("add", "--") + $outputFiles) | Out-Null
  $staged = @((Invoke-Git -Directory $ReleaseRoot -Arguments @("diff", "--cached", "--name-only")) -split [Environment]::NewLine | Where-Object { $_ })
  $unexpected = @($staged | Where-Object { $_ -notin $outputFiles })
  $missing = @($outputFiles | Where-Object { $_ -notin $staged })
  if ($unexpected.Count -or $missing.Count) {
    throw "staged file whitelist mismatch; unexpected=$($unexpected -join ','); missing=$($missing -join ',')"
  }
  $cachedQuiet = Invoke-Git -Directory $ReleaseRoot -Arguments @("diff", "--cached", "--quiet") -AllowedExitCodes @(0, 1)
  if ($LASTEXITCODE -eq 0) {
    throw "bundle has no staged product change; it must not be published"
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
    exit 0
  }
  $pushOutput = @(& git -C $ReleaseRoot push "HEAD:main" 2>&1)
  if ($LASTEXITCODE -ne 0) {
    Complete-ReleaseState -Status "release-retryable" -BundleId $bundleId -CommitSha $commitSha -Reason "push failed; retry push only"
    [pscustomobject]@{
      status = "push-retryable"
      bundleId = $bundleId
      commitSha = $commitSha
      sourceNetworkAccessed = $false
      error = ($pushOutput | Select-Object -Last 20 | Out-String).Trim()
    } | ConvertTo-Json -Depth 8
    exit 3
  }
  Complete-ReleaseState -Status "published" -BundleId $bundleId -CommitSha $commitSha
  [pscustomobject]@{
    status = "published"
    bundleId = $bundleId
    commitSha = $commitSha
    publishedCount = [int]$manifest.actualAppliedCount
    sourceNetworkAccessed = $false
  } | ConvertTo-Json -Depth 8
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
      Invoke-Git -Directory $ReleaseRoot -Arguments (@("clean", "-fd", "--") + $outputFiles) | Out-Null
    } catch {
      $cleanupErrors += "owned-output clean failed: $($_.Exception.Message)"
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
  Complete-ReleaseState -Status "release-retryable" -BundleId $bundleId -Reason $message
  [pscustomobject]@{
    status = "release-retryable"
    bundleId = $bundleId
    commitSha = $commitSha
    sourceNetworkAccessed = $false
    error = $message
  } | ConvertTo-Json -Depth 8
  exit 1
}
