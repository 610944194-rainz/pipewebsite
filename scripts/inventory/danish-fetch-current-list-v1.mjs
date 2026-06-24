import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const DEFAULT_LIST_FIXTURE_PATH = path.join(ROOT, "data", "danish-list-full.json");
const DEFAULT_DETAILS_FIXTURE_PATH = path.join(
  ROOT,
  "data",
  "danish-details-full.json"
);
const DEFAULT_OUTPUT_PATH = path.join(
  ROOT,
  "data",
  "inventory",
  "danish-current-list-dry-run.json"
);

const SOLD_PATTERNS = [
  /\u5df2\u552e/i,
  /\u5b8c\u552e/i,
  /\u552e\u7f44/i,
  /\bsold\b/i,
  /out\s*of\s*stock/i,
  /not\s*available/i,
  /\bunavailable\b/i,
  /\breserved\b/i,
  /\barchive\b/i,
  /\breference\b/i,
];

const AVAILABLE_PATTERNS = [
  /\u53ef\u8d2d\u4e70/i,
  /\u73b0\u5728\u8d2d\u4e70/i,
  /\bavailable\b/i,
  /in\s*stock/i,
  /buy\s*now/i,
];

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function relativePath(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function writeJson(filePath, payload) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(
    filePath,
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8"
  );
}

function productsFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.products)) return payload.products;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function hasUsableProductList(filePath) {
  if (!fs.existsSync(filePath)) return false;
  try {
    return productsFromPayload(readJson(filePath)).length > 0;
  } catch {
    return false;
  }
}

function parseCliOptions(argv = process.argv.slice(2)) {
  const options = {};

  for (const argument of argv) {
    if (!argument.startsWith("--")) continue;
    const [key, ...valueParts] = argument.slice(2).split("=");
    options[key] = valueParts.length ? valueParts.join("=") : true;
  }

  return options;
}

function isDirectExecution(importMetaUrl) {
  if (!process.argv[1]) return false;

  const normalizedScript = path.resolve(process.argv[1]).replace(/\\/g, "/");
  const normalizedModule = decodeURIComponent(new URL(importMetaUrl).pathname)
    .replace(/^\/([A-Za-z]:)/, "$1")
    .replace(/\\/g, "/");

  return normalizedScript.toLowerCase() === normalizedModule.toLowerCase();
}

export function extractDanishSourceProductId(value) {
  const text = normalizeText(value);
  const match = text.match(/-i(\d+)\.html(?:[?#].*)?$/i);
  return match?.[1] || "";
}

export function normalizeDanishInventoryStatus(statusText) {
  const text = normalizeText(statusText);
  if (!text) return "unknown";

  if (SOLD_PATTERNS.some((pattern) => pattern.test(text))) return "sold";
  if (AVAILABLE_PATTERNS.some((pattern) => pattern.test(text))) {
    return "available";
  }

  return "unknown";
}

function statusCandidateFields(item) {
  return [
    ["rawStatusText", item?.rawStatusText],
    ["status", item?.status],
    ["inventoryStatus", item?.inventoryStatus],
    ["rawText", item?.rawText],
  ]
    .map(([field, value]) => ({ field, text: normalizeText(value) }))
    .filter((candidate) => candidate.text);
}

export function explainDanishUnknownStatus(item, rawStatusText) {
  const candidates = statusCandidateFields(item);
  if (!normalizeText(rawStatusText) && candidates.length === 0) {
    return "missing status text";
  }

  const recognized = candidates
    .map((candidate) => ({
      ...candidate,
      status: normalizeDanishInventoryStatus(candidate.text),
    }))
    .filter((candidate) => candidate.status !== "unknown");
  const recognizedStatuses = new Set(recognized.map((candidate) => candidate.status));

  if (recognizedStatuses.size > 1) return "conflicting fields";
  if (recognized.length > 0) return "production mismatch";
  return "unmatched status text";
}

export function parseDanishPrice(priceRaw) {
  const text = normalizeText(priceRaw);
  if (!text) {
    return {
      priceAmount: null,
      currency: "unknown",
    };
  }

  const currency = /(?:DKK|kr\.?|dkr)/i.test(text)
    ? "DKK"
    : /(?:EUR|€)/i.test(text)
      ? "EUR"
      : "unknown";
  const amountMatch = text.match(/(\d[\d\s.,]*)/);
  const normalizedAmount = amountMatch?.[1]
    ?.replace(/\s/g, "")
    .replace(/\.(?=\d{3}\b)/g, "")
    .replace(/,[-–—]?$/, "")
    .replace(/,-$/, "")
    .replace(",", ".");
  const priceAmount = normalizedAmount
    ? Number.parseFloat(normalizedAmount)
    : null;

  return {
    priceAmount: Number.isFinite(priceAmount) ? priceAmount : null,
    currency,
  };
}

function pickSourceUrl(item) {
  return normalizeText(
    item?.sourceUrl ||
      item?.href ||
      item?.url ||
      item?.originalUrl ||
      item?.link
  );
}

function pickImageUrl(item) {
  return normalizeText(
    item?.imageUrl ||
      item?.detailImageUrl ||
      item?.primaryImage ||
      item?.mainImage ||
      item?.galleryImages?.[0]
  );
}

function pickRawStatusText(item) {
  return normalizeText(
    item?.rawStatusText || item?.status || item?.inventoryStatus || item?.rawText
  );
}

function recordMissingPriceBucket(counts, inventoryStatus) {
  counts.missingPrice += 1;
  if (inventoryStatus === "available") counts.missingPriceAvailable += 1;
  else if (inventoryStatus === "sold") counts.missingPriceSold += 1;
  else counts.missingPriceUnknown += 1;
}

function normalizeDanishListProduct(item, index, warnings, counts) {
  const sourceUrl = pickSourceUrl(item);
  const sourceProductId =
    normalizeText(item?.sourceProductId) || extractDanishSourceProductId(sourceUrl);

  if (!sourceUrl) counts.missingUrl += 1;

  if (!sourceProductId) {
    counts.missingId += 1;
    warnings.push({
      code: "missing-id",
      index,
      sourceUrl,
      title: normalizeText(item?.title || item?.name || item?.rawTitle),
    });
    return null;
  }

  const title = normalizeText(
    item?.title || item?.name || item?.rawTitle || item?.imageAlt
  );
  const priceRaw = normalizeText(
    item?.priceRaw || item?.price || item?.originalPrice
  );
  const { priceAmount, currency } = parseDanishPrice(priceRaw);
  const imageUrl = pickImageUrl(item);
  const rawStatusText = pickRawStatusText(item);
  const inventoryStatus = normalizeDanishInventoryStatus(rawStatusText);
  const unknownReason =
    inventoryStatus === "unknown"
      ? explainDanishUnknownStatus(item, rawStatusText)
      : null;

  if (!priceRaw || priceAmount === null) {
    recordMissingPriceBucket(counts, inventoryStatus);
  }
  if (!imageUrl) counts.missingImage += 1;

  if (!title) {
    warnings.push({
      code: "missing-title",
      sourceProductId,
      sourceUrl,
    });
  }
  if (!priceRaw || priceAmount === null) {
    warnings.push({
      code:
        inventoryStatus === "available"
          ? "missing-price-available"
          : inventoryStatus === "sold"
            ? "missing-price-sold"
            : "missing-price-unknown",
      sourceProductId,
      sourceUrl,
      title,
      inventoryStatus,
    });
  }
  if (!imageUrl) {
    warnings.push({
      code: "missing-image",
      sourceProductId,
      sourceUrl,
      title,
    });
  }
  if (inventoryStatus === "unknown") {
    warnings.push({
      code: "unknown-status",
      sourceProductId,
      sourceUrl,
      title,
      rawStatusText,
      unknownReason,
    });
  }

  return {
    source: "danish",
    sourceProductId,
    id: `danish-${sourceProductId}`,
    sourceUrl,
    title,
    priceRaw,
    priceAmount,
    currency,
    imageUrl,
    inventoryStatus,
    rawStatusText,
    unknownReason,
    raw: {
      fixtureIndex: index,
      listPageUrl: normalizeText(item?.listPageUrl),
      listPageIndex: item?.listPageIndex ?? null,
      listPosition: item?.listPosition ?? null,
      imageAlt: normalizeText(item?.imageAlt),
    },
  };
}

export function buildDanishCurrentListFromPayload(payload, options = {}) {
  const rawProducts = productsFromPayload(payload);
  const warnings = [];
  const errors = [];
  const counts = {
    total: 0,
    inputTotal: rawProducts.length,
    available: 0,
    sold: 0,
    unknown: 0,
    missingId: 0,
    missingUrl: 0,
    missingPrice: 0,
    missingPriceAvailable: 0,
    missingPriceSold: 0,
    missingPriceUnknown: 0,
    missingImage: 0,
  };
  const seenIds = new Set();
  const products = [];

  rawProducts.forEach((item, index) => {
    const product = normalizeDanishListProduct(item, index, warnings, counts);
    if (!product) return;

    if (seenIds.has(product.sourceProductId)) {
      warnings.push({
        code: "duplicate-id",
        sourceProductId: product.sourceProductId,
        sourceUrl: product.sourceUrl,
      });
      return;
    }

    seenIds.add(product.sourceProductId);
    products.push(product);
    counts.total += 1;
    counts[product.inventoryStatus] += 1;
  });

  return {
    source: "danish",
    generatedAt: new Date().toISOString(),
    mode: "fixture",
    fixturePath: options.fixturePath ? relativePath(options.fixturePath) : null,
    products,
    counts,
    warnings,
    errors,
    productionWritten: false,
  };
}

export function resolveDanishCurrentListFixturePath(options = {}) {
  if (options.inputPath) return path.resolve(options.inputPath);

  if (hasUsableProductList(DEFAULT_LIST_FIXTURE_PATH)) {
    return DEFAULT_LIST_FIXTURE_PATH;
  }

  if (hasUsableProductList(DEFAULT_DETAILS_FIXTURE_PATH)) {
    return DEFAULT_DETAILS_FIXTURE_PATH;
  }

  throw new Error(
    "No usable Danish fixture found. Expected data/danish-list-full.json or data/danish-details-full.json."
  );
}

export async function runDanishCurrentListDryRun(options = {}) {
  const inputPath = resolveDanishCurrentListFixturePath(options);
  const outputPath = path.resolve(options.outputPath || DEFAULT_OUTPUT_PATH);
  const payload = readJson(inputPath);
  const currentList = buildDanishCurrentListFromPayload(payload, {
    fixturePath: inputPath,
  });

  await writeJson(outputPath, currentList);

  return {
    outputPath,
    inputPath,
    currentList,
  };
}

if (isDirectExecution(import.meta.url)) {
  try {
    const cli = parseCliOptions();
    const result = await runDanishCurrentListDryRun({
      inputPath: cli["input"],
      outputPath: cli["output"],
    });

    console.log(
      JSON.stringify(
        {
          status: "ok",
          source: "danish",
          mode: "fixture",
          inputPath: relativePath(result.inputPath),
          outputPath: relativePath(result.outputPath),
          counts: result.currentList.counts,
          warnings: result.currentList.warnings.length,
          productionWritten: false,
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  }
}
