export const PUBLIC_INDEX_PERFORMANCE_BUDGETS = Object.freeze({
  catalogAverageRecordMaxBytes: 1300,
  catalogMaxRecordBytes: 4000,
  lookupMaxBytes: 2 * 1024 * 1024,
  brandsMaxBytes: 2 * 1024 * 1024,
  filtersMaxBytes: 1 * 1024 * 1024,
  detailShardMaxBytes: 3 * 1024 * 1024,
});

function configuredAbsoluteCap(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("PUBLIC_CATALOG_ABSOLUTE_MAX_BYTES must be a positive integer when configured.");
  }
  return parsed;
}

export function evaluatePublicIndexPerformanceBudgets({
  performance,
  expectedCatalogCount,
  absoluteCatalogMaxBytes = process.env.PUBLIC_CATALOG_ABSOLUTE_MAX_BYTES,
}) {
  const count = Number(expectedCatalogCount);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("expectedCatalogCount must be a non-negative integer.");
  }

  const absoluteCap = configuredAbsoluteCap(absoluteCatalogMaxBytes);
  const averageRecordLimit =
    PUBLIC_INDEX_PERFORMANCE_BUDGETS.catalogAverageRecordMaxBytes;
  const effectiveCatalogMaxBytes =
    absoluteCap ?? count * averageRecordLimit;

  return {
    effectiveCatalogMaxBytes,
    budgetBasis: absoluteCap
      ? "configured-absolute-cap"
      : "expected-catalog-count-x-average-record-limit",
    expectedCatalogCount: count,
    averageRecordLimit,
    absoluteCapConfigured: absoluteCap !== null,
    configuredAbsoluteCatalogMaxBytes: absoluteCap,
    checks: {
      catalogMaxBytes:
        performance.catalogBytes <= effectiveCatalogMaxBytes,
      catalogAverageRecordMaxBytes:
        performance.catalogAverageRecordBytes <= averageRecordLimit,
      catalogMaxRecordBytes:
        performance.catalogMaxRecordBytes <=
        PUBLIC_INDEX_PERFORMANCE_BUDGETS.catalogMaxRecordBytes,
      lookupMaxBytes:
        performance.lookupBytes <=
        PUBLIC_INDEX_PERFORMANCE_BUDGETS.lookupMaxBytes,
      brandsMaxBytes:
        performance.brandsBytes <=
        PUBLIC_INDEX_PERFORMANCE_BUDGETS.brandsMaxBytes,
      filtersMaxBytes:
        performance.filtersBytes <=
        PUBLIC_INDEX_PERFORMANCE_BUDGETS.filtersMaxBytes,
      detailShardMaxBytes:
        performance.detailMaxShardBytes <=
        PUBLIC_INDEX_PERFORMANCE_BUDGETS.detailShardMaxBytes,
    },
  };
}
