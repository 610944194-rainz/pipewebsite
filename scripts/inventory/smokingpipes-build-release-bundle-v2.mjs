import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  buildUnifiedProductsFromInputs,
} from "../build-unified-products-staging-v1.mjs";
import {
  buildPublicProductsFullCandidate,
  loadPublicProductsPricingContext,
} from "../build-public-product-indexes-v1.mjs";
import {
  buildProgressivePartialProducts,
  selectProgressiveRecentNew,
} from "./smokingpipes-progressive-candidate-v1.mjs";
import {
  cyclePaths,
  hashFile,
  hashJson,
  hashText,
  readCycle,
  readJson,
  transitionCycle,
  writeJsonAtomic,
} from "./smokingpipes-cycle-store-v2.mjs";
import {
  readProgressiveDailyState,
} from "./smokingpipes-progressive-state-v1.mjs";

export const SMOKINGPIPES_BUNDLE_SCHEMA_V2 = "smokingpipes-release-bundle-v2";
export const GIT_JSON_MAX_BUFFER_BYTES = 128 * 1024 * 1024;

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function stableCompare(left, right) {
  return text(left).localeCompare(text(right), "en", { numeric: true, sensitivity: "base" });
}

function sourceProductId(product) {
  return text(product?.sourceProductId);
}

function isFalcon(value) {
  return /\bfalcon\b/i.test(
    [
      value?.brand,
      value?.listBrand,
      value?.convertedProduct?.brand,
      value?.convertedProduct?.brandName,
      value?.detail?.brand,
      value?.brandName,
    ].map(text).join(" ")
  );
}

export function readJsonAtGitRef({ runtimeRoot, ref, relativePath }) {
  const normalizedPath = relativePath.replace(/\\/g, "/");
  try {
    const raw = execFileSync("git", ["-C", runtimeRoot, "show", `${ref}:${normalizedPath}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: GIT_JSON_MAX_BUFFER_BYTES,
    });
    return JSON.parse(raw);
  } catch (error) {
    const code = String(error?.code || "unknown");
    const message = text(error?.message).slice(0, 500);
    throw new Error(`git JSON read failed: ref=${ref}; relativePath=${normalizedPath}; code=${code}; maxBuffer=${GIT_JSON_MAX_BUFFER_BYTES}; message=${message}`);
  }
}

function resolveGitSha(runtimeRoot, ref) {
  return execFileSync("git", ["-C", runtimeRoot, "rev-parse", ref], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function actualChanges(before = [], after = [], candidateById = new Map()) {
  const beforeById = new Map(before.map((product) => [sourceProductId(product), product]));
  const afterById = new Map(after.map((product) => [sourceProductId(product), product]));
  const changes = [];
  for (const id of [...new Set([...beforeById.keys(), ...afterById.keys()])].filter(Boolean).sort(stableCompare)) {
    const previous = beforeById.get(id) || null;
    const next = afterById.get(id) || null;
    if (JSON.stringify(previous) === JSON.stringify(next)) continue;
    const candidate = candidateById.get(id);
    let changeType = "other";
    if (!previous && next) changeType = "new-product";
    else if ((candidate?.changeTypes || []).includes("explicit-out-of-stock")) changeType = "explicit-out-of-stock";
    else if ((candidate?.changeTypes || []).includes("confirmed-disappeared")) changeType = "confirmed-disappeared";
    else if ((candidate?.changeTypes || []).includes("reappeared")) changeType = "reappeared";
    else if ((candidate?.changeTypes || []).includes("price-change")) changeType = "price-change";
    changes.push({
      sourceProductId: id,
      changeType,
      beforeHash: previous ? hashJson(previous) : null,
      afterHash: next ? hashJson(next) : null,
    });
  }
  return changes;
}

function publicManifest({ publicCandidate, recentNew, generatedAt, stagingHash, detailFiles }) {
  return {
    schemaVersion: 1,
    generatorVersion: "smokingpipes-release-bundle-v2",
    generatedAt,
    productionWritten: false,
    publicProductCount: publicCandidate.catalog.products.length,
    excludedProductCount: publicCandidate.excludedCount,
    brandCount: publicCandidate.brands.brands.length,
    detailCount: publicCandidate.details.length,
    detailShardCount: publicCandidate.detailShards.length,
    detailFiles,
    recentNewCount: recentNew.length,
    inputHashes: { staging: stagingHash },
  };
}

function serializedJsonForAtomicWrite(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function bundleOutputMap({ smokingpipesProducts, unifiedProducts, publicCandidate, recentNew, generatedAt }) {
  const output = new Map();
  output.set("data/products/smokingpipes-products.json", smokingpipesProducts);
  output.set("data/products/unified-products-staging.json", unifiedProducts);
  output.set("data/generated/public-products/catalog.json", publicCandidate.catalog);
  output.set("data/generated/public-products/filters.json", publicCandidate.filters);
  output.set("data/generated/public-products/brands.json", publicCandidate.brands);
  output.set("data/generated/public-products/detail-lookup.json", publicCandidate.lookup);
  output.set("data/generated/public-products/recent-new.json", {
    schemaVersion: 1,
    generatedAt,
    source: "smokingpipes",
    products: recentNew,
  });
  for (const shard of publicCandidate.detailShards) {
    output.set(`data/generated/public-products/details/${shard.shard}.json`, shard.content);
  }
  const detailFiles = [...output.keys()]
    .filter((file) => file.startsWith("data/generated/public-products/details/"))
    .sort(stableCompare);
  output.set("data/generated/public-products/manifest.json", publicManifest({
    publicCandidate,
    recentNew,
    generatedAt,
    stagingHash: hashText(serializedJsonForAtomicWrite(unifiedProducts)),
    detailFiles,
  }));
  return output;
}

async function writeBundleOutput(bundleRoot, outputMap) {
  const hashes = {};
  for (const [relativeFile, value] of outputMap) {
    const target = path.join(bundleRoot, "outputs", relativeFile);
    await writeJsonAtomic(target, value);
    hashes[relativeFile] = await hashFile(target);
  }
  return Object.fromEntries(Object.entries(hashes).sort(([left], [right]) => stableCompare(left, right)));
}

async function readBaseline({ runtimeRoot, baseMainSha, baselineRoot }) {
  if (baselineRoot) {
    const read = async (relativePath) =>
      JSON.parse(await fs.promises.readFile(path.join(baselineRoot, relativePath), "utf8"));
    return {
      smokingpipesProducts: await read("data/products/smokingpipes-products.json"),
      danishProducts: await read("data/products/danish-products.json"),
    };
  }
  return {
    smokingpipesProducts: readJsonAtGitRef({
      runtimeRoot,
      ref: baseMainSha,
      relativePath: "data/products/smokingpipes-products.json",
    }),
    danishProducts: readJsonAtGitRef({
      runtimeRoot,
      ref: baseMainSha,
      relativePath: "data/products/danish-products.json",
    }),
  };
}

export async function buildSmokingpipesReleaseBundleV2({
  stateRoot,
  cycleId,
  runtimeRoot = process.cwd(),
  baseMainSha = null,
  baselineRoot = null,
  generatorCommitSha = null,
  maxAutoApply = 2000,
} = {}) {
  const cycle = await readCycle(stateRoot, cycleId);
  if (!cycle) throw new Error(`cycle not found: ${cycleId}`);
  if (!["ready-to-bundle", "bundle-ready", "release-retryable"].includes(cycle.phase)) {
    throw new Error(`cycle is not eligible for bundle build: ${cycle.phase}`);
  }
  const paths = cyclePaths(stateRoot, cycleId);
  const stateRead = readProgressiveDailyState(paths.legacyProgressiveState);
  if (stateRead.status !== "passed") {
    throw new Error(`progressive state is invalid: ${stateRead.errors.join("; ")}`);
  }
  const state = structuredClone(stateRead.state);
  state.candidates = state.candidates.filter((candidate) => !isFalcon(candidate));
  const sourceManifest = await readJson(paths.listManifest, null);
  if (!sourceManifest?.snapshotHash) throw new Error("trusted source snapshot manifest is missing");
  const resolvedRuntimeRoot = path.resolve(runtimeRoot);
  const resolvedBaseMainSha = baseMainSha || resolveGitSha(resolvedRuntimeRoot, "origin/main");
  const resolvedGeneratorCommitSha = generatorCommitSha || resolveGitSha(resolvedRuntimeRoot, "HEAD");
  const baseline = await readBaseline({
    runtimeRoot: resolvedRuntimeRoot,
    baseMainSha: resolvedBaseMainSha,
    baselineRoot,
  });
  const candidate = buildProgressivePartialProducts({
    productionProducts: baseline.smokingpipesProducts,
    state,
    now: cycle.updatedAt,
  });
  // The final bundle contract excludes Falcon products, including legacy
  // baseline rows which are not part of the current detail queue.  Keep the
  // resulting removals in the immutable before/after diff so they are
  // explicitly selected, validated, and published rather than disappearing
  // as an untracked side effect.
  candidate.products = candidate.products.filter((product) => !isFalcon(product));
  const candidatesById = new Map(state.candidates.map((item) => [sourceProductId(item), item]));
  const changes = actualChanges(
    baseline.smokingpipesProducts,
    candidate.products,
    candidatesById
  );
  const selectedIds = changes.map((item) => item.sourceProductId);
  if (selectedIds.length !== new Set(selectedIds).size) {
    throw new Error("bundle selected IDs are not unique");
  }
  if (selectedIds.length > Number(maxAutoApply)) {
    throw new Error(`bundle selected IDs exceed maxAutoApply: ${selectedIds.length} > ${maxAutoApply}`);
  }
  if (!changes.length) {
    const noChangeCycle = await transitionCycle({
      stateRoot,
      cycle,
      phase: "no-change",
      reason: "actual-before-after-diff-is-empty",
      patch: {
        bundle: {
          bundleId: null,
          actualAppliedCount: 0,
          selectedIds: [],
          baseMainSha: resolvedBaseMainSha,
        },
      },
    });
    return { status: "no-change", cycle: noChangeCycle, selectedIds: [] };
  }
  const unifiedProducts = buildUnifiedProductsFromInputs({
    danishProducts: baseline.danishProducts,
    smokingpipesProducts: candidate.products,
  });
  const pricingContext = await loadPublicProductsPricingContext();
  const publicCandidate = buildPublicProductsFullCandidate(unifiedProducts, pricingContext);
  const recentNew = selectProgressiveRecentNew({
    catalog: publicCandidate.catalog.products,
    newProductIds: candidate.newProductIds,
  });
  const selectedDetailHashes = Object.fromEntries(
    selectedIds.sort(stableCompare).map((id) => {
      const selected = candidatesById.get(id);
      return [id, hashJson({
        detail: selected?.detail || null,
        convertedProduct: selected?.convertedProduct || null,
      })];
    })
  );
  const bundleId = hashJson({
    baseMainSha: resolvedBaseMainSha,
    sourceSnapshotHash: sourceManifest.snapshotHash,
    selectedDetailHashes,
    generatorCommitSha: resolvedGeneratorCommitSha,
    schemaVersion: SMOKINGPIPES_BUNDLE_SCHEMA_V2,
  });
  const bundleRoot = path.join(paths.bundleRoot, bundleId);
  if (fs.existsSync(bundleRoot)) {
    const existing = await readJson(path.join(bundleRoot, "manifest.json"), null);
    if (existing?.bundleId === bundleId) {
      return { status: "bundle-ready", reused: true, bundleId, manifest: existing, cycle };
    }
    throw new Error(`bundle directory is already occupied: ${bundleRoot}`);
  }
  const generatedAt = new Date().toISOString();
  const outputMap = bundleOutputMap({
    smokingpipesProducts: candidate.products,
    unifiedProducts,
    publicCandidate,
    recentNew,
    generatedAt,
  });
  const outputFileHashes = await writeBundleOutput(bundleRoot, outputMap);
  const countByType = Object.fromEntries(
    [...new Set(changes.map((change) => change.changeType))]
      .sort(stableCompare)
      .map((type) => [type, changes.filter((change) => change.changeType === type).length])
  );
  const manifest = {
    schemaVersion: SMOKINGPIPES_BUNDLE_SCHEMA_V2,
    bundleId,
    cycleId,
    createdAt: generatedAt,
    baseMainSha: resolvedBaseMainSha,
    generatorCommitSha: resolvedGeneratorCommitSha,
    sourceSnapshotHash: sourceManifest.snapshotHash,
    selectedIds: [...selectedIds].sort(stableCompare),
    selectedDetailHashes,
    changeTypeCounts: countByType,
    actualAppliedCount: selectedIds.length,
    maxAutoApply: Number(maxAutoApply),
    outputFileHashes,
    featuredExcluded: true,
  };
  const summary = {
    schemaVersion: SMOKINGPIPES_BUNDLE_SCHEMA_V2,
    bundleId,
    cycleId,
    plannedChangeCount: selectedIds.length,
    actualAppliedCount: selectedIds.length,
    changeTypeCounts: countByType,
    selectedIds: manifest.selectedIds,
  };
  await writeJsonAtomic(path.join(bundleRoot, "inputs", "list-manifest.json"), sourceManifest);
  await writeJsonAtomic(path.join(bundleRoot, "inputs", "selected-detail-hashes.json"), selectedDetailHashes);
  await writeJsonAtomic(path.join(bundleRoot, "changes.json"), changes);
  await writeJsonAtomic(path.join(bundleRoot, "summary.json"), summary);
  await writeJsonAtomic(path.join(bundleRoot, "manifest.json"), manifest);
  const nextCycle = await transitionCycle({
    stateRoot,
    cycle,
    phase: "bundle-ready",
    reason: "immutable-bundle-created",
    patch: {
      bundle: {
        bundleId,
        path: path.relative(stateRoot, bundleRoot).replace(/\\/g, "/"),
        baseMainSha: resolvedBaseMainSha,
        actualAppliedCount: selectedIds.length,
        selectedIds: manifest.selectedIds,
      },
    },
  });
  return { status: "bundle-ready", bundleId, bundleRoot, manifest, summary, cycle: nextCycle };
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
  const stateRoot = options.get("state-root");
  const cycleId = options.get("cycle-id");
  if (!stateRoot || !cycleId) throw new Error("--state-root and --cycle-id are required");
  const result = await buildSmokingpipesReleaseBundleV2({
    stateRoot,
    cycleId,
    runtimeRoot: options.get("runtime-root") || process.cwd(),
    baseMainSha: options.get("base-main-sha") || null,
    maxAutoApply: options.get("max-auto-apply") || 2000,
  });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"))) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
