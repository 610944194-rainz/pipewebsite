import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = process.cwd();
const entrySource = fs.readFileSync(
  path.join(projectRoot, "scripts", "inventory", "run-smokingpipes-scheduled-task-v1.ps1"),
  "utf8"
);

function utcCycleId(daysOffset = 0) {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + daysOffset);
  return now.toISOString().slice(0, 10);
}

function writeCycleState(stateRoot, { cycleId, latestPhase, cyclePhase }) {
  fs.mkdirSync(path.join(stateRoot, "cycles", cycleId), { recursive: true });
  fs.writeFileSync(path.join(stateRoot, "latest.json"), JSON.stringify({ cycleId, phase: latestPhase }));
  fs.writeFileSync(path.join(stateRoot, "cycles", cycleId, "cycle.json"), JSON.stringify({ cycleId, phase: cyclePhase }));
}

function runFixture({
  mode,
  timeout = 20,
  cycleState = null,
  cycleId = "2026-07-31",
  noProductionWrite = true,
  noPush = true,
  preflightOnly = true,
  noLiveCollection = true,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "smokingpipes-scheduled-entry-v1-"));
  const inventory = path.join(root, "scripts", "inventory");
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smokingpipes-scheduled-state-v1-"));
  const releaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smokingpipes-scheduled-release-v1-"));
  const forwardedPath = path.join(root, "forwarded.json");
  try {
    fs.mkdirSync(inventory, { recursive: true });
    fs.mkdirSync(releaseRoot, { recursive: true });
    fs.writeFileSync(path.join(inventory, "run-smokingpipes-scheduled-task-v1.ps1"), entrySource);
    if (cycleState) writeCycleState(stateRoot, cycleState);
    if (mode === "success") {
      fs.writeFileSync(path.join(inventory, "run-smokingpipes-auto-publish.ps1"), `
param(
  [string]$StateRoot,
  [string]$ReleaseRoot,
  [int]$ProgressiveDetailMax,
  [int]$MaxAutoApply,
  [int]$DailyTimeoutSeconds,
  [switch]$NoProductionWrite,
  [switch]$NoPush,
  [switch]$PreflightOnly,
  [switch]$NoLiveCollection,
  [string]$CycleId
)
@{
  StateRoot = $StateRoot
  ReleaseRoot = $ReleaseRoot
  ProgressiveDetailMax = $ProgressiveDetailMax
  MaxAutoApply = $MaxAutoApply
  DailyTimeoutSeconds = $DailyTimeoutSeconds
  NoProductionWrite = [bool]$NoProductionWrite
  NoPush = [bool]$NoPush
  PreflightOnly = [bool]$PreflightOnly
  NoLiveCollection = [bool]$NoLiveCollection
  CycleId = $CycleId
} | ConvertTo-Json | Set-Content -LiteralPath $env:FORWARDED_PATH -Encoding utf8
Write-Output 'SCHEDULER_STAGE collection'
Write-Output 'SCHEDULER_STAGE release'
Write-Output 'SMOKINGPIPES_V2_RESULT_JSON={"status":"published","cycleId":"2026-07-31","failureStage":null,"error":null,"pendingDetailCount":0,"bundleAppliedCount":3,"publishedCount":3,"notification":{"sent":true,"reason":"fixture-sent"}}'
`);
    }
    if (mode === "missing-result") {
      fs.writeFileSync(path.join(inventory, "run-smokingpipes-auto-publish.ps1"), `
param([Parameter(ValueFromRemainingArguments = $true)][object[]]$Remaining)
Write-Error 'Error: fixture inner failure without a result marker'
exit 0
`);
    }
    if (mode === "retryable-result") {
      fs.writeFileSync(path.join(inventory, "run-smokingpipes-auto-publish.ps1"), `
param([Parameter(ValueFromRemainingArguments = $true)][object[]]$Remaining)
Write-Output 'SMOKINGPIPES_V2_RESULT_JSON={"status":"release-retryable","cycleId":"2026-07-31","failureStage":"bundle-build","error":"fixture failure","pendingDetailCount":0,"bundleAppliedCount":0,"publishedCount":0,"notification":{"sent":true,"reason":"fixture-sent"}}'
exit 0
`);
    }
    if (mode === "timeout") {
      fs.writeFileSync(path.join(inventory, "run-smokingpipes-auto-publish.ps1"), `
param([Parameter(ValueFromRemainingArguments = $true)][object[]]$Remaining)
$child = Start-Process -FilePath powershell.exe -ArgumentList '-NoProfile -Command Start-Sleep -Seconds 30' -PassThru
$child.Id | Set-Content -LiteralPath $env:CHILD_PID_PATH -Encoding ascii
Start-Sleep -Seconds 30
`);
    }
    const entry = path.join(inventory, "run-smokingpipes-scheduled-task-v1.ps1");
    const args = [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", entry,
      "-AutomationWorktree", root,
      "-StateRoot", stateRoot,
      "-ReleaseRoot", releaseRoot,
      "-ProgressiveDetailMax", "3",
      "-MaxAutoApply", "17",
      "-DailyTimeoutSeconds", mode === "timeout" ? "1" : "3600",
    ];
    if (cycleId) args.push("-CycleId", cycleId);
    if (noProductionWrite) args.push("-NoProductionWrite");
    if (noPush) args.push("-NoPush");
    if (preflightOnly) args.push("-PreflightOnly");
    if (noLiveCollection) args.push("-NoLiveCollection");
    args.push("-NotificationDryRun");
    const childPidPath = path.join(root, "owned-child.pid");
    const result = spawnSync("powershell.exe", args, {
      encoding: "utf8",
      timeout: timeout * 1000,
      env: { ...process.env, PUSHDEER_KEY: "fixture-key", FORWARDED_PATH: forwardedPath, CHILD_PID_PATH: childPidPath },
    });
    const logsRoot = path.join(stateRoot, "logs", "scheduler");
    const latest = JSON.parse(fs.readFileSync(path.join(logsRoot, "latest.json"), "utf8"));
    return {
      result,
      latest,
      forwarded: fs.existsSync(forwardedPath) ? JSON.parse(fs.readFileSync(forwardedPath, "utf8").replace(/^\uFEFF/, "")) : null,
      childPid: fs.existsSync(childPidPath) ? Number(fs.readFileSync(childPidPath, "utf8").trim()) : null,
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(stateRoot, { recursive: true, force: true });
    fs.rmSync(releaseRoot, { recursive: true, force: true });
  }
}

const success = runFixture({ mode: "success" });
assert.equal(success.result.status, 0, success.result.stderr || success.result.stdout);
assert.deepEqual(success.forwarded, {
  StateRoot: success.forwarded.StateRoot,
  ReleaseRoot: success.forwarded.ReleaseRoot,
  ProgressiveDetailMax: 3,
  MaxAutoApply: 17,
  DailyTimeoutSeconds: 3600,
  NoProductionWrite: true,
  NoPush: true,
  PreflightOnly: true,
  NoLiveCollection: true,
  CycleId: "2026-07-31",
});
assert.equal(success.latest.status, "completed", JSON.stringify({ result: success.result, latest: success.latest }, null, 2));
for (const stage of ["scheduled-entry", "runtime-check", "git-fetch", "git-fast-forward", "node-start", "collection", "release", "completed"]) {
  assert.ok(success.latest.stages.some((entry) => entry.stage === stage), `missing ${stage}`);
}

const today = utcCycleId();
const sameDayComplete = runFixture({
  mode: "success",
  cycleId: "",
  noProductionWrite: false,
  preflightOnly: false,
  noLiveCollection: false,
  cycleState: { cycleId: today, latestPhase: "done", cyclePhase: "done" },
});
assert.equal(sameDayComplete.result.status, 0, sameDayComplete.result.stderr || sameDayComplete.result.stdout);
assert.equal(sameDayComplete.latest.status, "completed");
assert.equal(sameDayComplete.latest.exitCode, 0);
assert.equal(sameDayComplete.forwarded, null, "same-day completion must not start the child process");
assert.equal(sameDayComplete.latest.notification, null, "same-day completion must not send a failure notification");
assert.ok(sameDayComplete.latest.stages.some((entry) => entry.stage === "same-day-complete"));
for (const stage of ["runtime-check", "git-fetch", "git-fast-forward", "node-start"]) {
  assert.ok(!sameDayComplete.latest.stages.some((entry) => entry.stage === stage), `same-day completion must skip ${stage}`);
}

const yesterdayDone = runFixture({
  mode: "success",
  cycleId: "",
  noProductionWrite: false,
  preflightOnly: false,
  noLiveCollection: false,
  cycleState: { cycleId: utcCycleId(-1), latestPhase: "done", cyclePhase: "done" },
});
assert.equal(yesterdayDone.result.status, 0, yesterdayDone.result.stderr || yesterdayDone.result.stdout);
assert.ok(yesterdayDone.forwarded, "yesterday's completed cycle must not short-circuit");
assert.ok(yesterdayDone.latest.stages.some((entry) => entry.stage === "node-start"));

for (const phase of ["retryable", "collecting", "details", "ready"]) {
  const nonTerminal = runFixture({
    mode: "success",
    cycleId: "",
    noProductionWrite: false,
    preflightOnly: false,
    noLiveCollection: false,
    cycleState: { cycleId: today, latestPhase: phase, cyclePhase: phase },
  });
  assert.equal(nonTerminal.result.status, 0, `${phase}: ${nonTerminal.result.stderr || nonTerminal.result.stdout}`);
  assert.ok(nonTerminal.forwarded, `${phase} must not short-circuit`);
  assert.ok(nonTerminal.latest.stages.some((entry) => entry.stage === "node-start"));
}

for (const [name, options] of Object.entries({
  PreflightOnly: { preflightOnly: true },
  NoProductionWrite: { noProductionWrite: true },
  NoLiveCollection: { noLiveCollection: true },
})) {
  const manualRun = runFixture({
    mode: "success",
    cycleId: "",
    noProductionWrite: false,
    preflightOnly: false,
    noLiveCollection: false,
    cycleState: { cycleId: today, latestPhase: "done", cyclePhase: "done" },
    ...options,
  });
  assert.equal(manualRun.result.status, 0, `${name}: ${manualRun.result.stderr || manualRun.result.stdout}`);
  assert.ok(manualRun.forwarded, `${name} must not short-circuit`);
  assert.ok(manualRun.latest.stages.some((entry) => entry.stage === "node-start"));
}

const failed = runFixture({ mode: "startup-failure" });
assert.equal(failed.result.status, 1);
assert.equal(failed.latest.status, "failed");
assert.equal(failed.latest.notification.attempted, true);
assert.equal(failed.latest.notification.configured, true);
assert.equal(failed.latest.notification.skipped, true);
assert.equal(failed.latest.notification.reason, "dry-run notification");

const missingResult = runFixture({ mode: "missing-result" });
assert.equal(missingResult.result.status, 1);
assert.equal(missingResult.latest.status, "failed");
assert.match(missingResult.latest.error, /fixture inner failure/);
assert.equal(missingResult.latest.notification.attempted, true);

const retryable = runFixture({ mode: "retryable-result" });
assert.equal(retryable.result.status, 1);
assert.equal(retryable.latest.status, "failed");
assert.equal(retryable.latest.nodeResult.status, "release-retryable");
assert.equal(retryable.latest.notification, null, "a Node-sent notification must not be duplicated by the scheduler");

const timedOut = runFixture({ mode: "timeout", timeout: 10 });
assert.equal(timedOut.result.status, 124, timedOut.result.stderr || timedOut.result.stdout);
assert.equal(timedOut.latest.status, "timeout");
assert.equal(timedOut.latest.exitCode, 124);
assert.ok(Array.isArray(timedOut.latest.ownedProcessTree) && timedOut.latest.ownedProcessTree.length >= 1);

assert.match(entrySource, /Start-Process/);
assert.match(entrySource, /Stop-OwnedProcessTree/);
assert.match(entrySource, /DailyTimeoutSeconds/);
assert.match(entrySource, /Send-SchedulerFailureNotification/);
assert.match(entrySource, /SMOKINGPIPES_V2_RESULT_JSON/);
console.log("Smokingpipes scheduled entrypoint tests passed.");
