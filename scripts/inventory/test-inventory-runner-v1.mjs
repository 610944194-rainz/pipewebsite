import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  calculateSmokingpipesReferencePrice,
  getSmokingpipesShippingUsd,
  getSmokingpipesShippingTier,
} from "../../lib/pricing/reference-price.mjs";
import {
  clearStaleProgressiveLock,
  inspectProgressiveLock,
} from "./smokingpipes-progressive-lock-v1.mjs";
import {
  clearStaleInventoryLocks,
  inspectInventoryLocks,
} from "./smokingpipes-inventory-lock-v1.mjs";
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
  buildSmokingpipesFailureSnapshotMetadata,
  buildSmokingpipesAdaptiveScanPlan,
  buildSmokingpipesOutOfStockTailCache,
  classifySmokingpipesFailureSnapshotText,
  detectSmokingpipesTotalPagesFromHtml,
  evaluateSmokingpipesOutOfStockTail,
  evaluateSmokingpipesOutOfStockTailCache,
  randomDelayMs,
  resolveListPacingOptions,
  shouldTreatSmokingpipesEmptyListPageAsEndOfList,
  shouldApplyPageBatchCooldown,
} from "./smokingpipes-fetch-current-list-v1.mjs";
import {
  auditSmokingpipesDuplicateIds,
  evaluateSmokingpipesCurrentListCache,
} from "./smokingpipes-current-list-cache-v1.mjs";
import {
  evaluateSmokingpipesDailyRecoveryPreflight,
} from "./smokingpipes-daily-recovery-preflight-v1.mjs";
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
  classifySmokingpipesDetailStatusEvidence,
  isNormalSmokingpipesDetail,
  launchSmokingpipesContext,
  resolveSmokingpipesBrowserLaunch,
  summarizeSmokingpipesListProducts,
  waitForSmokingpipesManualRecovery,
} from "../lib/smokingpipes-utils.mjs";
import {
  convertSmokingpipesCandidateDetails,
} from "../convert-smokingpipes-products-v2.mjs";
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
  reconcileProgressiveState,
} from "./smokingpipes-progressive-state-reconcile-v1.mjs";
import {
  buildProgressiveStateSummary,
  ingestProgressiveListSnapshot,
  runProgressiveDetailChunk,
  selectProgressiveDetailCandidates,
  summarizeProgressiveState,
} from "./smokingpipes-progressive-daily-v1.mjs";
import {
  applySmokingpipesBrandExclusions,
  classifySmokingpipesBrandExclusion,
} from "../lib/smokingpipes-brand-exclusions-v1.mjs";
import {
  buildSmokingpipesManualBackfillVerificationMessage,
  runSmokingpipesManualDetailBackfill,
} from "./smokingpipes-manual-detail-backfill-v1.mjs";
import {
  auditProgressivePartialCandidate,
  buildProgressivePartialApplyPreview,
  buildProgressivePartialProducts,
  diagnoseProgressiveApplyGap,
  selectProgressiveRecentNew,
} from "./smokingpipes-progressive-candidate-v1.mjs";
import {
  buildSafeSubsetProductionProducts,
  evaluateProgressiveProductionApplyGate,
  runSmokingpipesProgressiveMode,
} from "./smokingpipes-progressive-runner-v1.mjs";
import {
  buildSmokingpipesDetailPendingSpikeDiagnosis,
  evaluateSmokingpipesDetailQueueSpikeGuard,
} from "./smokingpipes-detail-queue-spike-v1.mjs";
import {
  buildManualFullReconcileStateConsistencyReport,
  buildManualFullReconcileDetailBatchReport,
  buildManualFullReconcileDetailSoldParserAuditReport,
  buildSmokingpipesManualFullReconcilePlan,
  promoteManualFullReconcileNextBatch,
  repairManualFullReconcileState,
  repairManualFullReconcileDetailSoldFalsePositives,
  rebuildSmokingpipesProgressiveState,
  runSmokingpipesManualFetchDetailBatch,
  selectManualFullReconcileDetailBatchCandidates,
  selectManualFullReconcilePromoteCandidates,
} from "./smokingpipes-manual-full-reconcile-v1.mjs";

const defaults = parseRunnerOptions([]);
const defaultInventoryState = runnerCore.initialInventoryState();
assert.equal(defaultInventoryState.checkpointFailed, false);
assert.equal(defaultInventoryState.checkpointTargetPath, null);
assert.equal(defaultInventoryState.checkpointTempPath, null);

const pendingOverLimitGuard =
  evaluateSmokingpipesDetailQueueSpikeGuard({
    detailPendingCount: 501,
    previousDetailPendingCount: 0,
    pendingExistingWithConvertedCount: 0,
  });
assert.equal(pendingOverLimitGuard.blocked, true);
assert.match(
  pendingOverLimitGuard.blockReasons.join("\n"),
  /detailPendingCount 501 exceeds 500/
);

assert.equal(
  evaluateSmokingpipesDetailQueueSpikeGuard({
    detailPendingCount: 301,
    previousDetailPendingCount: 0,
    pendingExistingWithConvertedCount: 0,
  }).blocked,
  true
);
assert.equal(
  evaluateSmokingpipesDetailQueueSpikeGuard({
    detailPendingCount: 31,
    previousDetailPendingCount: 10,
    pendingExistingWithConvertedCount: 0,
  }).blocked,
  true
);
assert.equal(
  evaluateSmokingpipesDetailQueueSpikeGuard({
    detailPendingCount: 100,
    previousDetailPendingCount: 50,
    pendingExistingWithConvertedCount: 31,
  }).blocked,
  true
);
assert.equal(
  evaluateSmokingpipesDetailQueueSpikeGuard({
    detailPendingCount: 100,
    previousDetailPendingCount: 50,
    pendingExistingWithConvertedCount: 30,
  }).blocked,
  false
);

const spikeDiagnosis = buildSmokingpipesDetailPendingSpikeDiagnosis({
  state: {
    dailyRunId: "spike-run",
    pagesScanned: 107,
    expectedPages: 107,
    candidates: [
      {
        sourceProductId: "new-1",
        listTitle: "Pending new product",
        changeTypes: ["new-product"],
        detailStatus: "pending",
        publicStatus: "not-public",
        lastSeenRunId: "spike-run",
        detail: null,
        convertedProduct: null,
      },
      {
        sourceProductId: "existing-1",
        listTitle: "Existing product",
        changeTypes: ["price-change"],
        detailStatus: "complete",
        publicStatus: "ready",
        lastSeenRunId: "spike-run",
        detail: { title: "Existing product" },
        convertedProduct: {
          sourceProductId: "existing-1",
        },
      },
    ],
  },
  currentList: {
    summary: {
      pagesScanned: 107,
      expectedPages: 107,
      productsExtracted: 2,
      uniqueProducts: 2,
    },
    products: [
      {
        sourceProductId: "new-1",
        sourceUrl: "https://example.invalid/new-1",
      },
      {
        sourceProductId: "existing-1",
        sourceUrl: "https://example.invalid/existing-1",
      },
    ],
  },
  diff: {
    newIds: ["new-1"],
    reappearedIds: [],
    disappearedIds: [],
  },
  productionProducts: [
    {
      sourceProductId: "existing-1",
      fullTitle: "Existing product",
    },
  ],
  previousDetailPendingCount: 0,
  now: "2026-07-05T08:00:00.000Z",
});
assert.equal(spikeDiagnosis.counts.detailStatus.pending, 1);
assert.equal(spikeDiagnosis.counts.publicStatus.notPublic, 1);
assert.equal(
  spikeDiagnosis.pendingAnalysis.existsInProduction,
  0
);
assert.equal(spikeDiagnosis.pendingSamples.length, 1);
assert.equal(
  spikeDiagnosis.counts.mobileReportedPending,
  2
);
assert.equal(
  spikeDiagnosis.pendingSamples[0].sourceProductId,
  "new-1"
);
assert.equal(spikeDiagnosis.guard.blocked, false);

const manualReconcileNewRows = Array.from(
  { length: 39 },
  (_, index) => {
    const number = index + 1;
    const id = `manual-new-${number}`;
    return {
      sourceProductId: id,
      sourceUrl: `https://example.invalid/${id}`,
      title: `Manual new product ${number}`,
      brand: "Test Brand",
      price: "$100.00",
      mainImage: `https://images.invalid/${id}.jpg`,
      productCode:
        number === 39 ? "DUPLICATE-CODE" : `NEW-${number}`,
      rawText: number <= 10 ? "FRESH! Add To Cart" : "Add To Cart",
    };
  }
);
manualReconcileNewRows[35].price = "";
manualReconcileNewRows[36].mainImage = "";
manualReconcileNewRows[37].brand = "";

const manualPromotionProduction = Array.from(
  { length: 120 },
  (_, index) => ({
    sourceProductId: `promo-${index + 1}`,
    sourceUrl: `https://example.invalid/promo-${index + 1}`,
    productCode: `PROMO-${index + 1}`,
    inventoryStatus: "available",
    price: {
      current: {
        amount: 100,
      },
    },
  })
);
const manualPromotionCurrent =
  manualPromotionProduction.map((item) => ({
    sourceProductId: item.sourceProductId,
    sourceUrl: item.sourceUrl,
    title: item.sourceProductId,
    brand: "Promotion Brand",
    price: "$85.00",
    mainImage: `https://images.invalid/${item.sourceProductId}.jpg`,
    productCode: item.productCode,
    rawText: "15% Off Add To Cart",
  }));
const manualReconcileProduction = [
  ...manualPromotionProduction,
  {
    sourceProductId: "real-change",
    sourceUrl: "https://example.invalid/real-change",
    productCode: "REAL-CHANGE",
    inventoryStatus: "available",
    price: { current: { amount: 100 } },
  },
  {
    sourceProductId: "already-current",
    sourceUrl: "https://example.invalid/already-current",
    productCode: "ALREADY-CURRENT",
    inventoryStatus: "available",
    price: { current: { amount: 100 } },
  },
  {
    sourceProductId: "explicit-sold",
    sourceUrl: "https://example.invalid/explicit-sold",
    productCode: "EXPLICIT-SOLD",
    inventoryStatus: "available",
    price: { current: { amount: 120 } },
  },
  {
    sourceProductId: "reappeared",
    sourceUrl: "https://example.invalid/reappeared",
    productCode: "REAPPEARED",
    inventoryStatus: "sold",
    price: { current: { amount: 130 } },
  },
  {
    sourceProductId: "disappeared",
    sourceUrl: "https://example.invalid/disappeared",
    productCode: "DISAPPEARED",
    inventoryStatus: "available",
    price: { current: { amount: 140 } },
  },
  {
    sourceProductId: "existing-duplicate-code",
    sourceUrl: "https://example.invalid/existing-duplicate-code",
    productCode: "DUPLICATE-CODE",
    inventoryStatus: "available",
    price: { current: { amount: 150 } },
  },
];
const manualReconcileCurrentRows = [
  ...manualReconcileNewRows,
  ...manualPromotionCurrent,
  {
    sourceProductId: "real-change",
    sourceUrl: "https://example.invalid/real-change",
    title: "Real change",
    brand: "Test Brand",
    price: "$90.00",
    mainImage: "https://images.invalid/real-change.jpg",
    productCode: "REAL-CHANGE",
    rawText: "Add To Cart",
  },
  {
    sourceProductId: "already-current",
    sourceUrl: "https://example.invalid/already-current",
    title: "Already current",
    brand: "Test Brand",
    price: "$100.00",
    mainImage: "https://images.invalid/already-current.jpg",
    productCode: "ALREADY-CURRENT",
    rawText: "Add To Cart",
  },
  {
    sourceProductId: "explicit-sold",
    sourceUrl: "https://example.invalid/explicit-sold",
    title: "Explicit sold",
    brand: "Test Brand",
    price: "",
    mainImage: "https://images.invalid/explicit-sold.jpg",
    productCode: "EXPLICIT-SOLD",
    rawListStatus: "OUT OF STOCK",
    rawText: "OUT OF STOCK",
  },
  {
    sourceProductId: "reappeared",
    sourceUrl: "https://example.invalid/reappeared",
    title: "Reappeared",
    brand: "Test Brand",
    price: "$130.00",
    mainImage: "https://images.invalid/reappeared.jpg",
    productCode: "REAPPEARED",
    rawText: "Add To Cart",
  },
];
const manualReconcilePreviousState =
  createProgressiveDailyState({
    dailyRunId: "manual-old",
    now: "2026-07-04T00:00:00.000Z",
  });
manualReconcilePreviousState.candidates = [
  {
    sourceProductId: "manual-new-1",
    sourceUrl: "https://example.invalid/manual-new-1",
    listTitle: "Manual new product 1",
    listPrice: "$100.00",
    listPrimaryImage:
      "https://images.invalid/manual-new-1.jpg",
    inventoryStatus: "available",
    discoveredAt: "2026-07-04T00:00:00.000Z",
    firstSeenRunId: "manual-old",
    lastSeenRunId: "manual-old",
    lastSeenAt: "2026-07-04T00:00:00.000Z",
    changeTypes: ["new-product"],
    detailStatus: "complete",
    publicStatus: "ready",
    detailAttempts: 1,
    retryCount: 0,
    lastAttemptAt: "2026-07-04T00:01:00.000Z",
    lastSuccessfulDetailRunId: "manual-old",
    lastAppliedAt: null,
    appliedInCommit: null,
    lastError: null,
    priority: 100,
    blockedCount: 0,
    lastBlockedAt: null,
    lastBlockedReason: null,
    nextEligibleAt: null,
    detail: { title: "Preserved detail" },
    convertedProduct: {
      sourceProductId: "manual-new-1",
      displayNameEn: "Preserved converted product",
    },
    productionProductId: null,
    lastBuiltAt: null,
  },
  {
    sourceProductId: "already-current",
    sourceUrl: "https://example.invalid/already-current",
    listTitle: "Already current",
    listPrice: "$90.00",
    listPrimaryImage:
      "https://images.invalid/already-current.jpg",
    inventoryStatus: "available",
    discoveredAt: "2026-07-04T00:00:00.000Z",
    firstSeenRunId: "manual-old",
    lastSeenRunId: "manual-old",
    lastSeenAt: "2026-07-04T00:00:00.000Z",
    changeTypes: ["price-change"],
    detailStatus: "complete",
    publicStatus: "ready",
    detailAttempts: 0,
    retryCount: 0,
    lastAttemptAt: null,
    lastSuccessfulDetailRunId: null,
    lastAppliedAt: null,
    appliedInCommit: null,
    lastError: null,
    priority: 50,
    blockedCount: 0,
    lastBlockedAt: null,
    lastBlockedReason: null,
    nextEligibleAt: null,
    detail: null,
    convertedProduct: null,
    productionProductId: "smokingpipes-already-current",
    lastBuiltAt: null,
  },
];
manualReconcilePreviousState.candidates.push({
  ...structuredClone(
    manualReconcilePreviousState.candidates[0]
  ),
  sourceProductId: "manual-new-2",
  sourceUrl: "https://example.invalid/manual-new-2",
  listTitle: "Manual new product 2",
  firstSeenRunId: "manual-old",
  detailStatus: "pending",
  publicStatus: "not-public",
  detailAttempts: 0,
  lastAttemptAt: null,
  lastSuccessfulDetailRunId: null,
  detail: null,
  convertedProduct: null,
});
manualReconcilePreviousState.candidates.push({
  ...structuredClone(
    manualReconcilePreviousState.candidates[0]
  ),
  sourceProductId: "manual-new-36",
  sourceUrl: "https://example.invalid/manual-new-36",
  listTitle: "Manual new product 36",
  firstSeenRunId: "manual-old",
  detail: { title: "Preserved review detail" },
  convertedProduct: {
    sourceProductId: "manual-new-36",
    displayNameEn: "Preserved review product",
  },
});
manualReconcilePreviousState.summary = {
  totalCandidates: 9999,
  pending: 9999,
};

const manualReconcilePlan =
  buildSmokingpipesManualFullReconcilePlan({
    currentList: {
      completedAt: "2026-07-05T08:00:00.000Z",
      products: manualReconcileCurrentRows,
      summary: {
        pagesScanned: 107,
        expectedPages: 107,
        fullExpectedRangeScanned: true,
        captchaDetected: false,
        captchaPages: [],
        verificationDetectedAt: null,
        uniqueProducts: manualReconcileCurrentRows.length,
      },
    },
    diff: {
      newIds: manualReconcileNewRows.map(
        (item) => item.sourceProductId
      ),
      reappearedIds: ["reappeared"],
      disappearedIds: ["disappeared"],
      coverage: {
        pagesScanned: 107,
        expectedPages: 107,
        fullExpectedRangeScanned: true,
        captchaDetected: false,
      },
    },
    productionProducts: manualReconcileProduction,
    previousState: manualReconcilePreviousState,
    detailMax: 30,
    now: "2026-07-05T08:30:00.000Z",
  });
assert.equal(manualReconcilePlan.snapshot.trusted, true);
assert.equal(
  manualReconcilePlan.diffCounts.newProduct,
  39
);
assert.equal(
  manualReconcilePlan.newProduct.eligibleForDetail,
  35
);
assert.equal(
  manualReconcilePlan.newProduct.reviewOnly,
  4
);
assert.equal(
  manualReconcilePlan.priceChange.likelyPromotion,
  120
);
assert.equal(
  manualReconcilePlan.priceChange.realPriceChange,
  1
);
assert.equal(
  manualReconcilePlan.priceChange.noOpAlreadyCurrent,
  1
);
assert.equal(
  manualReconcilePlan.disappeared.disappearedApplyDisabled,
  1
);
assert.equal(
  manualReconcilePlan.detailQueue.eligibleThisBatch,
  30
);
assert.equal(
  manualReconcilePlan.detailQueue.deferred,
  4
);
assert.equal(
  manualReconcilePlan.firstDetailBatchSourceProductIds.length,
  30
);
assert.equal(
  manualReconcilePlan.previousPendingTriage.total,
  1
);
assert.equal(
  manualReconcilePlan.previousPendingTriage.firstBatch,
  1
);
assert.equal(
  manualReconcilePlan.previousPendingTriage.accountedFor,
  1
);
assert.equal(
  manualReconcilePlan.gates.allowDetailFetch,
  true
);
assert.equal(
  manualReconcilePlan.gates.allowProductionApply,
  false
);
assert.equal(
  manualReconcilePlan.gates.allowDailyTaskResume,
  false
);

const manualRebuiltStateResult =
  rebuildSmokingpipesProgressiveState({
    plan: manualReconcilePlan,
    currentList: {
      products: manualReconcileCurrentRows,
    },
    productionProducts: manualReconcileProduction,
    previousState: manualReconcilePreviousState,
    now: "2026-07-05T08:31:00.000Z",
  });
const manualRebuiltState = manualRebuiltStateResult.state;
assert.equal(
  validateProgressiveDailyState(manualRebuiltState).valid,
  true
);
assert.equal(
  manualRebuiltState.candidates.filter(
    (item) => item.detailStatus === "pending"
  ).length,
  30
);
assert.equal(
  manualRebuiltState.candidates.filter(
    (item) =>
      item.queueDisposition === "eligible-this-batch"
  ).length,
  30
);
assert.equal(
  manualRebuiltState.candidates.filter(
    (item) =>
      item.queueDisposition === "eligible-this-batch" &&
      item.detailStatus === "pending"
  ).length,
  30
);
assert.equal(
  manualRebuiltState.candidates.filter(
    (item) => item.detailStatus === "deferred"
  ).length,
  4
);
assert.equal(
  manualRebuiltState.candidates.filter(
    (item) =>
      item.queueDisposition === "queued-later" &&
      item.detailStatus === "deferred"
  ).length,
  4
);
assert.equal(
  manualRebuiltState.candidates.filter(
    (item) => item.detailStatus === "review-only"
  ).length,
  4
);
assert.equal(
  manualRebuiltState.candidates.filter(
    (item) =>
      item.queueDisposition === "review-only" &&
      item.detailStatus === "review-only"
  ).length,
  4
);
const preservedReviewOnlyCandidate =
  manualRebuiltState.candidates.find(
    (item) => item.sourceProductId === "manual-new-36"
  );
assert.equal(
  preservedReviewOnlyCandidate.detailStatus,
  "review-only"
);
assert.equal(
  preservedReviewOnlyCandidate.detail.title,
  "Preserved review detail"
);
const preservedManualCandidate =
  manualRebuiltState.candidates.find(
    (item) => item.sourceProductId === "manual-new-1"
  );
assert.equal(
  preservedManualCandidate.queueDisposition,
  "no-detail-required"
);
assert.equal(
  preservedManualCandidate.detail.title,
  "Preserved detail"
);
assert.equal(
  preservedManualCandidate.convertedProduct.displayNameEn,
  "Preserved converted product"
);
assert.equal(
  manualRebuiltState.globalReconcile.applyAllowed,
  false
);
assert.deepEqual(
  manualRebuiltState.globalReconcile.disappearedIds,
  ["disappeared"]
);
assert.equal(
  manualRebuiltState.summary.pending,
  30
);
assert.equal(
  manualRebuiltState.summary.deferred,
  4
);

const manualStateConsistency =
  buildManualFullReconcileStateConsistencyReport({
    state: manualRebuiltState,
    generatedAt: "2026-07-07T10:00:00.000Z",
  });
assert.equal(manualStateConsistency.status, "passed");
assert.equal(manualStateConsistency.canFetchDetailBatch, true);
assert.equal(
  manualStateConsistency.counts.eligibleThisBatch,
  30
);
assert.equal(manualStateConsistency.counts.pending, 30);

const manualInconsistentState = structuredClone(
  manualRebuiltState
);
for (const candidate of manualInconsistentState.candidates) {
  if (candidate.queueDisposition === "eligible-this-batch") {
    candidate.detailStatus = "complete";
    candidate.publicStatus = "review-only";
  }
}
const manualInconsistencyReport =
  buildManualFullReconcileStateConsistencyReport({
    state: manualInconsistentState,
    generatedAt: "2026-07-07T10:05:00.000Z",
  });
assert.equal(manualInconsistencyReport.status, "blocked");
assert.equal(
  manualInconsistencyReport.canFetchDetailBatch,
  false
);
assert.equal(
  manualInconsistencyReport.counts.eligibleThisBatch,
  30
);
assert.equal(manualInconsistencyReport.counts.pending, 0);
assert.match(
  manualInconsistencyReport.blockers.join("\n"),
  /does not equal pending/
);
let inconsistentProcessorCalled = false;
const manualInconsistentRun =
  await runSmokingpipesManualFetchDetailBatch({
    state: manualInconsistentState,
    detailMax: 30,
    now: "2026-07-07T10:06:00.000Z",
    networkAccessed: true,
    processDetail: async () => {
      inconsistentProcessorCalled = true;
      throw new Error("must not be called");
    },
  });
assert.equal(manualInconsistentRun.status, "state-inconsistent");
assert.equal(inconsistentProcessorCalled, false);
assert.equal(
  manualInconsistentRun.report.smokingpipesAccessed,
  false
);
assert.equal(
  manualInconsistentRun.report.stateConsistency.status,
  "blocked"
);

const manualRepairedState =
  repairManualFullReconcileState({
    state: manualInconsistentState,
    now: "2026-07-07T10:07:00.000Z",
  });
assert.equal(
  manualRepairedState.report.eligibleRestoredToPending,
  30
);
assert.equal(
  manualRepairedState.report.after.counts.eligibleThisBatch,
  30
);
assert.equal(manualRepairedState.report.after.counts.pending, 30);
assert.equal(manualRepairedState.report.after.status, "passed");
assert.equal(
  validateProgressiveDailyState(manualRepairedState.state).valid,
  true
);

const manualDetailBatchState =
  structuredClone(manualRebuiltState);
const queuedLaterCandidate =
  manualDetailBatchState.candidates.find(
    (item) => item.detailStatus === "deferred"
  );
const manualDetailBatchSelection =
  selectManualFullReconcileDetailBatchCandidates({
    state: manualDetailBatchState,
    detailMax: 99,
  });
assert.equal(manualDetailBatchSelection.length, 30);
assert.equal(
  manualDetailBatchSelection.every(
    (item) =>
      item.detailStatus === "pending" &&
      item.queueDisposition === "eligible-this-batch"
  ),
  true
);
assert.equal(
  manualDetailBatchSelection.some(
    (item) =>
      item.sourceProductId ===
      queuedLaterCandidate.sourceProductId
  ),
  false
);
assert.equal(
  manualDetailBatchSelection.some(
    (item) =>
      item.sourceProductId ===
      preservedManualCandidate.sourceProductId
  ),
  false
);
assert.equal(
  manualDetailBatchSelection.some(
    (item) => item.detailStatus === "review-only"
  ),
  false
);

const manualDetailBatchCheckpoints = [];
const manualDetailBatchRun =
  await runSmokingpipesManualFetchDetailBatch({
    state: structuredClone(manualDetailBatchState),
    detailMax: 99,
    now: "2026-07-07T09:30:00.000Z",
    networkAccessed: false,
    browser: {
      browserChannel: "chrome",
      browserProfile: "sp-chrome",
    },
    processDetail: async (candidate) => ({
      detail: {
        sourceProductId: candidate.sourceProductId,
        title: candidate.listTitle,
      },
      convertedProduct: {
        sourceProductId: candidate.sourceProductId,
        inventoryStatus: "available",
        inventoryConfidence: "confirmed",
        listingEligible: true,
        publication: {
          listingEligible: true,
          publicIndexEligible: true,
          publiclySellable: true,
        },
        price: {
          current: {
            amount: 100,
          },
        },
        mainImageUrl:
          candidate.listPrimaryImage ||
          `https://images.invalid/${candidate.sourceProductId}.jpg`,
      },
    }),
    checkpoint: async (state) => {
      manualDetailBatchCheckpoints.push(
        structuredClone(state)
      );
    },
  });
assert.equal(manualDetailBatchRun.status, "batch-complete");
assert.equal(manualDetailBatchRun.report.batchLimit, 30);
assert.equal(manualDetailBatchRun.report.attemptedCount, 30);
assert.equal(manualDetailBatchRun.report.completedCount, 30);
assert.equal(manualDetailBatchRun.report.failedCount, 0);
assert.equal(manualDetailBatchRun.report.blockedCount, 0);
assert.equal(
  manualDetailBatchRun.report.remainingPendingCount,
  0
);
assert.equal(manualDetailBatchRun.report.deferredCount, 4);
assert.equal(manualDetailBatchRun.report.reviewOnlyCount, 4);
assert.equal(manualDetailBatchRun.report.smokingpipesAccessed, false);
assert.equal(manualDetailBatchRun.report.productionWritten, false);
assert.equal(manualDetailBatchCheckpoints.length, 30);
const manualDetailBatchAttemptedIds = new Set(
  manualDetailBatchRun.report.items.map((item) => item.sourceProductId)
);
assert.equal(
  manualDetailBatchRun.state.candidates.filter(
    (item) =>
      manualDetailBatchAttemptedIds.has(item.sourceProductId) &&
      item.detailStatus === "complete" &&
      item.queueDisposition === "no-detail-required"
  ).length,
  30
);
assert.equal(
  manualDetailBatchRun.report.stateConsistency.status,
  "passed"
);
assert.equal(
  manualDetailBatchRun.state.candidates.find(
    (item) =>
      item.sourceProductId ===
      queuedLaterCandidate.sourceProductId
).detailStatus,
  "deferred"
);

const manualLargePostBatchState = structuredClone(
  manualDetailBatchRun.state
);
const manualQueuedLaterTemplate =
  manualLargePostBatchState.candidates.find(
    (item) => item.queueDisposition === "queued-later"
  );
for (let index = 0; index < 263; index += 1) {
  manualLargePostBatchState.candidates.push({
    ...structuredClone(manualQueuedLaterTemplate),
    sourceProductId: `manual-later-extra-${String(index + 1).padStart(3, "0")}`,
    sourceUrl: `https://example.invalid/manual-later-extra-${index + 1}`,
    listTitle: `Manual later extra ${index + 1}`,
    listPrice: "$120.00",
    listPrimaryImage:
      "https://images.invalid/manual-later-extra.jpg",
    detailStatus: "deferred",
    queueDisposition: "queued-later",
    publicStatus: "not-public",
    detail: null,
    convertedProduct: null,
    lastError: null,
  });
}
manualLargePostBatchState.summary =
  buildProgressiveStateSummary(
    manualLargePostBatchState,
    "2026-07-07T10:20:00.000Z"
  );
assert.equal(
  manualLargePostBatchState.candidates.filter(
    (item) =>
      item.queueDisposition === "eligible-this-batch" &&
      item.detailStatus === "pending"
  ).length,
  0
);
assert.equal(
  manualLargePostBatchState.candidates.filter(
    (item) => item.queueDisposition === "queued-later"
  ).length,
  267
);

let manualNoAutoPromoteProcessorCalled = false;
const manualNoAutoPromoteRun =
  await runSmokingpipesManualFetchDetailBatch({
    state: structuredClone(manualLargePostBatchState),
    detailMax: 30,
    now: "2026-07-07T10:21:00.000Z",
    networkAccessed: false,
    processDetail: async () => {
      manualNoAutoPromoteProcessorCalled = true;
      throw new Error("FetchDetailBatch must not auto promote");
    },
  });
assert.equal(
  manualNoAutoPromoteRun.status,
  "promote-next-batch-required"
);
assert.equal(manualNoAutoPromoteProcessorCalled, false);
assert.equal(
  manualNoAutoPromoteRun.report.smokingpipesAccessed,
  false
);
assert.match(
  manualNoAutoPromoteRun.report.blockers.join("\n"),
  /PromoteNextBatch/
);

const manualPromoteSelection =
  selectManualFullReconcilePromoteCandidates({
    state: manualLargePostBatchState,
    detailMax: 99,
  });
assert.equal(manualPromoteSelection.length, 30);
assert.equal(
  manualPromoteSelection.every(
    (item) =>
      item.queueDisposition === "queued-later" &&
      item.detailStatus === "deferred" &&
      item.publicStatus === "not-public"
  ),
  true
);
assert.equal(
  manualPromoteSelection.some((item) =>
    manualDetailBatchAttemptedIds.has(item.sourceProductId)
  ),
  false
);

const manualPromotedRun =
  promoteManualFullReconcileNextBatch({
    state: structuredClone(manualLargePostBatchState),
    detailMax: 30,
    now: "2026-07-07T10:22:00.000Z",
  });
assert.equal(manualPromotedRun.status, "batch-promoted");
assert.equal(manualPromotedRun.report.promotedCount, 30);
assert.equal(
  manualPromotedRun.report.remainingQueuedLaterCount,
  237
);
assert.equal(manualPromotedRun.report.pendingCountAfter, 30);
assert.equal(manualPromotedRun.report.smokingpipesAccessed, false);
assert.equal(manualPromotedRun.report.productionWritten, false);
assert.equal(
  manualPromotedRun.consistency.counts.eligibleThisBatch,
  30
);
assert.equal(manualPromotedRun.consistency.counts.pending, 30);
assert.equal(manualPromotedRun.consistency.status, "passed");
assert.equal(
  manualPromotedRun.state.candidates.filter(
    (item) =>
      item.queueDisposition === "queued-later" &&
      item.detailStatus === "deferred"
  ).length,
  237
);
assert.equal(
  manualPromotedRun.state.candidates.filter(
    (item) =>
      item.queueDisposition === "review-only" ||
      item.detailStatus === "review-only"
  ).length,
  4
);
assert.equal(
  manualPromotedRun.report.promotedSourceProductIds.some((id) =>
    manualDetailBatchAttemptedIds.has(id)
  ),
  false
);

const manualPromoteInconsistentState = structuredClone(
  manualLargePostBatchState
);
manualPromoteInconsistentState.candidates.push({
  ...structuredClone(manualQueuedLaterTemplate),
  sourceProductId: "manual-inconsistent-pending",
  detailStatus: "pending",
  queueDisposition: "queued-later",
  publicStatus: "not-public",
});
const manualPromoteInconsistentRun =
  promoteManualFullReconcileNextBatch({
    state: manualPromoteInconsistentState,
    detailMax: 30,
    now: "2026-07-07T10:23:00.000Z",
  });
assert.equal(
  manualPromoteInconsistentRun.status,
  "state-inconsistent"
);
assert.match(
  manualPromoteInconsistentRun.report.blockers.join("\n"),
  /pending candidates exist outside eligible-this-batch/
);
assert.equal(
  manualPromoteInconsistentRun.report.smokingpipesAccessed,
  false
);
assert.equal(
  manualPromoteInconsistentRun.report.productionWritten,
  false
);

const manualDetailBlockedState =
  structuredClone(manualRebuiltState);
const manualDetailBlockedRun =
  await runSmokingpipesManualFetchDetailBatch({
    state: manualDetailBlockedState,
    detailMax: 30,
    now: "2026-07-07T09:45:00.000Z",
    networkAccessed: true,
    browser: {
      browserChannel: "chrome",
      browserProfile: "sp-chrome",
    },
    processDetail: async (candidate, index) => {
      if (index === 1) {
        throw Object.assign(
          new Error(
            `strong verification at ${candidate.sourceProductId}`
          ),
          {
            code: "CAPTCHA_REQUIRED",
            verificationPageUrl: candidate.sourceUrl,
          }
        );
      }
      return {
        detail: {
          sourceProductId: candidate.sourceProductId,
          title: candidate.listTitle,
        },
        convertedProduct: {
          sourceProductId: candidate.sourceProductId,
          inventoryStatus: "available",
          inventoryConfidence: "confirmed",
          listingEligible: true,
          publication: {
            listingEligible: true,
            publicIndexEligible: true,
            publiclySellable: true,
          },
          price: {
            current: {
              amount: 100,
            },
          },
          mainImageUrl:
            candidate.listPrimaryImage ||
            `https://images.invalid/${candidate.sourceProductId}.jpg`,
        },
      };
    },
  });
assert.equal(manualDetailBlockedRun.status, "blocked");
assert.equal(manualDetailBlockedRun.report.attemptedCount, 2);
assert.equal(manualDetailBlockedRun.report.completedCount, 1);
assert.equal(manualDetailBlockedRun.report.blockedCount, 1);
assert.match(
  manualDetailBlockedRun.report.blockedManualAction.object,
  /Smokingpipes/
);
assert.match(
  manualDetailBlockedRun.report.blockedManualAction.location,
  /运行任务的电脑/
);
assert.match(
  manualDetailBlockedRun.report.blockedManualAction.browser,
  /Chrome profile sp-chrome/
);
assert.match(
  manualDetailBlockedRun.report.blockedManualAction.nextStep,
  /手动重跑 FetchDetailBatch/
);
assert.equal(
  manualDetailBlockedRun.state.candidates.filter(
    (item) => item.detailStatus === "pending"
  ).length,
  28
);
assert.equal(
  manualDetailBlockedRun.state.candidates.filter(
    (item) =>
      item.detailStatus === "pending" &&
      item.queueDisposition === "eligible-this-batch"
  ).length,
  28
);
assert.equal(
  manualDetailBlockedRun.state.candidates.filter(
    (item) => item.detailStatus === "blocked"
  ).length,
  1
);
assert.equal(
  manualDetailBlockedRun.report.stateConsistency.status,
  "passed"
);
assert.equal(manualDetailBlockedRun.report.productionWritten, false);

const manualDetailDryReport =
  buildManualFullReconcileDetailBatchReport({
    state: manualDetailBatchRun.state,
    startedAt: "2026-07-07T09:30:00.000Z",
    finishedAt: "2026-07-07T09:31:00.000Z",
    batchLimit: 30,
    attemptedResults: manualDetailBatchRun.report.items,
    smokingpipesAccessed: false,
    productionWritten: false,
  });
assert.equal(manualDetailDryReport.batchLimit, 30);
assert.equal(manualDetailDryReport.productionWritten, false);
assert.equal(
  manualDetailDryReport.items.every((item) =>
    ["complete", "failed", "blocked"].includes(item.detailStatus)
  ),
  true
);

const smokingpipesPricingForReferenceTests = {
  taxFactor: 1.2,
  serviceFeeRate: 0.15,
  minServiceFeeCny: 200,
  defaultDiscountRate: 0,
  brandDiscountRates: {
    Peterson: 0.05,
    Savinelli: 0.05,
    Dunhill: 0.15,
  },
  shippingTiersUsd: [
    {
      minPurchaseUsd: 0,
      maxPurchaseUsdExclusive: 150,
      shippingUsd: 6,
    },
    {
      minPurchaseUsd: 150,
      maxPurchaseUsdExclusive: 400,
      shippingUsd: 19,
    },
    {
      minPurchaseUsd: 400,
      maxPurchaseUsdExclusive: null,
      shippingUsd: 60,
    },
  ],
};

for (const [orderAmountUsd, expectedShippingUsd] of [
  [89.3, 6],
  [149.99, 6],
  [150, 19],
  [399.99, 19],
  [400, 60],
]) {
  assert.equal(
    getSmokingpipesShippingTier(
      orderAmountUsd,
      smokingpipesPricingForReferenceTests
    )?.shippingUsd,
    expectedShippingUsd
  );
  assert.equal(
    getSmokingpipesShippingUsd(
      orderAmountUsd,
      smokingpipesPricingForReferenceTests
    ),
    expectedShippingUsd
  );
}

const petersonJuniorBulldogReference =
  calculateSmokingpipesReferencePrice({
    sourcePriceAmount: 94,
    brandName: "Peterson",
    usdToCny: 6.8397,
    pricingConfig: smokingpipesPricingForReferenceTests,
  });
assert.equal(petersonJuniorBulldogReference.purchasePriceUsd, 89.3);
assert.equal(petersonJuniorBulldogReference.brandDiscountRate, 0.05);
assert.equal(petersonJuniorBulldogReference.shippingUsd, 6);
assert.notEqual(petersonJuniorBulldogReference.shippingUsd, 19);
assert.equal(petersonJuniorBulldogReference.siteDisplayReady, true);
assert.ok(
  Math.abs(petersonJuniorBulldogReference.siteDisplayAmount - 1003.980452) <
    1e-6,
  `Peterson Junior Bulldog reference price should equal CNY 1003.980452, got ${petersonJuniorBulldogReference.siteDisplayAmount}`
);

const missingSmokingpipesPriceReference =
  calculateSmokingpipesReferencePrice({
    sourcePriceAmount: null,
    brandName: "Peterson",
    usdToCny: 6.8397,
    pricingConfig: smokingpipesPricingForReferenceTests,
  });
assert.equal(missingSmokingpipesPriceReference.siteDisplayReady, false);
assert.equal(missingSmokingpipesPriceReference.siteDisplayAmount, null);

const weakGlobalSoldDetailStatus =
  classifySmokingpipesDetailStatusEvidence({
    rawText:
      "Peterson Junior Bulldog $164.50 Add to Cart Related item sold out",
    price: "$164.50",
    listInventoryStatus: "available",
    addToCartEvidence: true,
    quantityEvidence: true,
    globalSoldTextMatched: true,
  });
assert.equal(weakGlobalSoldDetailStatus.status, "available");
assert.deepEqual(weakGlobalSoldDetailStatus.soldEvidence, [
  "weak/global-text-match",
]);
assert.ok(
  weakGlobalSoldDetailStatus.availableEvidence.includes(
    "detail-price-present"
  )
);
assert.match(
  weakGlobalSoldDetailStatus.warning,
  /sold status has available evidence/
);

const strongPurchaseSoldDetailStatus =
  classifySmokingpipesDetailStatusEvidence({
    rawText: "Sold Out",
    price: "",
    purchaseAreaText: "Sold Out",
    disabledSoldButtonEvidence: true,
    listInventoryStatus: "",
  });
assert.equal(strongPurchaseSoldDetailStatus.status, "sold");
assert.ok(
  strongPurchaseSoldDetailStatus.soldEvidence.includes(
    "disabled-sold-button"
  )
);

const falsePositiveSoldConversion =
  convertSmokingpipesCandidateDetails(
    [
      {
        sourceProductId: "732410",
        sourceUrl:
          "https://www.smokingpipes.com/pipes/new/peterson/moreinfo.cfm?product_id=732410",
        productCode: "002-029-145796",
        conditionType: "new",
        brand: "Peterson",
        title: "Dracula Rusticated (221) Fishtail",
        fullTitle:
          "Peterson: Dracula Rusticated (221) Fishtail Tobacco Pipe",
        price: "$164.50",
        status: "sold",
        statusEvidence: weakGlobalSoldDetailStatus,
        mainImageUrl:
          "https://images.smokingpipes.com/test/732410.jpg",
        galleryImages: [
          "https://images.smokingpipes.com/test/732410.jpg",
        ],
        galleryCount: 1,
        specsText: ["Shape: Billiard", "Finish: Rusticated"],
        shape: "Billiard",
        finish: "Rusticated",
        material: "Briar",
      },
    ],
    [
      {
        sourceProductId: "732410",
        sourceUrl:
          "https://www.smokingpipes.com/pipes/new/peterson/moreinfo.cfm?product_id=732410",
        title: "Dracula Rusticated (221) Fishtail",
        price: "$164.50",
        imageUrl:
          "https://images.smokingpipes.com/test/732410.jpg",
        status: "available",
      },
    ]
  );
assert.equal(falsePositiveSoldConversion.products.length, 1);
assert.equal(
  falsePositiveSoldConversion.products[0].inventoryStatus,
  "available"
);
assert.equal(
  falsePositiveSoldConversion.products[0].inventoryConfidence,
  "high"
);
assert.deepEqual(
  falsePositiveSoldConversion.products[0].inventoryReviewReasons,
  []
);
assert.doesNotMatch(
  JSON.stringify(falsePositiveSoldConversion.products[0]),
  /Detail page says sold while the product remains in the active list range/
);

const manualSoldFalsePositiveState = createProgressiveDailyState({
  dailyRunId: "manual-sold-false-positive-test",
  now: "2026-07-07T11:00:00.000Z",
});
manualSoldFalsePositiveState.candidates.push({
  sourceProductId: "732410",
  sourceUrl:
    "https://www.smokingpipes.com/pipes/new/peterson/moreinfo.cfm?product_id=732410",
  listTitle: "Dracula Rusticated (221) Fishtail",
  listPrice: "$164.50",
  listPrimaryImage:
    "https://images.smokingpipes.com/test/732410.jpg",
  inventoryStatus: "available",
  discoveredAt: "2026-07-07T11:00:00.000Z",
  firstSeenRunId: "manual-sold-false-positive-test",
  lastSeenRunId: "manual-sold-false-positive-test",
  lastSeenAt: "2026-07-07T11:00:00.000Z",
  changeTypes: ["new-product"],
  detailStatus: "complete",
  publicStatus: "review-only",
  detailAttempts: 1,
  retryCount: 0,
  lastAttemptAt: "2026-07-07T11:00:00.000Z",
  lastSuccessfulDetailRunId: "manual-sold-false-positive-test",
  lastAppliedAt: null,
  appliedInCommit: null,
  lastError:
    "inventory conflict: Detail page says sold while the product remains in the active list range.",
  priority: 100,
  blockedCount: 0,
  lastBlockedAt: null,
  lastBlockedReason: null,
  nextEligibleAt: null,
  detail: {
    sourceProductId: "732410",
    sourceUrl:
      "https://www.smokingpipes.com/pipes/new/peterson/moreinfo.cfm?product_id=732410",
    productCode: "002-029-145796",
    conditionType: "new",
    brand: "Peterson",
    title: "Dracula Rusticated (221) Fishtail",
    fullTitle:
      "Peterson: Dracula Rusticated (221) Fishtail Tobacco Pipe",
    price: "$164.50",
    status: "sold",
    mainImageUrl:
      "https://images.smokingpipes.com/test/732410.jpg",
    galleryImages: [
      "https://images.smokingpipes.com/test/732410.jpg",
    ],
    galleryCount: 1,
    specsText: ["Shape: Billiard", "Finish: Rusticated"],
    shape: "Billiard",
    finish: "Rusticated",
    material: "Briar",
  },
  convertedProduct: {
    ...falsePositiveSoldConversion.products[0],
    inventoryStatus: "needs-review",
    inventoryConfidence: "conflicting-signals",
    inventoryReviewReasons: [
      "Detail page says sold while the product remains in the active list range.",
    ],
    inventoryEvidence: {
      rawDetailStatus: "sold",
      rawListStatus: "available",
      reasons: [
        "Detail page says sold while the product remains in the active list range.",
      ],
    },
  },
  productionProductId: null,
  lastBuiltAt: null,
  queueDisposition: "no-detail-required",
});
manualSoldFalsePositiveState.candidates.push({
  ...structuredClone(manualSoldFalsePositiveState.candidates[0]),
  sourceProductId: "strong-sold-sample",
  sourceUrl: "https://example.invalid/strong-sold-sample",
  listTitle: "Strong sold sample",
  listPrice: "",
  inventoryStatus: "available",
  detail: {
    ...structuredClone(manualSoldFalsePositiveState.candidates[0].detail),
    sourceProductId: "strong-sold-sample",
    sourceUrl: "https://example.invalid/strong-sold-sample",
    price: "",
    status: "sold",
    statusEvidence: strongPurchaseSoldDetailStatus,
  },
});
const manualSoldAudit =
  buildManualFullReconcileDetailSoldParserAuditReport({
    state: manualSoldFalsePositiveState,
    generatedAt: "2026-07-07T11:01:00.000Z",
  });
assert.equal(manualSoldAudit.auditedCount, 2);
assert.equal(manualSoldAudit.repairableFalsePositiveCount, 1);
assert.equal(manualSoldAudit.trueOrStrongSoldCount, 1);
assert.equal(
  manualSoldAudit.rows.find(
    (item) => item.sourceProductId === "732410"
  ).rawStatusSource,
  "legacy-global-raw-text-match-likely"
);
const manualSoldRepair =
  repairManualFullReconcileDetailSoldFalsePositives({
    state: manualSoldFalsePositiveState,
    now: "2026-07-07T11:02:00.000Z",
  });
assert.equal(manualSoldRepair.report.beforeAuditedCount, 2);
assert.equal(
  manualSoldRepair.report.beforeRepairableFalsePositiveCount,
  1
);
assert.equal(manualSoldRepair.report.repairedCount, 1);
assert.equal(manualSoldRepair.report.notRepairedCount, 0);
assert.equal(manualSoldRepair.report.smokingpipesAccessed, false);
assert.equal(manualSoldRepair.report.productionWritten, false);
const repairedFalsePositive =
  manualSoldRepair.state.candidates.find(
    (item) => item.sourceProductId === "732410"
  );
assert.equal(repairedFalsePositive.detail.status, "available");
assert.equal(
  repairedFalsePositive.convertedProduct.inventoryStatus,
  "available"
);
assert.notEqual(repairedFalsePositive.publicStatus, "review-only");
assert.doesNotMatch(
  `${repairedFalsePositive.lastError || ""} ${repairedFalsePositive.reviewReason || ""}`,
  /inventory conflict/
);
const unrepairedStrongSold =
  manualSoldRepair.state.candidates.find(
    (item) => item.sourceProductId === "strong-sold-sample"
  );
assert.equal(unrepairedStrongSold.detail.status, "sold");
assert.equal(unrepairedStrongSold.publicStatus, "review-only");

const progressiveLockRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "smokingpipes-progressive-lock-")
);
const progressiveLockPath = path.join(
  progressiveLockRoot,
  "data",
  "inventory",
  "state",
  "smokingpipes-progressive-daily.lock"
);
fs.mkdirSync(path.dirname(progressiveLockPath), { recursive: true });
const progressiveLockNowMs = Date.parse("2026-06-25T12:00:00.000Z");
function writeProgressiveLock(content, mtimeIso) {
  if (typeof content === "string") {
    fs.writeFileSync(progressiveLockPath, content, "utf8");
  } else {
    fs.writeFileSync(
      progressiveLockPath,
      `${JSON.stringify(content, null, 2)}\n`,
      "utf8"
    );
  }
  const mtime = new Date(mtimeIso);
  fs.utimesSync(progressiveLockPath, mtime, mtime);
}

const missingProgressiveLock = inspectProgressiveLock({
  lockPath: progressiveLockPath,
  nowMs: progressiveLockNowMs,
  root: progressiveLockRoot,
});
assert.equal(missingProgressiveLock.exists, false);
assert.equal(missingProgressiveLock.reason, "missing");
assert.equal(missingProgressiveLock.stale, false);

writeProgressiveLock(
  { pid: process.pid, createdAt: "2026-06-25T11:30:00.000Z" },
  "2026-06-25T11:30:00.000Z"
);
const activeProgressiveLock = inspectProgressiveLock({
  lockPath: progressiveLockPath,
  nowMs: progressiveLockNowMs,
  root: progressiveLockRoot,
  isProcessAlive: () => true,
});
assert.equal(activeProgressiveLock.exists, true);
assert.equal(activeProgressiveLock.stale, false);
assert.equal(activeProgressiveLock.reason, "active");
const activeProgressiveClear = clearStaleProgressiveLock({
  lockPath: progressiveLockPath,
  nowMs: progressiveLockNowMs,
  root: progressiveLockRoot,
  isProcessAlive: () => true,
});
assert.equal(activeProgressiveClear.cleared, false);
assert.equal(activeProgressiveClear.reason, "active");
assert.equal(fs.existsSync(progressiveLockPath), true);

writeProgressiveLock(
  { pid: null, createdAt: "2026-06-25T07:30:00.000Z" },
  "2026-06-25T07:30:00.000Z"
);
const staleProgressiveLockByAge = inspectProgressiveLock({
  lockPath: progressiveLockPath,
  nowMs: progressiveLockNowMs,
  root: progressiveLockRoot,
});
assert.equal(staleProgressiveLockByAge.stale, true);
assert.equal(staleProgressiveLockByAge.reason, "stale-age");
const staleProgressiveClear = clearStaleProgressiveLock({
  lockPath: progressiveLockPath,
  nowMs: progressiveLockNowMs,
  root: progressiveLockRoot,
});
assert.equal(staleProgressiveClear.cleared, true);
assert.equal(fs.existsSync(progressiveLockPath), false);

writeProgressiveLock(
  { pid: 999999, createdAt: "2026-06-25T11:50:00.000Z" },
  "2026-06-25T11:50:00.000Z"
);
const staleProgressiveLockByPid = inspectProgressiveLock({
  lockPath: progressiveLockPath,
  nowMs: progressiveLockNowMs,
  root: progressiveLockRoot,
  isProcessAlive: () => false,
});
assert.equal(staleProgressiveLockByPid.stale, true);
assert.equal(staleProgressiveLockByPid.reason, "process-not-found");

writeProgressiveLock("{invalid-json", "2026-06-25T07:30:00.000Z");
const invalidOldProgressiveLock = inspectProgressiveLock({
  lockPath: progressiveLockPath,
  nowMs: progressiveLockNowMs,
  root: progressiveLockRoot,
});
assert.equal(invalidOldProgressiveLock.stale, true);
assert.equal(invalidOldProgressiveLock.reason, "invalid-json");

writeProgressiveLock("{invalid-json", "2026-06-25T11:50:00.000Z");
const invalidFreshProgressiveLock = inspectProgressiveLock({
  lockPath: progressiveLockPath,
  nowMs: progressiveLockNowMs,
  root: progressiveLockRoot,
});
assert.equal(invalidFreshProgressiveLock.stale, false);
assert.equal(invalidFreshProgressiveLock.reason, "active");

const inventoryLockRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "smokingpipes-inventory-lock-")
);
const inventoryLockStateDir = path.join(
  inventoryLockRoot,
  "data",
  "inventory",
  "state"
);
const globalInventoryLockPath = path.join(
  inventoryLockStateDir,
  "smokingpipes.lock"
);
const progressiveInventoryLockPath = path.join(
  inventoryLockStateDir,
  "smokingpipes-progressive-daily.lock"
);
fs.mkdirSync(inventoryLockStateDir, { recursive: true });
const inventoryLockNowMs = Date.parse("2026-06-25T12:00:00.000Z");
const inventoryLockDefinitions = [
  {
    name: "global",
    path: "data/inventory/state/smokingpipes.lock",
  },
  {
    name: "progressiveDaily",
    path: "data/inventory/state/smokingpipes-progressive-daily.lock",
  },
];
function writeInventoryLock(lockPath, content, mtimeIso) {
  if (typeof content === "string") {
    fs.writeFileSync(lockPath, content, "utf8");
  } else {
    fs.writeFileSync(lockPath, `${JSON.stringify(content, null, 2)}\n`, "utf8");
  }
  const mtime = new Date(mtimeIso);
  fs.utimesSync(lockPath, mtime, mtime);
}
function unlinkIfExists(filePath) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

writeInventoryLock(
  globalInventoryLockPath,
  { pid: 999999, createdAt: "2026-06-25T11:58:00.000Z" },
  "2026-06-25T11:58:00.000Z"
);
const missingPidGlobalLocks = inspectInventoryLocks({
  root: inventoryLockRoot,
  nowMs: inventoryLockNowMs,
  lockDefinitions: inventoryLockDefinitions,
  isProcessAlive: () => false,
});
assert.equal(missingPidGlobalLocks.hasActiveLock, false);
assert.equal(missingPidGlobalLocks.locks[0].name, "global");
assert.equal(missingPidGlobalLocks.locks[0].status, "stale");
assert.equal(missingPidGlobalLocks.locks[0].reason, "process-not-found");

const clearedMissingPidGlobalLocks = clearStaleInventoryLocks({
  root: inventoryLockRoot,
  nowMs: inventoryLockNowMs,
  lockDefinitions: inventoryLockDefinitions,
  isProcessAlive: () => false,
});
assert.equal(clearedMissingPidGlobalLocks.hasActiveLock, false);
assert.equal(clearedMissingPidGlobalLocks.clearedLocks.length, 1);
assert.equal(clearedMissingPidGlobalLocks.clearedLocks[0].name, "global");
assert.equal(fs.existsSync(globalInventoryLockPath), false);

writeInventoryLock(
  globalInventoryLockPath,
  { pid: process.pid, createdAt: "2026-06-25T11:58:00.000Z" },
  "2026-06-25T11:58:00.000Z"
);
const activeGlobalLocks = clearStaleInventoryLocks({
  root: inventoryLockRoot,
  nowMs: inventoryLockNowMs,
  lockDefinitions: inventoryLockDefinitions,
  isProcessAlive: () => true,
});
assert.equal(activeGlobalLocks.hasActiveLock, true);
assert.equal(activeGlobalLocks.activeLocks.length, 1);
assert.equal(activeGlobalLocks.activeLocks[0].name, "global");
assert.equal(activeGlobalLocks.activeLocks[0].status, "active");
assert.equal(activeGlobalLocks.activeLocks[0].reason, "active-pid");
assert.equal(fs.existsSync(globalInventoryLockPath), true);

unlinkIfExists(globalInventoryLockPath);
writeInventoryLock(
  progressiveInventoryLockPath,
  { pid: null, createdAt: "2026-06-25T07:00:00.000Z" },
  "2026-06-25T07:00:00.000Z"
);
const clearedProgressiveInventoryLocks = clearStaleInventoryLocks({
  root: inventoryLockRoot,
  nowMs: inventoryLockNowMs,
  lockDefinitions: inventoryLockDefinitions,
});
assert.equal(clearedProgressiveInventoryLocks.clearedLocks.length, 1);
assert.equal(
  clearedProgressiveInventoryLocks.clearedLocks[0].name,
  "progressiveDaily"
);
assert.equal(fs.existsSync(progressiveInventoryLockPath), false);

writeInventoryLock(
  globalInventoryLockPath,
  { pid: process.pid, createdAt: "2026-06-25T11:58:00.000Z" },
  "2026-06-25T11:58:00.000Z"
);
writeInventoryLock(
  progressiveInventoryLockPath,
  { pid: 999999, createdAt: "2026-06-25T11:58:00.000Z" },
  "2026-06-25T11:58:00.000Z"
);
const mixedInventoryLocks = clearStaleInventoryLocks({
  root: inventoryLockRoot,
  nowMs: inventoryLockNowMs,
  lockDefinitions: inventoryLockDefinitions,
  isProcessAlive: (pid) => Number(pid) === process.pid,
});
assert.equal(mixedInventoryLocks.hasActiveLock, true);
assert.equal(mixedInventoryLocks.activeLocks.length, 1);
assert.equal(mixedInventoryLocks.activeLocks[0].name, "global");
assert.equal(mixedInventoryLocks.clearedLocks.length, 1);
assert.equal(mixedInventoryLocks.clearedLocks[0].name, "progressiveDaily");
assert.equal(fs.existsSync(globalInventoryLockPath), true);
assert.equal(fs.existsSync(progressiveInventoryLockPath), false);

const currentListCacheRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "smokingpipes-current-list-cache-")
);
const currentListCachePath = path.join(
  currentListCacheRoot,
  "smokingpipes-current-list-dry-run.json"
);
const currentListCacheNow = new Date("2026-06-25T12:00:00");
function writeCurrentListCacheFixture(overrides = {}) {
  const { summary: summaryOverrides = {}, ...topLevelOverrides } = overrides;
  const fixture = {
    generatedAt: "2026-06-25T03:00:00",
    completedAt: "2026-06-25T03:04:00",
    products: [
      { sourceProductId: "100" },
      { sourceProductId: "101" },
      { sourceProductId: "102" },
    ],
    summary: {
      pagesRequested: 107,
      pagesScanned: 107,
      expectedPages: 107,
      productsExtracted: 5136,
      uniqueProducts: 5136,
      duplicateSourceProductIds: [],
      captchaDetected: false,
      captchaPages: [],
      verificationDetectedAt: null,
      completeRequestedRange: true,
      fullExpectedRangeScanned: true,
      ...summaryOverrides,
    },
    ...topLevelOverrides,
  };
  fs.writeFileSync(currentListCachePath, JSON.stringify(fixture, null, 2), "utf8");
}

writeCurrentListCacheFixture();
const usableCurrentListCache = evaluateSmokingpipesCurrentListCache({
  currentListPath: currentListCachePath,
  now: currentListCacheNow,
});
assert.equal(usableCurrentListCache.usable, true);
assert.equal(usableCurrentListCache.reason, "complete current-list cache from today");
assert.equal(usableCurrentListCache.pagesScanned, 107);
assert.equal(usableCurrentListCache.expectedPages, 107);
assert.equal(usableCurrentListCache.productsExtracted, 5136);
assert.equal(usableCurrentListCache.uniqueProducts, 5136);
assert.equal(usableCurrentListCache.dateKey, "2026-06-25");

writeCurrentListCacheFixture({ generatedAt: "2026-06-24T23:00:00" });
assert.equal(
  evaluateSmokingpipesCurrentListCache({
    currentListPath: currentListCachePath,
    now: currentListCacheNow,
  }).reason,
  "stale"
);

const staleAllowedCurrentListCache = evaluateSmokingpipesCurrentListCache({
  currentListPath: currentListCachePath,
  now: currentListCacheNow,
  allowStale: true,
});
assert.equal(staleAllowedCurrentListCache.usable, true);
assert.equal(staleAllowedCurrentListCache.stale, true);
assert.equal(staleAllowedCurrentListCache.manualRecovery, true);
assert.equal(
  staleAllowedCurrentListCache.reason,
  "complete stale current-list cache allowed by manual recovery"
);
assert.equal(staleAllowedCurrentListCache.safety.soldByAbsenceAllowed, false);
assert.equal(staleAllowedCurrentListCache.safety.disappearedApplyAllowed, false);

writeCurrentListCacheFixture({
  summary: {
    pagesRequested: 104,
    pagesScanned: 83,
    expectedPages: 104,
    detectedTotalPages: 104,
    effectiveScannedPages: 104,
    skippedOutOfStockTailPages: Array.from(
      { length: 21 },
      (_, index) => 84 + index
    ),
    tailCacheUsed: true,
    tailCacheReason: "valid",
    firstOutOfStockOnlyPage: 84,
    completeRequestedRange: true,
    fullExpectedRangeScanned: true,
    soldByAbsenceAllowed: false,
    disappearedApplyAllowed: false,
  },
});
const tailSkippedCurrentListCache = evaluateSmokingpipesCurrentListCache({
  currentListPath: currentListCachePath,
  now: currentListCacheNow,
});
assert.equal(tailSkippedCurrentListCache.usable, true);
assert.equal(tailSkippedCurrentListCache.expectedPages, 104);
assert.equal(tailSkippedCurrentListCache.pagesScanned, 83);
assert.equal(tailSkippedCurrentListCache.effectiveScannedPages, 104);
assert.equal(tailSkippedCurrentListCache.tailCacheUsed, true);
assert.equal(tailSkippedCurrentListCache.skippedOutOfStockTailPages.length, 21);
assert.equal(tailSkippedCurrentListCache.safety.soldByAbsenceAllowed, false);
assert.equal(tailSkippedCurrentListCache.safety.disappearedApplyAllowed, false);

writeCurrentListCacheFixture({ summary: { pagesScanned: 106 } });
assert.equal(
  evaluateSmokingpipesCurrentListCache({
    currentListPath: currentListCachePath,
    now: currentListCacheNow,
  }).reason,
  "incomplete"
);
assert.equal(
  evaluateSmokingpipesCurrentListCache({
    currentListPath: currentListCachePath,
    now: currentListCacheNow,
    allowStale: true,
  }).usable,
  false
);

writeCurrentListCacheFixture({ summary: { captchaDetected: true } });
assert.equal(
  evaluateSmokingpipesCurrentListCache({
    currentListPath: currentListCachePath,
    now: currentListCacheNow,
  }).reason,
  "captcha"
);

writeCurrentListCacheFixture({
  summary: { verificationDetectedAt: "2026-06-25T03:01:00" },
});
assert.equal(
  evaluateSmokingpipesCurrentListCache({
    currentListPath: currentListCachePath,
    now: currentListCacheNow,
  }).reason,
  "verification"
);

writeCurrentListCacheFixture({
  summary: { duplicateSourceProductIds: ["100"] },
});
const metadataOnlyDuplicateCurrentListCache =
  evaluateSmokingpipesCurrentListCache({
    currentListPath: currentListCachePath,
    now: currentListCacheNow,
  });
assert.equal(metadataOnlyDuplicateCurrentListCache.usable, true);
assert.equal(
  metadataOnlyDuplicateCurrentListCache.reason,
  "complete current-list cache from today"
);
assert.equal(metadataOnlyDuplicateCurrentListCache.duplicateIdCountFromField, 1);
assert.equal(metadataOnlyDuplicateCurrentListCache.duplicateIdCountFromRecords, 0);
assert.equal(metadataOnlyDuplicateCurrentListCache.dedupeRequired, false);
assert.equal(metadataOnlyDuplicateCurrentListCache.dedupeSafe, true);
assert.deepEqual(metadataOnlyDuplicateCurrentListCache.duplicateSamples, []);
assert.match(
  metadataOnlyDuplicateCurrentListCache.warnings.join("\n"),
  /metadata is present, but no duplicate records were found/
);

writeCurrentListCacheFixture({
  generatedAt: "2026-06-24T23:00:00",
  products: [
    {
      sourceProductId: "100",
      sourceUrl: "https://example.test/100",
      title: "Pipe 100",
      priceRaw: "$100.00",
      inventoryStatus: "available",
    },
    {
      sourceProductId: "100",
      sourceUrl: "https://example.test/100",
      title: "Pipe 100",
      priceRaw: "$100.00",
      inventoryStatus: "available",
    },
    {
      sourceProductId: "101",
      sourceUrl: "https://example.test/101",
      title: "Pipe 101",
      priceRaw: "$101.00",
      inventoryStatus: "available",
    },
  ],
  summary: {
    duplicateSourceProductIds: ["100"],
    productsExtracted: 3,
    uniqueProducts: 2,
  },
});
const safeDuplicateManualRecoveryCache = evaluateSmokingpipesCurrentListCache({
  currentListPath: currentListCachePath,
  now: currentListCacheNow,
  allowStale: true,
  allowDuplicateDedupe: true,
});
assert.equal(safeDuplicateManualRecoveryCache.usable, true);
assert.equal(safeDuplicateManualRecoveryCache.dedupeRequired, true);
assert.equal(safeDuplicateManualRecoveryCache.dedupeSafe, true);
assert.equal(safeDuplicateManualRecoveryCache.duplicateIdCount, 1);
assert.equal(safeDuplicateManualRecoveryCache.duplicateIdCountFromField, 1);
assert.equal(safeDuplicateManualRecoveryCache.duplicateIdCountFromRecords, 1);
assert.equal(safeDuplicateManualRecoveryCache.conflictDuplicateIdCount, 0);
assert.equal(safeDuplicateManualRecoveryCache.duplicateSamples[0].count, 2);
assert.equal(safeDuplicateManualRecoveryCache.duplicateSamples[0].conflict, false);

const threeDuplicateIdAudit = auditSmokingpipesDuplicateIds({
  products: [
    { sourceProductId: "safe", sourceUrl: "https://example.test/safe", title: "Safe", priceRaw: "$10", inventoryStatus: "available" },
    { sourceProductId: "safe", sourceUrl: "https://example.test/safe", title: "Safe", priceRaw: "$10", inventoryStatus: "available" },
    { sourceProductId: "conflict", sourceUrl: "https://example.test/conflict", title: "Conflict", priceRaw: "$20", inventoryStatus: "available" },
    { sourceProductId: "conflict", sourceUrl: "https://example.test/conflict", title: "Conflict", priceRaw: "$21", inventoryStatus: "available" },
    { sourceProductId: "single", sourceUrl: "https://example.test/single", title: "Single", priceRaw: "$30", inventoryStatus: "available" },
  ],
  sourceProductIds: ["safe", "conflict", "single"],
});
assert.equal(threeDuplicateIdAudit.requestedCount, 3);
assert.equal(threeDuplicateIdAudit.safeDuplicateCount, 1);
assert.equal(threeDuplicateIdAudit.conflictDuplicateCount, 1);
assert.deepEqual(
  threeDuplicateIdAudit.entries.map((entry) => entry.status),
  ["safe-duplicate", "conflict-duplicate", "single"]
);

const crossDayCacheWithoutManualRecovery = evaluateSmokingpipesCurrentListCache({
  currentListPath: currentListCachePath,
  now: new Date("2026-06-26T12:00:00.000Z"),
  allowStale: false,
  allowDuplicateDedupe: true,
});
assert.equal(crossDayCacheWithoutManualRecovery.stale, true);
assert.equal(crossDayCacheWithoutManualRecovery.usable, false);

writeCurrentListCacheFixture({
  generatedAt: "2026-06-24T23:00:00",
  products: [
    {
      sourceProductId: "200",
      sourceUrl: "https://example.test/200",
      title: "Pipe 200",
      priceRaw: "$200.00",
      inventoryStatus: "available",
    },
    {
      sourceProductId: "200",
      sourceUrl: "https://example.test/200",
      title: "Pipe 200",
      priceRaw: "$201.00",
      inventoryStatus: "available",
    },
  ],
  summary: {
    duplicateSourceProductIds: ["200"],
    productsExtracted: 2,
    uniqueProducts: 1,
  },
});
const conflictDuplicateManualRecoveryCache =
  evaluateSmokingpipesCurrentListCache({
    currentListPath: currentListCachePath,
    now: currentListCacheNow,
    allowStale: true,
    allowDuplicateDedupe: true,
  });
assert.equal(conflictDuplicateManualRecoveryCache.usable, false);
assert.equal(conflictDuplicateManualRecoveryCache.reason, "duplicate-id-conflict");
assert.equal(conflictDuplicateManualRecoveryCache.dedupeSafe, false);
assert.equal(conflictDuplicateManualRecoveryCache.conflictDuplicateIdCount, 1);

writeCurrentListCacheFixture({
  summary: { productsExtracted: 0, uniqueProducts: 0 },
});
assert.equal(
  evaluateSmokingpipesCurrentListCache({
    currentListPath: currentListCachePath,
    now: currentListCacheNow,
  }).reason,
  "empty-products"
);

assert.equal(
  evaluateSmokingpipesCurrentListCache({
    currentListPath: path.join(currentListCacheRoot, "missing.json"),
    now: currentListCacheNow,
  }).reason,
  "missing"
);

const recoveryPreflightRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "smokingpipes-recovery-preflight-")
);
const recoveryPreflightInventoryDir = path.join(
  recoveryPreflightRoot,
  "data",
  "inventory"
);
const recoveryPreflightStateDir = path.join(
  recoveryPreflightInventoryDir,
  "state"
);
const recoveryPreflightReviewDir = path.join(
  recoveryPreflightRoot,
  "data",
  "review"
);
fs.mkdirSync(recoveryPreflightStateDir, { recursive: true });
fs.mkdirSync(recoveryPreflightReviewDir, { recursive: true });
const recoveryPreflightNow = new Date("2026-06-25T12:00:00.000Z");
const recoveryPreflightCurrentListPath = path.join(
  recoveryPreflightInventoryDir,
  "smokingpipes-current-list-dry-run.json"
);
const recoveryPreflightTaskStatePath = path.join(
  recoveryPreflightInventoryDir,
  "smokingpipes-daily-task-state.json"
);
const recoveryPreflightDailyLockPath = path.join(
  recoveryPreflightInventoryDir,
  "smokingpipes-daily-task-lock.json"
);
function writeRecoveryPreflightCurrentList(overrides = {}) {
  const { summary: summaryOverrides = {}, ...topLevelOverrides } = overrides;
  fs.writeFileSync(
    recoveryPreflightCurrentListPath,
    JSON.stringify(
      {
        generatedAt: "2026-06-24T03:00:00.000Z",
        completedAt: "2026-06-24T03:05:00.000Z",
        products: [
          { sourceProductId: "100", sourceUrl: "https://example.test/100" },
          { sourceProductId: "101", sourceUrl: "https://example.test/101" },
        ],
        summary: {
          pagesScanned: 107,
          expectedPages: 107,
          productsExtracted: 2,
          uniqueProducts: 2,
          duplicateSourceProductIds: [],
          captchaDetected: false,
          captchaPages: [],
          verificationDetectedAt: null,
          completeRequestedRange: true,
          fullExpectedRangeScanned: true,
          ...summaryOverrides,
        },
        ...topLevelOverrides,
      },
      null,
      2
    ),
    "utf8"
  );
}
function writeRecoveryPreflightTaskState(overrides = {}) {
  fs.writeFileSync(
    recoveryPreflightTaskStatePath,
    JSON.stringify(
      {
        source: "smokingpipes",
        dateKey: "2026-06-25",
        status: "retryable-failed",
        retryAllowed: true,
        nextRetryRecommendedAt: "2026-06-25T14:00:00.000Z",
        ...overrides,
      },
      null,
      2
    ),
    "utf8"
  );
}
writeRecoveryPreflightCurrentList();
writeRecoveryPreflightTaskState();

const blockedByRetryWindowPreflight =
  evaluateSmokingpipesDailyRecoveryPreflight({
    root: recoveryPreflightRoot,
    now: recoveryPreflightNow,
    options: {
      skipCurrentList: true,
      allowStaleCurrentListCache: true,
      allowDuplicateDedupe: true,
      forceRunOnce: false,
      preflightOnly: true,
    },
    isProcessAlive: () => false,
  });
assert.equal(blockedByRetryWindowPreflight.overall.status, "wait");
assert.equal(blockedByRetryWindowPreflight.overall.canRun, false);
assert.equal(blockedByRetryWindowPreflight.retryWindow.blockedByRetryWindow, true);
assert.equal(blockedByRetryWindowPreflight.retryWindow.forceRunOnce, false);
assert.equal(
  blockedByRetryWindowPreflight.overall.willFetchCurrentList,
  false
);

const forceRunRecoveryPreflight = evaluateSmokingpipesDailyRecoveryPreflight({
  root: recoveryPreflightRoot,
  now: recoveryPreflightNow,
  options: {
    skipCurrentList: true,
    allowStaleCurrentListCache: true,
    allowDuplicateDedupe: true,
    forceRunOnce: true,
    preflightOnly: true,
  },
  isProcessAlive: () => false,
});
assert.equal(forceRunRecoveryPreflight.overall.status, "ready");
assert.equal(forceRunRecoveryPreflight.overall.canRun, true);
assert.equal(forceRunRecoveryPreflight.retryWindow.blockedByRetryWindow, false);
assert.equal(forceRunRecoveryPreflight.currentListCache.stale, true);
assert.equal(forceRunRecoveryPreflight.currentListCache.usable, true);
assert.equal(
  forceRunRecoveryPreflight.currentListCache.safety.soldByAbsenceAllowed,
  false
);
assert.equal(
  forceRunRecoveryPreflight.currentListCache.safety.disappearedApplyAllowed,
  false
);
assert.equal(forceRunRecoveryPreflight.executionPlan.skipCurrentList, true);
assert.equal(
  forceRunRecoveryPreflight.executionPlan.forbiddenSteps.includes(
    "fetch current-list"
  ),
  true
);
assert.equal(forceRunRecoveryPreflight.networkPlan.willFetchDetails, false);
assert.equal(forceRunRecoveryPreflight.networkPlan.willStartBrowser, false);

const cachedListResumePreflight = evaluateSmokingpipesDailyRecoveryPreflight({
  root: recoveryPreflightRoot,
  now: recoveryPreflightNow,
  options: {
    skipCurrentList: true,
    allowStaleCurrentListCache: true,
    allowDuplicateDedupe: true,
    forceRunOnce: true,
    resumeFromCachedList: true,
    lockCurrentListSnapshotUntilComplete: true,
  },
  isProcessAlive: () => false,
});
assert.equal(cachedListResumePreflight.overall.status, "ready");
assert.equal(cachedListResumePreflight.overall.canRun, true);
assert.equal(cachedListResumePreflight.networkPlan.willAccessSmokingpipes, true);
assert.equal(cachedListResumePreflight.networkPlan.willFetchCurrentList, false);
assert.equal(cachedListResumePreflight.networkPlan.willFetchDetails, true);
assert.equal(cachedListResumePreflight.networkPlan.willStartBrowser, true);
assert.equal(
  cachedListResumePreflight.networkPlan.willUseExistingCurrentListCache,
  true
);
assert.equal(
  cachedListResumePreflight.networkPlan.willUseExistingStateOnly,
  false
);
assert.equal(
  cachedListResumePreflight.resumePlan.mode,
  "cached-list-detail-resume"
);
assert.equal(cachedListResumePreflight.resumePlan.resumeFromCachedList, true);
assert.equal(
  cachedListResumePreflight.resumePlan.lockCurrentListSnapshotUntilComplete,
  true
);
assert.equal(
  cachedListResumePreflight.resumePlan.allowNextListFetchAfterComplete,
  true
);
assert.equal(cachedListResumePreflight.overall.willFetchCurrentList, false);
assert.equal(cachedListResumePreflight.overall.willWriteProduction, false);

const standardDailyPreflight = evaluateSmokingpipesDailyRecoveryPreflight({
  root: recoveryPreflightRoot,
  now: recoveryPreflightNow,
  options: {
    preflightOnly: false,
    skipCurrentList: false,
    allowStaleCurrentListCache: false,
    allowDuplicateDedupe: false,
    forceRunOnce: true,
  },
  isProcessAlive: () => false,
});
assert.equal(standardDailyPreflight.networkPlan.willFetchDetails, true);
assert.equal(standardDailyPreflight.networkPlan.willStartBrowser, true);

const unsafeCachedListResumePreflight =
  evaluateSmokingpipesDailyRecoveryPreflight({
    root: recoveryPreflightRoot,
    now: recoveryPreflightNow,
    options: {
      skipCurrentList: true,
      allowStaleCurrentListCache: false,
      allowDuplicateDedupe: true,
      forceRunOnce: true,
      resumeFromCachedList: true,
      lockCurrentListSnapshotUntilComplete: true,
    },
    isProcessAlive: () => false,
  });
assert.equal(unsafeCachedListResumePreflight.overall.status, "blocked");
assert.equal(unsafeCachedListResumePreflight.overall.canRun, false);
assert.match(
  unsafeCachedListResumePreflight.overall.reason,
  /ResumeFromCachedList requested but no safe current-list cache is available/
);
assert.equal(
  unsafeCachedListResumePreflight.networkPlan.willFetchCurrentList,
  false
);

writeInventoryLock(
  recoveryPreflightDailyLockPath,
  { pid: 999999, startedAt: "2026-06-25T07:00:00.000Z" },
  "2026-06-25T07:00:00.000Z"
);
const preflightOnlyStaleLockReport =
  evaluateSmokingpipesDailyRecoveryPreflight({
    root: recoveryPreflightRoot,
    now: recoveryPreflightNow,
    options: {
      preflightOnly: true,
      skipCurrentList: true,
      allowStaleCurrentListCache: true,
      allowDuplicateDedupe: true,
      forceRunOnce: true,
    },
    isProcessAlive: () => false,
  });
assert.equal(preflightOnlyStaleLockReport.locks.staleLocks.length, 1);
assert.equal(preflightOnlyStaleLockReport.locks.clearedLocks.length, 0);
assert.equal(fs.existsSync(recoveryPreflightDailyLockPath), true);

const executionStaleLockReport = evaluateSmokingpipesDailyRecoveryPreflight({
  root: recoveryPreflightRoot,
  now: recoveryPreflightNow,
  options: {
    preflightOnly: false,
    clearStaleLocks: true,
    skipCurrentList: true,
    allowStaleCurrentListCache: true,
    allowDuplicateDedupe: true,
    forceRunOnce: true,
  },
  isProcessAlive: () => false,
});
assert.equal(executionStaleLockReport.locks.clearedLocks.length, 1);
assert.equal(fs.existsSync(recoveryPreflightDailyLockPath), false);

writeInventoryLock(
  recoveryPreflightDailyLockPath,
  { pid: process.pid, startedAt: "2026-06-25T11:58:00.000Z" },
  "2026-06-25T11:58:00.000Z"
);
const activeLockPreflight = evaluateSmokingpipesDailyRecoveryPreflight({
  root: recoveryPreflightRoot,
  now: recoveryPreflightNow,
  options: {
    preflightOnly: true,
    skipCurrentList: true,
    allowStaleCurrentListCache: true,
    allowDuplicateDedupe: true,
    forceRunOnce: true,
  },
  isProcessAlive: (pid) => Number(pid) === process.pid,
});
assert.equal(activeLockPreflight.overall.status, "wait");
assert.equal(activeLockPreflight.overall.canRun, false);
assert.equal(activeLockPreflight.locks.hasActiveLock, true);
unlinkIfExists(recoveryPreflightDailyLockPath);

writeRecoveryPreflightCurrentList({
  products: [
    {
      sourceProductId: "300",
      sourceUrl: "https://example.test/300",
      title: "Pipe 300",
      priceRaw: "$300.00",
      inventoryStatus: "available",
    },
    {
      sourceProductId: "300",
      sourceUrl: "https://example.test/300",
      title: "Pipe 300",
      priceRaw: "$300.00",
      inventoryStatus: "available",
    },
  ],
  summary: {
    duplicateSourceProductIds: ["300"],
    productsExtracted: 2,
    uniqueProducts: 1,
  },
});
const safeDuplicatePreflight = evaluateSmokingpipesDailyRecoveryPreflight({
  root: recoveryPreflightRoot,
  now: recoveryPreflightNow,
  options: {
    preflightOnly: true,
    skipCurrentList: true,
    allowStaleCurrentListCache: true,
    allowDuplicateDedupe: true,
    forceRunOnce: true,
  },
  isProcessAlive: () => false,
});
assert.equal(safeDuplicatePreflight.currentListCache.usable, true);
assert.equal(safeDuplicatePreflight.currentListCache.dedupeRequired, true);
assert.equal(safeDuplicatePreflight.currentListCache.dedupeSafe, true);
assert.equal(safeDuplicatePreflight.currentListCache.conflictDuplicateIdCount, 0);
assert.equal(safeDuplicatePreflight.errors.length, 0);
assert.ok(safeDuplicatePreflight.warnings.length >= 1);
assert.equal(safeDuplicatePreflight.overall.status, "ready");
assert.equal(safeDuplicatePreflight.overall.canRun, true);
assert.equal(safeDuplicatePreflight.overall.willWriteProduction, false);

writeRecoveryPreflightCurrentList({
  products: [
    {
      sourceProductId: "400",
      sourceUrl: "https://example.test/400",
      title: "Pipe 400",
      priceRaw: "$400.00",
      inventoryStatus: "available",
    },
    {
      sourceProductId: "400",
      sourceUrl: "https://example.test/400",
      title: "Pipe 400",
      priceRaw: "$401.00",
      inventoryStatus: "available",
    },
  ],
  summary: {
    duplicateSourceProductIds: ["400"],
    productsExtracted: 2,
    uniqueProducts: 1,
  },
});
const conflictDuplicatePreflight = evaluateSmokingpipesDailyRecoveryPreflight({
  root: recoveryPreflightRoot,
  now: recoveryPreflightNow,
  options: {
    preflightOnly: true,
    skipCurrentList: true,
    allowStaleCurrentListCache: true,
    allowDuplicateDedupe: true,
    forceRunOnce: true,
  },
  isProcessAlive: () => false,
});
assert.equal(conflictDuplicatePreflight.overall.status, "unsafe");
assert.equal(conflictDuplicatePreflight.overall.canRun, false);
assert.equal(
  conflictDuplicatePreflight.currentListCache.conflictDuplicateIdCount,
  1
);

assert.equal(defaults.source, "smokingpipes");
assert.equal(defaults.mode, "dry-run");
assert.equal(defaults.commit, false);
assert.equal(defaults.deploy, false);
assert.equal(defaults.maxPages, 200);
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
assert.equal(
  parseRunnerOptions([
    "--mode=progressive-partial-apply",
    "--write-production",
    "--manual-large-apply",
  ]).manualLargeApply,
  true
);
assert.throws(
  () =>
    parseRunnerOptions([
      "--mode=progressive-partial-apply",
      "--manual-large-apply",
    ]),
  /requires --write-production/
);
assert.throws(
  () =>
    parseRunnerOptions([
      "--mode=progressive-prepare-apply",
      "--write-production",
      "--manual-large-apply",
    ]),
  /requires --mode=progressive-partial-apply/
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

const tailSkippedInventoryDiff = buildInventoryDiff(
  {
    version: "smokingpipes-current-list-dry-run-v1",
    source: "smokingpipes",
    products: [
      {
        sourceProductId: "tail-visible",
        sourceUrl: "https://example.test/?product_id=tail-visible",
        title: "Visible available pipe",
        price: "$100.00",
      },
    ],
    summary: {
      pagesRequested: 104,
      pagesScanned: 83,
      expectedPages: 104,
      detectedTotalPages: 104,
      effectiveScannedPages: 104,
      skippedOutOfStockTailPages: Array.from(
        { length: 21 },
        (_, index) => 84 + index
      ),
      tailCacheUsed: true,
      tailCacheReason: "valid",
      firstOutOfStockOnlyPage: 84,
      captchaDetected: false,
      captchaPages: [],
      completeRequestedRange: true,
      fullExpectedRangeScanned: true,
      soldByAbsenceAllowed: false,
      disappearedApplyAllowed: false,
    },
  },
  {
    products: [
      {
        sourceProductId: "tail-visible",
        inventoryStatus: "available",
      },
      {
        sourceProductId: "tail-skipped-existing",
        inventoryStatus: "available",
      },
    ],
  }
);
assert.equal(tailSkippedInventoryDiff.coverage.fullExpectedRangeScanned, true);
assert.equal(tailSkippedInventoryDiff.coverage.tailCacheUsed, true);
assert.equal(tailSkippedInventoryDiff.coverage.soldByAbsenceAllowed, false);
assert.equal(tailSkippedInventoryDiff.coverage.disappearedApplyAllowed, false);
assert.deepEqual(
  tailSkippedInventoryDiff.disappearedIds,
  [],
  "skipped OOS tail pages must not create disappeared candidates"
);
assert.equal(tailSkippedInventoryDiff.allowApply, false);
assert.match(
  tailSkippedInventoryDiff.applyBlockedReasons.join("\n"),
  /sold-by-absence|disappeared/i
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

const smokingpipesPagination104 = detectSmokingpipesTotalPagesFromHtml(`
  <nav class="pagination">
    <a href="/pipes/?DISPLAYNUM=48&page=103">103</a>
    <a href="/pipes/?DISPLAYNUM=48&page=104">104</a>
  </nav>
`);
assert.equal(smokingpipesPagination104, 104);
const adaptivePlan104 = buildSmokingpipesAdaptiveScanPlan({
  requestedMaxPages: 107,
  expectedPages: 107,
  detectedTotalPages: smokingpipesPagination104,
});
assert.equal(adaptivePlan104.detectedTotalPages, 104);
assert.equal(adaptivePlan104.expectedPages, 104);
assert.equal(adaptivePlan104.pagesToVisit.length, 104);
assert.equal(adaptivePlan104.pagesToVisit.at(-1), 104);
assert.equal(
  adaptivePlan104.pagesToVisit.includes(105),
  false,
  "dynamic pagination must avoid visiting obsolete empty tail pages"
);

const smokingpipesPagination150 = detectSmokingpipesTotalPagesFromHtml(`
  <a href="/pipes/?DISPLAYNUM=48&page=1">1</a>
  <a href="/pipes/?DISPLAYNUM=48&page=150">Last</a>
`);
const adaptivePlan150 = buildSmokingpipesAdaptiveScanPlan({
  requestedMaxPages: 107,
  expectedPages: 107,
  detectedTotalPages: smokingpipesPagination150,
});
assert.equal(adaptivePlan150.detectedTotalPages, 150);
assert.equal(adaptivePlan150.expectedPages, 150);
assert.equal(adaptivePlan150.pagesToVisit.length, 150);
assert.equal(adaptivePlan150.pagesToVisit.at(-1), 150);

assert.equal(
  detectSmokingpipesTotalPagesFromHtml(`
    <nav class="pagination">
      <a class="page">102</a>
      <a class="page">103</a>
      <a class="page">104</a>
    </nav>
  `),
  104
);

const smokingpipesPaginationCurrentPageOnly =
  detectSmokingpipesTotalPagesFromHtml(`
    <nav class="pagination">
      <span class="current">1</span>
      <a aria-current="page" href="/pipes/?DISPLAYNUM=48&page=1">1</a>
    </nav>
  `);
assert.equal(
  smokingpipesPaginationCurrentPageOnly,
  0,
  "page=1 alone is not trustworthy total-page evidence"
);
const adaptivePlanCurrentPageOnly = buildSmokingpipesAdaptiveScanPlan({
  requestedMaxPages: 107,
  expectedPages: 107,
  detectedTotalPages: smokingpipesPaginationCurrentPageOnly,
  paginationLinksFound: 1,
  paginationMaxPageParam: 1,
});
assert.equal(adaptivePlanCurrentPageOnly.detectedTotalPages, null);
assert.equal(adaptivePlanCurrentPageOnly.expectedPages, 107);
assert.equal(adaptivePlanCurrentPageOnly.pagesToVisit.length, 107);
assert.equal(adaptivePlanCurrentPageOnly.detectionConfidence, "low");
assert.equal(adaptivePlanCurrentPageOnly.paginationLinksFound, 1);
assert.equal(adaptivePlanCurrentPageOnly.paginationMaxPageParam, 1);

const adaptivePlanNoPagination = buildSmokingpipesAdaptiveScanPlan({
  requestedMaxPages: 107,
  expectedPages: 107,
  detectedTotalPages: 0,
  paginationLinksFound: 0,
  paginationMaxPageParam: null,
});
assert.equal(adaptivePlanNoPagination.detectedTotalPages, null);
assert.equal(adaptivePlanNoPagination.expectedPages, 107);
assert.equal(adaptivePlanNoPagination.pagesToVisit.at(-1), 107);
assert.equal(adaptivePlanNoPagination.detectionConfidence, "low");
assert.equal(adaptivePlanNoPagination.paginationLinksFound, 0);
assert.equal(adaptivePlanNoPagination.paginationMaxPageParam, null);

const fallbackEmptyTailDecision =
  shouldTreatSmokingpipesEmptyListPageAsEndOfList({
    pageNumber: 105,
    productCount: 0,
    detectionConfidence: "low",
    detectedTotalPages: null,
    classification: {
      cloudflareSuspected: false,
      verificationSuspected: false,
      blockedPageSuspected: false,
      keywordsFound: [],
    },
    strongVerificationSignals: [],
  });
assert.equal(fallbackEmptyTailDecision.endOfList, true);
assert.equal(fallbackEmptyTailDecision.endOfListPage, 105);
assert.equal(fallbackEmptyTailDecision.effectiveLastProductPage, 104);
assert.equal(fallbackEmptyTailDecision.shouldWriteFailureSnapshot, false);

const fallbackEmptyBlockedDecision =
  shouldTreatSmokingpipesEmptyListPageAsEndOfList({
    pageNumber: 105,
    productCount: 0,
    detectionConfidence: "low",
    detectedTotalPages: null,
    classification: {
      cloudflareSuspected: true,
      verificationSuspected: true,
      blockedPageSuspected: true,
      keywordsFound: ["Cloudflare", "Verify you are human"],
    },
    strongVerificationSignals: ["explicit challenge element"],
  });
assert.equal(fallbackEmptyBlockedDecision.endOfList, false);
assert.equal(fallbackEmptyBlockedDecision.shouldWriteFailureSnapshot, true);
assert.equal(fallbackEmptyBlockedDecision.reason, "blocked-or-verification-signal");

for (const blockingEmptyPageFixture of [
  { label: "Cloudflare", title: "Smokingpipes", html: "Cloudflare" },
  {
    label: "Verify",
    title: "Smokingpipes",
    html: "Verify you are human",
  },
  {
    label: "Just a moment",
    title: "Just a moment...",
    html: "",
  },
  { label: "Access denied", title: "Smokingpipes", html: "Access denied" },
  { label: "captcha", title: "Smokingpipes", html: "CAPTCHA" },
  { label: "blocked", title: "Smokingpipes", html: "Request blocked" },
]) {
  const classification = classifySmokingpipesFailureSnapshotText({
    title: blockingEmptyPageFixture.title,
    html: blockingEmptyPageFixture.html,
  });
  const decision = shouldTreatSmokingpipesEmptyListPageAsEndOfList({
    pageNumber: 105,
    productCount: 0,
    detectionConfidence: "low",
    detectedTotalPages: null,
    classification,
    strongVerificationSignals: [],
  });
  assert.equal(
    decision.endOfList,
    false,
    `${blockingEmptyPageFixture.label} empty page must remain a failure`
  );
  assert.equal(
    decision.shouldWriteFailureSnapshot,
    true,
    `${blockingEmptyPageFixture.label} empty page must preserve failure evidence`
  );
  assert.equal(decision.reason, "blocked-or-verification-signal");
}

const firstPageEmptyDecision =
  shouldTreatSmokingpipesEmptyListPageAsEndOfList({
    pageNumber: 1,
    productCount: 0,
    detectionConfidence: "low",
    detectedTotalPages: null,
    classification: {
      cloudflareSuspected: false,
      verificationSuspected: false,
      blockedPageSuspected: false,
      keywordsFound: [],
    },
    strongVerificationSignals: [],
  });
assert.equal(firstPageEmptyDecision.endOfList, false);
assert.equal(firstPageEmptyDecision.shouldWriteFailureSnapshot, true);
assert.equal(firstPageEmptyDecision.reason, "first-page-empty");

const highConfidenceEmptyTailDecision =
  shouldTreatSmokingpipesEmptyListPageAsEndOfList({
    pageNumber: 105,
    productCount: 0,
    detectionConfidence: "high",
    detectedTotalPages: 104,
    classification: {
      cloudflareSuspected: false,
      verificationSuspected: false,
      blockedPageSuspected: false,
      keywordsFound: [],
    },
    strongVerificationSignals: [],
  });
assert.equal(highConfidenceEmptyTailDecision.endOfList, false);
assert.equal(highConfidenceEmptyTailDecision.reason, "outside-fallback-scan");

function smokingpipesTailTestPage(page, statuses) {
  return {
    page,
    productCount: statuses.length,
    outOfStockCount: statuses.filter((status) => status === "out-of-stock").length,
    products: statuses.map((status, index) => ({
      sourceProductId: `${page}-${index + 1}`,
      rawListStatus: status,
      inventoryStatus: status,
    })),
  };
}

const tailCandidatePages = [
  smokingpipesTailTestPage(82, ["available", "out-of-stock"]),
  smokingpipesTailTestPage(83, ["available", "available"]),
  ...Array.from({ length: 21 }, (_, index) =>
    smokingpipesTailTestPage(84 + index, ["out-of-stock", "out-of-stock"])
  ),
];
const tailEvaluation = evaluateSmokingpipesOutOfStockTail({
  pages: tailCandidatePages,
  detectedTotalPages: 104,
  confirmedAt: "2026-07-08T10:00:00.000+08:00",
});
assert.equal(tailEvaluation.firstOutOfStockOnlyPage, 84);
assert.equal(tailEvaluation.tailCache.tailStartPage, 84);
assert.equal(tailEvaluation.tailCache.tailEndPage, 104);
assert.equal(tailEvaluation.tailCache.pages.length, 21);
assert.deepEqual(tailEvaluation.tailCache.pages[0].productIds, ["84-1", "84-2"]);
assert.match(tailEvaluation.tailCache.pages[0].statusHash, /^[a-f0-9]{64}$/);

const explicitTailCache = buildSmokingpipesOutOfStockTailCache({
  pages: tailCandidatePages.slice(2),
  tailStartPage: 84,
  detectedTotalPages: 104,
  confirmedAt: "2026-07-08T10:00:00.000+08:00",
});
assert.equal(explicitTailCache.pages.length, 21);
assert.equal(
  evaluateSmokingpipesOutOfStockTailCache({
    cache: explicitTailCache,
    detectedTotalPages: 104,
    now: "2026-07-08T20:00:00.000+08:00",
    maxAgeHours: 24,
  }).usable,
  true
);
const adaptiveTailSkipPlan = buildSmokingpipesAdaptiveScanPlan({
  requestedMaxPages: 107,
  expectedPages: 107,
  detectedTotalPages: 104,
  tailCache: explicitTailCache,
  now: "2026-07-08T20:00:00.000+08:00",
  tailCacheMaxAgeHours: 24,
});
assert.equal(adaptiveTailSkipPlan.tailCacheUsed, true);
assert.equal(adaptiveTailSkipPlan.firstOutOfStockOnlyPage, 84);
assert.equal(adaptiveTailSkipPlan.skippedOutOfStockTailPages.length, 21);
assert.equal(adaptiveTailSkipPlan.pagesToVisit.at(-1), 83);
assert.equal(adaptiveTailSkipPlan.safety.soldByAbsenceAllowed, false);
assert.equal(adaptiveTailSkipPlan.safety.disappearedApplyAllowed, false);

const expiredTailPlan = buildSmokingpipesAdaptiveScanPlan({
  requestedMaxPages: 107,
  expectedPages: 107,
  detectedTotalPages: 104,
  tailCache: explicitTailCache,
  now: "2026-07-10T20:00:00.000+08:00",
  tailCacheMaxAgeHours: 24,
});
assert.equal(expiredTailPlan.tailCacheUsed, false);
assert.equal(expiredTailPlan.pagesToVisit.at(-1), 104);
assert.match(expiredTailPlan.tailCacheReason, /expired/);

const changedTotalPagesTailPlan = buildSmokingpipesAdaptiveScanPlan({
  requestedMaxPages: 107,
  expectedPages: 107,
  detectedTotalPages: 105,
  tailCache: explicitTailCache,
  now: "2026-07-08T20:00:00.000+08:00",
  tailCacheMaxAgeHours: 24,
});
assert.equal(changedTotalPagesTailPlan.tailCacheUsed, false);
assert.equal(changedTotalPagesTailPlan.pagesToVisit.at(-1), 105);
assert.match(changedTotalPagesTailPlan.tailCacheReason, /page-count-changed/);

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

const cloudflareFailureSnapshotClassification =
  classifySmokingpipesFailureSnapshotText({
    title: "Just a moment...",
    html: "<html><body>Cloudflare Verify you are human cf-chl Turnstile</body></html>",
  });
assert.equal(cloudflareFailureSnapshotClassification.cloudflareSuspected, true);
assert.equal(
  cloudflareFailureSnapshotClassification.verificationSuspected,
  true
);
assert.equal(
  cloudflareFailureSnapshotClassification.blockedPageSuspected,
  true
);
assert.deepEqual(
  cloudflareFailureSnapshotClassification.keywordsFound.sort(),
  ["Cloudflare", "Just a moment", "Turnstile", "Verify you are human", "cf-chl"].sort()
);

const normalFailureSnapshotClassification =
  classifySmokingpipesFailureSnapshotText({
    title: "Smokingpipes | New Pipes",
    html: "<main><a href='moreinfo.cfm?product_id=1'>Normal pipe</a></main>",
  });
assert.equal(normalFailureSnapshotClassification.cloudflareSuspected, false);
assert.equal(normalFailureSnapshotClassification.verificationSuspected, false);
assert.equal(normalFailureSnapshotClassification.blockedPageSuspected, false);
assert.deepEqual(normalFailureSnapshotClassification.keywordsFound, []);

const failureSnapshotMetadata = buildSmokingpipesFailureSnapshotMetadata({
  source: "smokingpipes",
  stage: "current-list",
  page: 107,
  url: "https://www.smokingpipes.com/pipes/?DISPLAYNUM=48&page=107",
  title: "Just a moment...",
  html: "<html>Cloudflare challenge</html>",
  errorMessage:
    "No products were extracted from requested page 107; parse failure: selector timeout 15000ms",
  selector: "a[href*='moreinfo.cfm'][href*='product_id=']",
  screenshotPath:
    "data/review/smokingpipes-failure-snapshots/smokingpipes-current-list-page-107-20260708-103000.png",
  htmlPath:
    "data/review/smokingpipes-failure-snapshots/smokingpipes-current-list-page-107-20260708-103000.html",
  capturedAt: "2026-07-08T10:30:00.000+08:00",
});
assert.equal(failureSnapshotMetadata.source, "smokingpipes");
assert.equal(failureSnapshotMetadata.stage, "current-list");
assert.equal(failureSnapshotMetadata.page, 107);
assert.match(failureSnapshotMetadata.url, /page=107/);
assert.equal(failureSnapshotMetadata.title, "Just a moment...");
assert.match(failureSnapshotMetadata.errorMessage, /No products were extracted/);
assert.deepEqual(failureSnapshotMetadata.keywordsFound, [
  "Cloudflare",
  "Just a moment",
  "challenge",
]);
assert.equal(failureSnapshotMetadata.cloudflareSuspected, true);
assert.equal(failureSnapshotMetadata.verificationSuspected, true);

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

assert.deepEqual(
  classifySmokingpipesBrandExclusion({
    sourceUrl:
      "https://www.smokingpipes.com/pipes/new/falcon/moreinfo.cfm?product_id=700001",
    title: "AKB Carved Dublin",
  }),
  {
    excluded: true,
    brand: "falcon",
    reason: "excluded-brand:falcon",
    evidence: "source-url-brand-slug",
  }
);
assert.equal(
  classifySmokingpipesBrandExclusion({
    brandSlug: "falcon",
    title: "Replacement bowl",
  }).excluded,
  true
);
assert.equal(
  classifySmokingpipesBrandExclusion({
    productName: "Falcon Standard Stem",
  }).excluded,
  true
);
assert.equal(
  classifySmokingpipesBrandExclusion({
    sourceUrl:
      "https://www.smokingpipes.com/pipes/new/peterson/moreinfo.cfm?product_id=700002",
    title: "Peterson System Standard",
  }).excluded,
  false
);

const falconExclusionState = ingestProgressiveListSnapshot({
  state: createProgressiveDailyState({
    dailyRunId: "falcon-exclusion-test",
    now: progressiveNow,
  }),
  currentPayload: {
    generatedAt: progressiveNow,
    summary: {
      pagesScanned: 1,
      expectedPages: 104,
      fullExpectedRangeScanned: false,
      captchaDetected: false,
      captchaPages: [],
    },
    products: [
      {
        sourceProductId: "700001",
        sourceUrl:
          "https://www.smokingpipes.com/pipes/new/falcon/moreinfo.cfm?product_id=700001",
        title: "AKB Carved Dublin",
        price: "$100.00",
        imageUrl: "https://example.invalid/700001.jpg",
      },
      {
        sourceProductId: "700002",
        sourceUrl:
          "https://www.smokingpipes.com/pipes/new/peterson/moreinfo.cfm?product_id=700002",
        title: "Peterson System Standard",
        price: "$120.00",
        imageUrl: "https://example.invalid/700002.jpg",
      },
      {
        sourceProductId: "700003",
        sourceUrl:
          "https://www.smokingpipes.com/pipes/new/falcon/moreinfo.cfm?product_id=700003",
        title: "Falcon Standard Stem",
        price: "$80.00",
        imageUrl: "https://example.invalid/700003.jpg",
      },
    ],
  },
  productionProducts: [],
  runId: "falcon-exclusion-test",
  now: progressiveNow,
});
const falconExclusion = applySmokingpipesBrandExclusions({
  state: falconExclusionState,
  productionProducts: [
    {
      source: "smokingpipes",
      sourceProductId: "existing-falcon",
      brand: "Falcon",
      sourceUrl:
        "https://www.smokingpipes.com/pipes/new/falcon/moreinfo.cfm?product_id=699999",
    },
  ],
  publicProducts: [
    {
      source: "smokingpipes",
      sourceProductId: "public-falcon",
      brand: "Falcon",
    },
    {
      source: "danish",
      sourceProductId: "danish-falcon",
      brand: "Falcon",
    },
  ],
  now: progressiveNow,
});
assert.equal(falconExclusion.report.pendingBefore, 1);
assert.equal(falconExclusion.report.excludedBrandCount, 2);
assert.deepEqual(falconExclusion.report.excludedBrandBreakdown, {
  falcon: 2,
});
assert.equal(
  falconExclusion.report.pendingAfterBrandExclusion,
  1
);
assert.equal(falconExclusion.report.plannedHideProductionCount, 1);
assert.equal(falconExclusion.report.plannedHidePublicCount, 1);
assert.equal(falconExclusion.report.productionWritten, false);
for (const id of ["700001", "700003"]) {
  const excluded = falconExclusion.state.candidates.find(
    (item) => item.sourceProductId === id
  );
  assert.equal(excluded.detailStatus, "excluded");
  assert.equal(excluded.publicStatus, "not-public");
  assert.equal(excluded.exclusionReason, "excluded-brand:falcon");
}
assert.deepEqual(
  selectProgressiveDetailCandidates({
    state: falconExclusion.state,
    maxItems: 30,
    now: progressiveNow,
  }).map((item) => item.sourceProductId),
  ["700002"],
  "Falcon candidates must never enter the detail batch"
);

const listNotPublicState = ingestProgressiveListSnapshot({
  state: createProgressiveDailyState({
    dailyRunId: "list-not-public-test",
    expectedPages: 104,
    now: progressiveNow,
  }),
  currentPayload: {
    generatedAt: progressiveNow,
    summary: {
      pagesScanned: 104,
      expectedPages: 104,
      fullExpectedRangeScanned: true,
      firstOutOfStockOnlyPage: 88,
      captchaDetected: false,
      captchaPages: [],
    },
    products: [
      {
        sourceProductId: "705001",
        sourceUrl:
          "https://www.smokingpipes.com/pipes/new/peterson/moreinfo.cfm?product_id=705001",
        title: "Peterson explicit missingPrice flag",
        price: "$101.00",
        missingPrice: true,
        rawListStatus: "",
        listPage: 12,
      },
      {
        sourceProductId: "705002",
        sourceUrl:
          "https://www.smokingpipes.com/pipes/new/peterson/moreinfo.cfm?product_id=705002",
        title: "Peterson explicit out of stock",
        price: "$99.00",
        rawListStatus: "out-of-stock",
        listPage: 30,
      },
      {
        sourceProductId: "705003",
        sourceUrl:
          "https://www.smokingpipes.com/pipes/new/peterson/moreinfo.cfm?product_id=705003",
        title: "Peterson out of stock tail",
        price: null,
        rawListStatus: "out-of-stock",
        listPage: 88,
      },
      {
        sourceProductId: "705004",
        sourceUrl:
          "https://www.smokingpipes.com/pipes/new/peterson/moreinfo.cfm?product_id=705004",
        title: "Short Army Rusticated",
        price: "$124.00",
        rawListStatus: "",
        listPage: 4,
      },
      {
        sourceProductId: "705005",
        sourceUrl:
          "https://www.smokingpipes.com/pipes/new/falcon/moreinfo.cfm?product_id=705005",
        title: "Falcon complete pipe",
        price: "$100.00",
        rawListStatus: "",
        listPage: 5,
      },
      {
        sourceProductId: "705006",
        sourceUrl:
          "https://www.smokingpipes.com/pipes/new/peterson/moreinfo.cfm?product_id=705006",
        title: "Peterson empty price before tail",
        price: "",
        rawListStatus: "",
        listPage: 20,
      },
    ],
  },
  diffPayload: {
    newIds: [
      "705001",
      "705002",
      "705003",
      "705004",
      "705005",
      "705006",
    ],
    reappearedIds: [],
    disappearedIds: [],
    fatalWarnings: [],
    warnings: [],
    coverage: {
      pagesScanned: 104,
      expectedPages: 104,
      fullExpectedRangeScanned: true,
    },
  },
  productionProducts: [],
  runId: "list-not-public-test",
  now: progressiveNow,
});
for (const [id, reason] of [
  ["705001", "list-not-public:missing-price"],
  ["705002", "list-not-public:oos-tail"],
  ["705003", "list-not-public:oos-tail"],
  ["705006", "list-not-public:missing-price"],
]) {
  const candidate = listNotPublicState.candidates.find(
    (item) => item.sourceProductId === id
  );
  assert.equal(
    candidate.detailStatus,
    "excluded-list-not-public"
  );
  assert.equal(candidate.publicStatus, "not-public");
  assert.equal(candidate.listNotPublicReason, reason);
  assert.equal(candidate.reason, reason);
}
assert.equal(
  listNotPublicState.candidates.find(
    (item) => item.sourceProductId === "705004"
  ).detailStatus,
  "pending"
);
assert.equal(
  listNotPublicState.candidates.find(
    (item) => item.sourceProductId === "705005"
  ).detailStatus,
  "excluded"
);
assert.equal(listNotPublicState.summary.listNotPublicFiltered, 4);
assert.equal(listNotPublicState.summary.pending, 1);
assert.deepEqual(
  selectProgressiveDetailCandidates({
    state: listNotPublicState,
    maxItems: 30,
    now: progressiveNow,
  }).map((item) => item.sourceProductId),
  ["705004"]
);
assert.equal(
  validateProgressiveDailyState(listNotPublicState).valid,
  true
);

const manualBackfillOptions = parseRunnerOptions([
  "--manual-detail-backfill-all",
  "--limit=50",
  "--until-empty",
  "--cooldown-ms=1234",
  "--max-total=200",
]);
assert.equal(
  manualBackfillOptions.mode,
  "progressive-manual-detail-backfill"
);
assert.equal(manualBackfillOptions.manualDetailBackfill, true);
assert.equal(manualBackfillOptions.manualDetailLimit, 50);
assert.equal(manualBackfillOptions.manualDetailUntilEmpty, true);
assert.equal(manualBackfillOptions.manualDetailCooldownMs, 1234);
assert.equal(manualBackfillOptions.manualDetailMaxTotal, 200);
assert.equal(
  parseRunnerOptions([
    "--manual-detail-backfill-all",
    "--limit=500",
  ]).manualDetailLimit,
  50,
  "manual detail batches must be capped at 50"
);

const manualBackfillState = ingestProgressiveListSnapshot({
  state: createProgressiveDailyState({
    dailyRunId: "manual-backfill-test",
    now: progressiveNow,
  }),
  currentPayload: {
    generatedAt: progressiveNow,
    summary: {
      pagesScanned: 104,
      expectedPages: 104,
      fullExpectedRangeScanned: true,
      captchaDetected: false,
      captchaPages: [],
    },
    products: [
      {
        sourceProductId: "710001",
        sourceUrl:
          "https://www.smokingpipes.com/pipes/new/falcon/moreinfo.cfm?product_id=710001",
        title: "Falcon bowl",
        price: "$80.00",
        imageUrl: "https://example.invalid/710001.jpg",
      },
      ...["710002", "710003", "710004"].map((id) => ({
        sourceProductId: id,
        sourceUrl: `https://www.smokingpipes.com/pipes/new/peterson/moreinfo.cfm?product_id=${id}`,
        title: `Peterson test pipe ${id}`,
        price: "$120.00",
        imageUrl: `https://example.invalid/${id}.jpg`,
      })),
    ],
  },
  productionProducts: [],
  runId: "manual-backfill-test",
  now: progressiveNow,
});
const manualBackfillCheckpoints = [];
const manualBackfillWaits = [];
const manualBackfillResult =
  await runSmokingpipesManualDetailBackfill({
    state: manualBackfillState,
    batchLimit: 2,
    untilEmpty: true,
    cooldownMs: 500,
    maxTotal: 3,
    now: progressiveNow,
    checkpoint: async (state) => {
      manualBackfillCheckpoints.push(structuredClone(state));
    },
    wait: async (delayMs) => {
      manualBackfillWaits.push(delayMs);
    },
    processDetail: async (candidate, index) => {
      if (candidate.sourceProductId === "710004") {
        throw Object.assign(new Error("strong verification"), {
          code: "CAPTCHA_REQUIRED",
        });
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
              amount: 120,
              parseStatus: "parsed",
            },
          },
        },
        publicReady: true,
      };
    },
  });
assert.equal(manualBackfillResult.report.pendingBefore, 3);
assert.equal(manualBackfillResult.report.excludedBrandCount, 1);
assert.equal(manualBackfillResult.report.fetchedTotal, 3);
assert.equal(manualBackfillResult.report.completed, 2);
assert.equal(manualBackfillResult.report.blocked, 1);
assert.equal(manualBackfillResult.report.verificationRequired, true);
assert.equal(manualBackfillResult.report.productionWritten, false);
assert.deepEqual(manualBackfillWaits, [500]);
assert.ok(manualBackfillCheckpoints.length >= 4);
assert.equal(
  manualBackfillResult.state.candidates.find(
    (item) => item.sourceProductId === "710001"
  ).detailStatus,
  "excluded"
);
assert.match(
  buildSmokingpipesManualBackfillVerificationMessage({
    sourceProductId: "710004",
    sourceUrl:
      "https://www.smokingpipes.com/pipes/new/peterson/moreinfo.cfm?product_id=710004",
  }).body,
  /运行任务的电脑[\s\S]*Chrome profile sp-chrome[\s\S]*不要关闭浏览器/
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
assert.equal(
  progressiveChunk.remainingPendingCount,
  progressiveChunk.state.candidates.filter(
    (item) => item.detailStatus === "pending"
  ).length
);
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

const safeGapProductionProducts = [
  {
    id: "smokingpipes-1",
    source: "smokingpipes",
    sourceProductId: "1",
    inventoryStatus: "available",
    price: { current: { amount: 100, rawText: "$100.00" } },
  },
  {
    id: "smokingpipes-3",
    source: "smokingpipes",
    sourceProductId: "3",
    inventoryStatus: "available",
    price: { current: { amount: 300, rawText: "$300.00" } },
  },
];
const safeGapCandidateProducts = [
  {
    ...safeGapProductionProducts[0],
    price: { current: { amount: 110, rawText: "$110.00" } },
  },
  {
    id: "smokingpipes-2",
    source: "smokingpipes",
    sourceProductId: "2",
    inventoryStatus: "available",
    price: { current: { amount: 200, rawText: "$200.00" } },
  },
  structuredClone(safeGapProductionProducts[1]),
];
const safeGapState = {
  version: 1,
  globalReconcile: { applyAllowed: false },
  candidates: [
    {
      sourceProductId: "1",
      changeTypes: ["price-change"],
      detailStatus: "complete",
      publicStatus: "ready",
    },
    {
      sourceProductId: "2",
      changeTypes: ["new-product"],
      detailStatus: "complete",
      publicStatus: "ready",
    },
    {
      sourceProductId: "3",
      changeTypes: ["price-change"],
      detailStatus: "complete",
      publicStatus: "ready",
    },
  ],
};
const noOpCandidateBuild = buildProgressivePartialProducts({
  productionProducts: [
    {
      id: "smokingpipes-3",
      source: "smokingpipes",
      sourceProductId: "3",
      inventoryStatus: "available",
      price: {
        current: {
          amount: 300,
          rawText: "$300.00",
          currency: "USD",
          parseStatus: "parsed",
        },
      },
    },
  ],
  state: {
    candidates: [
      {
        sourceProductId: "3",
        listPrice: "$300.00",
        changeTypes: ["price-change"],
        detailStatus: "complete",
        publicStatus: "ready",
      },
    ],
  },
});
assert.deepEqual(noOpCandidateBuild.attemptedCandidateIds, ["3"]);
assert.deepEqual(noOpCandidateBuild.appliedCandidateIds, []);
assert.deepEqual(noOpCandidateBuild.fieldChanges, []);
const safeGapDiagnosis = diagnoseProgressiveApplyGap({
  state: safeGapState,
  productionProducts: safeGapProductionProducts,
  candidateProducts: safeGapCandidateProducts,
  candidateIds: ["1", "2", "3"],
  wouldApplyProductIds: ["1", "2"],
});
assert.equal(safeGapDiagnosis.candidateCount, 3);
assert.equal(safeGapDiagnosis.wouldApplyCount, 2);
assert.equal(safeGapDiagnosis.gapCount, 1);
assert.equal(safeGapDiagnosis.gapClassifications.noOpAlreadyCurrent, 1);
assert.equal(safeGapDiagnosis.unknownGapCount, 0);
assert.equal(safeGapDiagnosis.readyUnexpectedlyExcludedCount, 0);
assert.equal(safeGapDiagnosis.safeToApplyWouldApplySubset, true);

const safeGapAudit = {
  verdict: "PASS",
  candidateCount: 3,
  wouldApplyCount: 2,
  blockers: [],
  counts: {
    deletedProducts: 0,
    pendingLeak: 0,
    failedLeak: 0,
    blockedLeak: 0,
    reviewOnlyLeak: 0,
    zeroPriceSellable: 0,
  },
  applyGap: safeGapDiagnosis,
};
const safeGapPreview = {
  status: "preview-ready",
  candidateCount: 3,
  wouldApplyCount: 2,
  wouldApplyProductIds: ["1", "2"],
  productionWritten: false,
};
const completePublicPayloads = {
  catalog: { schemaVersion: 1, products: [] },
  filters: { schemaVersion: 1 },
  brands: { schemaVersion: 1 },
  recentNew: { schemaVersion: 1, products: [] },
  lookup: { schemaVersion: 1 },
  manifest: { schemaVersion: 1 },
  detailShards: [],
};
const safeSubsetGate = evaluateProgressiveProductionApplyGate({
  state: { dailyRunId: "daily-update-20260708" },
  audit: safeGapAudit,
  preview: safeGapPreview,
  candidateProducts: safeGapCandidateProducts,
  publicPayloads: completePublicPayloads,
});
assert.equal(safeSubsetGate.status, "apply-ready");
assert.equal(safeSubsetGate.safeSubsetApply, true);
assert.equal(safeSubsetGate.isolatedCandidateCount, 1);
assert.deepEqual(safeSubsetGate.blockers, []);

for (const [countName, countValue] of [
  ["pendingLeak", 1],
  ["reviewOnlyLeak", 1],
  ["zeroPriceSellable", 1],
]) {
  const blockedGate = evaluateProgressiveProductionApplyGate({
    state: { dailyRunId: "daily-update-20260708" },
    audit: {
      ...safeGapAudit,
      counts: {
        ...safeGapAudit.counts,
        [countName]: countValue,
      },
    },
    preview: safeGapPreview,
    candidateProducts: safeGapCandidateProducts,
    publicPayloads: completePublicPayloads,
  });
  assert.equal(blockedGate.status, "apply-blocked");
  assert.match(blockedGate.blockers.join("\n"), new RegExp(countName));
}

const unknownGapGate = evaluateProgressiveProductionApplyGate({
  state: { dailyRunId: "daily-update-20260708" },
  audit: {
    ...safeGapAudit,
    applyGap: {
      ...safeGapDiagnosis,
      safeToApplyWouldApplySubset: false,
      unknownGapCount: 1,
      gapCandidates: [
        {
          ...safeGapDiagnosis.gapCandidates[0],
          reason: "unknown",
        },
      ],
    },
  },
  preview: safeGapPreview,
  candidateProducts: safeGapCandidateProducts,
  publicPayloads: completePublicPayloads,
});
assert.equal(unknownGapGate.status, "apply-blocked");
assert.match(unknownGapGate.blockers.join("\n"), /unknown gap/i);

const unexpectedlyExcludedReadyGate = evaluateProgressiveProductionApplyGate({
  state: { dailyRunId: "daily-update-20260708" },
  audit: {
    ...safeGapAudit,
    applyGap: {
      ...safeGapDiagnosis,
      safeToApplyWouldApplySubset: false,
      readyUnexpectedlyExcludedCount: 1,
      gapCandidates: [
        {
          ...safeGapDiagnosis.gapCandidates[0],
          reason: "ready-candidate-unexpectedly-excluded",
        },
      ],
    },
  },
  preview: safeGapPreview,
  candidateProducts: safeGapCandidateProducts,
  publicPayloads: completePublicPayloads,
});
assert.equal(unexpectedlyExcludedReadyGate.status, "apply-blocked");
assert.match(
  unexpectedlyExcludedReadyGate.blockers.join("\n"),
  /ready candidate unexpectedly excluded/i
);

const manualReconcileGate = evaluateProgressiveProductionApplyGate({
  state: { dailyRunId: "manual-reconcile-20260705093305" },
  audit: safeGapAudit,
  preview: safeGapPreview,
  candidateProducts: safeGapCandidateProducts,
  publicPayloads: completePublicPayloads,
});
assert.equal(manualReconcileGate.status, "apply-blocked");
assert.equal(manualReconcileGate.stateManualReconcileBlocked, true);
assert.match(
  manualReconcileGate.blockedReason,
  /manual-reconcile/i
);

const overMaxAutoApplyGate = evaluateProgressiveProductionApplyGate({
  state: { dailyRunId: "daily-update-20260708" },
  audit: {
    ...safeGapAudit,
    candidateCount: 4039,
    wouldApplyCount: 4039,
  },
  preview: {
    ...safeGapPreview,
    candidateCount: 4039,
    wouldApplyCount: 4039,
    wouldApplyProductIds: Array.from({ length: 4039 }, (_, index) =>
      String(index + 1)
    ),
  },
  candidateProducts: safeGapCandidateProducts,
  publicPayloads: completePublicPayloads,
  maxAutoApply: 300,
});
assert.equal(overMaxAutoApplyGate.status, "apply-blocked");
assert.equal(overMaxAutoApplyGate.maxAutoApply, 300);
assert.match(
  overMaxAutoApplyGate.blockedReason,
  /wouldApplyCount 4039 exceeds max auto apply 300/
);

const noOpApplyGate = evaluateProgressiveProductionApplyGate({
  state: { dailyRunId: "daily-update-20260708" },
  audit: {
    ...safeGapAudit,
    candidateCount: 1,
    wouldApplyCount: 0,
  },
  preview: {
    ...safeGapPreview,
    candidateCount: 1,
    wouldApplyCount: 0,
    wouldApplyProductIds: [],
  },
  candidateProducts: safeGapCandidateProducts,
  publicPayloads: completePublicPayloads,
});
assert.equal(noOpApplyGate.status, "apply-blocked");
assert.match(noOpApplyGate.blockedReason, /greater than 0/);

const safeSubsetMerged = buildSafeSubsetProductionProducts({
  productionProducts: safeGapProductionProducts,
  candidateProducts: [
    safeGapCandidateProducts[0],
    safeGapCandidateProducts[1],
    {
      ...safeGapCandidateProducts[2],
      unsafeGapMutation: true,
    },
  ],
  wouldApplyProductIds: ["1", "2"],
});
assert.equal(
  safeSubsetMerged.find((item) => item.sourceProductId === "1").price.current.amount,
  110
);
assert.equal(
  safeSubsetMerged.some((item) => item.sourceProductId === "2"),
  true
);
assert.equal(
  safeSubsetMerged.find((item) => item.sourceProductId === "3")
    .unsafeGapMutation,
  undefined
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
progressiveApplyState.listSnapshotStatus = "complete";
progressiveApplyState.pagesScanned = 104;
progressiveApplyState.expectedPages = 104;
progressiveApplyState.fullExpectedRangeScanned = true;
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
  progressiveApplyPaths.currentList,
  JSON.stringify({
    source: "smokingpipes",
    summary: {
      pagesScanned: 104,
      fullExpectedRangeScanned: true,
      captchaDetected: false,
      verificationDetected: false,
    },
  }),
  "utf8"
);
fs.writeFileSync(
  progressiveApplyPaths.diff,
  JSON.stringify({
    source: "smokingpipes",
    allowApply: true,
    fatalWarnings: [],
    coverage: {
      pagesScanned: 104,
      fullExpectedRangeScanned: true,
    },
  }),
  "utf8"
);
fs.writeFileSync(
  progressiveApplyPaths.progressiveBrandExclusionReportJson,
  JSON.stringify({
    source: "smokingpipes",
    excludedBrandCount: 0,
    excludedBrandBreakdown: {},
    plannedHideProductionCount: 0,
    plannedHidePublicCount: 0,
    productionWritten: false,
  }),
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
const progressivePrepareApplyReady =
  await runSmokingpipesProgressiveMode({
    root: progressiveApplyRoot,
    options: parseRunnerOptions([
      "--mode=progressive-prepare-apply",
    ]),
  });
assert.equal(progressivePrepareApplyReady.status, "apply-ready");
assert.equal(progressivePrepareApplyReady.applyReady, true);
assert.equal(progressivePrepareApplyReady.candidateCount, 4);
assert.equal(progressivePrepareApplyReady.wouldApplyCount, 2);
assert.equal(progressivePrepareApplyReady.isolatedCandidateCount, 2);
assert.equal(progressivePrepareApplyReady.maxAutoApply, 300);
assert.equal(progressivePrepareApplyReady.productionWritten, false);
assert.equal(
  fs.existsSync(progressiveApplyPaths.progressiveApplyGateReport),
  true
);
const validOfflineApplyGate = JSON.parse(
  fs.readFileSync(
    progressiveApplyPaths.progressiveApplyGateReport,
    "utf8"
  )
);
fs.writeFileSync(
  progressiveApplyPaths.progressiveApplyGateReport,
  JSON.stringify({
    ...validOfflineApplyGate,
    status: "apply-blocked",
    applyReady: false,
    blockedReason: "auditStatus=FAIL",
    blockReasons: ["auditStatus=FAIL"],
    blockers: ["auditStatus=FAIL"],
  }),
  "utf8"
);
const progressiveManualLargeEvidenceBlocked =
  await runSmokingpipesProgressiveMode({
    root: progressiveApplyRoot,
    options: parseRunnerOptions([
      "--mode=progressive-partial-apply",
      "--write-production",
      "--manual-large-apply",
      "--no-commit",
      "--no-deploy",
    ]),
  });
assert.equal(
  progressiveManualLargeEvidenceBlocked.status,
  "apply-blocked"
);
assert.equal(
  progressiveManualLargeEvidenceBlocked.productionWritten,
  false
);
assert.match(
  progressiveManualLargeEvidenceBlocked.blockedReason,
  /auditStatus=FAIL/
);
assert.equal(
  JSON.parse(
    fs.readFileSync(
      progressiveApplyPaths.existingProducts,
      "utf8"
    )
  ).some((item) => item.sourceProductId === "200"),
  false
);
fs.writeFileSync(
  progressiveApplyPaths.progressiveApplyGateReport,
  JSON.stringify(validOfflineApplyGate),
  "utf8"
);
const progressiveApplyWriteResult =
  await runSmokingpipesProgressiveMode({
    root: progressiveApplyRoot,
    options: parseRunnerOptions([
      "--mode=progressive-partial-apply",
      "--write-production",
      "--manual-large-apply",
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
const progressiveManualBlockedRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "inventory-progressive-manual-blocked-")
);
const progressiveManualBlockedPaths =
  runnerCore.getRunnerPaths(progressiveManualBlockedRoot);
fs.mkdirSync(
  path.dirname(progressiveManualBlockedPaths.existingProducts),
  { recursive: true }
);
fs.mkdirSync(
  path.dirname(progressiveManualBlockedPaths.progressiveState),
  { recursive: true }
);
fs.writeFileSync(
  progressiveManualBlockedPaths.existingProducts,
  JSON.stringify(progressiveApplyProduction),
  "utf8"
);
fs.writeFileSync(
  progressiveManualBlockedPaths.progressiveState,
  JSON.stringify({
    ...progressiveApplyState,
    dailyRunId: "manual-reconcile-20260705093305",
  }),
  "utf8"
);
const progressiveManualPrepareBlocked =
  await runSmokingpipesProgressiveMode({
    root: progressiveManualBlockedRoot,
    options: parseRunnerOptions([
      "--mode=progressive-prepare-apply",
    ]),
  });
assert.equal(progressiveManualPrepareBlocked.status, "apply-blocked");
assert.equal(progressiveManualPrepareBlocked.applyReady, false);
assert.equal(
  progressiveManualPrepareBlocked.stateManualReconcileBlocked,
  true
);
assert.match(
  progressiveManualPrepareBlocked.blockedReason,
  /manual-reconcile/i
);
const progressiveManualWriteBlocked =
  await runSmokingpipesProgressiveMode({
    root: progressiveManualBlockedRoot,
    options: parseRunnerOptions([
      "--mode=progressive-partial-apply",
      "--write-production",
    ]),
  });
assert.equal(progressiveManualWriteBlocked.status, "apply-blocked");
assert.equal(progressiveManualWriteBlocked.productionWritten, false);
assert.match(
  progressiveManualWriteBlocked.blockedReason,
  /manual-reconcile/i
);
assert.equal(
  JSON.parse(
    fs.readFileSync(
      progressiveManualBlockedPaths.existingProducts,
      "utf8"
    )
  ).some((item) => item.sourceProductId === "200"),
  false
);

const reconcileManualRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "inventory-progressive-reconcile-manual-")
);
const reconcileManualPaths =
  runnerCore.getRunnerPaths(reconcileManualRoot);
fs.mkdirSync(path.dirname(reconcileManualPaths.progressiveState), {
  recursive: true,
});
fs.mkdirSync(path.dirname(reconcileManualPaths.existingProducts), {
  recursive: true,
});
fs.mkdirSync(reconcileManualPaths.productionPublicRoot, {
  recursive: true,
});
const reconcileManualState = {
  ...progressiveApplyState,
  dailyRunId: "manual-reconcile-20260705093305",
};
fs.writeFileSync(
  reconcileManualPaths.progressiveState,
  JSON.stringify(reconcileManualState),
  "utf8"
);
fs.writeFileSync(
  reconcileManualPaths.existingProducts,
  JSON.stringify([{ sourceProductId: "production-unchanged" }]),
  "utf8"
);
fs.writeFileSync(
  reconcileManualPaths.unifiedProductsStaging,
  JSON.stringify([{ id: "unified-unchanged" }]),
  "utf8"
);
fs.writeFileSync(
  path.join(reconcileManualPaths.productionPublicRoot, "catalog.json"),
  JSON.stringify({ products: [{ id: "catalog-unchanged" }] }),
  "utf8"
);
const reconcileManifestPath = path.join(
  reconcileManualPaths.productionPublicRoot,
  "manifest.json"
);
fs.writeFileSync(
  reconcileManifestPath,
  JSON.stringify({ productionWritten: true }),
  "utf8"
);
const productionGuardBefore = {
  existing: fs.readFileSync(reconcileManualPaths.existingProducts, "utf8"),
  unified: fs.readFileSync(reconcileManualPaths.unifiedProductsStaging, "utf8"),
  catalog: fs.readFileSync(
    path.join(reconcileManualPaths.productionPublicRoot, "catalog.json"),
    "utf8"
  ),
  manifest: fs.readFileSync(reconcileManifestPath, "utf8"),
};
const reconcileManualDryRun = await reconcileProgressiveState({
  root: reconcileManualRoot,
  dryRun: true,
});
assert.equal(reconcileManualDryRun.status, "archive-recommended");
assert.equal(reconcileManualDryRun.dryRun, true);
assert.equal(reconcileManualDryRun.archivePerformed, false);
assert.equal(reconcileManualDryRun.stateIsManualReconcile, true);
assert.equal(
  reconcileManualDryRun.stateDailyRunId,
  "manual-reconcile-20260705093305"
);
assert.equal(
  reconcileManualDryRun.totalCandidates,
  reconcileManualState.candidates.length
);
assert.equal(
  fs.readFileSync(reconcileManualPaths.progressiveState, "utf8"),
  JSON.stringify(reconcileManualState)
);
assert.equal(
  fs.readFileSync(reconcileManualPaths.existingProducts, "utf8"),
  productionGuardBefore.existing
);
const reconcileManualArchive = await reconcileProgressiveState({
  root: reconcileManualRoot,
  archive: true,
  now: new Date("2026-07-08T12:34:56.000Z"),
});
assert.equal(reconcileManualArchive.status, "archived");
assert.equal(reconcileManualArchive.dryRun, false);
assert.equal(reconcileManualArchive.archivePerformed, true);
assert.equal(fs.existsSync(reconcileManualPaths.progressiveState), false);
assert.equal(
  readProgressiveDailyState(reconcileManualPaths.progressiveState).status,
  "missing"
);
const reconcileArchiveDir = path.dirname(
  path.join(reconcileManualRoot, reconcileManualArchive.archiveTarget)
);
assert.equal(
  fs.existsSync(
    path.join(reconcileArchiveDir, "smokingpipes-progressive-daily-state.json")
  ),
  true
);
const reconcileManifest = JSON.parse(
  fs.readFileSync(path.join(reconcileArchiveDir, "manifest.json"), "utf8")
);
assert.equal(
  reconcileManifest.stateDailyRunId,
  "manual-reconcile-20260705093305"
);
assert.equal(
  reconcileManifest.totalCandidates,
  reconcileManualState.candidates.length
);
assert.match(reconcileManifest.reason, /manual-reconcile state archived/);
assert.match(
  reconcileManifest.postArchiveStateHandling,
  /original state deleted/
);
assert.equal(
  fs.readFileSync(reconcileManualPaths.existingProducts, "utf8"),
  productionGuardBefore.existing
);
assert.equal(
  fs.readFileSync(reconcileManualPaths.unifiedProductsStaging, "utf8"),
  productionGuardBefore.unified
);
assert.equal(
  fs.readFileSync(
    path.join(reconcileManualPaths.productionPublicRoot, "catalog.json"),
    "utf8"
  ),
  productionGuardBefore.catalog
);
assert.equal(
  fs.readFileSync(reconcileManifestPath, "utf8"),
  productionGuardBefore.manifest
);

const reconcileNonManualRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "inventory-progressive-reconcile-nonmanual-")
);
const reconcileNonManualPaths =
  runnerCore.getRunnerPaths(reconcileNonManualRoot);
fs.mkdirSync(path.dirname(reconcileNonManualPaths.progressiveState), {
  recursive: true,
});
fs.writeFileSync(
  reconcileNonManualPaths.progressiveState,
  JSON.stringify({
    ...progressiveApplyState,
    dailyRunId: "daily-update-20260708",
  }),
  "utf8"
);
const reconcileNonManual = await reconcileProgressiveState({
  root: reconcileNonManualRoot,
  archive: true,
});
assert.equal(reconcileNonManual.status, "no-action-needed");
assert.equal(reconcileNonManual.archivePerformed, false);
assert.equal(fs.existsSync(reconcileNonManualPaths.progressiveState), true);

const reconcileMissingRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "inventory-progressive-reconcile-missing-")
);
const reconcileMissing = await reconcileProgressiveState({
  root: reconcileMissingRoot,
});
assert.equal(reconcileMissing.status, "missing-state");
assert.equal(reconcileMissing.stateExists, false);
assert.equal(reconcileMissing.archivePerformed, false);

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
assert.equal(progressiveApplyBlocked.status, "apply-complete");
assert.equal(progressiveApplyBlocked.productionWritten, true);
assert.equal(
  JSON.parse(
    fs.readFileSync(
      progressiveApplyBlockedPaths.existingProducts,
      "utf8"
    )
  ).some((item) => item.sourceProductId === "200"),
  true
);
for (const mode of [
  "progressive-ingest-list",
  "progressive-detail-chunk",
  "progressive-build-candidate",
  "progressive-prepare-apply",
  "progressive-partial-apply",
]) {
  assert.equal(
    parseRunnerOptions([`--mode=${mode}`]).mode,
    mode
  );
}
assert.equal(
  parseRunnerOptions(["--progressive-prepare-apply"]).mode,
  "progressive-prepare-apply"
);
assert.throws(
  () =>
    parseRunnerOptions([
      "--progressive-prepare-apply",
      "--mode=dry-run",
    ]),
  /conflicts with --mode=dry-run/
);

const offlinePrepareRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "inventory-progressive-offline-prepare-")
);
const offlinePreparePaths =
  runnerCore.getRunnerPaths(offlinePrepareRoot);
fs.mkdirSync(path.dirname(offlinePreparePaths.progressiveState), {
  recursive: true,
});
fs.mkdirSync(path.dirname(offlinePreparePaths.currentList), {
  recursive: true,
});
fs.mkdirSync(
  path.dirname(
    offlinePreparePaths.progressiveBrandExclusionReportJson
  ),
  { recursive: true }
);
const offlinePrepareState = createProgressiveDailyState({
  dailyRunId: "progressive-offline-prepare",
  now: progressiveNow,
});
const makeOfflinePrepareCandidate = ({
  sourceProductId,
  detailStatus,
  publicStatus,
  exclusionReason = null,
}) => ({
  sourceProductId,
  sourceUrl: `https://example.invalid/${sourceProductId}`,
  listTitle: `Offline candidate ${sourceProductId}`,
  listPrice: "$100.00",
  listPrimaryImage: "https://example.invalid/pipe.jpg",
  inventoryStatus: "available",
  discoveredAt: progressiveNow,
  firstSeenRunId: "progressive-offline-prepare",
  lastSeenRunId: "progressive-offline-prepare",
  lastSeenAt: progressiveNow,
  changeTypes: ["new-product"],
  detailStatus,
  publicStatus,
  detailAttempts: detailStatus === "complete" ? 1 : 0,
  retryCount: detailStatus === "failed" ? 1 : 0,
  blockedCount: 0,
  priority: 100,
  exclusionReason,
});
offlinePrepareState.listSnapshotStatus = "complete";
offlinePrepareState.pagesScanned = 104;
offlinePrepareState.expectedPages = 104;
offlinePrepareState.fullExpectedRangeScanned = true;
offlinePrepareState.currentListPath =
  "data/inventory/smokingpipes-current-list-dry-run.json";
offlinePrepareState.diffPath =
  "data/inventory/smokingpipes-inventory-diff-dry-run.json";
offlinePrepareState.candidates = [
  ...Array.from({ length: 1389 }, (_, index) =>
    makeOfflinePrepareCandidate({
      sourceProductId: `ready-${index + 1}`,
      detailStatus: "complete",
      publicStatus: "ready",
    })
  ),
  ...Array.from({ length: 4 }, (_, index) =>
    makeOfflinePrepareCandidate({
      sourceProductId: `review-${index + 1}`,
      detailStatus: "complete",
      publicStatus: "review-only",
    })
  ),
  ...Array.from({ length: 149 }, (_, index) =>
    makeOfflinePrepareCandidate({
      sourceProductId: `failed-${index + 1}`,
      detailStatus: "failed",
      publicStatus: "not-public",
    })
  ),
  ...Array.from({ length: 86 }, (_, index) =>
    makeOfflinePrepareCandidate({
      sourceProductId: `falcon-${index + 1}`,
      detailStatus: "excluded",
      publicStatus: "not-public",
      exclusionReason: "excluded-brand:falcon",
    })
  ),
];
offlinePrepareState.updatedAt = progressiveNow;
fs.writeFileSync(
  offlinePreparePaths.progressiveState,
  JSON.stringify(offlinePrepareState),
  "utf8"
);
fs.writeFileSync(
  offlinePreparePaths.currentList,
  JSON.stringify({
    source: "smokingpipes",
    summary: {
      pagesScanned: 104,
      fullExpectedRangeScanned: true,
      captchaDetected: false,
      verificationDetected: false,
    },
  }),
  "utf8"
);
fs.writeFileSync(
  offlinePreparePaths.diff,
  JSON.stringify({
    source: "smokingpipes",
    allowApply: true,
    fatalWarnings: [],
    coverage: {
      pagesScanned: 104,
      fullExpectedRangeScanned: true,
    },
  }),
  "utf8"
);
fs.writeFileSync(
  offlinePreparePaths.progressiveBrandExclusionReportJson,
  JSON.stringify({
    source: "smokingpipes",
    excludedBrandCount: 86,
    excludedBrandBreakdown: { falcon: 86 },
    plannedHideProductionCount: 51,
    productionWritten: false,
  }),
  "utf8"
);
const offlinePrepareResult =
  await runSmokingpipesProgressiveMode({
    root: offlinePrepareRoot,
    options: parseRunnerOptions([
      "--mode=progressive-prepare-apply",
      "--no-commit",
      "--no-deploy",
    ]),
  });
assert.equal(offlinePrepareResult.networkAccessed, false);
assert.equal(offlinePrepareResult.browserStarted, false);
assert.equal(offlinePrepareResult.productionWritten, false);
assert.equal(offlinePrepareResult.readyCount, 1389);
assert.equal(offlinePrepareResult.reviewOnlyCount, 4);
assert.equal(offlinePrepareResult.notPublicCount, 235);
assert.equal(offlinePrepareResult.failedNotPublicCount, 149);
assert.equal(offlinePrepareResult.excludedBrandCount, 86);
assert.equal(offlinePrepareResult.candidateCount, 1628);
assert.equal(offlinePrepareResult.wouldApplyCount, 1389);
assert.equal(offlinePrepareResult.isolatedCandidateCount, 239);
assert.equal(
  fs.existsSync(offlinePreparePaths.progressiveApplyGateReport),
  true
);
assert.equal(
  fs.existsSync(offlinePreparePaths.progressiveApplyPreview),
  true
);
assert.equal(
  fs.existsSync(offlinePreparePaths.progressiveAuditJson),
  true
);
assert.equal(
  fs.existsSync(offlinePreparePaths.progressiveProductsNext),
  false
);
assert.equal(
  fs.existsSync(offlinePreparePaths.progressivePublicNextRoot),
  false
);
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
  deferred: 0,
  complete: 3,
  failed: 0,
  blocked: 0,
  excluded: 0,
  listNotPublicFiltered: 0,
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

const {
  resolvePushDeerPushKey,
  sendPushDeerNotification,
} = await import("./inventory-pushdeer-notifier-v1.mjs");
const {
  buildPushDeerDailyMessage,
  buildSmokingpipesDailyMobileReport,
  isDirectCliInvocation,
  runSmokingpipesDailyMobileReport,
  shouldSendDailyMobileNotification,
} = await import("./smokingpipes-daily-mobile-report-v1.mjs");

assert.deepEqual(
  resolvePushDeerPushKey({
    PUSHDEER_KEY: "legacy-key",
    PUSHDEER_PUSHKEY: "new-key",
    YAN_DOUBUY_PUSHDEER_PUSHKEY: "project-key",
  }),
  {
    key: "legacy-key",
    envName: "PUSHDEER_KEY",
  }
);
assert.equal(resolvePushDeerPushKey({}).key, "");

const safeBootstrapMobileReport = buildSmokingpipesDailyMobileReport({
  runAt: "2026-07-08T10:30:00.000+08:00",
  taskState: {
    source: "smokingpipes",
    dateKey: "2026-07-08",
    status: "safe-bootstrap-complete",
    attempts: 1,
    productionWritten: false,
    appliedCount: 0,
    candidateCount: 5,
    wouldApplyCount: 5,
    isolatedCandidateCount: 0,
    retryAllowed: false,
    lastFailureReason:
      "安全首跑完成：已生成候选、audit、preview 和 gate report，未写 production，等待人工确认。",
    lastFailureType: "safe-bootstrap",
  },
  state: {
    source: "smokingpipes",
    listSnapshotStatus: "complete",
    pagesScanned: 107,
    expectedPages: 107,
    candidates: [],
  },
  audit: {
    verdict: "PASS",
    candidateCount: 5,
    wouldApplyCount: 5,
    productionWritten: false,
    blockers: [],
    warnings: [],
    counts: {},
  },
});
assert.equal(safeBootstrapMobileReport.status, "safe-bootstrap-complete");
assert.match(safeBootstrapMobileReport.statusLabel, /安全首跑完成/);
const safeBootstrapMobileMessage = buildPushDeerDailyMessage(
  safeBootstrapMobileReport
);
assert.match(safeBootstrapMobileMessage.body, /安全首跑完成/);
assert.match(safeBootstrapMobileMessage.body, /production/);

const safeBootstrapCurrentListFailureReport =
  buildSmokingpipesDailyMobileReport({
    runAt: "2026-07-08T21:10:00.000+08:00",
    taskLogText:
      "DAILY TASK FAILED: No products were extracted from requested page 107; parse failure: page.waitForSelector: Timeout 15000ms exceeded.",
    taskState: {
      source: "smokingpipes",
      runMode: "safe-bootstrap",
      safeBootstrap: true,
      noProductionWrite: true,
      dateKey: "2026-07-08",
      status: "retryable-failed",
      attempts: 1,
      productionWritten: false,
      appliedCount: 0,
      candidateCount: 0,
      wouldApplyCount: 0,
      isolatedCandidateCount: 0,
      retryAllowed: true,
      lastFailureReason:
        "No products were extracted from requested page 107; parse failure: page.waitForSelector: Timeout 15000ms exceeded.",
      lastFailureType: "current-list",
      detailPhaseStatus: "not-started",
      currentList: {
        status: "failed",
        reused: false,
        path: "data/inventory/smokingpipes-current-list-dry-run.json",
        pagesScanned: 106,
        expectedPages: 107,
        productsExtracted: 5088,
        reuseReason:
          "page 107 no products / selector timeout 15000ms",
      },
    },
    state: {
      source: "smokingpipes",
      listSnapshotStatus: "blocked",
      pagesScanned: 106,
      expectedPages: 107,
      candidates: [{ sourceProductId: "old-stale-candidate" }],
    },
    audit: {
      verdict: "PASS",
      candidateCount: 4039,
      attemptedCandidateCount: 4039,
      wouldApplyCount: 4039,
      isolatedCandidateCount: 465,
      productionWritten: false,
      newProductReady: 179,
      newProductReviewOnly: 465,
      newProductNotReady: 267,
      blockers: [],
      warnings: [],
      counts: {},
    },
  });
assert.equal(
  safeBootstrapCurrentListFailureReport.status,
  "safe-bootstrap-current-list-failed"
);
assert.equal(
  safeBootstrapCurrentListFailureReport.statusLabel,
  "安全首跑失败，未写入生产"
);
assert.equal(safeBootstrapCurrentListFailureReport.candidateCount, 0);
assert.equal(safeBootstrapCurrentListFailureReport.attemptedCandidateCount, 0);
assert.equal(safeBootstrapCurrentListFailureReport.wouldApplyCount, 0);
assert.equal(safeBootstrapCurrentListFailureReport.isolatedCandidateCount, 0);
assert.equal(safeBootstrapCurrentListFailureReport.newProductReady, 0);
assert.equal(safeBootstrapCurrentListFailureReport.newProductReviewOnly, 0);
assert.equal(safeBootstrapCurrentListFailureReport.newProductNotReady, 0);
assert.equal(
  safeBootstrapCurrentListFailureReport.detailPhaseStatus,
  "not-started"
);
assert.equal(safeBootstrapCurrentListFailureReport.productionWritten, false);
assert.match(
  safeBootstrapCurrentListFailureReport.reason,
  /page\.waitForSelector: Timeout 15000ms exceeded/
);
assert.match(
  safeBootstrapCurrentListFailureReport.nextStep,
  /定时任务尚未恢复/
);
assert.doesNotMatch(
  safeBootstrapCurrentListFailureReport.nextStep,
  /等待 Windows 定时任务自动重试/
);
const safeBootstrapCurrentListFailureMessage =
  buildPushDeerDailyMessage(safeBootstrapCurrentListFailureReport);
assert.match(
  safeBootstrapCurrentListFailureMessage.body,
  /结论：安全首跑失败，未写入生产/
);
assert.match(
  safeBootstrapCurrentListFailureMessage.body,
  /阶段：current-list 源站列表抓取/
);
assert.match(
  safeBootstrapCurrentListFailureMessage.body,
  /详情抓取：未开始/
);
assert.match(
  safeBootstrapCurrentListFailureMessage.body,
  /候选生成：未开始/
);
assert.match(
  safeBootstrapCurrentListFailureMessage.body,
  /自动写入：已禁止/
);
assert.doesNotMatch(safeBootstrapCurrentListFailureMessage.body, /4039/);
assert.doesNotMatch(safeBootstrapCurrentListFailureMessage.body, /179/);
assert.doesNotMatch(safeBootstrapCurrentListFailureMessage.body, /465/);

const missingPushKeyResult = await sendPushDeerNotification({
  title: "烟斗派库存日报｜Smokingpipes",
  body: "状态：成功",
  env: {},
});
assert.equal(missingPushKeyResult.notificationSent, false);
assert.equal(missingPushKeyResult.notificationSkipped, true);
assert.match(missingPushKeyResult.notificationReason, /missing/i);

let pushDeerFetchCalled = false;
const dryRunPushResult = await sendPushDeerNotification({
  title: "烟斗派库存日报｜Smokingpipes",
  body: "状态：成功",
  dryRun: true,
  env: { PUSHDEER_KEY: "dry-run-key" },
  fetchImpl: async () => {
    pushDeerFetchCalled = true;
    throw new Error("dry-run should not call fetch");
  },
});
assert.equal(pushDeerFetchCalled, false);
assert.equal(dryRunPushResult.notificationSent, false);
assert.equal(dryRunPushResult.notificationSkipped, true);
assert.match(dryRunPushResult.notificationReason, /dry-run/i);

let pushDeerUrl = null;
const sentPushResult = await sendPushDeerNotification({
  title: "烟斗派库存日报｜Smokingpipes",
  body: "状态：需要人工验证\n扫描：107/107 页\n下一步：\n请在电脑上完成 Smokingpipes 验证",
  env: { PUSHDEER_KEY: "send-key" },
  fetchImpl: async (url) => {
    pushDeerUrl = new URL(String(url));
    return { ok: true, status: 200 };
  },
});
assert.equal(sentPushResult.notificationSent, true);
assert.equal(pushDeerUrl.searchParams.get("text"), "烟斗派库存日报｜Smokingpipes");
assert.match(pushDeerUrl.searchParams.get("desp"), /状态：需要人工验证\n扫描：107\/107 页/);
assert.equal(pushDeerUrl.searchParams.get("type"), "markdown");

const mobileReport = buildSmokingpipesDailyMobileReport({
  runAt: "2026-06-25T02:30:00.000Z",
  state: {
    source: "smokingpipes",
    listSnapshotStatus: "blocked",
    blockedReason: "verification detected on detail page",
    candidates: [
      {
        sourceProductId: "1",
        changeTypes: ["new-product"],
        detailStatus: "complete",
        publicStatus: "ready",
      },
      {
        sourceProductId: "2",
        changeTypes: ["new-product"],
        detailStatus: "failed",
        publicStatus: "not-public",
      },
      {
        sourceProductId: "3",
        changeTypes: ["new-product"],
        detailStatus: "complete",
        publicStatus: "review-only",
      },
      {
        sourceProductId: "4",
        changeTypes: ["new-product"],
        detailStatus: "pending",
        publicStatus: "not-public",
      },
    ],
  },
  audit: {
    auditStatus: "FAIL",
    candidateCount: 4,
    wouldApplyCount: 1,
    productionWritten: false,
    blockers: ["verification detected"],
    warnings: ["review-only retained"],
  },
  notification: {
    notificationSent: false,
    notificationSkipped: true,
    notificationReason: "not requested",
  },
});
assert.equal(mobileReport.status, "blocked");
assert.equal(mobileReport.candidateCount, 4);
assert.equal(mobileReport.wouldApplyCount, 1);
assert.equal(mobileReport.newProductReady, 1);
assert.equal(mobileReport.newProductReviewOnly, 1);
assert.equal(mobileReport.newProductNotReady, 2);
assert.equal(mobileReport.detailComplete, 2);
assert.equal(mobileReport.detailFailed, 1);
assert.equal(mobileReport.detailPending, 1);
assert.equal(mobileReport.publicReady, 1);
assert.equal(mobileReport.publicReviewOnly, 1);
assert.equal(mobileReport.publicNotPublic, 2);
assert.match(mobileReport.blockers.join("\n"), /verification detected/);
assert.deepEqual(mobileReport.warnings, ["review-only retained"]);
const pushDeerMessage = buildPushDeerDailyMessage(mobileReport);
assert.equal(pushDeerMessage.title, "烟斗派库存日报｜Smokingpipes");
assert.match(pushDeerMessage.body, /结论：需要人工验证/);
assert.match(pushDeerMessage.body, /人工复核：1/);
assert.match(pushDeerMessage.body, /失败保留：1/);
assert.doesNotMatch(pushDeerMessage.body, /烟斗派库存日报｜Smokingpipes/);

const verificationLogReport = buildSmokingpipesDailyMobileReport({
  runAt: "2026-06-25T03:00:00.000Z",
  taskLogText:
    "DAILY TASK FAILED: Smokingpipes strong verification detected. Complete it in the opened browser within 30 minutes.",
  state: {
    source: "smokingpipes",
    listSnapshotStatus: "complete",
    pagesScanned: 107,
    expectedPages: 107,
    candidates: [],
  },
  audit: {
    verdict: "PASS",
    candidateCount: 324,
    wouldApplyCount: 324,
    productionWritten: false,
    blockers: [],
    warnings: [],
  },
});

const detailProgressMobileReport = buildSmokingpipesDailyMobileReport({
  runAt: "2026-07-11T10:30:00.000+08:00",
  taskLogText: '{"blocked": false, "auditStatus": "missing"}',
  taskState: {
    source: "smokingpipes",
    status: "detail-progress",
    productionWritten: false,
    retryAllowed: true,
    detailPhaseStatus: "detail-progress",
    detailCompletedThisRun: 30,
    detailPending: 149,
    detailPendingCount: 179,
    cachedListResume: {
      enabled: true,
      lockedUntilComplete: true,
      completed: false,
    },
  },
  state: {
    source: "smokingpipes",
    pagesScanned: 107,
    expectedPages: 107,
    candidates: [],
  },
});
assert.equal(detailProgressMobileReport.status, "detail-progress");
assert.equal(detailProgressMobileReport.productionWritten, false);
assert.equal(detailProgressMobileReport.retryAllowed, true);
assert.equal(detailProgressMobileReport.detailCompletedThisRun, 30);
assert.equal(detailProgressMobileReport.detailPending, 149);
assert.equal(detailProgressMobileReport.pendingDetailCount, 149);
assert.equal(detailProgressMobileReport.auditStatus, "DEFERRED");
assert.deepEqual(detailProgressMobileReport.blockers, []);
assert.equal(detailProgressMobileReport.verificationRequired, false);
const detailProgressMessage = buildPushDeerDailyMessage(detailProgressMobileReport);
assert.match(detailProgressMessage.body, /30/);
assert.match(detailProgressMessage.body, /149/);
assert.doesNotMatch(detailProgressMessage.body, /候选应用被安全门禁阻断/);

assert.equal(verificationLogReport.status, "blocked");
assert.equal(verificationLogReport.pagesScanned, 107);
assert.equal(verificationLogReport.expectedPages, 107);
assert.match(verificationLogReport.blockers.join("\n"), /strong verification detected/i);
const verificationLogMessage = buildPushDeerDailyMessage(verificationLogReport);
assert.match(verificationLogMessage.body, /结论：需要人工验证/);
assert.match(verificationLogMessage.body, /扫描：107\/107 页/);
assert.match(verificationLogMessage.body, /下一步：\n请在电脑上完成 Smokingpipes 验证/);
assert.match(
  verificationLogMessage.body,
  /验证对象：Smokingpipes/
);
assert.match(
  verificationLogMessage.body,
  /操作位置：运行任务的电脑，不是在手机里/
);
assert.match(
  verificationLogMessage.body,
  /浏览器：Chrome profile sp-chrome/
);

const detailQueueSpikeMobileReport =
  buildSmokingpipesDailyMobileReport({
    runAt: "2026-07-05T08:27:00.000Z",
    taskLogText:
      "DAILY TASK FAILED: Smokingpipes strong verification detected. Complete it in the opened browser within 30 minutes.",
    taskState: {
      status: "terminal-failed",
      lastFailureType: "detail-queue-spike",
      productionWritten: false,
      retryAllowed: false,
      detailPendingCount: 2,
      detailQueueSpike: {
        blocked: true,
        detailPendingCount: 2,
        previousDetailPendingCount: 0,
        blockReasons: [
          "synthetic detail queue spike",
        ],
      },
    },
    state: {
      source: "smokingpipes",
      pagesScanned: 107,
      expectedPages: 107,
      candidates: [
        {
          sourceProductId: "spike-1",
          changeTypes: ["new-product"],
          detailStatus: "pending",
          publicStatus: "not-public",
        },
        {
          sourceProductId: "spike-2",
          changeTypes: ["new-product"],
          detailStatus: "pending",
          publicStatus: "not-public",
        },
      ],
    },
    audit: {
      verdict: "PASS",
      candidateCount: 2,
      wouldApplyCount: 0,
      productionWritten: false,
      blockers: [],
      warnings: [],
    },
  });
assert.equal(
  detailQueueSpikeMobileReport.pendingDetailCount,
  2
);
assert.equal(
  detailQueueSpikeMobileReport.statusLabel,
  "暂停，详情队列异常 + 源站验证"
);
assert.equal(
  detailQueueSpikeMobileReport.retryAllowed,
  false
);
const detailQueueSpikeMobileMessage =
  buildPushDeerDailyMessage(
    detailQueueSpikeMobileReport
  );
assert.match(
  detailQueueSpikeMobileMessage.body,
  /核心风险：待处理详情突然增加到 2/
);
assert.match(
  detailQueueSpikeMobileMessage.body,
  /源站验证：Smokingpipes 出现强验证/
);
assert.match(
  detailQueueSpikeMobileMessage.body,
  /如窗口不存在，不要手动继续/
);
assert.match(
  detailQueueSpikeMobileMessage.body,
  /先查看 detail-pending-spike 诊断报告/
);

const manualFullReconcileMobileReport =
  buildSmokingpipesDailyMobileReport({
    runAt: "2026-07-05T09:00:00.000Z",
    taskState: {
      status: "running",
      runMode: "manual-full-reconcile",
      productionWritten: false,
      appliedCount: 0,
      manualFullReconcile: {
        totalNewCandidates: 698,
        detailEligibleThisBatch: 30,
        detailPendingTotal: 532,
        appliedTargetCount: 30,
      },
    },
    state: {
      source: "smokingpipes",
      pagesScanned: 107,
      expectedPages: 107,
      manualFullReconcile: {
        mode: "rebuild-state",
      },
      candidates: [],
    },
    audit: {
      verdict: "PASS",
      candidateCount: 30,
      wouldApplyCount: 30,
      productionWritten: false,
      blockers: [],
      warnings: [],
    },
  });
assert.equal(
  manualFullReconcileMobileReport.statusLabel,
  "人工全量对齐：详情分批处理中"
);
assert.match(
  manualFullReconcileMobileReport.reason,
  /这是人工全量对齐模式，不是每日自动更新/
);
assert.match(
  manualFullReconcileMobileReport.nextStep,
  /继续手动运行 FetchDetailBatch/
);
const manualFullReconcileMobileMessage =
  buildPushDeerDailyMessage(
    manualFullReconcileMobileReport
  );
assert.match(
  manualFullReconcileMobileMessage.body,
  /列表快照：107\/107 页/
);
assert.match(
  manualFullReconcileMobileMessage.body,
  /本轮新增候选：698/
);
assert.match(
  manualFullReconcileMobileMessage.body,
  /本轮待抓详情：30 \/ 总待处理 532/
);
assert.match(
  manualFullReconcileMobileMessage.body,
  /本轮正式应用：0 \/ 30/
);
assert.match(
  manualFullReconcileMobileMessage.body,
  /本批详情：已完成 0 \/ 尝试 0/
);
assert.match(
  manualFullReconcileMobileMessage.body,
  /production 写入：否/
);
assert.match(
  manualFullReconcileMobileMessage.body,
  /这是人工对齐模式，不是每日自动更新/
);

const manualDetailVerificationMobileReport =
  buildSmokingpipesDailyMobileReport({
    runAt: "2026-07-07T09:46:00.000Z",
    taskState: {
      status: "running",
      runMode: "manual-full-reconcile",
      productionWritten: false,
      appliedCount: 0,
      manualFullReconcile: {
        totalNewCandidates: 698,
        detailEligibleThisBatch: 30,
        detailPendingTotal: 297,
        appliedTargetCount: 0,
        detailBatch: {
          attemptedCount: 2,
          completedCount: 1,
          failedCount: 0,
          blockedCount: 1,
          remainingPendingCount: 28,
          deferredCount: 266,
          reviewOnlyCount: 402,
          productionWritten: false,
        },
      },
    },
    state: {
      source: "smokingpipes",
      pagesScanned: 107,
      expectedPages: 107,
      verificationDetected: true,
      blockedReason: "Smokingpipes strong verification detected at 700972.",
      manualFullReconcile: {
        mode: "fetch-detail-batch",
      },
      candidates: [],
    },
    audit: {
      verdict: "PASS",
      candidateCount: 30,
      wouldApplyCount: 0,
      productionWritten: false,
      blockers: [],
      warnings: [],
    },
  });
assert.equal(
  manualDetailVerificationMobileReport.statusLabel,
  "人工全量对齐暂停：源站验证"
);
assert.equal(
  manualDetailVerificationMobileReport.verificationRequired,
  true
);
const manualDetailVerificationMobileMessage =
  buildPushDeerDailyMessage(
    manualDetailVerificationMobileReport
  );
assert.match(
  manualDetailVerificationMobileMessage.body,
  /验证对象：Smokingpipes/
);
assert.match(
  manualDetailVerificationMobileMessage.body,
  /验证位置：运行任务的电脑/
);
assert.match(
  manualDetailVerificationMobileMessage.body,
  /浏览器：Chrome profile sp-chrome/
);
assert.match(
  manualDetailVerificationMobileMessage.body,
  /验证页面：已打开的 Smokingpipes 页面/
);
assert.match(
  manualDetailVerificationMobileMessage.body,
  /完成验证后手动重跑 FetchDetailBatch，不要恢复 daily task/
);
assert.match(
  manualDetailVerificationMobileMessage.body,
  /本批详情：已完成 1 \/ 尝试 2/
);
assert.match(
  manualDetailVerificationMobileMessage.body,
  /production 写入：否/
);

const noVerificationLogReport = buildSmokingpipesDailyMobileReport({
  runAt: "2026-06-25T03:05:00.000Z",
  taskLogText: '"captchaDetected": false,\n"verificationDetectedAt": null',
  state: {
    source: "smokingpipes",
    listSnapshotStatus: "complete",
    pagesScanned: 107,
    expectedPages: 107,
    candidates: [],
  },
  audit: {
    verdict: "PASS",
    candidateCount: 324,
    wouldApplyCount: 324,
    productionWritten: false,
    blockers: [],
    warnings: [],
  },
});
assert.equal(noVerificationLogReport.status, "preview");
assert.deepEqual(noVerificationLogReport.blockers, []);
assert.equal(noVerificationLogReport.appliedCount, 0);
assert.equal(noVerificationLogReport.statusLabel, "未更新，仅生成预览");
assert.match(noVerificationLogReport.reason, /productionWritten=false/);
const previewLogMessage = buildPushDeerDailyMessage(noVerificationLogReport);
assert.match(previewLogMessage.body, /结论：未更新，仅生成预览/);
assert.match(previewLogMessage.body, /正式应用：0/);
assert.match(previewLogMessage.body, /待处理详情：/);
assert.doesNotMatch(previewLogMessage.body, /状态：安全预览/);
assert.doesNotMatch(previewLogMessage.body, /未完成：/);

const reusedCurrentListReport = buildSmokingpipesDailyMobileReport({
  runAt: "2026-06-25T03:07:00.000Z",
  taskState: {
    source: "smokingpipes",
    dateKey: "2026-06-25",
    status: "retryable-failed",
    attempts: 2,
    lastFailureReason: "progressive-ingest-list failed before production write: lock",
    lastFailureType: "lock",
    productionWritten: false,
    appliedCount: 0,
    candidateCount: 324,
    retryAllowed: true,
    nextRetryRecommendedAt: "2026-06-25T05:07:00.000Z",
    currentList: {
      status: "reused",
      reused: true,
      path: "data/inventory/smokingpipes-current-list-dry-run.json",
      pagesScanned: 107,
      expectedPages: 107,
      productsExtracted: 5136,
      lastCompletedAt: "2026-06-25T03:04:24.852Z",
      reuseReason: "complete current-list cache from today",
    },
  },
  state: {
    source: "smokingpipes",
    listSnapshotStatus: "complete",
    pagesScanned: 107,
    expectedPages: 107,
    candidates: [],
  },
  audit: {
    verdict: "PASS",
    candidateCount: 324,
    wouldApplyCount: 324,
    productionWritten: false,
    blockers: [],
    warnings: [],
  },
});
assert.equal(reusedCurrentListReport.currentList.reused, true);
assert.equal(reusedCurrentListReport.currentList.status, "reused");
assert.equal(reusedCurrentListReport.currentList.productsExtracted, 5136);
const reusedCurrentListMessage = buildPushDeerDailyMessage(reusedCurrentListReport);
assert.match(
  reusedCurrentListMessage.body,
  /源站扫描：复用今日完整列表快照（107\/107）/
);

const previewReusedCurrentListReport = buildSmokingpipesDailyMobileReport({
  runAt: "2026-06-25T03:08:00.000Z",
  taskState: {
    source: "smokingpipes",
    dateKey: "2026-06-25",
    status: "running",
    productionWritten: false,
    appliedCount: 0,
    candidateCount: 324,
    retryAllowed: true,
    currentList: {
      status: "reused",
      reused: true,
      path: "data/inventory/smokingpipes-current-list-dry-run.json",
      pagesScanned: 107,
      expectedPages: 107,
      productsExtracted: 5136,
      lastCompletedAt: "2026-06-25T03:04:24.852Z",
      reuseReason: "complete current-list cache from today",
    },
  },
  state: {
    source: "smokingpipes",
    listSnapshotStatus: "complete",
    pagesScanned: 107,
    expectedPages: 107,
    candidates: [],
  },
  audit: {
    verdict: "PASS",
    candidateCount: 324,
    wouldApplyCount: 324,
    productionWritten: false,
    blockers: [],
    warnings: [],
  },
});
assert.equal(previewReusedCurrentListReport.status, "preview");
assert.match(previewReusedCurrentListReport.reason, /已复用今日 current-list/);

const manualRecoveryCurrentListReport = buildSmokingpipesDailyMobileReport({
  runAt: "2026-06-25T03:09:00.000Z",
  taskState: {
    source: "smokingpipes",
    dateKey: "2026-06-25",
    status: "running",
    productionWritten: false,
    appliedCount: 0,
    candidateCount: 324,
    retryAllowed: true,
    currentList: {
      status: "stale-cache-manual-recovery",
      reused: true,
      skippedFetch: true,
      stale: true,
      manualRecovery: true,
      path: "data/inventory/smokingpipes-current-list-dry-run.json",
      pagesScanned: 107,
      expectedPages: 107,
      productsExtracted: 5136,
      lastCompletedAt: "2026-06-24T03:04:24.852Z",
      reuseReason:
        "complete stale current-list cache allowed by manual recovery",
      safety: {
        soldByAbsenceAllowed: false,
        disappearedApplyAllowed: false,
      },
    },
  },
  state: {
    source: "smokingpipes",
    listSnapshotStatus: "complete",
    pagesScanned: 107,
    expectedPages: 107,
    candidates: [],
  },
  audit: {
    verdict: "PASS",
    candidateCount: 324,
    wouldApplyCount: 324,
    productionWritten: false,
    blockers: [],
    warnings: [],
  },
});
const manualRecoveryCurrentListMessage =
  buildPushDeerDailyMessage(manualRecoveryCurrentListReport);
assert.match(
  manualRecoveryCurrentListMessage.body,
  /源站扫描：跳过，复用已有完整列表快照（人工恢复模式）/
);
assert.match(
  manualRecoveryCurrentListMessage.body,
  /本轮未重新访问 Smokingpipes；不会根据旧列表自动判定下架。/
);

const cachedListResumeInProgressReport = buildSmokingpipesDailyMobileReport({
  runAt: "2026-06-25T03:11:00.000Z",
  taskState: {
    source: "smokingpipes",
    dateKey: "2026-06-25",
    status: "running",
    productionWritten: false,
    appliedCount: 0,
    candidateCount: 52,
    retryAllowed: true,
    currentList: {
      status: "reused",
      reused: true,
      skippedFetch: true,
      stale: true,
      manualRecovery: true,
      path: "data/inventory/smokingpipes-current-list-dry-run.json",
      pagesScanned: 107,
      expectedPages: 107,
      productsExtracted: 5136,
      safety: {
        soldByAbsenceAllowed: false,
        disappearedApplyAllowed: false,
      },
    },
    cachedListResume: {
      enabled: true,
      snapshotPath: "data/inventory/smokingpipes-current-list-dry-run.json",
      snapshotDateKey: "2026-06-25",
      snapshotProductsExtracted: 5136,
      snapshotUniqueProducts: 5135,
      lockedUntilComplete: true,
      completed: false,
      completedAt: null,
      allowNextListFetch: false,
      reason: "resume detail processing from latest complete current-list cache",
    },
  },
  state: {
    source: "smokingpipes",
    listSnapshotStatus: "complete",
    pagesScanned: 107,
    expectedPages: 107,
    candidates: [{ detailStatus: "pending", publicStatus: "not-public" }],
  },
  audit: {
    verdict: "PASS",
    candidateCount: 52,
    wouldApplyCount: 0,
    productionWritten: false,
    blockers: [],
    warnings: [],
  },
});
assert.equal(
  cachedListResumeInProgressReport.statusLabel,
  "详情继续处理中，将自动续跑"
);
assert.equal(
  cachedListResumeInProgressReport.cachedListResume.allowNextListFetch,
  false
);
const cachedListResumeInProgressMessage =
  buildPushDeerDailyMessage(cachedListResumeInProgressReport);
assert.match(
  cachedListResumeInProgressMessage.body,
  /源站扫描：未重新抓取，复用已有完整列表快照/
);
assert.match(
  cachedListResumeInProgressMessage.body,
  /详情抓取：继续抓取更新商品详情/
);
assert.match(
  cachedListResumeInProgressMessage.body,
  /执行方式：缓存列表断点恢复/
);
assert.match(
  cachedListResumeInProgressMessage.body,
  /下次列表抓取：当前快照完成后恢复；未完成前继续复用同一份列表快照/
);
assert.match(
  cachedListResumeInProgressMessage.body,
  /源站访问：仅访问商品详情页，未重新抓列表页/
);
assert.doesNotMatch(
  cachedListResumeInProgressMessage.body,
  /源站访问：未访问 Smokingpipes/
);

const cachedListResumeCompleteReport = buildSmokingpipesDailyMobileReport({
  runAt: "2026-06-25T04:00:00.000Z",
  taskState: {
    source: "smokingpipes",
    dateKey: "2026-06-25",
    status: "success",
    productionWritten: true,
    appliedCount: 52,
    candidateCount: 52,
    retryAllowed: false,
    currentList: cachedListResumeInProgressReport.currentList,
    cachedListResume: {
      ...cachedListResumeInProgressReport.cachedListResume,
      completed: true,
      completedAt: "2026-06-25T04:00:00.000Z",
      allowNextListFetch: true,
    },
  },
  state: {
    source: "smokingpipes",
    listSnapshotStatus: "complete",
    pagesScanned: 107,
    expectedPages: 107,
    candidates: [],
  },
  audit: {
    verdict: "PASS",
    candidateCount: 52,
    wouldApplyCount: 52,
    productionWritten: true,
    blockers: [],
    warnings: [],
  },
});
assert.equal(
  cachedListResumeCompleteReport.statusLabel,
  "已更新"
);
assert.match(
  buildPushDeerDailyMessage(cachedListResumeCompleteReport).body,
  /下次列表抓取：当前快照已完成，下次可重新抓取新列表/
);

const safeSubsetMobileReport = buildSmokingpipesDailyMobileReport({
  ...{
    runAt: "2026-07-04T10:30:00.000+08:00",
    taskState: {
      source: "smokingpipes",
      status: "success",
      productionWritten: true,
      appliedCount: 328,
      candidateCount: 328,
      isolatedCandidateCount: 27,
      retryAllowed: false,
      cachedListResume: {
        enabled: true,
        lockedUntilComplete: true,
        completed: true,
        allowNextListFetch: true,
      },
    },
    state: {
      source: "smokingpipes",
      pagesScanned: 107,
      expectedPages: 107,
      candidates: [],
    },
    audit: {
      verdict: "PASS",
      attemptedCandidateCount: 355,
      candidateCount: 355,
      wouldApplyCount: 328,
      isolatedCandidateCount: 27,
      productionWritten: true,
      blockers: [],
      warnings: [],
      applyGap: {
        candidateCount: 355,
        wouldApplyCount: 328,
        gapCount: 27,
        safeToApplyWouldApplySubset: true,
      },
    },
  },
});
assert.equal(safeSubsetMobileReport.statusLabel, "已更新");
assert.equal(safeSubsetMobileReport.candidateCount, 355);
assert.equal(safeSubsetMobileReport.isolatedCandidateCount, 27);
const safeSubsetMobileMessage = buildPushDeerDailyMessage(
  safeSubsetMobileReport
);
assert.match(safeSubsetMobileMessage.body, /正式应用：328/);
assert.match(safeSubsetMobileMessage.body, /隔离候选：27/);
assert.match(
  safeSubsetMobileMessage.body,
  /不可自动应用候选保留复核/
);

const unsafeGapMobileReport = buildSmokingpipesDailyMobileReport({
  runAt: "2026-07-04T10:30:00.000+08:00",
  taskState: {
    source: "smokingpipes",
    status: "terminal-failed",
    productionWritten: false,
    appliedCount: 0,
    candidateCount: 355,
    retryAllowed: false,
    cachedListResume: {
      enabled: true,
      lockedUntilComplete: true,
      completed: false,
      allowNextListFetch: false,
    },
  },
  state: {
    source: "smokingpipes",
    pagesScanned: 107,
    expectedPages: 107,
    candidates: [],
  },
  audit: {
    verdict: "PASS",
    candidateCount: 355,
    wouldApplyCount: 328,
    productionWritten: false,
    blockers: [],
    warnings: [],
    applyGap: {
      candidateCount: 355,
      wouldApplyCount: 328,
      gapCount: 27,
      unknownGapCount: 1,
      readyUnexpectedlyExcludedCount: 0,
      safeToApplyWouldApplySubset: false,
    },
  },
});
assert.equal(
  unsafeGapMobileReport.statusLabel,
  "候选应用被安全门禁阻断"
);
assert.equal(
  unsafeGapMobileReport.cachedListResume.completed,
  false
);
assert.equal(
  unsafeGapMobileReport.cachedListResume.allowNextListFetch,
  false
);
assert.match(
  buildPushDeerDailyMessage(unsafeGapMobileReport).body,
  /355 个候选中只有 328 个允许自动应用，27 个需要分类确认/
);
assert.match(
  unsafeGapMobileReport.nextStep,
  /smokingpipes-apply-gap-diagnosis-report\.md/
);

const failedTaskReport = buildSmokingpipesDailyMobileReport({
  runAt: "2026-06-25T03:06:00.000Z",
  taskLogText:
    "DAILY TASK FAILED: Error: Inventory automation is already running. Lock: C:\\Users\\NING MEI\\Desktop\\pipewebsite\\data\\inventory\\state\\smokingpipes-progressive-daily.lock.",
  state: {
    source: "smokingpipes",
    listSnapshotStatus: "complete",
    pagesScanned: 107,
    expectedPages: 107,
    candidates: [],
  },
  audit: {
    verdict: "PASS",
    candidateCount: 324,
    wouldApplyCount: 324,
    productionWritten: false,
    blockers: [],
    warnings: [],
  },
});
assert.equal(failedTaskReport.status, "failed");
assert.equal(failedTaskReport.statusLabel, "更新失败");
assert.match(failedTaskReport.blockers.join("\n"), /already running/i);
assert.match(failedTaskReport.reason, /daily task failed/i);
const failedTaskMessage = buildPushDeerDailyMessage(failedTaskReport);
assert.match(failedTaskMessage.body, /结论：更新失败/);
assert.match(
  failedTaskMessage.body,
  /下一步：\n查看 data\/review\/smokingpipes-daily-task-latest\.log/
);
assert.doesNotMatch(failedTaskMessage.body, /安全预览/);

const retryableTaskReport = buildSmokingpipesDailyMobileReport({
  runAt: "2026-06-25T04:00:00.000Z",
  taskState: {
    source: "smokingpipes",
    dateKey: "2026-06-25",
    status: "retryable-failed",
    attempts: 1,
    lastFailureAt: "2026-06-25T04:00:00.000Z",
    lastFailureReason: "progressive-ingest-list failed before production write: profile lock",
    lastFailureType: "lock",
    productionWritten: false,
    appliedCount: 0,
    candidateCount: 324,
    retryAllowed: true,
    nextRetryRecommendedAt: "2026-06-25T06:00:00.000Z",
  },
  state: {
    source: "smokingpipes",
    listSnapshotStatus: "complete",
    pagesScanned: 107,
    expectedPages: 107,
    candidates: [],
  },
  audit: {
    verdict: "PASS",
    candidateCount: 324,
    wouldApplyCount: 324,
    productionWritten: false,
    blockers: [],
    warnings: [],
  },
});
assert.equal(retryableTaskReport.status, "retryable-failed");
assert.equal(retryableTaskReport.retryAllowed, true);
assert.equal(retryableTaskReport.failureType, "lock");
assert.equal(
  retryableTaskReport.nextRetryRecommendedAt,
  "2026-06-25T06:00:00.000Z"
);
const retryableTaskMessage = buildPushDeerDailyMessage(retryableTaskReport);
assert.match(retryableTaskMessage.body, /结论：更新失败，将自动重试/);
assert.match(retryableTaskMessage.body, /失败类型：任务锁定/);
assert.match(retryableTaskMessage.body, /下一次重试：2026-06-25T06:00:00.000Z/);

const preflightFailedTaskReport = buildSmokingpipesDailyMobileReport({
  runAt: "2026-06-25T04:05:00.000Z",
  taskState: {
    source: "smokingpipes",
    dateKey: "2026-06-25",
    status: "retryable-failed",
    attempts: 2,
    lastFailureAt: "2026-06-25T04:05:00.000Z",
    lastFailureReason:
      "Daily recovery preflight failed; see data/review/smokingpipes-daily-recovery-preflight-report.md",
    lastFailureType: "preflight",
    productionWritten: false,
    appliedCount: 0,
    candidateCount: 0,
    retryAllowed: true,
    nextRetryRecommendedAt: "2026-06-25T06:05:00.000Z",
  },
  state: {
    source: "smokingpipes",
    listSnapshotStatus: "partial",
    pagesScanned: 0,
    expectedPages: 107,
    candidates: [],
  },
  audit: {
    verdict: "PASS",
    candidateCount: 0,
    wouldApplyCount: 0,
    productionWritten: false,
    blockers: [],
    warnings: [],
  },
});
assert.equal(preflightFailedTaskReport.statusLabel, "恢复预检失败");
assert.equal(preflightFailedTaskReport.failureType, "preflight");
assert.match(preflightFailedTaskReport.reason, /恢复预检失败/);
assert.match(
  preflightFailedTaskReport.nextStep,
  /smokingpipes-daily-recovery-preflight-report\.md/
);
const preflightFailedTaskMessage =
  buildPushDeerDailyMessage(preflightFailedTaskReport);
assert.match(preflightFailedTaskMessage.body, /结论：恢复预检失败/);
assert.match(preflightFailedTaskMessage.body, /失败类型：恢复预检/);
assert.doesNotMatch(preflightFailedTaskMessage.body, /C:\\Users\\NING MEI/);

const activeProgressiveLockReport = buildSmokingpipesDailyMobileReport({
  runAt: "2026-06-25T05:00:00.000Z",
  taskState: {
    source: "smokingpipes",
    dateKey: "2026-06-25",
    status: "retryable-failed",
    attempts: 2,
    lastFailureAt: "2026-06-25T05:00:00.000Z",
    lastFailureReason:
      'Error: Inventory automation is already running. Lock: C:\\Users\\NING MEI\\Desktop\\pipewebsite\\data\\inventory\\state\\smokingpipes-progressive-daily.lock. {"status":"blocked"}',
    lastFailureType: "lock",
    productionWritten: false,
    appliedCount: 0,
    candidateCount: 324,
    retryAllowed: true,
    nextRetryRecommendedAt: "2026-06-25T07:00:00.000Z",
    progressiveLock: {
      exists: true,
      status: "active-skip",
      path: "data/inventory/state/smokingpipes-progressive-daily.lock",
      ageMs: 900000,
      cleared: false,
      reason: "active",
    },
    currentList: {
      status: "reused",
      reused: true,
      path: "data/inventory/smokingpipes-current-list-dry-run.json",
      pagesScanned: 107,
      expectedPages: 107,
      productsExtracted: 5136,
      lastCompletedAt: "2026-06-25T03:04:24.852Z",
      reuseReason: "complete current-list cache from today",
    },
  },
  state: {
    source: "smokingpipes",
    listSnapshotStatus: "complete",
    pagesScanned: 107,
    expectedPages: 107,
    candidates: [],
  },
  audit: {
    verdict: "PASS",
    candidateCount: 324,
    wouldApplyCount: 324,
    productionWritten: false,
    blockers: [],
    warnings: [],
  },
});
assert.equal(activeProgressiveLockReport.status, "lock-active");
assert.match(
  activeProgressiveLockReport.statusLabel,
  /库存任务正在运行|搴撳瓨浠诲姟姝ｅ湪杩愯/
);
assert.equal(activeProgressiveLockReport.progressiveLock.status, "active-skip");
const activeProgressiveLockMessage =
  buildPushDeerDailyMessage(activeProgressiveLockReport);
assert.match(
  activeProgressiveLockMessage.body,
  /任务锁定|浠诲姟閿佸畾/
);
assert.match(
  activeProgressiveLockMessage.body,
  /自动重试|鑷姩閲嶈瘯/
);
assert.doesNotMatch(activeProgressiveLockMessage.body, /\{"status"/);
assert.doesNotMatch(activeProgressiveLockMessage.body, /C:\\Users\\NING MEI/);

const activeInventoryLockReport = buildSmokingpipesDailyMobileReport({
  runAt: "2026-06-25T05:05:00.000Z",
  taskState: {
    source: "smokingpipes",
    dateKey: "2026-06-25",
    status: "retryable-failed",
    attempts: 3,
    lastFailureAt: "2026-06-25T05:05:00.000Z",
    lastFailureReason:
      'Error: Inventory automation is already running. Lock: C:\\Users\\NING MEI\\Desktop\\pipewebsite\\data\\inventory\\state\\smokingpipes.lock. {"status":"blocked"}',
    lastFailureType: "lock",
    productionWritten: false,
    appliedCount: 0,
    candidateCount: 324,
    retryAllowed: true,
    nextRetryRecommendedAt: "2026-06-25T07:05:00.000Z",
    inventoryLocks: {
      checked: true,
      hasActiveLock: true,
      activeLocks: [
        {
          name: "global",
          path: "data/inventory/state/smokingpipes.lock",
          status: "active",
          reason: "active-pid",
        },
      ],
      clearedLocks: [],
      locks: [
        {
          name: "global",
          path: "data/inventory/state/smokingpipes.lock",
          status: "active",
          reason: "active-pid",
        },
      ],
    },
  },
  state: {
    source: "smokingpipes",
    listSnapshotStatus: "complete",
    pagesScanned: 107,
    expectedPages: 107,
    candidates: [],
  },
  audit: {
    verdict: "PASS",
    candidateCount: 324,
    wouldApplyCount: 324,
    productionWritten: false,
    blockers: [],
    warnings: [],
  },
});
assert.equal(activeInventoryLockReport.status, "lock-active");
assert.equal(
  activeInventoryLockReport.statusLabel,
  "库存任务正在运行，等待下一轮"
);
assert.equal(activeInventoryLockReport.inventoryLocks.hasActiveLock, true);
assert.equal(
  activeInventoryLockReport.reason,
  "检测到已有 Smokingpipes 库存任务锁，暂不启动第二个任务。"
);
const activeInventoryLockMessage =
  buildPushDeerDailyMessage(activeInventoryLockReport);
assert.match(activeInventoryLockMessage.body, /阻断：任务锁定/);
assert.match(activeInventoryLockMessage.body, /失败类型：任务锁定/);
assert.match(activeInventoryLockMessage.body, /自动重试/);
assert.doesNotMatch(activeInventoryLockMessage.body, /C:\\Users\\NING MEI/);
assert.doesNotMatch(activeInventoryLockMessage.body, /\{"status"/);
assert.doesNotMatch(
  activeInventoryLockMessage.body,
  /Error: Inventory automation is already running/i
);

const staleClearedProgressiveLockReport =
  buildSmokingpipesDailyMobileReport({
    runAt: "2026-06-25T05:10:00.000Z",
    taskState: {
      source: "smokingpipes",
      dateKey: "2026-06-25",
      status: "running",
      attempts: 2,
      productionWritten: false,
      appliedCount: 0,
      candidateCount: 324,
      retryAllowed: true,
      progressiveLock: {
        exists: true,
        status: "stale-cleared",
        path: "data/inventory/state/smokingpipes-progressive-daily.lock",
        ageMs: 18000000,
        cleared: true,
        reason: "stale-age",
      },
    },
    state: {
      source: "smokingpipes",
      listSnapshotStatus: "complete",
      pagesScanned: 107,
      expectedPages: 107,
      candidates: [],
    },
    audit: {
      verdict: "PASS",
      candidateCount: 324,
      wouldApplyCount: 0,
      productionWritten: false,
      blockers: [],
      warnings: [],
    },
  });
assert.equal(staleClearedProgressiveLockReport.status, "stale-lock-cleared");
assert.equal(
  staleClearedProgressiveLockReport.progressiveLock.cleared,
  true
);
assert.match(
  buildPushDeerDailyMessage(staleClearedProgressiveLockReport).body,
  /已清理过期任务锁|宸叉竻鐞嗚繃鏈熶换鍔￠攣/
);

const staleClearedInventoryLockReport = buildSmokingpipesDailyMobileReport({
  runAt: "2026-06-25T05:12:00.000Z",
  taskState: {
    source: "smokingpipes",
    dateKey: "2026-06-25",
    status: "running",
    attempts: 3,
    productionWritten: false,
    appliedCount: 0,
    candidateCount: 324,
    retryAllowed: true,
    inventoryLocks: {
      checked: true,
      hasActiveLock: false,
      activeLocks: [],
      clearedLocks: [
        {
          name: "global",
          path: "data/inventory/state/smokingpipes.lock",
          status: "cleared",
          reason: "process-not-found",
        },
      ],
      locks: [
        {
          name: "global",
          path: "data/inventory/state/smokingpipes.lock",
          status: "cleared",
          reason: "process-not-found",
        },
      ],
    },
  },
  state: {
    source: "smokingpipes",
    listSnapshotStatus: "complete",
    pagesScanned: 107,
    expectedPages: 107,
    candidates: [],
  },
  audit: {
    verdict: "PASS",
    candidateCount: 324,
    wouldApplyCount: 0,
    productionWritten: false,
    blockers: [],
    warnings: [],
  },
});
assert.equal(staleClearedInventoryLockReport.status, "stale-lock-cleared");
assert.equal(
  staleClearedInventoryLockReport.statusLabel,
  "已清理过期任务锁，继续执行"
);
assert.equal(
  staleClearedInventoryLockReport.reason,
  "检测到上一次任务遗留 lock，已自动清理。"
);
assert.match(
  buildPushDeerDailyMessage(staleClearedInventoryLockReport).body,
  /已清理过期任务锁/
);

const terminalTaskReport = buildSmokingpipesDailyMobileReport({
  runAt: "2026-06-25T04:10:00.000Z",
  taskState: {
    source: "smokingpipes",
    dateKey: "2026-06-25",
    status: "terminal-failed",
    attempts: 1,
    lastFailureAt: "2026-06-25T04:10:00.000Z",
    lastFailureReason: "安全审计未通过: zeroPriceSellable > 0",
    lastFailureType: "audit",
    productionWritten: false,
    appliedCount: 0,
    candidateCount: 324,
    retryAllowed: false,
    nextRetryRecommendedAt: null,
  },
  state: { source: "smokingpipes", candidates: [] },
  audit: {
    verdict: "FAIL",
    candidateCount: 324,
    wouldApplyCount: 324,
    productionWritten: false,
    blockers: ["zeroPriceSellable > 0"],
    warnings: [],
  },
});
assert.equal(terminalTaskReport.status, "terminal-failed");
assert.equal(terminalTaskReport.retryAllowed, false);
assert.equal(terminalTaskReport.failureType, "audit");
const terminalTaskMessage = buildPushDeerDailyMessage(terminalTaskReport);
assert.match(terminalTaskMessage.body, /结论：更新失败，已停止重试/);
assert.match(terminalTaskMessage.body, /下一步：\n人工检查 audit report/);

const skippedSuccessReport = buildSmokingpipesDailyMobileReport({
  runAt: "2026-06-25T06:30:00.000Z",
  taskState: {
    source: "smokingpipes",
    dateKey: "2026-06-25",
    status: "skipped-success",
    attempts: 2,
    lastSuccessAt: "2026-06-25T04:00:00.000Z",
    productionWritten: true,
    appliedCount: 324,
    candidateCount: 324,
    retryAllowed: false,
  },
  state: { source: "smokingpipes", candidates: [] },
  audit: {
    verdict: "PASS",
    candidateCount: 324,
    wouldApplyCount: 324,
    productionWritten: true,
    blockers: [],
    warnings: [],
  },
});
assert.equal(skippedSuccessReport.status, "skipped-success");
assert.equal(skippedSuccessReport.todayAlreadySucceeded, true);
assert.equal(shouldSendDailyMobileNotification(skippedSuccessReport, { send: true }), false);
const skippedSuccessMessage = buildPushDeerDailyMessage(skippedSuccessReport);
assert.match(skippedSuccessMessage.body, /结论：已跳过/);
assert.match(skippedSuccessMessage.body, /今天已经成功更新/);

const mobileReportRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "smokingpipes-mobile-report-")
);
const mobileStatePath = path.join(
  mobileReportRoot,
  "smokingpipes-progressive-daily-state.json"
);
const mobileAuditPath = path.join(
  mobileReportRoot,
  "smokingpipes-progressive-partial-audit-report.json"
);
const mobileLogPath = path.join(
  mobileReportRoot,
  "smokingpipes-daily-task-latest.log"
);
const mobileJsonPath = path.join(
  mobileReportRoot,
  "smokingpipes-daily-mobile-report.json"
);
const mobileMarkdownPath = path.join(
  mobileReportRoot,
  "smokingpipes-daily-mobile-report.md"
);
fs.writeFileSync(
  mobileStatePath,
  JSON.stringify({
    source: "smokingpipes",
    listSnapshotStatus: "complete",
    pagesScanned: 107,
    expectedPages: 107,
    candidates: [],
  }),
  "utf8"
);
fs.writeFileSync(
  mobileAuditPath,
  JSON.stringify({
    verdict: "PASS",
    candidateCount: 0,
    wouldApplyCount: 0,
    productionWritten: false,
    blockers: [],
    warnings: [],
  }),
  "utf8"
);
fs.writeFileSync(
  mobileLogPath,
  "DAILY TASK FAILED: Smokingpipes strong verification detected.",
  "utf8"
);
await runSmokingpipesDailyMobileReport({
  argv: [],
  statePath: mobileStatePath,
  auditPath: mobileAuditPath,
  taskStatePath: path.join(mobileReportRoot, "missing-task-state.json"),
  taskLogPath: mobileLogPath,
  reportJsonPath: mobileJsonPath,
  reportMarkdownPath: mobileMarkdownPath,
  now: "2026-06-25T03:10:00.000Z",
});
const mobileMarkdownBuffer = fs.readFileSync(mobileMarkdownPath);
assert.equal(mobileMarkdownBuffer[0], 0xef);
assert.equal(mobileMarkdownBuffer[1], 0xbb);
assert.equal(mobileMarkdownBuffer[2], 0xbf);
assert.match(mobileMarkdownBuffer.toString("utf8"), /结论：需要人工验证/);
assert.doesNotMatch(mobileMarkdownBuffer.toString("utf8"), /public ready|public review-only|public not-public/);

const mobileTaskStatePath = path.join(
  mobileReportRoot,
  "smokingpipes-daily-task-state.json"
);
const mobileLockJsonPath = path.join(
  mobileReportRoot,
  "smokingpipes-daily-mobile-report-lock.json"
);
const mobileLockMarkdownPath = path.join(
  mobileReportRoot,
  "smokingpipes-daily-mobile-report-lock.md"
);
const mobileLockLogPath = path.join(
  mobileReportRoot,
  "smokingpipes-daily-task-latest-lock.log"
);
fs.writeFileSync(mobileLockLogPath, "DAILY TASK FAILED: lock", "utf8");
fs.writeFileSync(
  mobileTaskStatePath,
  JSON.stringify(
    {
      source: "smokingpipes",
      dateKey: "2026-06-25",
      status: "retryable-failed",
      attempts: 4,
      lastFailureReason:
        "Error: Inventory automation is already running. Lock: C:\\Users\\NING MEI\\Desktop\\pipewebsite\\data\\inventory\\state\\smokingpipes.lock.",
      lastFailureType: "lock",
      productionWritten: false,
      appliedCount: 0,
      candidateCount: 324,
      retryAllowed: true,
      nextRetryRecommendedAt: "2026-06-25T09:00:00.000Z",
      inventoryLocks: {
        checked: true,
        hasActiveLock: true,
        activeLocks: [
          {
            name: "global",
            path: "data/inventory/state/smokingpipes.lock",
            status: "active",
            reason: "active-pid",
          },
        ],
        clearedLocks: [],
        locks: [],
      },
    },
    null,
    2
  ),
  "utf8"
);
await runSmokingpipesDailyMobileReport({
  argv: [],
  statePath: mobileStatePath,
  auditPath: mobileAuditPath,
  taskLogPath: mobileLockLogPath,
  taskStatePath: mobileTaskStatePath,
  reportJsonPath: mobileLockJsonPath,
  reportMarkdownPath: mobileLockMarkdownPath,
  now: "2026-06-25T08:00:00.000Z",
});
const mobileLockJsonText = fs.readFileSync(mobileLockJsonPath, "utf8");
assert.match(mobileLockJsonText, /库存任务正在运行，等待下一轮/);
assert.match(mobileLockJsonText, /检测到已有 Smokingpipes 库存任务锁/);
assert.doesNotMatch(mobileLockJsonText, /锟|鐑|鏇|搴撳瓨|浠诲姟/);

const utf16LogPath = path.join(
  mobileReportRoot,
  "smokingpipes-daily-task-latest-utf16.log"
);
const utf16MarkdownPath = path.join(
  mobileReportRoot,
  "smokingpipes-daily-mobile-report-utf16.md"
);
const utf16JsonPath = path.join(
  mobileReportRoot,
  "smokingpipes-daily-mobile-report-utf16.json"
);
fs.writeFileSync(
  utf16LogPath,
  Buffer.from(
    "\ufeff2026-06-25 DAILY TASK FAILED: Smokingpipes strong verification detected. Complete it in the opened browser within 30 minutes.",
    "utf16le"
  )
);
const utf16ReportResult = await runSmokingpipesDailyMobileReport({
  argv: [],
  statePath: mobileStatePath,
  auditPath: mobileAuditPath,
  taskLogPath: utf16LogPath,
  reportJsonPath: utf16JsonPath,
  reportMarkdownPath: utf16MarkdownPath,
  now: "2026-06-25T03:20:00.000Z",
});
assert.equal(utf16ReportResult.report.status, "blocked");
assert.equal(utf16ReportResult.report.blockers.length, 1);
assert.doesNotMatch(utf16ReportResult.report.blockers[0], /\u0000/);
assert.match(
  utf16ReportResult.report.blockers[0],
  /strong verification detected/i
);

const mixedLogPath = path.join(
  mobileReportRoot,
  "smokingpipes-daily-task-latest-mixed.log"
);
const mixedMarkdownPath = path.join(
  mobileReportRoot,
  "smokingpipes-daily-mobile-report-mixed.md"
);
const mixedJsonPath = path.join(
  mobileReportRoot,
  "smokingpipes-daily-mobile-report-mixed.json"
);
fs.writeFileSync(
  mixedLogPath,
  Buffer.concat([
    Buffer.from("2026-06-25 START current-list\n", "utf8"),
    Buffer.from("Launching browser channel: chrome\n".repeat(80), "utf16le"),
    Buffer.from(
      "2026-06-25 DAILY TASK FAILED: Smokingpipes strong verification detected. Complete it in the opened browser within 30 minutes.",
      "utf8"
    ),
  ])
);
const mixedReportResult = await runSmokingpipesDailyMobileReport({
  argv: [],
  statePath: mobileStatePath,
  auditPath: mobileAuditPath,
  taskLogPath: mixedLogPath,
  reportJsonPath: mixedJsonPath,
  reportMarkdownPath: mixedMarkdownPath,
  now: "2026-06-25T03:25:00.000Z",
});
assert.equal(mixedReportResult.report.status, "blocked");
assert.equal(mixedReportResult.report.blockers.length, 1);
assert.doesNotMatch(mixedReportResult.report.blockers[0], /\u0000/);
assert.match(
  mixedReportResult.report.blockers[0],
  /strong verification detected/i
);
assert.equal(
  isDirectCliInvocation({
    importMetaUrl: pathToFileURL(
      path.join(process.cwd(), "scripts", "inventory", "smokingpipes-daily-mobile-report-v1.mjs")
    ).href,
    argv1: path.join(
      process.cwd(),
      "scripts",
      "inventory",
      "smokingpipes-daily-mobile-report-v1.mjs"
    ),
  }),
  true
);

const dailyTaskScriptPath = path.join(
  process.cwd(),
  "scripts",
  "inventory",
  "run-smokingpipes-progressive-daily.ps1"
);
const manualFullReconcileScriptPath = path.join(
  process.cwd(),
  "scripts",
  "inventory",
  "run-smokingpipes-manual-full-reconcile-v1.ps1"
);
assert.equal(
  fs.existsSync(manualFullReconcileScriptPath),
  true,
  "manual full reconcile PowerShell entry must exist"
);
const manualFullReconcileScript = fs.readFileSync(
  manualFullReconcileScriptPath,
  "utf8"
);
assert.match(manualFullReconcileScript, /\[switch\]\$PlanOnly/);
assert.match(manualFullReconcileScript, /\[switch\]\$RebuildState/);
assert.match(manualFullReconcileScript, /\[switch\]\$RepairState/);
assert.match(manualFullReconcileScript, /\[switch\]\$PromoteNextBatch/);
assert.match(
  manualFullReconcileScript,
  /\[switch\]\$RepairDetailSoldFalsePositives/
);
assert.match(
  manualFullReconcileScript,
  /\[ValidateRange\(1,\s*30\)\][\s\S]*\$DetailMax\s*=\s*30/
);
assert.match(
  manualFullReconcileScript,
  /plan-only/
);
assert.match(
  manualFullReconcileScript,
  /rebuild-state[\s\S]*--state-backup=/
);
assert.match(
  manualFullReconcileScript,
  /repair-state/
);
assert.match(
  manualFullReconcileScript,
  /promote-next-batch/
);
assert.match(
  manualFullReconcileScript,
  /repair-detail-sold-false-positives/
);
assert.match(
  manualFullReconcileScript,
  /State repair: enabled/
);
assert.match(
  manualFullReconcileScript,
  /Promote next batch: enabled/
);
assert.match(
  manualFullReconcileScript,
  /Detail sold false-positive repair: enabled/
);
assert.ok(
  manualFullReconcileScript.indexOf("Copy-Item") <
    manualFullReconcileScript.indexOf("& node"),
  "state backup must happen before the rebuild Node process"
);
assert.match(
  manualFullReconcileScript,
  /RefreshSnapshot[\s\S]*disabled for this phase/i
);
assert.match(
  manualFullReconcileScript,
  /fetch-detail-batch/
);
assert.match(
  manualFullReconcileScript,
  /--browser-channel=chrome/
);
assert.match(
  manualFullReconcileScript,
  /--browser-profile=sp-chrome/
);
assert.match(
  manualFullReconcileScript,
  /--allow-manual-verification=true/
);
assert.match(
  manualFullReconcileScript,
  /Current-list refresh: disabled/
);
assert.match(
  manualFullReconcileScript,
  /Daily task: disabled/
);
assert.doesNotMatch(
  manualFullReconcileScript,
  /FetchDetailBatch[\s\S]*reserved for a later manual online phase/i
);
assert.match(
  manualFullReconcileScript,
  /ApplySafeSubset[\s\S]*offline phase/i
);
assert.match(
  manualFullReconcileScript,
  /WriteProduction[\s\S]*ApplySafeSubset/
);
assert.doesNotMatch(
  manualFullReconcileScript,
  /run-smokingpipes-progressive-daily\.ps1/
);
const dailyTaskScript = fs.readFileSync(dailyTaskScriptPath, "utf8");
assert.match(dailyTaskScript, /function Clear-StaleProgressiveApplyReports/);
assert.ok(
  dailyTaskScript.indexOf("Clear-StaleProgressiveApplyReports") <
    dailyTaskScript.indexOf('StepName "current-list"'),
  "stale progressive apply reports must be cleared before current-list starts"
);
assert.match(
  dailyTaskScript,
  /System\.Text\.UTF8Encoding\s*\(\s*\$false\s*\)/
);
assert.doesNotMatch(
  dailyTaskScript,
  /Set-Content\s+-Path\s+\$DailyTaskStatePath\s+-Encoding\s+UTF8/
);
assert.match(dailyTaskScript, /-FailureType\s+"current-list"/);
assert.match(dailyTaskScript, /-DetailPhaseStatus\s+"not-started"/);

function extractPowerShellFunction(source, functionName) {
  const match = source.match(
    new RegExp(`function ${functionName} \\{[\\s\\S]*?^\\}`, "m")
  );
  assert.ok(match, `missing PowerShell function ${functionName}`);
  return match[0];
}

const invokeInventoryNodeFunction = extractPowerShellFunction(
  dailyTaskScript,
  "Invoke-InventoryNode"
);
assert.doesNotMatch(invokeInventoryNodeFunction, /Tee-Object/);
assert.match(
  invokeInventoryNodeFunction,
  /\$nodeOutput\s*=\s*@\(& node @Arguments 2>&1\)/
);
assert.match(invokeInventoryNodeFunction, /\$exitCode\s*=\s*\[int\]\$LASTEXITCODE/);
assert.match(invokeInventoryNodeFunction, /return \[int\]\$exitCode/);

const convertInventoryNodeOutputFunction = extractPowerShellFunction(
  dailyTaskScript,
  "ConvertFrom-InventoryNodeOutput"
);
const detailPhaseCanContinueFunction = extractPowerShellFunction(
  dailyTaskScript,
  "Test-DetailPhaseCanContinue"
);
const retryWindowReadyFunction = extractPowerShellFunction(
  dailyTaskScript,
  "Test-RetryWindowReady"
);

const powerShellHarnessRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "inventory-node-return-test-")
);
const fakeNodePath = path.join(powerShellHarnessRoot, "node.cmd");
const harnessLogPath = path.join(powerShellHarnessRoot, "daily.log");
fs.writeFileSync(
  fakeNodePath,
  [
    "@echo off",
    "echo Launching browser channel: chrome",
    "echo {",
    'echo   \"status\": \"no-eligible-candidates\",',
    'echo   \"productionWritten\": false',
    "echo }",
    "exit /b 0",
    "",
  ].join("\r\n"),
  "utf8"
);
const escapedHarnessLogPath = harnessLogPath.replace(/'/g, "''");
const powerShellHarness = [
  '$ErrorActionPreference = "Stop"',
  `$LogPath = '${escapedHarnessLogPath}'`,
  "function Write-DailyLog { param([string]$Message); Write-Output $Message }",
  convertInventoryNodeOutputFunction,
  invokeInventoryNodeFunction,
  detailPhaseCanContinueFunction,
  retryWindowReadyFunction,
  '$detailExit = Invoke-InventoryNode -StepName "progressive-detail-chunk" -Arguments @("fake") -ContinueOnFailure',
  "$detailStatus = [string]$script:LastInventoryNodeResult.status",
  "$now = [datetime]'2026-07-03T22:30:02+08:00'",
  "$withinGrace = [datetime]'2026-07-03T22:30:07+08:00'",
  "$outsideGrace = [datetime]'2026-07-03T22:32:00+08:00'",
  "[pscustomobject]@{",
  "  exitType = $detailExit.GetType().Name",
  "  exitCode = $detailExit",
  "  detailStatus = $detailStatus",
  "  canContinue = Test-DetailPhaseCanContinue -ExitCode $detailExit -Status $detailStatus",
  "  graceAllowed = Test-RetryWindowReady -RecommendedAt $withinGrace -Now $now",
  "  tooEarlyBlocked = -not (Test-RetryWindowReady -RecommendedAt $outsideGrace -Now $now)",
  "} | ConvertTo-Json -Compress",
].join("\r\n");
const powerShellHarnessResult = spawnSync(
  "powershell.exe",
  ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", powerShellHarness],
  {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${powerShellHarnessRoot}${path.delimiter}${process.env.PATH || ""}`,
    },
  }
);
assert.equal(
  powerShellHarnessResult.status,
  0,
  powerShellHarnessResult.stderr || powerShellHarnessResult.stdout
);
const harnessJsonLine = powerShellHarnessResult.stdout
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .at(-1);
const harnessResult = JSON.parse(harnessJsonLine);
assert.equal(harnessResult.exitType, "Int32");
assert.equal(harnessResult.exitCode, 0);
assert.equal(harnessResult.detailStatus, "no-eligible-candidates");
assert.equal(harnessResult.canContinue, true);
assert.equal(harnessResult.graceAllowed, true);
assert.equal(harnessResult.tooEarlyBlocked, true);

const noEligibleCandidatesReport = buildSmokingpipesDailyMobileReport({
  runAt: "2026-07-03T20:30:07.000+08:00",
  taskState: {
    source: "smokingpipes",
    dateKey: "2026-07-03",
    status: "running",
    attempts: 2,
    productionWritten: false,
    appliedCount: 0,
    candidateCount: 324,
    retryAllowed: true,
    detailPhaseStatus: "no-eligible-candidates",
    cachedListResume: {
      enabled: true,
      lockedUntilComplete: true,
      completed: false,
      completedAt: null,
      allowNextListFetch: false,
    },
    currentList: {
      status: "reused",
      reused: true,
      skippedFetch: true,
      pagesScanned: 107,
      expectedPages: 107,
    },
  },
  state: {
    source: "smokingpipes",
    listSnapshotStatus: "complete",
    pagesScanned: 107,
    expectedPages: 107,
    candidates: [],
  },
  audit: {
    verdict: "PASS",
    candidateCount: 324,
    wouldApplyCount: 324,
    productionWritten: false,
    blockers: [],
    warnings: [],
  },
  taskLogText: [
    "START progressive-detail-chunk",
    '{"status":"no-eligible-candidates","productionWritten":false}',
    "EXIT progressive-detail-chunk 0",
    "DETAIL chunk complete: no eligible candidates remain",
    "CONTINUE candidate/apply transition",
  ].join("\n"),
});
assert.equal(noEligibleCandidatesReport.status, "detail-complete");
assert.equal(
  noEligibleCandidatesReport.statusLabel,
  "详情队列已完成，正在进入候选应用"
);
assert.equal(noEligibleCandidatesReport.failureType, null);
assert.equal(noEligibleCandidatesReport.cachedListResume.completed, false);
assert.equal(noEligibleCandidatesReport.cachedListResume.allowNextListFetch, false);
const noEligibleCandidatesMessage = buildPushDeerDailyMessage(
  noEligibleCandidatesReport
);
assert.match(
  noEligibleCandidatesMessage.body,
  /结论：详情队列已完成，正在进入候选应用/
);
assert.match(
  noEligibleCandidatesMessage.body,
  /源站扫描：未重新抓取，复用已有完整列表快照/
);
assert.match(
  noEligibleCandidatesMessage.body,
  /详情抓取：当前没有待抓取详情/
);
assert.match(noEligibleCandidatesMessage.body, /下一步：\n执行 candidate\/audit\/apply/);
assert.doesNotMatch(noEligibleCandidatesMessage.body, /详情抓取失败|安全审计/);

const cachedResumeAuditBlockedReport = buildSmokingpipesDailyMobileReport({
  runAt: "2026-07-03T20:31:00.000+08:00",
  taskState: {
    source: "smokingpipes",
    dateKey: "2026-07-03",
    status: "terminal-failed",
    attempts: 2,
    lastFailureReason: "安全审计未通过，已停止自动重试",
    lastFailureType: "audit",
    productionWritten: false,
    appliedCount: 0,
    candidateCount: 324,
    retryAllowed: false,
    detailPhaseStatus: "no-eligible-candidates",
    cachedListResume: {
      enabled: true,
      lockedUntilComplete: true,
      completed: false,
      completedAt: null,
      allowNextListFetch: false,
    },
  },
  state: {
    source: "smokingpipes",
    listSnapshotStatus: "complete",
    pagesScanned: 107,
    expectedPages: 107,
    candidates: [],
  },
  audit: {
    verdict: "FAIL",
    candidateCount: 324,
    wouldApplyCount: 324,
    productionWritten: false,
    blockers: ["zeroPriceSellable > 0"],
    warnings: [],
  },
});
assert.equal(cachedResumeAuditBlockedReport.status, "terminal-failed");
assert.equal(cachedResumeAuditBlockedReport.failureType, "audit");
assert.equal(cachedResumeAuditBlockedReport.cachedListResume.completed, false);
assert.equal(
  cachedResumeAuditBlockedReport.cachedListResume.allowNextListFetch,
  false
);
assert.equal(cachedResumeAuditBlockedReport.statusLabel, "更新失败，已停止重试");
assert.match(cachedResumeAuditBlockedReport.nextStep, /audit report/);
const cachedResumeAuditBlockedMessage = buildPushDeerDailyMessage(
  cachedResumeAuditBlockedReport
);
assert.match(cachedResumeAuditBlockedMessage.body, /zeroPriceSellable > 0/);
assert.doesNotMatch(
  cachedResumeAuditBlockedMessage.body,
  /详情队列已完成，正在进入候选应用/
);

assert.match(
  dailyTaskScript,
  /DETAIL chunk complete: no eligible candidates remain/
);
assert.match(dailyTaskScript, /CONTINUE candidate\/apply transition/);
assert.match(dailyTaskScript, /retry window grace applied/);
assert.match(
  dailyTaskScript,
  /productionWritten[\s\S]*Set-CachedListResumeFromCache[\s\S]*-Completed \$true/
);
assert.match(
  dailyTaskScript,
  /StepName "progressive-prepare-apply"/
);
assert.match(dailyTaskScript, /--mode=progressive-prepare-apply/);
assert.match(
  dailyTaskScript,
  /progressive prepare apply gate blocked:[\s\S]*-Status "safety-gate-blocked"[\s\S]*-FailureType "audit"[\s\S]*-CachedListResume \$script:CachedListResumeState/
);
assert.doesNotMatch(dailyTaskScript, /function Test-AuditAllowsProductionWrite/);
assert.match(
  dailyTaskScript,
  /StepName "detail-queue-spike-guard"/
);
assert.match(
  dailyTaskScript,
  /detail queue spike guard blocked[\s\S]*-Status "manual-review-required"[\s\S]*-FailureType "detail-queue-spike"[\s\S]*-RetryAllowed \$false/
);
assert.ok(
  dailyTaskScript.indexOf(
    'StepName "progressive-ingest-list"'
  ) <
    dailyTaskScript.indexOf(
      'StepName "detail-queue-spike-guard"'
    )
);
assert.ok(
  dailyTaskScript.indexOf(
    'StepName "detail-queue-spike-guard"'
  ) <
    dailyTaskScript.indexOf(
      'StepName "progressive-detail-chunk"'
    )
);
assert.ok(
  dailyTaskScript.indexOf('StepName "progressive-detail-chunk"') <
    dailyTaskScript.indexOf('StepName "progressive-prepare-apply"')
);
assert.ok(
  dailyTaskScript.indexOf('StepName "progressive-prepare-apply"') <
    dailyTaskScript.indexOf('StepName "progressive-partial-apply"')
);
const cachedListSkipBranch = dailyTaskScript.match(
  /if \(\$script:SkipCurrentListEffective -eq \$true\) \{[\s\S]*?^\s*\} elseif \(\$currentListCache\.usable -eq \$true\)/m
)?.[0];
assert.ok(cachedListSkipBranch, "cached-list skip branch must exist");
assert.doesNotMatch(cachedListSkipBranch, /StepName "current-list"/);
assert.doesNotMatch(cachedListSkipBranch, /START current-list/);
assert.doesNotMatch(cachedListSkipBranch, /fetching page 1\/107/);
const runInventoryAutomationScript = fs.readFileSync(
  path.join(
    process.cwd(),
    "scripts",
    "inventory",
    "run-inventory-automation-v1.mjs"
  ),
  "utf8"
);
assert.match(
  runInventoryAutomationScript,
  /productionWritten:\s*result\.productionWritten\s*===\s*true/
);
assert.match(
  runInventoryAutomationScript,
  /appliedCount:\s*result\.partialAppliedCount\s*\|\|\s*0/
);
assert.match(dailyTaskScript, /\[switch\]\$PreflightOnly/);
assert.match(dailyTaskScript, /\[switch\]\$ForceRunOnce/);
assert.match(dailyTaskScript, /\[switch\]\$SkipCurrentList/);
assert.match(dailyTaskScript, /\[switch\]\$AllowStaleCurrentListCache/);
assert.match(dailyTaskScript, /\[switch\]\$AllowDuplicateDedupe/);
assert.match(dailyTaskScript, /\[switch\]\$ResumeFromCachedList/);
assert.match(dailyTaskScript, /\[switch\]\$LockCurrentListSnapshotUntilComplete/);
assert.match(dailyTaskScript, /\[switch\]\$SafeBootstrap/);
assert.match(dailyTaskScript, /\[switch\]\$NoProductionWrite/);
assert.match(
  dailyTaskScript,
  /\$ProjectRoot\s*=\s*\(Resolve-Path \(Join-Path \$PSScriptRoot "\.\.\\\.\."\)\)\.Path/
);
assert.match(dailyTaskScript, /YAN_DOUBUY_FORCE_RUN_ONCE/);
assert.match(dailyTaskScript, /YAN_DOUBUY_SKIP_CURRENT_LIST/);
assert.match(dailyTaskScript, /YAN_DOUBUY_ALLOW_STALE_CURRENT_LIST_CACHE/);
assert.match(dailyTaskScript, /YAN_DOUBUY_RESUME_FROM_CACHED_LIST/);
assert.match(
  dailyTaskScript,
  /YANDOUBUY_SMOKINGPIPES_DAILY_NO_PRODUCTION_WRITE/
);
assert.match(
  dailyTaskScript,
  /YAN_DOUBUY_LOCK_CURRENT_LIST_SNAPSHOT_UNTIL_COMPLETE/
);
assert.match(dailyTaskScript, /smokingpipes-daily-recovery-preflight-v1\.mjs/);
assert.match(dailyTaskScript, /--preflight-only/);
assert.match(dailyTaskScript, /--force-run-once/);
assert.match(dailyTaskScript, /--allow-duplicate-dedupe/);
assert.match(dailyTaskScript, /--allow-stale/);
assert.match(dailyTaskScript, /--allow-duplicate-dedupe/);
assert.match(dailyTaskScript, /SKIP current-list fetch/);
assert.match(dailyTaskScript, /PREFLIGHT ready: continuing recovery execution/);
assert.match(
  dailyTaskScript,
  /SKIP current-list: using manual recovery current-list cache/
);
assert.match(
  dailyTaskScript,
  /PREFLIGHT ready: continuing cached-list detail resume/
);
assert.match(dailyTaskScript, /SKIP current-list: using cached list snapshot/);
assert.match(
  dailyTaskScript,
  /CACHED-LIST snapshot locked until detail\/apply complete/
);
assert.match(dailyTaskScript, /START detail from cached-list resume/);
assert.match(
  dailyTaskScript,
  /CACHED-LIST resume lock active: skip current-list until current snapshot is complete/
);
assert.match(
  dailyTaskScript,
  /Blocked: cached-list resume is active; current-list fetch is forbidden until snapshot is complete\./
);
assert.match(dailyTaskScript, /cachedListResume/);
assert.match(dailyTaskScript, /allowNextListFetch/);
assert.match(dailyTaskScript, /Read-RecoveryPreflightReport/);
assert.match(dailyTaskScript, /Get-RecoveryPreflightBlockReason/);
assert.match(dailyTaskScript, /preflightOutput\s*=\s*& node @preflightArgs/);
assert.match(dailyTaskScript, /return \[int\]\$exitCode/);
assert.match(dailyTaskScript, /overall\.status[\s\S]*ready/);
assert.match(dailyTaskScript, /overall\.canRun/);
assert.match(dailyTaskScript, /willFetchCurrentList/);
assert.match(dailyTaskScript, /currentListCache\.usable/);
assert.match(dailyTaskScript, /smokingpipes-daily-task-state\.json/);
assert.match(dailyTaskScript, /smokingpipes-daily-task-lock\.json/);
assert.match(dailyTaskScript, /smokingpipes\.lock/);
assert.match(dailyTaskScript, /smokingpipes-progressive-daily\.lock/);
assert.match(dailyTaskScript, /smokingpipes-inventory-lock-v1\.mjs/);
assert.match(dailyTaskScript, /smokingpipes-progressive-lock-v1\.mjs/);
assert.match(dailyTaskScript, /smokingpipes-current-list-cache-v1\.mjs/);
assert.match(dailyTaskScript, /REUSE current-list cache/);
assert.match(dailyTaskScript, /current-list cache not reusable/);
assert.match(dailyTaskScript, /currentList/);
assert.match(dailyTaskScript, /inventoryLocks/);
assert.match(dailyTaskScript, /progressiveLock/);
assert.match(dailyTaskScript, /CHECK inventory locks/);
assert.match(dailyTaskScript, /CLEARED stale inventory lock/);
assert.match(dailyTaskScript, /SKIP because inventory lock is active/);
assert.match(dailyTaskScript, /CHECK progressive lock/);
assert.match(dailyTaskScript, /CLEARED stale progressive lock/);
assert.match(dailyTaskScript, /SKIP because progressive lock is active/);
assert.match(dailyTaskScript, /active-skip/);
assert.match(dailyTaskScript, /stale-cleared/);
assert.match(dailyTaskScript, /-Status\s+"reused"/);
assert.match(dailyTaskScript, /-Status\s+"fetched"/);
assert.match(dailyTaskScript, /retryable-failed/);
assert.match(dailyTaskScript, /terminal-failed/);
assert.match(dailyTaskScript, /manual-review-required/);
assert.match(dailyTaskScript, /safety-gate-blocked/);
assert.match(dailyTaskScript, /skipped-success/);
assert.match(dailyTaskScript, /AddHours\(-4\)|LockStaleHours\s*=\s*4/);
assert.match(dailyTaskScript, /nextRetryRecommendedAt/);
assert.match(dailyTaskScript, /progressive-detail-max=30/);
const safeBootstrapBranch = dailyTaskScript.match(
  /if \(\$script:NoProductionWriteEffective -eq \$true\) \{[\s\S]*?^\s*\}/m
)?.[0];
assert.ok(safeBootstrapBranch, "safe bootstrap branch must exist");
assert.match(
  safeBootstrapBranch,
  /safe bootstrap mode: production write skipped/
);
assert.match(safeBootstrapBranch, /-Status "safe-bootstrap-complete"/);
assert.match(safeBootstrapBranch, /-ProductionWritten \$false/);
assert.match(safeBootstrapBranch, /-CandidateCount \$prepareCandidateCount/);
assert.match(
  safeBootstrapBranch,
  /-IsolatedCandidateCount \$prepareIsolatedCandidateCount/
);
assert.doesNotMatch(safeBootstrapBranch, /--write-production/);
assert.doesNotMatch(
  safeBootstrapBranch,
  /StepName "progressive-partial-apply"/
);
assert.ok(
  dailyTaskScript.indexOf(
    'if ($script:NoProductionWriteEffective -eq $true)'
  ) <
    dailyTaskScript.indexOf('StepName "progressive-partial-apply"')
);
assert.match(
  dailyTaskScript,
  /smokingpipes-daily-mobile-report-v1\.mjs[\s\S]*--send/
);
assert.match(dailyTaskScript, /--write-production/);
assert.match(dailyTaskScript, /auditStatus/);
assert.match(dailyTaskScript, /candidateCount/);
const detailProgressStart = dailyTaskScript.indexOf(
  "if ($detailPendingRemaining -gt 0)"
);
const detailProgressEnd = dailyTaskScript.indexOf(
  'Write-DailyLog "CONTINUE candidate/apply transition"'
);
const detailProgressBranch =
  detailProgressStart >= 0 && detailProgressEnd > detailProgressStart
    ? dailyTaskScript.slice(detailProgressStart, detailProgressEnd)
    : "";
assert.ok(
  detailProgressBranch,
  "pending details must exit as detail-progress before prepare-apply"
);
assert.match(detailProgressBranch, /-Status "detail-progress"/);
assert.match(detailProgressBranch, /-ProductionWritten \$false/);
assert.match(detailProgressBranch, /-RetryAllowed \$true/);
assert.match(detailProgressBranch, /ResumeFromCachedListEffective = \$true/);
assert.match(detailProgressBranch, /LockCurrentListSnapshotUntilCompleteEffective = \$true/);
assert.match(detailProgressBranch, /Set-CachedListResumeFromCache -Cache \$currentListCache -Completed \$false/);
assert.doesNotMatch(
  detailProgressBranch,
  /StepName "progressive-prepare-apply"/
);
assert.ok(
  dailyTaskScript.indexOf("$detailPendingRemaining -gt 0") <
    dailyTaskScript.indexOf('StepName "progressive-prepare-apply"')
);
assert.match(
  dailyTaskScript,
  /Set-CachedListResumeFromCache -Cache \$currentListCache -Completed \$true/
);
assert.doesNotMatch(dailyTaskScript, /\bgit\s+commit\b/i);
assert.doesNotMatch(dailyTaskScript, /\bgit\s+push\b/i);
assert.doesNotMatch(dailyTaskScript, /\bvercel\b/i);
assert.doesNotMatch(dailyTaskScript, /\bnpm(?:\.cmd)?\s+run\s+deploy\b/i);

const installDailyTaskScriptPath = path.join(
  process.cwd(),
  "scripts",
  "inventory",
  "install-smokingpipes-daily-task-v1.ps1"
);
assert.equal(fs.existsSync(installDailyTaskScriptPath), true);
const installDailyTaskScript = fs.readFileSync(installDailyTaskScriptPath, "utf8");
assert.match(installDailyTaskScript, /YandouBuy Smokingpipes Daily Update/);
assert.match(installDailyTaskScript, /New-ScheduledTaskTrigger[\s\S]*-Daily[\s\S]*-At\s+"10:30"/);
assert.match(installDailyTaskScript, /-RepetitionInterval\s+\(New-TimeSpan\s+-Hours\s+2\)/);
assert.match(installDailyTaskScript, /-RepetitionDuration\s+\(New-TimeSpan\s+-Hours\s+12\)/);
assert.doesNotMatch(installDailyTaskScript, /Repetition\.Interval/);
assert.doesNotMatch(installDailyTaskScript, /Repetition\.Duration/);
for (const time of ["10:30", "12:30", "14:30", "16:30", "18:30", "20:30", "22:30"]) {
  assert.match(installDailyTaskScript, new RegExp(`-At\\s+"${time}"`));
}
assert.match(installDailyTaskScript, /WakeToRun\s*=\s*\$true/);
assert.doesNotMatch(installDailyTaskScript, /-ExecutionTimeLimit/);
assert.doesNotMatch(installDailyTaskScript, /\$settings\.ExecutionTimeLimit/);
assert.doesNotMatch(installDailyTaskScript, /03:00:00/);
assert.doesNotMatch(installDailyTaskScript, /PT3H/);
assert.match(installDailyTaskScript, /AllowStartIfOnBatteries/);
assert.match(installDailyTaskScript, /DontStopIfGoingOnBatteries/);
assert.match(installDailyTaskScript, /MultipleInstances[\s\S]*IgnoreNew/);
assert.match(installDailyTaskScript, /run-smokingpipes-progressive-daily\.ps1/);
assert.doesNotMatch(installDailyTaskScript, /\bgit\s+push\b/i);
assert.doesNotMatch(installDailyTaskScript, /\bgit\s+commit\b/i);

console.log("Inventory runner core tests passed.");
