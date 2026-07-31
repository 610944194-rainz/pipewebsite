import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  buildInventoryDiff,
} from "./smokingpipes-diff-inventory-v1.mjs";
import {
  fetchSmokingpipesCurrentList,
} from "./smokingpipes-fetch-current-list-v1.mjs";
import {
  runSmokingpipesProgressiveMode,
} from "./smokingpipes-progressive-runner-v1.mjs";
import {
  readProgressiveDailyState,
} from "./smokingpipes-progressive-state-v1.mjs";
import {
  assertExternalStateRoot,
  cycleIdForDate,
  cyclePaths,
  hashJson,
  loadOrCreateCycle,
  recordQuarantinedProduct,
  readJson,
  transitionCycle,
  writeJsonAtomic,
} from "./smokingpipes-cycle-store-v2.mjs";

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function items(payload) {
  return Array.isArray(payload) ? payload : payload?.products || [];
}

async function readJsonFile(filePath) {
  return JSON.parse(await fs.promises.readFile(filePath, "utf8"));
}

function trustedListReason(payload) {
  const summary = payload?.summary || {};
  if (!items(payload).length) return "list snapshot is empty";
  if (summary.fullExpectedRangeScanned !== true) {
    return "list snapshot did not scan the full expected range";
  }
  if (
    summary.captchaDetected === true ||
    summary.verificationDetected === true ||
    summary.verificationDetectedAt
  ) {
    return "list snapshot contains CAPTCHA or verification evidence";
  }
  if ((summary.failedPages || []).length) return "list snapshot contains failed pages";
  const ids = items(payload).map((item) => text(item.sourceProductId)).filter(Boolean);
  if (new Set(ids).size !== ids.length) return "list snapshot has duplicate source product IDs";
  return null;
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

function progressiveOverrides({ runtimeRoot, paths, stateRoot, cycleId }) {
  const runtimeData = path.join(runtimeRoot, "data");
  return {
    progressiveState: paths.legacyProgressiveState,
    progressiveLock: path.join(stateRoot, "locks", `progressive-${cycleId}.lock`),
    currentList: paths.listSnapshot,
    diff: paths.inventoryDiff,
    progressiveReportJson: path.join(paths.logs, "progressive-report.json"),
    progressiveReportMarkdown: path.join(paths.logs, "progressive-report.md"),
    progressiveBrandExclusionReportJson: path.join(paths.logs, "brand-exclusions.json"),
    progressiveBrandExclusionReportMarkdown: path.join(paths.logs, "brand-exclusions.md"),
    progressiveAuditJson: path.join(paths.logs, "progressive-audit.json"),
    progressiveAuditMarkdown: path.join(paths.logs, "progressive-audit.md"),
    progressiveApplyPreview: path.join(paths.logs, "legacy-apply-preview.json"),
    progressiveApplyGateReport: path.join(paths.logs, "legacy-apply-gate.json"),
    progressiveProductsNext: path.join(paths.root, "scratch", "smokingpipes-products-next.json"),
    progressivePublicNextRoot: path.join(paths.root, "scratch", "public-products"),
    browserProfileLock: path.join(stateRoot, "locks", "browser-profile.lock"),
    existingProducts: path.join(runtimeData, "products", "smokingpipes-products.json"),
    danishProducts: path.join(runtimeData, "products", "danish-products.json"),
    productionPublicRoot: path.join(runtimeData, "generated", "public-products"),
  };
}

async function persistDetail({ stateRoot, candidate }) {
  const id = text(candidate?.sourceProductId);
  if (!id) return;
  await writeJsonAtomic(path.join(stateRoot, "details", `${id}.json`), {
    schemaVersion: "smokingpipes-detail-cache-v2",
    sourceProductId: id,
    savedAt: new Date().toISOString(),
    detailStatus: candidate.detailStatus,
    detail: candidate.detail || null,
    convertedProduct: candidate.convertedProduct || null,
    publicStatus: candidate.publicStatus || "not-public",
    lastError: candidate.lastError || null,
  });
}

function collectionSummary(state) {
  const candidates = state?.candidates || [];
  return {
    observedCandidateCount: candidates.length,
    pendingDetailIds: candidates
      .filter((candidate) => candidate.detailStatus === "pending" || candidate.detailStatus === "blocked")
      .map((candidate) => text(candidate.sourceProductId))
      .filter(Boolean)
      .sort(),
    completedDetailIds: candidates
      .filter((candidate) => candidate.detailStatus === "complete")
      .map((candidate) => text(candidate.sourceProductId))
      .filter(Boolean)
      .sort(),
    quarantinedDetailIds: candidates
      .filter((candidate) => candidate.detailStatus === "failed" || candidate.detailStatus === "review-only")
      .map((candidate) => text(candidate.sourceProductId))
      .filter(Boolean)
      .sort(),
  };
}

export async function runSmokingpipesCollectOnlyV2({
  stateRoot,
  runtimeRoot = process.cwd(),
  cycleId = cycleIdForDate(),
  listInputPath = null,
  live = false,
  detailLimit = 50,
  maxAutoApply = 2000,
  processDetail = null,
  fetchOptions = {},
} = {}) {
  const resolvedRuntimeRoot = path.resolve(runtimeRoot);
  const resolvedStateRoot = assertExternalStateRoot({
    stateRoot,
    worktreeRoot: resolvedRuntimeRoot,
  });
  const { cycle: initialCycle } = await loadOrCreateCycle({
    stateRoot: resolvedStateRoot,
    cycleId,
  });
  const paths = cyclePaths(resolvedStateRoot, cycleId);
  let cycle = initialCycle;

  if (["bundle-ready", "release-retryable"].includes(cycle.phase)) {
    return { status: "release-resume-required", cycle, networkAccessed: false };
  }
  if (["published", "no-change"].includes(cycle.phase)) {
    return { status: "same-day-complete", cycle, networkAccessed: false };
  }

  const overrides = progressiveOverrides({
    runtimeRoot: resolvedRuntimeRoot,
    paths,
    stateRoot: resolvedStateRoot,
    cycleId,
  });
  let snapshot = await readJson(paths.listSnapshot, null);
  let networkAccessed = false;

  if (!snapshot || ["new", "collecting-list"].includes(cycle.phase)) {
    cycle = await transitionCycle({
      stateRoot: resolvedStateRoot,
      cycle,
      phase: "collecting-list",
      reason: "collect-list",
      patch: {
        attempts: { ...cycle.attempts, list: Number(cycle.attempts?.list || 0) + 1 },
      },
    });
    try {
      if (listInputPath) {
        snapshot = await readJsonFile(path.resolve(listInputPath));
      } else if (live) {
        networkAccessed = true;
        snapshot = await fetchSmokingpipesCurrentList({
          root: resolvedRuntimeRoot,
          runId: `v2-${cycleId}`,
          mode: "v2-collect-only",
          browserChannel: "chrome",
          browserProfile: "sp-chrome",
          browserProfileLockPath: overrides.browserProfileLock,
          useCheckpoint: false,
          writeCurrentList: false,
          writeDuplicateAudit: false,
          writeOutOfStockTailCache: false,
          failureSnapshotDir: path.join(paths.logs, "failure-snapshots"),
          ...fetchOptions,
        });
      } else {
        throw new Error("no list input supplied and live collection is disabled");
      }
      const trustFailure = trustedListReason(snapshot);
      if (trustFailure) throw new Error(trustFailure);
      const productionProducts = await readJsonFile(overrides.existingProducts);
      const diff = buildInventoryDiff(snapshot, productionProducts, { maxAutoApply });
      await writeJsonAtomic(paths.listSnapshot, snapshot);
      await writeJsonAtomic(paths.inventoryDiff, diff);
      await writeJsonAtomic(paths.listManifest, {
        schemaVersion: "smokingpipes-list-manifest-v2",
        cycleId,
        capturedAt: new Date().toISOString(),
        snapshotHash: hashJson(snapshot),
        diffHash: hashJson(diff),
        expectedPages: snapshot.summary?.expectedPages ?? null,
        effectiveScannedPages: snapshot.summary?.effectiveScannedPages ?? null,
        fullExpectedRangeScanned: snapshot.summary?.fullExpectedRangeScanned === true,
      });
      cycle = await transitionCycle({
        stateRoot: resolvedStateRoot,
        cycle,
        phase: "list-ready",
        reason: "trusted-list-persisted",
        patch: {
          collection: {
            ...cycle.collection,
            trustedSnapshot: {
              path: path.relative(resolvedStateRoot, paths.listSnapshot).replace(/\\/g, "/"),
              hash: hashJson(snapshot),
            },
          },
        },
      });
    } catch (error) {
      cycle = await transitionCycle({
        stateRoot: resolvedStateRoot,
        cycle,
        phase: "collection-retryable",
        reason: "list-collection-failed",
        patch: {
          failure: { stage: "list", message: error.message, at: new Date().toISOString() },
        },
      });
      return { status: "collection-retryable", cycle, networkAccessed, error: error.message };
    }
  }

  if (snapshot && cycle.phase === "collection-retryable") {
    cycle = await transitionCycle({
      stateRoot: resolvedStateRoot,
      cycle,
      phase: "list-ready",
      reason: "trusted-list-resume-without-source-refetch",
    });
  }

  if (cycle.phase === "list-ready") {
    const ingest = await runSmokingpipesProgressiveMode({
      root: resolvedRuntimeRoot,
      options: {
        mode: "progressive-ingest-list",
        stateRoot: resolvedStateRoot,
        pathOverrides: overrides,
        currentListPath: paths.listSnapshot,
        diffPath: paths.inventoryDiff,
        currentListFresh: true,
        maxAutoApply,
        mock: false,
      },
    });
    if (ingest.status !== "ingest-ready") {
      cycle = await transitionCycle({
        stateRoot: resolvedStateRoot,
        cycle,
        phase: "manual-review-required",
        reason: "ingest-contract-blocked",
        patch: { failure: { stage: "ingest", message: ingest.blockedReason || ingest.status } },
      });
      return { status: cycle.phase, cycle, networkAccessed, ingest };
    }
    cycle = await transitionCycle({
      stateRoot: resolvedStateRoot,
      cycle,
      phase: "enriching-details",
      reason: "list-ingested",
    });
  }

  const detailResult = await runSmokingpipesProgressiveMode({
    root: resolvedRuntimeRoot,
    options: {
      mode: "progressive-detail-chunk",
      stateRoot: resolvedStateRoot,
      pathOverrides: overrides,
      progressiveDetailMax: Math.max(1, Number(detailLimit) || 1),
      maxAutoApply,
      browserChannel: "chrome",
      browserProfile: "sp-chrome",
      allowManualVerification: true,
      detailWarmupMinMs: 0,
      detailWarmupMaxMs: 0,
      manualVerificationTimeoutMs: 10 * 60 * 1000,
      retryFailedDetails: true,
      maxDetailAttempts: 3,
      mock: false,
      processDetail,
      onDetailSettled: ({ candidate }) => persistDetail({
        stateRoot: resolvedStateRoot,
        candidate,
      }),
    },
  });
  const stateRead = readProgressiveDailyState(paths.legacyProgressiveState);
  if (stateRead.status !== "passed") {
    throw new Error(`external progressive state is invalid: ${stateRead.errors.join("; ")}`);
  }
  const summary = collectionSummary(stateRead.state);
  await writeJsonAtomic(paths.detailQueue, {
    schemaVersion: "smokingpipes-detail-queue-v2",
    cycleId,
    updatedAt: new Date().toISOString(),
    pendingIds: summary.pendingDetailIds,
  });
  for (const candidate of stateRead.state.candidates || []) {
    if (candidate.detailStatus === "failed" || candidate.detailStatus === "review-only" || isFalcon(candidate)) {
      await recordQuarantinedProduct({
        stateRoot: resolvedStateRoot,
        sourceProductId: candidate.sourceProductId,
        cycleId,
        reason: isFalcon(candidate)
          ? "falcon-excluded"
          : candidate.lastError || candidate.reviewReason || candidate.detailStatus,
      });
    }
  }
  if (detailResult.status === "blocked") {
    cycle = await transitionCycle({
      stateRoot: resolvedStateRoot,
      cycle,
      phase: "collection-retryable",
      reason: "detail-collection-blocked",
      patch: { collection: { ...cycle.collection, ...summary } },
    });
    return { status: cycle.phase, cycle, detailResult, networkAccessed };
  }
  cycle = await transitionCycle({
    stateRoot: resolvedStateRoot,
    cycle,
    phase: summary.pendingDetailIds.length ? "enriching-details" : "ready-to-bundle",
    reason: summary.pendingDetailIds.length ? "details-remain" : "details-complete",
    patch: {
      attempts: { ...cycle.attempts, details: Number(cycle.attempts?.details || 0) + 1 },
      collection: { ...cycle.collection, ...summary },
    },
  });
  return { status: cycle.phase, cycle, detailResult, networkAccessed };
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
  const result = await runSmokingpipesCollectOnlyV2({
    stateRoot,
    runtimeRoot: options.get("runtime-root") || process.cwd(),
    cycleId: options.get("cycle-id") || cycleIdForDate(),
    listInputPath: options.get("list-input") || null,
    live: options.get("live") === true || options.get("live") === "true",
    detailLimit: options.get("detail-limit") || 50,
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
