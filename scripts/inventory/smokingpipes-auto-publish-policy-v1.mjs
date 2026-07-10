export const AUTO_PUBLISH_PRODUCTION_PATHS = [
  "data/products/smokingpipes-products.json",
  "data/products/unified-products-staging.json",
  "data/generated/public-products/**",
];

function text(value) {
  return String(value || "").trim().replaceAll("\\", "/");
}

export function isAllowedProductionPath(filePath) {
  const value = text(filePath);
  return (
    value === "data/products/smokingpipes-products.json" ||
    value === "data/products/unified-products-staging.json" ||
    value.startsWith("data/generated/public-products/")
  );
}

export function validateAutoPublishStagedPaths(files = []) {
  const stagedFiles = [...new Set(files.map(text).filter(Boolean))];
  const disallowedFiles = stagedFiles.filter(
    (filePath) => !isAllowedProductionPath(filePath)
  );
  return {
    allowed: stagedFiles.length > 0 && disallowedFiles.length === 0,
    stagedFiles,
    disallowedFiles,
  };
}

export function evaluateAutoPublishGate({
  isAutomationWorktree = false,
  trackedWorktreeClean = false,
  stagedFiles = [],
  headMatchesOriginMain = false,
  noActiveInventoryLock = false,
  noRunningInventoryProcess = false,
  dailySucceeded = false,
  productionWritten = false,
  candidateCount = 0,
  wouldApplyCount = 0,
  appliedCount = 0,
  maxAutoApply = 300,
  validatorPassed = false,
  inventoryDefaultPassed = false,
  inventoryRunnerPassed = false,
  buildPassed = false,
  remoteMainUnchanged = false,
  noPush = false,
  deployHookConfigured = false,
  deployHookSucceeded = null,
} = {}) {
  const blockers = [];
  const stage = validateAutoPublishStagedPaths(stagedFiles);
  if (!isAutomationWorktree) blockers.push("not an automation worktree");
  if (!trackedWorktreeClean) blockers.push("tracked worktree is dirty");
  if (stage.stagedFiles.length) blockers.push("worktree has staged files");
  if (!headMatchesOriginMain) blockers.push("HEAD does not match origin/main");
  if (!noActiveInventoryLock) blockers.push("an inventory lock is active");
  if (!noRunningInventoryProcess) blockers.push("an inventory process is already running");
  if (!dailySucceeded) blockers.push("daily pipeline did not report success");
  if (!productionWritten) blockers.push("daily pipeline did not write production");
  if (!(candidateCount > 0)) blockers.push("candidateCount must be greater than 0");
  if (!(wouldApplyCount > 0)) blockers.push("wouldApplyCount must be greater than 0");
  if (!(appliedCount > 0)) blockers.push("appliedCount must be greater than 0");
  if (wouldApplyCount > maxAutoApply) {
    blockers.push(`wouldApplyCount ${wouldApplyCount} exceeds max auto apply ${maxAutoApply}`);
  }
  if (!validatorPassed) blockers.push("public index validator failed");
  if (!inventoryDefaultPassed) blockers.push("inventory default test failed");
  if (!inventoryRunnerPassed) blockers.push("inventory runner test failed");
  if (!buildPassed) blockers.push("build failed");
  if (!remoteMainUnchanged) blockers.push("origin/main changed during run");

  const allowed = blockers.length === 0;
  const deploymentStatus = deployHookConfigured
    ? deployHookSucceeded === false
      ? "deploy-hook-failed"
      : "deploy-hook-pending"
    : "push-complete-deployment-pending-verification";
  return {
    allowed,
    blockers,
    wouldCommit: allowed && !noPush,
    wouldPush: allowed && !noPush,
    deploymentMode: deployHookConfigured ? "deploy-hook" : "git-integration",
    deploymentStatus,
  };
}
