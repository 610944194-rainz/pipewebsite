export const AUTO_PUBLISH_PRODUCTION_PATHS = [
  "data/products/smokingpipes-products.json",
  "data/products/unified-products-staging.json",
  "data/generated/public-products/**",
];

export const POST_APPLY_RECOVERY_ALLOWED_PATHS = [
  ...AUTO_PUBLISH_PRODUCTION_PATHS,
];

export const LARGE_APPLY_WARNING_THRESHOLD = 300;
export const DEFAULT_MAX_AUTO_APPLY = 1000;

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
  pendingCount = 0,
  failedCount = 0,
  maxAutoApply = DEFAULT_MAX_AUTO_APPLY,
  largeApplyWarningThreshold = LARGE_APPLY_WARNING_THRESHOLD,
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
  if (!Number.isSafeInteger(maxAutoApply) || maxAutoApply <= 0) {
    blockers.push("maxAutoApply must be a positive safe integer");
  }
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
  if (pendingCount > 0) blockers.push(`pending candidates=${pendingCount}`);
  if (failedCount > 0) blockers.push(`failed candidates=${failedCount}`);
  const largeApplyWarning =
    wouldApplyCount > largeApplyWarningThreshold;
  const largeApplyBlocked = wouldApplyCount > maxAutoApply;
  if (largeApplyBlocked) {
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
    wouldApplyCount,
    maxAutoApply,
    largeApplyWarningThreshold,
    largeApplyWarning,
    largeApplyBlocked,
    wouldCommit: allowed && !noPush,
    wouldPush: allowed && !noPush,
    deploymentMode: deployHookConfigured ? "deploy-hook" : "git-integration",
    deploymentStatus,
  };
}

export function evaluatePostApplyRecoveryGate({
  reportProductionWritten = false,
  reportCommitPerformed = false,
  reportPushPerformed = false,
  taskProductionWritten = false,
  reportAppliedCount = 0,
  taskAppliedCount = 0,
  reportWouldApplyCount = 0,
  taskWouldApplyCount = 0,
  pendingCount = 0,
  failedCount = 0,
  fullExpectedRangeScanned = false,
  headMatchesOriginMain = false,
  branch = "",
  upstream = "",
  trackedDirtyFiles = [],
  stagedFiles = [],
} = {}) {
  const blockers = [];
  const dirty = validateAutoPublishStagedPaths(trackedDirtyFiles);
  if (!reportProductionWritten) {
    blockers.push("report productionWritten must be true");
  }
  if (reportCommitPerformed) {
    blockers.push("report commitPerformed must be false");
  }
  if (reportPushPerformed) {
    blockers.push("report pushPerformed must be false");
  }
  if (!taskProductionWritten) {
    blockers.push("task productionWritten must be true");
  }
  if (!(reportAppliedCount > 0)) {
    blockers.push("report appliedCount must be greater than 0");
  }
  if (reportAppliedCount !== taskAppliedCount) {
    blockers.push(
      `task appliedCount ${taskAppliedCount} does not match report ${reportAppliedCount}`
    );
  }
  if (reportWouldApplyCount !== taskWouldApplyCount) {
    blockers.push(
      `task wouldApplyCount ${taskWouldApplyCount} does not match report ${reportWouldApplyCount}`
    );
  }
  if (pendingCount > 0) blockers.push(`pending candidates=${pendingCount}`);
  if (failedCount > 0) blockers.push(`failed candidates=${failedCount}`);
  if (!fullExpectedRangeScanned) {
    blockers.push("list fullExpectedRangeScanned must be true");
  }
  if (!headMatchesOriginMain) blockers.push("HEAD does not match origin/main");
  if (!/^automation\//.test(String(branch))) {
    blockers.push("branch must match automation/* for post-apply recovery");
  }
  if (upstream !== "origin/main") {
    blockers.push("upstream must be origin/main for post-apply recovery");
  }
  if (!dirty.stagedFiles.length) {
    blockers.push("production dirty files are required for post-apply recovery");
  }
  if (dirty.disallowedFiles.length) {
    blockers.push(
      `non-production tracked changes: ${dirty.disallowedFiles.join(", ")}`
    );
  }
  if (stagedFiles.length) {
    blockers.push("post-apply recovery requires no pre-staged files");
  }
  return {
    allowed: blockers.length === 0,
    blockers,
    allowedDirtyFiles: dirty.stagedFiles,
    disallowedDirtyFiles: dirty.disallowedFiles,
  };
}
