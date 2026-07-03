import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_SMOKINGPIPES_CURRENT_LIST_CACHE_PATH = path.join(
  process.cwd(),
  "data",
  "inventory",
  "smokingpipes-current-list-dry-run.json"
);

const EXPECTED_SMOKINGPIPES_LIST_PAGES = 107;

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function dateKeyFromDate(value) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function pickFirstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function normalizeComparable(value) {
  return String(value ?? "").trim();
}

function productComparableFields(product) {
  return {
    sourceUrl: normalizeComparable(product?.sourceUrl || product?.url),
    title: normalizeComparable(product?.title || product?.name),
    price: normalizeComparable(
      pickFirstDefined(product?.priceRaw, product?.priceAmount, product?.price)
    ),
    inventoryStatus: normalizeComparable(
      product?.inventoryStatus || product?.status || product?.rawStatusText
    ),
  };
}

function analyzeDuplicateProducts(products, duplicateSourceProductIdsFromField = []) {
  const productGroups = new Map();
  for (const product of products) {
    const id = normalizeComparable(product?.sourceProductId);
    if (!id) continue;
    if (!productGroups.has(id)) {
      productGroups.set(id, []);
    }
    productGroups.get(id).push(product);
  }

  const duplicateIdsFromField = new Set(
    duplicateSourceProductIdsFromField.map(normalizeComparable).filter(Boolean)
  );
  const duplicateIdsFromRecords = new Set();
  for (const [id, records] of productGroups) {
    if (records.length > 1) duplicateIdsFromRecords.add(id);
  }

  const duplicateSamples = [...duplicateIdsFromRecords].slice(0, 20).map((id) => {
    const records = productGroups.get(id) || [];
    const comparableRecords = records.map(productComparableFields);
    const first = comparableRecords[0] || {};
    const sameUrl = comparableRecords.every(
      (item) => item.sourceUrl === first.sourceUrl
    );
    const sameTitle = comparableRecords.every((item) => item.title === first.title);
    const samePrice = comparableRecords.every((item) => item.price === first.price);
    const sameInventoryStatus = comparableRecords.every(
      (item) => item.inventoryStatus === first.inventoryStatus
    );
    const conflict =
      records.length > 1 &&
      (!sameUrl || !sameTitle || !samePrice || !sameInventoryStatus);
    return {
      sourceProductId: id,
      count: records.length,
      sameUrl,
      sameTitle,
      samePrice,
      sameInventoryStatus,
      conflict,
      records: records.slice(0, 3),
    };
  });

  const conflictDuplicateIdCount = duplicateSamples.filter(
    (sample) => sample.conflict
  ).length;
  const duplicateIdCountFromField = duplicateIdsFromField.size;
  const duplicateIdCountFromRecords = duplicateIdsFromRecords.size;
  const duplicateIdCount = duplicateIdCountFromRecords;
  const warnings = [];

  if (duplicateIdCountFromField > 0 && duplicateIdCountFromRecords === 0) {
    warnings.push(
      "duplicateSourceProductIds metadata is present, but no duplicate records were found"
    );
  }

  return {
    duplicateSourceProductIds: [...duplicateIdsFromRecords],
    duplicateSourceProductIdsFromField: [...duplicateIdsFromField],
    duplicateSourceProductIdsFromRecords: [...duplicateIdsFromRecords],
    duplicateIdCount,
    duplicateIdCountFromField,
    duplicateIdCountFromRecords,
    duplicateSamples,
    dedupeRequired: duplicateIdCountFromRecords > 0,
    dedupeSafe:
      duplicateIdCountFromRecords === 0 || conflictDuplicateIdCount === 0,
    conflictDuplicateIdCount,
    warnings,
  };
}

function summarizeCurrentListPayload(payload) {
  const summary = payload?.summary && typeof payload.summary === "object"
    ? payload.summary
    : {};
  const products = Array.isArray(payload?.products) ? payload.products : [];
  const sourceProductIds = products
    .map((product) => product?.sourceProductId)
    .filter(Boolean);
  const computedUniqueProducts = new Set(sourceProductIds).size;
  const computedDuplicateSourceProductIds = [
    ...sourceProductIds.reduce((map, id) => {
      map.set(id, (map.get(id) || 0) + 1);
      return map;
    }, new Map()),
  ]
    .filter(([, count]) => count > 1)
    .map(([id]) => id);

  const duplicateSourceProductIds = toArray(
    pickFirstDefined(
      summary.duplicateSourceProductIds,
      payload?.duplicateSourceProductIds,
      computedDuplicateSourceProductIds
    )
  );
  const duplicateInfo = analyzeDuplicateProducts(
    products,
    duplicateSourceProductIds
  );

  return {
    generatedAt: pickFirstDefined(summary.generatedAt, payload?.generatedAt),
    completedAt: pickFirstDefined(summary.completedAt, payload?.completedAt),
    pagesScanned: toNumber(
      pickFirstDefined(summary.pagesScanned, payload?.pagesScanned)
    ),
    expectedPages: toNumber(
      pickFirstDefined(
        summary.expectedPages,
        payload?.expectedPages,
        summary.pagesRequested,
        payload?.pagesRequested
      )
    ),
    productsExtracted: toNumber(
      pickFirstDefined(
        summary.productsExtracted,
        payload?.productsExtracted,
        products.length
      )
    ),
    uniqueProducts: toNumber(
      pickFirstDefined(
        summary.uniqueProducts,
        payload?.uniqueProducts,
        computedUniqueProducts || products.length
      )
    ),
    duplicateSourceProductIds: duplicateInfo.duplicateSourceProductIds,
    duplicateSourceProductIdsFromField:
      duplicateInfo.duplicateSourceProductIdsFromField,
    duplicateSourceProductIdsFromRecords:
      duplicateInfo.duplicateSourceProductIdsFromRecords,
    duplicateIdCount: duplicateInfo.duplicateIdCount,
    duplicateIdCountFromField: duplicateInfo.duplicateIdCountFromField,
    duplicateIdCountFromRecords: duplicateInfo.duplicateIdCountFromRecords,
    duplicateSamples: duplicateInfo.duplicateSamples,
    dedupeRequired: duplicateInfo.dedupeRequired,
    dedupeSafe: duplicateInfo.dedupeSafe,
    conflictDuplicateIdCount: duplicateInfo.conflictDuplicateIdCount,
    warnings: duplicateInfo.warnings,
    captchaDetected: Boolean(
      pickFirstDefined(summary.captchaDetected, payload?.captchaDetected, false)
    ),
    captchaPages: toArray(
      pickFirstDefined(summary.captchaPages, payload?.captchaPages, [])
    ),
    verificationDetectedAt: pickFirstDefined(
      summary.verificationDetectedAt,
      payload?.verificationDetectedAt,
      null
    ),
    completeRequestedRange: Boolean(
      pickFirstDefined(
        summary.completeRequestedRange,
        payload?.completeRequestedRange,
        false
      )
    ),
    fullExpectedRangeScanned: Boolean(
      pickFirstDefined(
        summary.fullExpectedRangeScanned,
        payload?.fullExpectedRangeScanned,
        false
      )
    ),
  };
}

function buildResult({
  usable,
  reason,
  currentListPath,
  dateKey,
  summary = {},
  stale = false,
  manualRecovery = false,
  safety = null,
}) {
  return {
    usable,
    reason,
    path: currentListPath,
    stale,
    manualRecovery,
    safety:
      safety ||
      {
        soldByAbsenceAllowed: usable && !stale,
        disappearedApplyAllowed: usable && !stale,
      },
    pagesScanned: toNumber(summary.pagesScanned),
    expectedPages: toNumber(summary.expectedPages),
    productsExtracted: toNumber(summary.productsExtracted),
    uniqueProducts: toNumber(summary.uniqueProducts),
    duplicateIdCount: toNumber(summary.duplicateIdCount),
    duplicateIdCountFromField: toNumber(summary.duplicateIdCountFromField),
    duplicateIdCountFromRecords: toNumber(summary.duplicateIdCountFromRecords),
    duplicateSamples: toArray(summary.duplicateSamples),
    dedupeRequired: Boolean(summary.dedupeRequired),
    dedupeSafe: summary.dedupeSafe !== false,
    conflictDuplicateIdCount: toNumber(summary.conflictDuplicateIdCount),
    warnings: toArray(summary.warnings),
    dateKey: dateKey || null,
    completedAt: summary.completedAt || summary.generatedAt || null,
  };
}

export function evaluateSmokingpipesCurrentListCache({
  currentListPath = DEFAULT_SMOKINGPIPES_CURRENT_LIST_CACHE_PATH,
  now = new Date(),
  allowStale = false,
  allowDuplicateDedupe = false,
  fsImpl = fs,
} = {}) {
  if (!fsImpl.existsSync(currentListPath)) {
    return buildResult({
      usable: false,
      reason: "missing",
      currentListPath,
    });
  }

  let stat;
  try {
    stat = fsImpl.statSync(currentListPath);
  } catch {
    return buildResult({
      usable: false,
      reason: "missing",
      currentListPath,
    });
  }

  let payload;
  try {
    payload = JSON.parse(fsImpl.readFileSync(currentListPath, "utf8"));
  } catch {
    return buildResult({
      usable: false,
      reason: "invalid-json",
      currentListPath,
    });
  }

  const summary = summarizeCurrentListPayload(payload);
  const currentDateKey = dateKeyFromDate(now);
  const generatedDateKey = dateKeyFromDate(
    summary.generatedAt || summary.completedAt || stat.mtime
  );

  if (
    summary.pagesScanned !== EXPECTED_SMOKINGPIPES_LIST_PAGES ||
    summary.expectedPages !== EXPECTED_SMOKINGPIPES_LIST_PAGES ||
    summary.pagesScanned !== summary.expectedPages ||
    summary.completeRequestedRange !== true ||
    summary.fullExpectedRangeScanned !== true
  ) {
    return buildResult({
      usable: false,
      reason: "incomplete",
      currentListPath,
      dateKey: generatedDateKey,
      summary,
    });
  }

  if (summary.captchaDetected || summary.captchaPages.length > 0) {
    return buildResult({
      usable: false,
      reason: "captcha",
      currentListPath,
      dateKey: generatedDateKey,
      summary,
    });
  }

  if (summary.verificationDetectedAt) {
    return buildResult({
      usable: false,
      reason: "verification",
      currentListPath,
      dateKey: generatedDateKey,
      summary,
    });
  }

  if (summary.productsExtracted <= 0 || summary.uniqueProducts <= 0) {
    return buildResult({
      usable: false,
      reason: "empty-products",
      currentListPath,
      dateKey: generatedDateKey,
      summary,
    });
  }

  if (summary.duplicateIdCount > 0 && summary.conflictDuplicateIdCount > 0) {
    return buildResult({
      usable: false,
      reason: "duplicate-id-conflict",
      currentListPath,
      dateKey: generatedDateKey,
      summary,
    });
  }

  if (summary.duplicateIdCount > 0 && !allowDuplicateDedupe) {
    return buildResult({
      usable: false,
      reason: "duplicate-ids",
      currentListPath,
      dateKey: generatedDateKey,
      summary,
    });
  }

  const stale = generatedDateKey !== currentDateKey;

  if (stale && !allowStale) {
    return buildResult({
      usable: false,
      reason: "stale",
      currentListPath,
      dateKey: generatedDateKey,
      summary,
      stale: true,
    });
  }

  if (stale && allowStale) {
    return buildResult({
      usable: true,
      reason: "complete stale current-list cache allowed by manual recovery",
      currentListPath,
      dateKey: generatedDateKey,
      summary,
      stale: true,
      manualRecovery: true,
      safety: {
        soldByAbsenceAllowed: false,
        disappearedApplyAllowed: false,
      },
    });
  }

  return buildResult({
    usable: true,
    reason: "complete current-list cache from today",
    currentListPath,
    dateKey: generatedDateKey,
    summary,
  });
}

function parseCliArgs(argv) {
  const options = {};

  for (const arg of argv) {
    if (arg.startsWith("--path=")) {
      options.currentListPath = arg.slice("--path=".length);
    } else if (arg === "--allow-stale") {
      options.allowStale = true;
    } else if (arg === "--allow-duplicate-dedupe") {
      options.allowDuplicateDedupe = true;
    }
  }

  return options;
}

export function isDirectCliInvocation({
  importMetaUrl = import.meta.url,
  argv1 = process.argv[1],
} = {}) {
  return Boolean(argv1) && importMetaUrl === pathToFileURL(argv1).href;
}

if (isDirectCliInvocation()) {
  const result = evaluateSmokingpipesCurrentListCache(
    parseCliArgs(process.argv.slice(2))
  );
  console.log(JSON.stringify(result, null, 2));
}
