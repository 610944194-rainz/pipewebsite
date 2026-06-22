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
} from "./smokingpipes-fetch-current-list-v1.mjs";
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
  resolveSmokingpipesBrowserLaunch,
  summarizeSmokingpipesListProducts,
} from "../lib/smokingpipes-utils.mjs";
import { buildUnifiedProductsFromInputs } from "../build-unified-products-staging-v1.mjs";
import {
  buildPublicProductsCandidate,
  loadPublicProductsPricingContext,
} from "../build-public-product-indexes-v1.mjs";

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
  captchaCooldownMs: 0,
});
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
assert.equal(explicitChallengePage.classification, "verification");

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

console.log("Inventory runner core tests passed.");
