import assert from "node:assert/strict";

import {
  evaluatePublicIndexPerformanceBudgets,
} from "./lib/public-index-performance-budget-v1.mjs";

const basePerformance = {
  catalogBytes: 10_495_126,
  catalogAverageRecordBytes: 1220.93,
  catalogMaxRecordBytes: 1541,
  lookupBytes: 1_000_000,
  brandsBytes: 500_000,
  filtersBytes: 250_000,
  detailMaxShardBytes: 500_000,
};

const currentCatalog = evaluatePublicIndexPerformanceBudgets({
  performance: basePerformance,
  expectedCatalogCount: 8596,
});
assert.equal(currentCatalog.checks.catalogMaxBytes, true);
assert.equal(currentCatalog.effectiveCatalogMaxBytes, 8596 * 1300);
assert.equal(currentCatalog.budgetBasis, "expected-catalog-count-x-average-record-limit");
assert.equal(currentCatalog.absoluteCapConfigured, false);

const grownCatalog = evaluatePublicIndexPerformanceBudgets({
  performance: {
    ...basePerformance,
    catalogBytes: 12_200_000,
    catalogAverageRecordBytes: 1220,
  },
  expectedCatalogCount: 10_000,
});
assert.equal(grownCatalog.checks.catalogMaxBytes, true);

const oversizedAverage = evaluatePublicIndexPerformanceBudgets({
  performance: { ...basePerformance, catalogAverageRecordBytes: 1300.01 },
  expectedCatalogCount: 8596,
});
assert.equal(oversizedAverage.checks.catalogAverageRecordMaxBytes, false);

const oversizedRecord = evaluatePublicIndexPerformanceBudgets({
  performance: { ...basePerformance, catalogMaxRecordBytes: 4001 },
  expectedCatalogCount: 8596,
});
assert.equal(oversizedRecord.checks.catalogMaxRecordBytes, false);

for (const [field, value] of [
  ["lookupBytes", 2 * 1024 * 1024 + 1],
  ["brandsBytes", 2 * 1024 * 1024 + 1],
  ["filtersBytes", 1024 * 1024 + 1],
  ["detailMaxShardBytes", 3 * 1024 * 1024 + 1],
]) {
  const result = evaluatePublicIndexPerformanceBudgets({
    performance: { ...basePerformance, [field]: value },
    expectedCatalogCount: 8596,
  });
  const checkName = {
    lookupBytes: "lookupMaxBytes",
    brandsBytes: "brandsMaxBytes",
    filtersBytes: "filtersMaxBytes",
    detailMaxShardBytes: "detailShardMaxBytes",
  }[field];
  assert.equal(result.checks[checkName], false, `${checkName} must remain blocking`);
}

const configuredCap = evaluatePublicIndexPerformanceBudgets({
  performance: basePerformance,
  expectedCatalogCount: 8596,
  absoluteCatalogMaxBytes: 10_000_000,
});
assert.equal(configuredCap.checks.catalogMaxBytes, false);
assert.equal(configuredCap.effectiveCatalogMaxBytes, 10_000_000);
assert.equal(configuredCap.budgetBasis, "configured-absolute-cap");
assert.equal(configuredCap.absoluteCapConfigured, true);

console.log("public index performance budget tests: PASS");
