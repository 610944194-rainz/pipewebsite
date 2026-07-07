import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  acquireRunLock,
  baselineCatchUpNextStep,
  buildDetailsQueue,
  classifyRunnerError,
  collectValidCachedDetails,
  collectValidQueueTempDetails,
  evaluateRunnerReadiness,
  formatCheckpointFailureReport,
  formatRunId,
  getRunnerPaths,
  initialInventoryState,
  parseRunnerOptions,
  readJsonIfExists,
  releaseRunLock,
  resolveInventoryInputStrategy,
  shouldFetchNewDetails,
  shouldGenerateFinalApplyDryRunOutputs,
  summarizeDetailsQueue,
  validateReusableInventoryArtifacts,
  writeJsonAtomic,
  writeTextAtomic,
} from "./inventory-runner-core-v1.mjs";
import {
  processSmokingpipesCatchUpCycles,
  processSmokingpipesDetailsQueue,
  writeSmokingpipesQueueCheckpoint,
} from "./smokingpipes-details-queue-v1.mjs";
import {
  buildSmokingpipesApplyDryRunArtifacts,
  buildSmokingpipesApplyDryRunReport,
  buildSmokingpipesBaselineReadinessMarkdown,
  buildSmokingpipesBaselineReadinessReport,
  buildSmokingpipesPendingApplyDryRunReport,
  writeSmokingpipesApplyDryRunOutputs,
} from "./smokingpipes-apply-dry-run-v1.mjs";
import { runSmokingpipesInventoryDryRun } from "./smokingpipes-update-dry-run-v1.mjs";
import { validateInventoryUpdate } from "./validate-inventory-update-v1.mjs";
import { runSmokingpipesDailyUpdate } from "./smokingpipes-daily-update-v1.mjs";
import { runSmokingpipesVerificationProbe } from "./smokingpipes-verification-probe-v1.mjs";
import { runSmokingpipesDetailProbe } from "./smokingpipes-detail-probe-v1.mjs";
import { runSmokingpipesBrowserPreflight } from "./smokingpipes-browser-preflight-v1.mjs";
import { runSmokingpipesProgressiveMode } from "./smokingpipes-progressive-runner-v1.mjs";

const ROOT = process.cwd();

const HELP = `Smokingpipes Inventory Automation Runner V1

Usage:
  node scripts/inventory/run-inventory-automation-v1.mjs [options]

Options:
  --source=smokingpipes                 Inventory source (V1 only supports smokingpipes)
  --mode=dry-run                        Fetch, diff, validate, and advance detail queue (default)
  --mode=apply-dry-run                  Build isolated next-data candidates when every gate passes
  --mode=daily-update                   Full daily list refresh and isolated daily candidate
  --daily-update                        Alias for --mode=daily-update
  --mode=verification-probe             List-only verification telemetry research
  --verification-probe                  Alias for --mode=verification-probe
  --mode=detail-probe                   Trusted newIds detail-risk probe
  --detail-probe                        Alias for --mode=detail-probe
  --mode=browser-preflight              Browser/profile startup check only
  --mode=progressive-ingest-list        Ingest existing current-list/diff into state
  --mode=progressive-detail-chunk       Resume a checkpointed new-detail batch
  --mode=progressive-build-candidate    Build isolated additive partial-next data
  --mode=progressive-prepare-apply      Build fresh audit/preview and run apply gate without writing production
  --mode=progressive-partial-apply      Preview partial apply; writes production only with --write-production
  --mode=apply                          Reserved; V1 rejects production apply
  --refresh-list                        Refresh list/diff before apply-dry-run (default: reuse existing)
  --catch-up-current                    Complete the current diff.newIds baseline in resumable batches
  --baseline-catch-up                   Alias for --catch-up-current
  --auto-repeat-catch-up                Run bounded catch-up cycles in one invocation
  --catch-up-repeat-max-cycles=1        Maximum catch-up cycles
  --catch-up-repeat-delay-min-ms=300000 Minimum delay between catch-up cycles
  --catch-up-repeat-delay-max-ms=600000 Maximum delay between catch-up cycles
  --catch-up-max-total-details=200      Maximum details across all cycles
  --catch-up-max-runtime-minutes=90     Maximum catch-up runtime
  --max-pages=107                       List pages to scan (default: 107)
  --allow-manual-verification=true      Open a visible browser; strong verification still stops
  --browser-channel=msedge              Use msedge, chrome, or Playwright chromium
  --browser-profile=sp-chrome           Use the dedicated YandouBuy Chrome profile
  --browser-profile-dir=PATH            Explicit persistent profile directory
  --page-delay-min-ms=8000              Full reconcile minimum is 3000
  --page-delay-max-ms=18000             Full reconcile minimum is 6000
  --page-warmup-min-ms=3000             Full reconcile minimum is 1500
  --page-warmup-max-ms=7000             Full reconcile minimum is 3000
  --page-batch-size=30                  Daily list pages between cooldowns
  --page-batch-cooldown-min-ms=30000    Full reconcile cooldown minimum
  --page-batch-cooldown-max-ms=60000    Full reconcile cooldown maximum
  --captcha-cooldown-ms=60000           Cooldown after CAPTCHA detection
  --fetch-new-details                   Explicitly enable fetching diff.newIds details
  --skip-new-details                    Explicitly keep this run list-only (default)
  --allow-partial-new-details           Permit details after a partial scan (not recommended)
  --detail-warmup-min-ms=1000           Catch-up default; normal default remains 5000
  --detail-warmup-max-ms=3000           Catch-up default; normal default remains 12000
  --detail-delay-min-ms=3000            Catch-up default; normal default remains 15000
  --detail-delay-max-ms=8000            Catch-up default; normal default remains 35000
  --detail-batch-size=50                Catch-up default; normal default remains 5
  --detail-batch-cooldown-min-ms=0      Catch-up default; normal default remains 90000
  --detail-batch-cooldown-max-ms=0      Catch-up default; normal default remains 180000
  --detail-max-per-run=50               Catch-up default; normal default remains 10
  --max-new-details-per-run=10          Legacy alias for --detail-max-per-run
  --daily-new-max-details=100           Maximum daily new details per invocation
  --detail-probe-max=5                  Maximum trusted newIds tested by detail-probe
  --progressive-detail-max=5            Maximum progressive pending details per chunk
  --current-list=PATH                   Progressive ingest current-list input
  --diff=PATH                           Progressive ingest inventory diff input
  --write-production                    Explicitly write progressive partial apply outputs to production
  --no-commit | --commit                Commit intent flag; V1 never commits automatically
  --no-deploy                           Deployment stays disabled
  --verbose                             Print detail progress
  --force-unlock                        Remove an existing lock before starting (use carefully)
  --mock                                Run an isolated, offline synthetic test under .cache
  --help                                Show this help

Safety:
  The default mode is dry-run. Progressive partial apply is preview-only unless
  --write-production is explicitly passed. Incomplete list coverage, failed
  validation, pending details, CAPTCHA, or network errors block apply readiness.
`;

function relative(filePath) {
  return path.relative(ROOT, filePath).replaceAll("\\", "/");
}

function makeMockInventory(options) {
  const now = new Date().toISOString();
  const fullExpectedRangeScanned =
    options.maxPages >= options.expectedPages;
  const products = Array.from({ length: 5 }, (_, index) => {
    const sourceProductId = String(990001 + index);
    return {
      source: "smokingpipes",
      sourceProductId,
      sourceUrl: `https://example.invalid/smokingpipes/${sourceProductId}`,
      title: `Synthetic pipe ${index + 1}`,
      rawTitle: `Synthetic pipe ${index + 1}`,
      brand: index % 2 ? "Mock Brand B" : "Mock Brand A",
      price: `$${100 + index}.00`,
      mainImage: "",
      listPage: 1,
      listPosition: index + 1,
      scrapedAt: now,
    };
  });
  const newIds = products.map((item) => item.sourceProductId);
  const current = {
    version: "smokingpipes-current-list-dry-run-v1",
    generatedAt: now,
    source: "smokingpipes",
    scrapeType: "mock",
    config: {
      maxPages: options.maxPages,
      expectedPages: options.expectedPages,
      allowManualVerification: options.allowManualVerification,
      manualVerification: options.allowManualVerification,
      partialScan: false,
      mock: true,
    },
    startedAt: now,
    completedAt: now,
    pages: [{ page: 1, productCount: products.length, scrapedAt: now }],
    products,
    summary: {
      pagesRequested: options.maxPages,
      pagesScanned: options.maxPages,
      expectedPages: options.expectedPages,
      productsExtracted: products.length,
      uniqueProducts: products.length,
      duplicateSourceProductIds: [],
      completeRequestedRange: true,
      fullExpectedRangeScanned,
    },
  };
  const diff = {
    version: "smokingpipes-inventory-diff-dry-run-v1",
    generatedAt: now,
    source: "smokingpipes",
    mode: "mock",
    coverage: {
      pagesRequested: options.maxPages,
      pagesScanned: options.maxPages,
      expectedPages: options.expectedPages,
      fullExpectedRangeScanned,
    },
    counts: {
      currentAvailable: products.length,
      existing: 0,
      existingAvailable: 0,
      new: products.length,
      stillAvailable: 0,
      disappeared: 0,
      suspicious: 0,
    },
    newIds,
    stillAvailableIds: [],
    disappearedIds: [],
    suspiciousIds: [],
    fatalWarnings: [],
    warnings: [
      "Synthetic mock run; no network or production data was used.",
      ...(!fullExpectedRangeScanned
        ? [
            `Partial scan: ${options.maxPages}/${options.expectedPages} expected full-list pages.`,
          ]
        : []),
    ],
    allowApply: fullExpectedRangeScanned,
    applyBlockedReasons: fullExpectedRangeScanned
      ? []
      : [
          `partial page coverage: ${options.maxPages}/${options.expectedPages} pages; full coverage is required`,
        ],
  };
  const recentNew = {
    version: "recent-new-dry-run-v1",
    generatedAt: now,
    source: "smokingpipes",
    mock: true,
    newProductIds: newIds,
    newProducts: products,
  };
  return { current, diff, recentNew };
}

function validateMockInventory(current, diff, recentNew) {
  const errors = [];
  if (!current.summary?.fullExpectedRangeScanned) {
    errors.push("Mock current list is incomplete.");
  }
  if (
    JSON.stringify(diff.newIds || []) !==
    JSON.stringify(recentNew.newProductIds || [])
  ) {
    errors.push("Mock recent-new IDs do not match diff.newIds.");
  }
  return {
    status: errors.length ? "blocked" : "passed",
    allowApply: diff.allowApply === true && errors.length === 0,
    counts: diff.counts,
    coverage: diff.coverage,
    errors,
    warnings: diff.warnings || [],
  };
}

function reportLines(values) {
  return values?.length ? values.map((value) => `- ${value}`).join("\n") : "- none";
}

function buildRunReport(run) {
  const counts = run.diff?.counts || {};
  const coverage = run.diff?.coverage || {};
  const queue = run.queueSummary || {};
  const readinessReasons = run.readiness?.reasons || [];
  return `# Smokingpipes Inventory Automation Run

## Run

- runId: ${run.runId}
- source: ${run.source}
- startedAt: ${run.startedAt}
- finishedAt: ${run.finishedAt || "not finished"}
- mode: ${run.mode}
- baseline catch-up: ${Boolean(run.catchUpCurrent)}
- auto-repeat catch-up: ${Boolean(run.autoRepeatCatchUp)}
- catch-up cycles completed: ${run.detailsResult?.cyclesCompleted ?? 0}
- catch-up stop reason: ${run.detailsResult?.stopReason || "not applicable"}
- inventory input: ${run.refreshList ? "refreshed list/diff" : "existing validated list/diff"}
- refresh list: ${Boolean(run.refreshList)}
- current step: ${run.currentStep}
- status: ${run.status}
- mock: ${run.mock}
- manualVerification: ${run.manualVerification}
- browser channel: ${run.browserChannel || "automatic fallback"}
- page delay: ${run.pageDelayMinMs}-${run.pageDelayMaxMs} ms
- page warmup: ${run.pageWarmupMinMs}-${run.pageWarmupMaxMs} ms
- CAPTCHA cooldown: ${run.captchaCooldownMs} ms
- CAPTCHA detected: ${Boolean(run.captchaDetected)}
- current CAPTCHA product: ${run.currentProductId || "none"}
- maxPages: ${run.maxPages}
- pages scanned: ${coverage.pagesScanned ?? 0}
- expected pages: ${coverage.expectedPages ?? 107}
- complete 107-page coverage: ${Boolean(coverage.fullExpectedRangeScanned)}
- current-list count: ${counts.currentAvailable ?? 0}
- new: ${counts.new ?? 0}
- stillAvailable: ${counts.stillAvailable ?? 0}
- disappeared: ${counts.disappeared ?? 0}
- suspicious: ${counts.suspicious ?? 0}

## New Details Queue

- candidates from diff: ${run.newDetailCandidates ?? 0}
- classification: ${run.newDetailClassification || "not evaluated"}
- fetch requested: ${Boolean(run.detailsFetchRequested)}
- fetch allowed: ${Boolean(run.detailsFetchAllowed)}
- fetch decision: ${run.detailsFetchReason || "not evaluated"}
- existing products skipped: ${queue.existingProductsSkipped ?? 0}
- already completed skipped: ${queue.alreadyCompletedSkipped ?? 0}
- cached skipped: ${queue.cachedSkipped ?? 0}
- stale in-progress repaired: ${queue.staleInProgressRepaired ?? 0}
- stale in-progress recovered from cache: ${queue.staleInProgressCached ?? 0}
- stale in-progress reset to pending: ${queue.staleInProgressReset ?? 0}
- ignored/superseded skipped: ${queue.ignoredSkipped ?? 0}
- queued new details: ${queue.queuedNewDetails ?? 0}
- active: ${queue.activeItems ?? 0}
- completed: ${queue.completed ?? 0}
- pending: ${queue.pending ?? 0}
- failed: ${queue.failed ?? 0}
- remaining: ${queue.remaining ?? 0}
- attempted this run: ${run.detailsResult?.attempted ?? 0}
- completed this run: ${run.detailsResult?.completed ?? 0}

## Safety Decision

- inventory allowApply: ${Boolean(run.diff?.allowApply)}
- runner allowApply: ${Boolean(run.readiness?.allowApply)}
- applied: ${Boolean(run.applied)}
- production data written: false
- manual action required: ${Boolean(run.manualActionRequired)}
- CAPTCHA required: ${Boolean(run.captchaRequired)}
- lock acquired: ${Boolean(run.lockAcquired)}
- lock released on normal/finalized exit: ${Boolean(run.lockReleased)}

${formatCheckpointFailureReport(run)}

### Readiness reasons

${reportLines(readinessReasons)}

### Errors

${reportLines(run.errors)}

### Warnings

${reportLines(run.warnings)}

## Next Step

${run.nextStep}
`;
}

async function writeRunReports(paths, run) {
  const report = buildRunReport(run);
  const runReport = path.join(
    paths.runReports,
    `${run.runId}-smokingpipes-report.md`
  );
  await writeTextAtomic(runReport, report);
  await writeTextAtomic(paths.latestReport, report);
  run.latestReport = relative(paths.latestReport);
  run.runReport = relative(runReport);
}

async function writeState(paths, state, patch) {
  Object.assign(state, patch);
  await writeJsonAtomic(paths.state, state);
}

async function run() {
  let options;
  try {
    options = parseRunnerOptions();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    console.log(HELP);
    return;
  }

  if (options.mode === "browser-preflight") {
    try {
      const result = await runSmokingpipesBrowserPreflight({
        root: ROOT,
        options,
      });
      console.log(
        JSON.stringify(
          {
            status: result.status,
            mode: "browser-preflight",
            mock: options.mock,
            browserStarted: result.browserStarted,
            browser: result.state.browser,
            productsFetched: false,
            candidateGenerated: false,
            productionWritten: false,
            commitPerformed: false,
            pushPerformed: false,
          },
          null,
          2
        )
      );
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
    return;
  }

  if (options.progressiveMode) {
    try {
      const result = await runSmokingpipesProgressiveMode({
        root: ROOT,
        options,
      });
      console.log(
        JSON.stringify(
          {
            status: result.status,
            mode: options.mode,
            completedThisRun:
              result.completedThisRun || 0,
            candidateCount:
              result.candidateCount || 0,
            wouldApplyCount:
              result.wouldApplyCount || 0,
            appliedCount:
              result.partialAppliedCount || 0,
            isolatedCandidateCount:
              result.isolatedCandidateCount || 0,
            safeSubsetApply:
              result.safeSubsetApply === true,
            applyReady:
              result.applyReady === true,
            browserStarted:
              result.browserStarted ?? false,
            recommendedNextRunAt:
              result.recommendedNextRunAt || null,
            blockedReason:
              result.blockedReason || null,
            productionWritten:
              result.productionWritten === true,
            commitPerformed: false,
            pushPerformed: false,
          },
          null,
          2
        )
      );
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
    return;
  }

  if (options.mode === "daily-update") {
    try {
      const report = await runSmokingpipesDailyUpdate({
        root: ROOT,
        options,
      });
      console.log(
        JSON.stringify(
          {
            runId: report.runId,
            status: report.status,
            mode: report.mode,
            mock: report.mock,
            dailyNew: report.dailyDiff?.counts?.dailyNew || 0,
            queue: report.queue,
            audit: report.audit?.verdict || null,
            outputsGenerated: report.outputsGenerated,
            productionWritten: false,
            commitPerformed: false,
            pushPerformed: false,
          },
          null,
          2
        )
      );
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
    return;
  }

  if (options.mode === "verification-probe") {
    try {
      const result = await runSmokingpipesVerificationProbe({
        root: ROOT,
        options,
      });
      console.log(
        JSON.stringify(
          {
            status: result.status,
            mode: "verification-probe",
            mock: options.mock,
            pagesScanned: result.telemetry.summary.pagesScanned,
            weakVerificationPages:
              result.telemetry.summary.weakVerificationPages,
            strongVerificationPages:
              result.telemetry.summary.strongVerificationPages,
            captchaDetected: result.telemetry.captchaDetected,
            riskLevel: result.telemetry.riskLevel,
            candidateGenerated: false,
            detailsFetched: false,
            productionWritten: false,
            commitPerformed: false,
            pushPerformed: false,
          },
          null,
          2
        )
      );
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
    return;
  }

  if (options.mode === "detail-probe") {
    try {
      const result = await runSmokingpipesDetailProbe({
        root: ROOT,
        options,
      });
      console.log(
        JSON.stringify(
          {
            status: result.status,
            mode: "detail-probe",
            mock: options.mock,
            detailProbeMax: result.telemetry.detailProbeMax,
            detailsAttempted: result.telemetry.detailsAttempted,
            detailsSucceeded: result.telemetry.detailsSucceeded,
            detailsFailed: result.telemetry.detailsFailed,
            captchaDetected: result.telemetry.captchaDetected,
            browserStarted: result.browserStarted,
            candidateGenerated: false,
            productionWritten: false,
            commitPerformed: false,
            pushPerformed: false,
          },
          null,
          2
        )
      );
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
    return;
  }

  const paths = getRunnerPaths(ROOT, { mock: options.mock });
  const runId = formatRunId();
  const startedAt = new Date().toISOString();
  const state = {
    ...initialInventoryState(),
    ...readJsonIfExists(paths.state, {}),
  };
  const runRecord = {
    runId,
    source: options.source,
    mode: options.mode,
    catchUpCurrent: options.catchUpCurrent,
    autoRepeatCatchUp: options.autoRepeatCatchUp,
    refreshList: false,
    mock: options.mock,
    startedAt,
    finishedAt: null,
    currentStep: "acquire-lock",
    status: "running",
    manualVerification: options.allowManualVerification,
    browserChannel: options.browserChannel,
    pageDelayMinMs: options.pageDelayMinMs,
    pageDelayMaxMs: options.pageDelayMaxMs,
    pageWarmupMinMs: options.pageWarmupMinMs,
    pageWarmupMaxMs: options.pageWarmupMaxMs,
    captchaCooldownMs: options.captchaCooldownMs,
    captchaDetected: false,
    currentProductId: null,
    maxPages: options.maxPages,
    detailsFetchRequested: options.fetchNewDetails,
    detailsFetchAllowed: false,
    detailsFetchReason: null,
    newDetailCandidates: 0,
    newDetailClassification: null,
    diff: null,
    validation: null,
    readiness: null,
    queueSummary: null,
    detailsResult: null,
    applied: false,
    manualActionRequired: false,
    captchaRequired: false,
    checkpointFailed: false,
    checkpointTargetPath: null,
    checkpointTempPath: null,
    checkpointAttempts: 0,
    checkpointLastErrorCode: null,
    lockAcquired: false,
    lockReleased: false,
    warnings: [],
    errors: [],
    nextStep: "Run the inventory automation again after reviewing this report.",
  };
  let lock = null;

  try {
    lock = acquireRunLock(
      paths.lock,
      { runId, source: options.source, mode: options.mode },
      options.forceUnlock
    );
    runRecord.lockAcquired = true;
    await writeState(paths, state, {
      lastRunAt: startedAt,
      status: "running",
      lastStep: "starting",
      lastError: null,
      manualActionRequired: false,
      captchaRequired: false,
      currentRunId: runId,
    });

    if (options.commit) {
      runRecord.warnings.push(
        "--commit was requested, but Inventory Automation V1 never commits automatically."
      );
    }
    if (options.deploy) {
      runRecord.warnings.push(
        "Deployment was requested, but Inventory Automation V1 never deploys automatically."
      );
    }

    let current;
    let diff;
    let recentNew;
    let validation;
    const inventoryInput = resolveInventoryInputStrategy(options);
    runRecord.refreshList = inventoryInput.refreshList;
    runRecord.currentStep = inventoryInput.refreshList
      ? "fetch-and-diff"
      : "reuse-existing-dry-run";
    await writeState(paths, state, { lastStep: runRecord.currentStep });

    if (inventoryInput.refreshList) {
      if (options.mock) {
        if (options.verbose) {
          console.log(
            "mock mode: browser navigation and long pacing delays are skipped"
          );
        }
        ({ current, diff, recentNew } = makeMockInventory(options));
        await writeJsonAtomic(paths.currentList, current);
        await writeJsonAtomic(paths.diff, diff);
        await writeJsonAtomic(paths.recentNew, recentNew);
        validation = validateMockInventory(current, diff, recentNew);
      } else {
        await runSmokingpipesInventoryDryRun({
          root: ROOT,
          runId,
          mode: options.mode,
          maxPages: options.maxPages,
          expectedPages: options.expectedPages,
          browserChannel: options.browserChannel,
          browserProfile: options.browserProfile,
          browserProfileDir: options.browserProfileDir,
          browserProfileLockPath: paths.browserProfileLock,
          allowManualVerification: options.allowManualVerification,
          manualVerificationTimeoutMs: options.manualVerificationTimeoutMs,
          pageDelayMinMs: options.pageDelayMinMs,
          pageDelayMaxMs: options.pageDelayMaxMs,
          pageWarmupMinMs: options.pageWarmupMinMs,
          pageWarmupMaxMs: options.pageWarmupMaxMs,
          pageBatchSize: options.pageBatchSize,
          pageBatchCooldownMinMs: options.pageBatchCooldownMinMs,
          pageBatchCooldownMaxMs: options.pageBatchCooldownMaxMs,
          captchaCooldownMs: options.captchaCooldownMs,
          verbose: options.verbose,
        });
        current = readJsonIfExists(paths.currentList);
        diff = readJsonIfExists(paths.diff);
        recentNew = readJsonIfExists(paths.recentNew);
        validation = validateInventoryUpdate();
      }

      if (!current || !diff || !recentNew) {
        throw new Error(
          "Inventory dry-run did not produce every required output."
        );
      }
    } else {
      if (options.verbose) {
        console.log("using existing current-list dry-run");
        console.log("using existing inventory diff dry-run");
      }
      current = readJsonIfExists(paths.currentList);
      diff = readJsonIfExists(paths.diff);
      recentNew = readJsonIfExists(paths.recentNew);
      validation = validateReusableInventoryArtifacts({
        current,
        diff,
        expectedPages: options.expectedPages,
      });

      if (validation.status !== "passed") {
        runRecord.validation = validation;
        runRecord.diff = diff;
        runRecord.warnings.push(...validation.warnings);
        runRecord.errors.push(...validation.errors);
        throw Object.assign(
          new Error(
            `Existing inventory dry-run artifacts are not safe to reuse: ${validation.errors.join(
              "; "
            )} Run a complete list-only dry-run first.`
          ),
          { code: "INVALID_EXISTING_DRY_RUN" }
        );
      }

      if (!recentNew) {
        const newIds = new Set((diff.newIds || []).map(String));
        recentNew = {
          version: "recent-new-dry-run-v1",
          generatedAt: diff.generatedAt || new Date().toISOString(),
          source: "smokingpipes",
          note:
            "Derived in memory from an existing validated diff; no inventory file was rewritten.",
          newProductIds: [...newIds],
          newProducts: (current.products || []).filter((item) =>
            newIds.has(String(item.sourceProductId))
          ),
        };
        runRecord.warnings.push(
          "Existing recent-new dry-run was missing; an in-memory view was derived from diff.newIds without rewriting inventory files."
        );
      }
    }

    runRecord.diff = diff;
    runRecord.captchaDetected = Boolean(current.summary?.captchaDetected);
    runRecord.validation = validation;
    runRecord.newDetailCandidates = Number(
      diff.counts?.new ?? diff.newIds?.length ?? 0
    );
    runRecord.newDetailClassification =
      diff.coverage?.fullExpectedRangeScanned
        ? "confirmed full-scan new candidates"
        : "partial scan candidates; not trusted as a complete inventory update";
    runRecord.warnings.push(...(validation.warnings || []));
    runRecord.errors.push(...(validation.errors || []));
    await writeState(paths, state, {
      ...(inventoryInput.refreshList
        ? { lastSuccessfulFetchAt: new Date().toISOString() }
        : {}),
      lastStep: "details-decision",
    });

    const detailsDecision = shouldFetchNewDetails({
      fetchNewDetails: options.fetchNewDetails,
      allowPartialNewDetails: options.allowPartialNewDetails,
      fullExpectedRangeScanned: Boolean(
        diff.coverage?.fullExpectedRangeScanned
      ),
    });
    runRecord.detailsFetchAllowed = detailsDecision.allowed;
    runRecord.detailsFetchReason = detailsDecision.reason;
    let queue = { items: [], reconciliation: {} };

    if (options.verbose) {
      console.log(
        `new detail candidates from diff: ${runRecord.newDetailCandidates}`
      );
    }

    const shouldPrepareQueue =
      detailsDecision.allowed || options.mode === "apply-dry-run";

    if (shouldPrepareQueue) {
      runRecord.currentStep = "queue-details";
      await writeState(paths, state, { lastStep: runRecord.currentStep });
      const existingQueue = readJsonIfExists(paths.queue, null);
      const existingProducts = options.mock
        ? []
        : readJsonIfExists(paths.existingProducts, []);
      const existingProductIds = new Set(
        (Array.isArray(existingProducts)
          ? existingProducts
          : existingProducts?.products || []
        )
          .map((item) => String(item.sourceProductId || ""))
          .filter(Boolean)
      );
      const cachedDetails = options.mock
        ? new Map()
        : collectValidCachedDetails(
            paths.detailCaches
              .map((filePath) => readJsonIfExists(filePath, null))
              .filter(Boolean)
          );
      const queueTempRecovery = collectValidQueueTempDetails(paths.queue);
      for (const [sourceProductId, detail] of queueTempRecovery.details) {
        cachedDetails.set(sourceProductId, detail);
      }
      if (queueTempRecovery.details.size > 0) {
        runRecord.warnings.push(
          `${queueTempRecovery.details.size} cached details were recovered from preserved queue temp files.`
        );
      }

      queue = buildDetailsQueue({
        existingQueue,
        diff,
        currentProducts: current.products || [],
        existingProductIds,
        cachedDetails,
      });
      await writeSmokingpipesQueueCheckpoint(queue, paths.queue, {
        verbose: options.verbose,
      });
      runRecord.queueSummary = summarizeDetailsQueue(queue);
      if (options.verbose) {
        console.log(
          `already completed / cached skipped: ${
            Number(queue.summary?.alreadyCompletedSkipped || 0) +
            Number(queue.summary?.cachedSkipped || 0)
          }`
        );
        console.log(
          `queued new details: ${queue.summary?.queuedNewDetails || 0}`
        );
      }

      if (detailsDecision.allowed) {
        const detailProcessingOptions = {
          queue,
          queuePath: paths.queue,
          batchSize: options.detailBatchSize,
          detailWarmupMinMs: options.detailWarmupMinMs,
          detailWarmupMaxMs: options.detailWarmupMaxMs,
          detailDelayMinMs: options.detailDelayMinMs,
          detailDelayMaxMs: options.detailDelayMaxMs,
          detailBatchCooldownMinMs: options.detailBatchCooldownMinMs,
          detailBatchCooldownMaxMs: options.detailBatchCooldownMaxMs,
          browserChannel: options.browserChannel,
          browserProfile: options.browserProfile,
          browserProfileDir: options.browserProfileDir,
          browserProfileLockPath: paths.browserProfileLock,
          runId,
          mode: options.mode,
          allowManualVerification: options.allowManualVerification,
          manualVerificationTimeoutMs:
            options.manualVerificationTimeoutMs,
          verbose: options.verbose,
          mock: options.mock,
        };
        const processed = options.catchUpCurrent
          ? await processSmokingpipesCatchUpCycles({
              ...detailProcessingOptions,
              detailMaxPerRun: options.detailMaxPerRun,
              autoRepeat: options.autoRepeatCatchUp,
              maxCycles: options.catchUpRepeatMaxCycles,
              repeatDelayMinMs: options.catchUpRepeatDelayMinMs,
              repeatDelayMaxMs: options.catchUpRepeatDelayMaxMs,
              maxTotalDetails: options.catchUpMaxTotalDetails,
              maxRuntimeMinutes: options.catchUpMaxRuntimeMinutes,
            })
          : await processSmokingpipesDetailsQueue({
              ...detailProcessingOptions,
              maxItems: options.detailMaxPerRun,
            });
        queue = processed.queue;
        runRecord.detailsResult = processed.result;
        runRecord.captchaRequired = processed.result.captchaRequired;
        runRecord.browser =
          processed.result.browser || runRecord.browser;
        runRecord.manualVerificationRecovered =
          processed.result.manualVerificationRecovered === true;
      } else {
        runRecord.currentStep = "details-already-complete";
        runRecord.detailsResult = {
          requested: 0,
          selected: 0,
          attempted: 0,
          completed: 0,
          failed: 0,
          captchaRequired: false,
          stopReason: "existing-queue-only",
        };
        if (options.verbose) {
          console.log(
            "using existing completed detail queue; no detail crawling requested"
          );
        }
      }
    } else {
      runRecord.currentStep = "details-skipped";
      runRecord.detailsResult = {
        requested: 0,
        selected: 0,
        attempted: 0,
        completed: 0,
        failed: 0,
        captchaRequired: false,
      };
      if (options.verbose) {
        console.log(`new details skipped: ${detailsDecision.reason}`);
      }
    }

    runRecord.queueSummary = summarizeDetailsQueue(queue);
    runRecord.readiness = evaluateRunnerReadiness({
      inventoryValidation: validation,
      diff,
      queue,
      detailsFetchAllowed: detailsDecision.allowed,
    });
    runRecord.status = runRecord.readiness.status;

    if (options.mode === "apply-dry-run") {
      runRecord.currentStep = "apply-dry-run";
      if (
        !shouldGenerateFinalApplyDryRunOutputs({
          mode: options.mode,
          readiness: runRecord.readiness,
        })
      ) {
        runRecord.warnings.push(
          `apply-dry-run skipped: ${runRecord.readiness.reasons.join("; ")}`
        );
        const pendingReport = buildSmokingpipesPendingApplyDryRunReport({
          runId,
          diff,
          queueSummary: runRecord.queueSummary,
          detailsResult: runRecord.detailsResult,
          reasons: runRecord.readiness.reasons,
          catchUpCurrent: options.catchUpCurrent,
        });
        await writeTextAtomic(paths.applyReport, pendingReport);
      } else {
        const existingProducts = readJsonIfExists(
          paths.existingProducts,
          []
        );
        const danishProducts = readJsonIfExists(paths.danishProducts, []);
        const artifacts = await buildSmokingpipesApplyDryRunArtifacts({
          existingProducts: Array.isArray(existingProducts)
            ? existingProducts
            : existingProducts.products || [],
          currentPayload: current,
          diff,
          inventoryValidation: validation,
          queue,
          danishProducts: Array.isArray(danishProducts)
            ? danishProducts
            : danishProducts.products || [],
        });
        const baselineReadinessReport =
          buildSmokingpipesBaselineReadinessReport({
            runId,
            readiness: artifacts.candidate.readiness,
            publicValidation: artifacts.publicPayloads.validation,
          });
        await writeJsonAtomic(
          paths.baselineReadinessReportJson,
          baselineReadinessReport
        );
        await writeTextAtomic(
          paths.baselineReadinessReportMarkdown,
          buildSmokingpipesBaselineReadinessMarkdown(
            baselineReadinessReport
          )
        );
        runRecord.baselineReadinessReport = {
          json: relative(paths.baselineReadinessReportJson),
          markdown: relative(paths.baselineReadinessReportMarkdown),
        };
        const applyReport = buildSmokingpipesApplyDryRunReport({
          runId,
          artifacts,
          detailsResult: runRecord.detailsResult,
          catchUpCurrent: options.catchUpCurrent,
        });
        if (!artifacts.candidate.candidateReady) {
          runRecord.status = "blocked";
          runRecord.readiness.allowApply = false;
          runRecord.readiness.reasons.push(
            ...artifacts.candidate.blockedReasons
          );
          runRecord.errors.push(
            ...artifacts.publicPayloads.validation.errors
          );
          await writeTextAtomic(
            paths.applyReport,
            buildSmokingpipesPendingApplyDryRunReport({
              runId,
              diff,
              queueSummary: runRecord.queueSummary,
              detailsResult: runRecord.detailsResult,
              reasons: runRecord.readiness.reasons,
              catchUpCurrent: options.catchUpCurrent,
            })
          );
        } else {
          runRecord.applyDryRun =
            await writeSmokingpipesApplyDryRunOutputs({
              paths,
              candidate: artifacts.candidate,
              publicPayloads: artifacts.publicPayloads,
              report: applyReport,
            });
          runRecord.applyDryRun = {
            ...runRecord.applyDryRun,
            productsNext: relative(paths.productsNext),
            publicNext: relative(paths.publicNextRoot),
            report: relative(paths.applyReport),
          };
        }
      }
    }

    runRecord.currentStep = "complete";
    runRecord.finishedAt = new Date().toISOString();
    runRecord.nextStep = baselineCatchUpNextStep({
      catchUpCurrent: options.catchUpCurrent,
      detailsComplete: Boolean(runRecord.readiness?.detailsComplete),
      outputsGenerated: Boolean(runRecord.applyDryRun),
    });
    releaseRunLock(lock);
    runRecord.lockReleased = !fs.existsSync(paths.lock);
    await writeRunReports(paths, runRecord);
    await writeState(paths, state, {
      status: runRecord.status,
      lastStep: "complete",
      lastError: null,
      manualActionRequired: false,
      captchaRequired: false,
      currentProductId: null,
      currentRunId: null,
      latestReport: runRecord.latestReport,
    });

    console.log(
      JSON.stringify(
        {
          runId,
          status: runRecord.status,
          mode: options.mode,
          mock: options.mock,
          allowApply: runRecord.readiness.allowApply,
          queue: runRecord.queueSummary,
          latestReport: runRecord.latestReport,
          productionWritten: false,
        },
        null,
        2
      )
    );
  } catch (error) {
    const classified = classifyRunnerError(error);
    runRecord.status = classified.status;
    runRecord.finishedAt = new Date().toISOString();
    runRecord.errors.push(classified.message);
    runRecord.manualActionRequired = classified.manualActionRequired;
    runRecord.captchaRequired = classified.captchaRequired;
    runRecord.checkpointFailed = classified.checkpointFailed;
    runRecord.checkpointTargetPath = classified.targetPath;
    runRecord.checkpointTempPath = classified.tempPath;
    runRecord.checkpointAttempts = classified.attempts;
    runRecord.checkpointLastErrorCode = classified.lastErrorCode;
    runRecord.captchaDetected =
      runRecord.captchaDetected || classified.captchaRequired;
    runRecord.currentProductId = classified.currentProductId;
    const checkpointedQueue = readJsonIfExists(paths.queue, null);
    if (checkpointedQueue) {
      runRecord.queueSummary = summarizeDetailsQueue(checkpointedQueue);
    }
    runRecord.nextStep =
      error?.code === "INVALID_EXISTING_DRY_RUN"
        ? "Run a complete list-only dry-run, review its validation result, then retry apply-dry-run."
        : error?.code === "CHECKPOINT_FAILED"
          ? "Inspect the preserved temp queue, release the Windows file lock, then rerun catch-up; production data was not written."
        : classified.manualActionRequired
          ? "Open the local runner with manual verification enabled and complete the CAPTCHA in the visible browser."
          : "Inspect the error in the latest report, then retry after the underlying problem is fixed.";
    if (lock) {
      releaseRunLock(lock);
      runRecord.lockReleased = !fs.existsSync(paths.lock);
    }

    if (error?.code !== "LOCK_EXISTS") {
      await writeRunReports(paths, runRecord).catch(() => {});
      await writeState(paths, state, {
        lastRunAt: startedAt,
        status: classified.status,
        lastStep: runRecord.currentStep,
        lastError: classified.message,
        manualActionRequired: classified.manualActionRequired,
        captchaRequired: classified.captchaRequired,
        checkpointFailed: classified.checkpointFailed,
        checkpointTargetPath: classified.targetPath,
        checkpointTempPath: classified.tempPath,
        checkpointAttempts: classified.attempts,
        checkpointLastErrorCode: classified.lastErrorCode,
        currentProductId: classified.currentProductId,
        currentRunId: null,
        latestReport: runRecord.latestReport || state.latestReport,
      }).catch(() => {});
    }
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (lock && fs.existsSync(paths.lock)) releaseRunLock(lock);
  }
}

await run();
