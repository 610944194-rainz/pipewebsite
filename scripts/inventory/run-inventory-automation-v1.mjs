import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  acquireRunLock,
  buildDetailsQueue,
  classifyRunnerError,
  collectValidCachedDetails,
  evaluateRunnerReadiness,
  formatRunId,
  getRunnerPaths,
  initialInventoryState,
  parseRunnerOptions,
  readJsonIfExists,
  releaseRunLock,
  shouldFetchNewDetails,
  summarizeDetailsQueue,
  writeJsonAtomic,
  writeTextAtomic,
} from "./inventory-runner-core-v1.mjs";
import { processSmokingpipesDetailsQueue } from "./smokingpipes-details-queue-v1.mjs";
import { runSmokingpipesInventoryDryRun } from "./smokingpipes-update-dry-run-v1.mjs";
import { validateInventoryUpdate } from "./validate-inventory-update-v1.mjs";

const ROOT = process.cwd();

const HELP = `Smokingpipes Inventory Automation Runner V1

Usage:
  node scripts/inventory/run-inventory-automation-v1.mjs [options]

Options:
  --source=smokingpipes                 Inventory source (V1 only supports smokingpipes)
  --mode=dry-run                        Fetch, diff, validate, and advance detail queue (default)
  --mode=apply-dry-run                  Build isolated next-data candidates when every gate passes
  --mode=apply                          Reserved; V1 rejects production apply
  --max-pages=107                       List pages to scan (default: 107)
  --allow-manual-verification=true      Open a visible browser for manual CAPTCHA handling
  --browser-channel=msedge              Use msedge, chrome, or Playwright chromium
  --page-delay-min-ms=8000              Minimum delay before the next list page
  --page-delay-max-ms=18000             Maximum delay before the next list page
  --page-warmup-min-ms=3000             Minimum wait after opening a list page
  --page-warmup-max-ms=7000             Maximum wait after opening a list page
  --captcha-cooldown-ms=60000           Cooldown after CAPTCHA detection
  --fetch-new-details                   Explicitly enable fetching diff.newIds details
  --skip-new-details                    Explicitly keep this run list-only (default)
  --allow-partial-new-details           Permit details after a partial scan (not recommended)
  --detail-warmup-min-ms=5000           Minimum wait after opening a detail page
  --detail-warmup-max-ms=12000          Maximum wait after opening a detail page
  --detail-delay-min-ms=15000           Minimum delay before the next detail
  --detail-delay-max-ms=35000           Maximum delay before the next detail
  --detail-batch-size=5                 Details per batch before a longer cooldown
  --detail-batch-cooldown-min-ms=90000  Minimum batch cooldown
  --detail-batch-cooldown-max-ms=180000 Maximum batch cooldown
  --detail-max-per-run=10               Maximum new details fetched in one run
  --max-new-details-per-run=10          Legacy alias for --detail-max-per-run
  --no-commit | --commit                Commit intent flag; V1 never commits automatically
  --no-deploy                           Deployment stays disabled
  --verbose                             Print detail progress
  --force-unlock                        Remove an existing lock before starting (use carefully)
  --mock                                Run an isolated, offline synthetic test under .cache
  --help                                Show this help

Safety:
  The default mode is dry-run. Production apply is not implemented. Incomplete
  list coverage, failed validation, pending details, CAPTCHA, or network errors
  block apply readiness and never write production product/public data.
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

async function writeApplyDryRunCandidate(paths, run, current, diff, queue) {
  const completedDetails = (queue.items || [])
    .filter((item) => item.active !== false && item.status === "completed")
    .map((item) => item.detail);
  const generatedAt = new Date().toISOString();
  const candidate = {
    version: "smokingpipes-products-next-dry-run-v1",
    generatedAt,
    source: "smokingpipes",
    runId: run.runId,
    productionWritten: false,
    note: "Isolated candidate package only. Formal production apply is not implemented in V1.",
    inventory: {
      currentAvailableIds: diff.currentAvailableIds || current.products.map((item) => item.sourceProductId),
      newIds: diff.newIds || [],
      disappearedIds: diff.disappearedIds || [],
    },
    completedNewDetails: completedDetails,
  };
  const publicManifest = {
    version: "public-products-next-dry-run-v1",
    generatedAt,
    runId: run.runId,
    productionWritten: false,
    sourceCandidate: relative(paths.productsNext),
    note: "Framework manifest. Canonical conversion and public generation remain isolated until formal apply is approved.",
    counts: {
      currentAvailable: Number(diff.counts?.currentAvailable || 0),
      completedNewDetails: completedDetails.length,
    },
  };
  const applyReport = `# Smokingpipes Apply Dry-Run V1

- runId: ${run.runId}
- generatedAt: ${generatedAt}
- mode: apply-dry-run
- readiness allowApply: true
- formal apply executed: false
- production data written: false
- products candidate: ${relative(paths.productsNext)}
- public candidate manifest: ${relative(path.join(paths.publicNextRoot, "manifest.json"))}

This is an isolated candidate package. Production apply requires a separate implementation and explicit approval.
`;

  await writeJsonAtomic(paths.productsNext, candidate);
  await writeJsonAtomic(
    path.join(paths.publicNextRoot, "manifest.json"),
    publicManifest
  );
  await writeTextAtomic(paths.applyReport, applyReport);
  return {
    productsNext: relative(paths.productsNext),
    publicNext: relative(paths.publicNextRoot),
    report: relative(paths.applyReport),
  };
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

    runRecord.currentStep = "fetch-and-diff";
    await writeState(paths, state, { lastStep: runRecord.currentStep });

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
        maxPages: options.maxPages,
        expectedPages: options.expectedPages,
        browserChannel: options.browserChannel,
        allowManualVerification: options.allowManualVerification,
        manualVerificationTimeoutMs: options.manualVerificationTimeoutMs,
        pageDelayMinMs: options.pageDelayMinMs,
        pageDelayMaxMs: options.pageDelayMaxMs,
        pageWarmupMinMs: options.pageWarmupMinMs,
        pageWarmupMaxMs: options.pageWarmupMaxMs,
        captchaCooldownMs: options.captchaCooldownMs,
        verbose: options.verbose,
      });
      current = readJsonIfExists(paths.currentList);
      diff = readJsonIfExists(paths.diff);
      recentNew = readJsonIfExists(paths.recentNew);
      validation = validateInventoryUpdate();
    }

    if (!current || !diff || !recentNew) {
      throw new Error("Inventory dry-run did not produce every required output.");
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
      lastSuccessfulFetchAt: new Date().toISOString(),
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

    if (detailsDecision.allowed) {
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

      queue = buildDetailsQueue({
        existingQueue,
        diff,
        currentProducts: current.products || [],
        existingProductIds,
        cachedDetails,
      });
      await writeJsonAtomic(paths.queue, queue);
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

      const processed = await processSmokingpipesDetailsQueue({
        queue,
        queuePath: paths.queue,
        maxItems: options.detailMaxPerRun,
        batchSize: options.detailBatchSize,
        detailWarmupMinMs: options.detailWarmupMinMs,
        detailWarmupMaxMs: options.detailWarmupMaxMs,
        detailDelayMinMs: options.detailDelayMinMs,
        detailDelayMaxMs: options.detailDelayMaxMs,
        detailBatchCooldownMinMs: options.detailBatchCooldownMinMs,
        detailBatchCooldownMaxMs: options.detailBatchCooldownMaxMs,
        browserChannel: options.browserChannel,
        allowManualVerification: options.allowManualVerification,
        verbose: options.verbose,
        mock: options.mock,
      });
      queue = processed.queue;
      runRecord.detailsResult = processed.result;
      runRecord.captchaRequired = processed.result.captchaRequired;
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
      if (!runRecord.readiness.allowApply) {
        runRecord.warnings.push(
          `apply-dry-run skipped: ${runRecord.readiness.reasons.join("; ")}`
        );
      } else {
        runRecord.applyDryRun = await writeApplyDryRunCandidate(
          paths,
          runRecord,
          current,
          diff,
          queue
        );
      }
    }

    runRecord.currentStep = "complete";
    runRecord.finishedAt = new Date().toISOString();
    runRecord.nextStep = runRecord.readiness.allowApply
      ? "Review the latest report. A separate explicit approval is still required before any future production apply."
      : "Run the daily dry-run again to continue pending details, or complete manual verification if requested.";
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
    runRecord.captchaDetected =
      runRecord.captchaDetected || classified.captchaRequired;
    runRecord.currentProductId = classified.currentProductId;
    const checkpointedQueue = readJsonIfExists(paths.queue, null);
    if (checkpointedQueue) {
      runRecord.queueSummary = summarizeDetailsQueue(checkpointedQueue);
    }
    runRecord.nextStep = classified.manualActionRequired
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
