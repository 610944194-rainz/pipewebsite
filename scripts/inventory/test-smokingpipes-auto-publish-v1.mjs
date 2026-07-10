import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  AUTO_PUBLISH_PRODUCTION_PATHS,
  evaluateAutoPublishGate,
  isAllowedProductionPath,
  validateAutoPublishStagedPaths,
} from "./smokingpipes-auto-publish-policy-v1.mjs";

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function gitResult(cwd, args) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
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
  assert.match(publishScript, /\[string\]\$NodeExecutable\s*=\s*"node"/);
  assert.match(publishScript, /\[string\]\$NotificationScriptPath\s*=\s*""/);
  assert.match(publishScript, /auto publish must run from the dedicated automation worktree/);
  assert.match(publishScript, /\$ProjectRoot\s*=\s*\(Resolve-Path \(Join-Path \$PSScriptRoot "\.\.\\\.\."\)\)\.Path/);
  assert.match(publishScript, /Push-Location -LiteralPath \$ProjectRoot/);
  assert.match(publishScript, /finally\s*\{[\s\S]*?Pop-Location/);
  assert.match(publishScript, /\$NotificationScriptPath\s*=\s*Join-Path \$ProjectRoot/);
  assert.match(publishScript, /notification helper is missing/);
  assert.match(publishScript, /Invoke-CheckedCommand -FilePath \$NodeExecutablePath/);
  assert.match(publishScript, /Complete-AutoPublish/);
  assert.match(publishScript, /git -c http\.sslBackend=openssl -C \$ProjectRoot/);
  assert.doesNotMatch(publishScript, /& node "scripts\/inventory\/smokingpipes-auto-publish-notify-v1\.mjs"/);
  assert.match(publishScript, /scripts[\\/]validate-public-product-indexes-v1\.mjs/);
  assert.match(publishScript, /scripts[\\/]test-public-products-inventory-default-v1\.mjs/);
  assert.match(publishScript, /scripts[\\/]inventory[\\/]test-inventory-runner-v1\.mjs/);
  assert.match(publishScript, /npm\.cmd/);
  assert.match(publishScript, /"add", "--"/);
  assert.match(publishScript, /"reset"/);
  assert.match(publishScript, /origin\/main changed during run/);
  assert.match(
    publishScript,
    /\$dailyState\.status -eq "detail-progress"[\s\S]*?Complete-AutoPublish -Status "detail-progress"/
  );
  assert.doesNotMatch(publishScript, /manual-large-apply/);
  assert.doesNotMatch(publishScript, /--force(?:-with-lease)?/);

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
    maxAutoApply: 300,
    validatorPassed: true,
    inventoryDefaultPassed: true,
    inventoryRunnerPassed: true,
    buildPassed: true,
    remoteMainUnchanged: true,
  };
  assert.equal(evaluateAutoPublishGate(base).allowed, true);
  assert.equal(evaluateAutoPublishGate({ ...base, isAutomationWorktree: false }).allowed, false);
  assert.equal(evaluateAutoPublishGate({ ...base, trackedWorktreeClean: false }).allowed, false);
  assert.equal(evaluateAutoPublishGate({ ...base, headMatchesOriginMain: false }).allowed, false);
  assert.equal(evaluateAutoPublishGate({ ...base, productionWritten: false }).allowed, false);
  assert.equal(evaluateAutoPublishGate({ ...base, validatorPassed: false }).allowed, false);
  assert.equal(evaluateAutoPublishGate({ ...base, buildPassed: false }).allowed, false);
  assert.equal(evaluateAutoPublishGate({ ...base, wouldApplyCount: 301 }).allowed, false);
  assert.equal(evaluateAutoPublishGate({ ...base, remoteMainUnchanged: false }).allowed, false);
  assert.equal(evaluateAutoPublishGate({ ...base, noPush: true }).wouldCommit, false);
  assert.equal(evaluateAutoPublishGate({ ...base, dailySucceeded: false }).wouldCommit, false);
  assert.equal(evaluateAutoPublishGate({ ...base, productionWritten: false }).wouldCommit, false);
  assert.equal(evaluateAutoPublishGate({ ...base, deployHookConfigured: false }).deploymentStatus, "push-complete-deployment-pending-verification");
  assert.equal(evaluateAutoPublishGate({ ...base, deployHookConfigured: true, deployHookSucceeded: false }).deploymentStatus, "deploy-hook-failed");

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
