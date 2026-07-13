import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const npmPath = "C:\\Program Files\\nodejs\\npm.cmd";
const powershellPath = `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
const codeCommits = ["e819476", "40afff3", "0800f3a", "64efc8b", "3f5b779", "c56c308", "471893e", "2ae8f95", "4777921"];
const results = [];

function run(file, args, options = {}) {
  const result = spawnSync(file, args, {
    cwd: options.cwd || root,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: options.timeout || 30 * 60 * 1000,
    stdio: options.inherit ? "inherit" : "pipe",
  });
  if (!options.allowFailure) assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function git(cwd, args, options = {}) {
  return run("git", args, { ...options, cwd });
}

function writeFixtureDaily(target) {
  const injection = String.raw`if (-not [string]::IsNullOrWhiteSpace([string]$env:SMOKINGPIPES_E2E_MODE)) {
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$mode = [string]$env:SMOKINGPIPES_E2E_MODE
$count = if ($env:SMOKINGPIPES_E2E_COUNT) { [int]$env:SMOKINGPIPES_E2E_COUNT } else { 4 }
$status = "completed"
$reason = $null
$productionWritten = $false
$warning = $count -gt 300
$blocked = $count -gt [int]$MaxAutoApply
if ($mode -eq "apply") {
  & git -C $root apply --binary $env:SMOKINGPIPES_E2E_PATCH
  if ($LASTEXITCODE -ne 0) { throw "fixture production patch failed" }
  $productionWritten = $true
} elseif ($mode -eq "large-block") {
  $status = "safety-gate-blocked"; $reason = "wouldApplyCount $count exceeds max auto apply $MaxAutoApply"
} elseif ($mode -eq "pending") {
  $status = "safety-gate-blocked"; $reason = "pending candidates=1"
} elseif ($mode -eq "failed") {
  $status = "safety-gate-blocked"; $reason = "failed candidates=1"
} elseif ($mode -eq "incomplete-list") {
  $status = "safety-gate-blocked"; $reason = "list fullExpectedRangeScanned must be true"
} elseif ($mode -ne "noop") {
  throw "unknown fixture mode: $mode"
}
$state = [ordered]@{
  status=$status; lastFailureReason=$reason; productionWritten=$productionWritten
  candidateCount=$count; wouldApplyCount=$count; appliedCount=$(if ($productionWritten) { $count } else { 0 })
  progressiveDetailMax=[int]$ProgressiveDetailMax; maxAutoApply=[int]$MaxAutoApply
  largeApplyWarningThreshold=300; largeApplyWarning=$warning; largeApplyBlocked=$blocked
}
$inventory = Join-Path $root "data\inventory"
New-Item -ItemType Directory -Force -Path $inventory | Out-Null
[IO.File]::WriteAllText((Join-Path $inventory "smokingpipes-daily-task-state.json"), (($state | ConvertTo-Json -Depth 5) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
$candidates = @()
if ($mode -eq "pending") { $candidates = @([ordered]@{ sourceProductId="fixture-pending"; detailStatus="pending" }) }
if ($mode -eq "failed") { $candidates = @([ordered]@{ sourceProductId="fixture-failed"; detailStatus="failed" }) }
$progressive = [ordered]@{ fullExpectedRangeScanned=($mode -ne "incomplete-list"); candidates=$candidates }
[IO.File]::WriteAllText((Join-Path $inventory "smokingpipes-progressive-daily-state.json"), (($progressive | ConvertTo-Json -Depth 5) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
exit 0
}
`;
  const original = fs.readFileSync(path.join(root, "scripts", "inventory", "run-smokingpipes-progressive-daily.ps1"), "utf8");
  const parameterEnd = original.match(/\r?\n\)\r?\n/);
  assert.ok(parameterEnd, "progressive daily parameter block must be present");
  const insertionPoint = parameterEnd.index + parameterEnd[0].length;
  fs.writeFileSync(target, original.slice(0, insertionPoint) + injection + original.slice(insertionPoint), "utf8");
}

function readReport(fixture) {
  const jsonPath = path.join(fixture, "data", "review", "smokingpipes-auto-publish-latest.json");
  const mdPath = path.join(fixture, "data", "review", "smokingpipes-auto-publish-latest.md");
  return {
    value: JSON.parse(fs.readFileSync(jsonPath, "utf8")),
    jsonBytes: fs.statSync(jsonPath).size,
    markdownBytes: fs.statSync(mdPath).size,
  };
}

function residualProcesses(token) {
  const escaped = token.replaceAll("'", "''");
  const script = `(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine -like '*${escaped}*' -and $_.ProcessId -ne $PID }).Count`;
  const result = run(powershellPath, ["-NoProfile", "-NonInteractive", "-Command", script]);
  return Number(result.stdout.trim() || 0);
}

function makeScenario(name, installDependencies = true) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `sp-e2e-${name}-`));
  const fixture = path.join(tempRoot, "worktree");
  const bare = path.join(tempRoot, "origin.git");
  const patchPath = path.join(tempRoot, "production.patch");
  run("git", ["init", "--bare", bare]);
  run("git", ["clone", "--no-local", root, fixture]);
  git(fixture, ["config", "user.email", "e2e@example.invalid"]);
  git(fixture, ["config", "user.name", "Smokingpipes Windows E2E"]);
  git(fixture, ["switch", "-c", `automation/${name}`, "dc8e03d"]);
  for (const commit of codeCommits) git(fixture, ["cherry-pick", commit]);
  writeFixtureDaily(path.join(fixture, "scripts", "inventory", "run-smokingpipes-progressive-daily.ps1"));
  const failBuild = path.join(fixture, "scripts", "inventory", "e2e-npm-build-fail.cmd");
  fs.writeFileSync(failBuild, `@echo off\r\ncall "${npmPath}" %*\r\nif errorlevel 1 exit /b %errorlevel%\r\necho E2E-INJECTED-BUILD-FAIL 1>&2\r\nexit /b 23\r\n`, "utf8");
  git(fixture, ["add", "--", "scripts/inventory/run-smokingpipes-progressive-daily.ps1", "scripts/inventory/e2e-npm-build-fail.cmd"]);
  git(fixture, ["commit", "-m", "test: install isolated daily fixture"]);
  git(fixture, ["remote", "set-url", "origin", bare]);
  git(fixture, ["push", "origin", "HEAD:main"]);
  git(fixture, ["branch", "--set-upstream-to=origin/main"]);
  const patchFd = fs.openSync(patchPath, "w");
  const diff = spawnSync("git", ["-C", root, "diff", "--binary", "dc8e03d..aa6b346c21d0e897c89e590b57713036f5c98c12", "--", "data/products", "data/generated/public-products"], { stdio: ["ignore", patchFd, "pipe"] });
  fs.closeSync(patchFd);
  assert.equal(diff.status, 0, diff.stderr?.toString());
  if (installDependencies) {
    run(powershellPath, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
      `& '${npmPath}' --cache '${path.join(os.tmpdir(), "yandoubuy-npm-cache")}' ci; exit $LASTEXITCODE`],
    { cwd: fixture });
  }
  return { tempRoot, fixture, bare, patchPath, failBuild };
}

function invokeWrapper(scenario, { mode, count, build = npmPath, resume = false, allowFailure = false } = {}) {
  const wrapper = path.join(scenario.fixture, "scripts", "inventory", "run-smokingpipes-auto-publish.ps1");
  const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", wrapper,
    "-AutomationWorktree", scenario.fixture, "-BuildExecutable", build];
  if (resume) args.push("-ResumeAfterProductionWrite", "-ExpectedAppliedCount", String(count));
  else args.push("-ForceRunOnce");
  return run(powershellPath, args, {
    cwd: scenario.fixture,
    allowFailure,
    env: { SMOKINGPIPES_E2E_MODE: mode, SMOKINGPIPES_E2E_COUNT: String(count), SMOKINGPIPES_E2E_PATCH: scenario.patchPath, YANDOUBUY_DEPLOY_HOOK_URL: "" },
  });
}

function record(name, started, scenario, extra = {}) {
  let report = { value: {}, jsonBytes: 0, markdownBytes: 0 };
  try { report = readReport(scenario.fixture); } catch {}
  const staged = git(scenario.fixture, ["diff", "--cached", "--name-only"]).stdout.trim().split(/\r?\n/).filter(Boolean);
  const head = git(scenario.fixture, ["rev-parse", "HEAD"]).stdout.trim();
  const remote = git(scenario.fixture, ["rev-parse", "origin/main"]).stdout.trim();
  const value = {
    scenario: name,
    status: "PASS",
    durationSeconds: Number(((Date.now() - started) / 1000).toFixed(2)),
    stagedFileCount: staged.length,
    commitSha: head,
    remoteSha: remote,
    jsonBytes: report.jsonBytes,
    markdownBytes: report.markdownBytes,
    residualProcesses: residualProcesses(path.basename(scenario.tempRoot)),
    ...extra,
  };
  assert.ok(value.jsonBytes < 2 * 1024 * 1024);
  assert.ok(value.markdownBytes < 2 * 1024 * 1024);
  assert.equal(value.residualProcesses, 0);
  results.push(value);
  console.log(JSON.stringify(value));
  return report.value;
}

function cleanup(scenario) {
  if (process.env.SMOKINGPIPES_E2E_KEEP === "1") {
    console.error(`E2E fixture preserved: ${scenario.tempRoot}`);
    return;
  }
  fs.rmSync(scenario.tempRoot, { recursive: true, force: true });
}

// A, B, K, L, N: normal update, no-op, pending deployment, idempotency, absolute npm.cmd.
{
  const scenario = makeScenario("normal"); const started = Date.now();
  try {
    const before = git(scenario.fixture, ["rev-parse", "HEAD"]).stdout.trim();
    invokeWrapper(scenario, { mode: "apply", count: 4 });
    const firstHead = git(scenario.fixture, ["rev-parse", "HEAD"]).stdout.trim();
    assert.notEqual(firstHead, before);
    let report = readReport(scenario.fixture).value;
    assert.equal(report.status, "success");
    assert.equal(report.deploymentStatus, "push-complete-deployment-pending-verification");
    assert.equal(report.buildExecutableResolved, npmPath);
    invokeWrapper(scenario, { mode: "noop", count: 0 });
    assert.equal(git(scenario.fixture, ["rev-parse", "HEAD"]).stdout.trim(), firstHead);
    report = record("A-B-K-L-N", started, scenario, { firstCommitSha: firstHead });
    assert.equal(report.status, "no-production-change");
  } finally { cleanup(scenario); }
}

// C: 895 is warned but not blocked and completes a real local publication.
{
  const scenario = makeScenario("large-warning"); const started = Date.now();
  try {
    invokeWrapper(scenario, { mode: "apply", count: 895 });
    const report = record("C", started, scenario);
    assert.equal(report.largeApplyWarning, true); assert.equal(report.largeApplyBlocked, false);
    assert.equal(report.status, "success");
  } finally { cleanup(scenario); }
}

// D, E, F: apply is blocked before production is changed.
for (const [name, mode, count, expected] of [
  ["D", "large-block", 1001, /exceeds max auto apply/],
  ["E-pending", "pending", 1, /pending candidates/],
  ["E-failed", "failed", 1, /failed candidates/],
  ["F", "incomplete-list", 1, /fullExpectedRangeScanned/],
]) {
  const scenario = makeScenario(name.toLowerCase(), false); const started = Date.now();
  try {
    const before = git(scenario.fixture, ["rev-parse", "HEAD"]).stdout.trim();
    const outcome = invokeWrapper(scenario, { mode, count, allowFailure: true });
    assert.notEqual(outcome.status, 0); assert.match(`${outcome.stdout}${outcome.stderr}`, expected);
    assert.equal(git(scenario.fixture, ["rev-parse", "HEAD"]).stdout.trim(), before);
    assert.equal(git(scenario.fixture, ["diff", "--name-only"]).stdout.trim(), "");
    record(name, started, scenario);
  } finally { cleanup(scenario); }
}

// G, M: a real npm build completes but the injected executable returns 23;
// the wrapper delegates recovery to the dedicated script, which publishes once.
{
  const scenario = makeScenario("build-recovery"); const started = Date.now();
  try {
    const before = git(scenario.fixture, ["rev-parse", "HEAD"]).stdout.trim();
    const failed = invokeWrapper(scenario, { mode: "apply", count: 895, build: scenario.failBuild, allowFailure: true });
    assert.notEqual(failed.status, 0); assert.match(`${failed.stdout}${failed.stderr}`, /E2E-INJECTED-BUILD-FAIL|build failed/);
    assert.equal(git(scenario.fixture, ["diff", "--cached", "--name-only"]).stdout.trim(), "");
    assert.equal(git(scenario.fixture, ["rev-parse", "HEAD"]).stdout.trim(), before);
    invokeWrapper(scenario, { mode: "noop", count: 895, resume: true });
    const report = record("G-M", started, scenario);
    assert.equal(report.status, "success"); assert.equal(report.commitPerformed, true); assert.equal(report.pushPerformed, true);
  } finally { cleanup(scenario); }
}

// H: remote rejection happens after one commit and rerun does not create another.
{
  const scenario = makeScenario("push-failure"); const started = Date.now();
  try {
    const hook = path.join(scenario.bare, "hooks", "pre-receive");
    fs.writeFileSync(hook, "#!/bin/sh\necho E2E-PUSH-REJECTED >&2\nexit 1\n", "utf8");
    const before = git(scenario.fixture, ["rev-parse", "HEAD"]).stdout.trim();
    const failed = invokeWrapper(scenario, { mode: "apply", count: 895, allowFailure: true });
    assert.notEqual(failed.status, 0);
    const committed = git(scenario.fixture, ["rev-parse", "HEAD"]).stdout.trim();
    assert.notEqual(committed, before);
    assert.equal(git(scenario.fixture, ["rev-parse", "origin/main"]).stdout.trim(), before);
    const report = readReport(scenario.fixture).value;
    assert.equal(report.commitPerformed, true); assert.equal(report.pushPerformed, false); assert.equal(report.failureStage, "push");
    const again = invokeWrapper(scenario, { mode: "noop", count: 0, allowFailure: true });
    assert.notEqual(again.status, 0);
    assert.equal(git(scenario.fixture, ["rev-parse", "HEAD"]).stdout.trim(), committed);
    record("H", started, scenario, { commitSha: committed, localRemoteSha: before });
  } finally { cleanup(scenario); }
}

console.log(JSON.stringify({ status: "PASS", scenarios: results.length, results }));
