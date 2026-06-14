import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import {
  REFERENCE_PRICE_COMMON_CONFIG,
  calculateSmokingpipesReferencePrice,
} from "../lib/pricing/reference-price.mjs";

const ROOT = process.cwd();
const GENERATED_ROOT = path.join(ROOT, "data", "generated", "public-products");
const REVIEW_DIR = path.join(ROOT, "data", "review");
const BASELINE_FILE = path.join(
  REVIEW_DIR,
  "smokingpipes-rmb-pricing-phase1-baseline-v1.json"
);

const INPUTS = {
  exchangeRates: path.join(ROOT, "data", "exchange-rates.ts"),
  smokingpipesPricing: path.join(ROOT, "data", "pricing", "smokingpipes-pricing.json"),
  catalog: path.join(GENERATED_ROOT, "catalog.json"),
  lookup: path.join(GENERATED_ROOT, "detail-lookup.json"),
  brands: path.join(GENERATED_ROOT, "brands.json"),
  filters: path.join(GENERATED_ROOT, "filters.json"),
  manifest: path.join(GENERATED_ROOT, "manifest.json"),
  baseline: BASELINE_FILE,
  presentation: path.join(ROOT, "lib", "public-products", "presentation.ts"),
  query: path.join(ROOT, "lib", "public-products", "query.ts"),
};

const OUTPUTS = {
  json: path.join(REVIEW_DIR, "smokingpipes-rmb-pricing-v1.json"),
  markdown: path.join(REVIEW_DIR, "smokingpipes-rmb-pricing-v1.md"),
};

const EXPECTED = {
  catalogCount: 6872,
  danishCount: 2121,
  smokingpipesCount: 4751,
  brandCount: 169,
  detailShardCount: 64,
  detailRecordCount: 6872,
  exchangeRate: {
    effectiveMonth: "2026-06",
    basisDate: "2026-05-20",
    USD: 6.8397,
  },
  fixedExamples: [
    {
      label: "Peterson Reg 146.00",
      brandName: "Peterson",
      sourcePriceAmount: 146,
      expected: {
        phase1SiteDisplayAmount: 1379.437868,
        purchasePriceUsd: 138.7,
        shippingUsd: 6,
        taxableProductCostCny: 1138.399668,
        shippingCny: 41.0382,
        baseCostCny: 1179.437868,
        serviceFeeCny: 200,
        domesticShippingCny:
          REFERENCE_PRICE_COMMON_CONFIG.domesticShippingCny,
        siteDisplayAmount:
          1379.437868 + REFERENCE_PRICE_COMMON_CONFIG.domesticShippingCny,
        displayCeil: Math.ceil(
          1379.437868 + REFERENCE_PRICE_COMMON_CONFIG.domesticShippingCny
        ),
      },
    },
    {
      label: "Savinelli Reg 192.00",
      brandName: "Savinelli",
      sourcePriceAmount: 192,
      expected: {
        phase1SiteDisplayAmount: 1871.0820114,
        purchasePriceUsd: 182.4,
        shippingUsd: 19,
        taxableProductCostCny: 1497.073536,
        shippingCny: 129.9543,
        baseCostCny: 1627.027836,
        serviceFeeCny: 244.0541754,
        domesticShippingCny:
          REFERENCE_PRICE_COMMON_CONFIG.domesticShippingCny,
        siteDisplayAmount:
          1871.0820114 + REFERENCE_PRICE_COMMON_CONFIG.domesticShippingCny,
        displayCeil: Math.ceil(
          1871.0820114 + REFERENCE_PRICE_COMMON_CONFIG.domesticShippingCny
        ),
      },
    },
    {
      label: "Dunhill Reg 775.00",
      brandName: "Dunhill",
      sourcePriceAmount: 775,
      expected: {
        phase1SiteDisplayAmount: 6689.7395775,
        purchasePriceUsd: 658.75,
        shippingUsd: 60,
        taxableProductCostCny: 5406.78285,
        shippingCny: 410.382,
        baseCostCny: 5817.16485,
        serviceFeeCny: 872.5747275,
        domesticShippingCny:
          REFERENCE_PRICE_COMMON_CONFIG.domesticShippingCny,
        siteDisplayAmount:
          6689.7395775 + REFERENCE_PRICE_COMMON_CONFIG.domesticShippingCny,
        displayCeil: Math.ceil(
          6689.7395775 + REFERENCE_PRICE_COMMON_CONFIG.domesticShippingCny
        ),
      },
    },
    {
      label: "Normal brand Reg 100.00",
      brandName: "Missouri Meerschaum",
      sourcePriceAmount: 100,
      expected: {
        phase1SiteDisplayAmount: 1061.8022,
        purchasePriceUsd: 100,
        shippingUsd: 6,
        taxableProductCostCny: 820.764,
        shippingCny: 41.0382,
        baseCostCny: 861.8022,
        serviceFeeCny: 200,
        domesticShippingCny:
          REFERENCE_PRICE_COMMON_CONFIG.domesticShippingCny,
        siteDisplayAmount:
          1061.8022 + REFERENCE_PRICE_COMMON_CONFIG.domesticShippingCny,
        displayCeil: Math.ceil(
          1061.8022 + REFERENCE_PRICE_COMMON_CONFIG.domesticShippingCny
        ),
      },
    },
  ],
  shippingBoundaries: [
    { sourcePriceAmount: 149.99, brandName: "Other", expectedShippingUsd: 6 },
    { sourcePriceAmount: 150, brandName: "Other", expectedShippingUsd: 19 },
    { sourcePriceAmount: 399.99, brandName: "Other", expectedShippingUsd: 19 },
    { sourcePriceAmount: 400, brandName: "Other", expectedShippingUsd: 60 },
  ],
};

const FLOAT_TOLERANCE = 1e-9;

function requiredText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function stableCompare(left, right) {
  return requiredText(left).localeCompare(requiredText(right), "en", {
    numeric: true,
    sensitivity: "base",
  });
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => stableCompare(a, b))
        .map(([key, entry]) => [key, stableValue(entry)])
    );
  }
  return value;
}

function stableJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fsSync.readFileSync(filePath)).digest("hex").toUpperCase();
}

function isPositiveFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function approxEqual(left, right, tolerance = FLOAT_TOLERANCE) {
  if (left === null || right === null) return left === right;
  return typeof left === "number" && typeof right === "number" && Math.abs(left - right) <= tolerance;
}

async function readExchangeRateMetadata(filePath) {
  const source = await fs.readFile(filePath, "utf8");
  const effectiveMonth = source.match(/effectiveMonth:\s*"([^"]+)"/)?.[1] || null;
  const basisDate = source.match(/basisDate:\s*"([^"]+)"/)?.[1] || null;
  const usdRateText = source.match(/USD:\s*([0-9.]+)/)?.[1] || "";
  const usdToCny = Number.parseFloat(usdRateText);

  return {
    effectiveMonth,
    basisDate,
    rates: {
      USD: Number.isFinite(usdToCny) ? usdToCny : null,
    },
  };
}

function countBy(items, getter) {
  const counts = new Map();
  for (const item of items) {
    const key = requiredText(getter(item)) || "(missing)";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => stableCompare(a, b)));
}

function setEqual(left, right) {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function priceAuditForProduct(product, exchangeRates, pricingConfig) {
  const reference = calculateSmokingpipesReferencePrice({
    sourcePriceAmount: product.sourcePriceAmount,
    brandName: product.brandName,
    usdToCny: exchangeRates.rates.USD,
    pricingConfig,
  });
  return {
    id: product.id,
    sourceProductId: product.sourceProductId,
    canonicalBrand: product.brandName,
    regUsd: product.sourcePriceAmount,
    discountRate: reference.brandDiscountRate,
    purchaseUsd: reference.purchasePriceUsd,
    shippingTierUsd: reference.shippingUsd,
    shippingUsd: reference.shippingUsd,
    customsRate: pricingConfig.taxFactor,
    taxableProductCostCny: reference.taxableProductCostCny,
    shippingCny: reference.shippingCny,
    baseCostCny: reference.baseCostCny,
    serviceFeeCny: reference.serviceFeeCny,
    domesticShippingCny: reference.domesticShippingCny,
    phase1RmbReference:
      reference.siteDisplayAmount === null
        ? null
        : reference.siteDisplayAmount - reference.domesticShippingCny,
    rmbReference: reference.siteDisplayAmount,
    displayCeil: reference.siteDisplayAmount === null ? null : Math.ceil(reference.siteDisplayAmount),
  };
}

function pickSamples(smokingpipesProducts, exchangeRates, pricingConfig) {
  const groups = {
    Peterson: smokingpipesProducts.filter((product) => product.brandName === "Peterson"),
    Savinelli: smokingpipesProducts.filter((product) => product.brandName === "Savinelli"),
    Dunhill: smokingpipesProducts.filter((product) => product.brandName === "Dunhill"),
    other: smokingpipesProducts.filter(
      (product) => !["Peterson", "Savinelli", "Dunhill"].includes(product.brandName)
    ),
  };

  return Object.fromEntries(
    Object.entries(groups).map(([group, products]) => [
      group,
      products
        .slice()
        .sort((a, b) => stableCompare(a.id, b.id))
        .slice(0, 10)
        .map((product) => priceAuditForProduct(product, exchangeRates, pricingConfig)),
    ])
  );
}

function validateFixedExamples(exchangeRates, pricingConfig) {
  return EXPECTED.fixedExamples.map((example) => {
    const actual = calculateSmokingpipesReferencePrice({
      sourcePriceAmount: example.sourcePriceAmount,
      brandName: example.brandName,
      usdToCny: exchangeRates.rates.USD,
      pricingConfig,
    });
    const actualValues = {
      phase1SiteDisplayAmount: actual.siteDisplayAmount - actual.domesticShippingCny,
      purchasePriceUsd: actual.purchasePriceUsd,
      shippingUsd: actual.shippingUsd,
      taxableProductCostCny: actual.taxableProductCostCny,
      shippingCny: actual.shippingCny,
      baseCostCny: actual.baseCostCny,
      serviceFeeCny: actual.serviceFeeCny,
      domesticShippingCny: actual.domesticShippingCny,
      siteDisplayAmount: actual.siteDisplayAmount,
      displayCeil: Math.ceil(actual.siteDisplayAmount),
    };
    const checks = Object.fromEntries(
      Object.entries(example.expected).map(([key, expectedValue]) => [
        key,
        approxEqual(actualValues[key], expectedValue),
      ])
    );
    return {
      label: example.label,
      brandName: example.brandName,
      sourcePriceAmount: example.sourcePriceAmount,
      expected: example.expected,
      actual: actualValues,
      passed: Object.values(checks).every(Boolean),
      checks,
    };
  });
}

function validateShippingBoundaries(exchangeRates, pricingConfig) {
  return EXPECTED.shippingBoundaries.map((boundary) => {
    const actual = calculateSmokingpipesReferencePrice({
      sourcePriceAmount: boundary.sourcePriceAmount,
      brandName: boundary.brandName,
      usdToCny: exchangeRates.rates.USD,
      pricingConfig,
    });
    return {
      sourcePriceAmount: boundary.sourcePriceAmount,
      brandName: boundary.brandName,
      expectedShippingUsd: boundary.expectedShippingUsd,
      actualShippingUsd: actual.shippingUsd,
      passed: actual.shippingUsd === boundary.expectedShippingUsd,
    };
  });
}

async function readDetailProducts(manifest) {
  const details = [];
  const shardSummaries = [];
  for (const relativeFile of manifest.detailFiles || []) {
    const shardFile = path.join(ROOT, relativeFile);
    const shard = await readJson(shardFile);
    const products = Array.isArray(shard.products) ? shard.products : [];
    details.push(...products);
    shardSummaries.push({
      shard: shard.shard,
      file: relativeFile,
      productCount: products.length,
      sha256: hashFile(shardFile),
    });
  }
  return { details, shardSummaries };
}

function verifyDomesticShippingDelta(products, baselineById) {
  const mismatchSamples = [];
  const bySource = {};
  let matchedCount = 0;
  let readyCount = 0;
  let cnyCurrencyCount = 0;
  let validAmountCount = 0;
  let sortPriceMatchesCount = 0;
  let maxDeltaError = 0;
  let nonFiniteCount = 0;
  let nonPositiveCount = 0;

  for (const product of products) {
    const baseline = baselineById.get(product.id);
    const source = requiredText(product.source);
    bySource[source] ||= {
      matchedCount: 0,
      delta30Count: 0,
      readyCount: 0,
      cnyCurrencyCount: 0,
      validAmountCount: 0,
      sortPriceMatchesCount: 0,
      maxDeltaError: 0,
    };

    if (!baseline) {
      mismatchSamples.push({ id: product.id, issue: "missing baseline" });
      continue;
    }

    matchedCount += 1;
    bySource[source].matchedCount += 1;

    if (product.siteDisplayReady === true) {
      readyCount += 1;
      bySource[source].readyCount += 1;
    }
    if (product.siteDisplayCurrency === "CNY") {
      cnyCurrencyCount += 1;
      bySource[source].cnyCurrencyCount += 1;
    }
    if (isPositiveFiniteNumber(product.siteDisplayAmount)) {
      validAmountCount += 1;
      bySource[source].validAmountCount += 1;
    } else {
      if (typeof product.siteDisplayAmount === "number" && !Number.isFinite(product.siteDisplayAmount)) {
        nonFiniteCount += 1;
      }
      if (typeof product.siteDisplayAmount !== "number" || product.siteDisplayAmount <= 0) {
        nonPositiveCount += 1;
      }
    }

    if (approxEqual(product.sortKeys?.price, product.siteDisplayAmount)) {
      sortPriceMatchesCount += 1;
      bySource[source].sortPriceMatchesCount += 1;
    }

    const expected =
      baseline.siteDisplayAmount +
      REFERENCE_PRICE_COMMON_CONFIG.domesticShippingCny;
    const deltaError =
      typeof product.siteDisplayAmount === "number" && typeof expected === "number"
        ? Math.abs(product.siteDisplayAmount - expected)
        : Number.POSITIVE_INFINITY;

    maxDeltaError = Math.max(maxDeltaError, deltaError);
    bySource[source].maxDeltaError = Math.max(bySource[source].maxDeltaError, deltaError);

    if (deltaError <= FLOAT_TOLERANCE) {
      bySource[source].delta30Count += 1;
    } else if (mismatchSamples.length < 25) {
      mismatchSamples.push({
        id: product.id,
        source: product.source,
        baselineAmount: baseline.siteDisplayAmount,
        currentAmount: product.siteDisplayAmount,
        expectedAmount: expected,
        deltaError,
      });
    }
  }

  return {
    matchedCount,
    delta30Count: Object.values(bySource).reduce((total, entry) => total + entry.delta30Count, 0),
    readyCount,
    cnyCurrencyCount,
    validAmountCount,
    sortPriceMatchesCount,
    nonFiniteCount,
    nonPositiveCount,
    maxDeltaError,
    bySource,
    mismatchSamples,
    passed:
      matchedCount === EXPECTED.catalogCount &&
      Object.values(bySource).reduce((total, entry) => total + entry.delta30Count, 0) === EXPECTED.catalogCount &&
      readyCount === EXPECTED.catalogCount &&
      cnyCurrencyCount === EXPECTED.catalogCount &&
      validAmountCount === EXPECTED.catalogCount &&
      sortPriceMatchesCount === EXPECTED.catalogCount &&
      nonFiniteCount === 0 &&
      nonPositiveCount === 0 &&
      maxDeltaError <= FLOAT_TOLERANCE,
  };
}

function findPetersonIrishHarpSandblasted3085(catalog) {
  const matches = catalog
    .filter((product) => {
      const title = [
        product.displayName,
        product.displayNameEn,
        product.rawTitle,
      ]
        .filter(Boolean)
        .join(" ");
      return (
        product.source === "smokingpipes" &&
        product.brandName === "Peterson" &&
        /Irish Harp Sandblasted \(3085\)/i.test(title)
      );
    })
    .sort((a, b) => stableCompare(a.id, b.id));

  return {
    count: matches.length,
    products: matches.map((product) => ({
      id: product.id,
      sourceProductId: product.sourceProductId,
      displayName: product.displayName,
      siteDisplayAmount: product.siteDisplayAmount,
      displayCeil: Math.ceil(product.siteDisplayAmount),
    })),
  };
}

function assertReviewOutput(filePath) {
  const resolved = path.resolve(filePath);
  const reviewRoot = path.resolve(REVIEW_DIR);
  if (!resolved.startsWith(`${reviewRoot}${path.sep}`)) {
    throw new Error(`Refusing to write outside data/review: ${filePath}`);
  }
}

async function writeReviewFile(filePath, content) {
  assertReviewOutput(filePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

function makeMarkdown(report) {
  const errors = report.errors.length ? report.errors.map((item) => `- ${item}`).join("\n") : "- none";
  const warnings = report.warnings.length ? report.warnings.map((item) => `- ${item}`).join("\n") : "- none";
  return `# Smokingpipes RMB Pricing Phase 1

Status: ${report.status}

## Domestic Shipping

- shared domestic shipping CNY: ${report.domesticShipping.domesticShippingCny}
- all products delta +${report.domesticShipping.domesticShippingCny}: ${report.domesticShipping.catalogDelta.delta30Count}/${report.counts.catalog}
- Danish delta +${report.domesticShipping.domesticShippingCny}: ${report.domesticShipping.catalogDelta.bySource.danish?.delta30Count ?? 0}/${report.counts.danish}
- Smokingpipes delta +${report.domesticShipping.domesticShippingCny}: ${report.domesticShipping.catalogDelta.bySource.smokingpipes?.delta30Count ?? 0}/${report.counts.smokingpipes}
- detail records delta +${report.domesticShipping.domesticShippingCny}: ${report.domesticShipping.detailDelta.delta30Count}/${report.counts.detailRecords}

## Counts

- catalog products: ${report.counts.catalog}
- Danish products: ${report.counts.danish}
- Smokingpipes products: ${report.counts.smokingpipes}
- brands: ${report.counts.brands}
- detail shards: ${report.counts.detailShards}
- detail records: ${report.counts.detailRecords}

## Pricing

- Smokingpipes ready: ${report.smokingpipesPricing.readyCount}/${report.counts.smokingpipes}
- Smokingpipes CNY currency: ${report.smokingpipesPricing.cnyCurrencyCount}/${report.counts.smokingpipes}
- Smokingpipes valid RMB amount: ${report.smokingpipesPricing.validRmbAmountCount}/${report.counts.smokingpipes}
- fixed examples passed: ${report.fixedExamples.every((item) => item.passed)}
- shipping boundaries passed: ${report.shippingBoundaries.every((item) => item.passed)}

## Peterson Irish Harp Sandblasted (3085)

- matching products: ${report.petersonIrishHarpSandblasted3085.count}
- final first price: ${report.petersonIrishHarpSandblasted3085.products[0]?.siteDisplayAmount ?? "missing"}
- display ceil: ${report.petersonIrishHarpSandblasted3085.products[0]?.displayCeil ?? "missing"}

## Frontend

- no visible USD fallback: ${report.frontendChecks.noVisibleUsdFallback}
- query price order valid: ${report.queryChecks.priceOrderValid}

## Errors

${errors}

## Warnings

${warnings}
`;
}

async function main() {
  const errors = [];
  const warnings = [];

  const [
    catalogFile,
    lookup,
    brandsFile,
    filters,
    manifest,
    baseline,
    exchangeRates,
    pricingConfig,
  ] = await Promise.all([
    readJson(INPUTS.catalog),
    readJson(INPUTS.lookup),
    readJson(INPUTS.brands),
    readJson(INPUTS.filters),
    readJson(INPUTS.manifest),
    readJson(INPUTS.baseline),
    readExchangeRateMetadata(INPUTS.exchangeRates),
    readJson(INPUTS.smokingpipesPricing),
  ]);
  const { details, shardSummaries } = await readDetailProducts(manifest);
  const presentationSource = await fs.readFile(INPUTS.presentation, "utf8");
  const querySource = await fs.readFile(INPUTS.query, "utf8");

  const catalog = Array.isArray(catalogFile.products) ? catalogFile.products : [];
  const baselineProducts = Array.isArray(baseline.products) ? baseline.products : [];
  const baselineById = new Map(baselineProducts.map((product) => [product.id, product]));
  const catalogIds = new Set(catalog.map((product) => product.id));
  const baselineIds = new Set(baselineProducts.map((product) => product.id));
  const detailIds = new Set(details.map((product) => product.id));
  const sourceCounts = countBy(catalog, (product) => product.source);
  const baselineSourceCounts = baseline.counts?.sourceCounts || {};
  const smokingpipesProducts = catalog.filter((product) => product.source === "smokingpipes");
  const danishProducts = catalog.filter((product) => product.source === "danish");
  const detailSmokingpipes = details.filter((product) => product.source === "smokingpipes");
  const catalogDelta = verifyDomesticShippingDelta(catalog, baselineById);
  const detailDelta = verifyDomesticShippingDelta(details, baselineById);

  if (baselineProducts.length !== EXPECTED.catalogCount) {
    errors.push(`Baseline product count mismatch: ${baselineProducts.length}`);
  }
  if (!setEqual(catalogIds, baselineIds)) errors.push("Catalog product ID set changed from Phase 1 baseline.");
  if (!setEqual(catalogIds, detailIds)) errors.push("Detail product ID set does not match catalog.");
  if (catalog.length !== EXPECTED.catalogCount) errors.push(`Catalog count mismatch: ${catalog.length}`);
  if (sourceCounts.danish !== EXPECTED.danishCount) errors.push(`Danish count mismatch: ${sourceCounts.danish}`);
  if (sourceCounts.smokingpipes !== EXPECTED.smokingpipesCount) {
    errors.push(`Smokingpipes count mismatch: ${sourceCounts.smokingpipes}`);
  }
  if (baselineSourceCounts.danish !== EXPECTED.danishCount) {
    errors.push(`Baseline Danish count mismatch: ${baselineSourceCounts.danish}`);
  }
  if (baselineSourceCounts.smokingpipes !== EXPECTED.smokingpipesCount) {
    errors.push(`Baseline Smokingpipes count mismatch: ${baselineSourceCounts.smokingpipes}`);
  }
  if ((brandsFile.brands || []).length !== EXPECTED.brandCount) {
    errors.push(`Brand count mismatch: ${(brandsFile.brands || []).length}`);
  }
  if ((manifest.detailFiles || []).length !== EXPECTED.detailShardCount) {
    errors.push(`Detail shard count mismatch: ${(manifest.detailFiles || []).length}`);
  }
  if (details.length !== EXPECTED.detailRecordCount) errors.push(`Detail record count mismatch: ${details.length}`);
  if (Object.keys(lookup.byId || {}).length !== EXPECTED.catalogCount) errors.push("lookup.byId count mismatch.");
  if (Object.keys(lookup.bySourceProduct || {}).length !== EXPECTED.catalogCount) {
    errors.push("lookup.bySourceProduct count mismatch.");
  }
  if (!catalogDelta.passed) {
    errors.push(
      `Catalog domestic shipping +${REFERENCE_PRICE_COMMON_CONFIG.domesticShippingCny} validation failed.`
    );
  }
  if (!detailDelta.passed) {
    errors.push(
      `Detail domestic shipping +${REFERENCE_PRICE_COMMON_CONFIG.domesticShippingCny} validation failed.`
    );
  }
  if (
    exchangeRates.effectiveMonth !== EXPECTED.exchangeRate.effectiveMonth ||
    exchangeRates.basisDate !== EXPECTED.exchangeRate.basisDate ||
    !approxEqual(exchangeRates.rates.USD, EXPECTED.exchangeRate.USD)
  ) {
    errors.push("Exchange rate metadata mismatch.");
  }

  const smokingpipeFormulaMismatches = [];
  const shippingTierCounts = { "6": 0, "19": 0, "60": 0, "(missing)": 0 };
  let readyCount = 0;
  let cnyCurrencyCount = 0;
  let validRmbAmountCount = 0;
  let validSourcePriceCount = 0;
  let invalidPriceCount = 0;
  let zeroPriceCount = 0;
  let nonFinitePriceCount = 0;

  for (const product of smokingpipesProducts) {
    if (isPositiveFiniteNumber(product.sourcePriceAmount)) validSourcePriceCount += 1;
    else invalidPriceCount += 1;
    if (product.sourcePriceAmount === 0) zeroPriceCount += 1;
    if (typeof product.sourcePriceAmount === "number" && !Number.isFinite(product.sourcePriceAmount)) {
      nonFinitePriceCount += 1;
    }
    if (product.siteDisplayReady) readyCount += 1;
    if (product.siteDisplayCurrency === "CNY") cnyCurrencyCount += 1;
    if (isPositiveFiniteNumber(product.siteDisplayAmount)) validRmbAmountCount += 1;

    const reference = calculateSmokingpipesReferencePrice({
      sourcePriceAmount: product.sourcePriceAmount,
      brandName: product.brandName,
      usdToCny: exchangeRates.rates.USD,
      pricingConfig,
    });
    const tierKey = reference.shippingUsd === null ? "(missing)" : String(reference.shippingUsd);
    shippingTierCounts[tierKey] = (shippingTierCounts[tierKey] || 0) + 1;

    if (
      product.siteDisplayReady !== reference.siteDisplayReady ||
      product.siteDisplayCurrency !== reference.siteDisplayCurrency ||
      !approxEqual(product.siteDisplayAmount, reference.siteDisplayAmount) ||
      !approxEqual(product.sortKeys?.price, reference.siteDisplayAmount)
    ) {
      smokingpipeFormulaMismatches.push(product.id);
    }
  }

  if (validSourcePriceCount !== EXPECTED.smokingpipesCount) {
    errors.push(`Smokingpipes valid source price count mismatch: ${validSourcePriceCount}`);
  }
  if (readyCount !== EXPECTED.smokingpipesCount) errors.push(`Smokingpipes ready count mismatch: ${readyCount}`);
  if (cnyCurrencyCount !== EXPECTED.smokingpipesCount) {
    errors.push(`Smokingpipes CNY currency count mismatch: ${cnyCurrencyCount}`);
  }
  if (validRmbAmountCount !== EXPECTED.smokingpipesCount) {
    errors.push(`Smokingpipes valid RMB amount count mismatch: ${validRmbAmountCount}`);
  }
  if (invalidPriceCount !== 0 || zeroPriceCount !== 0 || nonFinitePriceCount !== 0) {
    errors.push("Smokingpipes invalid source price stats are non-zero.");
  }
  if (smokingpipeFormulaMismatches.length) {
    errors.push(`Smokingpipes formula mismatches: ${smokingpipeFormulaMismatches.slice(0, 10).join(", ")}`);
  }

  for (const detail of detailSmokingpipes) {
    for (const key of ["sourcePriceAmount", "sourcePriceCurrency", "priceRawText", "msrpAmount", "msrpRawText"]) {
      if (!Object.hasOwn(detail, key)) errors.push(`Smokingpipes detail missing original price field ${key}: ${detail.id}`);
    }
  }

  const fixedExamples = validateFixedExamples(exchangeRates, pricingConfig);
  const shippingBoundaries = validateShippingBoundaries(exchangeRates, pricingConfig);
  if (!fixedExamples.every((item) => item.passed)) errors.push("Fixed pricing examples failed.");
  if (!shippingBoundaries.every((item) => item.passed)) errors.push("Shipping boundary examples failed.");

  const brandCounts = {
    Peterson: smokingpipesProducts.filter((product) => product.brandName === "Peterson").length,
    Savinelli: smokingpipesProducts.filter((product) => product.brandName === "Savinelli").length,
    Dunhill: smokingpipesProducts.filter((product) => product.brandName === "Dunhill").length,
    other: smokingpipesProducts.filter(
      (product) => !["Peterson", "Savinelli", "Dunhill"].includes(product.brandName)
    ).length,
  };
  for (const [group, count] of Object.entries(brandCounts)) {
    if (count < 10) errors.push(`Not enough ${group} samples: ${count}`);
  }

  const priceFormatterBlock = presentationSource.match(/export function formatSitePrice[\s\S]*?\n}\n/)?.[0] || "";
  const noVisibleUsdFallback =
    !priceFormatterBlock.includes("formatSourcePrice(") &&
    priceFormatterBlock.includes("价格待确认") &&
    priceFormatterBlock.includes("约 ¥");
  if (!noVisibleUsdFallback) errors.push("formatSitePrice still has a visible source-price fallback.");

  const productPriceBlock = querySource.match(/function productPrice[\s\S]*?\n}\n/)?.[0] || "";
  const priceOrderValid =
    productPriceBlock.includes("product.siteDisplayAmount") &&
    productPriceBlock.includes("product.sortKeys?.price") &&
    productPriceBlock.includes("Number.POSITIVE_INFINITY") &&
    !productPriceBlock.includes("sourcePriceAmount");
  if (!priceOrderValid) errors.push("query productPrice order is not siteDisplayAmount -> sortKeys.price -> Infinity.");

  const userVisibleFrontendFiles = [
    "app/products/page.tsx",
    "app/products/[id]/page.tsx",
    "app/brands/page.tsx",
    "app/brands/[slug]/page.tsx",
    "components/products/ProductCard.tsx",
    "components/products/ProductGrid.tsx",
    "components/products/ProductPagination.tsx",
    "components/products/ProductsPageClient.tsx",
  ];
  const forbiddenFrontendMatches = [];
  const forbiddenPattern = /formatSourcePrice|sourcePriceAmount|sourcePriceCurrency|priceRawText|USD |原站价格|Reg\./;
  for (const relativeFile of userVisibleFrontendFiles) {
    const source = await fs.readFile(path.join(ROOT, relativeFile), "utf8");
    if (forbiddenPattern.test(source)) forbiddenFrontendMatches.push(relativeFile);
  }
  if (forbiddenFrontendMatches.length) {
    errors.push(`User-visible frontend still references source price fields: ${forbiddenFrontendMatches.join(", ")}`);
  }

  const petersonIrishHarpSandblasted3085 = findPetersonIrishHarpSandblasted3085(catalog);
  if (petersonIrishHarpSandblasted3085.count < 1) {
    errors.push("Peterson Irish Harp Sandblasted (3085) product not found.");
  }

  const report = {
    schemaVersion: 2,
    status: errors.length ? "failed" : "passed",
    baseline: {
      file: "data/review/smokingpipes-rmb-pricing-phase1-baseline-v1.json",
      hash: hashFile(INPUTS.baseline),
      products: baselineProducts.length,
      catalogHash: baseline.catalogHash,
      manifestHash: baseline.manifestHash,
    },
    expected: EXPECTED,
    exchangeRates,
    pricingConfigHash: hashFile(INPUTS.smokingpipesPricing),
    domesticShipping: {
      configFile: "lib/pricing/reference-price.mjs",
      configExport: "REFERENCE_PRICE_COMMON_CONFIG.domesticShippingCny",
      domesticShippingCny: REFERENCE_PRICE_COMMON_CONFIG.domesticShippingCny,
      catalogDelta,
      detailDelta,
    },
    counts: {
      catalog: catalog.length,
      danish: danishProducts.length,
      smokingpipes: smokingpipesProducts.length,
      brands: (brandsFile.brands || []).length,
      detailShards: (manifest.detailFiles || []).length,
      detailRecords: details.length,
      lookupById: Object.keys(lookup.byId || {}).length,
      lookupBySourceProduct: Object.keys(lookup.bySourceProduct || {}).length,
      filters: Object.fromEntries(
        Object.entries(filters.options || {}).map(([key, options]) => [key, Array.isArray(options) ? options.length : 0])
      ),
    },
    idSetChecks: {
      catalogMatchesBaseline: setEqual(catalogIds, baselineIds),
      detailsMatchCatalog: setEqual(catalogIds, detailIds),
    },
    smokingpipesPricing: {
      sourcePriceValidCount: validSourcePriceCount,
      readyCount,
      cnyCurrencyCount,
      validRmbAmountCount,
      invalidPriceCount,
      zeroPriceCount,
      nonFinitePriceCount,
      formulaMismatchCount: smokingpipeFormulaMismatches.length,
      formulaMismatchSamples: smokingpipeFormulaMismatches.slice(0, 25),
      brandCounts,
      shippingTierCounts,
      samples: pickSamples(smokingpipesProducts, exchangeRates, pricingConfig),
    },
    fixedExamples,
    shippingBoundaries,
    petersonIrishHarpSandblasted3085,
    frontendChecks: {
      noVisibleUsdFallback,
      forbiddenFrontendMatches,
    },
    queryChecks: {
      priceOrderValid,
    },
    hashes: {
      catalog: hashFile(INPUTS.catalog),
      lookup: hashFile(INPUTS.lookup),
      brands: hashFile(INPUTS.brands),
      filters: hashFile(INPUTS.filters),
      manifest: hashFile(INPUTS.manifest),
      detailShards: Object.fromEntries(shardSummaries.map((item) => [item.file, item.sha256])),
    },
    errors,
    warnings,
  };

  await writeReviewFile(OUTPUTS.json, stableJson(report));
  await writeReviewFile(OUTPUTS.markdown, makeMarkdown(report));

  if (report.status !== "passed") {
    console.error(JSON.stringify({ status: report.status, errors: report.errors }, null, 2));
    process.exit(1);
  }

  console.log("Smokingpipes RMB pricing validation passed.");
}

await main();
