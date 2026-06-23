import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as runnerCore from "./inventory-runner-core-v1.mjs";
import {
  acquireRunLock,
  buildDetailsQueue,
  collectValidCachedDetails,
  evaluateRunnerReadiness,
  parseRunnerOptions,
  releaseRunLock,
  shouldFetchNewDetails,
} from "./inventory-runner-core-v1.mjs";
import {
  randomDelayMs,
  resolveListPacingOptions,
  shouldApplyPageBatchCooldown,
} from "./smokingpipes-fetch-current-list-v1.mjs";
import { buildInventoryDiff } from "./smokingpipes-diff-inventory-v1.mjs";
import * as detailsQueueModule from "./smokingpipes-details-queue-v1.mjs";
import { processSmokingpipesDetailsQueue } from "./smokingpipes-details-queue-v1.mjs";
import * as applyDryRunModule from "./smokingpipes-apply-dry-run-v1.mjs";
import {
  buildSmokingpipesApplyDryRunArtifacts,
  buildSmokingpipesApplyCandidate,
  buildSmokingpipesBaselineReadinessMarkdown,
  buildSmokingpipesBaselineReadinessReport,
  classifySmokingpipesBaselineProducts,
  validatePublicProductsNextCandidate,
  writeSmokingpipesApplyDryRunOutputs,
} from "./smokingpipes-apply-dry-run-v1.mjs";
import {
  classifySmokingpipesVerificationSignals,
  isNormalSmokingpipesDetail,
  launchSmokingpipesContext,
  resolveSmokingpipesBrowserLaunch,
  summarizeSmokingpipesListProducts,
  waitForSmokingpipesManualRecovery,
} from "../lib/smokingpipes-utils.mjs";
import {
  acquireBrowserProfileLock,
  buildSmokingpipesBrowserDescriptor,
  releaseBrowserProfileLock,
  resolveSmokingpipesBrowserProfile,
} from "../lib/smokingpipes-browser-profile-v1.mjs";
import { buildUnifiedProductsFromInputs } from "../build-unified-products-staging-v1.mjs";
import {
  buildPublicProductsCandidate,
  loadPublicProductsPricingContext,
} from "../build-public-product-indexes-v1.mjs";
import {
  buildSmokingpipesDailyCandidate,
  buildSmokingpipesDailyDiff,
  buildSmokingpipesDailyAudit,
  buildDailyTimingSummary,
  evaluateSmokingpipesDailyGenerationGate,
  invalidateUntrustedDailyQueue,
  shouldPrepareDailyDetailsQueue,
} from "./smokingpipes-daily-update-v1.mjs";
import {
  buildVerificationProbeTelemetry,
  evaluateVerificationRisk,
  summarizeVerificationTelemetry,
} from "./smokingpipes-verification-telemetry-v1.mjs";
import {
  buildDetailProbeTelemetry,
  runSmokingpipesDetailProbe,
  selectTrustedDetailProbeCandidates,
  simulateDetailProbe,
} from "./smokingpipes-detail-probe-v1.mjs";
import { runSmokingpipesBrowserPreflight } from "./smokingpipes-browser-preflight-v1.mjs";
import {
  createProgressiveDailyState,
  readProgressiveDailyState,
  validateProgressiveDailyState,
} from "./smokingpipes-progressive-state-v1.mjs";
import {
  ingestProgressiveListSnapshot,
  runProgressiveDetailChunk,
  summarizeProgressiveState,
} from "./smokingpipes-progressive-daily-v1.mjs";
import {
  auditProgressivePartialCandidate,
  buildProgressivePartialApplyPreview,
  buildProgressivePartialProducts,
  selectProgressiveRecentNew,
} from "./smokingpipes-progressive-candidate-v1.mjs";
import { runSmokingpipesProgressiveMode } from "./smokingpipes-progressive-runner-v1.mjs";

const defaults = parseRunnerOptions([]);
const defaultInventoryState = runnerCore.initialInventoryState();
assert.equal(defaultInventoryState.checkpointFailed, false);
assert.equal(defaultInventoryState.checkpointTargetPath, null);
assert.equal(defaultInventoryState.checkpointTempPath, null);
assert.equal(defaults.source, "smokingpipes");
assert.equal(defaults.mode, "dry-run");
assert.equal(defaults.commit, false);
assert.equal(defaults.deploy, false);
assert.equal(defaults.maxPages, 107);
assert.equal(defaults.maxNewDetailsPerRun, 10);
assert.equal(defaults.fetchNewDetails, false);
assert.equal(defaults.allowPartialNewDetails, false);
assert.equal(defaults.detailMaxPerRun, 10);
assert.equal(defaults.detailWarmupMinMs, 5000);
assert.equal(defaults.detailWarmupMaxMs, 12000);
assert.equal(defaults.detailDelayMinMs, 15000);
assert.equal(defaults.detailDelayMaxMs, 35000);
assert.equal(defaults.detailBatchSize, 5);
assert.equal(defaults.detailBatchCooldownMinMs, 90000);
assert.equal(defaults.detailBatchCooldownMaxMs, 180000);
assert.equal(defaults.browserChannel, null);
assert.equal(defaults.browserProfile, null);
assert.equal(defaults.browserProfileDir, null);
assert.equal(defaults.writeProduction, false);
assert.equal(
  parseRunnerOptions(["--write-production"]).writeProduction,
  true
);

const dailyDefaults = parseRunnerOptions(["--mode=daily-update"]);
assert.equal(dailyDefaults.mode, "daily-update");
assert.equal(dailyDefaults.refreshList, true);
assert.equal(dailyDefaults.dailyNewMaxDetails, 100);
assert.equal(dailyDefaults.detailBatchSize, 50);
assert.equal(dailyDefaults.pageWarmupMinMs, 1500);
assert.equal(dailyDefaults.pageWarmupMaxMs, 3000);
assert.equal(dailyDefaults.pageDelayMinMs, 3000);
assert.equal(dailyDefaults.pageDelayMaxMs, 6000);
assert.equal(dailyDefaults.pageBatchSize, 30);
assert.equal(dailyDefaults.pageBatchCooldownMinMs, 30000);
assert.equal(dailyDefaults.pageBatchCooldownMaxMs, 60000);
assert.equal(dailyDefaults.fullReconcile, true);
assert.equal(dailyDefaults.detailWarmupMinMs, 1000);
assert.equal(dailyDefaults.detailWarmupMaxMs, 3000);
assert.equal(dailyDefaults.detailDelayMinMs, 3000);
assert.equal(dailyDefaults.detailDelayMaxMs, 8000);
assert.equal(dailyDefaults.detailBatchCooldownMinMs, 0);
assert.equal(dailyDefaults.detailBatchCooldownMaxMs, 0);
assert.equal(dailyDefaults.commit, false);
assert.equal(dailyDefaults.deploy, false);
assert.equal(
  parseRunnerOptions(["--daily-update"]).mode,
  "daily-update"
);

const forcedConservativeFullScan = parseRunnerOptions([
  "--mode=daily-update",
  "--max-pages=107",
  "--page-warmup-min-ms=300",
  "--page-warmup-max-ms=1000",
  "--page-delay-min-ms=500",
  "--page-delay-max-ms=1500",
  "--page-batch-size=40",
  "--page-batch-cooldown-min-ms=10000",
  "--page-batch-cooldown-max-ms=20000",
]);
assert.equal(forcedConservativeFullScan.pageWarmupMinMs, 1500);
assert.equal(forcedConservativeFullScan.pageWarmupMaxMs, 3000);
assert.equal(forcedConservativeFullScan.pageDelayMinMs, 3000);
assert.equal(forcedConservativeFullScan.pageDelayMaxMs, 6000);
assert.equal(forcedConservativeFullScan.pageBatchSize, 30);
assert.equal(
  forcedConservativeFullScan.pageBatchCooldownMinMs,
  30000
);
assert.equal(
  forcedConservativeFullScan.pageBatchCooldownMaxMs,
  60000
);
assert.equal(forcedConservativeFullScan.pacingDowngraded, true);

const shortDailyNewPacing = parseRunnerOptions([
  "--mode=daily-update",
  "--max-pages=10",
]);
assert.equal(shortDailyNewPacing.fullReconcile, false);
assert.equal(shortDailyNewPacing.shortDailyNewScan, true);
assert.equal(shortDailyNewPacing.pageWarmupMinMs, 500);
assert.equal(shortDailyNewPacing.pageWarmupMaxMs, 1500);
assert.equal(shortDailyNewPacing.pageDelayMinMs, 1000);
assert.equal(shortDailyNewPacing.pageDelayMaxMs, 3000);
assert.equal(shortDailyNewPacing.pageBatchCooldownMinMs, 0);
assert.equal(shortDailyNewPacing.pageBatchCooldownMaxMs, 0);

const dailyOverrides = parseRunnerOptions([
  "--mode=daily-update",
  "--daily-new-max-details=5",
  "--fetch-new-details",
]);
assert.equal(dailyOverrides.dailyNewMaxDetails, 5);
assert.equal(dailyOverrides.fetchNewDetails, true);
assert.throws(
  () =>
    parseRunnerOptions([
      "--mode=daily-update",
      "--catch-up-current",
    ]),
  /baseline|catch-up|daily-update/i
);

const verificationProbeDefaults = parseRunnerOptions([
  "--mode=verification-probe",
]);
assert.equal(verificationProbeDefaults.mode, "verification-probe");
assert.equal(verificationProbeDefaults.verificationProbe, true);
assert.equal(verificationProbeDefaults.refreshList, true);
assert.equal(verificationProbeDefaults.fetchNewDetails, false);
assert.equal(verificationProbeDefaults.pageWarmupMinMs, 1500);
assert.equal(verificationProbeDefaults.pageWarmupMaxMs, 3000);
assert.equal(verificationProbeDefaults.pageDelayMinMs, 3000);
assert.equal(verificationProbeDefaults.pageDelayMaxMs, 6000);
assert.equal(verificationProbeDefaults.pageBatchSize, 30);
assert.equal(
  verificationProbeDefaults.pageBatchCooldownMinMs,
  30000
);
assert.equal(
  verificationProbeDefaults.pageBatchCooldownMaxMs,
  60000
);
const shortVerificationProbeDefaults = parseRunnerOptions([
  "--mode=verification-probe",
  "--max-pages=10",
]);
assert.equal(shortVerificationProbeDefaults.pageWarmupMinMs, 1500);
assert.equal(shortVerificationProbeDefaults.pageWarmupMaxMs, 3000);
assert.equal(shortVerificationProbeDefaults.pageDelayMinMs, 3000);
assert.equal(shortVerificationProbeDefaults.pageDelayMaxMs, 6000);

const detailProbeDefaults = parseRunnerOptions([
  "--mode=detail-probe",
]);
assert.equal(detailProbeDefaults.mode, "detail-probe");
assert.equal(detailProbeDefaults.detailProbe, true);
assert.equal(detailProbeDefaults.fetchNewDetails, false);
assert.equal(detailProbeDefaults.detailProbeMax, 5);
assert.equal(detailProbeDefaults.detailWarmupMinMs, 2000);
assert.equal(detailProbeDefaults.detailWarmupMaxMs, 4000);
assert.equal(detailProbeDefaults.detailDelayMinMs, 5000);
assert.equal(detailProbeDefaults.detailDelayMaxMs, 10000);
assert.equal(detailProbeDefaults.detailBatchSize, 5);
assert.equal(detailProbeDefaults.detailBatchCooldownMinMs, 30000);
assert.equal(detailProbeDefaults.detailBatchCooldownMaxMs, 60000);

const dailyProductionProducts = [
  { sourceProductId: "100", inventoryStatus: "available" },
  { sourceProductId: "101", inventoryStatus: "available" },
  { sourceProductId: "102", inventoryStatus: "available" },
  { sourceProductId: "103", inventoryStatus: "available" },
];
const dailyCurrentPayload = {
  summary: {
    pagesScanned: 107,
    expectedPages: 107,
    fullExpectedRangeScanned: true,
    captchaDetected: false,
  },
  products: [
    { sourceProductId: "100", price: "$100.00", rawListStatus: "" },
    {
      sourceProductId: "101",
      price: "",
      rawListStatus: "OUT OF STOCK",
      rawText: "OUT OF STOCK",
    },
    { sourceProductId: "103", price: "", rawListStatus: "" },
    { sourceProductId: "200", price: "$200.00", rawListStatus: "" },
    { sourceProductId: "201", price: "$201.00", rawListStatus: "" },
  ],
};
const dailyDiff = buildSmokingpipesDailyDiff({
  productionProducts: dailyProductionProducts,
  currentPayload: dailyCurrentPayload,
  expectedPages: 107,
});
assert.deepEqual(dailyDiff.dailyNewIds, ["200", "201"]);
assert.deepEqual(dailyDiff.newIds, ["200", "201"]);
assert.deepEqual(dailyDiff.stillAvailableIds, ["100", "103"]);
assert.deepEqual(dailyDiff.newlySoldOutIds, ["101"]);
assert.deepEqual(dailyDiff.disappearedIds, ["102"]);
assert.deepEqual(dailyDiff.missingPriceButNotSoldIds, ["103"]);
assert.equal(dailyDiff.allowCandidateGeneration, true);

const incompleteDailyDiff = buildSmokingpipesDailyDiff({
  productionProducts: dailyProductionProducts,
  currentPayload: {
    ...dailyCurrentPayload,
    summary: {
      ...dailyCurrentPayload.summary,
      pagesScanned: 3,
      fullExpectedRangeScanned: false,
    },
  },
  expectedPages: 107,
});
assert.equal(incompleteDailyDiff.allowCandidateGeneration, false);
assert.match(
  incompleteDailyDiff.fatalWarnings.join("\n"),
  /full|107|incomplete/i
);

const captchaCurrentPayload = {
  ...dailyCurrentPayload,
  generatedAt: "2026-06-22T08:47:47.800Z",
  summary: {
    ...dailyCurrentPayload.summary,
    captchaDetected: true,
    captchaPages: [73],
  },
};
const captchaDailyDiff = buildSmokingpipesDailyDiff({
  productionProducts: dailyProductionProducts,
  currentPayload: captchaCurrentPayload,
  expectedPages: 107,
});
assert.equal(captchaDailyDiff.coverage.fullExpectedRangeScanned, true);
assert.equal(captchaDailyDiff.coverage.captchaDetected, true);
assert.equal(captchaDailyDiff.allowApply, false);
assert.equal(captchaDailyDiff.allowCandidateGeneration, false);
assert.match(
  captchaDailyDiff.fatalWarnings.join("\n"),
  /captcha\/currentListVerificationDetected/
);
assert.equal(
  evaluateSmokingpipesDailyGenerationGate({
    dailyDiff: captchaDailyDiff,
    queue: { items: [] },
  }).status,
  "blocked",
  "verification must remain blocked even with complete page coverage"
);
assert.equal(shouldPrepareDailyDetailsQueue(captchaDailyDiff), false);

const captchaInventoryDiff = buildInventoryDiff(
  captchaCurrentPayload,
  dailyProductionProducts
);
assert.equal(captchaInventoryDiff.coverage.fullExpectedRangeScanned, true);
assert.equal(captchaInventoryDiff.coverage.captchaDetected, true);
assert.equal(captchaInventoryDiff.allowApply, false);
assert.match(
  captchaInventoryDiff.fatalWarnings.join("\n"),
  /captcha\/currentListVerificationDetected/
);
assert.match(
  captchaInventoryDiff.applyBlockedReasons.join("\n"),
  /verification/i
);

const untrustedQueue = {
  version: "smokingpipes-new-details-queue-v1",
  source: "smokingpipes",
  createdAt: "2026-06-22T08:47:48.428Z",
  updatedAt: "2026-06-22T08:47:48.430Z",
  diffGeneratedAt: "2026-06-22T08:47:47.855Z",
  items: [
    { sourceProductId: "200", status: "pending", active: true },
    { sourceProductId: "201", status: "pending", active: true },
  ],
};
const invalidatedQueue = invalidateUntrustedDailyQueue({
  queue: untrustedQueue,
  currentPayload: captchaCurrentPayload,
  now: "2026-06-22T09:00:00.000Z",
});
assert.equal(invalidatedQueue.invalidated, true);
assert.equal(invalidatedQueue.invalidatedCount, 2);
assert.match(invalidatedQueue.reason, /captchaDetected=true/i);
assert.equal(
  invalidatedQueue.queue.items.every(
    (item) => item.status === "superseded" && item.active === false
  ),
  true
);
assert.equal(invalidatedQueue.queue.summary.remaining, 0);

const dailyQueueOnlyNew = buildDetailsQueue({
  existingQueue: null,
  diff: dailyDiff,
  currentProducts: dailyCurrentPayload.products,
  existingProductIds: new Set(
    dailyProductionProducts.map((item) => item.sourceProductId)
  ),
});
assert.deepEqual(
  dailyQueueOnlyNew.items
    .filter((item) => item.active !== false)
    .map((item) => item.sourceProductId),
  ["200", "201"],
  "daily queue must contain only production-missing dailyNewIds"
);

assert.equal(
  evaluateSmokingpipesDailyGenerationGate({
    dailyDiff,
    queue: dailyQueueOnlyNew,
  }).allowGenerate,
  false
);
const completedDailyQueue = {
  ...dailyQueueOnlyNew,
  items: dailyQueueOnlyNew.items.map((item) => ({
    ...item,
    status: "completed",
    detail: {
      sourceProductId: item.sourceProductId,
      sourceUrl: `https://example/${item.sourceProductId}`,
      title: item.title || `Daily ${item.sourceProductId}`,
    },
  })),
};
assert.equal(
  evaluateSmokingpipesDailyGenerationGate({
    dailyDiff,
    queue: completedDailyQueue,
  }).allowGenerate,
  true
);

const atomicRetryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "inventory-atomic-retry-test-")
);
const transientAtomicTarget = path.join(
  atomicRetryRoot,
  "transient-queue.json"
);
let transientRenameAttempts = 0;
await runnerCore.writeJsonAtomic(
  transientAtomicTarget,
  { status: "completed" },
  {
    rename: async (tempPath, targetPath) => {
      transientRenameAttempts += 1;
      if (transientRenameAttempts === 1) {
        throw Object.assign(new Error("mock target lock"), {
          code: "EPERM",
        });
      }
      await fs.promises.rename(tempPath, targetPath);
    },
    sleep: async () => {},
    random: () => 0,
  }
);
assert.equal(transientRenameAttempts, 2);
assert.deepEqual(
  JSON.parse(fs.readFileSync(transientAtomicTarget, "utf8")),
  { status: "completed" }
);

const permanentAtomicTarget = path.join(
  atomicRetryRoot,
  "permanent-queue.json"
);
let permanentRenameAttempts = 0;
let permanentAtomicError = null;
try {
  await runnerCore.writeJsonAtomic(
    permanentAtomicTarget,
    { status: "completed" },
    {
      maxRenameAttempts: 20,
      rename: async () => {
        permanentRenameAttempts += 1;
        throw Object.assign(new Error("mock permanent target lock"), {
          code: "EPERM",
        });
      },
      sleep: async () => {},
      random: () => 0,
    }
  );
} catch (error) {
  permanentAtomicError = error;
}
assert.equal(permanentRenameAttempts, 20);
assert.match(
  permanentAtomicError?.message || "",
  /checkpoint failed after retries/i
);
assert.equal(permanentAtomicError?.attempts, 20);
assert.equal(permanentAtomicError?.targetPath, permanentAtomicTarget);
assert.equal(permanentAtomicError?.lastError?.code, "EPERM");
assert.equal(
  fs.existsSync(permanentAtomicError?.tempPath || ""),
  true,
  "permanent rename failure must preserve the updated temp file"
);

const applyDryRunDefaults = parseRunnerOptions(["--mode=apply-dry-run"]);
assert.equal(
  applyDryRunDefaults.refreshList,
  false,
  "apply-dry-run must reuse existing inventory artifacts by default"
);
const applyDryRunWithRefresh = parseRunnerOptions([
  "--mode=apply-dry-run",
  "--refresh-list",
]);
assert.equal(applyDryRunWithRefresh.refreshList, true);

const catchUpDefaults = parseRunnerOptions([
  "--mode=apply-dry-run",
  "--catch-up-current",
]);
assert.equal(catchUpDefaults.catchUpCurrent, true);
assert.equal(catchUpDefaults.detailMaxPerRun, 50);
assert.equal(catchUpDefaults.detailWarmupMinMs, 1000);
assert.equal(catchUpDefaults.detailWarmupMaxMs, 3000);
assert.equal(catchUpDefaults.detailDelayMinMs, 3000);
assert.equal(catchUpDefaults.detailDelayMaxMs, 8000);
assert.equal(catchUpDefaults.detailBatchSize, 50);
assert.equal(catchUpDefaults.detailBatchCooldownMinMs, 0);
assert.equal(catchUpDefaults.detailBatchCooldownMaxMs, 0);
assert.equal(catchUpDefaults.autoRepeatCatchUp, false);
assert.equal(catchUpDefaults.catchUpRepeatMaxCycles, 1);
assert.equal(catchUpDefaults.catchUpRepeatDelayMinMs, 300000);
assert.equal(catchUpDefaults.catchUpRepeatDelayMaxMs, 600000);
assert.equal(catchUpDefaults.catchUpMaxTotalDetails, 200);
assert.equal(catchUpDefaults.catchUpMaxRuntimeMinutes, 90);

const catchUpOverrides = parseRunnerOptions([
  "--mode=apply-dry-run",
  "--baseline-catch-up",
  "--auto-repeat-catch-up",
  "--catch-up-repeat-max-cycles=4",
  "--catch-up-repeat-delay-min-ms=10",
  "--catch-up-repeat-delay-max-ms=20",
  "--catch-up-max-total-details=250",
  "--catch-up-max-runtime-minutes=30",
  "--detail-max-per-run=5",
  "--detail-batch-size=4",
]);
assert.equal(catchUpOverrides.catchUpCurrent, true);
assert.equal(catchUpOverrides.autoRepeatCatchUp, true);
assert.equal(catchUpOverrides.catchUpRepeatMaxCycles, 4);
assert.equal(catchUpOverrides.catchUpRepeatDelayMinMs, 10);
assert.equal(catchUpOverrides.catchUpRepeatDelayMaxMs, 20);
assert.equal(catchUpOverrides.catchUpMaxTotalDetails, 250);
assert.equal(catchUpOverrides.catchUpMaxRuntimeMinutes, 30);
assert.equal(catchUpOverrides.detailMaxPerRun, 5);
assert.equal(catchUpOverrides.detailBatchSize, 4);
assert.throws(
  () => parseRunnerOptions(["--catch-up-current"]),
  /apply-dry-run/i
);
assert.throws(
  () =>
    parseRunnerOptions([
      "--mode=apply-dry-run",
      "--auto-repeat-catch-up",
    ]),
  /catch-up-current/i
);

assert.equal(
  typeof runnerCore.resolveInventoryInputStrategy,
  "function",
  "runner core must expose an inventory input strategy"
);
assert.deepEqual(
  runnerCore.resolveInventoryInputStrategy({
    mode: "apply-dry-run",
    refreshList: false,
  }),
  { refreshList: false, useExistingArtifacts: true }
);
assert.deepEqual(
  runnerCore.resolveInventoryInputStrategy({
    mode: "apply-dry-run",
    refreshList: true,
  }),
  { refreshList: true, useExistingArtifacts: false }
);
assert.deepEqual(
  runnerCore.resolveInventoryInputStrategy({
    mode: "dry-run",
    refreshList: false,
  }),
  { refreshList: true, useExistingArtifacts: false }
);

const reusableCurrent = {
  generatedAt: "2026-06-21T13:52:09.509Z",
  completedAt: "2026-06-21T13:52:09.509Z",
  config: { expectedPages: 107 },
  products: Array.from({ length: 3 }, (_, index) => ({
    sourceProductId: String(index + 1),
  })),
  summary: {
    pagesScanned: 107,
    expectedPages: 107,
    productsExtracted: 3,
    uniqueProducts: 3,
    duplicateSourceProductIds: [],
    captchaDetected: false,
    fullExpectedRangeScanned: true,
  },
};
const reusableDiff = {
  generatedAt: "2026-06-21T13:52:10.536Z",
  coverage: {
    pagesScanned: 107,
    expectedPages: 107,
    fullExpectedRangeScanned: true,
  },
  counts: { currentAvailable: 3, new: 2 },
  newIds: ["1", "2"],
  stillAvailableIds: ["3"],
  disappearedIds: [],
  fatalWarnings: [],
  allowApply: true,
};
assert.equal(
  typeof runnerCore.validateReusableInventoryArtifacts,
  "function",
  "runner core must validate reusable current-list and diff artifacts"
);
const reusableValidation = runnerCore.validateReusableInventoryArtifacts({
  current: reusableCurrent,
  diff: reusableDiff,
  expectedPages: 107,
});
assert.equal(reusableValidation.status, "passed");
assert.equal(reusableValidation.allowApply, true);
assert.match(
  reusableValidation.warnings.join("\n"),
  /runId.*cannot be strongly verified/i
);
const missingReusableDiff = runnerCore.validateReusableInventoryArtifacts({
  current: reusableCurrent,
  diff: null,
  expectedPages: 107,
});
assert.equal(missingReusableDiff.status, "blocked");
assert.match(
  missingReusableDiff.errors.join("\n"),
  /inventory diff.*missing/i
);
const incompleteReusableCurrent =
  runnerCore.validateReusableInventoryArtifacts({
    current: {
      ...reusableCurrent,
      summary: {
        ...reusableCurrent.summary,
        pagesScanned: 106,
        fullExpectedRangeScanned: false,
      },
    },
    diff: {
      ...reusableDiff,
      allowApply: false,
      coverage: {
        ...reusableDiff.coverage,
        pagesScanned: 106,
        fullExpectedRangeScanned: false,
      },
    },
    expectedPages: 107,
  });
assert.equal(incompleteReusableCurrent.status, "blocked");
assert.match(
  incompleteReusableCurrent.errors.join("\n"),
  /full expected page range|107 expected pages/i
);
const invalidReusableClassification = runnerCore.classifyRunnerError(
  Object.assign(
    new Error(
      "Existing inventory artifacts are invalid; run a complete list-only dry-run first."
    ),
    { code: "INVALID_EXISTING_DRY_RUN" }
  )
);
assert.equal(invalidReusableClassification.status, "blocked");
assert.equal(invalidReusableClassification.manualActionRequired, true);

const edgeBrowser = parseRunnerOptions(["--browser-channel=msedge"]);
assert.equal(edgeBrowser.browserChannel, "msedge");
const chromeDefaultProfile = parseRunnerOptions([
  "--browser-channel=chrome",
]);
assert.equal(chromeDefaultProfile.browserProfile, null);
assert.equal(chromeDefaultProfile.browserProfileDir, null);
const chromeNamedProfile = parseRunnerOptions([
  "--browser-channel=chrome",
  "--browser-profile=sp-chrome",
]);
assert.equal(chromeNamedProfile.browserProfile, "sp-chrome");
const chromeExplicitProfile = parseRunnerOptions([
  "--browser-channel=chrome",
  "--browser-profile-dir=C:\\temp\\sp-profile",
]);
assert.equal(
  chromeExplicitProfile.browserProfileDir,
  path.resolve("C:\\temp\\sp-profile")
);
assert.equal(
  parseRunnerOptions(["--mode=browser-preflight"]).mode,
  "browser-preflight"
);
assert.throws(
  () =>
    parseRunnerOptions([
      "--browser-channel=chrome",
      "--browser-profile=daily-default",
    ]),
  /browser profile/i
);
assert.deepEqual(resolveSmokingpipesBrowserLaunch("msedge", ""), {
  explicit: true,
  candidates: ["msedge"],
});
assert.deepEqual(resolveSmokingpipesBrowserLaunch("chromium", "msedge"), {
  explicit: true,
  candidates: [""],
});
assert.deepEqual(resolveSmokingpipesBrowserLaunch(null, "msedge"), {
  explicit: false,
  candidates: ["msedge", "", "chrome"],
});
assert.throws(
  () => parseRunnerOptions(["--browser-channel=firefox"]),
  /browser channel/i
);
const profileTestRoot = path.join("C:\\workspace", "pipewebsite");
const profileLocalAppData = "C:\\Users\\Test\\AppData\\Local";
const explicitResolvedProfile = resolveSmokingpipesBrowserProfile({
  root: profileTestRoot,
  browserChannel: "chrome",
  browserProfile: "sp-chrome",
  browserProfileDir: "C:\\profiles\\explicit-sp",
  localAppData: profileLocalAppData,
  platform: "win32",
});
assert.equal(explicitResolvedProfile.profileSource, "explicit-dir");
assert.equal(
  explicitResolvedProfile.profileDir,
  path.resolve("C:\\profiles\\explicit-sp")
);
const namedResolvedProfile = resolveSmokingpipesBrowserProfile({
  root: profileTestRoot,
  browserProfile: "sp-chrome",
  localAppData: profileLocalAppData,
  platform: "win32",
});
assert.equal(namedResolvedProfile.effectiveBrowserChannel, "chrome");
assert.equal(namedResolvedProfile.profileSource, "named-sp-chrome");
assert.equal(
  namedResolvedProfile.profileDir,
  path.join(
    profileLocalAppData,
    "YandouBuy",
    "chrome-profile-sp"
  )
);
const defaultChromeResolvedProfile =
  resolveSmokingpipesBrowserProfile({
    root: profileTestRoot,
    browserChannel: "chrome",
    localAppData: profileLocalAppData,
    platform: "win32",
  });
assert.equal(
  defaultChromeResolvedProfile.profileSource,
  "default-chrome-sp"
);
const legacyEdgeResolvedProfile =
  resolveSmokingpipesBrowserProfile({
    root: profileTestRoot,
    browserChannel: "msedge",
    localAppData: profileLocalAppData,
    platform: "win32",
  });
assert.equal(
  legacyEdgeResolvedProfile.profileDir,
  path.join(profileTestRoot, ".cache", "smokingpipes-profile")
);
assert.equal(
  legacyEdgeResolvedProfile.profileSource,
  "legacy-project-cache"
);
for (const unsafeProfileDir of [
  path.join(
    profileLocalAppData,
    "Google",
    "Chrome",
    "User Data"
  ),
  path.join(
    profileLocalAppData,
    "Google",
    "Chrome",
    "User Data",
    "Default"
  ),
  path.join(
    profileLocalAppData,
    "Google",
    "Chrome",
    "User Data",
    "Profile 1"
  ),
]) {
  assert.throws(
    () =>
      resolveSmokingpipesBrowserProfile({
        root: profileTestRoot,
        browserChannel: "chrome",
        browserProfileDir: unsafeProfileDir,
        localAppData: profileLocalAppData,
        platform: "win32",
      }),
    /daily Chrome profile/i
  );
}
const chromeBrowserDescriptor = buildSmokingpipesBrowserDescriptor({
  root: profileTestRoot,
  browserChannel: "chrome",
  localAppData: profileLocalAppData,
  platform: "win32",
});
assert.equal(
  chromeBrowserDescriptor.requestedBrowserChannel,
  "chrome"
);
assert.equal(
  chromeBrowserDescriptor.effectiveBrowserChannel,
  "chrome"
);
assert.equal(chromeBrowserDescriptor.persistentContext, true);
assert.equal(chromeBrowserDescriptor.headless, false);
assert.equal(
  chromeBrowserDescriptor.profileSource,
  "default-chrome-sp"
);
assert.equal("proxy" in chromeBrowserDescriptor, false);
assert.equal("stealth" in chromeBrowserDescriptor, false);
assert.equal("fingerprint" in chromeBrowserDescriptor, false);
const launchCapture = {};
const fakePersistentContext = {
  browser() {
    return {
      executablePath() {
        return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
      },
    };
  },
  async close() {},
};
const launchLocalAppData = fs.mkdtempSync(
  path.join(os.tmpdir(), "inventory-browser-launch-")
);
const launchedChromeSession = await launchSmokingpipesContext({
  root: launchLocalAppData,
  browserChannel: "chrome",
  localAppData: launchLocalAppData,
  platform: "win32",
  profileLockPath: path.join(
    os.tmpdir(),
    `smokingpipes-browser-launch-${process.pid}-${Date.now()}.lock`
  ),
  runId: "launch-test",
  mode: "browser-preflight",
  launchPersistentContext: async (userDataDir, launchOptions) => {
    launchCapture.userDataDir = userDataDir;
    launchCapture.launchOptions = launchOptions;
    return fakePersistentContext;
  },
});
assert.equal(
  launchCapture.userDataDir,
  path.join(
    launchLocalAppData,
    "YandouBuy",
    "chrome-profile-sp"
  )
);
assert.equal(launchCapture.launchOptions.channel, "chrome");
assert.equal(launchCapture.launchOptions.headless, false);
assert.equal(launchedChromeSession.context, fakePersistentContext);
assert.equal(
  launchedChromeSession.browser.requestedBrowserChannel,
  "chrome"
);
assert.equal(
  launchedChromeSession.browser.effectiveBrowserChannel,
  "chrome"
);
assert.equal(
  launchedChromeSession.browser.executablePath,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
);
assert.equal(
  launchedChromeSession.browser.persistentContext,
  true
);
await launchedChromeSession.close();

let recoveryClock = 0;
let recoveryDetectionCalls = 0;
const recoveryPage = {
  async bringToFront() {},
  async waitForTimeout() {
    recoveryClock += 5;
  },
  url() {
    return "https://example.invalid/recovered";
  },
};
const recoveredManualVerification =
  await waitForSmokingpipesManualRecovery(recoveryPage, {
    pageKind: "list",
    timeoutMs: 20,
    pollMs: 5,
    nowMs: () => recoveryClock,
    detectVerification: async () => {
      recoveryDetectionCalls += 1;
      return {
        verificationBlocked: recoveryDetectionCalls === 1,
      };
    },
    verifyNormalContent: async () => ({
      valid: true,
      parsedValue: [{ sourceProductId: "100" }],
    }),
    verbose: false,
  });
assert.equal(recoveredManualVerification.recovered, true);
assert.equal(
  recoveredManualVerification.manualVerificationRecovered,
  true
);
assert.equal(
  recoveredManualVerification.parsedValue[0].sourceProductId,
  "100"
);

recoveryClock = 0;
const unrecoveredManualVerification =
  await waitForSmokingpipesManualRecovery(recoveryPage, {
    pageKind: "detail",
    timeoutMs: 10,
    pollMs: 5,
    nowMs: () => recoveryClock,
    detectVerification: async () => ({
      verificationBlocked: false,
    }),
    verifyNormalContent: async () => ({
      valid: false,
      parsedValue: { sourceProductId: "wrong-id" },
    }),
    verbose: false,
  });
assert.equal(unrecoveredManualVerification.recovered, false);
assert.equal(unrecoveredManualVerification.timedOut, true);
assert.equal(
  unrecoveredManualVerification.manualVerificationRecovered,
  false
);
assert.equal(
  isNormalSmokingpipesDetail(
    { sourceProductId: "100" },
    "100"
  ),
  false
);
assert.equal(
  isNormalSmokingpipesDetail(
    {
      sourceProductId: "100",
      fullTitle: "Savinelli: Billiard",
      mainImageUrl: "https://example.invalid/pipe.jpg",
      specsText: ["Shape: Billiard"],
    },
    "100"
  ),
  true
);
assert.equal(
  isNormalSmokingpipesDetail(
    {
      sourceProductId: "101",
      fullTitle: "Wrong pipe",
      mainImageUrl: "https://example.invalid/pipe.jpg",
      specsText: ["Shape: Billiard"],
    },
    "100"
  ),
  false
);

const browserProfileLockRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "inventory-browser-profile-lock-")
);
const browserProfileLockPath = path.join(
  browserProfileLockRoot,
  "smokingpipes-chrome-profile.lock"
);
const browserProfileLock = acquireBrowserProfileLock(
  browserProfileLockPath,
  {
    runId: "browser-profile-first",
    profileDir: defaultChromeResolvedProfile.profileDir,
    mode: "browser-preflight",
  },
  { isProcessAlive: () => true }
);
assert.equal(browserProfileLock.staleLockRecovered, false);
assert.throws(
  () =>
    acquireBrowserProfileLock(
      browserProfileLockPath,
      {
        runId: "browser-profile-second",
        profileDir: defaultChromeResolvedProfile.profileDir,
        mode: "detail-probe",
      },
      { isProcessAlive: () => true }
    ),
  /profile.*already in use/i
);
releaseBrowserProfileLock(browserProfileLock);
fs.writeFileSync(
  browserProfileLockPath,
  JSON.stringify({
    runId: "stale",
    pid: 999999,
    profileDir: defaultChromeResolvedProfile.profileDir,
  })
);
const recoveredBrowserProfileLock = acquireBrowserProfileLock(
  browserProfileLockPath,
  {
    runId: "browser-profile-recovered",
    profileDir: defaultChromeResolvedProfile.profileDir,
    mode: "browser-preflight",
  },
  { isProcessAlive: () => false }
);
assert.equal(
  recoveredBrowserProfileLock.staleLockRecovered,
  true
);
releaseBrowserProfileLock(recoveredBrowserProfileLock);
fs.writeFileSync(browserProfileLockPath, "{invalid-json");
assert.throws(
  () =>
    acquireBrowserProfileLock(
      browserProfileLockPath,
      {
        runId: "browser-profile-malformed",
        profileDir: defaultChromeResolvedProfile.profileDir,
        mode: "browser-preflight",
      },
      { isProcessAlive: () => false }
    ),
  /unreadable.*profile lock/i
);
assert.equal(fs.existsSync(browserProfileLockPath), true);
fs.unlinkSync(browserProfileLockPath);
assert.equal(defaults.pageDelayMinMs, 8000);
assert.equal(defaults.pageDelayMaxMs, 18000);
assert.equal(defaults.pageWarmupMinMs, 3000);
assert.equal(defaults.pageWarmupMaxMs, 7000);
assert.equal(defaults.captchaCooldownMs, 60000);

const customPacing = parseRunnerOptions([
  "--page-delay-min-ms=12000",
  "--page-delay-max-ms=28000",
  "--page-warmup-min-ms=5000",
  "--page-warmup-max-ms=12000",
  "--captcha-cooldown-ms=120000",
]);
assert.equal(customPacing.pageDelayMinMs, 12000);
assert.equal(customPacing.pageDelayMaxMs, 28000);
assert.equal(customPacing.pageWarmupMinMs, 5000);
assert.equal(customPacing.pageWarmupMaxMs, 12000);
assert.equal(customPacing.captchaCooldownMs, 120000);

const dailyCustomListPacing = parseRunnerOptions([
  "--mode=daily-update",
  "--page-warmup-min-ms=300",
  "--page-warmup-max-ms=1000",
  "--page-delay-min-ms=500",
  "--page-delay-max-ms=1500",
  "--page-batch-size=40",
  "--page-batch-cooldown-min-ms=10000",
  "--page-batch-cooldown-max-ms=20000",
]);
assert.equal(dailyCustomListPacing.pageWarmupMinMs, 1500);
assert.equal(dailyCustomListPacing.pageWarmupMaxMs, 3000);
assert.equal(dailyCustomListPacing.pageDelayMinMs, 3000);
assert.equal(dailyCustomListPacing.pageDelayMaxMs, 6000);
assert.equal(dailyCustomListPacing.pageBatchSize, 30);
assert.equal(dailyCustomListPacing.pageBatchCooldownMinMs, 30000);
assert.equal(dailyCustomListPacing.pageBatchCooldownMaxMs, 60000);
assert.equal(dailyCustomListPacing.pacingDowngraded, true);
assert.equal(
  dailyCustomListPacing.detailDelayMinMs,
  3000,
  "list pacing overrides must not change detail pacing"
);

const customDetailPacing = parseRunnerOptions([
  "--fetch-new-details",
  "--allow-partial-new-details",
  "--max-new-details-per-run=8",
  "--detail-max-per-run=5",
  "--detail-warmup-min-ms=8000",
  "--detail-warmup-max-ms=15000",
  "--detail-delay-min-ms=20000",
  "--detail-delay-max-ms=45000",
  "--detail-batch-size=4",
  "--detail-batch-cooldown-min-ms=120000",
  "--detail-batch-cooldown-max-ms=240000",
]);
assert.equal(customDetailPacing.fetchNewDetails, true);
assert.equal(customDetailPacing.allowPartialNewDetails, true);
assert.equal(customDetailPacing.detailMaxPerRun, 5);
assert.equal(customDetailPacing.detailWarmupMinMs, 8000);
assert.equal(customDetailPacing.detailWarmupMaxMs, 15000);
assert.equal(customDetailPacing.detailDelayMinMs, 20000);
assert.equal(customDetailPacing.detailDelayMaxMs, 45000);
assert.equal(customDetailPacing.detailBatchSize, 4);
assert.equal(customDetailPacing.detailBatchCooldownMinMs, 120000);
assert.equal(customDetailPacing.detailBatchCooldownMaxMs, 240000);

assert.deepEqual(
  shouldFetchNewDetails({
    fetchNewDetails: false,
    allowPartialNewDetails: false,
    fullExpectedRangeScanned: false,
  }),
  { allowed: false, reason: "new detail fetching was not requested" }
);
assert.deepEqual(
  shouldFetchNewDetails({
    fetchNewDetails: true,
    allowPartialNewDetails: false,
    fullExpectedRangeScanned: false,
  }),
  {
    allowed: false,
    reason:
      "partial scan details are blocked; use --allow-partial-new-details explicitly",
  }
);
assert.equal(
  shouldFetchNewDetails({
    fetchNewDetails: true,
    allowPartialNewDetails: true,
    fullExpectedRangeScanned: false,
  }).allowed,
  true
);
assert.equal(
  shouldFetchNewDetails({
    fetchNewDetails: true,
    allowPartialNewDetails: false,
    fullExpectedRangeScanned: true,
  }).allowed,
  true
);

const normalizedPacing = resolveListPacingOptions({
  pageDelayMinMs: 18000,
  pageDelayMaxMs: 8000,
  pageWarmupMinMs: 7000,
  pageWarmupMaxMs: 3000,
  captchaCooldownMs: 0,
});
assert.deepEqual(normalizedPacing, {
  pageDelayMinMs: 18000,
  pageDelayMaxMs: 18000,
  pageWarmupMinMs: 7000,
  pageWarmupMaxMs: 7000,
  pageBatchSize: 0,
  pageBatchCooldownMinMs: 0,
  pageBatchCooldownMaxMs: 0,
  captchaCooldownMs: 0,
});
assert.equal(
  shouldApplyPageBatchCooldown({
    pageNumber: 29,
    maxPages: 107,
    pageBatchSize: 30,
  }),
  false
);
assert.equal(
  shouldApplyPageBatchCooldown({
    pageNumber: 30,
    maxPages: 107,
    pageBatchSize: 30,
  }),
  true
);
assert.equal(
  shouldApplyPageBatchCooldown({
    pageNumber: 60,
    maxPages: 107,
    pageBatchSize: 30,
  }),
  true
);
assert.equal(
  shouldApplyPageBatchCooldown({
    pageNumber: 107,
    maxPages: 107,
    pageBatchSize: 30,
  }),
  false,
  "the final page must not trigger a cooldown"
);
assert.equal(
  shouldApplyPageBatchCooldown({
    pageNumber: 30,
    maxPages: 107,
    pageBatchSize: 0,
  }),
  false,
  "page batch cooldown is disabled when the batch size is zero"
);
const zeroPageBatchCooldown = resolveListPacingOptions({
  pageBatchSize: 30,
  pageBatchCooldownMinMs: 0,
  pageBatchCooldownMaxMs: 0,
});
assert.equal(zeroPageBatchCooldown.pageBatchSize, 30);
assert.equal(
  randomDelayMs(
    zeroPageBatchCooldown.pageBatchCooldownMinMs,
    zeroPageBatchCooldown.pageBatchCooldownMaxMs
  ),
  0,
  "a zero-duration page batch cooldown must not wait"
);
assert.equal(randomDelayMs(8000, 18000, () => 0), 8000);
assert.equal(randomDelayMs(8000, 18000, () => 1), 18000);

const normalOutOfStockPage = classifySmokingpipesVerificationSignals({
  pageKind: "list",
  httpStatus: 200,
  url: "https://www.smokingpipes.com/pipes/?page=107",
  title: "Smokingpipes | New Pipes",
  bodyText:
    "New Pipes OUT OF STOCK Sold Out Some products have no displayed price.",
  productLinkCount: 48,
  explicitChallengeElement: false,
});
assert.equal(normalOutOfStockPage.verificationBlocked, false);
assert.equal(normalOutOfStockPage.classification, "normal-content");
assert.deepEqual(normalOutOfStockPage.weakVerificationSignals, []);
assert.deepEqual(normalOutOfStockPage.strongVerificationSignals, []);

const weakKeywordWithProducts = classifySmokingpipesVerificationSignals({
  pageKind: "list",
  httpStatus: 200,
  url: "https://www.smokingpipes.com/pipes/?page=73",
  title: "Smokingpipes | New Pipes",
  bodyText:
    "Verification information appears in footer help text. Normal products.",
  productLinkCount: 48,
  explicitChallengeElement: false,
});
assert.equal(weakKeywordWithProducts.verificationBlocked, false);
assert.equal(
  weakKeywordWithProducts.classification,
  "normal-content-with-verification-warning"
);
assert.equal(weakKeywordWithProducts.weakVerificationSignals.length > 0, true);
assert.deepEqual(weakKeywordWithProducts.strongVerificationSignals, []);

const allMissingPricePage = classifySmokingpipesVerificationSignals({
  pageKind: "list",
  httpStatus: 503,
  url: "https://www.smokingpipes.com/pipes/?page=106",
  title: "Smokingpipes | New Pipes",
  bodyText: "OUT OF STOCK ".repeat(48),
  productLinkCount: 48,
  explicitChallengeElement: false,
});
assert.equal(
  allMissingPricePage.verificationBlocked,
  false,
  "product cards must override generic status or missing-price signals"
);

const explicitChallengePage = classifySmokingpipesVerificationSignals({
  pageKind: "list",
  httpStatus: 403,
  url: "https://www.smokingpipes.com/cdn-cgi/challenge-platform/",
  title: "Just a moment...",
  bodyText: "Verify you are human. Security check in progress.",
  productLinkCount: 0,
  explicitChallengeElement: true,
});
assert.equal(explicitChallengePage.verificationBlocked, true);
assert.equal(explicitChallengePage.classification, "strong-verification");
assert.equal(explicitChallengePage.strongVerificationSignals.length > 0, true);

const emptyListPage = classifySmokingpipesVerificationSignals({
  pageKind: "list",
  httpStatus: 200,
  url: "https://www.smokingpipes.com/pipes/?page=107",
  title: "Smokingpipes | New Pipes",
  bodyText: "No products were returned.",
  productLinkCount: 0,
  explicitChallengeElement: false,
});
assert.equal(emptyListPage.verificationBlocked, false);
assert.equal(emptyListPage.classification, "empty-or-parse-failure");

const latePageFixture = Array.from({ length: 48 }, (_, index) => ({
  sourceProductId: String(800000 + index),
  price: index < 30 ? "" : `$${100 + index}.00`,
  rawText:
    index < 24
      ? `Pipe ${index + 1} OUT OF STOCK`
      : `Pipe ${index + 1}`,
}));
const latePageSummary = summarizeSmokingpipesListProducts(latePageFixture);
assert.deepEqual(latePageSummary, {
  productCount: 48,
  outOfStockCount: 24,
  missingPriceCount: 30,
});
const latePageDetection = classifySmokingpipesVerificationSignals({
  pageKind: "list",
  httpStatus: 200,
  url: "https://www.smokingpipes.com/pipes/?page=104",
  title: "Smokingpipes | New Pipes",
  bodyText: latePageFixture.map((item) => item.rawText).join("\n"),
  productLinkCount: latePageSummary.productCount,
  explicitChallengeElement: false,
});
assert.equal(latePageDetection.verificationBlocked, false);
assert.deepEqual(latePageDetection.strongVerificationSignals, []);

const probeTelemetry = buildVerificationProbeTelemetry({
  runId: "probe-mock-1",
  mode: "verification-probe",
  startedAt: "2026-06-22T00:00:00.000Z",
  endedAt: "2026-06-22T00:06:00.000Z",
  pagesRequested: 107,
  pacing: {
    pageWarmupMinMs: 1500,
    pageWarmupMaxMs: 3000,
    pageDelayMinMs: 3000,
    pageDelayMaxMs: 6000,
    pageBatchSize: 30,
    pageBatchCooldownMinMs: 30000,
    pageBatchCooldownMaxMs: 60000,
  },
  pages: [
    {
      page: 1,
      url: "https://example.invalid/page=1",
      startedAt: "2026-06-22T00:00:00.000Z",
      endedAt: "2026-06-22T00:00:04.000Z",
      durationMs: 4000,
      warmupMs: 1500,
      delayMs: 2500,
      productsParsed: 48,
      outOfStockProducts: 0,
      missingPriceProducts: 0,
      weakVerificationSignals: [],
      strongVerificationSignals: [],
      finalClassification: "normal-content",
    },
    {
      page: 2,
      url: "https://example.invalid/page=2",
      startedAt: "2026-06-22T00:00:05.000Z",
      endedAt: "2026-06-22T00:00:09.000Z",
      durationMs: 4000,
      warmupMs: 1500,
      delayMs: 0,
      productsParsed: 0,
      outOfStockProducts: 0,
      missingPriceProducts: 0,
      weakVerificationSignals: [],
      strongVerificationSignals: ["challenge-dom"],
      finalClassification: "strong-verification",
    },
  ],
  blockedReason: "strong verification detected on page 2",
  browser: {
    ...chromeBrowserDescriptor,
    userDataDirCreated: true,
    executablePath:
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  },
  manualVerificationAllowed: true,
  manualVerificationRecovered: false,
});
const probeSummary = summarizeVerificationTelemetry(probeTelemetry);
assert.equal(probeTelemetry.productionWritten, false);
assert.equal(probeTelemetry.candidateGenerated, false);
assert.equal(probeTelemetry.detailsFetched, false);
assert.equal(probeTelemetry.captchaDetected, true);
assert.deepEqual(probeTelemetry.captchaPages, [2]);
assert.equal(probeSummary.firstStrongVerificationPage, 2);
assert.equal(probeSummary.pagesScanned, 2);
assert.equal(
  probeTelemetry.browser.requestedBrowserChannel,
  "chrome"
);
assert.equal(
  probeTelemetry.browser.profileSource,
  "default-chrome-sp"
);
assert.equal(probeTelemetry.manualVerificationAllowed, true);
assert.equal(probeTelemetry.manualVerificationRecovered, false);
assert.equal(
  probeTelemetry.verificationDetectedAt,
  "2026-06-22T00:00:05.000Z"
);

assert.equal(
  evaluateVerificationRisk({
    captchaDetected: true,
    pagesRequested: 107,
    pagesScanned: 60,
    avgSecondsPerPage: 4.627,
    weakVerificationPages: [],
    strongVerificationPages: [60],
  }).riskLevel,
  "blocked"
);
const highRisk = evaluateVerificationRisk({
  captchaDetected: false,
  pagesRequested: 107,
  pagesScanned: 60,
  avgSecondsPerPage: 4.627,
  weakVerificationPages: [],
  strongVerificationPages: [],
});
assert.equal(highRisk.riskLevel, "high");
assert.match(highRisk.warnings.join("\n"), /too aggressive/i);
const lowRisk = evaluateVerificationRisk({
  captchaDetected: false,
  pagesRequested: 107,
  pagesScanned: 107,
  avgSecondsPerPage: 9.045,
  weakVerificationPages: [],
  strongVerificationPages: [],
});
assert.equal(lowRisk.riskLevel, "low");
assert.equal(
  evaluateVerificationRisk({
    captchaDetected: false,
    pagesRequested: 10,
    pagesScanned: 10,
    avgSecondsPerPage: 4.5,
    weakVerificationPages: [],
    strongVerificationPages: [],
  }).riskLevel,
  "medium"
);

const trustedProbeDiff = {
  allowApply: true,
  coverage: {
    fullExpectedRangeScanned: true,
    captchaDetected: false,
  },
  fatalWarnings: [],
  newIds: ["200", "201", "202", "203", "204", "205"],
};
const probeCurrentProducts = trustedProbeDiff.newIds.map((id) => ({
  sourceProductId: id,
  sourceUrl: `https://example.invalid/moreinfo.cfm?product_id=${id}`,
  title: `Probe ${id}`,
}));
const trustedProbeSelection = selectTrustedDetailProbeCandidates({
  diff: trustedProbeDiff,
  currentProducts: probeCurrentProducts,
  detailProbeMax: 5,
});
assert.equal(trustedProbeSelection.trusted, true);
assert.equal(trustedProbeSelection.candidates.length, 5);
assert.deepEqual(
  trustedProbeSelection.candidates.map((item) => item.sourceProductId),
  ["200", "201", "202", "203", "204"]
);
for (const untrustedDiff of [
  { ...trustedProbeDiff, allowApply: false },
  {
    ...trustedProbeDiff,
    coverage: {
      ...trustedProbeDiff.coverage,
      captchaDetected: true,
    },
  },
  {
    ...trustedProbeDiff,
    coverage: {
      ...trustedProbeDiff.coverage,
      fullExpectedRangeScanned: false,
    },
  },
]) {
  const selection = selectTrustedDetailProbeCandidates({
    diff: untrustedDiff,
    currentProducts: probeCurrentProducts,
    detailProbeMax: 5,
  });
  assert.equal(selection.trusted, false);
  assert.equal(selection.candidates.length, 0);
}

const simulatedDetailProbe = simulateDetailProbe({
  candidates: trustedProbeSelection.candidates,
  detailProbeMax: 5,
  strongVerificationAt: 3,
});
assert.equal(simulatedDetailProbe.observations.length, 3);
assert.equal(
  simulatedDetailProbe.observations[2].finalClassification,
  "strong-verification"
);
assert.equal(simulatedDetailProbe.stoppedForStrongVerification, true);
const simulatedRecoveredDetailProbe = simulateDetailProbe({
  candidates: trustedProbeSelection.candidates,
  detailProbeMax: 5,
  strongVerificationAt: 2,
  manualVerificationRecoveredAt: 2,
});
assert.equal(
  simulatedRecoveredDetailProbe.observations.length,
  5
);
assert.equal(
  simulatedRecoveredDetailProbe.stoppedForStrongVerification,
  false
);
assert.equal(
  simulatedRecoveredDetailProbe.observations[1]
    .manualVerificationRecovered,
  true
);
assert.equal(
  simulatedRecoveredDetailProbe.observations[1]
    .parsedSuccessfully,
  true
);

const detailProbeTelemetry = buildDetailProbeTelemetry({
  runId: "detail-probe-mock",
  startedAt: "2026-06-22T00:00:00.000Z",
  endedAt: "2026-06-22T00:00:30.000Z",
  detailProbeMax: 5,
  observations: simulatedDetailProbe.observations,
  blockedReason: "strong verification",
  browser: {
    ...chromeBrowserDescriptor,
    userDataDirCreated: true,
  },
  manualVerificationAllowed: true,
  manualVerificationRecovered: false,
});
assert.equal(detailProbeTelemetry.mode, "detail-probe");
assert.equal(detailProbeTelemetry.detailsAttempted, 3);
assert.equal(detailProbeTelemetry.captchaDetected, true);
assert.equal(detailProbeTelemetry.candidateGenerated, false);
assert.equal(detailProbeTelemetry.productionWritten, false);
assert.equal(
  detailProbeTelemetry.browser.effectiveBrowserChannel,
  "chrome"
);
assert.equal(
  detailProbeTelemetry.browser.profileSource,
  "default-chrome-sp"
);
assert.equal(
  detailProbeTelemetry.manualVerificationRecovered,
  false
);
assert.equal(
  detailProbeTelemetry.verificationDetectedAt,
  simulatedDetailProbe.observations[2].startedAt
);

const noCandidateProbeRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "inventory-detail-probe-noop-")
);
fs.mkdirSync(
  path.join(noCandidateProbeRoot, "data", "inventory"),
  { recursive: true }
);
fs.writeFileSync(
  path.join(
    noCandidateProbeRoot,
    "data",
    "inventory",
    "smokingpipes-inventory-diff-dry-run.json"
  ),
  JSON.stringify({
    allowApply: false,
    coverage: {
      fullExpectedRangeScanned: true,
      captchaDetected: true,
    },
    fatalWarnings: [
      "captcha/currentListVerificationDetected",
    ],
    newIds: ["200"],
  })
);
fs.writeFileSync(
  path.join(
    noCandidateProbeRoot,
    "data",
    "inventory",
    "smokingpipes-current-list-dry-run.json"
  ),
  JSON.stringify({ products: probeCurrentProducts })
);
const noCandidateProbeResult = await runSmokingpipesDetailProbe({
  root: noCandidateProbeRoot,
  options: parseRunnerOptions(["--mode=detail-probe"]),
});
assert.equal(
  noCandidateProbeResult.status,
  "no-detail-probe-candidates"
);
assert.equal(noCandidateProbeResult.browserStarted, false);
assert.equal(
  fs.existsSync(
    path.join(
      noCandidateProbeRoot,
      "data",
      "inventory",
      "smokingpipes-detail-probe-telemetry.json"
    )
  ),
  true
);
assert.equal(
  fs.existsSync(
    path.join(
      noCandidateProbeRoot,
      "data",
      "inventory",
      "smokingpipes-daily-new-details-queue.json"
    )
  ),
  false
);

const browserPreflightRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "inventory-browser-preflight-")
);
const browserPreflightResult =
  await runSmokingpipesBrowserPreflight({
    root: browserPreflightRoot,
    options: parseRunnerOptions([
      "--mode=browser-preflight",
      "--mock",
      "--browser-channel=chrome",
      "--browser-profile=sp-chrome",
      "--verbose",
    ]),
  });
assert.equal(browserPreflightResult.status, "preflight-passed");
assert.equal(browserPreflightResult.browserStarted, false);
assert.equal(browserPreflightResult.productsFetched, false);
assert.equal(browserPreflightResult.candidateGenerated, false);
assert.equal(browserPreflightResult.productionWritten, false);
assert.equal(
  browserPreflightResult.state.browser.requestedBrowserChannel,
  "chrome"
);
assert.equal(
  browserPreflightResult.state.browser.effectiveBrowserChannel,
  "chrome"
);
assert.equal(
  browserPreflightResult.state.browser.profileSource,
  "named-sp-chrome"
);
assert.equal(
  browserPreflightResult.state.verificationDetectedAt,
  null
);
const browserPreflightPaths = runnerCore.getRunnerPaths(
  browserPreflightRoot,
  { mock: true }
);
assert.equal(
  fs.existsSync(browserPreflightPaths.browserProfileState),
  true
);
assert.equal(
  fs.existsSync(browserPreflightPaths.browserProfileReport),
  true
);
for (const forbiddenPath of [
  browserPreflightPaths.currentList,
  browserPreflightPaths.diff,
  browserPreflightPaths.queue,
  browserPreflightPaths.dailyQueue,
  browserPreflightPaths.dailyProductsNext,
]) {
  assert.equal(fs.existsSync(forbiddenPath), false);
}
assert.equal(
  fs.existsSync(
    path.join(
      noCandidateProbeRoot,
      "data",
      "products",
      "smokingpipes-products-daily-next-dry-run.json"
    )
  ),
  false
);

const legacyFixedDelay = resolveListPacingOptions({
  pageDelayMs: 4500,
});
assert.equal(legacyFixedDelay.pageDelayMinMs, 4500);
assert.equal(legacyFixedDelay.pageDelayMaxMs, 4500);

assert.throws(
  () => parseRunnerOptions(["--mode=apply"]),
  /not implemented/i,
  "V1 must reject production apply"
);

const firstQueue = buildDetailsQueue({
  existingQueue: null,
  diff: { generatedAt: "2026-06-20T00:00:00.000Z", newIds: ["101", "102"] },
  currentProducts: [
    { sourceProductId: "101", sourceUrl: "https://example/101", title: "One" },
    { sourceProductId: "102", sourceUrl: "https://example/102", title: "Two" },
  ],
  now: "2026-06-20T00:01:00.000Z",
});
assert.equal(firstQueue.items.length, 2);
assert.equal(firstQueue.items[0].status, "pending");

firstQueue.items[0] = {
  ...firstQueue.items[0],
  status: "completed",
  retryCount: 1,
  detail: { sourceProductId: "101", title: "One detail" },
};

const resumedQueue = buildDetailsQueue({
  existingQueue: firstQueue,
  diff: { generatedAt: "2026-06-21T00:00:00.000Z", newIds: ["101", "103"] },
  currentProducts: [
    { sourceProductId: "101", sourceUrl: "https://example/101", title: "One" },
    { sourceProductId: "103", sourceUrl: "https://example/103", title: "Three" },
  ],
  now: "2026-06-21T00:01:00.000Z",
});
assert.equal(
  resumedQueue.items.find((item) => item.sourceProductId === "101")?.status,
  "completed",
  "completed details must not be fetched twice"
);
assert.equal(
  resumedQueue.items.find((item) => item.sourceProductId === "102")?.status,
  "superseded"
);

const cachedDetails = collectValidCachedDetails([
  {
    details: [
      {
        sourceProductId: "104",
        sourceUrl: "https://example/104",
        fullTitle: "Cached detail",
        galleryImages: ["https://example/104.jpg"],
      },
      {
        sourceProductId: "invalid",
        sourceUrl: "",
        fullTitle: "",
        galleryImages: [],
      },
    ],
  },
]);
assert.equal(cachedDetails.size, 1);

const filteredQueue = buildDetailsQueue({
  existingQueue: {
    version: "smokingpipes-new-details-queue-v1",
    items: [
      {
        sourceProductId: "105",
        active: true,
        status: "completed",
        detail: { sourceProductId: "105", fullTitle: "Completed" },
      },
      {
        sourceProductId: "106",
        active: false,
        status: "ignored",
      },
    ],
  },
  diff: {
    generatedAt: "2026-06-21T00:00:00.000Z",
    newIds: ["104", "105", "106", "107"],
    stillAvailableIds: ["201"],
    disappearedIds: ["301"],
  },
  currentProducts: [
    { sourceProductId: "104", sourceUrl: "https://example/104" },
    { sourceProductId: "105", sourceUrl: "https://example/105" },
    { sourceProductId: "106", sourceUrl: "https://example/106" },
    { sourceProductId: "107", sourceUrl: "https://example/107" },
    { sourceProductId: "201", sourceUrl: "https://example/201" },
  ],
  existingProductIds: new Set(["107"]),
  cachedDetails,
  now: "2026-06-21T00:01:00.000Z",
});
assert.deepEqual(
  filteredQueue.items
    .filter((item) => item.active !== false)
    .map((item) => item.sourceProductId),
  ["104", "105"]
);
assert.equal(
  filteredQueue.items.find((item) => item.sourceProductId === "104")?.status,
  "completed"
);
assert.equal(filteredQueue.summary.newCandidatesFromDiff, 4);
assert.equal(filteredQueue.summary.cachedSkipped, 1);
assert.equal(filteredQueue.summary.alreadyCompletedSkipped, 1);
assert.equal(filteredQueue.summary.ignoredSkipped, 1);
assert.equal(filteredQueue.summary.existingProductsSkipped, 1);
assert.equal(filteredQueue.summary.queuedNewDetails, 0);
assert.equal(
  filteredQueue.items.some((item) => item.sourceProductId === "201"),
  false,
  "stillAvailable IDs must never enter the detail queue"
);
assert.equal(
  filteredQueue.items.some((item) => item.sourceProductId === "301"),
  false,
  "disappeared IDs must never enter the detail queue"
);

const staleCachedDetail = {
  sourceProductId: "108",
  sourceUrl: "https://example/108",
  fullTitle: "Recovered cached detail",
  galleryImages: ["https://example/108.jpg"],
};
const staleCachedQueue = buildDetailsQueue({
  existingQueue: {
    version: "smokingpipes-new-details-queue-v1",
    items: [
      {
        sourceProductId: "108",
        sourceUrl: "https://example/108",
        active: true,
        status: "in-progress",
        detail: null,
      },
    ],
  },
  diff: {
    generatedAt: "2026-06-21T00:00:00.000Z",
    newIds: ["108"],
  },
  currentProducts: [
    { sourceProductId: "108", sourceUrl: "https://example/108" },
  ],
  cachedDetails: new Map([["108", staleCachedDetail]]),
  now: "2026-06-22T00:00:00.000Z",
});
assert.equal(staleCachedQueue.items[0].status, "completed");
assert.equal(staleCachedQueue.items[0].detail.fullTitle, "Recovered cached detail");
assert.equal(staleCachedQueue.summary.staleInProgressRepaired, 1);
assert.equal(staleCachedQueue.summary.staleInProgressCached, 1);
assert.equal(staleCachedQueue.summary.staleInProgressReset, 0);
const staleCachedProcessResult = await processSmokingpipesDetailsQueue({
  queue: staleCachedQueue,
  queuePath: path.join(
    os.tmpdir(),
    `inventory-stale-cached-${process.pid}-${Date.now()}.json`
  ),
  maxItems: 1,
  mock: true,
});
assert.equal(
  staleCachedProcessResult.result.selected,
  0,
  "a stale in-progress item repaired from cache must not be fetched again"
);

const stalePendingQueue = buildDetailsQueue({
  existingQueue: {
    version: "smokingpipes-new-details-queue-v1",
    items: [
      {
        sourceProductId: "109",
        sourceUrl: "https://example/109",
        active: true,
        status: "in-progress",
        detail: null,
      },
    ],
  },
  diff: {
    generatedAt: "2026-06-21T00:00:00.000Z",
    newIds: ["109"],
  },
  currentProducts: [
    { sourceProductId: "109", sourceUrl: "https://example/109" },
  ],
  cachedDetails: new Map(),
  now: "2026-06-22T00:00:00.000Z",
});
assert.equal(stalePendingQueue.items[0].status, "pending");
assert.equal(stalePendingQueue.summary.staleInProgressRepaired, 1);
assert.equal(stalePendingQueue.summary.staleInProgressCached, 0);
assert.equal(stalePendingQueue.summary.staleInProgressReset, 1);

const staleTempRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "inventory-stale-temp-test-")
);
const staleTempQueuePath = path.join(
  staleTempRoot,
  "smokingpipes-new-details-queue.json"
);
const staleTempPath = `${staleTempQueuePath}.tmp-123-456`;
fs.writeFileSync(
  staleTempPath,
  `${JSON.stringify({
    items: [
      {
        sourceProductId: "110",
        status: "completed",
        detail: {
          sourceProductId: "110",
          sourceUrl: "https://example/110",
          fullTitle: "Detail recovered from preserved queue temp",
        },
      },
    ],
  })}\n`,
  "utf8"
);
assert.equal(
  typeof runnerCore.collectValidQueueTempDetails,
  "function"
);
const staleTempDetails =
  runnerCore.collectValidQueueTempDetails(staleTempQueuePath);
assert.equal(staleTempDetails.details.get("110")?.fullTitle,
  "Detail recovered from preserved queue temp");
assert.deepEqual(staleTempDetails.tempFiles, [staleTempPath]);

const pendingReadiness = evaluateRunnerReadiness({
  inventoryValidation: { status: "passed", allowApply: true },
  diff: { allowApply: true, coverage: { fullExpectedRangeScanned: true } },
  queue: resumedQueue,
});
assert.equal(pendingReadiness.status, "details-pending");
assert.equal(pendingReadiness.allowApply, false);

for (const item of resumedQueue.items) {
  if (item.active) item.status = "completed";
}
const ready = evaluateRunnerReadiness({
  inventoryValidation: { status: "passed", allowApply: true },
  diff: { allowApply: true, coverage: { fullExpectedRangeScanned: true } },
  queue: resumedQueue,
});
assert.equal(ready.status, "apply-ready");
assert.equal(ready.allowApply, true);

const completeExistingQueueReadiness = evaluateRunnerReadiness({
  inventoryValidation: { status: "passed", allowApply: true },
  diff: {
    allowApply: true,
    coverage: { fullExpectedRangeScanned: true },
    newIds: ["1", "2"],
    counts: { new: 2 },
  },
  queue: {
    items: [
      { sourceProductId: "1", active: true, status: "completed" },
      { sourceProductId: "2", active: true, status: "completed" },
    ],
  },
  detailsFetchAllowed: false,
});
assert.equal(
  completeExistingQueueReadiness.allowApply,
  true,
  "an already completed queue must allow offline candidate generation without fetching"
);

assert.equal(
  typeof runnerCore.shouldGenerateFinalApplyDryRunOutputs,
  "function"
);
assert.equal(
  runnerCore.shouldGenerateFinalApplyDryRunOutputs({
    mode: "apply-dry-run",
    readiness: pendingReadiness,
  }),
  false,
  "pending details must not generate final next outputs"
);
assert.equal(
  runnerCore.shouldGenerateFinalApplyDryRunOutputs({
    mode: "apply-dry-run",
    readiness: ready,
  }),
  true
);
assert.equal(
  runnerCore.baselineCatchUpNextStep({
    catchUpCurrent: true,
    detailsComplete: false,
  }),
  "Continue baseline catch-up before enabling daily update."
);
assert.equal(
  runnerCore.baselineCatchUpNextStep({
    catchUpCurrent: true,
    detailsComplete: true,
    outputsGenerated: false,
  }),
  "Review readiness report and fix candidate classification / conversion issues. Do not continue crawling."
);
assert.equal(
  runnerCore.baselineCatchUpNextStep({
    catchUpCurrent: true,
    detailsComplete: true,
    outputsGenerated: true,
  }),
  "Review generated next-dry-run outputs before formal apply."
);

const lockRoot = fs.mkdtempSync(path.join(os.tmpdir(), "inventory-lock-test-"));
const lockPath = path.join(lockRoot, "smokingpipes.lock");
const lock = acquireRunLock(lockPath, {
  runId: "test-run",
  source: "smokingpipes",
});
assert.throws(() => acquireRunLock(lockPath, { runId: "second" }), /already running/i);
releaseRunLock(lock);
assert.equal(fs.existsSync(lockPath), false);

const verificationRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "inventory-detail-verification-test-")
);
const verificationQueuePath = path.join(verificationRoot, "queue.json");
const verificationQueue = buildDetailsQueue({
  existingQueue: null,
  diff: {
    generatedAt: "2026-06-21T00:00:00.000Z",
    newIds: ["401", "402", "403"],
  },
  currentProducts: [
    { sourceProductId: "401", sourceUrl: "https://example/401" },
    { sourceProductId: "402", sourceUrl: "https://example/402" },
    { sourceProductId: "403", sourceUrl: "https://example/403" },
  ],
  now: "2026-06-21T00:01:00.000Z",
});
await assert.rejects(
  processSmokingpipesDetailsQueue({
    queue: verificationQueue,
    queuePath: verificationQueuePath,
    maxItems: 3,
    mock: true,
    mockVerificationAt: 1,
  }),
  (error) =>
    error?.code === "CAPTCHA_REQUIRED" &&
    error?.currentProductId === "401"
);
const checkpointedVerificationQueue = JSON.parse(
  fs.readFileSync(verificationQueuePath, "utf8")
);
assert.equal(
  checkpointedVerificationQueue.items.find(
    (item) => item.sourceProductId === "401"
  )?.status,
  "blocked"
);
assert.equal(
  checkpointedVerificationQueue.items.find(
    (item) => item.sourceProductId === "402"
  )?.status,
  "pending",
  "verification must stop before the next product"
);

const checkpointRetryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "inventory-checkpoint-retry-test-")
);
const checkpointTransientPath = path.join(
  checkpointRetryRoot,
  "transient-queue.json"
);
const checkpointTransientQueue = buildDetailsQueue({
  existingQueue: null,
  diff: {
    generatedAt: "2026-06-21T00:00:00.000Z",
    newIds: ["451"],
  },
  currentProducts: [
    { sourceProductId: "451", sourceUrl: "https://example/451" },
  ],
  now: "2026-06-21T00:01:00.000Z",
});
let checkpointTransientAttempts = 0;
const checkpointTransientResult = await processSmokingpipesDetailsQueue({
  queue: checkpointTransientQueue,
  queuePath: checkpointTransientPath,
  maxItems: 1,
  mock: true,
  atomicWriteOptions: {
    rename: async (tempPath, targetPath) => {
      checkpointTransientAttempts += 1;
      if (checkpointTransientAttempts === 1) {
        throw Object.assign(new Error("mock queue lock"), { code: "EPERM" });
      }
      await fs.promises.rename(tempPath, targetPath);
    },
    sleep: async () => {},
    random: () => 0,
  },
});
assert.equal(checkpointTransientAttempts, 2);
assert.equal(checkpointTransientResult.result.completed, 1);
assert.equal(
  JSON.parse(fs.readFileSync(checkpointTransientPath, "utf8")).items[0]
    .status,
  "completed"
);

const checkpointPermanentPath = path.join(
  checkpointRetryRoot,
  "permanent-queue.json"
);
const checkpointPermanentQueue = buildDetailsQueue({
  existingQueue: null,
  diff: {
    generatedAt: "2026-06-21T00:00:00.000Z",
    newIds: ["461", "462"],
  },
  currentProducts: [
    { sourceProductId: "461", sourceUrl: "https://example/461" },
    { sourceProductId: "462", sourceUrl: "https://example/462" },
  ],
  now: "2026-06-21T00:01:00.000Z",
});
fs.writeFileSync(
  checkpointPermanentPath,
  `${JSON.stringify(checkpointPermanentQueue, null, 2)}\n`,
  "utf8"
);
let checkpointPermanentError = null;
try {
  await processSmokingpipesDetailsQueue({
    queue: checkpointPermanentQueue,
    queuePath: checkpointPermanentPath,
    maxItems: 2,
    mock: true,
    atomicWriteOptions: {
      maxRenameAttempts: 20,
      rename: async () => {
        throw Object.assign(new Error("mock permanent queue lock"), {
          code: "EBUSY",
        });
      },
      sleep: async () => {},
      random: () => 0,
    },
  });
} catch (error) {
  checkpointPermanentError = error;
}
assert.equal(checkpointPermanentError?.code, "CHECKPOINT_FAILED");
assert.equal(checkpointPermanentError?.currentProductId, "461");
assert.equal(checkpointPermanentError?.attempts, 20);
assert.equal(checkpointPermanentError?.targetPath, checkpointPermanentPath);
assert.equal(checkpointPermanentError?.lastError?.code, "EBUSY");
assert.equal(fs.existsSync(checkpointPermanentError?.tempPath || ""), true);
assert.equal(
  JSON.parse(fs.readFileSync(checkpointPermanentPath, "utf8")).items[0]
    .status,
  "pending",
  "failed target checkpoint must remain at its previous durable state"
);
assert.equal(
  JSON.parse(
    fs.readFileSync(checkpointPermanentError.tempPath, "utf8")
  ).items[0].status,
  "completed",
  "preserved temp queue must contain the newly parsed detail"
);
const checkpointClassification = runnerCore.classifyRunnerError(
  checkpointPermanentError
);
assert.equal(checkpointClassification.status, "blocked");
assert.equal(checkpointClassification.checkpointFailed, true);
assert.equal(checkpointClassification.productionWritten, false);
assert.equal(
  typeof runnerCore.formatCheckpointFailureReport,
  "function"
);
const checkpointFailureReport =
  runnerCore.formatCheckpointFailureReport({
    checkpointFailed: true,
    currentProductId: "461",
    checkpointTargetPath: checkpointPermanentPath,
    checkpointTempPath: checkpointPermanentError.tempPath,
    checkpointAttempts: 20,
    checkpointLastErrorCode: "EBUSY",
  });
assert.match(checkpointFailureReport, /last detail id: 461/i);
assert.match(
  checkpointFailureReport,
  new RegExp(
    checkpointPermanentPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  )
);
assert.match(checkpointFailureReport, /attempts: 20/i);
assert.match(checkpointFailureReport, /last error code: EBUSY/i);
assert.match(checkpointFailureReport, /production data written: false/i);

const cappedDetailsRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "inventory-detail-cap-test-")
);
const cappedDetailsQueue = buildDetailsQueue({
  existingQueue: null,
  diff: {
    generatedAt: "2026-06-21T00:00:00.000Z",
    newIds: Array.from({ length: 7 }, (_, index) => String(501 + index)),
  },
  currentProducts: Array.from({ length: 7 }, (_, index) => ({
    sourceProductId: String(501 + index),
    sourceUrl: `https://example/${501 + index}`,
  })),
  now: "2026-06-21T00:01:00.000Z",
});
const cappedDetailsResult = await processSmokingpipesDetailsQueue({
  queue: cappedDetailsQueue,
  queuePath: path.join(cappedDetailsRoot, "queue.json"),
  maxItems: 5,
  mock: true,
});
assert.equal(cappedDetailsResult.result.selected, 5);
assert.equal(cappedDetailsResult.result.attempted, 5);
assert.equal(cappedDetailsResult.result.completed, 5);
assert.equal(
  cappedDetailsResult.queue.items.filter(
    (item) => item.active !== false && item.status === "pending"
  ).length,
  2,
  "detail-max-per-run=5 must leave additional diff.newIds pending"
);

const deadlineQueue = buildDetailsQueue({
  existingQueue: null,
  diff: {
    generatedAt: "2026-06-21T00:00:00.000Z",
    newIds: ["551", "552", "553"],
  },
  currentProducts: ["551", "552", "553"].map((sourceProductId) => ({
    sourceProductId,
    sourceUrl: `https://example/${sourceProductId}`,
  })),
  now: "2026-06-21T00:01:00.000Z",
});
const deadlineTicks = [0, 60001, 60001];
const deadlineResult = await processSmokingpipesDetailsQueue({
  queue: deadlineQueue,
  queuePath: path.join(cappedDetailsRoot, "deadline-queue.json"),
  maxItems: 3,
  mock: true,
  deadlineAtMs: 60000,
  nowMs: () => deadlineTicks.shift() ?? 60001,
});
assert.equal(deadlineResult.result.attempted, 1);
assert.equal(deadlineResult.result.runtimeLimitReached, true);
assert.equal(
  runnerCore.summarizeDetailsQueue(deadlineResult.queue).remaining,
  2
);

const verboseDetailsQueue = buildDetailsQueue({
  existingQueue: null,
  diff: {
    generatedAt: "2026-06-21T00:00:00.000Z",
    newIds: ["601", "602"],
  },
  currentProducts: [
    { sourceProductId: "601", sourceUrl: "https://example/601" },
    { sourceProductId: "602", sourceUrl: "https://example/602" },
  ],
  now: "2026-06-21T00:01:00.000Z",
});
const detailProgressLogs = [];
const originalConsoleLog = console.log;
try {
  console.log = (...values) => {
    detailProgressLogs.push(values.join(" "));
  };
  await processSmokingpipesDetailsQueue({
    queue: verboseDetailsQueue,
    queuePath: path.join(cappedDetailsRoot, "verbose-queue.json"),
    maxItems: 2,
    mock: true,
    verbose: true,
  });
} finally {
  console.log = originalConsoleLog;
}
assert.match(
  detailProgressLogs.join("\n"),
  /fetching new detail 1\/2: 601/,
  "verbose detail runs must show per-item progress"
);

assert.equal(
  typeof detailsQueueModule.processSmokingpipesCatchUpCycles,
  "function",
  "catch-up must expose a bounded multi-cycle processor"
);
const repeatedCatchUpRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "inventory-catch-up-repeat-test-")
);
const repeatedCatchUpQueue = buildDetailsQueue({
  existingQueue: null,
  diff: {
    generatedAt: "2026-06-21T00:00:00.000Z",
    newIds: Array.from({ length: 12 }, (_, index) => String(701 + index)),
  },
  currentProducts: Array.from({ length: 12 }, (_, index) => ({
    sourceProductId: String(701 + index),
    sourceUrl: `https://example/${701 + index}`,
  })),
  now: "2026-06-21T00:01:00.000Z",
});
const repeatedCatchUp = await detailsQueueModule.processSmokingpipesCatchUpCycles({
  queue: repeatedCatchUpQueue,
  queuePath: path.join(repeatedCatchUpRoot, "queue.json"),
  detailMaxPerRun: 5,
  autoRepeat: true,
  maxCycles: 2,
  maxTotalDetails: 20,
  maxRuntimeMinutes: 90,
  repeatDelayMinMs: 300000,
  repeatDelayMaxMs: 600000,
  mock: true,
});
assert.equal(repeatedCatchUp.result.cyclesCompleted, 2);
assert.equal(repeatedCatchUp.result.attempted, 10);
assert.equal(repeatedCatchUp.result.completed, 10);
assert.equal(repeatedCatchUp.result.stopReason, "cycle-limit");
assert.equal(
  runnerCore.summarizeDetailsQueue(repeatedCatchUp.queue).remaining,
  2
);

const totalLimitedQueue = buildDetailsQueue({
  existingQueue: null,
  diff: {
    generatedAt: "2026-06-21T00:00:00.000Z",
    newIds: Array.from({ length: 12 }, (_, index) => String(801 + index)),
  },
  currentProducts: Array.from({ length: 12 }, (_, index) => ({
    sourceProductId: String(801 + index),
    sourceUrl: `https://example/${801 + index}`,
  })),
  now: "2026-06-21T00:01:00.000Z",
});
const totalLimitedCatchUp =
  await detailsQueueModule.processSmokingpipesCatchUpCycles({
    queue: totalLimitedQueue,
    queuePath: path.join(repeatedCatchUpRoot, "total-limited-queue.json"),
    detailMaxPerRun: 5,
    autoRepeat: true,
    maxCycles: 4,
    maxTotalDetails: 7,
    maxRuntimeMinutes: 90,
    repeatDelayMinMs: 300000,
    repeatDelayMaxMs: 600000,
    mock: true,
  });
assert.equal(totalLimitedCatchUp.result.attempted, 7);
assert.equal(totalLimitedCatchUp.result.stopReason, "total-detail-limit");

const verificationCycleQueue = buildDetailsQueue({
  existingQueue: null,
  diff: {
    generatedAt: "2026-06-21T00:00:00.000Z",
    newIds: ["901", "902", "903", "904"],
  },
  currentProducts: ["901", "902", "903", "904"].map((sourceProductId) => ({
    sourceProductId,
    sourceUrl: `https://example/${sourceProductId}`,
  })),
  now: "2026-06-21T00:01:00.000Z",
});
await assert.rejects(
  detailsQueueModule.processSmokingpipesCatchUpCycles({
    queue: verificationCycleQueue,
    queuePath: path.join(repeatedCatchUpRoot, "verification-queue.json"),
    detailMaxPerRun: 2,
    autoRepeat: true,
    maxCycles: 4,
    maxTotalDetails: 8,
    maxRuntimeMinutes: 90,
    mock: true,
    mockVerificationAt: 1,
  }),
  (error) =>
    error?.code === "CAPTCHA_REQUIRED" &&
    error?.catchUpCyclesCompleted === 0
);
const verificationCycleCheckpoint = JSON.parse(
  fs.readFileSync(
    path.join(repeatedCatchUpRoot, "verification-queue.json"),
    "utf8"
  )
);
assert.equal(
  verificationCycleCheckpoint.items.find(
    (item) => item.sourceProductId === "902"
  )?.status,
  "pending",
  "verification must stop the catch-up before later items or cycles"
);

const candidateExistingProducts = [
  {
    id: "smokingpipes-1",
    sourceProductId: "1",
    inventoryStatus: "sold",
    inventoryConfidence: "historical",
    listingEligible: false,
    publication: { listingEligible: false, status: "excluded" },
    inventoryReviewReasons: [],
    inventoryEvidence: { reasons: [] },
    sourceSpecific: { smokingpipes: {} },
  },
  {
    id: "smokingpipes-2",
    sourceProductId: "2",
    inventoryStatus: "available",
    inventoryConfidence: "high",
    listingEligible: true,
    publication: { listingEligible: true, status: "eligible" },
    inventoryReviewReasons: [],
    inventoryEvidence: { reasons: [] },
    sourceSpecific: { smokingpipes: {} },
  },
  {
    id: "smokingpipes-3",
    sourceProductId: "3",
    inventoryStatus: "available",
    inventoryConfidence: "high",
    listingEligible: true,
    publication: { listingEligible: true, status: "eligible" },
    inventoryReviewReasons: [],
    inventoryEvidence: { reasons: [] },
    sourceSpecific: { smokingpipes: {} },
  },
  {
    id: "smokingpipes-4",
    sourceProductId: "4",
    inventoryStatus: "available",
    inventoryConfidence: "high",
    listingEligible: true,
    publication: { listingEligible: true, status: "eligible" },
    inventoryReviewReasons: [],
    inventoryEvidence: { reasons: [] },
    sourceSpecific: { smokingpipes: {} },
  },
];
const candidateCurrentPayload = {
  summary: {
    fullExpectedRangeScanned: true,
    captchaDetected: false,
    uniqueProducts: 4,
  },
  products: [
    { sourceProductId: "1", price: "$100.00", rawListStatus: "" },
    {
      sourceProductId: "2",
      price: "",
      rawListStatus: "out-of-stock",
    },
    { sourceProductId: "3", price: "", rawListStatus: "" },
    { sourceProductId: "5", price: "$200.00", rawListStatus: "" },
  ],
};
const candidateDiff = {
  allowApply: true,
  fatalWarnings: [],
  newIds: ["5"],
  stillAvailableIds: ["1", "2", "3"],
  disappearedIds: ["4"],
  coverage: { fullExpectedRangeScanned: true },
  counts: {
    currentAvailable: 4,
    new: 1,
    stillAvailable: 3,
    disappeared: 1,
  },
};
const convertedNewProduct = {
  id: "smokingpipes-5",
  source: "smokingpipes",
  sourceProductId: "5",
  inventoryStatus: "available",
  inventoryConfidence: "high",
  listingEligible: true,
  brandReviewStatus: "confirmed",
  imageUrl: "https://example.com/smokingpipes-5.jpg",
  galleryImages: ["https://example.com/smokingpipes-5.jpg"],
  canonicalBrand: "Test Brand",
  canonicalShape: "Billiard",
  canonicalMaterial: "Briar",
  shapeReviewStatus: "confirmed",
  materialReviewStatus: "confirmed",
  price: {
    current: {
      amount: 200,
      currency: "USD",
      rawText: "$200.00",
      parseStatus: "parsed",
    },
  },
  publication: { listingEligible: true, status: "eligible" },
};
const classificationCurrentPayload = {
  products: [
    {
      sourceProductId: "11",
      price: "$100.00",
      rawListStatus: "",
      rawText: "",
    },
    {
      sourceProductId: "12",
      price: "",
      rawListStatus: "out-of-stock",
      rawText: "OUT OF STOCK",
    },
    {
      sourceProductId: "13",
      price: "",
      rawListStatus: "",
      rawText: "",
    },
    {
      sourceProductId: "14",
      price: "$120.00",
      rawListStatus: "",
      rawText: "",
    },
    {
      sourceProductId: "15",
      price: "$130.00",
      rawListStatus: "",
      rawText: "",
    },
  ],
};
const classificationProducts = [
  {
    ...convertedNewProduct,
    id: "smokingpipes-11",
    sourceProductId: "11",
    imageUrl: "https://example/11.jpg",
    canonicalBrand: "Test",
    canonicalShape: "Billiard",
    canonicalMaterial: "Briar",
    price: { current: { amount: 100, parseStatus: "parsed" } },
  },
  {
    ...convertedNewProduct,
    id: "smokingpipes-12",
    sourceProductId: "12",
    inventoryStatus: "needs-review",
    imageUrl: "https://example/12.jpg",
    canonicalBrand: "Test",
    canonicalShape: "Billiard",
    canonicalMaterial: "Briar",
    price: { current: { amount: null, parseStatus: "empty" } },
    publication: { listingEligible: false, status: "eligible" },
  },
  {
    ...convertedNewProduct,
    id: "smokingpipes-13",
    sourceProductId: "13",
    inventoryStatus: "available",
    imageUrl: "https://example/13.jpg",
    canonicalBrand: "Test",
    canonicalShape: "Billiard",
    canonicalMaterial: "Briar",
    price: { current: { amount: 110, parseStatus: "parsed" } },
  },
  {
    ...convertedNewProduct,
    id: "smokingpipes-14",
    sourceProductId: "14",
    inventoryStatus: "needs-review",
    inventoryConfidence: "conflicting-signals",
    imageUrl: "https://example/14.jpg",
    canonicalBrand: "Test",
    canonicalShape: "Billiard",
    canonicalMaterial: "Briar",
    price: { current: { amount: 120, parseStatus: "parsed" } },
    publication: { listingEligible: false, status: "eligible" },
  },
  {
    ...convertedNewProduct,
    id: "smokingpipes-15",
    sourceProductId: "15",
    inventoryStatus: "available",
    imageUrl: "",
    canonicalBrand: "Test",
    canonicalShape: "Billiard",
    canonicalMaterial: "Briar",
    price: { current: { amount: 130, parseStatus: "parsed" } },
  },
];
const baselineClassification = classifySmokingpipesBaselineProducts({
  convertedProducts: classificationProducts,
  currentPayload: classificationCurrentPayload,
  conversionFailures: [
    { sourceProductId: "16", error: "missing source URL" },
  ],
});
assert.equal(baselineClassification.counts.totalCompleted, 6);
assert.equal(baselineClassification.counts.convertSucceeded, 5);
assert.equal(baselineClassification.counts.publicReady, 1);
assert.equal(baselineClassification.counts.soldOutOfStock, 1);
assert.equal(baselineClassification.counts.missingPrice, 1);
assert.equal(baselineClassification.counts.inventoryConflict, 1);
assert.equal(baselineClassification.counts.missingImage, 1);
assert.equal(baselineClassification.counts.convertFailed, 1);
assert.equal(baselineClassification.fatal, false);
assert.equal(
  baselineClassification.products.length,
  5,
  "every successful conversion belongs in the product-library candidate"
);
assert.deepEqual(
  baselineClassification.publicReadyProducts.map(
    (item) => item.sourceProductId
  ),
  ["11"]
);
assert.equal(
  baselineClassification.products.find(
    (item) => item.sourceProductId === "12"
  )?.inventoryStatus,
  "sold"
);
assert.equal(
  baselineClassification.products.find(
    (item) => item.sourceProductId === "13"
  )?.inventoryStatus,
  "available",
  "missing price must not be marked sold"
);
assert.equal(
  baselineClassification.products.find(
    (item) => item.sourceProductId === "13"
  )?.publication?.listingEligible,
  false
);
const baselineReadinessReport =
  buildSmokingpipesBaselineReadinessReport({
    runId: "classification-test",
    readiness: baselineClassification,
    publicValidation: {
      status: "passed",
      errors: [],
      counts: { catalog: 1, brands: 1, recentNew: 1 },
    },
  });
assert.equal(baselineReadinessReport.counts.publicReady, 1);
assert.equal(baselineReadinessReport.counts.notPublicReady, 5);
assert.equal(
  baselineReadinessReport.samples.missingPrice[0].sourceProductId,
  "13"
);
const baselineReadinessMarkdown =
  buildSmokingpipesBaselineReadinessMarkdown(baselineReadinessReport);
assert.match(baselineReadinessMarkdown, /total new completed: 6/i);
assert.match(baselineReadinessMarkdown, /public-ready count: 1/i);
assert.match(baselineReadinessMarkdown, /missing price count: 1/i);
assert.match(baselineReadinessMarkdown, /production data written: false/i);

const applyCandidate = buildSmokingpipesApplyCandidate({
  existingProducts: candidateExistingProducts,
  currentPayload: candidateCurrentPayload,
  diff: candidateDiff,
  inventoryValidation: { status: "passed", allowApply: true },
  queue: {
    items: [
      {
        sourceProductId: "5",
        active: true,
        status: "completed",
        detail: { sourceProductId: "5" },
      },
    ],
  },
  convertedNewProducts: [convertedNewProduct],
  conversionFailures: [],
});
assert.equal(applyCandidate.products.length, 5);
assert.equal(
  applyCandidate.products.find((item) => item.sourceProductId === "1")
    ?.inventoryStatus,
  "available"
);
assert.equal(
  applyCandidate.products.find((item) => item.sourceProductId === "2")
    ?.inventoryStatus,
  "sold"
);
assert.equal(
  applyCandidate.products.find((item) => item.sourceProductId === "3")
    ?.inventoryStatus,
  "available",
  "missing price without an out-of-stock signal must remain available"
);
assert.equal(
  applyCandidate.products.find((item) => item.sourceProductId === "4")
    ?.inventoryStatus,
  "sold",
  "disappeared products become sold candidates only after a full scan"
);
assert.deepEqual(
  applyCandidate.recentNewProducts.map((item) => item.sourceProductId),
  ["5"]
);
assert.equal(applyCandidate.stats.outOfStockSold, 1);
assert.equal(applyCandidate.stats.disappearedSold, 1);
assert.equal(applyCandidate.stats.missingPriceNotSold, 1);
assert.equal(applyCandidate.stats.addedProducts, 1);
assert.equal(applyCandidate.productionWritten, false);
assert.equal(applyCandidate.candidateReady, true);
assert.equal(applyCandidate.allowFormalApply, false);

const dailyCandidate = buildSmokingpipesDailyCandidate({
  productionProducts: candidateExistingProducts,
  currentPayload: candidateCurrentPayload,
  dailyDiff: {
    ...candidateDiff,
    dailyNewIds: candidateDiff.newIds,
    newlySoldOutIds: ["2"],
    missingPriceButNotSoldIds: ["3"],
    counts: {
      ...candidateDiff.counts,
      dailyNew: 1,
      newlySoldOut: 1,
      missingPriceButNotSold: 1,
    },
  },
  queue: {
    items: [
      {
        sourceProductId: "5",
        active: true,
        status: "completed",
        detail: { sourceProductId: "5" },
      },
    ],
  },
  convertedNewProducts: [convertedNewProduct],
  conversionFailures: [],
});
assert.equal(dailyCandidate.products.length, 5);
assert.equal(
  dailyCandidate.products.find((item) => item.sourceProductId === "2")
    ?.inventoryStatus,
  "sold"
);
assert.equal(
  dailyCandidate.products.find((item) => item.sourceProductId === "4")
    ?.inventoryStatus,
  "sold"
);
assert.equal(
  dailyCandidate.products.find((item) => item.sourceProductId === "3")
    ?.inventoryStatus,
  "available",
  "daily missing-price without sold evidence must remain available"
);
assert.deepEqual(
  dailyCandidate.recentNewProducts.map((item) => item.sourceProductId),
  ["5"]
);
assert.equal(dailyCandidate.productionWritten, false);

const dailyAudit = buildSmokingpipesDailyAudit({
  productionProducts: candidateExistingProducts,
  currentPayload: candidateCurrentPayload,
  dailyDiff: {
    ...candidateDiff,
    dailyNewIds: candidateDiff.newIds,
    newlySoldOutIds: ["2"],
    missingPriceButNotSoldIds: ["3"],
    counts: {
      ...candidateDiff.counts,
      dailyNew: 1,
      newlySoldOut: 1,
      missingPriceButNotSold: 1,
    },
  },
  queue: {
    items: [
      {
        sourceProductId: "5",
        active: true,
        status: "completed",
      },
    ],
  },
  candidate: dailyCandidate,
  publicPayloads: {
    catalog: {
      products: [
        {
          id: "smokingpipes-5",
          source: "smokingpipes",
          sourceProductId: "5",
          inventoryStatus: "available",
          publicIndexEligible: true,
          publiclySellable: true,
          mainImage: "https://example.com/5.jpg",
          sourcePriceAmount: 200,
          siteDisplayAmount: 2000,
          siteDisplayReady: true,
        },
        {
          id: "smokingpipes-2",
          source: "smokingpipes",
          sourceProductId: "2",
          inventoryStatus: "sold",
          publicIndexEligible: true,
          publiclySellable: false,
          mainImage: "https://example.com/2.jpg",
          sourcePriceAmount: 100,
          siteDisplayAmount: 1000,
          siteDisplayReady: true,
        },
        {
          id: "smokingpipes-4",
          source: "smokingpipes",
          sourceProductId: "4",
          inventoryStatus: "sold",
          publicIndexEligible: true,
          publiclySellable: false,
          mainImage: "https://example.com/4.jpg",
          sourcePriceAmount: 100,
          siteDisplayAmount: 1000,
          siteDisplayReady: true,
        },
      ],
    },
    recentNew: {
      products: [
        {
          id: "smokingpipes-5",
          sourceProductId: "5",
          inventoryStatus: "available",
        },
      ],
    },
  },
});
assert.equal(dailyAudit.verdict, "PASS");
assert.equal(dailyAudit.blockers.length, 0);
assert.equal(dailyAudit.counts.recentNewSold, 0);

const dailyTiming = buildDailyTimingSummary({
  startedAt: "2026-06-22T00:00:00.000Z",
  listStartedAt: "2026-06-22T00:00:01.000Z",
  listEndedAt: "2026-06-22T00:05:22.000Z",
  pagesScanned: 107,
  detailStartedAt: "2026-06-22T00:05:23.000Z",
  detailEndedAt: "2026-06-22T00:05:43.000Z",
  detailsAttempted: 2,
  finishedAt: "2026-06-22T00:05:45.000Z",
});
assert.equal(dailyTiming.list.durationSeconds, 321);
assert.equal(dailyTiming.list.avgSecondsPerPage, 3);
assert.equal(dailyTiming.details.durationSeconds, 20);
assert.equal(dailyTiming.details.avgSecondsPerDetail, 10);
assert.equal(dailyTiming.totalDurationSeconds, 345);

const dailyConflictAudit = buildSmokingpipesDailyAudit({
  productionProducts: candidateExistingProducts,
  currentPayload: candidateCurrentPayload,
  dailyDiff: {
    ...candidateDiff,
    dailyNewIds: ["9"],
    newIds: ["9"],
  },
  queue: {
    items: [
      {
        sourceProductId: "9",
        active: true,
        status: "completed",
      },
    ],
  },
  candidate: {
    products: [],
    readiness: {
      products: [
        {
          sourceProductId: "9",
          sourceSpecific: {
            smokingpipes: {
              baselineReadinessCategory: "inventoryConflict",
            },
          },
        },
      ],
      counts: {
        inventoryConflict: 1,
        reviewOnly: 1,
      },
    },
  },
  publicPayloads: {
    catalog: {
      products: [
        {
          id: "smokingpipes-9",
          source: "smokingpipes",
          sourceProductId: "9",
          inventoryStatus: "available",
          publiclySellable: true,
          mainImage: "https://example.com/9.jpg",
          sourcePriceAmount: 100,
          siteDisplayAmount: 1000,
          siteDisplayReady: true,
        },
      ],
    },
    recentNew: { products: [] },
  },
});
assert.equal(dailyConflictAudit.verdict, "FAIL");
assert.equal(dailyConflictAudit.counts.inventoryConflictInCatalog, 1);

assert.throws(
  () =>
    buildSmokingpipesApplyCandidate({
      existingProducts: candidateExistingProducts,
      currentPayload: {
        ...candidateCurrentPayload,
        summary: {
          ...candidateCurrentPayload.summary,
          fullExpectedRangeScanned: false,
        },
      },
      diff: {
        ...candidateDiff,
        allowApply: false,
        coverage: { fullExpectedRangeScanned: false },
      },
      inventoryValidation: { status: "blocked", allowApply: false },
      queue: { items: [] },
      convertedNewProducts: [],
      conversionFailures: [],
    }),
  /full expected page range|validation/i
);

const publicNextValidation = validatePublicProductsNextCandidate({
  catalog: {
    schemaVersion: 1,
    products: [
      {
        id: "smokingpipes-5",
        source: "smokingpipes",
        sourceProductId: "5",
        inventoryStatus: "available",
        brandName: "Test Brand",
        brandSlug: "test-brand",
      },
    ],
  },
  filters: {
    schemaVersion: 1,
    options: {
      brand: [
        {
          value: "test-brand",
          label: "Test Brand",
          productCount: 1,
        },
      ],
    },
  },
  brands: {
    schemaVersion: 1,
    brands: [
      {
        brandName: "Test Brand",
        brandSlug: "test-brand",
        productCount: 1,
        productIds: ["smokingpipes-5"],
      },
    ],
  },
  recentNew: {
    schemaVersion: 1,
    products: [
      {
        id: "smokingpipes-5",
        sourceProductId: "5",
      },
    ],
  },
});
assert.equal(publicNextValidation.status, "passed");
assert.deepEqual(publicNextValidation.errors, []);

const reviewOnlyLeakRegressionProducts = [
  {
    ...convertedNewProduct,
    id: "smokingpipes-275439",
    sourceProductId: "275439",
    listingEligible: false,
    publication: {
      status: "excluded",
      listingEligible: false,
      reason: "One or more required brand/shape/material fields are missing.",
    },
    sourceSpecific: {
      smokingpipes: {
        baselineReadinessCategory: "missingRequiredFields",
        baselineReadinessReason:
          "One or more required brand/shape/material fields are missing.",
        pricePending: false,
      },
    },
  },
  {
    ...convertedNewProduct,
    id: "smokingpipes-275446",
    sourceProductId: "275446",
    imageUrl: "",
    galleryImages: [],
    listingEligible: false,
    publication: {
      status: "excluded",
      listingEligible: false,
      reason: "Main product image is missing.",
    },
    sourceSpecific: {
      smokingpipes: {
        baselineReadinessCategory: "missingImage",
        baselineReadinessReason: "Main product image is missing.",
        pricePending: false,
      },
    },
  },
  {
    ...convertedNewProduct,
    id: "smokingpipes-726899",
    sourceProductId: "726899",
    listingEligible: false,
    publication: {
      status: "excluded",
      listingEligible: false,
      reason:
        "Current-list price is missing; product remains not sold and requires price review.",
    },
    sourceSpecific: {
      smokingpipes: {
        baselineReadinessCategory: "missingPrice",
        baselineReadinessReason:
          "Current-list price is missing; product remains not sold and requires price review.",
        pricePending: true,
      },
    },
  },
];
const reviewOnlyLeakRegressionRows = buildUnifiedProductsFromInputs({
  danishProducts: [],
  smokingpipesProducts: reviewOnlyLeakRegressionProducts,
});
assert.deepEqual(
  reviewOnlyLeakRegressionRows.map((row) => ({
    sourceProductId: row.sourceProductId,
    listingEligible: row.inventory.listingEligible,
  })),
  [
    { sourceProductId: "275439", listingEligible: false },
    { sourceProductId: "275446", listingEligible: false },
    { sourceProductId: "726899", listingEligible: false },
  ],
  "baseline review-only products must remain excluded after unified staging"
);
const reviewOnlyLeakPublicCandidate = buildPublicProductsCandidate(
  reviewOnlyLeakRegressionRows,
  await loadPublicProductsPricingContext()
);
const leakedSourceProductIds = new Set(["275439", "275446", "726899"]);
assert.deepEqual(
  reviewOnlyLeakPublicCandidate.catalog.products.filter((product) =>
    leakedSourceProductIds.has(product.sourceProductId)
  ),
  [],
  "275439, 275446, and 726899 must not enter public catalog"
);
const reviewOnlyLeakRecentNew = reviewOnlyLeakPublicCandidate.catalog.products.filter(
  (product) => leakedSourceProductIds.has(product.sourceProductId)
);
assert.deepEqual(
  reviewOnlyLeakRecentNew,
  [],
  "275439, 275446, and 726899 must not enter recent-new"
);
const reviewOnlyLeakValidation = validatePublicProductsNextCandidate({
  catalog: {
    schemaVersion: 1,
    products: reviewOnlyLeakRegressionProducts.map((product) => ({
      id: product.id,
      source: product.source,
      sourceProductId: product.sourceProductId,
      inventoryStatus: "available",
    })),
  },
  filters: { schemaVersion: 1, options: {} },
  brands: { schemaVersion: 1, brands: [] },
  recentNew: {
    schemaVersion: 1,
    products: reviewOnlyLeakRegressionProducts.map((product) => ({
      id: product.id,
      sourceProductId: product.sourceProductId,
    })),
  },
  smokingpipesProducts: reviewOnlyLeakRegressionProducts,
  publicReadyProducts: [],
});
assert.equal(reviewOnlyLeakValidation.status, "failed");
assert.match(
  reviewOnlyLeakValidation.errors.join("\n"),
  /review-only|not public-ready/i
);

const soldReferenceRows = buildUnifiedProductsFromInputs({
  danishProducts: [
    {
      id: "991001",
      status: "sold",
      title: "Legacy Danish Sold Reference",
      brand: "Test Danish",
      sourceUrl: "https://example.com/danish-991001",
      imageUrl: "https://example.com/danish-991001.jpg",
      price: {
        amount: 100,
        currency: "EUR",
        siteDisplayAmount: 1000,
        siteDisplayCurrency: "CNY",
        siteDisplayReady: true,
      },
    },
  ],
  smokingpipesProducts: [
    {
      ...convertedNewProduct,
      id: "smokingpipes-991002",
      sourceProductId: "991002",
      inventoryStatus: "sold",
      inventoryConfidence: "full-list-disappeared",
      listingEligible: false,
      publication: {
        status: "excluded",
        listingEligible: false,
        reason: "Product disappeared from the complete current-list snapshot.",
      },
    },
  ],
});
assert.deepEqual(
  soldReferenceRows.map((row) => ({
    source: row.source,
    status: row.inventory.status,
    publicIndexEligible: row.inventory.publicIndexEligible,
    publiclySellable: row.inventory.publiclySellable,
  })),
  [
    {
      source: "danish",
      status: "sold",
      publicIndexEligible: true,
      publiclySellable: false,
    },
    {
      source: "smokingpipes",
      status: "sold",
      publicIndexEligible: true,
      publiclySellable: false,
    },
  ],
  "sold references must remain indexable but not sellable"
);
const soldReferencePublicCandidate = buildPublicProductsCandidate(
  soldReferenceRows,
  await loadPublicProductsPricingContext()
);
assert.deepEqual(
  soldReferencePublicCandidate.catalog.products.map((product) => ({
    id: product.id,
    inventoryStatus: product.inventoryStatus,
    publicIndexEligible: product.publicIndexEligible,
    publiclySellable: product.publiclySellable,
  })),
  [
    {
      id: "danish-991001",
      inventoryStatus: "sold",
      publicIndexEligible: true,
      publiclySellable: false,
    },
    {
      id: "smokingpipes-991002",
      inventoryStatus: "sold",
      publicIndexEligible: true,
      publiclySellable: false,
    },
  ],
  "public catalog must retain sold Danish and Smokingpipes references"
);
const soldReferenceValidation = validatePublicProductsNextCandidate({
  ...soldReferencePublicCandidate,
  recentNew: { schemaVersion: 1, products: [] },
  smokingpipesProducts: [
    {
      ...convertedNewProduct,
      id: "smokingpipes-991002",
      sourceProductId: "991002",
      inventoryStatus: "sold",
      inventoryConfidence: "full-list-disappeared",
      publicIndexEligible: true,
    },
  ],
  publicReadyProducts: [],
});
assert.equal(
  soldReferenceValidation.status,
  "passed",
  soldReferenceValidation.errors.join("\n")
);

const syntheticNewDetail = {
  sourceProductId: "900001",
  sourceUrl:
    "https://www.smokingpipes.com/pipes/new/savinelli/moreinfo.cfm?product_id=900001",
  productCode: "002-033-900001",
  conditionType: "new",
  brand: "Savinelli",
  title: "Test Billiard Smooth",
  fullTitle: "Savinelli: Test Billiard Smooth",
  price: "$150.00",
  originalPrice: "",
  msrp: "$180.00",
  status: "available",
  mainImageUrl: "https://example.com/900001.jpg",
  galleryImages: [
    "https://example.com/900001.jpg",
    "https://example.com/900001-2.jpg",
  ],
  shape: "Billiard",
  finish: "Smooth",
  material: "Briar",
  stemMaterial: "Acrylic",
  filter: "6mm",
  country: "Italy",
  parsedMeasurements: {
    lengthMm: 140,
    weightGrams: 45,
    heightMm: 50,
    chamberDepthMm: 40,
    chamberDiameterMm: 20,
    outsideDiameterMm: 40,
  },
};
const syntheticApplyArtifacts =
  await buildSmokingpipesApplyDryRunArtifacts({
    existingProducts: [],
    currentPayload: {
      summary: {
        fullExpectedRangeScanned: true,
        captchaDetected: false,
        uniqueProducts: 1,
      },
      products: [
        {
          sourceProductId: "900001",
          sourceUrl: syntheticNewDetail.sourceUrl,
          title: syntheticNewDetail.title,
          price: "$150.00",
          mainImage: syntheticNewDetail.mainImageUrl,
          rawListStatus: "",
          listPage: 1,
          listPosition: 1,
        },
      ],
    },
    diff: {
      allowApply: true,
      fatalWarnings: [],
      newIds: ["900001"],
      disappearedIds: [],
      coverage: { fullExpectedRangeScanned: true },
      counts: {
        currentAvailable: 1,
        new: 1,
        disappeared: 0,
      },
    },
    inventoryValidation: { status: "passed", allowApply: true },
    queue: {
      items: [
        {
          sourceProductId: "900001",
          active: true,
          status: "completed",
          detail: syntheticNewDetail,
        },
      ],
    },
    danishProducts: [],
  });
assert.equal(syntheticApplyArtifacts.conversion.failures.length, 0);
assert.equal(syntheticApplyArtifacts.candidate.stats.addedProducts, 1);
assert.equal(
  syntheticApplyArtifacts.publicPayloads.validation.status,
  "passed"
);
assert.equal(
  syntheticApplyArtifacts.publicPayloads.recentNew.products.length,
  1
);

const isolatedOutputRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "inventory-apply-output-test-")
);
const isolatedOutputPaths = {
  productsNext: path.join(
    isolatedOutputRoot,
    "data",
    "products",
    "smokingpipes-products.next-dry-run.json"
  ),
  publicNextRoot: path.join(
    isolatedOutputRoot,
    "data",
    "generated",
    "public-products-next"
  ),
  applyReport: path.join(
    isolatedOutputRoot,
    "data",
    "review",
    "smokingpipes-apply-dry-run-report-v1.md"
  ),
};
const pendingOutputRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "inventory-pending-output-test-")
);
const pendingOutputPaths = {
  productsNext: path.join(
    pendingOutputRoot,
    "data",
    "products",
    "smokingpipes-products-next-dry-run.json"
  ),
  publicNextRoot: path.join(
    pendingOutputRoot,
    "data",
    "generated",
    "public-products-next"
  ),
  applyReport: path.join(
    pendingOutputRoot,
    "data",
    "review",
    "smokingpipes-apply-dry-run-report-v1.md"
  ),
};
await assert.rejects(
  writeSmokingpipesApplyDryRunOutputs({
    paths: pendingOutputPaths,
    candidate: {
      ...syntheticApplyArtifacts.candidate,
      candidateReady: false,
      blockedReasons: ["new detail queue is incomplete"],
    },
    publicPayloads: syntheticApplyArtifacts.publicPayloads,
    report: "# must remain pending\n",
  }),
  /candidate.*not ready|incomplete/i
);
assert.equal(
  fs.existsSync(path.join(pendingOutputPaths.publicNextRoot, "catalog.json")),
  false,
  "pending catch-up must not generate a final next catalog"
);

await writeSmokingpipesApplyDryRunOutputs({
  paths: isolatedOutputPaths,
  candidate: syntheticApplyArtifacts.candidate,
  publicPayloads: syntheticApplyArtifacts.publicPayloads,
  report: "# isolated apply dry-run test\n",
});
for (const outputFile of [
  isolatedOutputPaths.productsNext,
  path.join(isolatedOutputPaths.publicNextRoot, "catalog.json"),
  path.join(isolatedOutputPaths.publicNextRoot, "filters.json"),
  path.join(isolatedOutputPaths.publicNextRoot, "brands.json"),
  path.join(isolatedOutputPaths.publicNextRoot, "manifest.json"),
  path.join(isolatedOutputPaths.publicNextRoot, "recent-new.json"),
  isolatedOutputPaths.applyReport,
]) {
  assert.equal(fs.existsSync(outputFile), true, `missing ${outputFile}`);
}
await assert.rejects(
  writeSmokingpipesApplyDryRunOutputs({
    paths: {
      ...isolatedOutputPaths,
      productsNext: path.resolve(
        "data/products/smokingpipes-products.json"
      ),
    },
    candidate: syntheticApplyArtifacts.candidate,
    publicPayloads: syntheticApplyArtifacts.publicPayloads,
    report: "# must not write\n",
  }),
  /refusing production/i
);

assert.equal(
  typeof applyDryRunModule.buildSmokingpipesPendingApplyDryRunReport,
  "function"
);
const pendingCatchUpReport =
  applyDryRunModule.buildSmokingpipesPendingApplyDryRunReport({
    runId: "catch-up-pending",
    diff: { counts: { currentAvailable: 10, new: 3 }, newIds: ["1", "2", "3"] },
    queueSummary: { activeItems: 3, completed: 2, pending: 1, failed: 0 },
    detailsResult: { attempted: 2 },
    reasons: ["1 new detail remains incomplete"],
    catchUpCurrent: true,
  });
assert.match(pendingCatchUpReport, /final next outputs generated: false/i);
assert.match(
  pendingCatchUpReport,
  /Continue baseline catch-up before enabling daily update\./
);
const completeCatchUpReport =
  applyDryRunModule.buildSmokingpipesApplyDryRunReport({
    runId: "catch-up-complete",
    artifacts: syntheticApplyArtifacts,
    detailsResult: { attempted: 1 },
    catchUpCurrent: true,
  });
assert.match(completeCatchUpReport, /final next outputs generated: true/i);
assert.match(
  completeCatchUpReport,
  /Review generated next-dry-run outputs before formal apply\./
);

const progressiveNow = "2026-06-23T00:00:00.000Z";
const progressiveState = createProgressiveDailyState({
  dailyRunId: "progressive-test",
  expectedPages: 107,
  now: progressiveNow,
});
assert.equal(
  progressiveState.version,
  "smokingpipes-progressive-daily-state-v1"
);
assert.equal(
  validateProgressiveDailyState(progressiveState).valid,
  true
);
assert.equal(
  validateProgressiveDailyState({
    ...progressiveState,
    version: "unknown",
  }).status,
  "blocked"
);
const malformedProgressiveRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "inventory-progressive-malformed-")
);
const malformedProgressivePath = path.join(
  malformedProgressiveRoot,
  "state.json"
);
fs.writeFileSync(
  malformedProgressivePath,
  "{malformed-json",
  "utf8"
);
assert.equal(
  readProgressiveDailyState(malformedProgressivePath).status,
  "blocked"
);
assert.equal(
  fs.readFileSync(malformedProgressivePath, "utf8"),
  "{malformed-json"
);
assert.equal(
  validateProgressiveDailyState({
    ...progressiveState,
    candidates: [
      {
        sourceProductId: "1",
        detailStatus: "pending",
        publicStatus: "not-public",
        changeTypes: ["new-product"],
        detailAttempts: 0,
        blockedCount: 0,
      },
      {
        sourceProductId: "1",
        detailStatus: "pending",
        publicStatus: "not-public",
        changeTypes: ["new-product"],
        detailAttempts: 0,
        blockedCount: 0,
      },
    ],
  }).status,
  "blocked"
);

const progressiveProduction = [
  {
    id: "smokingpipes-100",
    source: "smokingpipes",
    sourceProductId: "100",
    inventoryStatus: "available",
    price: {
      current: {
        rawText: "$100.00",
        currency: "USD",
        amount: 100,
        parseStatus: "parsed",
      },
    },
    fullTitle: "Existing complete title",
    galleryImages: ["https://example.invalid/100.jpg"],
  },
  {
    id: "smokingpipes-101",
    source: "smokingpipes",
    sourceProductId: "101",
    inventoryStatus: "sold",
    fullTitle: "Previously sold",
    price: {
      current: {
        rawText: "$100.00",
        currency: "USD",
        amount: 100,
        parseStatus: "parsed",
      },
    },
  },
  {
    id: "smokingpipes-102",
    source: "smokingpipes",
    sourceProductId: "102",
    inventoryStatus: "available",
    fullTitle: "Absent from partial scan",
    price: {
      current: {
        rawText: "$102.00",
        currency: "USD",
        amount: 102,
        parseStatus: "parsed",
      },
    },
  },
];
const progressivePartialCurrent = {
  generatedAt: progressiveNow,
  summary: {
    pagesScanned: 2,
    expectedPages: 107,
    fullExpectedRangeScanned: false,
    captchaDetected: true,
    captchaPages: [3],
  },
  products: [
    {
      sourceProductId: "100",
      sourceUrl: "https://example.invalid/100",
      title: "List title must not overwrite details",
      price: "$110.00",
      imageUrl: "https://example.invalid/list-100.jpg",
      rawText: "Available",
    },
    {
      sourceProductId: "101",
      sourceUrl: "https://example.invalid/101",
      title: "Reappeared",
      price: "$120.00",
      imageUrl: "https://example.invalid/list-101.jpg",
      rawText: "Available",
    },
    ...Array.from({ length: 5 }, (_, index) => ({
      sourceProductId: String(200 + index),
      sourceUrl: `https://example.invalid/${200 + index}`,
      title: `New pipe ${index + 1}`,
      price: `$${200 + index}.00`,
      imageUrl: `https://example.invalid/${200 + index}.jpg`,
      rawText: "Available",
    })),
  ],
};
const ingestedProgressive = ingestProgressiveListSnapshot({
  state: progressiveState,
  currentPayload: progressivePartialCurrent,
  productionProducts: progressiveProduction,
  runId: "progressive-list-1",
  now: progressiveNow,
});
assert.equal(ingestedProgressive.listSnapshotStatus, "blocked");
assert.deepEqual(
  ingestedProgressive.globalReconcile.disappearedIds,
  []
);
assert.deepEqual(
  ingestedProgressive.candidates.find(
    (item) => item.sourceProductId === "100"
  ).changeTypes,
  ["price-change"]
);
assert.deepEqual(
  ingestedProgressive.candidates.find(
    (item) => item.sourceProductId === "101"
  ).changeTypes.sort(),
  ["price-change", "reappeared"]
);
assert.equal(
  ingestProgressiveListSnapshot({
    state: ingestedProgressive,
    currentPayload: progressivePartialCurrent,
    productionProducts: progressiveProduction,
    runId: "progressive-list-1",
    now: progressiveNow,
  }).candidates.length,
  ingestedProgressive.candidates.length
);

const progressiveCheckpointSnapshots = [];
const progressiveChunk = await runProgressiveDetailChunk({
  state: ingestedProgressive,
  maxItems: 5,
  now: progressiveNow,
  checkpoint: async (state) => {
    progressiveCheckpointSnapshots.push(
      structuredClone(state)
    );
  },
  processDetail: async (candidate, index) => {
    if (index === 3) {
      throw Object.assign(
        new Error("strong verification"),
        { code: "CAPTCHA_REQUIRED" }
      );
    }
    return {
      detail: {
        sourceProductId: candidate.sourceProductId,
        fullTitle: candidate.listTitle,
      },
      convertedProduct: {
        id: `smokingpipes-${candidate.sourceProductId}`,
        source: "smokingpipes",
        sourceProductId: candidate.sourceProductId,
        fullTitle: candidate.listTitle,
        inventoryStatus: "available",
        publication: {
          publicIndexEligible: true,
          publiclySellable: true,
        },
        mainImageUrl: candidate.listPrimaryImage,
        galleryImages: [candidate.listPrimaryImage],
        price: {
          current: {
            rawText: candidate.listPrice,
            currency: "USD",
            amount: Number(candidate.sourceProductId),
            parseStatus: "parsed",
          },
        },
      },
      publicReady: true,
    };
  },
});
assert.equal(progressiveChunk.status, "blocked");
assert.equal(progressiveChunk.completedThisRun, 3);
assert.equal(progressiveCheckpointSnapshots.length, 4);
const progressiveAfterBlocked = progressiveChunk.state;
assert.equal(
  progressiveAfterBlocked.candidates.filter(
    (item) =>
      item.changeTypes.includes("new-product") &&
      item.detailStatus === "complete"
  ).length,
  3
);
const progressiveBlockedCandidate =
  progressiveAfterBlocked.candidates.find(
    (item) => item.detailStatus === "blocked"
  );
assert.equal(progressiveBlockedCandidate.blockedCount, 1);
assert.equal(
  progressiveBlockedCandidate.lastBlockedReason,
  "strong verification"
);
assert.ok(progressiveBlockedCandidate.nextEligibleAt);
assert.ok(progressiveChunk.recommendedNextRunAt);
assert.equal(
  summarizeProgressiveState(progressiveAfterBlocked)
    .detailsCompletedTotal,
  3
);
const progressiveRelay = await runProgressiveDetailChunk({
  state: progressiveAfterBlocked,
  maxItems: 1,
  now: "2026-06-23T02:00:00.000Z",
  checkpoint: async () => {},
  processDetail: async (candidate) => ({
    detail: {
      sourceProductId: candidate.sourceProductId,
      fullTitle: candidate.listTitle,
    },
    convertedProduct: {
      id: `smokingpipes-${candidate.sourceProductId}`,
      source: "smokingpipes",
      sourceProductId: candidate.sourceProductId,
      fullTitle: candidate.listTitle,
      inventoryStatus: "available",
      publication: {
        publicIndexEligible: true,
        publiclySellable: true,
      },
      mainImageUrl: candidate.listPrimaryImage,
      galleryImages: [candidate.listPrimaryImage],
      price: {
        current: {
          rawText: candidate.listPrice,
          currency: "USD",
          amount: Number(candidate.sourceProductId),
          parseStatus: "parsed",
        },
      },
    },
    publicReady: true,
  }),
});
assert.equal(progressiveRelay.completedThisRun, 1);
const progressiveRecoveredBlocked =
  progressiveRelay.state.candidates.find(
    (item) =>
      item.sourceProductId ===
      progressiveBlockedCandidate.sourceProductId
  );
assert.equal(progressiveRecoveredBlocked.detailStatus, "complete");
assert.equal(progressiveRecoveredBlocked.blockedCount, 1);
assert.equal(
  progressiveRecoveredBlocked.lastBlockedReason,
  "strong verification"
);
assert.ok(progressiveRecoveredBlocked.lastBlockedAt);

const progressiveClassificationState =
  ingestProgressiveListSnapshot({
    state: createProgressiveDailyState({
      dailyRunId: "progressive-public-status",
      now: progressiveNow,
    }),
    currentPayload: {
      generatedAt: progressiveNow,
      summary: {
        pagesScanned: 1,
        expectedPages: 107,
        fullExpectedRangeScanned: false,
        captchaDetected: false,
        captchaPages: [],
      },
      products: [
        {
          sourceProductId: "728182",
          sourceUrl: "https://example.invalid/728182",
          title: "Public ready new pipe",
          price: "$172.00",
          imageUrl: "https://example.invalid/728182.jpg",
          rawText: "Available",
        },
        {
          sourceProductId: "676033",
          sourceUrl: "https://example.invalid/676033",
          title: "Inventory conflict pipe 1",
          price: "$168.50",
          imageUrl: "https://example.invalid/676033.jpg",
          rawText: "Available",
        },
        {
          sourceProductId: "676034",
          sourceUrl: "https://example.invalid/676034",
          title: "Inventory conflict pipe 2",
          price: "$143.00",
          imageUrl: "https://example.invalid/676034.jpg",
          rawText: "Available",
        },
      ],
    },
    diffPayload: {
      newIds: ["728182", "676033", "676034"],
      reappearedIds: [],
      disappearedIds: [],
      coverage: {
        pagesScanned: 1,
        expectedPages: 107,
        fullExpectedRangeScanned: false,
        captchaDetected: false,
      },
    },
    productionProducts: progressiveProduction,
    runId: "progressive-public-status",
    now: progressiveNow,
  });
const progressiveClassified =
  await runProgressiveDetailChunk({
    state: progressiveClassificationState,
    maxItems: 3,
    now: progressiveNow,
    checkpoint: async () => {},
    processDetail: async (candidate) => {
      const commonProduct = {
        id: `smokingpipes-${candidate.sourceProductId}`,
        source: "smokingpipes",
        sourceProductId: candidate.sourceProductId,
        sourceUrl: candidate.sourceUrl,
        fullTitle: candidate.listTitle,
        listingEligible: true,
        imageUrl: candidate.listPrimaryImage,
        mainImageUrl: candidate.listPrimaryImage,
        galleryImages: [candidate.listPrimaryImage],
        price: {
          current: {
            rawText: candidate.listPrice,
            currency: "USD",
            amount: Number.parseFloat(
              candidate.listPrice.replace(/[^0-9.]/g, "")
            ),
            parseStatus: "parsed",
          },
        },
        publication: {
          listingEligible: true,
        },
      };
      if (candidate.sourceProductId === "728182") {
        return {
          detail: {
            sourceProductId: candidate.sourceProductId,
            fullTitle: candidate.listTitle,
          },
          convertedProduct: {
            ...commonProduct,
            inventoryStatus: "available",
            inventoryConfidence: "high",
            inventoryReviewReasons: [],
            rawBrand: "",
            brandReviewStatus: "needs-review",
            brandIndexEligible: false,
          },
        };
      }
      return {
        detail: {
          sourceProductId: candidate.sourceProductId,
          fullTitle: candidate.listTitle,
        },
        convertedProduct: {
          ...commonProduct,
          inventoryStatus: "needs-review",
          inventoryConfidence: "conflicting-signals",
          listingEligible: false,
          publication: {
            listingEligible: false,
          },
          inventoryReviewReasons: [
            "Detail page says sold while the product remains in the active list range.",
          ],
        },
      };
    },
  });
const classifiedReady =
  progressiveClassified.state.candidates.find(
    (item) => item.sourceProductId === "728182"
  );
assert.equal(classifiedReady.detailStatus, "complete");
assert.equal(classifiedReady.publicStatus, "ready");
assert.match(
  classifiedReady.readyReason,
  /listingEligible|available|valid price|image/i
);
assert.equal(classifiedReady.lastError, null);
for (const id of ["676033", "676034"]) {
  const conflict =
    progressiveClassified.state.candidates.find(
      (item) => item.sourceProductId === id
    );
  assert.equal(conflict.detailStatus, "complete");
  assert.equal(conflict.publicStatus, "review-only");
  assert.match(
    conflict.reviewReason,
    /inventory conflict|Detail page says sold while the product remains in the active list range/i
  );
}

const progressiveFullScan = ingestProgressiveListSnapshot({
  state: createProgressiveDailyState({
    dailyRunId: "progressive-full",
    now: progressiveNow,
  }),
  currentPayload: {
    generatedAt: progressiveNow,
    summary: {
      pagesScanned: 107,
      expectedPages: 107,
      fullExpectedRangeScanned: true,
      captchaDetected: false,
      captchaPages: [],
    },
    products: [
      {
        sourceProductId: "100",
        sourceUrl: "https://example.invalid/100",
        title: "Existing",
        price: "$100.00",
        rawText: "Available",
      },
    ],
  },
  productionProducts: progressiveProduction,
  runId: "progressive-full",
  now: progressiveNow,
});
assert.deepEqual(
  progressiveFullScan.globalReconcile.disappearedIds,
  ["102"]
);

const progressiveCandidateBuild1 =
  buildProgressivePartialProducts({
    productionProducts: progressiveProduction,
    state: progressiveAfterBlocked,
    now: "2026-06-23T01:00:00.000Z",
  });
const progressiveCandidateBuild2 =
  buildProgressivePartialProducts({
    productionProducts: progressiveProduction,
    state: progressiveAfterBlocked,
    now: "2026-06-23T01:00:00.000Z",
  });
assert.deepEqual(
  progressiveCandidateBuild2,
  progressiveCandidateBuild1
);
assert.deepEqual(
  buildProgressivePartialProducts({
    productionProducts: progressiveProduction,
    state: progressiveAfterBlocked,
  }),
  buildProgressivePartialProducts({
    productionProducts: progressiveProduction,
    state: progressiveAfterBlocked,
  })
);
assert.equal(
  buildProgressivePartialProducts({
    productionProducts: progressiveProduction,
    state: progressiveAfterBlocked,
  }).generatedAt,
  progressiveAfterBlocked.updatedAt
);
assert.equal(
  progressiveCandidateBuild1.products.length,
  progressiveProduction.length + 3
);
assert.equal(
  new Set(
    progressiveCandidateBuild1.products.map(
      (item) => item.sourceProductId
    )
  ).size,
  progressiveCandidateBuild1.products.length
);
const progressiveExistingPriceUpdate =
  progressiveCandidateBuild1.products.find(
    (item) => item.sourceProductId === "100"
  );
assert.equal(
  progressiveExistingPriceUpdate.fullTitle,
  "Existing complete title"
);
assert.deepEqual(
  progressiveExistingPriceUpdate.galleryImages,
  ["https://example.invalid/100.jpg"]
);
assert.equal(
  progressiveExistingPriceUpdate.price.current.amount,
  110
);
const progressiveReappeared =
  progressiveCandidateBuild1.products.find(
    (item) => item.sourceProductId === "101"
  );
assert.equal(progressiveReappeared.inventoryStatus, "available");
assert.equal(
  progressiveCandidateBuild1.products.some(
    (item) => item.sourceProductId === "203"
  ),
  false
);
assert.equal(
  progressiveCandidateBuild1.products.some(
    (item) => item.sourceProductId === "204"
  ),
  false
);

const progressivePublicCatalog = {
  products: progressiveCandidateBuild1.products.map((item) => ({
    id: item.id,
    source: item.source,
    sourceProductId: item.sourceProductId,
    inventoryStatus: item.inventoryStatus,
    publicIndexEligible: true,
    publiclySellable: item.inventoryStatus === "available",
    sourcePriceAmount:
      item.price?.current?.amount || null,
    siteDisplayAmount:
      item.inventoryStatus === "available" ? 1000 : null,
    siteDisplayReady: item.inventoryStatus === "available",
  })),
};
const progressiveRecentNew = selectProgressiveRecentNew({
  catalog: progressivePublicCatalog.products,
  newProductIds:
    progressiveCandidateBuild1.newProductIds,
});
assert.equal(progressiveRecentNew.length, 3);
assert.equal(
  new Set(progressiveRecentNew.map((item) => item.id)).size,
  3
);
const progressiveAudit = auditProgressivePartialCandidate({
  productionProducts: progressiveProduction,
  candidateProducts: progressiveCandidateBuild1.products,
  state: progressiveAfterBlocked,
  publicCatalog: progressivePublicCatalog.products,
  recentNew: progressiveRecentNew,
});
assert.equal(progressiveAudit.verdict, "PASS");
assert.equal(progressiveAudit.newProductReady, 3);
assert.equal(progressiveAudit.newProductReviewOnly, 0);
assert.equal(progressiveAudit.newProductNotReady, 2);
assert.ok(Array.isArray(progressiveAudit.filteredNewProducts));
assert.ok(
  progressiveAudit.filteredNewProducts.some(
    (item) =>
      item.sourceProductId === "203" &&
      item.publicStatus === "not-public"
  )
);
assert.deepEqual(progressiveAudit.counts, {
  deletedProducts: 0,
  pendingLeak: 0,
  failedLeak: 0,
  blockedLeak: 0,
  reviewOnlyLeak: 0,
  zeroPriceSellable: 0,
});
const progressiveLeakState = structuredClone(
  progressiveAfterBlocked
);
const progressivePendingLeak =
  progressiveLeakState.candidates.find(
    (item) => item.sourceProductId === "204"
  );
progressivePendingLeak.detailStatus = "review-only";
progressivePendingLeak.publicStatus = "review-only";
const progressiveLeakAudit =
  auditProgressivePartialCandidate({
    productionProducts: progressiveProduction,
    candidateProducts:
      progressiveCandidateBuild1.products,
    state: progressiveLeakState,
    publicCatalog: [
      ...progressivePublicCatalog.products,
      {
        id: "smokingpipes-204",
        source: "smokingpipes",
        sourceProductId: "204",
        inventoryStatus: "available",
        publiclySellable: true,
        sourcePriceAmount: 204,
        siteDisplayAmount: 1000,
        siteDisplayReady: true,
      },
    ],
    recentNew: progressiveRecentNew,
  });
assert.equal(progressiveLeakAudit.verdict, "FAIL");
assert.equal(progressiveLeakAudit.counts.reviewOnlyLeak, 1);
assert.equal(
  buildProgressivePartialApplyPreview({
    state: progressiveLeakState,
    audit: progressiveLeakAudit,
    productionProducts: progressiveProduction,
    candidateProducts:
      progressiveCandidateBuild1.products,
  }).status,
  "blocked"
);
const progressiveApplyPreview =
  buildProgressivePartialApplyPreview({
    state: progressiveAfterBlocked,
    audit: progressiveAudit,
    productionProducts: progressiveProduction,
    candidateProducts:
      progressiveCandidateBuild1.products,
    now: "2026-06-23T02:00:00.000Z",
  });
assert.equal(progressiveApplyPreview.status, "preview-ready");
assert.equal(
  progressiveApplyPreview.candidateCount,
  progressiveApplyPreview.wouldApplyCount
);
assert.equal(progressiveApplyPreview.productionWritten, false);
assert.equal(progressiveApplyPreview.commitPerformed, false);
assert.equal(progressiveApplyPreview.pushPerformed, false);
assert.equal(
  progressiveAfterBlocked.candidates.some(
    (item) =>
      item.publicStatus === "published" ||
      item.lastAppliedAt ||
      item.appliedInCommit
  ),
  false
);

const progressiveApplyRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "inventory-progressive-apply-")
);
const progressiveApplyPaths = runnerCore.getRunnerPaths(
  progressiveApplyRoot
);
const progressiveApplyProduction = [
  {
    id: "smokingpipes-100",
    source: "smokingpipes",
    sourceProductId: "100",
    inventoryStatus: "available",
    price: {
      current: {
        rawText: "$100.00",
        currency: "USD",
        amount: 100,
        parseStatus: "parsed",
      },
    },
  },
];
const progressiveApplyCandidateProducts = [
  {
    ...progressiveApplyProduction[0],
    price: {
      current: {
        rawText: "$110.00",
        currency: "USD",
        amount: 110,
        parseStatus: "parsed",
      },
    },
  },
  {
    id: "smokingpipes-200",
    source: "smokingpipes",
    sourceProductId: "200",
    inventoryStatus: "available",
    price: {
      current: {
        rawText: "$200.00",
        currency: "USD",
        amount: 200,
        parseStatus: "parsed",
      },
    },
    imageUrl: "https://example.invalid/200.jpg",
    galleryImages: ["https://example.invalid/200.jpg"],
  },
];
const progressiveApplyState = createProgressiveDailyState({
  dailyRunId: "progressive-apply",
  now: progressiveNow,
});
progressiveApplyState.candidates = [
  {
    sourceProductId: "100",
    sourceUrl: "https://example.invalid/100",
    listTitle: "Price changed",
    listPrice: "$110.00",
    listPrimaryImage: "https://example.invalid/100.jpg",
    inventoryStatus: "available",
    discoveredAt: progressiveNow,
    firstSeenRunId: "progressive-apply",
    lastSeenRunId: "progressive-apply",
    lastSeenAt: progressiveNow,
    changeTypes: ["price-change"],
    detailStatus: "complete",
    publicStatus: "ready",
    detailAttempts: 0,
    retryCount: 0,
    blockedCount: 0,
    priority: 50,
  },
  {
    sourceProductId: "200",
    sourceUrl: "https://example.invalid/200",
    listTitle: "Ready new",
    listPrice: "$200.00",
    listPrimaryImage: "https://example.invalid/200.jpg",
    inventoryStatus: "available",
    discoveredAt: progressiveNow,
    firstSeenRunId: "progressive-apply",
    lastSeenRunId: "progressive-apply",
    lastSeenAt: progressiveNow,
    changeTypes: ["new-product"],
    detailStatus: "complete",
    publicStatus: "ready",
    detailAttempts: 1,
    retryCount: 0,
    blockedCount: 0,
    priority: 100,
    convertedProduct: progressiveApplyCandidateProducts[1],
  },
  {
    sourceProductId: "201",
    sourceUrl: "https://example.invalid/201",
    listTitle: "Review only",
    listPrice: "$201.00",
    listPrimaryImage: "https://example.invalid/201.jpg",
    inventoryStatus: "needs-review",
    discoveredAt: progressiveNow,
    firstSeenRunId: "progressive-apply",
    lastSeenRunId: "progressive-apply",
    lastSeenAt: progressiveNow,
    changeTypes: ["new-product"],
    detailStatus: "complete",
    publicStatus: "review-only",
    detailAttempts: 1,
    retryCount: 0,
    blockedCount: 0,
    priority: 100,
    convertedProduct: {
      id: "smokingpipes-201",
      source: "smokingpipes",
      sourceProductId: "201",
      inventoryStatus: "needs-review",
    },
  },
  {
    sourceProductId: "202",
    sourceUrl: "https://example.invalid/202",
    listTitle: "Failed",
    listPrice: "$202.00",
    listPrimaryImage: "https://example.invalid/202.jpg",
    inventoryStatus: "available",
    discoveredAt: progressiveNow,
    firstSeenRunId: "progressive-apply",
    lastSeenRunId: "progressive-apply",
    lastSeenAt: progressiveNow,
    changeTypes: ["new-product"],
    detailStatus: "failed",
    publicStatus: "not-public",
    detailAttempts: 1,
    retryCount: 1,
    blockedCount: 0,
    priority: 100,
    lastError: "detail parse failed",
  },
];
progressiveApplyState.updatedAt = progressiveNow;
const progressiveApplyAudit = {
  version: "smokingpipes-progressive-partial-audit-v1",
  generatedAt: progressiveNow,
  verdict: "PASS",
  candidateCount: 2,
  wouldApplyCount: 2,
  blockers: [],
  warnings: [],
  counts: {
    deletedProducts: 0,
    pendingLeak: 0,
    failedLeak: 0,
    blockedLeak: 0,
    reviewOnlyLeak: 0,
    zeroPriceSellable: 0,
  },
  newProductReady: 1,
  newProductReviewOnly: 1,
  newProductNotReady: 1,
  productionWritten: false,
};
fs.mkdirSync(path.dirname(progressiveApplyPaths.existingProducts), {
  recursive: true,
});
fs.mkdirSync(path.dirname(progressiveApplyPaths.progressiveState), {
  recursive: true,
});
fs.mkdirSync(path.dirname(progressiveApplyPaths.progressiveAuditJson), {
  recursive: true,
});
fs.mkdirSync(progressiveApplyPaths.progressivePublicNextRoot, {
  recursive: true,
});
fs.mkdirSync(
  path.join(progressiveApplyPaths.progressivePublicNextRoot, "details"),
  { recursive: true }
);
fs.writeFileSync(
  progressiveApplyPaths.existingProducts,
  JSON.stringify(progressiveApplyProduction),
  "utf8"
);
fs.writeFileSync(
  progressiveApplyPaths.progressiveState,
  JSON.stringify(progressiveApplyState),
  "utf8"
);
fs.writeFileSync(
  progressiveApplyPaths.progressiveProductsNext,
  JSON.stringify(progressiveApplyCandidateProducts),
  "utf8"
);
fs.writeFileSync(
  progressiveApplyPaths.progressiveAuditJson,
  JSON.stringify(progressiveApplyAudit),
  "utf8"
);
fs.writeFileSync(
  path.join(
    progressiveApplyPaths.progressivePublicNextRoot,
    "catalog.json"
  ),
  JSON.stringify({
    schemaVersion: 1,
    products: [
      {
        id: "smokingpipes-100",
        source: "smokingpipes",
        sourceProductId: "100",
      },
      {
        id: "smokingpipes-200",
        source: "smokingpipes",
        sourceProductId: "200",
      },
    ],
  }),
  "utf8"
);
for (const name of [
  "filters.json",
  "brands.json",
  "detail-lookup.json",
]) {
  fs.writeFileSync(
    path.join(
      progressiveApplyPaths.progressivePublicNextRoot,
      name
    ),
    JSON.stringify({ schemaVersion: 1 }),
    "utf8"
  );
}
fs.writeFileSync(
  path.join(
    progressiveApplyPaths.progressivePublicNextRoot,
    "recent-new.json"
  ),
  JSON.stringify({
    schemaVersion: 1,
    products: [
      {
        id: "smokingpipes-200",
        source: "smokingpipes",
        sourceProductId: "200",
      },
    ],
  }),
  "utf8"
);
fs.writeFileSync(
  path.join(
    progressiveApplyPaths.progressivePublicNextRoot,
    "details",
    "smokingpipes-0.json"
  ),
  JSON.stringify({
    schemaVersion: 1,
    products: [
      {
        id: "smokingpipes-200",
        sourceProductId: "200",
      },
    ],
  }),
  "utf8"
);
fs.writeFileSync(
  path.join(
    progressiveApplyPaths.progressivePublicNextRoot,
    "manifest.json"
  ),
  JSON.stringify({
    schemaVersion: 1,
    productionWritten: false,
    detailFiles: [
      "data/generated/public-products-partial-next/details/smokingpipes-0.json",
    ],
  }),
  "utf8"
);
const progressiveApplyDefault =
  await runSmokingpipesProgressiveMode({
    root: progressiveApplyRoot,
    options: parseRunnerOptions([
      "--mode=progressive-partial-apply",
    ]),
  });
assert.equal(progressiveApplyDefault.status, "preview-ready");
assert.equal(progressiveApplyDefault.productionWritten, false);
assert.equal(
  JSON.parse(
    fs.readFileSync(
      progressiveApplyPaths.existingProducts,
      "utf8"
    )
  ).some((item) => item.sourceProductId === "200"),
  false
);
const progressiveApplyWriteResult =
  await runSmokingpipesProgressiveMode({
    root: progressiveApplyRoot,
    options: parseRunnerOptions([
      "--mode=progressive-partial-apply",
      "--write-production",
      "--no-commit",
      "--no-deploy",
    ]),
  });
assert.equal(progressiveApplyWriteResult.status, "apply-complete");
assert.equal(progressiveApplyWriteResult.candidateCount, 2);
assert.equal(progressiveApplyWriteResult.wouldApplyCount, 2);
assert.equal(progressiveApplyWriteResult.productionWritten, true);
assert.equal(progressiveApplyWriteResult.commitPerformed, false);
assert.equal(progressiveApplyWriteResult.pushPerformed, false);
const progressiveAppliedProducts = JSON.parse(
  fs.readFileSync(progressiveApplyPaths.existingProducts, "utf8")
);
assert.equal(
  progressiveAppliedProducts.some(
    (item) => item.sourceProductId === "200"
  ),
  true
);
assert.equal(
  progressiveAppliedProducts.some(
    (item) => item.sourceProductId === "201"
  ),
  false
);
assert.equal(
  progressiveAppliedProducts.some(
    (item) => item.sourceProductId === "202"
  ),
  false
);
const progressiveAppliedCatalog = JSON.parse(
  fs.readFileSync(
    path.join(
      progressiveApplyRoot,
      "data",
      "generated",
      "public-products",
      "catalog.json"
    ),
    "utf8"
  )
);
assert.equal(
  progressiveAppliedCatalog.products.some(
    (item) => item.sourceProductId === "200"
  ),
  true
);
const progressiveApplyBlockedRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "inventory-progressive-apply-blocked-")
);
const progressiveApplyBlockedPaths =
  runnerCore.getRunnerPaths(progressiveApplyBlockedRoot);
fs.mkdirSync(
  path.dirname(progressiveApplyBlockedPaths.existingProducts),
  { recursive: true }
);
fs.mkdirSync(
  path.dirname(progressiveApplyBlockedPaths.progressiveState),
  { recursive: true }
);
fs.mkdirSync(
  path.dirname(progressiveApplyBlockedPaths.progressiveAuditJson),
  { recursive: true }
);
fs.mkdirSync(
  progressiveApplyBlockedPaths.progressivePublicNextRoot,
  { recursive: true }
);
fs.writeFileSync(
  progressiveApplyBlockedPaths.existingProducts,
  JSON.stringify(progressiveApplyProduction),
  "utf8"
);
fs.writeFileSync(
  progressiveApplyBlockedPaths.progressiveState,
  JSON.stringify(progressiveApplyState),
  "utf8"
);
fs.writeFileSync(
  progressiveApplyBlockedPaths.progressiveProductsNext,
  JSON.stringify(progressiveApplyCandidateProducts),
  "utf8"
);
fs.writeFileSync(
  progressiveApplyBlockedPaths.progressiveAuditJson,
  JSON.stringify({
    ...progressiveApplyAudit,
    verdict: "FAIL",
    blockers: ["reviewOnlyLeak=1"],
  }),
  "utf8"
);
const progressiveApplyBlocked =
  await runSmokingpipesProgressiveMode({
    root: progressiveApplyBlockedRoot,
    options: parseRunnerOptions([
      "--mode=progressive-partial-apply",
      "--write-production",
    ]),
  });
assert.equal(progressiveApplyBlocked.status, "apply-blocked");
assert.equal(progressiveApplyBlocked.productionWritten, false);
assert.equal(
  JSON.parse(
    fs.readFileSync(
      progressiveApplyBlockedPaths.existingProducts,
      "utf8"
    )
  ).some((item) => item.sourceProductId === "200"),
  false
);
for (const mode of [
  "progressive-ingest-list",
  "progressive-detail-chunk",
  "progressive-build-candidate",
  "progressive-partial-apply",
]) {
  assert.equal(
    parseRunnerOptions([`--mode=${mode}`]).mode,
    mode
  );
}
assert.equal(
  parseRunnerOptions([
    "--mode=progressive-detail-chunk",
  ]).progressiveDetailMax,
  5
);
assert.equal(
  parseRunnerOptions([
    "--mode=progressive-detail-chunk",
    "--progressive-detail-max=3",
  ]).progressiveDetailMax,
  3
);
const progressivePaths = runnerCore.getRunnerPaths(
  "C:\\progressive-test",
  { mock: false }
);
assert.match(
  progressivePaths.progressiveState,
  /smokingpipes-progressive-daily-state\.json$/
);
assert.match(
  progressivePaths.progressiveProductsNext,
  /smokingpipes-products-partial-next-dry-run\.json$/
);
assert.match(
  progressivePaths.progressiveAuditMarkdown,
  /smokingpipes-progressive-partial-audit-report\.md$/
);
assert.match(
  progressivePaths.progressiveApplyPreview,
  /smokingpipes-progressive-partial-apply-preview\.json$/
);

const progressiveIngestOptions = parseRunnerOptions([
  "--mode=progressive-ingest-list",
  "--current-list=data/inventory/custom-current.json",
  "--diff=data/inventory/custom-diff.json",
]);
assert.equal(
  progressiveIngestOptions.currentListPath,
  path.resolve("data/inventory/custom-current.json")
);
assert.equal(
  progressiveIngestOptions.diffPath,
  path.resolve("data/inventory/custom-diff.json")
);

const progressiveIngestRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "inventory-progressive-ingest-")
);
const progressiveIngestCurrentPath = path.join(
  progressiveIngestRoot,
  "fixtures",
  "current.json"
);
const progressiveIngestDiffPath = path.join(
  progressiveIngestRoot,
  "fixtures",
  "diff.json"
);
const progressiveIngestProductionPath = path.join(
  progressiveIngestRoot,
  "data",
  "products",
  "smokingpipes-products.json"
);
fs.mkdirSync(
  path.dirname(progressiveIngestCurrentPath),
  { recursive: true }
);
fs.mkdirSync(
  path.dirname(progressiveIngestProductionPath),
  { recursive: true }
);
const progressiveIngestProduction = [
  {
    id: "smokingpipes-100",
    source: "smokingpipes",
    sourceProductId: "100",
    inventoryStatus: "available",
    price: {
      current: {
        rawText: "$100.00",
        amount: 100,
      },
    },
  },
  {
    id: "smokingpipes-101",
    source: "smokingpipes",
    sourceProductId: "101",
    inventoryStatus: "sold",
    price: {
      current: {
        rawText: "$101.00",
        amount: 101,
      },
    },
  },
  {
    id: "smokingpipes-102",
    source: "smokingpipes",
    sourceProductId: "102",
    inventoryStatus: "available",
  },
  {
    id: "smokingpipes-103",
    source: "smokingpipes",
    sourceProductId: "103",
    inventoryStatus: "available",
  },
];
const progressiveIngestCurrent = {
  generatedAt: "2026-06-23T01:00:00.000Z",
  summary: {
    pagesScanned: 107,
    expectedPages: 107,
    fullExpectedRangeScanned: true,
    captchaDetected: false,
    captchaPages: [],
    verificationDetected: false,
  },
  products: [
    {
      sourceProductId: "100",
      sourceUrl: "https://example.invalid/100",
      title: "Price changed",
      price: "$110.00",
      mainImage: "https://example.invalid/100.jpg",
      rawText: "Available",
    },
    {
      sourceProductId: "101",
      sourceUrl: "https://example.invalid/101",
      title: "Reappeared",
      price: "$101.00",
      mainImage: "https://example.invalid/101.jpg",
      rawText: "Available",
    },
    {
      sourceProductId: "103",
      sourceUrl: "https://example.invalid/103",
      title: "Explicit sold",
      price: "",
      mainImage: "https://example.invalid/103.jpg",
      rawText: "OUT OF STOCK",
    },
    ...["200", "201", "202", "999"].map((id) => ({
      sourceProductId: id,
      sourceUrl: `https://example.invalid/${id}`,
      title: `New ${id}`,
      price: `$${id}.00`,
      mainImage: `https://example.invalid/${id}.jpg`,
      rawText: "Available",
    })),
  ],
};
const progressiveIngestDiff = {
  version: "smokingpipes-inventory-diff-dry-run-v1",
  generatedAt: "2026-06-23T01:05:00.000Z",
  coverage: {
    pagesScanned: 107,
    expectedPages: 107,
    fullExpectedRangeScanned: true,
    captchaDetected: false,
    captchaPages: [],
  },
  newIds: ["200", "201", "202"],
  reappearedIds: ["101"],
  disappearedIds: ["102"],
};
fs.writeFileSync(
  progressiveIngestProductionPath,
  JSON.stringify(progressiveIngestProduction),
  "utf8"
);
fs.writeFileSync(
  progressiveIngestCurrentPath,
  JSON.stringify(progressiveIngestCurrent),
  "utf8"
);
fs.writeFileSync(
  progressiveIngestDiffPath,
  JSON.stringify(progressiveIngestDiff),
  "utf8"
);
const progressiveIngestResult =
  await runSmokingpipesProgressiveMode({
    root: progressiveIngestRoot,
    options: parseRunnerOptions([
      "--mode=progressive-ingest-list",
      `--current-list=${progressiveIngestCurrentPath}`,
      `--diff=${progressiveIngestDiffPath}`,
    ]),
  });
assert.equal(progressiveIngestResult.status, "ingest-ready");
assert.equal(progressiveIngestResult.browserStarted, false);
const progressiveIngestPaths = runnerCore.getRunnerPaths(
  progressiveIngestRoot
);
const progressiveIngestState = JSON.parse(
  fs.readFileSync(
    progressiveIngestPaths.progressiveState,
    "utf8"
  )
);
assert.equal(
  progressiveIngestState.schema,
  "smokingpipes-progressive-daily-state-v1"
);
assert.equal(
  progressiveIngestState.verificationDetected,
  false
);
assert.deepEqual(
  progressiveIngestState.globalReconcile.disappearedIds,
  ["102"]
);
assert.equal(
  progressiveIngestState.globalReconcile.applyAllowed,
  false
);
assert.equal(
  progressiveIngestState.candidates.filter((item) =>
    item.changeTypes.includes("new-product")
  ).length,
  3
);
assert.equal(
  progressiveIngestState.candidates.some(
    (item) => item.sourceProductId === "999"
  ),
  false
);
for (const candidate of progressiveIngestState.candidates) {
  assert.ok(candidate.lastSeenAt);
  assert.equal(Number.isInteger(candidate.retryCount), true);
}
assert.deepEqual(progressiveIngestState.summary, {
  totalCandidates: 6,
  newProductCandidates: 3,
  priceChangeCandidates: 1,
  explicitOutOfStockCandidates: 1,
  reappearedCandidates: 1,
  disappearedCandidatesRecorded: 1,
  disappearedCandidatesApplyAllowed: false,
  pending: 3,
  complete: 3,
  failed: 0,
  blocked: 0,
  readyForDetailChunk: 3,
});
const progressiveIngestReport = JSON.parse(
  fs.readFileSync(
    progressiveIngestPaths.progressiveReportJson,
    "utf8"
  )
);
assert.equal(progressiveIngestReport.productionWritten, false);
assert.equal(progressiveIngestReport.currentListPath, progressiveIngestCurrentPath);
assert.equal(progressiveIngestReport.diffPath, progressiveIngestDiffPath);
assert.equal(progressiveIngestReport.newProductCandidates, 3);
assert.equal(progressiveIngestReport.disappearedCandidatesApplyAllowed, false);

const preservedProgressiveState = structuredClone(
  progressiveIngestState
);
const preservedComplete =
  preservedProgressiveState.candidates.find(
    (item) => item.sourceProductId === "200"
  );
preservedComplete.detailStatus = "complete";
preservedComplete.publicStatus = "published";
preservedComplete.detail = { preserved: true };
preservedComplete.convertedProduct = { preserved: true };
const eligibleBlocked =
  preservedProgressiveState.candidates.find(
    (item) => item.sourceProductId === "201"
  );
eligibleBlocked.detailStatus = "blocked";
eligibleBlocked.blockedCount = 2;
eligibleBlocked.lastBlockedAt =
  "2026-06-22T00:00:00.000Z";
eligibleBlocked.lastBlockedReason = "previous verification";
eligibleBlocked.nextEligibleAt =
  "2026-06-22T00:30:00.000Z";
fs.writeFileSync(
  progressiveIngestPaths.progressiveState,
  JSON.stringify(preservedProgressiveState),
  "utf8"
);
await runSmokingpipesProgressiveMode({
  root: progressiveIngestRoot,
  options: parseRunnerOptions([
    "--mode=progressive-ingest-list",
    `--current-list=${progressiveIngestCurrentPath}`,
    `--diff=${progressiveIngestDiffPath}`,
  ]),
});
const progressiveReingestedState = JSON.parse(
  fs.readFileSync(
    progressiveIngestPaths.progressiveState,
    "utf8"
  )
);
assert.equal(progressiveReingestedState.candidates.length, 6);
const preservedAfterReingest =
  progressiveReingestedState.candidates.find(
    (item) => item.sourceProductId === "200"
  );
assert.equal(preservedAfterReingest.detailStatus, "complete");
assert.equal(preservedAfterReingest.publicStatus, "published");
assert.deepEqual(preservedAfterReingest.detail, {
  preserved: true,
});
const blockedAfterReingest =
  progressiveReingestedState.candidates.find(
    (item) => item.sourceProductId === "201"
  );
assert.equal(blockedAfterReingest.detailStatus, "pending");
assert.equal(blockedAfterReingest.blockedCount, 2);
assert.equal(
  blockedAfterReingest.lastBlockedReason,
  "previous verification"
);

const partialIngestCurrent = structuredClone(
  progressiveIngestCurrent
);
partialIngestCurrent.summary = {
  pagesScanned: 3,
  expectedPages: 107,
  fullExpectedRangeScanned: false,
  captchaDetected: true,
  captchaPages: [4],
  verificationDetected: true,
};
fs.writeFileSync(
  progressiveIngestCurrentPath,
  JSON.stringify(partialIngestCurrent),
  "utf8"
);
await runSmokingpipesProgressiveMode({
  root: progressiveIngestRoot,
  options: parseRunnerOptions([
    "--mode=progressive-ingest-list",
    `--current-list=${progressiveIngestCurrentPath}`,
    `--diff=${progressiveIngestDiffPath}`,
  ]),
});
const progressiveBlockedIngestState = JSON.parse(
  fs.readFileSync(
    progressiveIngestPaths.progressiveState,
    "utf8"
  )
);
assert.equal(
  progressiveBlockedIngestState.listSnapshotStatus,
  "blocked"
);
assert.equal(
  progressiveBlockedIngestState.verificationDetected,
  true
);
assert.deepEqual(
  progressiveBlockedIngestState.globalReconcile.disappearedIds,
  []
);

console.log("Inventory runner core tests passed.");
