[CmdletBinding()]
param(
  [switch]$DryRun,
  [switch]$CollectOnly,
  [switch]$Daily,
  [switch]$Publish,
  [ValidateRange(30, 86400)]
  [int]$DailyTimeoutSeconds = 14400,
  [string]$RunId = "",
  [string]$RawRoot = ""
)

$ErrorActionPreference = "Stop"

$selectedModes = @($DryRun, $CollectOnly, $Daily, $Publish).Where({ $_ }).Count
if ($selectedModes -gt 1) {
  throw "Select only one mode: -DryRun, -CollectOnly, -Daily, or -Publish."
}

# No mode is deliberately safe: it performs an offline DryRun and never publishes.
$mode = if ($Publish) {
  "publish"
} elseif ($Daily) {
  "daily"
} elseif ($CollectOnly) {
  "collect-only"
} else {
  "dry-run"
}

$root = Split-Path -Parent $PSScriptRoot
$nodeScript = Join-Path $root "scripts\inventory\run-danish-daily-v1.mjs"
if (-not (Test-Path -LiteralPath $nodeScript -PathType Leaf)) {
  throw "Danish daily runner not found: $nodeScript"
}

Set-Location -LiteralPath $root
foreach ($environmentName in @("DANISH_RPA_EXE", "DANISH_RPA_UUID")) {
  if (-not [Environment]::GetEnvironmentVariable($environmentName, "Process")) {
    $userValue = [Environment]::GetEnvironmentVariable($environmentName, "User")
    if ($userValue) {
      [Environment]::SetEnvironmentVariable($environmentName, $userValue, "Process")
    }
  }
}
$arguments = @(
  $nodeScript,
  "--mode=$mode",
  "--timeout-seconds=$DailyTimeoutSeconds"
)
if ($RunId) { $arguments += "--run-id=$RunId" }
if ($RawRoot) { $arguments += "--raw-root=$RawRoot" }
# The Node runner releases its inventory lock after each complete attempt, then
# retries only its explicit strong-verification classification (30m, then 60m).
if ($mode -in @("daily", "publish")) { $arguments += "--strong-verification-retry" }

Write-Host "Danish daily mode: $mode"
Write-Host "Danish daily runner: $nodeScript"
if ($RunId) { Write-Host "RunId: $RunId" }
if ($RawRoot) { Write-Host "Raw root: $RawRoot" }

# ============================================================
# PROTECTED BEHAVIOR — Danish PushDeer notification
#
# Publish / Daily / CollectOnly 完成或失败后发送 PushDeer。
# PushDeer 自身发送失败不得改变日更本身的 ExitCode。
# DryRun 不发送通知。
#
# 未经明确授权，不得删除或回退此通知逻辑。
# ============================================================

function Get-DanishPushDeerKey {
    $names = @(
        "PUSHDEER_KEY",
        "PUSHDEER_PUSHKEY",
        "YAN_DOUBUY_PUSHDEER_PUSHKEY"
    )

    foreach ($name in $names) {
        foreach ($scope in @("Process", "User", "Machine")) {
            try {
                $value = [Environment]::GetEnvironmentVariable(
                    $name,
                    $scope
                )
            }
            catch {
                $value = $null
            }

            if (-not [string]::IsNullOrWhiteSpace($value)) {
                return [pscustomobject]@{
                    Key   = $value.Trim()
                    Name  = $name
                    Scope = $scope
                }
            }
        }
    }

    return $null
}

function Send-DanishPushDeer {
    param(
        [string]$Title,
        [string]$Body
    )

    $keyInfo = Get-DanishPushDeerKey

    if (-not $keyInfo) {
        Write-Warning "Danish PushDeer skipped: no PushDeer key found."
        return
    }

    try {
        [Net.ServicePointManager]::SecurityProtocol =
            [Net.SecurityProtocolType]::Tls12

        $url =
            "https://api2.pushdeer.com/message/push" +
            "?pushkey=" + [uri]::EscapeDataString($keyInfo.Key) +
            "&text=" + [uri]::EscapeDataString($Title) +
            "&desp=" + [uri]::EscapeDataString($Body) +
            "&type=markdown"

        $null = Invoke-RestMethod `
            -Method Get `
            -Uri $url `
            -TimeoutSec 30

        Write-Host (
            "Danish PushDeer sent via " +
            $keyInfo.Name +
            " (" +
            $keyInfo.Scope +
            ")"
        ) -ForegroundColor Green
    }
    catch {
        Write-Warning (
            "Danish PushDeer failed, but daily result is preserved: " +
            $_.Exception.Message
        )
    }
}

$runStartedAt = Get-Date

& node @arguments
$nodeExitCode = $LASTEXITCODE

if ($mode -ne "dry-run") {

    $summaryRoot = Join-Path $root "data\inventory\danish-daily"

    $summaryFile =
        Get-ChildItem `
            $summaryRoot `
            -Filter "run-summary.json" `
            -Recurse `
            -ErrorAction SilentlyContinue |
        Where-Object {
            $_.LastWriteTime -ge $runStartedAt.AddMinutes(-1)
        } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    $title = ""
    $body = ""

    if ($summaryFile) {
        try {
            # PROTECTED BEHAVIOR — Node run-summary is UTF-8.
            # Windows PowerShell 5.1 must not use its legacy default encoding here.
            $summaryText = [IO.File]::ReadAllText(
                $summaryFile.FullName,
                [Text.Encoding]::UTF8
            )

            $summary = $summaryText | ConvertFrom-Json

            $status = [string]$summary.status
            $runIdValue = [string]$summary.runId

            if ($status -eq "failed") {
                $strongRetry = $summary.strongVerificationRetry
                $isFinalStrongVerification =
                    $strongRetry -and
                    [bool]$strongRetry.retryable -and
                    [bool]$strongRetry.final

                if ($isFinalStrongVerification) {
                    $title = "Danish Daily ❌"
                    $body = @(
                        "原因：源站强验证"
                        "尝试次数：$($strongRetry.attempt)"
                        "Production：未修改"
                        "状态：今日自动更新停止，等待下一次计划任务"
                        "RunId: $runIdValue"
                    ) -join "`n"
                }
                else {
                    $title = "Danish｜日更失败"
                    $body = @(
                        "RunId: $runIdValue"
                        "状态: $status"
                        "失败原因: $($summary.failureReason)"
                        "Production 写入: $($summary.productionWritten)"
                        "Build: $($summary.buildPassed)"
                        "Commit: $($summary.commitExecuted)"
                        "Push: $($summary.pushExecuted)"
                    ) -join "`n"
                }
            }
            else {

                if ($status -eq "publish-passed") {
                    $title = "Danish｜发布成功"
                }
                elseif ($status -eq "publish-noop") {
                    $title = "Danish｜无需发布"
                }
                elseif ($status -eq "collect-only-passed") {
                    $title = "Danish｜采集完成"
                }
                else {
                    $title = "Danish｜日更完成"
                }

                $listCount = 0
                if ($summary.collection) {
                    $listCount = [int]$summary.collection.listCount
                }

                $added = 0
                $updated = 0
                $disappeared = 0

                if ($summary.diff) {
                    $added = [int]$summary.diff.added
                    $updated = [int]$summary.diff.updated
                    $disappeared = [int]$summary.diff.disappeared
                }

                $body = @(
                    "RunId: $runIdValue"
                    "状态: $status"
                    "List: $listCount"
                    "List Patch: $($summary.listPatchCount)"
                    "Detail Queue: $($summary.detailQueueCount)"
                    "本轮抓取 Detail: $($summary.fetchedDetailCount)"
                    "新增: $added"
                    "更新: $updated"
                    "列表消失记录: $disappeared"
                    "Production 写入: $($summary.productionWritten)"
                    "Build: $($summary.buildPassed)"
                    "Commit: $($summary.commitExecuted)"
                    "Push: $($summary.pushExecuted)"
                ) -join "`n"
            }
        }
        catch {
            $title = "Danish｜日更结果"
            $body =
                "日更已结束，但读取 run-summary.json 失败。`n" +
                "Node ExitCode: $nodeExitCode"
        }
    }
    else {
        $title =
            if ($nodeExitCode -eq 0) {
                "Danish｜日更完成"
            }
            else {
                "Danish｜日更失败"
            }

        $body =
            "未找到本轮 run-summary.json。`n" +
            "Node ExitCode: $nodeExitCode"
    }

    Send-DanishPushDeer `
        -Title $title `
        -Body $body
}

exit $nodeExitCode
