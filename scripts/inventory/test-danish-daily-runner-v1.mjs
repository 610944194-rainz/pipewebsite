import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildDanishCurrentListFromPayload,
  extractDanishSourceProductId,
  runDanishCurrentListDryRun,
} from "./danish-fetch-current-list-v1.mjs";
import {
  buildDanishInventoryDiff,
  runDanishInventoryDiffDryRun,
} from "./danish-diff-inventory-v1.mjs";
import {
  buildDanishSanityAudit,
  runDanishSanityAudit,
} from "./danish-sanity-audit-v1.mjs";

function hashFile(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const tempRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "danish-daily-runner-v1-")
);

const productionPath = path.join(
  process.cwd(),
  "data",
  "products",
  "danish-products.json"
);
const productionHashBefore = hashFile(productionPath);

assert.equal(
  extractDanishSourceProductId(
    "https://www.danishpipeshop.com/d/-zh/Anne-Julie-Unica-Blowfish-i33109.html"
  ),
  "33109"
);
assert.equal(extractDanishSourceProductId("https://example.com/no-id"), "");

const currentPayload = buildDanishCurrentListFromPayload(
  {
    source: "The Danish Pipe Shop",
    products: [
      {
        href: "https://www.danishpipeshop.com/d/-zh/Test-Pipe-i100.html",
        name: "Test Pipe",
        price: "EUR 123,-",
        status: "available",
        imageUrl: "https://example.com/test.jpg",
      },
      {
        href: "https://www.danishpipeshop.com/d/-zh/Sold-Pipe-i101.html",
        name: "Sold Pipe",
        price: "",
        status: "sold",
        imageUrl: "",
      },
      {
        href: "https://www.danishpipeshop.com/d/-zh/Unknown-Pipe-i102.html",
        name: "Unknown Pipe",
        price: "",
        status: "later maybe",
        imageUrl: "https://example.com/unknown.jpg",
      },
      {
        href: "https://www.danishpipeshop.com/d/-zh/No-Status-i103.html",
        name: "No Status Pipe",
        price: "",
        status: "",
        imageUrl: "https://example.com/no-status.jpg",
      },
      {
        href: "https://www.danishpipeshop.com/d/-zh/No-Id.html",
        name: "No Id",
        price: "EUR 456,-",
        status: "available",
        imageUrl: "https://example.com/no-id.jpg",
      },
    ],
  },
  { fixturePath: "synthetic-danish-list.json" }
);

assert.equal(currentPayload.source, "danish");
assert.equal(currentPayload.mode, "fixture");
assert.equal(currentPayload.products.length, 4);
assert.deepEqual(
  currentPayload.products.map((item) => item.sourceProductId),
  ["100", "101", "102", "103"]
);
assert.equal(currentPayload.products[0].id, "danish-100");
assert.equal(currentPayload.products[0].currency, "EUR");
assert.equal(currentPayload.products[0].priceAmount, 123);
assert.equal(currentPayload.products[1].inventoryStatus, "sold");
assert.equal(currentPayload.products[2].inventoryStatus, "unknown");
assert.equal(currentPayload.products[2].unknownReason, "unmatched status text");
assert.equal(currentPayload.products[3].unknownReason, "missing status text");
assert.equal(currentPayload.counts.missingId, 1);
assert.equal(currentPayload.counts.missingPrice, 3);
assert.equal(currentPayload.counts.missingPriceSold, 1);
assert.equal(currentPayload.counts.missingPriceUnknown, 2);
assert.equal(currentPayload.counts.missingPriceAvailable, 0);
assert.equal(currentPayload.counts.missingImage, 1);
assert.equal(currentPayload.counts.unknown, 2);
assert.equal(currentPayload.warnings.length >= 6, true);

const fixturePath = path.join(tempRoot, "danish-list-fixture.json");
const currentOutputPath = path.join(
  tempRoot,
  "danish-current-list-dry-run.json"
);
fs.writeFileSync(
  fixturePath,
  JSON.stringify({ products: currentPayload.products }, null, 2),
  "utf8"
);
await runDanishCurrentListDryRun({
  inputPath: fixturePath,
  outputPath: currentOutputPath,
});
assert.equal(fs.existsSync(currentOutputPath), true);
assert.equal(hashFile(productionPath), productionHashBefore);

const syntheticExistingProducts = [
  {
    id: 100,
    sourceUrl: "https://www.danishpipeshop.com/d/-zh/Still-Available-i100.html",
    name: "Still Available",
    status: "available",
  },
  {
    id: 101,
    sourceUrl: "https://www.danishpipeshop.com/d/-zh/Still-Sold-i101.html",
    name: "Still Sold",
    status: "sold",
  },
  {
    id: 103,
    sourceUrl: "https://www.danishpipeshop.com/d/-zh/Explicit-Sold-i103.html",
    name: "Explicit Sold",
    status: "available",
  },
  {
    id: 104,
    sourceUrl: "https://www.danishpipeshop.com/d/-zh/Reappeared-i104.html",
    name: "Reappeared",
    status: "sold",
  },
  {
    id: 105,
    sourceUrl: "https://www.danishpipeshop.com/d/-zh/Disappeared-i105.html",
    name: "Disappeared",
    status: "available",
  },
  {
    id: 108,
    sourceUrl:
      "https://www.danishpipeshop.com/d/-zh/Sold-But-Unknown-i108.html",
    name: "Sold But Unknown",
    status: "sold",
  },
];

const syntheticCurrent = {
  source: "danish",
  mode: "fixture",
  products: [
    {
      sourceProductId: "100",
      id: "danish-100",
      sourceUrl:
        "https://www.danishpipeshop.com/d/-zh/Still-Available-i100.html",
      title: "Still Available",
      priceRaw: "EUR 100,-",
      priceAmount: 100,
      currency: "EUR",
      imageUrl: "https://example.com/100.jpg",
      inventoryStatus: "available",
      rawStatusText: "available",
    },
    {
      sourceProductId: "101",
      id: "danish-101",
      sourceUrl: "https://www.danishpipeshop.com/d/-zh/Still-Sold-i101.html",
      title: "Still Sold",
      priceRaw: "",
      priceAmount: null,
      currency: "unknown",
      imageUrl: "https://example.com/101.jpg",
      inventoryStatus: "sold",
      rawStatusText: "sold",
    },
    {
      sourceProductId: "103",
      id: "danish-103",
      sourceUrl:
        "https://www.danishpipeshop.com/d/-zh/Explicit-Sold-i103.html",
      title: "Explicit Sold",
      priceRaw: "",
      priceAmount: null,
      currency: "unknown",
      imageUrl: "https://example.com/103.jpg",
      inventoryStatus: "sold",
      rawStatusText: "sold",
    },
    {
      sourceProductId: "104",
      id: "danish-104",
      sourceUrl: "https://www.danishpipeshop.com/d/-zh/Reappeared-i104.html",
      title: "Reappeared",
      priceRaw: "EUR 104,-",
      priceAmount: 104,
      currency: "EUR",
      imageUrl: "https://example.com/104.jpg",
      inventoryStatus: "available",
      rawStatusText: "available",
    },
    {
      sourceProductId: "106",
      id: "danish-106",
      sourceUrl: "https://www.danishpipeshop.com/d/-zh/New-Pipe-i106.html",
      title: "New Pipe",
      priceRaw: "EUR 106,-",
      priceAmount: 106,
      currency: "EUR",
      imageUrl: "https://example.com/106.jpg",
      inventoryStatus: "available",
      rawStatusText: "available",
    },
    {
      sourceProductId: "107",
      id: "danish-107",
      sourceUrl: "https://www.danishpipeshop.com/d/-zh/Unknown-Pipe-i107.html",
      title: "Unknown Pipe",
      priceRaw: "",
      priceAmount: null,
      currency: "unknown",
      imageUrl: "",
      inventoryStatus: "unknown",
      rawStatusText: "later maybe",
      unknownReason: "unmatched status text",
    },
    {
      sourceProductId: "108",
      id: "danish-108",
      sourceUrl:
        "https://www.danishpipeshop.com/d/-zh/Sold-But-Unknown-i108.html",
      title: "Sold But Unknown",
      priceRaw: "",
      priceAmount: null,
      currency: "unknown",
      imageUrl: "https://example.com/108.jpg",
      inventoryStatus: "unknown",
      rawStatusText: "later maybe",
      unknownReason: "unmatched status text",
    },
  ],
  counts: {
    total: 7,
    available: 3,
    sold: 2,
    unknown: 2,
    missingId: 0,
    missingUrl: 0,
    missingPrice: 4,
    missingPriceAvailable: 0,
    missingPriceSold: 2,
    missingPriceUnknown: 2,
    missingImage: 1,
  },
  warnings: [],
  errors: [],
};

const diff = buildDanishInventoryDiff(syntheticCurrent, syntheticExistingProducts);
assert.deepEqual(diff.newIds, ["106", "107"]);
assert.deepEqual(diff.stillAvailableIds, ["100"]);
assert.deepEqual(diff.stillSoldIds, ["101"]);
assert.deepEqual(diff.reappearedIds, ["104"]);
assert.deepEqual(diff.explicitSoldIds, ["103"]);
assert.deepEqual(diff.disappearedIds, ["105"]);
assert.deepEqual(diff.unknownIds, ["107", "108"]);
assert.equal(diff.allowApply, false);
assert.equal(diff.productionWritten, false);
assert.equal(diff.warnings.some((item) => item.includes("missing price")), true);
assert.equal(diff.warnings.some((item) => item.includes("missing image")), true);
assert.match(diff.explanations.reappeared, /production.*sold.*current-list.*available/i);
assert.match(diff.explanations.explicitSold, /production.*available.*current-list.*sold/i);
assert.match(diff.explanations.disappeared, /sold-by-absence is disabled/i);

const sanity = buildDanishSanityAudit(
  syntheticExistingProducts,
  syntheticCurrent,
  diff
);
assert.equal(sanity.allowApply, false);
assert.equal(sanity.productionWritten, false);
assert.equal(sanity.samples.new.length, 2);
assert.equal(sanity.samples.reappeared[0].sourceProductId, "104");
assert.equal(
  sanity.samples.productionSoldButCurrentAvailable[0].sourceProductId,
  "104"
);
assert.equal(
  sanity.samples.productionAvailableButCurrentSold[0].sourceProductId,
  "103"
);
assert.equal(
  sanity.samples.productionSoldButCurrentUnknown[0].sourceProductId,
  "108"
);
assert.equal(sanity.unknownReasonCounts["unmatched status text"], 2);
assert.equal(sanity.missingPriceBreakdown.sold, 2);
assert.equal(sanity.missingPriceBreakdown.available, 0);
assert.equal(sanity.missingPriceBreakdown.unknown, 2);
assert.equal(sanity.highRisk.missingPriceAvailable, 0);

const existingPath = path.join(tempRoot, "danish-products.json");
const diffCurrentPath = path.join(tempRoot, "current.json");
const diffOutputPath = path.join(tempRoot, "diff.json");
const reportJsonPath = path.join(tempRoot, "report.json");
const reportMarkdownPath = path.join(tempRoot, "report.md");
const sanityJsonPath = path.join(tempRoot, "sanity.json");
const sanityMarkdownPath = path.join(tempRoot, "sanity.md");

fs.writeFileSync(
  existingPath,
  JSON.stringify(syntheticExistingProducts, null, 2),
  "utf8"
);
fs.writeFileSync(
  diffCurrentPath,
  JSON.stringify(syntheticCurrent, null, 2),
  "utf8"
);

await runDanishInventoryDiffDryRun({
  existingProductsPath: existingPath,
  currentListPath: diffCurrentPath,
  outputPath: diffOutputPath,
  reportJsonPath,
  reportMarkdownPath,
});

await runDanishSanityAudit({
  existingProductsPath: existingPath,
  currentListPath: diffCurrentPath,
  diffPath: diffOutputPath,
  reportJsonPath: sanityJsonPath,
  reportMarkdownPath: sanityMarkdownPath,
});

assert.equal(fs.existsSync(diffOutputPath), true);
assert.equal(fs.existsSync(reportJsonPath), true);
assert.equal(fs.existsSync(reportMarkdownPath), true);
assert.equal(fs.existsSync(sanityJsonPath), true);
assert.equal(fs.existsSync(sanityMarkdownPath), true);
assert.equal(readJson(reportJsonPath).allowApply, false);
assert.equal(readJson(sanityJsonPath).samples.new.length, 2);
assert.match(
  fs.readFileSync(reportMarkdownPath, "utf8"),
  /Danish Daily Update V1 Dry Run/
);
assert.match(
  fs.readFileSync(sanityMarkdownPath, "utf8"),
  /Danish Offline Sanity Audit V1/
);
assert.equal(hashFile(productionPath), productionHashBefore);

console.log("Danish daily runner v1 tests passed");
