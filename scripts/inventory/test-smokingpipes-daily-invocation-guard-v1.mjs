import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  buildAutoPublishNotification,
  validateAutoPublishNotificationReport,
} from "./smokingpipes-auto-publish-notify-v1.mjs";
import {
  buildPushDeerDailyMessage,
  runSmokingpipesDailyMobileReport,
  validateDailyMobileNotificationInvocation,
} from "./smokingpipes-daily-mobile-report-v1.mjs";

const projectRoot = process.cwd();
const inventoryRoot = path.join(projectRoot, "scripts", "inventory");
const guardModule = path.join(inventoryRoot, "smokingpipes-daily-invocation-guard-v1.psm1");
const scheduledLauncher = fs.readFileSync(
  path.join(inventoryRoot, "run-smokingpipes-scheduled-task-v1.ps1"),
  "utf8"
);
const autoPublish = fs.readFileSync(
  path.join(inventoryRoot, "run-smokingpipes-auto-publish.ps1"),
  "utf8"
);
const progressiveDaily = fs.readFileSync(
  path.join(inventoryRoot, "run-smokingpipes-progressive-daily.ps1"),
  "utf8"
);
const installer = fs.readFileSync(
  path.join(inventoryRoot, "install-smokingpipes-daily-task-v1.ps1"),
  "utf8"
);
const localDateKey = spawnSync(
  "powershell.exe",
  ["-NoProfile", "-Command", "Get-Date -Format yyyy-MM-dd"],
  { encoding: "utf8" }
).stdout.trim();
assert.match(localDateKey, /^\d{4}-\d{2}-\d{2}$/);

function evaluateGuardFromStateFile({ stateText, forceSameDayRerun = false, dateKey = "2026-07-19" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "smokingpipes-same-day-guard-"));
  const statePath = path.join(root, "state.json");
  if (stateText !== undefined) fs.writeFileSync(statePath, stateText);
  const escapedModule = guardModule.replaceAll("'", "''");
  const escapedState = statePath.replaceAll("'", "''");
  const command = [
    `$module='${escapedModule}'`,
    `$statePath='${escapedState}'`,
    "Import-Module -Name $module -Force",
    "$state=Read-SmokingpipesDailyTaskState -Path $statePath",
    `$decision=Test-SmokingpipesSameDaySuccess -State $state -LocalDateKey '${dateKey}' -ForceSameDayRerun:${forceSameDayRerun ? "$true" : "$false"}`,
    "$decision | ConvertTo-Json -Compress",
  ].join("\n");
  try {
    const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function evaluateGuard(state, options = {}) {
  return evaluateGuardFromStateFile({ ...options, stateText: `${JSON.stringify(state)}\n` });
}

function runScheduledLauncherFixture({ guardSource, stateText, expectedExitCode }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "smokingpipes-scheduled-launcher-"));
  const fixtureInventory = path.join(root, "scripts", "inventory");
  const logsRoot = path.join(root, "data", "review", "smokingpipes-scheduled-logs");
  const statePath = path.join(root, "data", "inventory", "smokingpipes-daily-task-state.json");
  const wrapperMarker = path.join(root, "wrapper-invoked.txt");
  try {
    fs.mkdirSync(fixtureInventory, { recursive: true });
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(path.join(fixtureInventory, "run-smokingpipes-scheduled-task-v1.ps1"), scheduledLauncher);
    fs.writeFileSync(path.join(fixtureInventory, "smokingpipes-daily-invocation-guard-v1.psm1"), guardSource);
    fs.writeFileSync(statePath, stateText);
    fs.writeFileSync(
      path.join(fixtureInventory, "run-smokingpipes-auto-publish.ps1"),
      `param([Parameter(ValueFromRemainingArguments = $true)][object[]]$Remaining)\nSet-Content -LiteralPath '${wrapperMarker.replaceAll("'", "''")}' -Value 'called'\n`
    );
    const powershell = path.join(process.env.WINDIR ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", path.join(fixtureInventory, "run-smokingpipes-scheduled-task-v1.ps1"),
        "-AutomationWorktree", root,
        "-BuildExecutable", powershell,
      ],
      { encoding: "utf8" }
    );
    assert.equal(result.status, expectedExitCode, result.stderr || result.stdout);
    const logs = fs.existsSync(logsRoot)
      ? fs.readdirSync(logsRoot).filter((name) => name.endsWith(".log"))
      : [];
    assert.equal(logs.length, 1, "launcher must create exactly one early transcript log");
    return {
      result,
      wrapperInvoked: fs.existsSync(wrapperMarker),
      logText: fs.readFileSync(path.join(logsRoot, logs[0]), "utf8"),
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const successfulProduction = {
  lastSuccessfulLocalDate: "2026-07-19",
  lastSuccessfulCompletedAt: "2026-07-19T10:45:00+08:00",
  lastSuccessfulRunId: "run-production",
  lastSuccessfulStatus: "success",
};
assert.equal(evaluateGuard(successfulProduction).ShouldSkip, true, "same-day production completion must no-op");
assert.equal(
  evaluateGuard({ ...successfulProduction, lastSuccessfulStatus: "no-production-change" }).ShouldSkip,
  true,
  "same-day no-production completion must no-op"
);
assert.equal(
  evaluateGuard({ dateKey: "2026-07-19", status: "retryable-failed", retryAllowed: true }).ShouldSkip,
  false,
  "failed runs must remain retryable"
);
assert.equal(
  evaluateGuard(successfulProduction, { dateKey: "2026-07-20" }).ShouldSkip,
  false,
  "next local day must run"
);
assert.equal(
  evaluateGuard(successfulProduction, { forceSameDayRerun: true }).ShouldSkip,
  false,
  "explicit ForceSameDayRerun must override"
);
assert.equal(
  evaluateGuard({ dateKey: "2026-07-19", status: "skipped-success", productionWritten: true }).ShouldSkip,
  true,
  "legacy skip marker must prevent one final old-schema repeat"
);
assert.equal(
  evaluateGuard({ dateKey: "2026-07-19", status: "skipped-success", productionWritten: true }, { dateKey: "2026-07-20" }).ShouldSkip,
  false,
  "yesterday legacy success must allow a new local day"
);
assert.equal(
  evaluateGuard({ dateKey: "2026-07-19", status: "failed" }).ShouldSkip,
  false,
  "legacy failure must remain retryable"
);
assert.equal(evaluateGuard({}).ShouldSkip, false, "an empty legacy state must be retryable");
assert.equal(
  evaluateGuardFromStateFile({ dateKey: "2026-07-19" }).ShouldSkip,
  false,
  "a missing state file must be retryable"
);
assert.equal(
  evaluateGuardFromStateFile({ stateText: "{broken-json", dateKey: "2026-07-19" }).ShouldSkip,
  false,
  "a malformed state file must never be inferred as success"
);

assert.match(scheduledLauncher, /Test-SmokingpipesSameDaySuccess/);
assert.match(scheduledLauncher, /same-day-success-already-completed/);
assert.match(scheduledLauncher, /\[switch\]\$ForceSameDayRerun/);
assert.match(scheduledLauncher, /-ForceRunOnce/);
assert.match(scheduledLauncher, /-ForceSameDayRerun:\$ForceSameDayRerun/);
assert.ok(
  scheduledLauncher.indexOf("Start-Transcript") < scheduledLauncher.indexOf("Test-SmokingpipesSameDaySuccess"),
  "scheduled launcher must create an early transcript before the same-day guard"
);
assert.ok(
  scheduledLauncher.indexOf("Test-SmokingpipesSameDaySuccess") < scheduledLauncher.indexOf("& $wrapper"),
  "scheduled guard must still run before wrapper execution"
);
assert.match(autoPublish, /Test-SmokingpipesSameDaySuccess/);
assert.ok(
  autoPublish.indexOf("Test-SmokingpipesSameDaySuccess") < autoPublish.indexOf("Sync-AutomationRuntimeWithOriginMain"),
  "auto-publish guard must run before runtime sync"
);
assert.match(progressiveDaily, /-ForceSameDayRerun/);
assert.match(progressiveDaily, /"--run-id=\$InvocationRunId"/);
assert.match(progressiveDaily, /final notification waits for auto-publish validation\/build\/push completion/);
assert.match(autoPublish, /Set-DailyTaskSuccessfulCompletion/);
assert.match(autoPublish, /daily reported no production write but tracked production changes exist/);

const noOpLauncher = runScheduledLauncherFixture({
  guardSource: fs.readFileSync(guardModule, "utf8"),
  stateText: JSON.stringify({ dateKey: localDateKey, status: "skipped-success", productionWritten: true }),
  expectedExitCode: 0,
});
assert.equal(noOpLauncher.wrapperInvoked, false, "same-day no-op must not call Daily wrapper");
assert.match(noOpLauncher.result.stdout, /same-day-success-already-completed/);
assert.match(noOpLauncher.logText, /same-day guard start/);
assert.match(noOpLauncher.logText, /same-day guard result shouldSkip=True/);

const failedGuardLauncher = runScheduledLauncherFixture({
  guardSource: [
    "Set-StrictMode -Version Latest",
    "function Read-SmokingpipesDailyTaskState { param([string]$Path) return @{} }",
    "function Test-SmokingpipesSameDaySuccess { param([object]$State, [switch]$ForceSameDayRerun) throw 'fixture guard failure' }",
    "Export-ModuleMember -Function Read-SmokingpipesDailyTaskState, Test-SmokingpipesSameDaySuccess",
  ].join("\n"),
  stateText: "{}\n",
  expectedExitCode: 1,
});
assert.equal(failedGuardLauncher.wrapperInvoked, false, "guard failure must not call Daily wrapper");
assert.match(failedGuardLauncher.logText, /same-day guard start/);
assert.match(failedGuardLauncher.logText, /fixture guard failure/);

for (const time of ["10:30", "12:30", "14:30", "16:30", "18:30", "20:30", "22:30"]) {
  assert.match(installer, new RegExp(time));
}

const currentReport = {
  runId: "run-current",
  startedAt: "2026-07-19T12:30:00.000+08:00",
  completedAt: "2026-07-19T12:31:00.000+08:00",
};
const currentState = { runId: "run-current", lastNotificationRunId: "" };
assert.equal(
  validateAutoPublishNotificationReport({
    report: currentReport,
    expectedRunId: "run-current",
    invocationStartedAt: currentReport.startedAt,
    taskState: currentState,
  }).allowed,
  true
);
assert.match(
  validateAutoPublishNotificationReport({
    report: currentReport,
    expectedRunId: "run-other",
    invocationStartedAt: currentReport.startedAt,
    taskState: currentState,
  }).reason,
  /stale-report-blocked/
);
assert.match(
  validateAutoPublishNotificationReport({
    report: { ...currentReport, startedAt: "2026-07-19T10:30:00.000+08:00" },
    expectedRunId: "run-current",
    invocationStartedAt: currentReport.startedAt,
    taskState: currentState,
  }).reason,
  /stale-report-blocked/
);
assert.match(
  validateAutoPublishNotificationReport({
    report: currentReport,
    expectedRunId: "run-current",
    invocationStartedAt: currentReport.startedAt,
    taskState: { ...currentState, lastNotificationRunId: "run-current" },
  }).reason,
  /notification-already-sent-for-run/
);

assert.equal(
  validateDailyMobileNotificationInvocation({
    report: currentReport,
    taskState: currentState,
    runId: "run-current",
    invocationStartedAt: currentReport.startedAt,
  }).allowed,
  true
);
assert.match(
  validateDailyMobileNotificationInvocation({
    report: currentReport,
    taskState: { ...currentState, runId: "run-old" },
    runId: "run-current",
    invocationStartedAt: currentReport.startedAt,
  }).reason,
  /stale-report-blocked/
);

const noChangeAutoMessage = buildAutoPublishNotification({
  status: "no-production-change",
  actualApplied: 631,
  productionWritten: true,
});
assert.match(noChangeAutoMessage.body, /无库存变化/);
assert.doesNotMatch(noChangeAutoMessage.body, /631/);
const noChangeMobileMessage = buildPushDeerDailyMessage({ status: "no-production-change" });
assert.match(noChangeMobileMessage.body, /Production：未写入/);
assert.doesNotMatch(noChangeMobileMessage.body, /631/);

const reportFixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smokingpipes-no-change-report-"));
try {
  const statePath = path.join(reportFixtureRoot, "progressive-state.json");
  const auditPath = path.join(reportFixtureRoot, "audit.json");
  const taskStatePath = path.join(reportFixtureRoot, "daily-task-state.json");
  const reportJsonPath = path.join(reportFixtureRoot, "mobile-report.json");
  const reportMarkdownPath = path.join(reportFixtureRoot, "mobile-report.md");
  fs.writeFileSync(statePath, JSON.stringify({ source: "smokingpipes", candidates: [] }));
  fs.writeFileSync(auditPath, JSON.stringify({ auditStatus: "PASS", productionWritten: true, candidateCount: 1363 }));
  fs.writeFileSync(taskStatePath, JSON.stringify({
    status: "no-production-change",
    runId: "run-no-change",
    invocationStartedAt: "2026-07-19T12:30:00.000+08:00",
    completedAt: "2026-07-19T12:31:00.000+08:00",
    productionWritten: true,
    appliedCount: 631,
    candidateCount: 1363,
    lastNotificationRunId: "",
  }));
  const noChangeResult = await runSmokingpipesDailyMobileReport({
    argv: [
      "--send",
      "--dry-run-notify",
      "--run-id=run-no-change",
      "--invocation-started-at=2026-07-19T12:30:00.000+08:00",
      `--task-state=${taskStatePath}`,
    ],
    now: "2026-07-19T12:31:00.000+08:00",
    statePath,
    auditPath,
    taskStatePath,
    reportJsonPath,
    reportMarkdownPath,
  });
  assert.equal(noChangeResult.report.status, "no-production-change");
  assert.equal(noChangeResult.report.appliedCount, 0);
  assert.equal(noChangeResult.report.productionWritten, false);
  assert.equal(noChangeResult.report.candidateCount, 0);
  assert.doesNotMatch(fs.readFileSync(reportMarkdownPath, "utf8"), /631/);
} finally {
  fs.rmSync(reportFixtureRoot, { recursive: true, force: true });
}

console.log("Smokingpipes daily invocation guard tests passed.");
