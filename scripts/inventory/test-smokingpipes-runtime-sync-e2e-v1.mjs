import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const powershell = `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
const npm = "C:\\Program Files\\nodejs\\npm.cmd";
const fixtureTempRoot = process.env.SMOKINGPIPES_SYNC_E2E_TMPDIR || os.tmpdir();
const scenarios = [];

function run(file, args, options = {}) {
  const result = spawnSync(file, args, {
    cwd: options.cwd || root,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    maxBuffer: 8 * 1024 * 1024,
    timeout: options.timeout || 180000,
  });
  if (!options.allowFailure) assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function git(cwd, args, options = {}) { return run("git", args, { ...options, cwd }); }
function write(target, text) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text, "utf8"); }

function makeFixture(name) {
  fs.mkdirSync(fixtureTempRoot, { recursive: true });
  const temp = fs.mkdtempSync(path.join(fixtureTempRoot, `smokingpipes-runtime-sync-${name}-`));
  const fixture = path.join(temp, "worktree");
  const bare = path.join(temp, "origin.git");
  run("git", ["init", "--bare", bare]);
  run("git", ["clone", "--no-local", "--branch", "main", root, fixture]);
  git(fixture, ["config", "user.email", "sync-e2e@example.invalid"]);
  git(fixture, ["config", "user.name", "Smokingpipes Sync E2E"]);
  git(fixture, ["switch", "-c", "automation/smokingpipes-production-run", "origin/main"]);
  for (const file of [
    ".gitignore",
    "scripts/inventory/run-smokingpipes-auto-publish.ps1",
    "scripts/inventory/smokingpipes-daily-invocation-guard-v1.psm1",
    "scripts/inventory/smokingpipes-command-execution-v1.psm1",
    "scripts/inventory/smokingpipes-command-runner-v1.mjs",
  ]) fs.copyFileSync(path.join(root, file), path.join(fixture, file));
  write(path.join(fixture, "scripts", "inventory", "run-smokingpipes-progressive-daily.ps1"), String.raw`param(
  [switch]$NoProductionWrite,
  [switch]$ForceRunOnce,
  [switch]$ForceSameDayRerun,
  [switch]$SkipCurrentList,
  [switch]$AllowStaleCurrentListCache,
  [int]$ProgressiveDetailMax,
  [int]$MaxAutoApply,
  [string]$RunId,
  [string]$InvocationStartedAt
)
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$state = [ordered]@{ status="completed"; productionWritten=$false; candidateCount=0; wouldApplyCount=0; appliedCount=0; progressiveDetailMax=30; maxAutoApply=1000 }
New-Item -ItemType Directory -Force -Path (Join-Path $root "data\inventory") | Out-Null
[IO.File]::WriteAllText((Join-Path $root "data\inventory\smokingpipes-daily-task-state.json"), (($state | ConvertTo-Json -Compress) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
`);
  for (const file of [
    "scripts/validate-public-product-indexes-v1.mjs",
    "scripts/test-public-products-inventory-default-v1.mjs",
    "scripts/inventory/test-inventory-runner-v1.mjs",
  ]) write(path.join(fixture, file), "process.exit(0);\n");
  const build = path.join(fixture, "build.cmd");
  write(build, "@echo off\r\nexit /b 0\r\n");
  write(path.join(fixture, "scripts", "inventory", "sync-e2e-notify.mjs"), "console.log(JSON.stringify({ notificationSent: false, notificationSkipped: true, notificationReason: 'fixture' }));\n");
  git(fixture, ["add", "--", ".gitignore", "scripts/inventory/run-smokingpipes-auto-publish.ps1", "scripts/inventory/smokingpipes-daily-invocation-guard-v1.psm1", "scripts/inventory/smokingpipes-command-execution-v1.psm1", "scripts/inventory/smokingpipes-command-runner-v1.mjs", "scripts/inventory/run-smokingpipes-progressive-daily.ps1", "scripts/inventory/sync-e2e-notify.mjs", "scripts/validate-public-product-indexes-v1.mjs", "scripts/test-public-products-inventory-default-v1.mjs", "scripts/inventory/test-inventory-runner-v1.mjs", "build.cmd"]);
  git(fixture, ["commit", "-m", "test: configure runtime sync fixture"]);
  git(fixture, ["remote", "set-url", "origin", bare]);
  git(fixture, ["push", "origin", "HEAD:main"]);
  git(fixture, ["branch", "--set-upstream-to=origin/main"]);
  return { temp, fixture, bare, build, notify: path.join(fixture, "scripts", "inventory", "sync-e2e-notify.mjs") };
}

function advanceRemote(scenario, count = 1) {
  const writer = path.join(scenario.temp, `writer-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  run("git", ["clone", scenario.bare, writer]);
  git(writer, ["config", "user.email", "writer@example.invalid"]);
  git(writer, ["config", "user.name", "Sync Writer"]);
  for (let index = 0; index < count; index += 1) {
    write(path.join(writer, `sync-advance-${index}.txt`), `${Date.now()}-${index}\n`);
    git(writer, ["add", "--", `sync-advance-${index}.txt`]);
    git(writer, ["commit", "-m", `test: remote advance ${index}`]);
  }
  git(writer, ["push", "origin", "HEAD:main"]);
}

function localCommit(scenario, name) {
  write(path.join(scenario.fixture, `${name}.txt`), `${name}\n`);
  git(scenario.fixture, ["add", "--", `${name}.txt`]);
  git(scenario.fixture, ["commit", "-m", `test: ${name}`]);
}

function invoke(scenario, { preflight = true } = {}) {
  const wrapper = path.join(scenario.fixture, "scripts", "inventory", "run-smokingpipes-auto-publish.ps1");
  const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", wrapper,
    "-AutomationWorktree", scenario.fixture, "-BuildExecutable", scenario.build, "-NotificationScriptPath", scenario.notify];
  if (preflight) args.push("-PreflightOnly"); else args.push("-ForceRunOnce");
  return run(powershell, args, { cwd: scenario.fixture, allowFailure: true });
}

function report(scenario) {
  return JSON.parse(fs.readFileSync(path.join(scenario.fixture, "data", "review", "smokingpipes-auto-publish-latest.json"), "utf8"));
}

function cleanup(scenario) {
  if (process.env.KEEP_SYNC_E2E_FIXTURE === "1") {
    process.stderr.write(`Keeping fixture for diagnosis: ${scenario.temp}\n`);
    return;
  }
  fs.rmSync(scenario.temp, { recursive: true, force: true });
}
function summary(name, scenario, started, extra = {}) {
  const value = report(scenario);
  scenarios.push({ scenario: name, status: "PASS", durationSeconds: Number(((Date.now() - started) / 1000).toFixed(2)), head: git(scenario.fixture, ["rev-parse", "HEAD"]).stdout.trim(), ...extra });
  assert.equal(value.schedulerUser.length > 0, true);
  assert.equal(value.workingDirectory.endsWith("\\worktree"), true);
}

// A, B, C, J, K, L: equal, one/multiple commit fast-forward, then no-change daily without a new commit.
{
  const scenario = makeFixture("fast-forward"); const started = Date.now();
  try {
    write(path.join(scenario.fixture, "data", "audits", "smokingpipes-daily-fix", "lock-archives", "fixture-proof.json"), "fixture audit\n");
    const initial = invoke(scenario);
    assert.equal(initial.status, 0, initial.stderr || initial.stdout); // A
    let value = report(scenario);
    assert.equal(value.syncAttempted, true); assert.equal(value.syncPerformed, false);
    assert.equal(value.worktreeStatusTotalCount, 1); assert.equal(value.worktreeIgnoredRuntimeAuditCount, 1); assert.equal(value.worktreeBlockedCount, 0);
    assert.deepEqual(value.worktreeIgnoredRuntimeAuditPaths, ["data/audits/smokingpipes-daily-fix/lock-archives/fixture-proof.json"]);
    const equalHead = git(scenario.fixture, ["rev-parse", "HEAD"]).stdout.trim();

    advanceRemote(scenario, 1); // B
    const oneBehind = invoke(scenario);
    assert.equal(oneBehind.status, 0, oneBehind.stderr || oneBehind.stdout);
    value = report(scenario);
    assert.equal(value.syncPerformed, true); assert.notEqual(value.headBeforeSync, value.headAfterSync);

    advanceRemote(scenario, 2); // C
    const multipleBehind = invoke(scenario);
    assert.equal(multipleBehind.status, 0, multipleBehind.stderr || multipleBehind.stdout);
    value = report(scenario);
    assert.equal(value.headAfterSync, value.originMainSha);
    const beforeNoChange = git(scenario.fixture, ["rev-parse", "HEAD"]).stdout.trim();
    assert.equal(invoke(scenario, { preflight: false }).status, 0); // J/K
    value = report(scenario);
    assert.equal(value.status, "no-production-change");
    assert.equal(value.commitPerformed, false); assert.equal(value.pushPerformed, false);
    assert.equal(value.appliedCount, 0); assert.equal(value.productionWritten, false);
    assert.equal(git(scenario.fixture, ["rev-parse", "HEAD"]).stdout.trim(), beforeNoChange);
    const completedTaskState = JSON.parse(fs.readFileSync(path.join(scenario.fixture, "data", "inventory", "smokingpipes-daily-task-state.json"), "utf8"));
    assert.equal(completedTaskState.lastSuccessfulStatus, "no-production-change");
    assert.equal(completedTaskState.lastSuccessfulRunId, value.runId);
    const reportBeforeSameDayNoop = fs.readFileSync(path.join(scenario.fixture, "data", "review", "smokingpipes-auto-publish-latest.json"), "utf8");
    const sameDayNoop = invoke(scenario, { preflight: false });
    assert.equal(sameDayNoop.status, 0, sameDayNoop.stderr || sameDayNoop.stdout);
    assert.match(sameDayNoop.stdout, /same-day-success-already-completed/);
    assert.equal(fs.readFileSync(path.join(scenario.fixture, "data", "review", "smokingpipes-auto-publish-latest.json"), "utf8"), reportBeforeSameDayNoop);
    assert.equal(git(scenario.fixture, ["rev-parse", "HEAD"]).stdout.trim(), beforeNoChange);
    summary("A-B-C-J-K-L", scenario, started, { initialHead: equalHead });
  } finally { cleanup(scenario); }
}

// D: a tracked dirty file blocks before any merge.
{
  const scenario = makeFixture("dirty"); const started = Date.now();
  try {
    advanceRemote(scenario, 1); write(path.join(scenario.fixture, "README.md"), "dirty\n");
    const outcome = invoke(scenario); assert.notEqual(outcome.status, 0);
    const value = report(scenario); assert.equal(value.failureStage, "sync"); assert.match(value.failureReason, /blocked changes before sync/); assert.deepEqual(value.worktreeBlockedTrackedPaths, ["README.md"]);
    summary("D", scenario, started);
  } finally { cleanup(scenario); }
}

// E/F: divergent and local-ahead histories remain blocked without reset/rebase.
for (const [name, remoteAdvance, expected] of [["E", true, /diverged/], ["F", false, /ahead/]]) {
  const scenario = makeFixture(name.toLowerCase()); const started = Date.now();
  try {
    localCommit(scenario, `local-${name}`); if (remoteAdvance) advanceRemote(scenario, 1);
    const outcome = invoke(scenario); assert.notEqual(outcome.status, 0);
    const value = report(scenario); assert.match(value.failureReason, expected); assert.equal(value.syncPerformed, false);
    summary(name, scenario, started);
  } finally { cleanup(scenario); }
}

// G/I: an actual git fetch exit 128 records the command and remote stderr tail.
{
  const scenario = makeFixture("fetch-failure"); const started = Date.now();
  try {
    git(scenario.fixture, ["remote", "set-url", "origin", path.join(scenario.temp, "missing-origin.git")]);
    const outcome = invoke(scenario); assert.notEqual(outcome.status, 0);
    const value = report(scenario);
    assert.equal(value.gitExitCode, 128); assert.match(value.gitCommand, /fetch origin/); assert.match(value.gitStderrTail, /does not appear|not a git repository/i);
    assert.match(value.failureReason, /git command failed/);
    summary("G-I", scenario, started);
  } finally { cleanup(scenario); }
}

// H: a real index lock makes ff-only merge fail and preserves its stderr diagnostics.
{
  const scenario = makeFixture("merge-failure"); const started = Date.now();
  try {
    advanceRemote(scenario, 1); write(path.join(scenario.fixture, ".git", "index.lock"), "sync-e2e\n");
    const outcome = invoke(scenario); assert.notEqual(outcome.status, 0);
    const value = report(scenario); assert.match(value.gitCommand, /merge --ff-only origin\/main/); assert.match(value.gitStderrTail, /index\.lock|Unable to create/i);
    summary("H", scenario, started);
  } finally { cleanup(scenario); }
}

console.log(JSON.stringify({ status: "PASS", scenarios }));
