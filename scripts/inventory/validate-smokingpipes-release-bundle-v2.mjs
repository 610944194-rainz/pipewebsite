import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  hashFile,
  hashJson,
  readJson,
  writeJsonAtomic,
} from "./smokingpipes-cycle-store-v2.mjs";
import {
  SMOKINGPIPES_BUNDLE_SCHEMA_V2,
  readJsonAtGitRef,
} from "./smokingpipes-build-release-bundle-v2.mjs";

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function sourceProductId(product) {
  return text(product?.sourceProductId);
}

function isOwnedOutputFile(relativeFile) {
  const normalized = String(relativeFile || "").replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    return false;
  }
  return normalized === "data/products/smokingpipes-products.json" ||
    normalized === "data/products/unified-products-staging.json" ||
    normalized.startsWith("data/generated/public-products/");
}

function actualChangedIds(before = [], after = []) {
  const beforeById = new Map(before.map((product) => [sourceProductId(product), product]));
  const afterById = new Map(after.map((product) => [sourceProductId(product), product]));
  return [...new Set([...beforeById.keys(), ...afterById.keys()])]
    .filter(Boolean)
    .filter((id) => JSON.stringify(beforeById.get(id) || null) !== JSON.stringify(afterById.get(id) || null))
    .sort();
}

function readBaselineAtGitRef(runtimeRoot, ref) {
  return readJsonAtGitRef({
    runtimeRoot,
    ref,
    relativePath: "data/products/smokingpipes-products.json",
  });
}

async function baselineProducts({ runtimeRoot, baselineRoot, baseMainSha }) {
  if (baselineRoot) {
    return JSON.parse(
      await fs.promises.readFile(
        path.join(baselineRoot, "data", "products", "smokingpipes-products.json"),
        "utf8"
      )
    );
  }
  return readBaselineAtGitRef(runtimeRoot, baseMainSha);
}

export async function validateSmokingpipesReleaseBundleV2({
  bundleRoot,
  runtimeRoot = null,
  baselineRoot = null,
  writeReport = true,
} = {}) {
  const resolvedBundleRoot = path.resolve(bundleRoot || "");
  const blockers = [];
  const warnings = [];
  const manifest = await readJson(path.join(resolvedBundleRoot, "manifest.json"), null);
  const summary = await readJson(path.join(resolvedBundleRoot, "summary.json"), null);
  const changes = await readJson(path.join(resolvedBundleRoot, "changes.json"), null);
  if (!manifest || manifest.schemaVersion !== SMOKINGPIPES_BUNDLE_SCHEMA_V2) {
    blockers.push("bundle manifest schema is invalid");
  }
  if (!summary || !Array.isArray(changes)) blockers.push("bundle summary or changes is missing");
  const selectedIds = Array.isArray(manifest?.selectedIds) ? manifest.selectedIds.map(String) : [];
  if (!selectedIds.length) blockers.push("bundle selectedIds is empty");
  if (selectedIds.length !== new Set(selectedIds).size) blockers.push("bundle selectedIds is not unique");
  if ([...selectedIds].sort().join("\n") !== selectedIds.join("\n")) {
    blockers.push("bundle selectedIds is not sorted");
  }
  if (Number(manifest?.actualAppliedCount) !== selectedIds.length) {
    blockers.push("manifest actualAppliedCount does not match selectedIds");
  }
  if (selectedIds.length > Number(manifest?.maxAutoApply)) {
    blockers.push("manifest selected IDs exceed maxAutoApply");
  }
  const countTotal = Object.values(manifest?.changeTypeCounts || {}).reduce(
    (total, value) => total + Number(value || 0),
    0
  );
  if (countTotal !== selectedIds.length) blockers.push("change type counts do not match selected IDs");
  if (changes?.length !== selectedIds.length) blockers.push("changes do not match selected IDs");
  if (new Set((changes || []).map((change) => text(change.sourceProductId))).size !== changes?.length) {
    blockers.push("changes contain duplicate source product IDs");
  }
  if ((changes || []).some((change) => !selectedIds.includes(text(change.sourceProductId)))) {
    blockers.push("changes contain IDs outside selectedIds");
  }
  if (manifest?.featuredExcluded !== true) blockers.push("bundle does not explicitly exclude featured.json");
  const outputHashes = manifest?.outputFileHashes || {};
  const outputFiles = Object.keys(outputHashes);
  if (!outputFiles.length) blockers.push("bundle output file hashes are empty");
  for (const relativeFile of outputFiles) {
    if (!isOwnedOutputFile(relativeFile)) {
      blockers.push(`bundle owns a non-Smokingpipes output path: ${relativeFile}`);
    }
    if (/(^|\/)featured\.json$/i.test(String(relativeFile).replace(/\\/g, "/"))) {
      blockers.push("bundle must not own featured.json");
    }
  }
  for (const [relativeFile, expectedHash] of Object.entries(outputHashes)) {
    const target = path.join(resolvedBundleRoot, "outputs", relativeFile);
    if (!fs.existsSync(target)) {
      blockers.push(`bundle output is missing: ${relativeFile}`);
    } else if ((await hashFile(target)) !== expectedHash) {
      blockers.push(`bundle output hash mismatch: ${relativeFile}`);
    }
  }
  const products = await readJson(
    path.join(resolvedBundleRoot, "outputs", "data", "products", "smokingpipes-products.json"),
    null
  );
  const unified = await readJson(
    path.join(resolvedBundleRoot, "outputs", "data", "products", "unified-products-staging.json"),
    null
  );
  const publicManifestPath = path.join(
    resolvedBundleRoot,
    "outputs",
    "data",
    "generated",
    "public-products",
    "manifest.json"
  );
  const stagingPath = path.join(
    resolvedBundleRoot,
    "outputs",
    "data",
    "products",
    "unified-products-staging.json"
  );
  const publicManifest = await readJson(publicManifestPath, null);
  const catalog = await readJson(
    path.join(resolvedBundleRoot, "outputs", "data", "generated", "public-products", "catalog.json"),
    null
  );
  const lookup = await readJson(
    path.join(resolvedBundleRoot, "outputs", "data", "generated", "public-products", "detail-lookup.json"),
    null
  );
  if (!Array.isArray(products) || !Array.isArray(unified) || !Array.isArray(catalog?.products)) {
    blockers.push("bundle output structure is invalid");
  } else {
    const falcon = products.filter((product) => /\bfalcon\b/i.test([product.brand, product.brandName].map(text).join(" ")));
    if (falcon.length) blockers.push(`Falcon products leaked into bundle outputs: ${falcon.length}`);
    const unifiedIds = new Set(unified.map((product) => text(product.id)));
    for (const product of catalog.products) {
      if (!unifiedIds.has(text(product.id))) {
        blockers.push(`catalog product is missing from unified staging: ${text(product.id)}`);
      }
      if (!lookup?.byId?.[text(product.id)]) {
        blockers.push(`catalog product is missing from detail lookup: ${text(product.id)}`);
      }
    }
  }
  const expectedStagingHash = text(publicManifest?.inputHashes?.staging);
  if (!expectedStagingHash) {
    blockers.push("retained bundle public staging hash is missing");
  } else if (!fs.existsSync(stagingPath)) {
    blockers.push("retained bundle staging output is missing");
  } else {
    const actualStagingHash = await hashFile(stagingPath);
    if (expectedStagingHash.toLowerCase() !== actualStagingHash.toLowerCase()) {
      blockers.push("retained bundle public staging hash mismatch");
    }
  }
  if (runtimeRoot || baselineRoot) {
    try {
      const baseline = await baselineProducts({
        runtimeRoot: runtimeRoot || process.cwd(),
        baselineRoot,
        baseMainSha: manifest.baseMainSha,
      });
      const actualIds = actualChangedIds(baseline, products || []);
      if (JSON.stringify(actualIds) !== JSON.stringify(selectedIds)) {
        blockers.push("selected IDs do not equal actual before/after product diff");
      }
      const byId = new Map((products || []).map((product) => [sourceProductId(product), product]));
      for (const change of changes || []) {
        const after = byId.get(text(change.sourceProductId)) || null;
        const afterHashMatches = change.afterHash === null
          ? after === null
          : hashJson(after) === change.afterHash;
        if (!afterHashMatches) {
          blockers.push(`change after hash mismatch: ${text(change.sourceProductId)}`);
        }
      }
    } catch (error) {
      blockers.push(`baseline validation failed: ${error.message}`);
    }
  } else {
    warnings.push("baseline was not supplied; selected IDs were not reconciled against before/after data");
  }
  const report = {
    schemaVersion: "smokingpipes-release-bundle-validation-v2",
    bundleId: manifest?.bundleId || null,
    valid: blockers.length === 0,
    blockers: [...new Set(blockers)],
    warnings,
    validatedAt: new Date().toISOString(),
  };
  if (writeReport) {
    await writeJsonAtomic(path.join(resolvedBundleRoot, "validation", "bundle-validator.json"), report);
  }
  return report;
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = new Map();
  for (const argument of argv) {
    const [key, ...rest] = argument.replace(/^--/, "").split("=");
    options.set(key, rest.length ? rest.join("=") : true);
  }
  return options;
}

async function main() {
  const options = parseArgs();
  const bundleRoot = options.get("bundle-root");
  if (!bundleRoot) throw new Error("--bundle-root is required");
  const result = await validateSmokingpipesReleaseBundleV2({
    bundleRoot,
    runtimeRoot: options.get("runtime-root") || null,
    baselineRoot: options.get("baseline-root") || null,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"))) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
