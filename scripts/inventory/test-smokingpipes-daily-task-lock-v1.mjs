import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_DAILY_TIMEOUT_SECONDS,
  acquireDailyTaskLock,
  inspectDailyTaskLock,
  recoverStaleDailyTaskLock,
  releaseDailyTaskLock,
  resolveDailyTimeoutSeconds,
  updateDailyTaskLockHeartbeat,
} from "./smokingpipes-daily-task-lock-v1.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "smokingpipes-daily-lock-"));
const lockPath = path.join(root, "data", "inventory", "smokingpipes-daily-task-lock.json");
const archiveDir = path.join(root, "data", "audits", "smokingpipes-daily-lock-archive");
const startedAt = "2026-07-15T02:30:00.000Z";
const nowMs = Date.parse("2026-07-15T02:31:00.000Z");

function matchingProcess(overrides = {}) {
  return {
    exists: true,
    pid: 4242,
    parentPid: 4000,
    processStartedAt: startedAt,
    commandLine: `powershell.exe -File ${path.join(root, "scripts", "inventory", "run-smokingpipes-progressive-daily.ps1")}`,
    ...overrides,
  };
}

function writeLock(value) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function lockPayload(overrides = {}) {
  return {
    schemaVersion: 1,
    source: "smokingpipes",
    runId: "daily-test-run",
    pid: 4242,
    parentPid: 4000,
    processStartedAt: startedAt,
    host: os.hostname(),
    worktree: root,
    command: `powershell.exe -File ${path.join(root, "scripts", "inventory", "run-smokingpipes-progressive-daily.ps1")}`,
    createdAt: startedAt,
    heartbeatAt: "2026-07-15T02:30:45.000Z",
    ownerToken: "owner-a",
    ...overrides,
  };
}

try {
  const acquired = acquireDailyTaskLock({
    lockPath,
    root,
    pid: 4242,
    parentPid: 4000,
    processInfo: matchingProcess(),
    command: matchingProcess().commandLine,
    now: new Date(startedAt),
    ownerToken: "owner-a",
    runId: "daily-test-run",
  });
  assert.equal(acquired.acquired, true, "a missing lock must be acquired atomically");
  assert.equal(acquired.lock.schemaVersion, 1);
  assert.equal(acquired.lock.ownerToken, "owner-a");

  const active = inspectDailyTaskLock({
    lockPath,
    root,
    nowMs,
    getProcessInfo: () => matchingProcess(),
  });
  assert.equal(active.status, "active", "a matching live owner must block a second instance");

  const second = acquireDailyTaskLock({
    lockPath,
    root,
    pid: 4242,
    processInfo: matchingProcess(),
    command: matchingProcess().commandLine,
    now: new Date(startedAt),
  });
  assert.equal(second.acquired, false, "second instance must not overwrite an active lock");

  assert.equal(releaseDailyTaskLock({ lockPath, ownerToken: "not-owner", pid: 4242 }).released, false);
  assert.equal(fs.existsSync(lockPath), true, "non-owner must not remove lock");
  assert.equal(updateDailyTaskLockHeartbeat({ lockPath, ownerToken: "owner-a", pid: 4242, now: new Date("2026-07-15T02:31:00.000Z") }).updated, true);
  assert.equal(releaseDailyTaskLock({ lockPath, ownerToken: "owner-a", pid: 4242 }).released, true);
  assert.equal(fs.existsSync(lockPath), false, "normal completion must release its own lock");

  writeLock(lockPayload());
  assert.equal(inspectDailyTaskLock({ lockPath, root, nowMs, getProcessInfo: () => null }).reason, "process-not-found");

  writeLock(lockPayload());
  assert.equal(inspectDailyTaskLock({ lockPath, root, nowMs, getProcessInfo: () => matchingProcess({ processStartedAt: "2026-07-15T01:00:00.000Z" }) }).reason, "process-start-time-mismatch");

  writeLock(lockPayload());
  assert.equal(inspectDailyTaskLock({ lockPath, root, nowMs, getProcessInfo: () => matchingProcess({ commandLine: "node unrelated.mjs" }) }).reason, "command-mismatch");

  writeLock(lockPayload({ heartbeatAt: "2026-07-15T02:20:00.000Z" }));
  assert.equal(inspectDailyTaskLock({ lockPath, root, nowMs, heartbeatStaleMs: 30_000, getProcessInfo: () => matchingProcess() }).reason, "heartbeat-expired");

  writeLock(lockPayload({ worktree: "C:\\other-worktree" }));
  assert.equal(inspectDailyTaskLock({ lockPath, root, nowMs, getProcessInfo: () => matchingProcess() }).reason, "worktree-mismatch");

  fs.writeFileSync(lockPath, "{broken", "utf8");
  const corruptRecovery = recoverStaleDailyTaskLock({ lockPath, root, archiveDir, nowMs, getProcessInfo: () => null });
  assert.equal(corruptRecovery.recovered, true, "corrupt locks must be archived and recovered safely");
  assert.equal(fs.existsSync(lockPath), false);
  assert.equal(fs.existsSync(corruptRecovery.archivePath), true);

  writeLock(lockPayload({ ownerToken: "owner-b" }));
  assert.equal(releaseDailyTaskLock({ lockPath, ownerToken: "owner-a", pid: 4242 }).released, false, "old owner must not remove replacement lock");
  assert.equal(fs.existsSync(lockPath), true);

  assert.equal(DEFAULT_DAILY_TIMEOUT_SECONDS, 3600);
  assert.equal(resolveDailyTimeoutSeconds({}), 3600);
  assert.equal(resolveDailyTimeoutSeconds({ environment: { SMOKINGPIPES_DAILY_TIMEOUT_SECONDS: "4200" } }), 4200);
  assert.equal(resolveDailyTimeoutSeconds({ requestedSeconds: 1800 }), 1800);
  assert.throws(() => resolveDailyTimeoutSeconds({ environment: { SMOKINGPIPES_DAILY_TIMEOUT_SECONDS: "600" } }), /from 900 to 14400/);

  console.log("Smokingpipes daily task lock tests passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
