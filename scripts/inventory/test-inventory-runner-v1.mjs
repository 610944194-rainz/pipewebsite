import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
import { processSmokingpipesDetailsQueue } from "./smokingpipes-details-queue-v1.mjs";
import {
  classifySmokingpipesVerificationSignals,
  summarizeSmokingpipesListProducts,
} from "../lib/smokingpipes-utils.mjs";

const defaults = parseRunnerOptions([]);
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

console.log("Inventory runner core tests passed.");
