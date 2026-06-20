import fs from "node:fs";
import process from "node:process";
import {
  PATHS,
  duplicateValues,
  isDirectExecution,
  readJson,
  relativePath,
} from "./inventory-common-v1.mjs";

function validate() {
  const errors = [];
  const warnings = [];
  const required = [
    PATHS.currentList,
    PATHS.diff,
    PATHS.recentNew,
    PATHS.report,
  ];

  for (const filePath of required) {
    if (!fs.existsSync(filePath)) {
      errors.push(`Missing required dry-run file: ${relativePath(filePath)}`);
    }
  }

  if (errors.length) {
    return { status: "failed", errors, warnings };
  }

  const current = readJson(PATHS.currentList);
  const diff = readJson(PATHS.diff);
  const recentNew = readJson(PATHS.recentNew);
  const currentProducts = Array.isArray(current.products) ? current.products : [];
  const currentIds = currentProducts.map((item) => item.sourceProductId);
  const duplicateCurrentIds = duplicateValues(currentIds);
  const duplicateRecentIds = duplicateValues(recentNew.newProductIds || []);
  const historicalAvailable = Number(diff.counts?.existingAvailable || 0);
  const currentCount = Number(diff.counts?.currentAvailable || 0);
  const minimumRatio = Number(
    diff.thresholds?.minimumCurrentVsHistoricalAvailableRatio ?? 0.5
  );
  const minimumCurrentCount = Math.ceil(historicalAvailable * minimumRatio);
  const disappearedRatio = Number(
    diff.ratios?.disappearedVsHistoricalAvailable || 0
  );
  const maximumDisappearedRatio = Number(
    diff.thresholds?.maximumDisappearedVsHistoricalAvailableRatio ?? 0.35
  );
  const newRatio = Number(diff.ratios?.newVsExisting || 0);
  const maximumNewRatio = Number(
    diff.thresholds?.maximumNewVsExistingRatio ?? 0.25
  );

  if (!currentProducts.length) errors.push("Current list contains no products.");
  if (duplicateCurrentIds.length) {
    errors.push(
      `Duplicate current sourceProductId values: ${duplicateCurrentIds
        .slice(0, 20)
        .join(", ")}`
    );
  }
  if (Number(current.summary?.pagesScanned || 0) < Number(current.summary?.pagesRequested || 0)) {
    errors.push("Current list did not scan every requested page.");
  }
  if (currentCount < minimumCurrentCount) {
    errors.push(
      `Safety threshold failed: current list ${currentCount} is below minimum ${minimumCurrentCount}.`
    );
  }
  if (disappearedRatio > maximumDisappearedRatio) {
    errors.push(
      `Safety threshold failed: disappeared ratio ${(disappearedRatio * 100).toFixed(
        2
      )}% exceeds ${(maximumDisappearedRatio * 100).toFixed(2)}%.`
    );
  }
  if (newRatio > maximumNewRatio) {
    errors.push(
      `Safety threshold failed: new ratio ${(newRatio * 100).toFixed(
        2
      )}% exceeds ${(maximumNewRatio * 100).toFixed(2)}%.`
    );
  }
  if (duplicateRecentIds.length) {
    errors.push(
      `Duplicate recent-new IDs: ${duplicateRecentIds.slice(0, 20).join(", ")}`
    );
  }
  if (
    JSON.stringify(recentNew.newProductIds || []) !==
    JSON.stringify(diff.newIds || [])
  ) {
    errors.push("recent-new IDs do not exactly match diff.newIds.");
  }
  if (diff.fatalWarnings?.length && diff.allowApply) {
    errors.push("Diff has fatal warnings but allowApply is true.");
  }
  if (!current.config?.manualVerification) {
    warnings.push("Dry-run was not recorded as manualVerification=true.");
  }
  if (!diff.allowApply && !(diff.applyBlockedReasons || []).length) {
    errors.push("allowApply is false but applyBlockedReasons is empty.");
  }
  if (!diff.coverage?.fullExpectedRangeScanned) {
    warnings.push(
      `Partial full-list coverage: ${diff.coverage?.pagesScanned || 0}/${
        diff.coverage?.expectedPages || 0
      } pages.`
    );
  }
  if (Number(diff.counts?.suspicious || 0) > 0) {
    warnings.push(
      `${diff.counts.suspicious} suspicious records require review.`
    );
  }

  return {
    status: errors.length ? "blocked" : "passed",
    allowApply: Boolean(diff.allowApply) && errors.length === 0,
    counts: diff.counts,
    coverage: diff.coverage,
    errors,
    warnings,
  };
}

export function validateInventoryUpdate() {
  const result = validate();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (isDirectExecution(import.meta.url)) {
  try {
    const result = validateInventoryUpdate();
    if (result.status !== "passed") process.exitCode = 1;
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
