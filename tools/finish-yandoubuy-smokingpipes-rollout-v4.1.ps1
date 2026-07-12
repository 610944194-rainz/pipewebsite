param(
  [switch]$Resume,
  [switch]$PreflightOnly,
  [switch]$StopAfterApply,
  [switch]$DryRunFromState,
  [string]$AutomationWorktree,
  [string]$RolloutStatePath
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$NodeExe = (Get-Command node.exe -CommandType Application -ErrorAction Stop).Source
$NpmCmd = (Get-Command npm.cmd -CommandType Application -ErrorAction Stop).Source

$Release = "C:\Users\NING MEI\Desktop\pipewebsite-auto-release"
$Automation = if ([string]::IsNullOrWhiteSpace($AutomationWorktree)) { "C:\Users\NING MEI\Desktop\pipewebsite-automation" } else { [IO.Path]::GetFullPath($AutomationWorktree) }
$Development = "C:\Users\NING MEI\Desktop\pipewebsite"
$Isolation = "C:\Users\NING MEI\Desktop\sp-isolated-diagnostic-20260711-073202"
$VerifiedCodeRoot = Join-Path $Isolation "fresh-production-copy"
$StatePath = if ([string]::IsNullOrWhiteSpace($RolloutStatePath)) { "C:\Users\NING MEI\Desktop\yandoubuy-rollout-state.json" } else { [IO.Path]::GetFullPath($RolloutStatePath) }
$ExpectedListSha = "6C7C9AFF595252BC3DCE4372C3420CE519E40F2B1F8C109CAE396DA3E4ED3CE4"
$CodeFiles = @(
  "scripts/build-public-product-indexes-v1.mjs",
  "scripts/validate-public-product-indexes-v1.mjs",
  "scripts/lib/public-index-performance-budget-v1.mjs",
  "scripts/test-public-index-performance-budget-v1.mjs"
)
$SchedulerTaskName = "YandouBuy Smokingpipes Daily Update"
$SchedulerTaskPath = "\"
$OldTaskNames = @(
  "YandouBuy Inventory Daily List Dry Run",
  "YandouBuy Inventory List Dry Run 2120"
)
$StageOrder = @(
  "preflight", "backup", "sync-code", "verify-code", "commit-code",
  "backup-production", "apply-production", "validate-production",
  "commit-production", "push", "sync-worktrees", "scheduler-preflight",
  "scheduler-enable-and-trigger", "final-report"
)
$script:CurrentStage = "startup"
$script:LastCommand = $null
$script:CommandResults = [System.Collections.Generic.List[object]]::new()
$script:State = $null
$script:LogRoot = $null
$script:ReportRoot = $null
$script:TranscriptPath = $null
$script:TranscriptStarted = $false

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

function Read-JsonUtf8 {
  param([Parameter(Mandatory)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Missing JSON file: $Path"
  }
  $text = [IO.File]::ReadAllText($Path, [Text.UTF8Encoding]::new($false))
  $text = $text.TrimStart([char]0xFEFF)
  try { return $text | ConvertFrom-Json }
  catch { throw "JSON parse failed: $Path; $($_.Exception.Message)" }
}

function Write-JsonUtf8 {
  param([string]$Path, [object]$Value, [int]$Depth = 10)
  $parent = Split-Path $Path -Parent
  if ($parent) { [IO.Directory]::CreateDirectory($parent) | Out-Null }
  $text = $Value | ConvertTo-Json -Depth $Depth
  [IO.File]::WriteAllText($Path, $text + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
}

function ConvertTo-NativeArgument {
  param([AllowEmptyString()][string]$Value)
  if ($Value -eq "") { return '""' }
  if ($Value -notmatch '[\s"]') { return $Value }
  $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
  $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
  return '"' + $escaped + '"'
}

function Get-LogTail {
  param([string]$Path, [int]$Lines)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return @() }
  return @(Get-Content -LiteralPath $Path -Tail $Lines -Encoding UTF8 -ErrorAction SilentlyContinue |
    ForEach-Object { $_ -replace "\x1b\[[0-9;?]*[ -/]*[@-~]", "" })
}

function Invoke-External {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string]$FilePath,
    [string[]]$Arguments = @(),
    [Parameter(Mandatory)][string]$WorkingDirectory,
    [string]$LogRoot = $script:LogRoot,
    [int[]]$AllowedExitCodes = @(0),
    [switch]$PassThru
  )
  Assert-True ([bool]$LogRoot) "LogRoot is required for Invoke-External."
  [IO.Directory]::CreateDirectory($LogRoot) | Out-Null
  $safeName = $Name -replace '[^A-Za-z0-9_.-]', '_'
  $stdout = Join-Path $LogRoot "$safeName.stdout.log"
  $stderr = Join-Path $LogRoot "$safeName.stderr.log"
  $argumentLine = ($Arguments | ForEach-Object { ConvertTo-NativeArgument $_ }) -join " "
  $started = Get-Date
  Write-Host "START: $Name"
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $FilePath
  $startInfo.Arguments = $argumentLine
  $startInfo.WorkingDirectory = $WorkingDirectory
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  Assert-True ($process.Start()) "Failed to start process: $FilePath"
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $process.WaitForExit()
  $stdoutText = $stdoutTask.GetAwaiter().GetResult()
  $stderrText = $stderrTask.GetAwaiter().GetResult()
  [IO.File]::WriteAllText($stdout, $stdoutText, [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText($stderr, $stderrText, [Text.UTF8Encoding]::new($false))
  $elapsed = [math]::Round(((Get-Date) - $started).TotalSeconds, 2)
  $result = [pscustomobject]@{
    name = $Name; filePath = $FilePath; arguments = $Arguments
    workingDirectory = $WorkingDirectory; exitCode = $process.ExitCode
    elapsedSeconds = $elapsed; stdoutPath = $stdout; stderrPath = $stderr
  }
  $script:LastCommand = $result
  $script:CommandResults.Add($result)
  if ($AllowedExitCodes -contains $process.ExitCode) {
    Write-Host "PASS: $Name (exit $($process.ExitCode), elapsed ${elapsed}s)"
    if ($PassThru) { return $result }
    return
  }
  Write-Host "FAIL: $Name (exit $($process.ExitCode), elapsed ${elapsed}s)"
  Write-Host "--- stdout tail (40 lines) ---"
  Get-LogTail $stdout 40 | Write-Host
  Write-Host "--- stderr tail (80 lines) ---"
  Get-LogTail $stderr 80 | Write-Host
  throw "$Name failed with exit code $($process.ExitCode). See stdout=$stdout stderr=$stderr"
}

function Invoke-Git {
  param([string]$Name, [string]$Repository, [string[]]$Arguments)
  Invoke-External -Name $Name -FilePath "git.exe" `
    -Arguments (@("-c", "safe.directory=$Repository", "-C", $Repository) + $Arguments) -WorkingDirectory $Repository | Out-Null
}

function Get-GitText {
  param([string]$Repository, [string[]]$Arguments)
  $lines = @(& git.exe -c "safe.directory=$Repository" -C $Repository @Arguments 2>$null)
  Assert-True ($LASTEXITCODE -eq 0) "git $($Arguments -join ' ') failed in $Repository"
  return ($lines -join "`n").Trim()
}

function Test-GitAncestor {
  param([string]$Repository, [string]$Older, [string]$Newer)
  & git.exe -c "safe.directory=$Repository" -C $Repository merge-base --is-ancestor $Older $Newer 2>$null
  return $LASTEXITCODE -eq 0
}

function Get-RemoteMainReadOnly {
  param([string]$Repository, [string]$LogRoot)
  $result = Invoke-External -Name "ls-remote-main" -FilePath "git.exe" `
    -Arguments @("-c", "http.sslBackend=openssl", "-c", "safe.directory=$Repository", "-C", $Repository, "ls-remote", "origin", "refs/heads/main") `
    -WorkingDirectory $Repository -LogRoot $LogRoot -PassThru
  $text = [IO.File]::ReadAllText($result.stdoutPath, [Text.UTF8Encoding]::new($false)).Trim()
  $sha = ($text -split "\s+")[0]
  Assert-True ($sha -match '^[0-9a-f]{40}$') "Cannot discover origin/main SHA."
  return $sha
}

function Test-GitMetadataWrite {
  param([string]$Repository)
  $gitDir = Get-GitText $Repository @("rev-parse", "--absolute-git-dir")
  $commonRaw = Get-GitText $Repository @("rev-parse", "--git-common-dir")
  $common = if ([IO.Path]::IsPathRooted($commonRaw)) { $commonRaw } else { [IO.Path]::GetFullPath((Join-Path $Repository $commonRaw)) }
  foreach ($dir in @($gitDir, $common) | Select-Object -Unique) {
    $probe = Join-Path $dir (".rollout-v4-probe-" + [guid]::NewGuid().ToString("N"))
    [IO.File]::WriteAllText($probe, "probe", [Text.UTF8Encoding]::new($false))
    Assert-True (Test-Path -LiteralPath $probe) "Cannot create Git probe: $probe"
    [IO.File]::Delete($probe)
    Assert-True (-not (Test-Path -LiteralPath $probe)) "Cannot remove Git probe: $probe"
  }
}

function Get-OptionalPropertyValue {
  param(
    [AllowNull()][object]$InputObject,
    [Parameter(Mandatory)][string]$Name,
    [AllowNull()][object]$Default = $null
  )
  if ($null -eq $InputObject) { return $Default }
  $property = $InputObject.PSObject.Properties[$Name]
  if ($null -eq $property) { return $Default }
  return $property.Value
}

function Get-OptionalJsonObject {
  param([AllowNull()][object]$InputObject, [Parameter(Mandatory)][string]$Name)
  $value = Get-OptionalPropertyValue -InputObject $InputObject -Name $Name -Default $null
  if ($null -eq $value) { return [pscustomobject]@{} }
  return $value
}

function Get-OptionalJsonInt {
  param([AllowNull()][object]$InputObject, [Parameter(Mandatory)][string]$Name, [int]$Default = 0)
  $value = Get-OptionalPropertyValue -InputObject $InputObject -Name $Name -Default $Default
  try { return [int]$value } catch { return $Default }
}

function Get-OptionalJsonBool {
  param([AllowNull()][object]$InputObject, [Parameter(Mandatory)][string]$Name, [bool]$Default = $false)
  return [bool](Get-OptionalPropertyValue -InputObject $InputObject -Name $Name -Default $Default)
}

function Get-RequiredJsonValue {
  param([AllowNull()][object]$InputObject, [Parameter(Mandatory)][string]$Name)
  $value = Get-OptionalPropertyValue -InputObject $InputObject -Name $Name -Default $null
  Assert-True ($null -ne $value) "Missing required JSON field: $Name"
  return $value
}

function Get-RequiredJsonInt {
  param([AllowNull()][object]$InputObject, [Parameter(Mandatory)][string]$Name)
  $value = Get-RequiredJsonValue $InputObject $Name
  try { return [int]$value } catch { throw "Invalid integer JSON field: $Name" }
}

function Get-RequiredJsonBool {
  param([AllowNull()][object]$InputObject, [Parameter(Mandatory)][string]$Name)
  return [bool](Get-RequiredJsonValue $InputObject $Name)
}

function Get-TaskExecActionInfo {
  param([Parameter(Mandatory)][object]$Task)
  $actionsValue = Get-OptionalPropertyValue -InputObject $Task -Name "Actions" -Default @()
  foreach ($action in @($actionsValue)) {
    if ($null -eq $action) { continue }
    $executeValue = Get-OptionalPropertyValue -InputObject $action -Name "Execute" -Default ""
    $argumentsValue = Get-OptionalPropertyValue -InputObject $action -Name "Arguments" -Default ""
    $workingDirectoryValue = Get-OptionalPropertyValue -InputObject $action -Name "WorkingDirectory" -Default ""
    $execute = if ($null -eq $executeValue) { "" } else { [string]$executeValue }
    $arguments = if ($null -eq $argumentsValue) { "" } else { [string]$argumentsValue }
    $workingDirectory = if ($null -eq $workingDirectoryValue) { "" } else { [string]$workingDirectoryValue }
    if ([string]::IsNullOrWhiteSpace($execute)) { continue }
    [pscustomobject]@{
      Raw = $action
      Execute = $execute
      Arguments = $arguments
      WorkingDirectory = $workingDirectory
      CommandLine = (($execute + " " + $arguments).Trim())
    }
  }
}

function Test-TaskReferencesAutoPublishRunner {
  param([Parameter(Mandatory)][object]$Task)
  return @(
    Get-TaskExecActionInfo -Task $Task |
      Where-Object { $_.CommandLine -match "run-smokingpipes-auto-publish\.ps1" }
  ).Count -gt 0
}

function Test-TaskReferencesProgressiveRunner {
  param([Parameter(Mandatory)][object]$Task)
  return @(
    Get-TaskExecActionInfo -Task $Task |
      Where-Object { $_.CommandLine -match "run-smokingpipes-progressive-daily\.ps1" }
  ).Count -gt 0
}

function Get-TaskNameValue {
  param([AllowNull()][object]$Task)
  return [string](Get-OptionalPropertyValue -InputObject $Task -Name "TaskName" -Default "")
}

function Get-TaskPathValue {
  param([AllowNull()][object]$Task)
  $value = [string](Get-OptionalPropertyValue -InputObject $Task -Name "TaskPath" -Default "\")
  if ([string]::IsNullOrWhiteSpace($value)) { return "\" }
  return $value
}

function Get-SchedulerDiscoveryFromTasks {
  param([Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Tasks)

  $exact = @(
    foreach ($task in @($Tasks)) {
      if ($null -eq $task) { continue }
      if ((Get-TaskNameValue $task) -eq $SchedulerTaskName -and (Get-TaskPathValue $task) -eq $SchedulerTaskPath) {
        $task
      }
    }
  )
  $autoPublish = @(
    foreach ($task in @($Tasks)) {
      if ($null -ne $task -and (Test-TaskReferencesAutoPublishRunner -Task $task)) { $task }
    }
  )
  $outsideAutoPublish = @(
    foreach ($task in $autoPublish) {
      if ((Get-TaskNameValue $task) -ne $SchedulerTaskName -or (Get-TaskPathValue $task) -ne $SchedulerTaskPath) {
        $task
      }
    }
  )

  $conflicts = [System.Collections.Generic.List[string]]::new()
  if ($exact.Count -gt 1) { $conflicts.Add("Multiple exact Smokingpipes task definitions were found.") }
  if ($outsideAutoPublish.Count -gt 0) {
    $names = @($outsideAutoPublish | ForEach-Object { "$(Get-TaskPathValue $_)$(Get-TaskNameValue $_)" }) -join "; "
    $conflicts.Add("Another task already invokes the Auto Publish runner: $names")
  }
  if ($autoPublish.Count -gt 1) { $conflicts.Add("Multiple tasks invoke the Auto Publish runner.") }

  if ($conflicts.Count -gt 0) {
    return [pscustomobject]@{
      Status = "Conflicting"
      Count = $exact.Count
      Task = if ($exact.Count -eq 1) { $exact[0] } else { $null }
      Tasks = $exact
      Conflicts = @($conflicts)
    }
  }

  if ($exact.Count -eq 0) {
    return [pscustomobject]@{
      Status = "NotInstalled"; Count = 0; Task = $null; Tasks = @(); Conflicts = @()
    }
  }

  $task = $exact[0]
  if (Test-TaskReferencesAutoPublishRunner -Task $task) {
    $status = "AutoPublishInstalled"
  } elseif (Test-TaskReferencesProgressiveRunner -Task $task) {
    $status = "LegacyInstalled"
  } else {
    $status = "Conflicting"
    $conflicts.Add("The exact Smokingpipes task name exists, but its action is neither the legacy runner nor the Auto Publish runner.")
  }

  return [pscustomobject]@{
    Status = $status; Count = 1; Task = $task; Tasks = $exact; Conflicts = @($conflicts)
  }
}

function Get-SchedulerDiscovery {
  try {
    $tasks = @(Get-ScheduledTask -ErrorAction Stop)
    return Get-SchedulerDiscoveryFromTasks -Tasks $tasks
  } catch {
    throw "Scheduled task discovery failed: $($_.Exception.Message)"
  }
}

function Test-SchedulerDiscoveryLogic {
  $nonExec = [pscustomobject]@{ ClassName = "MSFT_TaskComHandlerAction" }
  $legacyAction = [pscustomobject]@{
    Execute = "powershell.exe"
    Arguments = '-NoProfile -File "C:\Users\NING MEI\Desktop\pipewebsite\scripts\inventory\run-smokingpipes-progressive-daily.ps1"'
    WorkingDirectory = "C:\Users\NING MEI\Desktop\pipewebsite"
  }
  $autoAction = [pscustomobject]@{
    Execute = "powershell.exe"
    Arguments = '-NoProfile -File "C:\Users\NING MEI\Desktop\pipewebsite-automation\scripts\inventory\run-smokingpipes-auto-publish.ps1"'
    WorkingDirectory = "C:\Users\NING MEI\Desktop\pipewebsite-automation"
  }
  $legacyTask = [pscustomobject]@{ TaskName = $SchedulerTaskName; TaskPath = $SchedulerTaskPath; State = "Disabled"; Actions = @($nonExec, $legacyAction) }
  $autoTask = [pscustomobject]@{ TaskName = $SchedulerTaskName; TaskPath = $SchedulerTaskPath; State = "Disabled"; Actions = @($autoAction) }
  $otherAutoTask = [pscustomobject]@{ TaskName = "Unexpected Auto Publish"; TaskPath = $SchedulerTaskPath; State = "Disabled"; Actions = @($autoAction) }

  Assert-True ((Get-SchedulerDiscoveryFromTasks -Tasks @()).Status -eq "NotInstalled") "Scheduler self-test failed for zero tasks."
  Assert-True ((Get-SchedulerDiscoveryFromTasks -Tasks @($legacyTask)).Status -eq "LegacyInstalled") "Scheduler self-test failed for legacy task."
  Assert-True ((Get-SchedulerDiscoveryFromTasks -Tasks @($autoTask)).Status -eq "AutoPublishInstalled") "Scheduler self-test failed for Auto Publish task."
  Assert-True ((Get-SchedulerDiscoveryFromTasks -Tasks @($autoTask, $otherAutoTask)).Status -eq "Conflicting") "Scheduler self-test failed for duplicate Auto Publish task."
  $actions = @(Get-TaskExecActionInfo -Task ([pscustomobject]@{ Actions = @($nonExec, [pscustomobject]@{ Execute = "cmd.exe" }) }))
  Assert-True ($actions.Count -eq 1 -and $actions[0].Arguments -eq "") "Scheduler self-test failed for missing Arguments property."
}

function New-AutoPublishTaskAction {
  param([switch]$PreflightOnlyAction)
  $runner = Join-Path $Automation "scripts\inventory\run-smokingpipes-auto-publish.ps1"
  Assert-True (Test-Path -LiteralPath $runner -PathType Leaf) "Auto Publish runner is missing: $runner"
  $argument = "-NoProfile -ExecutionPolicy Bypass -File `"$runner`" -AutomationWorktree `"$Automation`""
  if ($PreflightOnlyAction) { $argument += " -PreflightOnly" }
  return New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argument -WorkingDirectory $Automation
}

function New-SmokingpipesDailyTriggers {
  return @(
    New-ScheduledTaskTrigger -Daily -At "10:30"
    New-ScheduledTaskTrigger -Daily -At "12:30"
    New-ScheduledTaskTrigger -Daily -At "14:30"
    New-ScheduledTaskTrigger -Daily -At "16:30"
    New-ScheduledTaskTrigger -Daily -At "18:30"
    New-ScheduledTaskTrigger -Daily -At "20:30"
    New-ScheduledTaskTrigger -Daily -At "22:30"
  )
}

function New-SmokingpipesTaskSettings {
  $settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -WakeToRun `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew
  $settings.WakeToRun = $true
  $settings.MultipleInstances = "IgnoreNew"
  return $settings
}

function Get-ConfiguredAutoApplyLimit {
  $name = "YANDOUBUY_SMOKINGPIPES_MAX_AUTO_APPLY"
  foreach ($scope in @("User", "Machine")) {
    $value = [Environment]::GetEnvironmentVariable($name, $scope)
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      return [pscustomobject]@{ Source = $scope; Value = [string]$value }
    }
  }
  $envPath = Join-Path $Automation ".env.inventory.local"
  if (Test-Path -LiteralPath $envPath -PathType Leaf) {
    foreach ($line in [IO.File]::ReadAllLines($envPath, [Text.UTF8Encoding]::new($false))) {
      $trimmed = $line.Trim()
      if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) { continue }
      $index = $trimmed.IndexOf("=")
      $key = $trimmed.Substring(0, $index).Trim()
      if ($key -eq $name) {
        $value = $trimmed.Substring($index + 1).Trim().Trim('"').Trim("'")
        return [pscustomobject]@{ Source = $envPath; Value = [string]$value }
      }
    }
  }
  return [pscustomobject]@{ Source = "runner-default"; Value = "300" }
}

function Assert-AutoPublishTaskDefinition {
  param([bool]$ExpectDisabled)
  $discovery = Get-SchedulerDiscovery
  Assert-True ($discovery.Status -eq "AutoPublishInstalled") "Auto Publish task is not uniquely installed: $($discovery.Status); $(@($discovery.Conflicts) -join '; ')"
  $task = $discovery.Task
  $runner = Join-Path $Automation "scripts\inventory\run-smokingpipes-auto-publish.ps1"
  $matching = @(
    Get-TaskExecActionInfo -Task $task |
      Where-Object { $_.Arguments.IndexOf($runner, [StringComparison]::OrdinalIgnoreCase) -ge 0 }
  )
  Assert-True ($matching.Count -eq 1) "Expected exactly one task action for the Auto Publish runner; found $($matching.Count)."
  $action = $matching[0]
  Assert-True ((Normalize-PathForComparison $action.WorkingDirectory) -eq (Normalize-PathForComparison $Automation)) "Auto Publish task working directory is incorrect."
  Assert-True ($action.Arguments -notmatch "manual-large-apply|NoProductionWrite|NoPush|PreflightOnly") "Final Auto Publish task contains a temporary or unsafe argument."
  $state = [string](Get-OptionalPropertyValue -InputObject $task -Name "State" -Default "Unknown")
  if ($ExpectDisabled) {
    Assert-True ($state -eq "Disabled") "Auto Publish task must remain disabled until the trigger validation stage; actual state: $state"
  } else {
    Assert-True ($state -ne "Disabled") "Auto Publish task should be enabled after validation."
  }
  $limit = Get-ConfiguredAutoApplyLimit
  Assert-True ([int]$limit.Value -eq 300) "Daily max auto apply must be 300; source=$($limit.Source) value=$($limit.Value)"
  $dailyRunner = Join-Path $Automation "scripts\inventory\run-smokingpipes-progressive-daily.ps1"
  $dailyText = [IO.File]::ReadAllText($dailyRunner, [Text.UTF8Encoding]::new($false))
  Assert-True ($dailyText -match "--browser-profile=sp-chrome") "Daily runner does not use the dedicated sp-chrome profile."
  return $task
}

function Install-OrUpdate-AutoPublishTask {
  $discovery = Get-SchedulerDiscovery
  Assert-True ($discovery.Status -ne "Conflicting") "Scheduled task conflict: $(@($discovery.Conflicts) -join '; ')"
  if ($discovery.Task) {
    $state = [string](Get-OptionalPropertyValue -InputObject $discovery.Task -Name "State" -Default "Unknown")
    Assert-True ($state -ne "Running") "Smokingpipes scheduled task is currently running."
  }
  $action = New-AutoPublishTaskAction
  if ($discovery.Status -eq "NotInstalled") {
    Register-ScheduledTask `
      -TaskName $SchedulerTaskName `
      -TaskPath $SchedulerTaskPath `
      -Action $action `
      -Trigger (New-SmokingpipesDailyTriggers) `
      -Settings (New-SmokingpipesTaskSettings) `
      -Description "Runs the YandouBuy Smokingpipes Auto Publish pipeline every two hours during the daily window." `
      -Force | Out-Null
  } else {
    Set-ScheduledTask `
      -TaskName $SchedulerTaskName `
      -TaskPath $SchedulerTaskPath `
      -Action $action | Out-Null
  }
  Disable-ScheduledTask -TaskName $SchedulerTaskName -TaskPath $SchedulerTaskPath | Out-Null
  return Assert-AutoPublishTaskDefinition -ExpectDisabled $true
}

function Normalize-PathForComparison {
  param([AllowEmptyString()][string]$Path)
  if ([string]::IsNullOrWhiteSpace($Path)) { return "" }
  $trimChars = [char[]]@([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  try { return ([IO.Path]::GetFullPath($Path)).TrimEnd($trimChars).ToUpperInvariant() }
  catch { return $Path.Trim().TrimEnd($trimChars).ToUpperInvariant() }
}

function New-State {
  param([string]$RunId, [string]$BackupRoot)
  [pscustomobject]@{
    schemaVersion = 2; runId = $RunId; completedStages = @(); currentStage = "startup"
    codeCommit = $null; productionCommit = $null; originMainAtStart = $null
    originMainCurrent = $null; releaseHeadAtStart = $null; automationHeadAtStart = $null
    productionBackup = $null; productionWriteStarted = $false; applyCompleted = $false; productionApplySnapshot = $null
    productionValidated = $false; productionCommitted = $false; pushed = $false
    schedulerEnabled = $false; schedulerLastTaskResult = $null
    schedulerTaskName = $null; backupRoot = $BackupRoot; logRoot = (Join-Path $BackupRoot "logs")
    reportRoot = (Join-Path $BackupRoot "review"); rolledBack = $false
    developmentHeadAtStart = $null; developmentStatusAtStart = $null
  }
}

function Initialize-StateCompatibility {
  param([Parameter(Mandatory)][object]$State)

  foreach ($name in @("schemaVersion", "runId", "backupRoot")) {
    if ($null -eq $State.PSObject.Properties[$name]) {
      throw "Legacy rollout state is missing required field: $name"
    }
  }
  foreach ($name in @("runId", "backupRoot")) {
    if ([string]::IsNullOrWhiteSpace([string]$State.$name)) {
      throw "Legacy rollout state has an empty required field: $name"
    }
  }

  $defaults = [ordered]@{
    completedStages = @(); currentStage = "startup"
    codeCommit = $null; productionCommit = $null; originMainAtStart = $null
    originMainCurrent = $null; releaseHeadAtStart = $null; automationHeadAtStart = $null
    productionBackup = $null; productionWriteStarted = $false; applyCompleted = $false; productionApplySnapshot = $null
    productionValidated = $false; productionCommitted = $false; pushed = $false
    schedulerEnabled = $false; schedulerLastTaskResult = $null; schedulerTaskName = $null
    logRoot = (Join-Path ([string]$State.backupRoot) "logs")
    reportRoot = (Join-Path ([string]$State.backupRoot) "review")
    rolledBack = $false; developmentHeadAtStart = $null; developmentStatusAtStart = $null
  }

  foreach ($name in $defaults.Keys) {
    if ($null -eq $State.PSObject.Properties[$name]) {
      Add-Member -InputObject $State -MemberType NoteProperty -Name $name -Value $defaults[$name]
    }
  }
  return $State
}

function Save-State {
  if ($PreflightOnly) { return }
  Write-JsonUtf8 $StatePath $script:State 12
}

function Complete-Stage {
  param([string]$Name)
  $script:State.completedStages = @($script:State.completedStages | Where-Object { $_ -ne $Name }) + $Name
  $script:State.currentStage = $Name
  Save-State
  Write-Host "STAGE COMPLETE: $Name"
}

function Invoke-Stage {
  param([string]$Name, [scriptblock]$Action)
  if ($Resume -and @($script:State.completedStages) -contains $Name) {
    $replayApply = $Name -eq "apply-production" -and [bool]$script:State.productionWriteStarted -and -not [bool]$script:State.productionCommitted -and -not (Test-ProductionMatchesApplyTarget)
    if ($replayApply) {
      Write-Host "RESUME REPLAY: apply-production target fingerprint is absent or mismatched."
    } else {
      Write-Host "RESUME SKIP: $Name"
      return
    }
  }
  $script:CurrentStage = $Name
  $script:State.currentStage = $Name
  Save-State
  Write-Host "STAGE START: $Name"
  & $Action
  Complete-Stage $Name
}
function Write-FailureReport {
  param(
    [string]$Path, [string]$RunId, [string]$FailedStage, [Exception]$Exception,
    [string]$StdoutPath, [string]$StderrPath, [bool]$ProductionWriteStarted,
    [bool]$ProductionCommitted, [bool]$RolledBack
  )
  $message = [string]$Exception.Message
  if ($message.Length -gt 2000) { $message = $message.Substring(0, 2000) }
  $report = [pscustomobject]@{
    schemaVersion = 2; status = "YANDOUBUY_SMOKINGPIPES_ROLLOUT_INCOMPLETE"
    runId = $RunId; failedStage = $FailedStage; exceptionType = $Exception.GetType().FullName
    message = $message; blocker = $message; stdoutPath = $StdoutPath; stderrPath = $StderrPath
    productionWriteStarted = $ProductionWriteStarted
    productionCommitted = $ProductionCommitted; rolledBack = $RolledBack
    generatedAt = (Get-Date).ToString("o")
  }
  Write-JsonUtf8 $Path $report 6
}

function Copy-BackupItem {
  param([string]$SourceRoot, [string]$RelativePath, [string]$TargetRoot)
  $source = Join-Path $SourceRoot $RelativePath
  if (-not (Test-Path -LiteralPath $source)) { return }
  $target = Join-Path $TargetRoot $RelativePath
  [IO.Directory]::CreateDirectory((Split-Path $target -Parent)) | Out-Null
  if (Test-Path -LiteralPath $source -PathType Container) {
    if (Test-Path -LiteralPath $target) {
      if (Test-Path -LiteralPath $target -PathType Container) {
        [IO.Directory]::Delete($target, $true)
      } else {
        [IO.File]::Delete($target)
      }
    }
    Copy-Item -LiteralPath $source -Destination $target -Recurse -Force
    return
  }
  Copy-Item -LiteralPath $source -Destination $target -Recurse -Force
}

function Write-BackupManifest {
  param([string]$Root, [string]$Path)

  $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd([char[]]@("\", "/"))
  $manifestFull = [IO.Path]::GetFullPath($Path)

  # The transcript is actively held open by Start-Transcript for the lifetime
  # of the rollout. Logs and reports are runtime evidence, not backup payloads,
  # so exclude those live directories before hashing backup artifacts.
  $excludedRoots = @(
    $script:LogRoot,
    $script:ReportRoot
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | ForEach-Object {
    [IO.Path]::GetFullPath([string]$_).TrimEnd([char[]]@("\", "/"))
  }

  $files = @(
    Get-ChildItem -LiteralPath $Root -Recurse -File |
      Where-Object {
        $full = [IO.Path]::GetFullPath($_.FullName)
        $isManifest = [string]::Equals(
          $full,
          $manifestFull,
          [StringComparison]::OrdinalIgnoreCase
        )

        $isExcluded = $false
        foreach ($excludedRoot in $excludedRoots) {
          $prefix = $excludedRoot + [IO.Path]::DirectorySeparatorChar
          if (
            [string]::Equals(
              $full,
              $excludedRoot,
              [StringComparison]::OrdinalIgnoreCase
            ) -or
            $full.StartsWith(
              $prefix,
              [StringComparison]::OrdinalIgnoreCase
            )
          ) {
            $isExcluded = $true
            break
          }
        }

        (-not $isManifest) -and (-not $isExcluded)
      } |
      ForEach-Object {
        [pscustomobject]@{
          path = $_.FullName.Substring($rootFull.Length + 1).Replace("\", "/")
          bytes = $_.Length
          sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
        }
      }
  )

  Write-JsonUtf8 $Path ([pscustomobject]@{
    schemaVersion = 1
    generatedAt = (Get-Date).ToString("o")
    excludedRuntimeDirectories = @($excludedRoots)
    files = $files
  }) 8
  Read-JsonUtf8 $Path | Out-Null
}

function Assert-Validation {
  param([string]$Path)
  $r = Read-JsonUtf8 $Path
  $counts = Get-OptionalJsonObject $r "counts"
  $performance = Get-OptionalJsonObject $r "performance"
  $safety = Get-OptionalJsonObject $r "safety"
  Assert-True ((Get-RequiredJsonValue $r "status") -eq "passed") "Validator did not pass."
  $catalogCount = Get-RequiredJsonInt $counts "catalogProducts"
  Assert-True ($catalogCount -gt 0) "Validator catalog count must be positive."
  foreach ($name in @("detailRecords", "lookupById", "lookupBySourceProduct")) {
    Assert-True ((Get-RequiredJsonInt $counts $name) -eq $catalogCount) "Validator count mismatch: $name."
  }
  Assert-True (Get-RequiredJsonBool $performance "budgetsPassed") "Performance budgets failed."
  Assert-True ((Get-RequiredJsonInt $counts "detailShardCount") -eq 64) "Detail shard count mismatch."
  Assert-True ((Get-RequiredJsonBool $safety "falconAkbExcluded") -and (Get-RequiredJsonBool $safety "smokingpipesNeedsReviewExcluded")) "Public safety exclusion failed."
  return $r
}

function Assert-ProductionValidationCounts {
  param([Parameter(Mandatory)][object]$Validation)
  $counts = Get-OptionalJsonObject $Validation "counts"
  $sourceCounts = Get-OptionalJsonObject $counts "sourceCounts"
  $catalogCount = Get-RequiredJsonInt $counts "catalogProducts"
  $danishCount = Get-RequiredJsonInt $sourceCounts "danish"
  $smokingpipesCount = Get-RequiredJsonInt $sourceCounts "smokingpipes"
  Assert-True ($danishCount -ge 0 -and $smokingpipesCount -ge 0 -and ($danishCount + $smokingpipesCount -eq $catalogCount)) "Production source counts are inconsistent."
  Assert-True ((Get-RequiredJsonInt $counts "brandCount") -gt 0) "Production brand count must be positive."
}
function Assert-ProgressiveAudit {
  param([Parameter(Mandatory)][object]$Audit)
  $counts = Get-OptionalJsonObject $Audit "counts"
  Assert-True ((Get-RequiredJsonValue $Audit "verdict") -eq "PASS") "Progressive audit verdict is not PASS."
  $blockersProperty = $Audit.PSObject.Properties["blockers"]
  Assert-True ($null -ne $blockersProperty) "Missing required JSON field: blockers"
  $blockers = $blockersProperty.Value
  Assert-True (@($blockers).Count -eq 0) "Progressive audit contains blockers."
  foreach ($field in @("deletedProducts", "pendingLeak", "failedLeak", "blockedLeak", "reviewOnlyLeak", "zeroPriceSellable")) {
    Assert-True ((Get-RequiredJsonInt $counts $field) -eq 0) "Leakage failed: $field"
  }
  foreach ($field in @("duplicateProducts", "duplicatePublic", "duplicateRecentNew", "recentNewSold")) {
    Assert-True ((Get-RequiredJsonInt $Audit $field) -eq 0) "Progressive audit failed: $field"
  }
}
function Restore-Production {
  if (-not $script:State.productionBackup) { return }
  foreach ($relative in @(
    "data/products/smokingpipes-products.json", "data/products/unified-products-staging.json",
    "data/generated/public-products", "data/inventory/smokingpipes-progressive-daily-state.json",
    "data/inventory/smokingpipes-inventory-diff-dry-run.json",
    "data/review/smokingpipes-progressive-apply-gate-report.json",
    "data/review/smokingpipes-progressive-partial-audit-report.json",
    "data/review/smokingpipes-progressive-partial-audit-report.md",
    "data/review/smokingpipes-progressive-partial-apply-preview.json"
  )) { Copy-BackupItem $script:State.productionBackup $relative $Automation }
  Invoke-External "rollback-series-index" $NodeExe @("scripts/audit-product-series-candidates-v1.mjs") $Automation | Out-Null
  Invoke-External "rollback-validator" $NodeExe @("scripts/validate-public-product-indexes-v1.mjs") $Automation | Out-Null
  Assert-Validation (Join-Path $Automation "data/review/round5-public-index-validation-v1.json") | Out-Null
  $script:State.applyCompleted = $false
  $script:State.productionApplySnapshot = $null
  $script:State.rolledBack = $true
  Save-State
}

function Get-ProductionHashSnapshot {
  $paths = @(
    "data/products/smokingpipes-products.json", "data/products/unified-products-staging.json",
    "data/generated/public-products/catalog.json", "data/generated/public-products/detail-lookup.json",
    "data/generated/public-products/manifest.json"
  )
  $result = [ordered]@{}
  foreach ($relative in $paths) {
    $path = Join-Path $Automation $relative
    $result[$relative] = (Get-FileHash $path -Algorithm SHA256).Hash
  }
  return $result
}

function Test-ProductionMatchesBackup {
  param([string]$BackupRoot, [string]$TargetRoot)
  if ([string]::IsNullOrWhiteSpace($BackupRoot) -or -not (Test-Path -LiteralPath $BackupRoot)) {
    return $false
  }
  foreach ($relative in @(
    "data/products/smokingpipes-products.json", "data/products/unified-products-staging.json",
    "data/generated/public-products/catalog.json", "data/generated/public-products/detail-lookup.json",
    "data/generated/public-products/manifest.json"
  )) {
    $backupPath = Join-Path $BackupRoot $relative
    $targetPath = Join-Path $TargetRoot $relative
    if (-not (Test-Path -LiteralPath $backupPath -PathType Leaf) -or -not (Test-Path -LiteralPath $targetPath -PathType Leaf)) {
      return $false
    }
    if ((Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $targetPath -Algorithm SHA256).Hash) {
      return $false
    }
  }
  return $true
}

function Test-ProductionMatchesSnapshot {
  param([AllowNull()][object]$Snapshot, [string]$TargetRoot)
  if ($null -eq $Snapshot) { return $false }
  foreach ($relative in @(
    "data/products/smokingpipes-products.json", "data/products/unified-products-staging.json",
    "data/generated/public-products/catalog.json", "data/generated/public-products/detail-lookup.json",
    "data/generated/public-products/manifest.json"
  )) {
    $expected = Get-OptionalPropertyValue -InputObject $Snapshot -Name $relative -Default $null
    $targetPath = Join-Path $TargetRoot $relative
    if ([string]::IsNullOrWhiteSpace([string]$expected) -or -not (Test-Path -LiteralPath $targetPath -PathType Leaf)) { return $false }
    if ((Get-FileHash -LiteralPath $targetPath -Algorithm SHA256).Hash -ne [string]$expected) { return $false }
  }
  return $true
}

function Test-ProductionMatchesApplyTarget {
  $applyCompleted = Get-OptionalPropertyValue -InputObject $script:State -Name "applyCompleted" -Default $false
  return [bool]$applyCompleted -and (Test-ProductionMatchesSnapshot (Get-OptionalPropertyValue -InputObject $script:State -Name "productionApplySnapshot" -Default $null) $Automation)
}
function Invoke-Preflight {
  param([bool]$ReadOnly)
  foreach ($path in @($Release, $Automation, $Development, $Isolation, $VerifiedCodeRoot)) {
    Assert-True (Test-Path -LiteralPath $path -PathType Container) "Missing required directory: $path"
  }
  $list = Join-Path $Automation "data/inventory/smokingpipes-current-list-dry-run.json"
  Assert-True ((Get-FileHash $list -Algorithm SHA256).Hash -eq $ExpectedListSha) "current-list SHA256 mismatch."
  $catalog = Read-JsonUtf8 (Join-Path $Automation "data/generated/public-products/catalog.json")
  $manifest = Read-JsonUtf8 (Join-Path $Automation "data/generated/public-products/manifest.json")
  $catalogProducts = Get-OptionalPropertyValue -InputObject $catalog -Name "products" -Default @()
  $manifestCount = Get-RequiredJsonInt $manifest "publicProductCount"
  Assert-True (@($catalogProducts).Count -gt 0 -and @($catalogProducts).Count -eq $manifestCount) "Current catalog and manifest counts are inconsistent."
  foreach ($file in $CodeFiles) {
    $current = Join-Path $Release $file
    Assert-True (Test-Path $current) "Missing code file: $file"
    if ((Get-GitText $Release @("status", "--porcelain=v1", "--", $file))) {
      $verified = Join-Path $VerifiedCodeRoot $file
      Assert-True (Test-Path $verified) "Missing verified code file: $file"
      Assert-True ((Get-FileHash $current -Algorithm SHA256).Hash -eq (Get-FileHash $verified -Algorithm SHA256).Hash) "Uncommitted code differs from verified version: $file"
    }
  }
  Test-SchedulerDiscoveryLogic
  $scheduler = Get-SchedulerDiscovery
  Assert-True ($scheduler.Status -ne "Conflicting") "Scheduled task conflict: $(@($scheduler.Conflicts) -join '; ')"
  if ($scheduler.Task) {
    $taskState = Get-OptionalPropertyValue -InputObject $scheduler.Task -Name "State" -Default "Unknown"
    Assert-True ([string]$taskState -ne "Running") "Smokingpipes scheduled task is running."
  }
  Write-Host "SCHEDULER_STATE: $($scheduler.Status)"
  if (-not $ReadOnly) {
    Assert-True ([Security.Principal.WindowsIdentity]::GetCurrent().Name -notmatch "CodexSandboxOnline") "Formal mode must run under the normal Windows account."
    Test-GitMetadataWrite $Release
    Test-GitMetadataWrite $Automation
    $running = @(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match "run-smokingpipes-(?:auto-publish|progressive-daily)|run-inventory-automation-v1" })
    Assert-True ($running.Count -eq 0) "An inventory process is already running."
  }
  return $scheduler
}

function Invoke-ResumeDryRun {
  Assert-True ($Resume) "DryRunFromState requires -Resume."
  Assert-True (@($script:State.completedStages) -contains "apply-production") "Dry-run requires completed apply-production."

  if (
    [bool]$script:State.productionWriteStarted -and
    -not [bool]$script:State.productionCommitted -and
    -not (Test-ProductionMatchesApplyTarget)
  ) {
    Write-Host "DRY-RUN REPLAY REQUIRED: apply-production target fingerprint is absent or mismatched; Resume will replay before validation."
    return
  }

  Write-Host "DRY-RUN START: validate-production"
  # The validator report is an output artifact, not an immutable input. A
  # resumed apply can replace the indexes after this report was generated, so
  # refresh it from the formal apply's automation root before count checks.
  Invoke-External "dry-run-production-validator" $NodeExe @("scripts/validate-public-product-indexes-v1.mjs") $Automation | Out-Null
  $validation = Assert-Validation (Join-Path $Automation "data/review/round5-public-index-validation-v1.json")
  Assert-ProductionValidationCounts $validation
  $audit = Read-JsonUtf8 (Join-Path $Automation "data/review/smokingpipes-progressive-partial-audit-report.json")
  Assert-ProgressiveAudit $audit
  $validationErrors = @(Get-OptionalPropertyValue $validation "errors" @())
  $validationWarnings = @(Get-OptionalPropertyValue $validation "warnings" @())
  Assert-True ($validationErrors.Count -eq 0) "Dry-run validator contains errors."
  Write-Host "DRY-RUN PASS: validate-production (warnings=$($validationWarnings.Count))"

  Write-Host "DRY-RUN START: commit-production"
  $allowed = @("data/products/smokingpipes-products.json", "data/products/unified-products-staging.json", "data/generated/public-products/")
  $changed = @(Get-GitText $Automation @("diff", "--name-only") -split "`n" | Where-Object { $_ })
  $unexpected = @($changed | Where-Object { $n = $_; -not ($allowed | Where-Object { $n -eq $_ -or $n.StartsWith($_) }) })
  Assert-True ($changed.Count -gt 0 -and $unexpected.Count -eq 0) "Dry-run production diff is unexpected: $($unexpected -join '; ')"
  Write-Host "DRY-RUN PASS: commit-production would stage $($changed.Count) allowed files"

  Write-Host "DRY-RUN START: push-precheck"
  $remote = Get-GitText $Automation @("rev-parse", "origin/main")
  Assert-True (-not [string]::IsNullOrWhiteSpace([string]$script:State.codeCommit)) "Dry-run has no code commit."
  Assert-True (Test-GitAncestor $Automation $remote ([string]$script:State.codeCommit)) "Dry-run origin/main is not compatible with the code commit."
  Write-Host "DRY-RUN PASS: push-precheck (no push executed)"

  Write-Host "DRY-RUN START: scheduler-preflight"
  $scheduler = Invoke-Preflight $true
  Write-Host "DRY-RUN PASS: scheduler-preflight (state=$($scheduler.Status); no scheduler write executed)"
}

if ($env:YANDOUBUY_ROLLOUT_LIBRARY_ONLY -eq "1") { return }

if ($PreflightOnly) {
  $preflightRoot = Join-Path $env:TEMP ("yandoubuy-rollout-v4-preflight-" + [guid]::NewGuid().ToString("N"))
  try {
    [IO.Directory]::CreateDirectory($preflightRoot) | Out-Null
    $script:LogRoot = $preflightRoot
    $scheduler = Invoke-Preflight $true
    $remote = Get-RemoteMainReadOnly $Release $preflightRoot
    Write-Host "PRECHECK: release HEAD=$(Get-GitText $Release @('rev-parse','HEAD'))"
    Write-Host "PRECHECK: automation HEAD=$(Get-GitText $Automation @('rev-parse','HEAD'))"
    Write-Host "PRECHECK: origin/main=$remote"
    Write-Host "YANDOUBUY_ROLLOUT_PREFLIGHT_PASS"
    exit 0
  } catch {
    Write-Host "YANDOUBUY_ROLLOUT_PREFLIGHT_FAIL"
    Write-Host (($_.Exception.Message).Substring(0, [Math]::Min(2000, $_.Exception.Message.Length)))
    exit 1
  } finally {
    if (Test-Path $preflightRoot) { [IO.Directory]::Delete($preflightRoot, $true) }
  }
}

$runId = if ($Resume) { $null } else { Get-Date -Format "yyyyMMdd-HHmmss" }
if ($Resume) {
  $script:State = Initialize-StateCompatibility -State (Read-JsonUtf8 $StatePath)
  Assert-True ([int]$script:State.schemaVersion -eq 2) "Unsupported rollout state schema."
  $runId = [string]$script:State.runId
} else {
  Assert-True (-not (Test-Path $StatePath)) "Existing rollout state found. Use -Resume or archive it first."
  $backupRoot = "C:\Users\NING MEI\Desktop\yandoubuy-rollout-backup-$runId"
  $script:State = New-State $runId $backupRoot
}
$script:LogRoot = [string]$script:State.logRoot
$script:ReportRoot = [string]$script:State.reportRoot
$script:TranscriptPath = Join-Path $script:LogRoot "rollout-summary-transcript.log"
if ($DryRunFromState) {
  try {
    Invoke-ResumeDryRun
    Write-Host "YANDOUBUY_ROLLOUT_DRY_RUN_PASS"
    exit 0
  } catch {
    Write-Host "YANDOUBUY_ROLLOUT_DRY_RUN_FAIL"
    Write-Host (($_.Exception.Message).Substring(0, [Math]::Min(2000, $_.Exception.Message.Length)))
    exit 1
  }
}
[IO.Directory]::CreateDirectory($script:LogRoot) | Out-Null
[IO.Directory]::CreateDirectory($script:ReportRoot) | Out-Null
Start-Transcript -LiteralPath $script:TranscriptPath -Force | Out-Null
$script:TranscriptStarted = $true

try {
  Invoke-Stage "preflight" {
    $scheduler = Invoke-Preflight $false
    Invoke-Git "fetch-origin-start" $Release @("-c", "http.sslBackend=openssl", "fetch", "origin")
    $script:State.releaseHeadAtStart = Get-GitText $Release @("rev-parse", "HEAD")
    $script:State.automationHeadAtStart = Get-GitText $Automation @("rev-parse", "HEAD")
    $script:State.developmentHeadAtStart = Get-GitText $Development @("rev-parse", "HEAD")
    $script:State.developmentStatusAtStart = Get-GitText $Development @("status", "--porcelain=v1", "--untracked-files=all")
    $script:State.originMainAtStart = Get-GitText $Release @("rev-parse", "origin/main")
    $script:State.originMainCurrent = $script:State.originMainAtStart
    Assert-True (Test-GitAncestor $Release $script:State.releaseHeadAtStart $script:State.originMainAtStart) "Release cannot fast-forward to origin/main."
    Assert-True (Test-GitAncestor $Automation $script:State.automationHeadAtStart $script:State.originMainAtStart) "Automation cannot fast-forward to origin/main."
    Save-State
  }

  Invoke-Stage "backup" {
    $root = [string]$script:State.backupRoot
    [IO.Directory]::CreateDirectory($root) | Out-Null
    $diff = Invoke-External "backup-code-diff" "git.exe" @("-C", $Release, "diff", "--binary") $Release -PassThru
    Copy-Item $diff.stdoutPath (Join-Path $root "release-tracked.patch") -Force
    foreach ($file in $CodeFiles) { Copy-BackupItem $Release $file (Join-Path $root "code-files") }
    foreach ($relative in @(
      "data/products/smokingpipes-products.json", "data/products/unified-products-staging.json",
      "data/generated/public-products", "data/inventory/smokingpipes-progressive-daily-state.json",
      "data/inventory/smokingpipes-inventory-diff-dry-run.json",
      "data/review/smokingpipes-progressive-apply-gate-report.json",
      "data/review/smokingpipes-progressive-partial-audit-report.json",
      "data/review/smokingpipes-progressive-partial-apply-preview.json"
    )) { Copy-BackupItem $Automation $relative (Join-Path $root "initial-production") }
    $taskDir = Join-Path $root "scheduled-tasks"
    [IO.Directory]::CreateDirectory($taskDir) | Out-Null
    foreach ($task in @(Get-ScheduledTask | Where-Object { $_.TaskName -match "YandouBuy|Smokingpipes|Inventory" })) {
      Export-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath | Set-Content (Join-Path $taskDir (($task.TaskName -replace '[^A-Za-z0-9_.-]', '_') + ".xml")) -Encoding UTF8
    }
    Write-BackupManifest $root (Join-Path $root "backup-manifest.json")
  }

  Invoke-Stage "sync-code" {
    $npmCache = Join-Path $Release ".npm-cache"
    if (Test-Path $npmCache) { [IO.Directory]::Delete($npmCache, $true) }
    $dirtyCode = @(Get-GitText $Release @("status", "--porcelain=v1", "--") + "") -ne ""
    if ($dirtyCode) {
      Invoke-Git "stash-code" $Release (@("stash", "push", "--include-untracked", "--message", "rollout-v4-$runId", "--") + $CodeFiles)
    }
    Invoke-Git "fetch-origin-sync" $Release @("-c", "http.sslBackend=openssl", "fetch", "origin")
    $remote = Get-GitText $Release @("rev-parse", "origin/main")
    Assert-True (Test-GitAncestor $Release (Get-GitText $Release @("rev-parse", "HEAD")) $remote) "Release cannot safely fast-forward."
    Invoke-Git "fast-forward-release" $Release @("merge", "--ff-only", "origin/main")
    if ($dirtyCode) { Invoke-Git "restore-code" $Release @("stash", "pop") }
    Assert-True (@(Get-GitText $Release @("status", "--porcelain=v1") -split "`n" | Where-Object { $_ -match '^UU ' }).Count -eq 0) "Code restore conflict."
    $script:State.originMainCurrent = $remote
    Save-State
  }

  Invoke-Stage "verify-code" {
    foreach ($file in $CodeFiles) { Invoke-External "node-check-$([IO.Path]::GetFileName($file))" $NodeExe @("--check", $file) $Release | Out-Null }
    Invoke-External "budget-test" $NodeExe @("scripts/test-public-index-performance-budget-v1.mjs") $Release | Out-Null
    Invoke-External "isolated-validator" $NodeExe @((Join-Path $Release "scripts/validate-public-product-indexes-v1.mjs")) $Isolation | Out-Null
    $ir = Assert-Validation (Join-Path $Isolation "data/review/round5-public-index-validation-v1.json")
    $irPerformance = Get-OptionalJsonObject $ir "performance"
    $irFixedBudgets = Get-OptionalJsonObject $irPerformance "fixedBudgets"
    Assert-True ((Get-OptionalJsonInt $irPerformance "effectiveCatalogMaxBytes" 0) -eq (Get-RequiredJsonInt (Get-OptionalJsonObject $ir "counts") "catalogProducts") * 1300) "Dynamic catalog budget mismatch."
    Assert-True ((Get-OptionalJsonInt $irPerformance "averageRecordLimit" 0) -eq 1300 -and (Get-OptionalJsonInt $irFixedBudgets "catalogMaxRecordBytes" 0) -eq 4000) "Record budgets changed."
    Invoke-External "public-default" $NodeExe @("scripts/test-public-products-inventory-default-v1.mjs") $Release | Out-Null
    Invoke-External "inventory-runner" $NodeExe @("scripts/inventory/test-inventory-runner-v1.mjs") $Release | Out-Null
    Invoke-External "auto-publish" $NodeExe @("scripts/inventory/test-smokingpipes-auto-publish-v1.mjs") $Release | Out-Null
    Invoke-External "build-code" $NpmCmd @("run", "build") $Release | Out-Null
    Invoke-Git "diff-check-code" $Release @("diff", "--check")
  }

  Invoke-Stage "commit-code" {
    $head = Get-GitText $Release @("rev-parse", "HEAD")
    if (-not $script:State.codeCommit -or $head -ne [string]$script:State.codeCommit) {
      Invoke-Git "stage-code" $Release (@("add", "--") + $CodeFiles)

$actual = (& git -C $Release diff --cached --name-only | Sort-Object) -join "`n"
$expected = ($CodeFiles | Sort-Object) -join "`n"
$skipCodeCommit = $false


if ($actual -ne $expected) {
  $alreadyCommitted = $true

  foreach ($file in $CodeFiles) {
    $existsInHead = & git -C $Release ls-tree -r HEAD --name-only -- $file

    if (-not $existsInHead) {
      $alreadyCommitted = $false
      break
    }
  }

  if ($alreadyCommitted -and [string]::IsNullOrWhiteSpace($actual)) {
    Write-Host "SKIP: code changes already committed in HEAD."
    $skipCodeCommit = $true
}
  else {
    throw "Staged code set is not exact."
  }
}
   if ($skipCodeCommit) {
    Write-Host "SKIP: code commit already exists."
}
else {
    Invoke-Git "commit-code" $Release @("commit", "-m", "fix(inventory): scale public catalog budget safely")
}

$script:State.codeCommit = Get-GitText $Release @("rev-parse", "HEAD")
Save-State 
    }
    Invoke-External "budget-test-post-code-commit" $NodeExe @("scripts/test-public-index-performance-budget-v1.mjs") $Release | Out-Null
    Invoke-External "build-post-code-commit" $NpmCmd @("run", "build") $Release | Out-Null
  }

  Invoke-Stage "backup-production" {
    Assert-True ((Get-GitText $Automation @("status", "--porcelain=v1", "--untracked-files=no")) -eq "") "Automation tracked files are dirty."
    Invoke-Git "sync-automation-code" $Automation @("merge", "--ff-only", [string]$script:State.codeCommit)
    $target = Join-Path ([string]$script:State.backupRoot) "formal-production-before"
    foreach ($relative in @(
      "data/products/smokingpipes-products.json", "data/products/unified-products-staging.json",
      "data/generated/public-products", "data/inventory/smokingpipes-progressive-daily-state.json",
      "data/inventory/smokingpipes-inventory-diff-dry-run.json",
      "data/review/smokingpipes-progressive-apply-gate-report.json",
      "data/review/smokingpipes-progressive-partial-audit-report.json",
      "data/review/smokingpipes-progressive-partial-audit-report.md",
      "data/review/smokingpipes-progressive-partial-apply-preview.json"
    )) { Copy-BackupItem $Automation $relative $target }
    Write-BackupManifest $target (Join-Path $target "manifest.json")
    $script:State.productionBackup = $target
    Save-State
  }

  Invoke-Stage "apply-production" {
    $resumeRequiresReplay = $Resume -and [bool]$script:State.productionWriteStarted -and `
      -not [bool]$script:State.productionCommitted -and `
      -not (Test-ProductionMatchesApplyTarget)
    if ($Resume -and [bool]$script:State.productionWriteStarted -and -not $resumeRequiresReplay) {
      $existing = Read-JsonUtf8 (Join-Path $Automation "data/review/smokingpipes-progressive-partial-apply-preview.json")
      Assert-True ((Get-RequiredJsonValue $existing "status") -eq "apply-complete" -and (Get-RequiredJsonBool $existing "productionWritten")) "Interrupted production apply cannot be safely resumed."
    } else {
      if ($resumeRequiresReplay) {
        Write-Host "RESUME: apply target fingerprint is absent or mismatched; repeating formal production apply."
        $script:State.rolledBack = $true
        Save-State
      }
      $script:State.productionWriteStarted = $true
      Save-State
      Invoke-External "formal-production-apply" $NodeExe @(
        "scripts/inventory/run-inventory-automation-v1.mjs", "--source=smokingpipes",
        "--mode=progressive-partial-apply", "--write-production", "--manual-large-apply",
        "--no-commit", "--no-deploy", "--verbose"
      ) $Automation | Out-Null
    }
    $apply = Read-JsonUtf8 (Join-Path $Automation "data/review/smokingpipes-progressive-partial-apply-preview.json")
    $applyBlockedReason = Get-OptionalPropertyValue $apply "blockedReason" $null
    $candidateCount = Get-RequiredJsonInt $apply "candidateCount"
    $wouldApplyCount = Get-RequiredJsonInt $apply "wouldApplyCount"
    $appliedCount = Get-RequiredJsonInt $apply "appliedCount"
    $isolatedCandidateCount = Get-RequiredJsonInt $apply "isolatedCandidateCount"
    Assert-True ((Get-RequiredJsonValue $apply "status") -eq "apply-complete" -and $candidateCount -ge $wouldApplyCount -and $wouldApplyCount -gt 0 -and $appliedCount -eq $wouldApplyCount -and $isolatedCandidateCount -ge 0) "Formal apply counts are structurally inconsistent."
    Assert-True ((Get-RequiredJsonBool $apply "productionWritten") -and -not $applyBlockedReason -and -not (Get-RequiredJsonBool $apply "commitPerformed") -and -not (Get-RequiredJsonBool $apply "pushPerformed")) "Formal apply flags are invalid."
    # A verified formal apply supersedes a restored backup. Persist the
    # transition so future resume/dry-run checks do not retain stale rollback.
    $script:State.applyCompleted = $true
    $script:State.productionApplySnapshot = Get-ProductionHashSnapshot
    $script:State.rolledBack = $false
    Save-State
  }

  if ($StopAfterApply) {
    Write-Host "STOP AFTER APPLY: apply-production passed; stopping before validation, commit, push, and scheduler stages."
    exit 0
  }

  Invoke-Stage "validate-production" {
    Invoke-External "production-validator" $NodeExe @("scripts/validate-public-product-indexes-v1.mjs") $Automation | Out-Null
    $v = Assert-Validation (Join-Path $Automation "data/review/round5-public-index-validation-v1.json")
    Assert-ProductionValidationCounts $v
    $audit = Read-JsonUtf8 (Join-Path $Automation "data/review/smokingpipes-progressive-partial-audit-report.json")
    Assert-ProgressiveAudit $audit
    Invoke-External "budget-test-production" $NodeExe @("scripts/test-public-index-performance-budget-v1.mjs") $Automation | Out-Null
    Invoke-External "public-default-production" $NodeExe @("scripts/test-public-products-inventory-default-v1.mjs") $Automation | Out-Null
    Invoke-External "inventory-runner-production" $NodeExe @("scripts/inventory/test-inventory-runner-v1.mjs") $Automation | Out-Null
    Invoke-External "auto-publish-production" $NodeExe @("scripts/inventory/test-smokingpipes-auto-publish-v1.mjs") $Automation | Out-Null
    Invoke-External "build-production" $NpmCmd @("run", "build") $Automation | Out-Null
    Invoke-Git "diff-check-production" $Automation @("diff", "--check")
    Assert-True ((Get-FileHash (Join-Path $Automation "data/inventory/smokingpipes-current-list-dry-run.json") -Algorithm SHA256).Hash -eq $ExpectedListSha) "current-list changed."
    $script:State.productionValidated = $true
    Save-State
  }

  Invoke-Stage "commit-production" {
    Assert-True ([bool]$script:State.productionValidated) "Production is not validated."
    $head = Get-GitText $Automation @("rev-parse", "HEAD")
    if (-not $script:State.productionCommit -or $head -ne [string]$script:State.productionCommit) {
      $allowed = @("data/products/smokingpipes-products.json", "data/products/unified-products-staging.json", "data/generated/public-products/")
      $changed = @(Get-GitText $Automation @("diff", "--name-only") -split "`n" | Where-Object { $_ })
      $unexpected = @($changed | Where-Object { $n = $_; -not ($allowed | Where-Object { $n -eq $_ -or $n.StartsWith($_) }) })
      Assert-True ($changed.Count -gt 0 -and $unexpected.Count -eq 0) "Unexpected production diff: $($unexpected -join '; ')"
      Invoke-Git "stage-production" $Automation @("add", "--", "data/products/smokingpipes-products.json", "data/products/unified-products-staging.json", "data/generated/public-products")
      Invoke-Git "commit-production" $Automation @("commit", "-m", "chore(inventory): publish Smokingpipes progressive baseline")
      $script:State.productionCommit = Get-GitText $Automation @("rev-parse", "HEAD")
      $script:State.productionCommitted = $true
      Save-State
    }
  }

  Invoke-Stage "push" {
    if ([bool]$script:State.pushed) {
      Invoke-Git "fetch-confirm-pushed" $Automation @("-c", "http.sslBackend=openssl", "fetch", "origin")
      Assert-True ((Get-GitText $Automation @("rev-parse", "origin/main")) -eq [string]$script:State.productionCommit) "Previously pushed remote SHA no longer matches."
      return
    }
    Invoke-Git "fetch-before-push" $Automation @("-c", "http.sslBackend=openssl", "fetch", "origin")
    $remote = Get-GitText $Automation @("rev-parse", "origin/main")
    $script:State.originMainCurrent = $remote
    Save-State
    $parent = Get-GitText $Automation @("rev-parse", ([string]$script:State.codeCommit + "^"))
    if ($remote -ne $parent) {
      Assert-True (Test-GitAncestor $Automation $remote ([string]$script:State.productionCommit)) "origin/main changed incompatibly; refusing push."
      Invoke-External "budget-test-after-remote-change" $NodeExe @("scripts/test-public-index-performance-budget-v1.mjs") $Automation | Out-Null
      Invoke-External "validator-after-remote-change" $NodeExe @("scripts/validate-public-product-indexes-v1.mjs") $Automation | Out-Null
      Assert-Validation (Join-Path $Automation "data/review/round5-public-index-validation-v1.json") | Out-Null
      Invoke-External "build-after-remote-change" $NpmCmd @("run", "build") $Automation | Out-Null
    }
    Invoke-Git "push-main" $Automation @("-c", "http.sslBackend=openssl", "push", "origin", "HEAD:main")
    Invoke-Git "fetch-after-push" $Automation @("-c", "http.sslBackend=openssl", "fetch", "origin")
    $script:State.originMainCurrent = Get-GitText $Automation @("rev-parse", "origin/main")
    Assert-True ($script:State.originMainCurrent -eq $script:State.productionCommit) "Remote SHA mismatch after push."
    $script:State.pushed = $true
    Save-State
  }

  Invoke-Stage "sync-worktrees" {
    Invoke-Git "sync-release-final" $Release @("merge", "--ff-only", "origin/main")
    Assert-True ((Get-GitText $Release @("status", "--porcelain=v1", "--untracked-files=no")) -eq "") "Release tracked status is dirty."
    Assert-True ((Get-GitText $Automation @("status", "--porcelain=v1", "--untracked-files=no")) -eq "") "Automation tracked status is dirty."
    Invoke-External "release-final-build" $NpmCmd @("run", "build") $Release | Out-Null
  }

  Invoke-Stage "scheduler-preflight" {
    $task = Install-OrUpdate-AutoPublishTask
    $script:State.schedulerTaskName = $SchedulerTaskName
    Save-State
    $runner = Join-Path $Automation "scripts/inventory/run-smokingpipes-auto-publish.ps1"
    Invoke-External "scheduler-runner-direct-preflight" "powershell.exe" @(
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $runner,
      "-PreflightOnly", "-AutomationWorktree", $Automation
    ) $Automation | Out-Null
    Assert-AutoPublishTaskDefinition -ExpectDisabled $true | Out-Null
  }

  Invoke-Stage "scheduler-enable-and-trigger" {
    $fullAction = New-AutoPublishTaskAction
    $preflightAction = New-AutoPublishTaskAction -PreflightOnlyAction
    $taskSucceeded = $false
    foreach ($oldName in $OldTaskNames) {
      $old = Get-ScheduledTask -TaskName $oldName -TaskPath "\" -ErrorAction SilentlyContinue
      if ($old) { Disable-ScheduledTask -TaskName $oldName -TaskPath "\" | Out-Null }
    }
    $taskExecutionError = $null
    try {
      Set-ScheduledTask -TaskName $SchedulerTaskName -TaskPath $SchedulerTaskPath -Action $preflightAction -ErrorAction Stop | Out-Null
      Enable-ScheduledTask -TaskName $SchedulerTaskName -TaskPath $SchedulerTaskPath -ErrorAction Stop | Out-Null
      Start-ScheduledTask -TaskName $SchedulerTaskName -TaskPath $SchedulerTaskPath -ErrorAction Stop
      $deadline = (Get-Date).AddMinutes(10)
      do {
        Start-Sleep 5
        $task = Get-ScheduledTask -TaskName $SchedulerTaskName -TaskPath $SchedulerTaskPath -ErrorAction Stop
      } while ($task.State -eq "Running" -and (Get-Date) -lt $deadline)
      Assert-True ($task.State -ne "Running") "Scheduled task preflight did not finish within 10 minutes."
      $info = Get-ScheduledTaskInfo -TaskName $SchedulerTaskName -TaskPath $SchedulerTaskPath -ErrorAction Stop
      $script:State.schedulerLastTaskResult = [int]$info.LastTaskResult
      Assert-True ([int]$info.LastTaskResult -eq 0) "Scheduled task preflight failed: $($info.LastTaskResult)"
      $taskSucceeded = $true
    } catch {
      $taskExecutionError = $_
    }
    try {
      Set-ScheduledTask -TaskName $SchedulerTaskName -TaskPath $SchedulerTaskPath -Action $fullAction -ErrorAction Stop | Out-Null
      if ($taskSucceeded) {
        Enable-ScheduledTask -TaskName $SchedulerTaskName -TaskPath $SchedulerTaskPath -ErrorAction Stop | Out-Null
      } else {
        Disable-ScheduledTask -TaskName $SchedulerTaskName -TaskPath $SchedulerTaskPath -ErrorAction Stop | Out-Null
      }
    } catch {
      Disable-ScheduledTask -TaskName $SchedulerTaskName -TaskPath $SchedulerTaskPath -ErrorAction SilentlyContinue | Out-Null
      $script:State.schedulerEnabled = $false
      Save-State
      throw "Failed to restore the final Auto Publish task action: $($_.Exception.Message)"
    }
    $script:State.schedulerEnabled = $taskSucceeded
    Save-State
    if ($null -ne $taskExecutionError) { throw $taskExecutionError }
    Assert-AutoPublishTaskDefinition -ExpectDisabled $false | Out-Null
    Invoke-External "post-scheduler-validator" $NodeExe @("scripts/validate-public-product-indexes-v1.mjs") $Automation | Out-Null
    Assert-Validation (Join-Path $Automation "data/review/round5-public-index-validation-v1.json") | Out-Null
    Invoke-Git "fetch-after-scheduler" $Automation @("-c", "http.sslBackend=openssl", "fetch", "origin")
    $remoteAfterScheduler = Get-GitText $Automation @("rev-parse", "origin/main")
    Assert-True ((Get-GitText $Automation @("rev-parse", "HEAD")) -eq $remoteAfterScheduler) "Automation HEAD changed during scheduled preflight."
    Assert-True ((Get-GitText $Release @("rev-parse", "HEAD")) -eq $remoteAfterScheduler) "Release HEAD changed during scheduled preflight."
    $script:State.originMainCurrent = $remoteAfterScheduler
    Save-State
  }

  Invoke-Stage "final-report" {
    $devHead = Get-GitText $Development @("rev-parse", "HEAD")
    $devStatus = Get-GitText $Development @("status", "--porcelain=v1", "--untracked-files=all")
    Assert-True ($devHead -eq [string]$script:State.developmentHeadAtStart -and $devStatus -eq [string]$script:State.developmentStatusAtStart) "Development repository changed during rollout."
    Assert-AutoPublishTaskDefinition -ExpectDisabled $false | Out-Null
    $finalValidation = Assert-Validation (Join-Path $Automation "data/review/round5-public-index-validation-v1.json")
    $finalCounts = Get-OptionalJsonObject $finalValidation "counts"
    $finalSourceCounts = Get-OptionalJsonObject $finalCounts "sourceCounts"
    $report = [pscustomobject]@{
      schemaVersion = 2; status = "YANDOUBUY_SMOKINGPIPES_ROLLOUT_COMPLETE"
      runId = $script:State.runId; state = $script:State; commands = @($script:CommandResults)
      transcript = $script:TranscriptPath; currentListSha256 = (Get-FileHash (Join-Path $Automation "data/inventory/smokingpipes-current-list-dry-run.json") -Algorithm SHA256).Hash
      counts = [pscustomobject]@{
        catalog = Get-OptionalJsonInt $finalCounts "catalogProducts" 0
        smokingpipes = Get-OptionalJsonInt $finalSourceCounts "smokingpipes" 0
        danish = Get-OptionalJsonInt $finalSourceCounts "danish" 0
        brands = Get-OptionalJsonInt $finalCounts "brandCount" 0
        shards = Get-OptionalJsonInt $finalCounts "detailShardCount" 0
      }
      scheduler = [pscustomobject]@{
        taskName = $SchedulerTaskName
        taskPath = $SchedulerTaskPath
        enabled = [bool]$script:State.schedulerEnabled
        lastTaskResult = [int]$script:State.schedulerLastTaskResult
        validationMode = "Task Scheduler preflight action; final action restored to full Auto Publish"
      }
      generatedAt = (Get-Date).ToString("o")
    }
    $json = Join-Path $script:ReportRoot "final-rollout-report.json"
    Write-JsonUtf8 $json $report 12
    Read-JsonUtf8 $json | Out-Null
    $md = @("# YandouBuy Smokingpipes rollout", "", "Status: YANDOUBUY_SMOKINGPIPES_ROLLOUT_COMPLETE", "", "- Code commit: $($script:State.codeCommit)", "- Production commit: $($script:State.productionCommit)", "- origin/main: $($script:State.originMainCurrent)", "- Backup: $($script:State.productionBackup)", "- Transcript: $($script:TranscriptPath)") -join [Environment]::NewLine
    [IO.File]::WriteAllText((Join-Path $script:ReportRoot "final-rollout-report.md"), $md + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
  }

  Write-Host "YANDOUBUY_SMOKINGPIPES_ROLLOUT_COMPLETE"
  exit 0
}
catch {
  $failure = $_
  $rolledBack = $false
  if ([bool]$script:State.productionWriteStarted -and -not [bool]$script:State.productionCommitted) {
    try { Restore-Production; $rolledBack = $true } catch { $rolledBack = $false }
  }
  $stdout = if ($script:LastCommand) { [string]$script:LastCommand.stdoutPath } else { $null }
  $stderr = if ($script:LastCommand) { [string]$script:LastCommand.stderrPath } else { $null }
  $reportPath = Join-Path $script:ReportRoot "final-rollout-report.json"
  Write-FailureReport -Path $reportPath -RunId ([string]$script:State.runId) -FailedStage $script:CurrentStage `
    -Exception $failure.Exception -StdoutPath $stdout -StderrPath $stderr `
    -ProductionWriteStarted ([bool]$script:State.productionWriteStarted) `
    -ProductionCommitted ([bool]$script:State.productionCommitted) -RolledBack $rolledBack
  Write-Host "YANDOUBUY_SMOKINGPIPES_ROLLOUT_INCOMPLETE"
  Write-Host "FAILED STAGE: $script:CurrentStage"
  $bounded = [string]$failure.Exception.Message
  if ($bounded.Length -gt 2000) { $bounded = $bounded.Substring(0, 2000) }
  Write-Host "BLOCKER: $bounded"
  exit 1
}
finally {
  if ($script:TranscriptStarted) { Stop-Transcript -ErrorAction SilentlyContinue | Out-Null }
}
