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

function runFixture({ mode, timeout = 20 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "smokingpipes-scheduled-entry-v1-"));
  const inventory = path.join(root, "scripts", "inventory");
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smokingpipes-scheduled-state-v1-"));
  const releaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smokingpipes-scheduled-release-v1-"));
  const forwardedPath = path.join(root, "forwarded.json");
  try {
    fs.mkdirSync(inventory, { recursive: true });
    fs.mkdirSync(releaseRoot, { recursive: true });
    fs.writeFileSync(path.join(inventory, "run-smokingpipes-scheduled-task-v1.ps1"), entrySource);
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
      "-CycleId", "2026-07-31",
      "-NoProductionWrite", "-NoPush", "-PreflightOnly", "-NoLiveCollection", "-NotificationDryRun",
    ];
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

const failed = runFixture({ mode: "startup-failure" });
assert.equal(failed.result.status, 1);
assert.equal(failed.latest.status, "failed");
assert.equal(failed.latest.notification.attempted, true);
assert.equal(failed.latest.notification.configured, true);
assert.equal(failed.latest.notification.skipped, true);
assert.equal(failed.latest.notification.reason, "dry-run notification");

const timedOut = runFixture({ mode: "timeout", timeout: 10 });
assert.equal(timedOut.result.status, 124, timedOut.result.stderr || timedOut.result.stdout);
assert.equal(timedOut.latest.status, "timeout");
assert.equal(timedOut.latest.exitCode, 124);
assert.ok(Array.isArray(timedOut.latest.ownedProcessTree) && timedOut.latest.ownedProcessTree.length >= 1);

assert.match(entrySource, /Start-Process/);
assert.match(entrySource, /Stop-OwnedProcessTree/);
assert.match(entrySource, /DailyTimeoutSeconds/);
assert.match(entrySource, /Send-SchedulerFailureNotification/);
console.log("Smokingpipes scheduled entrypoint tests passed.");
