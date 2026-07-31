import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  assertExternalStateRoot,
  cycleIdForDate,
  cyclePaths,
  hashFile,
  hashJson,
  loadOrCreateCycle,
  readJson,
  transitionCycle,
  writeJsonAtomic,
} from "./smokingpipes-cycle-store-v2.mjs";
import {
  createProgressiveDailyState,
  readProgressiveDailyState,
} from "./smokingpipes-progressive-state-v1.mjs";

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function isFalcon(candidate) {
  return /\bfalcon\b/i.test(
    [
      candidate?.brand,
      candidate?.listBrand,
      candidate?.convertedProduct?.brand,
      candidate?.convertedProduct?.brandName,
      candidate?.detail?.brand,
    ].map(text).join(" ")
  );
}

async function jsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.promises.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function sourceHash(paths) {
  const hashes = {};
  for (const [name, filePath] of Object.entries(paths)) {
    if (fs.existsSync(filePath)) hashes[name] = await hashFile(filePath);
  }
  return hashJson(hashes);
}

function migrationPlan({ progressiveState, currentList, diff }) {
  const state = structuredClone(
    progressiveState || createProgressiveDailyState({ dailyRunId: "v2-migration" })
  );
  const candidates = Array.isArray(state.candidates) ? state.candidates : [];
  const included = candidates.filter((candidate) => !isFalcon(candidate));
  state.candidates = included;
  state.productionWritten = false;
  const details = included
    .filter((candidate) => candidate.detail || candidate.convertedProduct)
    .map((candidate) => ({
      sourceProductId: text(candidate.sourceProductId),
      detailStatus: candidate.detailStatus,
      detail: candidate.detail || null,
      convertedProduct: candidate.convertedProduct || null,
      publicStatus: candidate.publicStatus || "not-public",
      lastError: candidate.lastError || null,
    }))
    .filter((candidate) => candidate.sourceProductId);
  const pendingDetailIds = included
    .filter((candidate) => ["pending", "blocked"].includes(candidate.detailStatus))
    .map((candidate) => text(candidate.sourceProductId))
    .filter(Boolean)
    .sort();
  const absenceCounters =
    state.globalReconcile?.disappearanceTracking?.items ||
    state.absenceCounters ||
    {};
  return {
    state,
    details,
    pendingDetailIds,
    absenceCounters,
    counts: {
      candidatesBefore: candidates.length,
      candidatesAfter: included.length,
      falconExcluded: candidates.length - included.length,
      completedDetails: details.filter((detail) => detail.detailStatus === "complete").length,
      pendingDetails: pendingDetailIds.length,
      absenceCounters: Object.keys(absenceCounters).length,
      explicitOutOfStock: included.filter((candidate) => (candidate.changeTypes || []).includes("explicit-out-of-stock")).length,
      reappeared: included.filter((candidate) => (candidate.changeTypes || []).includes("reappeared")).length,
      quarantined: included.filter((candidate) => ["failed", "review-only"].includes(candidate.detailStatus)).length,
    },
    hashes: {
      progressiveState: hashJson(state),
      details: hashJson(details),
      pendingDetailIds: hashJson(pendingDetailIds),
      absenceCounters: hashJson(absenceCounters),
      currentList: currentList ? hashJson(currentList) : null,
      diff: diff ? hashJson(diff) : null,
    },
  };
}

export async function migrateSmokingpipesRuntimeStateV2({
  stateRoot,
  runtimeRoot = process.cwd(),
  cycleId = cycleIdForDate(),
  apply = false,
} = {}) {
  const resolvedRuntimeRoot = path.resolve(runtimeRoot);
  const resolvedStateRoot = assertExternalStateRoot({ stateRoot, worktreeRoot: resolvedRuntimeRoot });
  const sources = {
    progressiveState: path.join(resolvedRuntimeRoot, "data", "inventory", "smokingpipes-progressive-daily-state.json"),
    currentList: path.join(resolvedRuntimeRoot, "data", "inventory", "smokingpipes-current-list-dry-run.json"),
    diff: path.join(resolvedRuntimeRoot, "data", "inventory", "smokingpipes-inventory-diff-dry-run.json"),
  };
  const progressiveRead = readProgressiveDailyState(sources.progressiveState);
  if (progressiveRead.status === "blocked") {
    throw new Error(`legacy progressive state is invalid: ${progressiveRead.errors.join("; ")}`);
  }
  const currentList = await jsonIfExists(sources.currentList);
  const diff = await jsonIfExists(sources.diff);
  const plan = migrationPlan({
    progressiveState: progressiveRead.state,
    currentList,
    diff,
  });
  const migrationSourceHash = await sourceHash(sources);
  const report = {
    schemaVersion: "smokingpipes-runtime-state-migration-v2",
    dryRun: !apply,
    stateRoot: resolvedStateRoot,
    runtimeRoot: resolvedRuntimeRoot,
    cycleId,
    sourceHash: migrationSourceHash,
    counts: plan.counts,
    hashes: plan.hashes,
    sourceFiles: sources,
  };
  if (!apply) return { status: "dry-run-passed", ...report };

  const markerPath = path.join(resolvedStateRoot, "migrations", "runtime-state-v2.json");
  const prior = await readJson(markerPath, null);
  if (prior?.sourceHash === migrationSourceHash) {
    return { status: "idempotent-noop", ...report, prior };
  }
  if (fs.existsSync(resolvedStateRoot)) {
    const backupRoot = path.join(
      path.dirname(resolvedStateRoot),
      `${path.basename(resolvedStateRoot)}-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`
    );
    await fs.promises.cp(resolvedStateRoot, backupRoot, { recursive: true, errorOnExist: true });
    report.backupRoot = backupRoot;
  }
  const { cycle: initialCycle } = await loadOrCreateCycle({
    stateRoot: resolvedStateRoot,
    cycleId,
  });
  const paths = cyclePaths(resolvedStateRoot, cycleId);
  let cycle = initialCycle;
  if (cycle.phase === "new") {
    cycle = await transitionCycle({
      stateRoot: resolvedStateRoot,
      cycle,
      phase: "collecting-list",
      reason: "runtime-state-migration-started",
    });
  }
  await writeJsonAtomic(paths.legacyProgressiveState, plan.state);
  for (const detail of plan.details) {
    await writeJsonAtomic(path.join(resolvedStateRoot, "details", `${detail.sourceProductId}.json`), {
      schemaVersion: "smokingpipes-detail-cache-v2",
      migratedAt: new Date().toISOString(),
      ...detail,
    });
  }
  await writeJsonAtomic(paths.detailQueue, {
    schemaVersion: "smokingpipes-detail-queue-v2",
    cycleId,
    migratedAt: new Date().toISOString(),
    pendingIds: plan.pendingDetailIds,
  });
  await writeJsonAtomic(path.join(resolvedStateRoot, "absence", "counters.json"), {
    schemaVersion: "smokingpipes-absence-counters-v2",
    migratedAt: new Date().toISOString(),
    items: plan.absenceCounters,
  });
  if (currentList) {
    await writeJsonAtomic(paths.listSnapshot, currentList);
    await writeJsonAtomic(paths.listManifest, {
      schemaVersion: "smokingpipes-list-manifest-v2",
      cycleId,
      migratedAt: new Date().toISOString(),
      snapshotHash: plan.hashes.currentList,
      diffHash: plan.hashes.diff,
      fullExpectedRangeScanned: currentList?.summary?.fullExpectedRangeScanned === true,
    });
  }
  if (diff) await writeJsonAtomic(paths.inventoryDiff, diff);
  const nextPhase = plan.pendingDetailIds.length ? "enriching-details" : "ready-to-bundle";
  if (cycle.phase === "collecting-list") {
    cycle = await transitionCycle({
      stateRoot: resolvedStateRoot,
      cycle,
      phase: "list-ready",
      reason: "runtime-state-migrated",
      patch: {
        collection: {
          ...cycle.collection,
          trustedSnapshot: currentList ? { path: path.relative(resolvedStateRoot, paths.listSnapshot).replace(/\\/g, "/"), hash: plan.hashes.currentList } : null,
          pendingDetailIds: plan.pendingDetailIds,
          completedDetailIds: plan.details.map((detail) => detail.sourceProductId).sort(),
          observedCandidateCount: plan.counts.candidatesAfter,
        },
      },
    });
  }
  cycle = await transitionCycle({
    stateRoot: resolvedStateRoot,
    cycle,
    phase: nextPhase,
    reason: "runtime-state-migration-complete",
  });
  await writeJsonAtomic(markerPath, {
    ...report,
    dryRun: false,
    completedAt: new Date().toISOString(),
    resultingCyclePhase: cycle.phase,
  });
  return { status: "migrated", ...report, cycle };
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
  if (!stateRoot) throw new Error("--state-root is required");
  const apply = options.get("apply") === true || options.get("apply") === "true";
  const result = await migrateSmokingpipesRuntimeStateV2({
    stateRoot,
    runtimeRoot: options.get("runtime-root") || process.cwd(),
    cycleId: options.get("cycle-id") || cycleIdForDate(),
    apply,
  });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"))) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
