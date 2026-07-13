import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  AUTO_PUBLISH_PRODUCTION_PATHS,
  DEFAULT_MAX_AUTO_APPLY,
  LARGE_APPLY_WARNING_THRESHOLD,
  evaluateAutoPublishGate,
  evaluatePostApplyRecoveryGate,
  isAllowedProductionPath,
  validateAutoPublishStagedPaths,
} from "./smokingpipes-auto-publish-policy-v1.mjs";
import { summarizeSmokingpipesProductionDelta } from "./smokingpipes-post-apply-recovery-audit-v1.mjs";

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function gitResult(cwd, args) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function runBuildResolver(functionSource, env) {
  const harness = [
    "$ErrorActionPreference = 'Stop'",
    "function Get-Command { param($Name, $CommandType, $ErrorAction); if ($env:RESOLVE_MODE -eq 'path') { [pscustomobject]@{ Source = $env:RESOLVE_CANDIDATE; Path = $env:RESOLVE_CANDIDATE } } else { throw 'not found' } }",
    functionSource,
    "$value = Resolve-BuildExecutable -Requested $env:RESOLVE_REQUESTED -ProgramFilesPath $env:RESOLVE_PROGRAM_FILES",
    "$value | ConvertTo-Json -Compress",
  ].join("\n");
  return spawnSync("powershell.exe", ["-NoProfile", "-Command", harness], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function runPowerShell(script, env = {}) {
  return spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yandoubuy-auto-publish-"));
try {
  const projectRoot = process.cwd();
  const setupScript = fs.readFileSync(
    path.join(projectRoot, "scripts", "inventory", "setup-smokingpipes-automation-worktree.ps1"),
    "utf8"
  );
  const publishScript = fs.readFileSync(
    path.join(projectRoot, "scripts", "inventory", "run-smokingpipes-auto-publish.ps1"),
    "utf8"
  );
  assert.match(setupScript, /"fetch", "origin"/);
  assert.match(setupScript, /required automation code is not yet on origin\/main/);
  assert.doesNotMatch(setupScript, /Copy-Item|Remove-Item/);
  assert.match(publishScript, /\[switch\]\$PreflightOnly/);
  assert.match(publishScript, /\[switch\]\$NoProductionWrite/);
  assert.match(publishScript, /\[switch\]\$NoPush/);
  assert.match(publishScript, /\[switch\]\$ResumeAfterProductionWrite/);
  assert.match(publishScript, /\[string\]\$NodeExecutable\s*=\s*"node"/);
  assert.match(publishScript, /\[string\]\$NotificationScriptPath\s*=\s*""/);
  assert.match(publishScript, /\[string\]\$MaxAutoApply\s*=\s*"1000"/);
  assert.match(publishScript, /largeApplyWarningThreshold/);
  assert.match(publishScript, /-MaxAutoApply/);
  assert.match(publishScript, /auto publish must run from the dedicated automation worktree/);
  assert.match(publishScript, /\$ProjectRoot\s*=\s*\(Resolve-Path \(Join-Path \$PSScriptRoot "\.\.\\\.\."\)\)\.Path/);
  assert.match(publishScript, /Push-Location -LiteralPath \$ProjectRoot/);
  assert.match(publishScript, /finally\s*\{[\s\S]*?Pop-Location/);
  assert.match(publishScript, /\$NotificationScriptPath\s*=\s*Join-Path \$ProjectRoot/);
  assert.match(publishScript, /notification helper is missing/);
  assert.match(publishScript, /Invoke-CheckedCommand -FilePath \$NodeExecutablePath/);
  assert.match(publishScript, /Complete-AutoPublish/);
  assert.match(publishScript, /smokingpipes-command-execution-v1\.psm1/);
  assert.match(publishScript, /Invoke-SmokingpipesCommand -Stage "git"/);
  assert.doesNotMatch(publishScript, /& node "scripts\/inventory\/smokingpipes-auto-publish-notify-v1\.mjs"/);
  assert.match(publishScript, /scripts[\\/]validate-public-product-indexes-v1\.mjs/);
  assert.match(publishScript, /scripts[\\/]test-public-products-inventory-default-v1\.mjs/);
  assert.match(publishScript, /scripts[\\/]inventory[\\/]test-inventory-runner-v1\.mjs/);
  assert.match(publishScript, /npm\.cmd/);
  assert.match(publishScript, /function Resolve-BuildExecutable/);
  assert.match(publishScript, /buildExecutableResolved/);
  assert.match(publishScript, /build executable request is not initialized/);
  assert.match(publishScript, /\$EffectiveBuildExecutable = if \(\[string\]::IsNullOrWhiteSpace\(\$BuildExecutable\)\) \{ "npm\.cmd" \}/);
  assert.match(publishScript, /post-apply-production-audit/);
  assert.match(publishScript, /ResumeAfterProductionWrite/);
  assert.match(publishScript, /resume-smokingpipes-post-apply-v1\.ps1/);
  assert.match(publishScript, /"-BuildExecutable", \$resolvedBuild\.resolved/);
  assert.match(publishScript, /"-ExpectedAppliedCount", \$ExpectedAppliedCount/);
  assert.match(publishScript, /function Test-PostApplyRecoveryRequiredPaths/);
  assert.match(publishScript, /Test-PostApplyRecoveryRequiredPaths\s*\n\s*\$previousReport/);
  assert.match(publishScript, /daily task state path is not initialized/);
  assert.match(publishScript, /notificationStatus/);
  assert.match(publishScript, /Send-AutoPublishNotificationSafely/);
  assert.match(publishScript, /-not \$ResumeAfterProductionWrite -and @\(& git -C \$ProjectRoot status --porcelain --untracked-files=no\)\.Count -gt 0/);
  assert.match(publishScript, /if \(-not \$ResumeAfterProductionWrite\) \{\s*\$dailyArguments/s);
  assert.match(publishScript, /"add", "--"/);
  assert.match(publishScript, /"reset"/);
  assert.match(publishScript, /origin\/main changed during run/);
  assert.match(
    publishScript,
    /\$dailyState\.status -eq "detail-progress"[\s\S]*?Complete-AutoPublish -Status "detail-progress"/
  );
  assert.doesNotMatch(publishScript, /manual-large-apply/);
  assert.doesNotMatch(publishScript, /--force(?:-with-lease)?/);

  const resolverSource = publishScript.match(
    /function Resolve-BuildExecutable\s*\{[\s\S]*?\n\}\r?\n\r?\nfunction Test-AutomationWorktree/
  )?.[0].replace(/\r?\n\r?\nfunction Test-AutomationWorktree$/, "");
  assert.ok(resolverSource, "build resolver function must be present");
  const resolverRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yandoubuy-npm-resolver-"));
  try {
    const pathNpm = path.join(resolverRoot, "path-npm.cmd");
    const programFiles = path.join(resolverRoot, "Program Files");
    const fallbackNpm = path.join(programFiles, "nodejs", "npm.cmd");
    const directoryOnly = path.join(resolverRoot, "directory");
    fs.mkdirSync(path.dirname(fallbackNpm), { recursive: true });
    fs.mkdirSync(directoryOnly);
    fs.writeFileSync(pathNpm, "@echo off\n");
    fs.writeFileSync(fallbackNpm, "@echo off\n");
    const fromPath = runBuildResolver(resolverSource, {
      RESOLVE_MODE: "path", RESOLVE_CANDIDATE: pathNpm, RESOLVE_REQUESTED: "npm.cmd", RESOLVE_PROGRAM_FILES: programFiles,
    });
    assert.equal(fromPath.status, 0, fromPath.stderr);
    assert.equal(JSON.parse(fromPath.stdout).resolutionMode, "get-command");
    const fromFallback = runBuildResolver(resolverSource, {
      RESOLVE_MODE: "missing", RESOLVE_CANDIDATE: "", RESOLVE_REQUESTED: "npm.cmd", RESOLVE_PROGRAM_FILES: programFiles,
    });
    assert.equal(fromFallback.status, 0, fromFallback.stderr);
    assert.equal(JSON.parse(fromFallback.stdout).resolutionMode, "program-files-fallback");
    const explicit = runBuildResolver(resolverSource, {
      RESOLVE_MODE: "missing", RESOLVE_CANDIDATE: "", RESOLVE_REQUESTED: pathNpm, RESOLVE_PROGRAM_FILES: path.join(resolverRoot, "none"),
    });
    assert.equal(explicit.status, 0, explicit.stderr);
    assert.equal(JSON.parse(explicit.stdout).resolutionMode, "explicit-path");
    const missing = runBuildResolver(resolverSource, {
      RESOLVE_MODE: "missing", RESOLVE_CANDIDATE: "", RESOLVE_REQUESTED: "missing-npm.cmd", RESOLVE_PROGRAM_FILES: path.join(resolverRoot, "none"),
    });
    assert.notEqual(missing.status, 0);
    const empty = runBuildResolver(resolverSource, {
      RESOLVE_MODE: "missing", RESOLVE_CANDIDATE: "", RESOLVE_REQUESTED: "", RESOLVE_PROGRAM_FILES: programFiles,
    });
    assert.notEqual(empty.status, 0);
    assert.match(empty.stderr, /build executable request is not initialized/);
    const directory = runBuildResolver(resolverSource, {
      RESOLVE_MODE: "missing", RESOLVE_CANDIDATE: "", RESOLVE_REQUESTED: directoryOnly, RESOLVE_PROGRAM_FILES: programFiles,
    });
    assert.notEqual(directory.status, 0);
  } finally {
    fs.rmSync(resolverRoot, { recursive: true, force: true });
  }

  const requiredPathsSource = publishScript.match(
    /function Test-PostApplyRecoveryRequiredPaths\s*\{[\s\S]*?\n\}\r?\n\r?\nfunction Copy-DailyStateToReport/
  )?.[0].replace(/\r?\n\r?\nfunction Copy-DailyStateToReport$/, "");
  assert.ok(requiredPathsSource, "recovery required-path validation must be present");
  const requiredRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yandoubuy-recovery-paths-"));
  try {
    const reportPath = path.join(requiredRoot, "report.json");
    const dailyPath = path.join(requiredRoot, "daily.json");
    const progressivePath = path.join(requiredRoot, "progressive.json");
    const auditPath = path.join(requiredRoot, "audit.mjs");
    for (const filePath of [reportPath, dailyPath, progressivePath, auditPath]) fs.writeFileSync(filePath, "{}\n");
    const variables = (daily) => [
      `$ReportJsonPath='${reportPath.replaceAll("'", "''")}'`,
      `$DailyTaskStatePath=${daily === null ? "''" : `'${daily.replaceAll("'", "''")}'`}`,
      `$ProgressiveStatePath='${progressivePath.replaceAll("'", "''")}'`,
      `$PostApplyAuditScriptPath='${auditPath.replaceAll("'", "''")}'`,
      requiredPathsSource,
      "Test-PostApplyRecoveryRequiredPaths",
    ].join("\n");
    assert.equal(runPowerShell(variables(dailyPath)).status, 0);
    const missingDaily = runPowerShell(variables(path.join(requiredRoot, "missing.json")));
    assert.notEqual(missingDaily.status, 0);
    assert.match(missingDaily.stderr, /daily task state is missing:/);
    const emptyDaily = runPowerShell(variables(null));
    assert.notEqual(emptyDaily.status, 0);
    assert.match(emptyDaily.stderr, /daily task state path is not initialized/);
    assert.doesNotMatch(emptyDaily.stderr, /LiteralPath/);
  } finally {
    fs.rmSync(requiredRoot, { recursive: true, force: true });
  }

  const notificationSource = publishScript.match(
    /function Send-AutoPublishNotification\s*\{[\s\S]*?\n\}\r?\n\r?\nfunction Complete-AutoPublish/
  )?.[0].replace(/\r?\n\r?\nfunction Complete-AutoPublish$/, "");
  assert.ok(notificationSource, "safe notification functions must be present");
  const notificationHarness = (pathValue) => [
    "$report = [ordered]@{ notificationStatus = 'not-attempted'; notificationFailure = $null }",
    `$NotificationScriptPath = '${pathValue.replaceAll("'", "''")}'`,
    "$NodeExecutablePath = 'node'",
    "$ReportJsonPath = 'report.json'",
    "function Invoke-CheckedCommand { throw 'should not run for this test' }",
    notificationSource,
    "Send-AutoPublishNotificationSafely",
    "$report | ConvertTo-Json -Compress",
  ].join("\n");
  const notificationSkipped = runPowerShell(notificationHarness(""));
  assert.equal(notificationSkipped.status, 0, notificationSkipped.stderr);
  assert.equal(JSON.parse(notificationSkipped.stdout).notificationStatus, "skipped-not-configured");
  const notificationFailed = runPowerShell(notificationHarness(path.join(os.tmpdir(), "missing-notification-helper.mjs")));
  assert.equal(notificationFailed.status, 0, notificationFailed.stderr);
  assert.equal(JSON.parse(notificationFailed.stdout).notificationStatus, "failed");

  git(fixtureRoot, ["init", "--initial-branch=main"]);
  git(fixtureRoot, ["config", "user.email", "test@example.invalid"]);
  git(fixtureRoot, ["config", "user.name", "Auto Publish Test"]);
  fs.mkdirSync(path.join(fixtureRoot, "data", "products"), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, "data", "generated", "public-products"), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, "app"), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, "data", "inventory"), { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, "data", "products", "smokingpipes-products.json"), "[]\n");
  fs.writeFileSync(path.join(fixtureRoot, "data", "products", "unified-products-staging.json"), "[]\n");
  fs.writeFileSync(path.join(fixtureRoot, "data", "generated", "public-products", "catalog.json"), "[]\n");
  fs.writeFileSync(path.join(fixtureRoot, "app", "page.tsx"), "export default function Page() { return null; }\n");
  git(fixtureRoot, ["add", "data", "app"]);
  git(fixtureRoot, ["commit", "-m", "fixture"]);

  assert.equal(isAllowedProductionPath("data/products/smokingpipes-products.json"), true);
  assert.equal(isAllowedProductionPath("data/products/unified-products-staging.json"), true);
  assert.equal(isAllowedProductionPath("data/generated/public-products/details/00.json"), true);
  assert.equal(isAllowedProductionPath("app/page.tsx"), false);
  assert.equal(isAllowedProductionPath("data/inventory/runtime.json"), false);
  assert.deepEqual(AUTO_PUBLISH_PRODUCTION_PATHS, [
    "data/products/smokingpipes-products.json",
    "data/products/unified-products-staging.json",
    "data/generated/public-products/**",
  ]);

  const allowedStage = validateAutoPublishStagedPaths([
    "data/products/smokingpipes-products.json",
    "data/generated/public-products/catalog.json",
  ]);
  assert.equal(allowedStage.allowed, true);
  const rejectedStage = validateAutoPublishStagedPaths([
    "app/page.tsx",
    "data/inventory/smokingpipes-daily-task-state.json",
  ]);
  assert.equal(rejectedStage.allowed, false);
  assert.deepEqual(rejectedStage.disallowedFiles, [
    "app/page.tsx",
    "data/inventory/smokingpipes-daily-task-state.json",
  ]);

  fs.writeFileSync(
    path.join(fixtureRoot, "data", "products", "smokingpipes-products.json"),
    "[{\"id\":\"smokingpipes-fixture\"}]\n"
  );
  git(fixtureRoot, ["add", "data/products/smokingpipes-products.json"]);
  const stagedOnlyProduction = git(fixtureRoot, ["diff", "--cached", "--name-only"])
    .split(/\r?\n/)
    .filter(Boolean);
  assert.equal(validateAutoPublishStagedPaths(stagedOnlyProduction).allowed, true);
  git(fixtureRoot, ["reset"]);
  fs.writeFileSync(
    path.join(fixtureRoot, "app", "page.tsx"),
    "export default function Page() { return <main />; }\n"
  );
  git(fixtureRoot, ["add", "app/page.tsx"]);
  const stagedUi = git(fixtureRoot, ["diff", "--cached", "--name-only"])
    .split(/\r?\n/)
    .filter(Boolean);
  assert.equal(validateAutoPublishStagedPaths(stagedUi).allowed, false);
  git(fixtureRoot, ["reset"]);

  const base = {
    isAutomationWorktree: true,
    trackedWorktreeClean: true,
    stagedFiles: [],
    headMatchesOriginMain: true,
    noActiveInventoryLock: true,
    noRunningInventoryProcess: true,
    dailySucceeded: true,
    productionWritten: true,
    candidateCount: 4,
    wouldApplyCount: 4,
    appliedCount: 4,
    maxAutoApply: DEFAULT_MAX_AUTO_APPLY,
    validatorPassed: true,
    inventoryDefaultPassed: true,
    inventoryRunnerPassed: true,
    buildPassed: true,
    remoteMainUnchanged: true,
  };
  assert.equal(evaluateAutoPublishGate(base).allowed, true);
  assert.equal(DEFAULT_MAX_AUTO_APPLY, 1000);
  assert.equal(LARGE_APPLY_WARNING_THRESHOLD, 300);
  for (const [count, warning, allowed] of [
    [300, false, true],
    [301, true, true],
    [895, true, true],
    [1000, true, true],
    [1001, true, false],
  ]) {
    const result = evaluateAutoPublishGate({
      ...base,
      wouldApplyCount: count,
      appliedCount: count,
    });
    assert.equal(result.largeApplyWarning, warning);
    assert.equal(result.largeApplyBlocked, !allowed);
    assert.equal(result.allowed, allowed);
  }
  assert.equal(evaluateAutoPublishGate({ ...base, isAutomationWorktree: false }).allowed, false);
  assert.equal(evaluateAutoPublishGate({ ...base, trackedWorktreeClean: false }).allowed, false);
  assert.equal(evaluateAutoPublishGate({ ...base, headMatchesOriginMain: false }).allowed, false);
  assert.equal(evaluateAutoPublishGate({ ...base, productionWritten: false }).allowed, false);
  assert.equal(evaluateAutoPublishGate({ ...base, validatorPassed: false }).allowed, false);
  assert.equal(evaluateAutoPublishGate({ ...base, buildPassed: false }).allowed, false);
  assert.equal(evaluateAutoPublishGate({ ...base, pendingCount: 1 }).allowed, false);
  assert.equal(evaluateAutoPublishGate({ ...base, failedCount: 1 }).allowed, false);
  assert.equal(evaluateAutoPublishGate({ ...base, remoteMainUnchanged: false }).allowed, false);
  assert.equal(evaluateAutoPublishGate({ ...base, noPush: true }).wouldCommit, false);
  assert.equal(evaluateAutoPublishGate({ ...base, dailySucceeded: false }).wouldCommit, false);
  assert.equal(evaluateAutoPublishGate({ ...base, productionWritten: false }).wouldCommit, false);
  assert.equal(evaluateAutoPublishGate({ ...base, deployHookConfigured: false }).deploymentStatus, "push-complete-deployment-pending-verification");
  assert.equal(evaluateAutoPublishGate({ ...base, deployHookConfigured: true, deployHookSucceeded: false }).deploymentStatus, "deploy-hook-failed");
  assert.equal(evaluateAutoPublishGate({ ...base, trackedWorktreeClean: false }).wouldCommit, false);

  const recoveryBase = {
    reportProductionWritten: true,
    reportCommitPerformed: false,
    reportPushPerformed: false,
    taskProductionWritten: true,
    reportAppliedCount: 895,
    taskAppliedCount: 895,
    reportWouldApplyCount: 895,
    taskWouldApplyCount: 895,
    pendingCount: 0,
    failedCount: 0,
    fullExpectedRangeScanned: true,
    headMatchesOriginMain: true,
    branch: "automation/smokingpipes-production-run",
    upstream: "origin/main",
    trackedDirtyFiles: ["data/products/smokingpipes-products.json", "data/generated/public-products/catalog.json"],
    stagedFiles: [],
  };
  assert.equal(evaluatePostApplyRecoveryGate(recoveryBase).allowed, true);
  for (const override of [
    { reportProductionWritten: false }, { reportCommitPerformed: true }, { reportPushPerformed: true },
    { pendingCount: 1 }, { failedCount: 1 }, { fullExpectedRangeScanned: false },
    { trackedDirtyFiles: ["scripts/inventory/run-smokingpipes-auto-publish.ps1"] },
    { stagedFiles: ["data/products/smokingpipes-products.json"] },
    { taskAppliedCount: 894 },
  ]) {
    assert.equal(evaluatePostApplyRecoveryGate({ ...recoveryBase, ...override }).allowed, false);
  }
  const delta = summarizeSmokingpipesProductionDelta({
    beforeProducts: [{ id: "one", inventoryStatus: "sold", price: { current: 1 } }],
    afterProducts: [{ id: "one", inventoryStatus: "available", price: { current: 2 } }, { id: "two", inventoryStatus: "available", price: { current: 3 } }],
  });
  assert.deepEqual(delta.actions, { added: 1, updated: 1, soldOrOutOfStockToAvailable: 1, availableToSoldOrOutOfStock: 0, priceChanged: 1 });
  assert.equal(delta.touchedUniqueIds, 2);

  const remoteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yandoubuy-auto-publish-remote-"));
  const remotePath = path.join(remoteRoot, "origin.git");
  const writerPath = path.join(remoteRoot, "writer");
  const updaterPath = path.join(remoteRoot, "updater");
  try {
    git(remoteRoot, ["init", "--bare", remotePath]);
    git(remoteRoot, ["clone", remotePath, writerPath]);
    git(writerPath, ["config", "user.email", "writer@example.invalid"]);
    git(writerPath, ["config", "user.name", "Writer"]);
    fs.writeFileSync(path.join(writerPath, "production.json"), "one\n");
    git(writerPath, ["add", "production.json"]);
    git(writerPath, ["commit", "-m", "initial"]);
    git(writerPath, ["push", "origin", "HEAD:main"]);

    git(remoteRoot, ["clone", remotePath, updaterPath]);
    git(updaterPath, ["checkout", "main"]);
    git(updaterPath, ["config", "user.email", "updater@example.invalid"]);
    git(updaterPath, ["config", "user.name", "Updater"]);
    fs.writeFileSync(path.join(updaterPath, "remote.txt"), "remote\n");
    git(updaterPath, ["add", "remote.txt"]);
    git(updaterPath, ["commit", "-m", "remote update"]);
    git(updaterPath, ["push", "origin", "HEAD:main"]);

    fs.writeFileSync(path.join(writerPath, "production.json"), "two\n");
    git(writerPath, ["add", "production.json"]);
    git(writerPath, ["commit", "-m", "local publish candidate"]);
    const localCommitBeforePush = git(writerPath, ["rev-parse", "HEAD"]);
    const failedPush = gitResult(writerPath, ["push", "origin", "HEAD:main"]);
    assert.notEqual(failedPush.status, 0, "remote update must reject a non-fast-forward push");
    assert.equal(git(writerPath, ["rev-parse", "HEAD"]), localCommitBeforePush);
    assert.equal(Number(git(writerPath, ["rev-list", "--count", "origin/main..HEAD"])), 1);
  } finally {
    fs.rmSync(remoteRoot, { recursive: true, force: true });
  }

  console.log("Smokingpipes auto publish policy tests passed.");
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
