import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  isAllowedProductionPath,
} from "./smokingpipes-auto-publish-policy-v1.mjs";

function parseArgs(argv = process.argv.slice(2)) {
  const values = new Map();
  for (const argument of argv) {
    if (!argument.startsWith("--")) continue;
    const [key, value = true] = argument.slice(2).split(/=(.*)/s);
    values.set(key, value);
  }
  return values;
}

function rows(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.products)) return value.products;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

function productId(product) {
  return String(product?.id || "").trim();
}

function canonical(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function mapById(products) {
  return new Map(products.map((product) => [productId(product), product]));
}

function duplicateCount(products) {
  const counts = new Map();
  for (const product of products) {
    const id = productId(product);
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return [...counts.values()].filter((count) => count > 1).length;
}

function inventoryStatus(product) {
  return String(product?.inventoryStatus || "").toLowerCase();
}

function priceChanged(before, after) {
  return (
    canonical(before?.price?.current || null) !==
    canonical(after?.price?.current || null)
  );
}

export function summarizeSmokingpipesProductionDelta({
  beforeProducts = [],
  afterProducts = [],
}) {
  const before = mapById(beforeProducts);
  const after = mapById(afterProducts);
  const addedIds = [];
  const deletedIds = [];
  const changedIds = [];
  let soldToAvailable = 0;
  let availableToSold = 0;
  let changedPrice = 0;

  for (const [id, product] of after) {
    const previous = before.get(id);
    if (!previous) {
      addedIds.push(id);
      continue;
    }
    if (canonical(previous) === canonical(product)) continue;
    changedIds.push(id);
    if (
      ["sold", "out-of-stock"].includes(inventoryStatus(previous)) &&
      inventoryStatus(product) === "available"
    ) {
      soldToAvailable += 1;
    }
    if (
      inventoryStatus(previous) === "available" &&
      ["sold", "out-of-stock"].includes(inventoryStatus(product))
    ) {
      availableToSold += 1;
    }
    if (priceChanged(previous, product)) changedPrice += 1;
  }
  for (const id of before.keys()) {
    if (!after.has(id)) deletedIds.push(id);
  }
  return {
    beforeRecords: beforeProducts.length,
    afterRecords: afterProducts.length,
    addedIds,
    deletedIds,
    changedIds,
    touchedUniqueIds: new Set([...addedIds, ...deletedIds, ...changedIds])
      .size,
    duplicateIdsBefore: duplicateCount(beforeProducts),
    duplicateIdsAfter: duplicateCount(afterProducts),
    actions: {
      added: addedIds.length,
      updated: changedIds.length,
      soldOrOutOfStockToAvailable: soldToAvailable,
      availableToSoldOrOutOfStock: availableToSold,
      priceChanged: changedPrice,
    },
  };
}

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
}

function readHeadJson(root, relativePath) {
  return JSON.parse(git(root, ["show", `HEAD:${relativePath}`]));
}

function readWorktreeJson(root, relativePath) {
  return JSON.parse(
    fs.readFileSync(path.join(root, relativePath), "utf8")
  );
}

export function auditPostApplyProductionDiff({
  root = process.cwd(),
  expectedAppliedCount = null,
} = {}) {
  const changedFiles = git(root, ["diff", "--name-only", "HEAD"])
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  const blockers = [];
  const disallowedFiles = changedFiles.filter(
    (filePath) => !isAllowedProductionPath(filePath)
  );
  if (!changedFiles.length) blockers.push("production dirty files are missing");
  if (disallowedFiles.length) {
    blockers.push(
      `non-production tracked changes: ${disallowedFiles.join(", ")}`
    );
  }

  const smokingpipesPath = "data/products/smokingpipes-products.json";
  const beforeProducts = rows(readHeadJson(root, smokingpipesPath));
  const afterProducts = rows(readWorktreeJson(root, smokingpipesPath));
  const smokingpipes = summarizeSmokingpipesProductionDelta({
    beforeProducts,
    afterProducts,
  });
  if (smokingpipes.duplicateIdsAfter) {
    blockers.push(
      `duplicate Smokingpipes IDs=${smokingpipes.duplicateIdsAfter}`
    );
  }
  if (
    Number.isSafeInteger(expectedAppliedCount) &&
    expectedAppliedCount > 0 &&
    smokingpipes.touchedUniqueIds !== expectedAppliedCount
  ) {
    blockers.push(
      `touched Smokingpipes IDs ${smokingpipes.touchedUniqueIds} does not match expected appliedCount ${expectedAppliedCount}`
    );
  }

  const catalogPath = "data/generated/public-products/catalog.json";
  const lookupPath = "data/generated/public-products/detail-lookup.json";
  const catalog = rows(readWorktreeJson(root, catalogPath));
  const lookup = readWorktreeJson(root, lookupPath);
  const catalogIds = new Set(catalog.map(productId));
  const lookupIds = new Set(Object.keys(lookup?.byId || {}));
  const catalogMissingLookup = [...catalogIds].filter(
    (id) => !lookupIds.has(id)
  ).length;
  const lookupMissingCatalog = [...lookupIds].filter(
    (id) => !catalogIds.has(id)
  ).length;
  if (duplicateCount(catalog)) {
    blockers.push(`duplicate public catalog IDs=${duplicateCount(catalog)}`);
  }
  if (catalogMissingLookup || lookupMissingCatalog) {
    blockers.push(
      `public catalog/detail lookup mismatch catalogMissingLookup=${catalogMissingLookup} lookupMissingCatalog=${lookupMissingCatalog}`
    );
  }

  return {
    status: blockers.length ? "FAIL" : "PASS",
    blockers,
    changedFiles,
    disallowedFiles,
    smokingpipes,
    publicIndex: {
      catalogCount: catalog.length,
      detailLookupCount: lookupIds.size,
      catalogMissingLookup,
      lookupMissingCatalog,
    },
  };
}

function runCli() {
  const args = parseArgs();
  const root = path.resolve(String(args.get("root") || process.cwd()));
  const expectedRaw = args.get("expected-applied-count");
  const expectedAppliedCount =
    expectedRaw === undefined
      ? null
      : Number.parseInt(String(expectedRaw), 10);
  if (
    expectedRaw !== undefined &&
    (!Number.isSafeInteger(expectedAppliedCount) || expectedAppliedCount <= 0)
  ) {
    throw new Error("--expected-applied-count must be a positive integer.");
  }
  const report = auditPostApplyProductionDiff({
    root,
    expectedAppliedCount,
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "PASS") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
