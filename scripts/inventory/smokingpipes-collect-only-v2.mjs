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
  enrichSmokingpipesDetailsV2,
  ingestSmokingpipesListV2,
} from "./smokingpipes-detail-enricher-v2.mjs";
import {
  launchSmokingpipesContext,
} from "../lib/smokingpipes-utils.mjs";
import {
  readProgressiveDailyState,
} from "./smokingpipes-progressive-state-v1.mjs";
import {
  assertExternalStateRoot,
  cyclePaths,
  loadOrCreateCycle,
  recordQuarantinedProduct,
  readJson,
  resolveActiveSmokingpipesCycle,
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

export const SMOKINGPIPES_V2_LIST_MAX_PAGES = 200;
export const SMOKINGPIPES_V2_DETAIL_PACING = Object.freeze({
  detailWarmupMinMs: 4000,
  detailWarmupMaxMs: 10000,
  detailBatchSize: 20,
  detailBatchCooldownMinMs: 30000,
  detailBatchCooldownMaxMs: 60000,
});

function hasTrustedPaginationTotal(summary) {
  const detectedTotalPages = Number(summary.detectedTotalPages);
  return (
    Number.isInteger(detectedTotalPages) &&
    detectedTotalPages > 1 &&
    summary.detectionConfidence === "high" &&
    Number(summary.effectiveScannedPages) >= detectedTotalPages
  );
}

function hasConfirmedNormalEndOfList(payload, summary) {
  const endOfListPage = Number(summary.normalEndOfListPage);
  if (
    summary.normalEndOfListConfirmed !== true ||
    !Number.isInteger(endOfListPage) ||
    endOfListPage <= 1 ||
    Number(summary.effectiveScannedPages) < endOfListPage - 1 ||
    !Array.isArray(payload?.pages)
  ) {
    return false;
  }
  const scannedPages = new Set(
    payload.pages.map((item) => Number(item?.page)).filter(Number.isInteger)
  );
  for (let pageNumber = 1; pageNumber < endOfListPage; pageNumber += 1) {
    if (!scannedPages.has(pageNumber)) return false;
  }
  return true;
}

export function listIntegrityReason(payload, diff = null) {
  const summary = payload?.summary || {};
  if (!items(payload).length) return "list snapshot is empty";
  if ((summary.failedPages || []).length) return "list snapshot contains failed pages";
  if (
    summary.captchaDetected === true ||
    summary.verificationDetected === true ||
    summary.verificationDetectedAt
  ) {
    return "list snapshot contains CAPTCHA or verification evidence";
  }
  const ids = items(payload).map((item) => text(item.sourceProductId)).filter(Boolean);
  if (new Set(ids).size !== ids.length) return "list snapshot has duplicate source product IDs";
  if (summary.fullExpectedRangeScanned !== true) {
    return "list snapshot did not scan the full expected range";
  }
  if (
    !hasTrustedPaginationTotal(summary) &&
    !hasConfirmedNormalEndOfList(payload, summary)
  ) {
    return "list snapshot has no trusted pagination total or normal end-of-list evidence";
  }
  const blockedDuplicates = Number(
    diff?.duplicateHandling?.blockedDuplicateCount ??
      diff?.counts?.blockedDuplicates ??
      diff?.counts?.suspiciousDuplicates ??
      0
  );
  if (blockedDuplicates > 0) {
    return "list diff contains suspicious duplicate source product IDs";
  }
  return null;
}

export function diffSafetyReason(diff = null) {
  const fatalWarnings = Array.isArray(diff?.fatalWarnings) ? diff.fatalWarnings : [];
  if (fatalWarnings.length > 0) return String(fatalWarnings[0]);
  const applyBlockedReasons = Array.isArray(diff?.applyBlockedReasons)
    ? diff.applyBlockedReasons
    : [];
  if (applyBlockedReasons.length > 0) return String(applyBlockedReasons[0]);
  if (diff?.allowApply === false) return "list diff safety blocked application";
  return null;
}

export function trustedListReason(payload, diff = null) {
  return listIntegrityReason(payload, diff) || diffSafetyReason(diff);
}

async function writeDuplicateHandlingAudit(paths, diff) {
  const duplicateHandling = diff?.duplicateHandling;
  if (!duplicateHandling) return;
  try {
    await writeJsonAtomic(path.join(paths.logs, "list-duplicate-audit.json"), {
      schemaVersion: "smokingpipes-v2-list-duplicate-audit-v1",
      generatedAt: new Date().toISOString(),
      source: "smokingpipes",
      total: duplicateHandling.total,
      unique: duplicateHandling.unique,
      safeDuplicateCount: duplicateHandling.safeDuplicateCount,
      isolatedDuplicateCount: duplicateHandling.isolatedDuplicateCount,
      blockedDuplicateCount: duplicateHandling.blockedDuplicateCount,
      duplicateRatio: duplicateHandling.duplicateRatio,
      records: duplicateHandling.records,
    });
  } catch (error) {
    console.warn(`failed to write Smokingpipes V2 duplicate audit: ${error.message}`);
  }
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
    browserProfileLock: path.join(stateRoot, "locks", "browser-profile.lock"),
    existingProducts: path.join(runtimeData, "products", "smokingpipes-products.json"),
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

export function collectionSummary(state) {
  const candidates = state?.candidates || [];
  const requiresDetail = (candidate) =>
    (candidate.changeTypes || []).includes("new-product");
  return {
    observedCandidateCount: candidates.length,
    pendingDetailIds: candidates
      .filter(
        (candidate) =>
          requiresDetail(candidate) &&
          (candidate.detailStatus === "pending" || candidate.detailStatus === "blocked")
      )
      .map((candidate) => text(candidate.sourceProductId))
      .filter(Boolean)
      .sort(),
    completedDetailIds: candidates
      .filter(
        (candidate) =>
          requiresDetail(candidate) && candidate.detailStatus === "complete"
      )
      .map((candidate) => text(candidate.sourceProductId))
      .filter(Boolean)
      .sort(),
    completedWithoutDetailCount: candidates.filter(
      (candidate) =>
        !requiresDetail(candidate) && candidate.detailStatus === "complete"
    ).length,
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
  cycleId = null,
  now = new Date(),
  listInputPath = null,
  live = false,
  detailLimit = 50,
  maxAutoApply = 2000,
  processDetail = null,
  fetchOptions = {},
  deadline = null,
  launchBrowserSession = launchSmokingpipesContext,
  fetchCurrentList = fetchSmokingpipesCurrentList,
} = {}) {
  const resolvedRuntimeRoot = path.resolve(runtimeRoot);
  const resolvedStateRoot = assertExternalStateRoot({
    stateRoot,
    worktreeRoot: resolvedRuntimeRoot,
  });
  const active = await resolveActiveSmokingpipesCycle({
    stateRoot: resolvedStateRoot,
    cycleId,
    now,
  });
  cycleId = active.cycleId;
  const { cycle: initialCycle } = await loadOrCreateCycle({
    stateRoot: resolvedStateRoot,
    cycleId,
  });
  const paths = cyclePaths(resolvedStateRoot, cycleId);
  let cycle = initialCycle;
  // ===== BEGIN PROTECTED BEHAVIOR — Detail limit remains 50 for this optimization =====
  // One Daily invocation processes a single bounded chunk. Do not raise this
  // limit or add a loop here without an explicit collection-safety review.
  const resolvedDetailLimit = Math.min(50, Math.max(1, Number(detailLimit) || 50));
  // ===== END PROTECTED BEHAVIOR =====

  if (cycle.phase === "publishing") {
    cycle = await transitionCycle({
      stateRoot: resolvedStateRoot,
      cycle,
      phase: "retryable",
      reason: "interrupted-validating-release",
      patch: {
        failure: {
          stage: "interrupted-validating-release",
          message: "previous release validation was interrupted; retained bundle requires a release retry",
          at: new Date().toISOString(),
        },
      },
    });
  }

  if (
    cycle.phase === "ready" ||
    (cycle.phase === "retryable" &&
      cycle.failure?.requiresManualReview !== true &&
      cycle.bundle?.bundleId &&
      cycle.bundle?.path)
  ) {
    return { status: "release-resume-required", cycle, networkAccessed: false };
  }
  if (cycle.phase === "retryable" && cycle.failure?.requiresManualReview === true) {
    return { status: "manual-review-required", cycle, networkAccessed: false };
  }
  if (cycle.phase === "done") {
    return { status: "same-day-complete", cycle, networkAccessed: false };
  }

  const overrides = progressiveOverrides({
    runtimeRoot: resolvedRuntimeRoot,
    paths,
    stateRoot: resolvedStateRoot,
    cycleId,
  });
  const v2Paths = {
    progressiveState: overrides.progressiveState,
    browserProfileLock: overrides.browserProfileLock,
  };
  let snapshot = await readJson(paths.listSnapshot, null);
  let networkAccessed = false;
  let duplicateHandling = null;
  let sharedBrowserSession = null;
  const closeSharedBrowserSession = async () => {
    if (!sharedBrowserSession) return;
    const session = sharedBrowserSession;
    sharedBrowserSession = null;
    await session.close();
  };

  if (!snapshot) {
    cycle = await transitionCycle({
      stateRoot: resolvedStateRoot,
      cycle,
      phase: "collecting",
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
        sharedBrowserSession = await launchBrowserSession({
          root: resolvedRuntimeRoot,
          browserChannel: "chrome",
          browserProfile: "sp-chrome-v2",
          profileLockPath: overrides.browserProfileLock,
          runId: `v2-${cycleId}`,
          mode: "smokingpipes-v2-daily",
        });
        snapshot = await fetchCurrentList({
          root: resolvedRuntimeRoot,
          runId: `v2-${cycleId}`,
          mode: "v2-collect-only",
          browserChannel: "chrome",
          // ===== BEGIN PROTECTED OPTIMIZATION: V2 clean persistent browser profile =====
          // V2 must not use a real user profile or the legacy sp-chrome profile.
          browserProfile: "sp-chrome-v2",
          // ===== END PROTECTED OPTIMIZATION =====
          browserProfileLockPath: overrides.browserProfileLock,
          useCheckpoint: false,
          writeCurrentList: false,
          writeDuplicateAudit: false,
          writeOutOfStockTailCache: false,
          failureSnapshotDir: path.join(paths.logs, "failure-snapshots"),
          // ===== BEGIN PROTECTED OPTIMIZATION: first-page manual verification recovery =====
          // A human can clear Chrome verification and resume this same Daily run.
          allowManualVerification: true,
          // ===== END PROTECTED OPTIMIZATION =====
          ...fetchOptions,
          maxPages: SMOKINGPIPES_V2_LIST_MAX_PAGES,
          deadlineAtMs: deadline?.deadlineAtMs ?? null,
          nowMs: deadline?.nowMs,
          browserSession: sharedBrowserSession,
        });
      } else {
        throw new Error("no list input supplied and live collection is disabled");
      }
      const productionProducts = await readJsonFile(overrides.existingProducts);
      const diff = buildInventoryDiff(snapshot, productionProducts, {
        maxAutoApply,
        // V2 never authorizes legacy unclassified duplicates by historical SHA.
        allowLegacyDuplicateSnapshotOverride: false,
      });
      duplicateHandling = diff.duplicateHandling || null;
      await writeDuplicateHandlingAudit(paths, diff);
      const integrityFailure = listIntegrityReason(snapshot, diff);
      if (integrityFailure) throw new Error(integrityFailure);
      await writeJsonAtomic(paths.listSnapshot, snapshot);
      await writeJsonAtomic(paths.inventoryDiff, diff);
      await writeJsonAtomic(paths.listManifest, {
        schemaVersion: "smokingpipes-list-manifest-v2",
        cycleId,
        capturedAt: new Date().toISOString(),
        expectedPages: snapshot.summary?.expectedPages ?? null,
        effectiveScannedPages: snapshot.summary?.effectiveScannedPages ?? null,
        fullExpectedRangeScanned: snapshot.summary?.fullExpectedRangeScanned === true,
      });
      const diffSafetyFailure = diffSafetyReason(diff);
      if (diffSafetyFailure) {
        await closeSharedBrowserSession().catch(() => {});
        cycle = await transitionCycle({
          stateRoot: resolvedStateRoot,
          cycle,
          phase: "retryable",
          reason: "list-diff-blocked",
          patch: {
            collection: {
              ...cycle.collection,
              duplicateHandling,
              trustedSnapshot: {
                path: path.relative(resolvedStateRoot, paths.listSnapshot).replace(/\\/g, "/"),
              },
            },
            failure: {
              stage: "list-diff",
              message: diffSafetyFailure,
              fatalWarnings: Array.isArray(diff.fatalWarnings) ? diff.fatalWarnings : [],
              applyBlockedReasons: Array.isArray(diff.applyBlockedReasons)
                ? diff.applyBlockedReasons
                : [],
              at: new Date().toISOString(),
            },
          },
        });
        return { status: "collection-retryable", cycle, networkAccessed, error: diffSafetyFailure };
      }
      cycle = await transitionCycle({
        stateRoot: resolvedStateRoot,
        cycle,
        phase: "collecting",
        reason: "trusted-list-persisted",
        patch: {
          collection: {
            ...cycle.collection,
            duplicateHandling,
            trustedSnapshot: {
              path: path.relative(resolvedStateRoot, paths.listSnapshot).replace(/\\/g, "/"),
            },
          },
        },
      });
    } catch (error) {
      await closeSharedBrowserSession().catch(() => {});
      cycle = await transitionCycle({
        stateRoot: resolvedStateRoot,
        cycle,
        phase: "retryable",
        reason: "list-collection-failed",
        patch: {
          collection: {
            ...cycle.collection,
            duplicateHandling,
          },
          failure: {
            stage: error?.code === "BROWSER_NATIVE_CDP_FAILED" ? "browser-native-cdp-failed" : "list",
            message: error.message,
            at: new Date().toISOString(),
          },
        },
      });
      return { status: "collection-retryable", cycle, networkAccessed, error: error.message };
    }
  }

  if (snapshot && cycle.phase === "retryable" && cycle.failure?.stage === "list-diff") {
    const existingDiff = await readJson(paths.inventoryDiff, null);
    if (!existingDiff) {
      return {
        status: "collection-retryable",
        cycle,
        networkAccessed,
        error: "retained list-diff is missing its inventory diff",
      };
    }
    const integrityFailure = listIntegrityReason(snapshot, existingDiff);
    if (integrityFailure) {
      return { status: "collection-retryable", cycle, networkAccessed, error: integrityFailure };
    }
    const diffSafetyFailure = diffSafetyReason(existingDiff);
    if (diffSafetyFailure) {
      return { status: "collection-retryable", cycle, networkAccessed, error: diffSafetyFailure };
    }
    cycle = await transitionCycle({
      stateRoot: resolvedStateRoot,
      cycle,
      phase: "collecting",
      reason: "retained-list-diff-now-allowed",
    });
  }

  if (snapshot && cycle.phase === "retryable" && cycle.failure?.stage === "list") {
    const existingDiff = await readJson(paths.inventoryDiff, null);
    const trustFailure = trustedListReason(snapshot, existingDiff);
    if (trustFailure) {
      return { status: "collection-retryable", cycle, networkAccessed, error: trustFailure };
    }
    cycle = await transitionCycle({
      stateRoot: resolvedStateRoot,
      cycle,
      phase: "collecting",
      reason: "trusted-list-resume-without-source-refetch",
    });
  }

  if (cycle.phase === "collecting") {
    const ingest = await ingestSmokingpipesListV2({
      paths: v2Paths,
      snapshotPath: paths.listSnapshot,
      diffPath: paths.inventoryDiff,
      productionProducts: await readJsonFile(overrides.existingProducts),
      runId: `v2-${cycleId}`,
    });
    if (ingest.status !== "ingest-ready") {
      await closeSharedBrowserSession().catch(() => {});
      cycle = await transitionCycle({
        stateRoot: resolvedStateRoot,
        cycle,
        phase: "retryable",
        reason: "ingest-contract-blocked",
        patch: { failure: { stage: "ingest", message: ingest.blockedReason || ingest.status, requiresManualReview: true } },
      });
      return { status: cycle.phase, cycle, networkAccessed, ingest };
    }
    cycle = await transitionCycle({
      stateRoot: resolvedStateRoot,
      cycle,
      phase: "details",
      reason: "list-ingested",
    });
  }

  console.log(
    "Smokingpipes V2 detail pacing: detail warmup: 4000-10000 ms; detail batch: 20; detail batch cooldown: 30000-60000 ms"
  );
  const detailOptions = {
    browserChannel: "chrome",
    browserProfile: "sp-chrome-v2",
    allowManualVerification: true,
    ...SMOKINGPIPES_V2_DETAIL_PACING,
    manualVerificationTimeoutMs: 10 * 60 * 1000,
    deadlineAtMs: deadline?.deadlineAtMs ?? null,
    nowMs: deadline?.nowMs,
  };
  let detailResult;
  try {
    detailResult = await enrichSmokingpipesDetailsV2({
      root: resolvedRuntimeRoot,
      paths: v2Paths,
      detailLimit: resolvedDetailLimit,
      options: detailOptions,
      processDetail,
      browserSession: sharedBrowserSession,
      onDetailSettled: ({ candidate }) => persistDetail({ stateRoot: resolvedStateRoot, candidate }),
    });
  } catch (error) {
    await closeSharedBrowserSession().catch(() => {});
    if (error?.code === "BROWSER_NATIVE_CDP_FAILED") {
      cycle = await transitionCycle({
        stateRoot: resolvedStateRoot,
        cycle,
        phase: "retryable",
        reason: "browser-native-cdp-failed",
        patch: {
          failure: { stage: "browser-native-cdp-failed", message: error.message, at: new Date().toISOString() },
        },
      });
      return { status: "collection-retryable", cycle, networkAccessed, error: error.message };
    }
    throw error;
  }
  await closeSharedBrowserSession().catch(() => {});
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
  if (detailResult.status === "blocked" || detailResult.status === "deadline-reached") {
    cycle = await transitionCycle({
      stateRoot: resolvedStateRoot,
      cycle,
      phase: "retryable",
      reason: detailResult.status === "deadline-reached" ? "daily-deadline-during-details" : "detail-collection-blocked",
      patch: {
        collection: { ...cycle.collection, ...summary },
        failure: detailResult.status === "deadline-reached"
          ? { stage: "daily-deadline", message: detailResult.blockedReason, at: new Date().toISOString() }
          : cycle.failure,
      },
    });
    return {
      status: detailResult.status === "deadline-reached" ? "enriching-details" : cycle.phase,
      cycle,
      detailResult,
      networkAccessed,
    };
  }
  cycle = await transitionCycle({
    stateRoot: resolvedStateRoot,
    cycle,
    phase: summary.pendingDetailIds.length ? "details" : "ready",
    reason: summary.pendingDetailIds.length ? "details-remain" : "details-complete",
    patch: {
      attempts: { ...cycle.attempts, details: Number(cycle.attempts?.details || 0) + 1 },
      collection: { ...cycle.collection, ...summary },
    },
  });
  return {
    status: summary.pendingDetailIds.length ? "enriching-details" : "ready-to-bundle",
    cycle,
    detailResult,
    networkAccessed,
  };
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
    cycleId: options.get("cycle-id") || null,
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
