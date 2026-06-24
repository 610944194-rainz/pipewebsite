import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  extractDanishSourceProductId,
  normalizeDanishInventoryStatus,
} from "./danish-fetch-current-list-v1.mjs";

const ROOT = process.cwd();
const DEFAULT_EXISTING_PRODUCTS_PATH = path.join(
  ROOT,
  "data",
  "products",
  "danish-products.json"
);
const DEFAULT_CURRENT_LIST_PATH = path.join(
  ROOT,
  "data",
  "inventory",
  "danish-current-list-dry-run.json"
);
const DEFAULT_DIFF_OUTPUT_PATH = path.join(
  ROOT,
  "data",
  "inventory",
  "danish-inventory-diff-dry-run.json"
);
const DEFAULT_REPORT_JSON_PATH = path.join(
  ROOT,
  "data",
  "review",
  "danish-daily-update-report.json"
);
const DEFAULT_REPORT_MARKDOWN_PATH = path.join(
  ROOT,
  "data",
  "review",
  "danish-daily-update-report.md"
);

export const DANISH_DIFF_EXPLANATIONS = {
  reappeared:
    "reappeared = production was sold, but current-list shows available.",
  explicitSold:
    "explicitSold = production was available, but current-list explicitly shows sold.",
  unknown:
    "unknown = current-list status cannot be trusted enough to classify as available or sold.",
  disappeared:
    "disappeared = exists in production but is absent from current-list; sold-by-absence is disabled in fixture dry-run mode.",
};

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function relativePath(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
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

async function writeText(filePath, content) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, content, "utf8");
}

function sortIds(values) {
  return [...values].sort((left, right) =>
    String(left).localeCompare(String(right), "en", { numeric: true })
  );
}

function productsFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.products)) return payload.products;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function existingProductId(product) {
  const direct = normalizeText(product?.sourceProductId);
  if (direct) return direct.replace(/^danish-/i, "");

  const publicId = normalizeText(product?.id);
  if (/^danish-\d+$/i.test(publicId)) return publicId.replace(/^danish-/i, "");
  if (/^\d+$/.test(publicId)) return publicId;

  return extractDanishSourceProductId(
    product?.sourceUrl || product?.href || product?.originalUrl || ""
  );
}

function existingInventoryStatus(product) {
  return normalizeDanishInventoryStatus(
    product?.inventoryStatus || product?.status || product?.rawStatusText
  );
}

function currentProductId(product) {
  const direct = normalizeText(product?.sourceProductId);
  if (direct) return direct.replace(/^danish-/i, "");

  const publicId = normalizeText(product?.id);
  if (/^danish-\d+$/i.test(publicId)) return publicId.replace(/^danish-/i, "");

  return extractDanishSourceProductId(product?.sourceUrl || product?.href || "");
}

function currentInventoryStatus(product) {
  return normalizeDanishInventoryStatus(
    product?.inventoryStatus || product?.rawStatusText || product?.status
  );
}

function summarizeRecords(ids, map) {
  return ids.map((sourceProductId) => {
    const item = map.get(sourceProductId) || {};
    return {
      sourceProductId,
      id: `danish-${sourceProductId}`,
      title: normalizeText(item.title || item.name),
      sourceUrl: normalizeText(item.sourceUrl || item.href),
      inventoryStatus: currentInventoryStatus(item),
      rawStatusText: normalizeText(
        item.rawStatusText || item.status || item.inventoryStatus
      ),
      unknownReason: normalizeText(item.unknownReason),
      priceRaw: normalizeText(item.priceRaw || item.price || item.originalPrice),
      imageUrl: normalizeText(item.imageUrl || item.detailImageUrl),
    };
  });
}

function summarizeExistingRecords(ids, map) {
  return ids.map((sourceProductId) => {
    const item = map.get(sourceProductId) || {};
    return {
      sourceProductId,
      id: `danish-${sourceProductId}`,
      title: normalizeText(item.title || item.name),
      sourceUrl: normalizeText(item.sourceUrl || item.href),
      previousStatus: existingInventoryStatus(item),
    };
  });
}

export function buildDanishInventoryDiff(currentPayload, existingPayload) {
  const currentProducts = productsFromPayload(currentPayload);
  const existingProducts = productsFromPayload(existingPayload);
  const currentById = new Map();
  const existingById = new Map();
  const warnings = [];
  const errors = [];

  for (const product of currentProducts) {
    const id = currentProductId(product);
    if (!id) continue;
    currentById.set(id, product);
  }

  for (const product of existingProducts) {
    const id = existingProductId(product);
    if (!id) continue;
    existingById.set(id, product);
  }

  const currentIds = new Set(currentById.keys());
  const existingIds = new Set(existingById.keys());
  const newIds = [];
  const stillAvailableIds = [];
  const stillSoldIds = [];
  const reappearedIds = [];
  const explicitSoldIds = [];
  const unknownIds = [];

  for (const id of currentIds) {
    const currentProduct = currentById.get(id);
    const currentStatus = currentInventoryStatus(currentProduct);
    const existingProduct = existingById.get(id);
    const previousStatus = existingProduct
      ? existingInventoryStatus(existingProduct)
      : null;

    if (!existingProduct) newIds.push(id);
    if (currentStatus === "unknown") unknownIds.push(id);

    if (!existingProduct) continue;

    if (previousStatus === "available" && currentStatus === "available") {
      stillAvailableIds.push(id);
    } else if (previousStatus === "sold" && currentStatus === "sold") {
      stillSoldIds.push(id);
    } else if (previousStatus === "sold" && currentStatus === "available") {
      reappearedIds.push(id);
    } else if (previousStatus === "available" && currentStatus === "sold") {
      explicitSoldIds.push(id);
    }
  }

  const disappearedIds = [];
  for (const id of existingIds) {
    if (!currentIds.has(id)) disappearedIds.push(id);
  }

  const currentCounts = currentPayload?.counts || {};
  if (Number(currentCounts.missingPrice || 0) > 0) {
    warnings.push(
      `${currentCounts.missingPrice} current-list products have missing price (${Number(
        currentCounts.missingPriceAvailable || 0
      )} available, ${Number(currentCounts.missingPriceSold || 0)} sold, ${Number(
        currentCounts.missingPriceUnknown || 0
      )} unknown).`
    );
  }
  if (Number(currentCounts.missingImage || 0) > 0) {
    warnings.push(
      `${currentCounts.missingImage} current-list products have missing image.`
    );
  }
  if (Number(currentCounts.unknown || 0) > 0) {
    warnings.push(
      `${currentCounts.unknown} current-list products have unknown inventory status.`
    );
  }
  if (disappearedIds.length > 0) {
    warnings.push(
      `${disappearedIds.length} products disappeared from the fixture snapshot; sold-by-absence is disabled in Danish V1 dry-run.`
    );
  }

  return {
    source: "danish",
    generatedAt: new Date().toISOString(),
    mode: "fixture-diff",
    currentList: {
      count: currentProducts.length,
      fixturePath: currentPayload?.fixturePath || null,
      counts: currentCounts,
    },
    production: {
      count: existingProducts.length,
    },
    summary: {
      new: newIds.length,
      stillAvailable: stillAvailableIds.length,
      stillSold: stillSoldIds.length,
      reappeared: reappearedIds.length,
      explicitSold: explicitSoldIds.length,
      disappeared: disappearedIds.length,
      unknown: unknownIds.length,
    },
    explanations: DANISH_DIFF_EXPLANATIONS,
    newIds: sortIds(newIds),
    stillAvailableIds: sortIds(stillAvailableIds),
    stillSoldIds: sortIds(stillSoldIds),
    reappearedIds: sortIds(reappearedIds),
    explicitSoldIds: sortIds(explicitSoldIds),
    disappearedIds: sortIds(disappearedIds),
    unknownIds: sortIds(unknownIds),
    records: {
      new: summarizeRecords(sortIds(newIds), currentById),
      reappeared: summarizeRecords(sortIds(reappearedIds), currentById),
      explicitSold: summarizeRecords(sortIds(explicitSoldIds), currentById),
      unknown: summarizeRecords(sortIds(unknownIds), currentById),
      disappeared: summarizeExistingRecords(sortIds(disappearedIds), existingById),
    },
    allowApply: false,
    productionWritten: false,
    warnings,
    errors,
  };
}

function buildDanishDailyReport(diff) {
  return {
    source: "danish",
    title: "Danish Daily Update V1 Dry Run",
    generatedAt: diff.generatedAt,
    currentListCount: diff.currentList.count,
    productionCount: diff.production.count,
    ...diff.summary,
    explanations: diff.explanations,
    allowApply: false,
    productionWritten: false,
    warnings: diff.warnings,
    errors: diff.errors,
  };
}

function buildDanishDailyReportMarkdown(report) {
  return [
    "# Danish Daily Update V1 Dry Run",
    "",
    `Generated at: ${report.generatedAt}`,
    "",
    `Current list count: ${report.currentListCount}`,
    `Production count: ${report.productionCount}`,
    `new: ${report.new}`,
    `stillAvailable: ${report.stillAvailable}`,
    `stillSold: ${report.stillSold}`,
    `reappeared: ${report.reappeared}`,
    `explicitSold: ${report.explicitSold}`,
    `disappeared: ${report.disappeared}`,
    `unknown: ${report.unknown}`,
    "",
    "allowApply: false",
    "productionWritten: false",
    "",
    "## Classification notes",
    "",
    `- ${report.explanations.reappeared}`,
    `- ${report.explanations.explicitSold}`,
    `- ${report.explanations.unknown}`,
    `- ${report.explanations.disappeared}`,
    "",
    "## Warnings",
    "",
    ...(report.warnings.length
      ? report.warnings.map((warning) => `- ${warning}`)
      : ["- None"]),
    "",
    "## Errors",
    "",
    ...(report.errors.length ? report.errors.map((error) => `- ${error}`) : ["- None"]),
    "",
  ].join("\n");
}

export async function runDanishInventoryDiffDryRun(options = {}) {
  const existingProductsPath = path.resolve(
    options.existingProductsPath || DEFAULT_EXISTING_PRODUCTS_PATH
  );
  const currentListPath = path.resolve(
    options.currentListPath || DEFAULT_CURRENT_LIST_PATH
  );
  const outputPath = path.resolve(options.outputPath || DEFAULT_DIFF_OUTPUT_PATH);
  const reportJsonPath = path.resolve(
    options.reportJsonPath || DEFAULT_REPORT_JSON_PATH
  );
  const reportMarkdownPath = path.resolve(
    options.reportMarkdownPath || DEFAULT_REPORT_MARKDOWN_PATH
  );
  const existingPayload = readJson(existingProductsPath);
  const currentPayload = readJson(currentListPath);
  const diff = buildDanishInventoryDiff(currentPayload, existingPayload);
  const report = buildDanishDailyReport(diff);

  await writeJson(outputPath, diff);
  await writeJson(reportJsonPath, report);
  await writeText(reportMarkdownPath, buildDanishDailyReportMarkdown(report));

  return {
    diff,
    report,
    outputPath,
    reportJsonPath,
    reportMarkdownPath,
    existingProductsPath,
    currentListPath,
  };
}

if (isDirectExecution(import.meta.url)) {
  try {
    const cli = parseCliOptions();
    const result = await runDanishInventoryDiffDryRun({
      existingProductsPath: cli["existing-products"],
      currentListPath: cli["current-list"],
      outputPath: cli["output"],
      reportJsonPath: cli["report-json"],
      reportMarkdownPath: cli["report-md"],
    });

    console.log(
      JSON.stringify(
        {
          status: "ok",
          source: "danish",
          mode: "fixture-diff",
          currentListPath: relativePath(result.currentListPath),
          outputPath: relativePath(result.outputPath),
          reportJsonPath: relativePath(result.reportJsonPath),
          reportMarkdownPath: relativePath(result.reportMarkdownPath),
          summary: result.diff.summary,
          allowApply: result.diff.allowApply,
          productionWritten: result.diff.productionWritten,
          warnings: result.diff.warnings.length,
          errors: result.diff.errors.length,
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
