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
const DEFAULT_DIFF_PATH = path.join(
  ROOT,
  "data",
  "inventory",
  "danish-inventory-diff-dry-run.json"
);
const DEFAULT_REPORT_JSON_PATH = path.join(
  ROOT,
  "data",
  "review",
  "danish-sanity-audit-report.json"
);
const DEFAULT_REPORT_MARKDOWN_PATH = path.join(
  ROOT,
  "data",
  "review",
  "danish-sanity-audit-report.md"
);
const SAMPLE_LIMIT = 20;

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

function productsFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.products)) return payload.products;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function productId(product) {
  const direct = normalizeText(product?.sourceProductId);
  if (direct) return direct.replace(/^danish-/i, "");

  const id = normalizeText(product?.id);
  if (/^danish-\d+$/i.test(id)) return id.replace(/^danish-/i, "");
  if (/^\d+$/.test(id)) return id;

  return extractDanishSourceProductId(
    product?.sourceUrl || product?.href || product?.originalUrl || ""
  );
}

function productStatus(product) {
  return normalizeDanishInventoryStatus(
    product?.inventoryStatus || product?.status || product?.rawStatusText
  );
}

function byId(products) {
  return new Map(
    products
      .map((product) => [productId(product), product])
      .filter(([id]) => id)
  );
}

function increment(map, key) {
  map[key] = (map[key] || 0) + 1;
}

function sampleRecord(sourceProductId, productionById, currentById) {
  const production = productionById.get(sourceProductId) || {};
  const current = currentById.get(sourceProductId) || {};
  const sourceUrl = normalizeText(
    current.sourceUrl || current.href || production.sourceUrl || production.href
  );
  const currentStatus = currentById.has(sourceProductId)
    ? productStatus(current)
    : "missing";

  return {
    id: `danish-${sourceProductId}`,
    sourceProductId,
    title: normalizeText(current.title || current.name || production.name),
    sourceUrl,
    productionStatus: productionById.has(sourceProductId)
      ? productStatus(production)
      : "missing",
    currentStatus,
    priceRaw: normalizeText(
      current.priceRaw || current.price || production.originalPrice
    ),
    imageUrl: normalizeText(
      current.imageUrl || current.detailImageUrl || production.imageUrl
    ),
    rawStatusText: normalizeText(
      current.rawStatusText || current.status || current.inventoryStatus
    ),
    unknownReason: normalizeText(current.unknownReason),
  };
}

function sampleIds(ids, productionById, currentById) {
  return ids
    .slice(0, SAMPLE_LIMIT)
    .map((id) => sampleRecord(id, productionById, currentById));
}

function idsWhere(currentById, predicate) {
  const out = [];
  for (const [id, product] of currentById.entries()) {
    if (predicate(product, id)) out.push(id);
  }
  return out.sort((left, right) =>
    String(left).localeCompare(String(right), "en", { numeric: true })
  );
}

function urlIdProblems(products) {
  const problems = [];
  for (const product of products) {
    const id = productId(product);
    const url = normalizeText(product.sourceUrl || product.href);
    const urlId = extractDanishSourceProductId(url);
    if (!id || !url) {
      problems.push({ id, sourceUrl: url, reason: !id ? "missing id" : "missing url" });
    } else if (urlId && id !== urlId) {
      problems.push({ id, sourceUrl: url, urlId, reason: "url/id mismatch" });
    }
  }
  return problems;
}

export function buildDanishSanityAudit(
  existingPayload,
  currentPayload,
  diffPayload
) {
  const productionProducts = productsFromPayload(existingPayload);
  const currentProducts = productsFromPayload(currentPayload);
  const productionById = byId(productionProducts);
  const currentById = byId(currentProducts);
  const currentCounts = currentPayload?.counts || {};
  const diffSummary = diffPayload?.summary || {};
  const unknownReasonCounts = {};

  for (const product of currentProducts) {
    if (productStatus(product) !== "unknown") continue;
    increment(unknownReasonCounts, normalizeText(product.unknownReason) || "unknown");
  }

  const missingPriceIds = idsWhere(
    currentById,
    (product) => !normalizeText(product.priceRaw || product.price) || product.priceAmount === null
  );
  const missingImageIds = idsWhere(
    currentById,
    (product) => !normalizeText(product.imageUrl || product.detailImageUrl)
  );
  const productionSoldButCurrentAvailableIds = idsWhere(currentById, (_, id) => {
    return (
      productionById.has(id) &&
      productStatus(productionById.get(id)) === "sold" &&
      productStatus(currentById.get(id)) === "available"
    );
  });
  const productionSoldButCurrentUnknownIds = idsWhere(currentById, (_, id) => {
    return (
      productionById.has(id) &&
      productStatus(productionById.get(id)) === "sold" &&
      productStatus(currentById.get(id)) === "unknown"
    );
  });
  const productionAvailableButCurrentSoldIds = idsWhere(currentById, (_, id) => {
    return (
      productionById.has(id) &&
      productStatus(productionById.get(id)) === "available" &&
      productStatus(currentById.get(id)) === "sold"
    );
  });

  const productionSoldTotal = productionProducts.filter(
    (product) => productStatus(product) === "sold"
  ).length;
  const productionAvailableTotal = productionProducts.filter(
    (product) => productStatus(product) === "available"
  ).length;
  const currentSoldTotal = currentProducts.filter(
    (product) => productStatus(product) === "sold"
  ).length;
  const currentAvailableTotal = currentProducts.filter(
    (product) => productStatus(product) === "available"
  ).length;
  const currentUnknownTotal = currentProducts.filter(
    (product) => productStatus(product) === "unknown"
  ).length;

  const idUrlProblemsCombined = [
    ...urlIdProblems(productionProducts).map((item) => ({
      scope: "production",
      ...item,
    })),
    ...urlIdProblems(currentProducts).map((item) => ({
      scope: "current-list",
      ...item,
    })),
  ];

  return {
    source: "danish",
    title: "Danish Offline Sanity Audit V1",
    generatedAt: new Date().toISOString(),
    mode: "fixture-sanity-audit",
    inputs: {
      productionCount: productionProducts.length,
      currentListCount: currentProducts.length,
      diffMode: diffPayload?.mode || null,
    },
    counts: {
      production: {
        total: productionProducts.length,
        available: productionAvailableTotal,
        sold: productionSoldTotal,
      },
      current: {
        total: currentProducts.length,
        available: currentAvailableTotal,
        sold: currentSoldTotal,
        unknown: currentUnknownTotal,
        missingPrice: Number(currentCounts.missingPrice || 0),
        missingPriceAvailable: Number(currentCounts.missingPriceAvailable || 0),
        missingPriceSold: Number(currentCounts.missingPriceSold || 0),
        missingPriceUnknown: Number(currentCounts.missingPriceUnknown || 0),
        missingImage: Number(currentCounts.missingImage || 0),
        missingId: Number(currentCounts.missingId || 0),
      },
      diff: {
        new: Number(diffSummary.new || 0),
        stillAvailable: Number(diffSummary.stillAvailable || 0),
        stillSold: Number(diffSummary.stillSold || 0),
        reappeared: Number(diffSummary.reappeared || 0),
        explicitSold: Number(diffSummary.explicitSold || 0),
        disappeared: Number(diffSummary.disappeared || 0),
        unknown: Number(diffSummary.unknown || 0),
      },
    },
    missingPriceBreakdown: {
      available: Number(currentCounts.missingPriceAvailable || 0),
      sold: Number(currentCounts.missingPriceSold || 0),
      unknown: Number(currentCounts.missingPriceUnknown || 0),
    },
    highRisk: {
      missingPriceAvailable: Number(currentCounts.missingPriceAvailable || 0),
    },
    unknownReasonCounts,
    productionSoldVsCurrentSold: {
      productionSoldTotal,
      currentSoldTotal,
      stillSold: Number(diffSummary.stillSold || 0),
      productionSoldButCurrentAvailable:
        productionSoldButCurrentAvailableIds.length,
      productionSoldButCurrentUnknown: productionSoldButCurrentUnknownIds.length,
      likelyReason:
        "The local list fixture marks many previously sold production products as available or unknown. Treat these as review evidence only until a fresh real current-list confirms them.",
    },
    idUrlProblems: {
      total: idUrlProblemsCombined.length,
      samples: idUrlProblemsCombined.slice(0, SAMPLE_LIMIT),
    },
    samples: {
      new: sampleIds(diffPayload?.newIds || [], productionById, currentById),
      reappeared: sampleIds(
        diffPayload?.reappearedIds || [],
        productionById,
        currentById
      ),
      unknown: sampleIds(diffPayload?.unknownIds || [], productionById, currentById),
      missingPrice: sampleIds(missingPriceIds, productionById, currentById),
      missingImage: sampleIds(missingImageIds, productionById, currentById),
      productionSoldButCurrentAvailable: sampleIds(
        productionSoldButCurrentAvailableIds,
        productionById,
        currentById
      ),
      productionSoldButCurrentUnknown: sampleIds(
        productionSoldButCurrentUnknownIds,
        productionById,
        currentById
      ),
      productionAvailableButCurrentSold: sampleIds(
        productionAvailableButCurrentSoldIds,
        productionById,
        currentById
      ),
    },
    conclusions: [
      "missingPrice sold products are not automatically high risk; missingPrice available products are high risk.",
      "reappeared records are production sold products that the fixture currently shows as available; do not apply until a fresh current-list confirms them.",
      "unknown status records require parser/status review before they can be used for inventory decisions.",
      "Danish V1 remains dry-run only: allowApply=false and productionWritten=false.",
    ],
    allowApply: false,
    productionWritten: false,
  };
}

function formatSampleList(samples) {
  if (!samples.length) return ["- None"];
  return samples.slice(0, 10).map((sample) => {
    return `- ${sample.sourceProductId} | ${sample.title || "(no title)"} | production=${sample.productionStatus} | current=${sample.currentStatus} | ${sample.sourceUrl}`;
  });
}

function buildMarkdown(report) {
  return [
    "# Danish Offline Sanity Audit V1",
    "",
    `Generated at: ${report.generatedAt}`,
    "",
    "## Summary",
    "",
    `- production: ${report.counts.production.total}`,
    `- current-list: ${report.counts.current.total}`,
    `- new: ${report.counts.diff.new}`,
    `- reappeared: ${report.counts.diff.reappeared}`,
    `- unknown: ${report.counts.diff.unknown}`,
    `- missingPrice: ${report.counts.current.missingPrice}`,
    `- missingImage: ${report.counts.current.missingImage}`,
    `- allowApply: ${report.allowApply}`,
    `- productionWritten: ${report.productionWritten}`,
    "",
    "## Missing price breakdown",
    "",
    `- available: ${report.missingPriceBreakdown.available}`,
    `- sold: ${report.missingPriceBreakdown.sold}`,
    `- unknown: ${report.missingPriceBreakdown.unknown}`,
    "",
    "## Unknown reasons",
    "",
    ...Object.entries(report.unknownReasonCounts).map(
      ([reason, count]) => `- ${reason}: ${count}`
    ),
    ...(Object.keys(report.unknownReasonCounts).length ? [] : ["- None"]),
    "",
    "## Production sold vs current sold",
    "",
    `- production sold: ${report.productionSoldVsCurrentSold.productionSoldTotal}`,
    `- current sold: ${report.productionSoldVsCurrentSold.currentSoldTotal}`,
    `- still sold: ${report.productionSoldVsCurrentSold.stillSold}`,
    `- production sold but current available: ${report.productionSoldVsCurrentSold.productionSoldButCurrentAvailable}`,
    `- production sold but current unknown: ${report.productionSoldVsCurrentSold.productionSoldButCurrentUnknown}`,
    `- reason: ${report.productionSoldVsCurrentSold.likelyReason}`,
    "",
    "## ID / URL problems",
    "",
    `- total: ${report.idUrlProblems.total}`,
    "",
    "## Samples: new",
    "",
    ...formatSampleList(report.samples.new),
    "",
    "## Samples: reappeared",
    "",
    ...formatSampleList(report.samples.reappeared),
    "",
    "## Samples: unknown",
    "",
    ...formatSampleList(report.samples.unknown),
    "",
    "## Samples: missing price",
    "",
    ...formatSampleList(report.samples.missingPrice),
    "",
    "## Samples: missing image",
    "",
    ...formatSampleList(report.samples.missingImage),
    "",
    "## Samples: production sold but current available",
    "",
    ...formatSampleList(report.samples.productionSoldButCurrentAvailable),
    "",
    "## Samples: production sold but current unknown",
    "",
    ...formatSampleList(report.samples.productionSoldButCurrentUnknown),
    "",
    "## Samples: production available but current sold",
    "",
    ...formatSampleList(report.samples.productionAvailableButCurrentSold),
    "",
  ].join("\n");
}

export async function runDanishSanityAudit(options = {}) {
  const existingProductsPath = path.resolve(
    options.existingProductsPath || DEFAULT_EXISTING_PRODUCTS_PATH
  );
  const currentListPath = path.resolve(
    options.currentListPath || DEFAULT_CURRENT_LIST_PATH
  );
  const diffPath = path.resolve(options.diffPath || DEFAULT_DIFF_PATH);
  const reportJsonPath = path.resolve(
    options.reportJsonPath || DEFAULT_REPORT_JSON_PATH
  );
  const reportMarkdownPath = path.resolve(
    options.reportMarkdownPath || DEFAULT_REPORT_MARKDOWN_PATH
  );

  const report = buildDanishSanityAudit(
    readJson(existingProductsPath),
    readJson(currentListPath),
    readJson(diffPath)
  );

  await writeJson(reportJsonPath, report);
  await writeText(reportMarkdownPath, buildMarkdown(report));

  return {
    report,
    existingProductsPath,
    currentListPath,
    diffPath,
    reportJsonPath,
    reportMarkdownPath,
  };
}

if (isDirectExecution(import.meta.url)) {
  try {
    const cli = parseCliOptions();
    const result = await runDanishSanityAudit({
      existingProductsPath: cli["existing-products"],
      currentListPath: cli["current-list"],
      diffPath: cli["diff"],
      reportJsonPath: cli["report-json"],
      reportMarkdownPath: cli["report-md"],
    });

    console.log(
      JSON.stringify(
        {
          status: "ok",
          source: "danish",
          mode: "fixture-sanity-audit",
          currentListPath: relativePath(result.currentListPath),
          diffPath: relativePath(result.diffPath),
          reportJsonPath: relativePath(result.reportJsonPath),
          reportMarkdownPath: relativePath(result.reportMarkdownPath),
          counts: result.report.counts,
          missingPriceBreakdown: result.report.missingPriceBreakdown,
          unknownReasonCounts: result.report.unknownReasonCounts,
          allowApply: result.report.allowApply,
          productionWritten: result.report.productionWritten,
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
