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

function evaluateGuard(state, { forceSameDayRerun = false, dateKey = "2026-07-19" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "smokingpipes-same-day-guard-"));
  const statePath = path.join(root, "state.json");
  fs.writeFileSync(statePath, `${JSON.stringify(state)}\n`);
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

assert.match(scheduledLauncher, /Test-SmokingpipesSameDaySuccess/);
assert.match(scheduledLauncher, /same-day-success-already-completed/);
assert.match(scheduledLauncher, /\[switch\]\$ForceSameDayRerun/);
assert.match(scheduledLauncher, /-ForceRunOnce/);
assert.match(scheduledLauncher, /-ForceSameDayRerun:\$ForceSameDayRerun/);
assert.ok(
  scheduledLauncher.indexOf("Test-SmokingpipesSameDaySuccess") < scheduledLauncher.indexOf("Start-Transcript"),
  "scheduled guard must run before logs and wrapper execution"
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
