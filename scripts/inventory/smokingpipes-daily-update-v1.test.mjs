import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSmokingpipesAdaptiveScanPlan,
} from "./smokingpipes-fetch-current-list-v1.mjs";
import {
  buildSmokingpipesDailyDiff,
  shouldPrepareDailyDetailsQueue,
} from "./smokingpipes-daily-update-v1.mjs";

function currentList({
  safetyMaxPages,
  expectedPages,
  pagesCompleted = expectedPages,
  failedPages = [],
  fullExpectedRangeScanned = failedPages.length === 0,
  lastSuccessfulPage = pagesCompleted,
  products = [],
}) {
  return {
    config: {
      requestedMaxPages: safetyMaxPages,
      maxPages: safetyMaxPages,
      expectedPages,
    },
    summary: {
      pagesRequested: safetyMaxPages,
      pagesScanned: pagesCompleted,
      pagesCompleted,
      effectiveScannedPages: pagesCompleted,
      expectedPages,
      failedPages,
      lastSuccessfulPage,
      fullExpectedRangeScanned,
      captchaDetected: false,
    },
    products,
  };
}

function dailyDiffFor(currentPayload) {
  return buildSmokingpipesDailyDiff({
    productionProducts: [],
    currentPayload,
  });
}

test("a safety ceiling of 200 accepts 104 dynamically detected completed pages", () => {
  const plan = buildSmokingpipesAdaptiveScanPlan({
    requestedMaxPages: 200,
    expectedPages: 200,
    detectedTotalPages: 104,
    detectionConfidence: "high",
  });
  const diff = dailyDiffFor(
    currentList({ safetyMaxPages: 200, expectedPages: 104 })
  );

  assert.equal(plan.expectedPages, 104);
  assert.equal(plan.effectiveLastPageToVisit, 104);
  assert.equal(plan.pagesToVisit.length, 104);
  assert.equal(diff.coverage.fullExpectedRangeScanned, true);
  assert.equal(shouldPrepareDailyDetailsQueue(diff), true);
});

test("a safety ceiling of 107 accepts 104 dynamically detected completed pages", () => {
  const plan = buildSmokingpipesAdaptiveScanPlan({
    requestedMaxPages: 107,
    expectedPages: 107,
    detectedTotalPages: 104,
    detectionConfidence: "high",
  });
  const diff = dailyDiffFor(
    currentList({ safetyMaxPages: 107, expectedPages: 104 })
  );

  assert.equal(plan.expectedPages, 104);
  assert.equal(plan.effectiveLastPageToVisit, 104);
  assert.equal(diff.allowApply, true);
  assert.equal(shouldPrepareDailyDetailsQueue(diff), true);
});

test("a failed page inside the dynamic expected range blocks detail and apply", () => {
  const diff = dailyDiffFor(
    currentList({
      safetyMaxPages: 200,
      expectedPages: 104,
      pagesCompleted: 103,
      failedPages: [90],
      fullExpectedRangeScanned: false,
      lastSuccessfulPage: 104,
    })
  );

  assert.equal(diff.coverage.fullExpectedRangeScanned, false);
  assert.equal(diff.coverage.pagesFailed, 1);
  assert.equal(diff.allowApply, false);
  assert.equal(shouldPrepareDailyDetailsQueue(diff), false);
});

test("a dynamically detected 110-page list is not capped at 107", () => {
  const plan = buildSmokingpipesAdaptiveScanPlan({
    requestedMaxPages: 200,
    expectedPages: 200,
    detectedTotalPages: 110,
    detectionConfidence: "high",
  });

  assert.equal(plan.expectedPages, 110);
  assert.equal(plan.effectiveLastPageToVisit, 110);
  assert.equal(plan.pagesToVisit.at(-1), 110);
});

test("out-of-stock and missing-price pages remain valid list coverage", () => {
  const diff = dailyDiffFor(
    currentList({
      safetyMaxPages: 200,
      expectedPages: 104,
      products: [
        {
          sourceProductId: "oos-1",
          sourceUrl: "https://example.invalid/oos-1",
          title: "Out of stock item",
          price: "",
          rawListStatus: "Out of Stock",
        },
      ],
    })
  );

  assert.equal(diff.coverage.fullExpectedRangeScanned, true);
  assert.equal(diff.allowApply, true);
  assert.equal(shouldPrepareDailyDetailsQueue(diff), true);
});
