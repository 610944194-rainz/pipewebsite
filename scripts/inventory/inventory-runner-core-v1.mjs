import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ALLOWED_MODES = new Set([
  "dry-run",
  "apply-dry-run",
  "daily-update",
  "verification-probe",
  "detail-probe",
  "browser-preflight",
  "progressive-ingest-list",
  "progressive-apply-brand-exclusions",
  "progressive-detail-chunk",
  "progressive-manual-detail-backfill",
  "progressive-build-candidate",
  "progressive-prepare-apply",
  "progressive-partial-apply",
  "apply",
]);

function booleanValue(value, fallback = false) {
  if (value === undefined) return fallback;
  if (value === true) return true;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveSafeInteger(value, fallback, label) {
  if (value === undefined) return fallback;
  const text = String(value).trim();
  if (!/^[1-9]\d*$/.test(text)) {
    throw new Error(`--${label} must be a positive integer.`);
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`--${label} must be a positive safe integer.`);
  }
  return parsed;
}

function nonNegativeInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizedRange(minimum, maximum) {
  return {
    minimum,
    maximum: Math.max(minimum, maximum),
  };
}

function parseArguments(argv) {
  const out = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) continue;

    const body = argument.slice(2);
    if (body.includes("=")) {
      const [key, ...parts] = body.split("=");
      out.set(key, parts.join("="));
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      out.set(body, next);
      index += 1;
    } else {
      out.set(body, true);
    }
  }

  return out;
}

export function parseRunnerOptions(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  const progressivePrepareApplyAlias = booleanValue(
    args.get("progressive-prepare-apply"),
    false
  );
  const explicitMode = args.has("mode")
    ? String(args.get("mode") || "").toLowerCase()
    : null;
  if (
    progressivePrepareApplyAlias &&
    explicitMode &&
    explicitMode !== "progressive-prepare-apply"
  ) {
    throw new Error(
      `--progressive-prepare-apply conflicts with --mode=${explicitMode}.`
    );
  }
  const mode = String(
    booleanValue(args.get("manual-detail-backfill-all"), false)
      ? "progressive-manual-detail-backfill"
      : progressivePrepareApplyAlias
        ? "progressive-prepare-apply"
      : booleanValue(args.get("detail-probe"), false)
      ? "detail-probe"
      : booleanValue(args.get("verification-probe"), false)
        ? "verification-probe"
        : booleanValue(args.get("daily-update"), false)
          ? "daily-update"
          : args.get("mode") || "dry-run"
  ).toLowerCase();
  const source = String(args.get("source") || "smokingpipes").toLowerCase();
  const dailyUpdate = mode === "daily-update";
  const verificationProbe = mode === "verification-probe";
  const detailProbe = mode === "detail-probe";
  const browserPreflight = mode === "browser-preflight";
  const progressiveMode = mode.startsWith("progressive-");
  const manualDetailBackfill =
    mode === "progressive-manual-detail-backfill";
  const manualDetailLimit = Math.min(
    50,
    positiveInteger(args.get("limit"), 30)
  );
  const manualDetailUntilEmpty = booleanValue(
    args.get("until-empty"),
    false
  );
  const manualDetailMaxTotal = positiveInteger(
    args.get("max-total"),
    manualDetailUntilEmpty ? 500 : manualDetailLimit
  );
  const maxPages = positiveInteger(args.get("max-pages"), 200);
  const fullReconcile =
    (dailyUpdate || verificationProbe) && maxPages > 10;
  const shortDailyNewScan = dailyUpdate && maxPages <= 10;
  const catchUpCurrent =
    booleanValue(args.get("catch-up-current"), false) ||
    booleanValue(args.get("baseline-catch-up"), false);
  const autoRepeatCatchUp = booleanValue(
    args.get("auto-repeat-catch-up"),
    false
  );
  const requestedPageDelayMinMs = nonNegativeInteger(
    args.get("page-delay-min-ms"),
    verificationProbe
      ? 3000
      : fullReconcile
        ? 3000
        : dailyUpdate
          ? 1000
          : 8000
  );
  const requestedPageDelayMaxMs = nonNegativeInteger(
    args.get("page-delay-max-ms"),
    verificationProbe
      ? 6000
      : fullReconcile
        ? 6000
        : dailyUpdate
          ? 3000
          : 18000
  );
  const requestedPageWarmupMinMs = nonNegativeInteger(
    args.get("page-warmup-min-ms"),
    verificationProbe
      ? 1500
      : fullReconcile
        ? 1500
        : dailyUpdate
          ? 500
          : 3000
  );
  const requestedPageWarmupMaxMs = nonNegativeInteger(
    args.get("page-warmup-max-ms"),
    verificationProbe
      ? 3000
      : fullReconcile
        ? 3000
        : dailyUpdate
          ? 1500
          : 7000
  );
  const requestedPageBatchSize = nonNegativeInteger(
    args.get("page-batch-size"),
    dailyUpdate || verificationProbe ? 30 : 0
  );
  const requestedPageBatchCooldownMinMs = nonNegativeInteger(
    args.get("page-batch-cooldown-min-ms"),
    verificationProbe ? 30000 : fullReconcile ? 30000 : 0
  );
  const requestedPageBatchCooldownMaxMs = nonNegativeInteger(
    args.get("page-batch-cooldown-max-ms"),
    verificationProbe ? 60000 : fullReconcile ? 60000 : 0
  );
  const pageDelayRange = normalizedRange(
    fullReconcile
      ? Math.max(3000, requestedPageDelayMinMs)
      : requestedPageDelayMinMs,
    fullReconcile
      ? Math.max(6000, requestedPageDelayMaxMs)
      : requestedPageDelayMaxMs
  );
  const pageWarmupRange = normalizedRange(
    fullReconcile
      ? Math.max(1500, requestedPageWarmupMinMs)
      : requestedPageWarmupMinMs,
    fullReconcile
      ? Math.max(3000, requestedPageWarmupMaxMs)
      : requestedPageWarmupMaxMs
  );
  const pageBatchCooldownRange = normalizedRange(
    fullReconcile
      ? Math.max(30000, requestedPageBatchCooldownMinMs)
      : requestedPageBatchCooldownMinMs,
    fullReconcile
      ? Math.max(60000, requestedPageBatchCooldownMaxMs)
      : requestedPageBatchCooldownMaxMs
  );
  const pageBatchSize = fullReconcile
    ? Math.min(30, requestedPageBatchSize || 30)
    : requestedPageBatchSize;
  const pacingDowngraded =
    fullReconcile &&
    (pageDelayRange.minimum !== requestedPageDelayMinMs ||
      pageDelayRange.maximum !==
        Math.max(requestedPageDelayMinMs, requestedPageDelayMaxMs) ||
      pageWarmupRange.minimum !== requestedPageWarmupMinMs ||
      pageWarmupRange.maximum !==
        Math.max(requestedPageWarmupMinMs, requestedPageWarmupMaxMs) ||
      pageBatchSize !== requestedPageBatchSize ||
      pageBatchCooldownRange.minimum !==
        requestedPageBatchCooldownMinMs ||
      pageBatchCooldownRange.maximum !==
        Math.max(
          requestedPageBatchCooldownMinMs,
          requestedPageBatchCooldownMaxMs
        ));
  const detailWarmupRange = normalizedRange(
    nonNegativeInteger(
      args.get("detail-warmup-min-ms"),
      detailProbe ? 2000 : catchUpCurrent || dailyUpdate ? 1000 : 5000
    ),
    nonNegativeInteger(
      args.get("detail-warmup-max-ms"),
      detailProbe ? 4000 : catchUpCurrent || dailyUpdate ? 3000 : 12000
    )
  );
  const detailDelayRange = normalizedRange(
    nonNegativeInteger(
      args.get("detail-delay-min-ms"),
      detailProbe ? 5000 : catchUpCurrent || dailyUpdate ? 3000 : 15000
    ),
    nonNegativeInteger(
      args.get("detail-delay-max-ms"),
      detailProbe ? 10000 : catchUpCurrent || dailyUpdate ? 8000 : 35000
    )
  );
  const detailBatchCooldownRange = normalizedRange(
    nonNegativeInteger(
      args.get("detail-batch-cooldown-min-ms"),
      detailProbe ? 30000 : catchUpCurrent || dailyUpdate ? 0 : 90000
    ),
    nonNegativeInteger(
      args.get("detail-batch-cooldown-max-ms"),
      detailProbe ? 60000 : catchUpCurrent || dailyUpdate ? 0 : 180000
    )
  );
  const catchUpRepeatDelayRange = normalizedRange(
    nonNegativeInteger(args.get("catch-up-repeat-delay-min-ms"), 300000),
    nonNegativeInteger(args.get("catch-up-repeat-delay-max-ms"), 600000)
  );
  const legacyDetailMax = positiveInteger(
    args.get("max-new-details-per-run"),
    catchUpCurrent ? 50 : dailyUpdate ? 100 : 10
  );
  const detailMaxPerRun = args.has("detail-max-per-run")
    ? positiveInteger(args.get("detail-max-per-run"), legacyDetailMax)
    : legacyDetailMax;
  const fetchNewDetails =
    booleanValue(args.get("fetch-new-details"), false) &&
    !booleanValue(args.get("skip-new-details"), false);
  const writeProduction = booleanValue(
    args.get("write-production"),
    false
  );
  const manualLargeApply = booleanValue(
    args.get("manual-large-apply"),
    false
  );
  const maxAutoApply = positiveSafeInteger(
    args.get("max-auto-apply"),
    1000,
    "max-auto-apply"
  );
  const legacyDuplicateSnapshotSha256 = args.has(
    "legacy-duplicate-snapshot-sha256"
  )
    ? String(args.get("legacy-duplicate-snapshot-sha256") || "").trim()
    : "";
  if (
    legacyDuplicateSnapshotSha256 &&
    !/^[a-f0-9]{64}$/i.test(legacyDuplicateSnapshotSha256)
  ) {
    throw new Error(
      "legacy-duplicate-snapshot-sha256 must be an exact 64-character SHA-256 value."
    );
  }
  const browserChannel = args.has("browser-channel")
    ? String(args.get("browser-channel") || "").toLowerCase()
    : null;
  const browserProfile = args.has("browser-profile")
    ? String(args.get("browser-profile") || "").toLowerCase()
    : null;
  const browserProfileDir = args.has("browser-profile-dir")
    ? path.resolve(String(args.get("browser-profile-dir") || ""))
    : null;

  if (
    browserChannel !== null &&
    !["msedge", "chrome", "chromium"].includes(browserChannel)
  ) {
    throw new Error(
      `Unsupported browser channel ${browserChannel}. Supported: msedge, chrome, chromium.`
    );
  }
  if (
    browserProfile !== null &&
    browserProfile !== "sp-chrome"
  ) {
    throw new Error(
      `Unsupported browser profile ${browserProfile}. Supported: sp-chrome.`
    );
  }

  if (!ALLOWED_MODES.has(mode)) {
    throw new Error(
      `Unsupported mode ${mode}. Supported: dry-run, apply-dry-run, daily-update, verification-probe, detail-probe, browser-preflight, progressive-ingest-list, progressive-apply-brand-exclusions, progressive-detail-chunk, progressive-manual-detail-backfill, progressive-build-candidate, progressive-prepare-apply, progressive-partial-apply, apply.`
    );
  }
  if (source !== "smokingpipes") {
    throw new Error(`V1 only supports --source=smokingpipes. Received ${source}.`);
  }
  if (mode === "apply") {
    throw new Error(
      "Production apply is not implemented in Inventory Automation V1."
    );
  }
  if (catchUpCurrent && mode !== "apply-dry-run") {
    throw new Error(
      "--catch-up-current requires --mode=apply-dry-run."
    );
  }
  if (dailyUpdate && catchUpCurrent) {
    throw new Error(
      "Baseline catch-up cannot run in --mode=daily-update."
    );
  }
  if (autoRepeatCatchUp && !catchUpCurrent) {
    throw new Error(
      "--auto-repeat-catch-up requires --catch-up-current."
    );
  }
  if (
    manualLargeApply &&
    mode !== "progressive-partial-apply"
  ) {
    throw new Error(
      "--manual-large-apply requires --mode=progressive-partial-apply."
    );
  }
  if (manualLargeApply && !writeProduction) {
    throw new Error(
      "--manual-large-apply requires --write-production."
    );
  }

  return {
    source,
    mode,
    dailyUpdate,
    verificationProbe,
    detailProbe,
    browserPreflight,
    progressiveMode,
    manualDetailBackfill,
    manualDetailLimit,
    manualDetailUntilEmpty,
    manualDetailCooldownMs: nonNegativeInteger(
      args.get("cooldown-ms"),
      0
    ),
    manualDetailMaxTotal,
    fullReconcile,
    shortDailyNewScan,
    pacingDowngraded,
    catchUpCurrent,
    autoRepeatCatchUp,
    refreshList: dailyUpdate || verificationProbe
      ? !booleanValue(args.get("no-refresh-list"), false)
      : booleanValue(args.get("refresh-list"), false),
    maxPages,
    expectedPages: positiveInteger(args.get("expected-pages"), maxPages),
    allowManualVerification: booleanValue(
      args.get("allow-manual-verification"),
      false
    ),
    browserChannel,
    browserProfile,
    browserProfileDir,
    currentListPath: args.has("current-list")
      ? path.resolve(String(args.get("current-list") || ""))
      : null,
    diffPath: args.has("diff")
      ? path.resolve(String(args.get("diff") || ""))
      : null,
    manualVerificationTimeoutMs: positiveInteger(
      args.get("manual-verification-timeout-ms"),
      30 * 60 * 1000
    ),
    pageDelayMinMs: pageDelayRange.minimum,
    pageDelayMaxMs: pageDelayRange.maximum,
    pageWarmupMinMs: pageWarmupRange.minimum,
    pageWarmupMaxMs: pageWarmupRange.maximum,
    pageBatchSize,
    pageBatchCooldownMinMs: pageBatchCooldownRange.minimum,
    pageBatchCooldownMaxMs: pageBatchCooldownRange.maximum,
    captchaCooldownMs: nonNegativeInteger(
      args.get("captcha-cooldown-ms"),
      60000
    ),
    fetchNewDetails:
      verificationProbe || detailProbe ? false : fetchNewDetails,
    allowPartialNewDetails: booleanValue(
      args.get("allow-partial-new-details"),
      false
    ),
    detailWarmupMinMs: detailWarmupRange.minimum,
    detailWarmupMaxMs: detailWarmupRange.maximum,
    detailDelayMinMs: detailDelayRange.minimum,
    detailDelayMaxMs: detailDelayRange.maximum,
    detailBatchSize: positiveInteger(
      args.get("detail-batch-size") ?? args.get("details-batch-size"),
      detailProbe ? 5 : catchUpCurrent || dailyUpdate ? 50 : 5
    ),
    detailBatchCooldownMinMs: detailBatchCooldownRange.minimum,
    detailBatchCooldownMaxMs: detailBatchCooldownRange.maximum,
    detailMaxPerRun,
    dailyNewMaxDetails: positiveInteger(
      args.get("daily-new-max-details"),
      100
    ),
    detailProbeMax: positiveInteger(
      args.get("detail-probe-max"),
      5
    ),
    progressiveDetailMax: positiveInteger(
      args.get("progressive-detail-max"),
      5
    ),
    maxAutoApply,
    legacyDuplicateSnapshotSha256,
    catchUpRepeatMaxCycles: positiveInteger(
      args.get("catch-up-repeat-max-cycles"),
      1
    ),
    catchUpRepeatDelayMinMs: catchUpRepeatDelayRange.minimum,
    catchUpRepeatDelayMaxMs: catchUpRepeatDelayRange.maximum,
    catchUpMaxTotalDetails: positiveInteger(
      args.get("catch-up-max-total-details"),
      200
    ),
    catchUpMaxRuntimeMinutes: positiveInteger(
      args.get("catch-up-max-runtime-minutes"),
      90
    ),
    detailsBatchSize: positiveInteger(
      args.get("detail-batch-size") ?? args.get("details-batch-size"),
      catchUpCurrent || dailyUpdate ? 50 : 5
    ),
    maxNewDetailsPerRun: detailMaxPerRun,
    commit: args.has("commit") && !args.has("no-commit"),
    deploy: args.has("deploy") && !args.has("no-deploy"),
    writeProduction,
    manualLargeApply,
    verbose: booleanValue(args.get("verbose"), false),
    forceUnlock: booleanValue(args.get("force-unlock"), false),
    mock: booleanValue(args.get("mock"), false),
    mockVerification: String(
      args.get("mock-verification") || ""
    ).toLowerCase(),
    help: args.has("help") || args.has("h"),
  };
}

export function resolveInventoryInputStrategy({
  mode,
  refreshList = false,
}) {
  const shouldRefresh =
    mode === "dry-run" ||
    mode === "daily-update" ||
    Boolean(refreshList);
  return {
    refreshList: shouldRefresh,
    useExistingArtifacts: mode === "apply-dry-run" && !shouldRefresh,
  };
}

export function validateReusableInventoryArtifacts({
  current,
  diff,
}) {
  const errors = [];
  const warnings = [];

  if (!current) errors.push("Existing current-list dry-run is missing.");
  if (!diff) errors.push("Existing inventory diff dry-run is missing.");

  if (current && diff) {
    const summary = current.summary || {};
    const coverage = diff.coverage || {};
    const products = Array.isArray(current.products) ? current.products : [];
    const failedPages = Array.isArray(summary.failedPages)
      ? summary.failedPages
      : [];
    const currentExpectedPages = Number(
      summary.expectedPages ?? current.config?.expectedPages ?? 0
    );
    const productsExtracted = Number(summary.productsExtracted || 0);
    const uniqueProducts = Number(summary.uniqueProducts || 0);
    const duplicateIds = summary.duplicateSourceProductIds || [];
    const diffExpectedPages = Number(coverage.expectedPages ?? 0);

    if (summary.fullExpectedRangeScanned !== true) {
      errors.push("Current list does not cover the full expected page range.");
    }
    if (currentExpectedPages <= 0) {
      errors.push(
        "Current list is missing a trustworthy dynamically detected expected page count."
      );
    }
    if (failedPages.length > 0) {
      errors.push(
        `Current list has failed pages: ${failedPages.join(", ")}.`
      );
    }
    if (
      summary.captchaDetected === true ||
      (summary.captchaPages || []).length > 0
    ) {
      errors.push("Current list recorded CAPTCHA/verification detection.");
    }
    if (productsExtracted <= 0 || products.length <= 0) {
      errors.push("Current list contains no extracted products.");
    }
    if (
      productsExtracted !== products.length ||
      uniqueProducts !== productsExtracted ||
      duplicateIds.length > 0
    ) {
      errors.push(
        "Current list product totals are inconsistent or contain duplicate IDs."
      );
    }
    if (coverage.fullExpectedRangeScanned !== true) {
      errors.push("Inventory diff does not cover the full expected page range.");
    }
    if (
      diffExpectedPages <= 0 ||
      diffExpectedPages !== currentExpectedPages
    ) {
      errors.push(
        `Inventory diff expected pages (${diffExpectedPages}) do not match the current-list dynamic expected pages (${currentExpectedPages}).`
      );
    }
    if (diff.allowApply !== true) {
      errors.push("Inventory diff safety gate did not allow apply.");
    }
    if ((diff.fatalWarnings || []).length > 0) {
      errors.push("Inventory diff contains fatal warnings.");
    }
    if (
      Number(diff.counts?.currentAvailable || 0) !== productsExtracted
    ) {
      errors.push(
        "Inventory diff current count does not match the current-list product count."
      );
    }

    if (current.runId && diff.runId) {
      if (String(current.runId) !== String(diff.runId)) {
        errors.push("Current-list and inventory diff runId values do not match.");
      }
    } else {
      warnings.push(
        "Current-list and inventory diff runId correspondence cannot be strongly verified because one or both files have no runId."
      );
    }
  }

  return {
    status: errors.length ? "blocked" : "passed",
    allowApply: errors.length === 0,
    counts: diff?.counts || {},
    coverage: diff?.coverage || {},
    errors,
    warnings,
  };
}

export function formatRunId(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

export function getRunnerPaths(root, options = {}) {
  const mock = Boolean(options.mock);
  const base = mock
    ? path.join(root, ".cache", "inventory-v1", "mock")
    : root;
  const inventoryRoot = mock
    ? path.join(base, "data", "inventory")
    : path.join(root, "data", "inventory");
  const reviewRoot = mock
    ? path.join(base, "data", "review")
    : path.join(root, "data", "review");

  return {
    root,
    base,
    inventoryRoot,
    reviewRoot,
    stateDir: path.join(inventoryRoot, "state"),
    state: path.join(
      inventoryRoot,
      "state",
      "smokingpipes-inventory-state.json"
    ),
    lock: path.join(inventoryRoot, "state", "smokingpipes.lock"),
    queue: path.join(
      inventoryRoot,
      "smokingpipes-new-details-queue.json"
    ),
    currentList: path.join(
      inventoryRoot,
      "smokingpipes-current-list-dry-run.json"
    ),
    diff: path.join(
      inventoryRoot,
      "smokingpipes-inventory-diff-dry-run.json"
    ),
    recentNew: path.join(inventoryRoot, "recent-new-dry-run.json"),
    existingProducts: path.join(
      base,
      "data",
      "products",
      "smokingpipes-products.json"
    ),
    danishProducts: path.join(
      base,
      "data",
      "products",
      "danish-products.json"
    ),
    unifiedProductsStaging: path.join(
      base,
      "data",
      "products",
      "unified-products-staging.json"
    ),
    backupRoot: path.join(base, "data", "backups"),
    detailCaches: [
      path.join(root, "data", "raw", "smokingpipes-details-new-final.json"),
      path.join(root, "data", "raw", "smokingpipes-details-new.json"),
      path.join(root, "data", "raw", "smokingpipes-details-new-recovered.json"),
      path.join(root, "data", "raw", "smokingpipes-details-new-merged.json"),
    ],
    runReports: path.join(reviewRoot, "inventory-runs"),
    latestReport: path.join(
      reviewRoot,
      "smokingpipes-inventory-latest-report.md"
    ),
    legacyReport: path.join(
      reviewRoot,
      "smokingpipes-inventory-update-report-v1.md"
    ),
    applyReport: path.join(
      reviewRoot,
      "smokingpipes-apply-dry-run-report-v1.md"
    ),
    baselineReadinessReportJson: path.join(
      reviewRoot,
      "smokingpipes-baseline-catchup-readiness-report.json"
    ),
    baselineReadinessReportMarkdown: path.join(
      reviewRoot,
      "smokingpipes-baseline-catchup-readiness-report.md"
    ),
    productsNext: path.join(
      base,
      "data",
      "products",
      "smokingpipes-products-next-dry-run.json"
    ),
    publicNextRoot: path.join(
      base,
      "data",
      "generated",
      "public-products-next"
    ),
    dailyState: path.join(
      inventoryRoot,
      "smokingpipes-daily-update-state.json"
    ),
    dailyLock: path.join(
      inventoryRoot,
      "state",
      "smokingpipes-daily-update.lock"
    ),
    dailyQueue: path.join(
      inventoryRoot,
      "smokingpipes-daily-new-details-queue.json"
    ),
    dailyProductsNext: path.join(
      base,
      "data",
      "products",
      "smokingpipes-products-daily-next-dry-run.json"
    ),
    dailyPublicNextRoot: path.join(
      base,
      "data",
      "generated",
      "public-products-daily-next"
    ),
    dailyReportMarkdown: path.join(
      reviewRoot,
      "smokingpipes-daily-update-report.md"
    ),
    dailyReportJson: path.join(
      reviewRoot,
      "smokingpipes-daily-update-report.json"
    ),
    dailyAuditMarkdown: path.join(
      reviewRoot,
      "smokingpipes-daily-update-audit-report.md"
    ),
    dailyAuditJson: path.join(
      reviewRoot,
      "smokingpipes-daily-update-audit-report.json"
    ),
    verificationTelemetry: path.join(
      inventoryRoot,
      "smokingpipes-verification-telemetry.json"
    ),
    verificationTelemetryReport: path.join(
      reviewRoot,
      "smokingpipes-verification-telemetry-report.md"
    ),
    verificationProbeLock: path.join(
      inventoryRoot,
      "state",
      "smokingpipes-verification-probe.lock"
    ),
    detailProbeTelemetry: path.join(
      inventoryRoot,
      "smokingpipes-detail-probe-telemetry.json"
    ),
    detailProbeReport: path.join(
      reviewRoot,
      "smokingpipes-detail-probe-report.md"
    ),
    detailProbeLock: path.join(
      inventoryRoot,
      "state",
      "smokingpipes-detail-probe.lock"
    ),
    browserProfileLock: path.join(
      inventoryRoot,
      "state",
      "smokingpipes-chrome-profile.lock"
    ),
    browserProfileState: path.join(
      inventoryRoot,
      "smokingpipes-browser-profile-state.json"
    ),
    browserProfileReport: path.join(
      reviewRoot,
      "smokingpipes-browser-profile-report.md"
    ),
    progressiveState: path.join(
      inventoryRoot,
      "smokingpipes-progressive-daily-state.json"
    ),
    progressiveLock: path.join(
      inventoryRoot,
      "state",
      "smokingpipes-progressive-daily.lock"
    ),
    progressiveProductsNext: path.join(
      base,
      "data",
      "products",
      "smokingpipes-products-partial-next-dry-run.json"
    ),
    progressivePublicNextRoot: path.join(
      base,
      "data",
      "generated",
      "public-products-partial-next"
    ),
    productionPublicRoot: path.join(
      base,
      "data",
      "generated",
      "public-products"
    ),
    progressiveAuditMarkdown: path.join(
      reviewRoot,
      "smokingpipes-progressive-partial-audit-report.md"
    ),
    progressiveAuditJson: path.join(
      reviewRoot,
      "smokingpipes-progressive-partial-audit-report.json"
    ),
    progressiveReportMarkdown: path.join(
      reviewRoot,
      "smokingpipes-progressive-daily-report.md"
    ),
    progressiveReportJson: path.join(
      reviewRoot,
      "smokingpipes-progressive-daily-report.json"
    ),
    progressiveBrandExclusionReportMarkdown: path.join(
      reviewRoot,
      "smokingpipes-brand-exclusion-report.md"
    ),
    progressiveBrandExclusionReportJson: path.join(
      reviewRoot,
      "smokingpipes-brand-exclusion-report.json"
    ),
    progressiveManualBackfillReportMarkdown: path.join(
      reviewRoot,
      "smokingpipes-manual-detail-backfill-report.md"
    ),
    progressiveManualBackfillReportJson: path.join(
      reviewRoot,
      "smokingpipes-manual-detail-backfill-report.json"
    ),
    progressiveApplyPreview: path.join(
      reviewRoot,
      "smokingpipes-progressive-partial-apply-preview.json"
    ),
    progressiveApplyGateReport: path.join(
      reviewRoot,
      "smokingpipes-progressive-apply-gate-report.json"
    ),
  };
}

export function readJsonIfExists(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const ATOMIC_RENAME_RETRY_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

function atomicRenameDelayMs(retryNumber, random = Math.random) {
  const baseMs = Math.min(
    1000,
    100 * 2 ** Math.max(0, retryNumber - 1)
  );
  const jitterMs = Math.floor(baseMs * 0.25 * random());
  return Math.min(1000, baseMs + jitterMs);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function writeTextAtomic(filePath, text, options = {}) {
  const {
    maxRenameAttempts = 20,
    rename = fs.promises.rename,
    sleep: wait = sleep,
    random = Math.random,
    verbose = false,
  } = options;
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.promises.writeFile(tempPath, text, "utf8");

  let lastError = null;
  for (let attempt = 1; attempt <= maxRenameAttempts; attempt += 1) {
    try {
      await rename(tempPath, filePath);
      return {
        targetPath: filePath,
        tempPath,
        attempts: attempt,
      };
    } catch (error) {
      lastError = error;
      const retryable = ATOMIC_RENAME_RETRY_CODES.has(error?.code);
      if (!retryable || attempt >= maxRenameAttempts) break;

      if (verbose) {
        console.warn(
          `atomic write rename busy, retry ${attempt}/${maxRenameAttempts} | target: ${filePath} | error: ${error.code}`
        );
      }
      await wait(atomicRenameDelayMs(attempt, random));
    }
  }

  throw Object.assign(
    new Error(
      `Atomic write checkpoint failed after retries: ${filePath}`
    ),
    {
      code: "ATOMIC_WRITE_RENAME_FAILED",
      targetPath: filePath,
      tempPath,
      attempts: maxRenameAttempts,
      lastError: {
        code: lastError?.code || null,
        message:
          lastError instanceof Error
            ? lastError.message
            : String(lastError || ""),
      },
      cause: lastError,
    }
  );
}

export async function writeJsonAtomic(filePath, payload, options = {}) {
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  JSON.parse(content);
  return writeTextAtomic(filePath, content, options);
}

export function acquireRunLock(lockPath, metadata, forceUnlock = false) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  if (fs.existsSync(lockPath)) {
    if (!forceUnlock) {
      const existing = fs.readFileSync(lockPath, "utf8");
      throw Object.assign(
        new Error(
          `Inventory automation is already running. Lock: ${lockPath}. ${existing}`
        ),
        { code: "LOCK_EXISTS" }
      );
    }
    fs.unlinkSync(lockPath);
  }

  const payload = {
    version: "inventory-run-lock-v1",
    createdAt: new Date().toISOString(),
    pid: process.pid,
    ...metadata,
  };
  const descriptor = fs.openSync(lockPath, "wx");
  fs.writeFileSync(descriptor, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.closeSync(descriptor);

  return { lockPath, runId: payload.runId };
}

export function releaseRunLock(lock) {
  if (!lock?.lockPath || !fs.existsSync(lock.lockPath)) return;

  try {
    const payload = JSON.parse(fs.readFileSync(lock.lockPath, "utf8"));
    if (lock.runId && payload.runId && payload.runId !== lock.runId) return;
  } catch {
    return;
  }

  fs.unlinkSync(lock.lockPath);
}

function queueItemFromCurrent(item, now) {
  return {
    id: `smokingpipes-${item.sourceProductId}`,
    sourceProductId: String(item.sourceProductId),
    sourceUrl: item.sourceUrl || "",
    title: item.title || item.rawTitle || "",
    brand: item.brand || "",
    listPrice: item.price || "",
    mainImage: item.mainImage || item.image || "",
    active: true,
    status: "pending",
    retryCount: 0,
    lastError: null,
    lastTriedAt: null,
    completedAt: null,
    detail: null,
    addedAt: now,
    updatedAt: now,
  };
}

function arrayFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["details", "products", "items"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

function validCachedDetail(item) {
  if (!item?.sourceProductId || !item?.sourceUrl) return false;
  return Boolean(
    item.fullTitle ||
      item.title ||
      item.productCode ||
      item.galleryImages?.length
  );
}

export function collectValidQueueTempDetails(queuePath) {
  const directory = path.dirname(queuePath);
  const prefix = `${path.basename(queuePath)}.tmp-`;
  const details = new Map();
  const tempFiles = [];

  if (!fs.existsSync(directory)) return { details, tempFiles };

  const candidates = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith(prefix))
    .map((entry) => path.join(directory, entry.name))
    .sort(
      (left, right) =>
        fs.statSync(left).mtimeMs - fs.statSync(right).mtimeMs
    );

  for (const tempPath of candidates) {
    try {
      const payload = JSON.parse(fs.readFileSync(tempPath, "utf8"));
      tempFiles.push(tempPath);
      for (const item of payload.items || []) {
        if (!validCachedDetail(item?.detail)) continue;
        details.set(String(item.sourceProductId), item.detail);
      }
    } catch {
      // Preserve unreadable temp files for manual recovery; do not trust them.
    }
  }

  return { details, tempFiles };
}

export function collectValidCachedDetails(payloads = []) {
  const details = new Map();

  for (const payload of payloads) {
    for (const item of arrayFromPayload(payload)) {
      if (!validCachedDetail(item)) continue;
      details.set(String(item.sourceProductId), item);
    }
  }

  return details;
}

export function shouldFetchNewDetails({
  fetchNewDetails,
  allowPartialNewDetails,
  fullExpectedRangeScanned,
}) {
  if (!fetchNewDetails) {
    return {
      allowed: false,
      reason: "new detail fetching was not requested",
    };
  }
  if (!fullExpectedRangeScanned && !allowPartialNewDetails) {
    return {
      allowed: false,
      reason:
        "partial scan details are blocked; use --allow-partial-new-details explicitly",
    };
  }
  return {
    allowed: true,
    reason: fullExpectedRangeScanned
      ? "full expected page range scanned"
      : "partial detail fetching explicitly allowed",
  };
}

export function buildDetailsQueue({
  existingQueue,
  diff,
  currentProducts,
  existingProductIds = new Set(),
  cachedDetails = new Map(),
  now = new Date().toISOString(),
}) {
  const existingItems = new Map(
    (existingQueue?.items || []).map((item) => [
      String(item.sourceProductId),
      item,
    ])
  );
  const currentById = new Map(
    currentProducts.map((item) => [String(item.sourceProductId), item])
  );
  const activeIds = new Set((diff.newIds || []).map(String));
  const items = [];
  const reconciliation = {
    newCandidatesFromDiff: activeIds.size,
    existingProductsSkipped: 0,
    alreadyCompletedSkipped: 0,
    cachedSkipped: 0,
    ignoredSkipped: 0,
    staleInProgressRepaired: 0,
    staleInProgressCached: 0,
    staleInProgressReset: 0,
    queuedNewDetails: 0,
  };

  for (const sourceProductId of activeIds) {
    const current = currentById.get(sourceProductId) || {
      sourceProductId,
    };
    const existing = existingItems.get(sourceProductId);
    const cachedDetail = cachedDetails.get(sourceProductId);
    const staleInProgress = existing?.status === "in-progress";

    if (existingProductIds.has(sourceProductId)) {
      reconciliation.existingProductsSkipped += 1;
      if (existing) {
        items.push({
          ...existing,
          active: false,
          status: "ignored",
          lastError: "sourceProductId already exists in production products",
          updatedAt: now,
        });
      }
      continue;
    }

    if (existing?.status === "completed") {
      reconciliation.alreadyCompletedSkipped += 1;
      items.push({
        ...existing,
        sourceUrl: current.sourceUrl || existing.sourceUrl || "",
        active: true,
        updatedAt: now,
      });
      continue;
    }

    if (existing?.status === "ignored" || existing?.status === "superseded") {
      reconciliation.ignoredSkipped += 1;
      items.push({
        ...existing,
        active: false,
        updatedAt: now,
      });
      continue;
    }

    if (cachedDetail) {
      reconciliation.cachedSkipped += 1;
      if (staleInProgress) {
        reconciliation.staleInProgressRepaired += 1;
        reconciliation.staleInProgressCached += 1;
      }
      const cachedItem = existing || queueItemFromCurrent(current, now);
      items.push({
        ...cachedItem,
        active: true,
        status: "completed",
        detail: cachedDetail,
        lastError: null,
        completedAt: existing?.completedAt || now,
        updatedAt: now,
      });
      continue;
    }

    const next = existing
      ? {
          ...existing,
          sourceUrl: current.sourceUrl || existing.sourceUrl || "",
          title: current.title || current.rawTitle || existing.title || "",
          brand: current.brand || existing.brand || "",
          listPrice: current.price || existing.listPrice || "",
          mainImage:
            current.mainImage ||
            current.image ||
            existing.mainImage ||
            "",
          active: true,
          status: existing.status === "blocked" ? "pending" : existing.status,
          updatedAt: now,
        }
      : queueItemFromCurrent(current, now);
    if (staleInProgress) {
      reconciliation.staleInProgressRepaired += 1;
      reconciliation.staleInProgressReset += 1;
      next.status = "pending";
      next.lastError = null;
    }
    reconciliation.queuedNewDetails += 1;
    items.push(next);
  }

  for (const existing of existingItems.values()) {
    if (activeIds.has(String(existing.sourceProductId))) continue;
    items.push({
      ...existing,
      active: false,
      status: "superseded",
      updatedAt: now,
    });
  }

  items.sort((left, right) =>
    String(left.sourceProductId).localeCompare(
      String(right.sourceProductId),
      "en",
      { numeric: true }
    )
  );

  return {
    version: "smokingpipes-new-details-queue-v1",
    source: "smokingpipes",
    createdAt: existingQueue?.createdAt || now,
    updatedAt: now,
    diffGeneratedAt: diff.generatedAt || null,
    reconciliation,
    items,
    summary: summarizeDetailsQueue({ items, reconciliation }),
  };
}

export function summarizeDetailsQueue(queue) {
  const active = (queue.items || []).filter((item) => item.active !== false);
  const count = (status) =>
    active.filter((item) => item.status === status).length;

  return {
    totalItems: (queue.items || []).length,
    activeItems: active.length,
    pending: count("pending"),
    inProgress: count("in-progress"),
    completed: count("completed"),
    failed: count("failed"),
    superseded: (queue.items || []).filter(
      (item) => item.status === "superseded"
    ).length,
    remaining: active.filter((item) => item.status !== "completed").length,
    ...(queue.reconciliation || {}),
  };
}

export function evaluateRunnerReadiness({
  inventoryValidation,
  diff,
  queue,
  detailsFetchAllowed,
}) {
  const queueSummary = summarizeDetailsQueue(queue || { items: [] });
  const reasons = [];
  const newDetailsCount = Number(
    diff?.counts?.new ??
      diff?.newIds?.length ??
      queueSummary.activeItems ??
      0
  );

  if (inventoryValidation?.status !== "passed") {
    reasons.push("inventory validation did not pass");
  }
  if (!diff?.allowApply) reasons.push("inventory diff safety gate did not pass");
  if (!diff?.coverage?.fullExpectedRangeScanned) {
    reasons.push("current list does not cover the full expected page range");
  }
  const queueAlreadyComplete =
    newDetailsCount > 0 &&
    queueSummary.remaining === 0 &&
    queueSummary.completed >= newDetailsCount;
  if (
    newDetailsCount > 0 &&
    detailsFetchAllowed === false &&
    !queueAlreadyComplete
  ) {
    reasons.push("new product details were not fetched in this run");
  } else if (queueSummary.remaining > 0) {
    reasons.push(`${queueSummary.remaining} new details remain incomplete`);
  }

  const inventoryReady =
    inventoryValidation?.status === "passed" &&
    inventoryValidation?.allowApply === true &&
    diff?.allowApply === true &&
    diff?.coverage?.fullExpectedRangeScanned === true;
  const detailsComplete =
    newDetailsCount === 0 ||
    queueAlreadyComplete ||
    (detailsFetchAllowed !== false && queueSummary.remaining === 0);
  const allowApply = inventoryReady && detailsComplete;
  let status = "dry-run-ready";

  if (!inventoryReady) status = "blocked";
  else if (
    newDetailsCount > 0 &&
    detailsFetchAllowed === false &&
    !queueAlreadyComplete
  ) {
    status = "dry-run-ready";
  }
  else if (!detailsComplete) status = "details-pending";
  else status = "apply-ready";

  return {
    status,
    inventoryReady,
    detailsComplete,
    allowApply,
    reasons,
    queue: queueSummary,
  };
}

export function shouldGenerateFinalApplyDryRunOutputs({
  mode,
  readiness,
}) {
  return (
    mode === "apply-dry-run" &&
    readiness?.inventoryReady === true &&
    readiness?.detailsComplete === true &&
    readiness?.allowApply === true
  );
}

export function baselineCatchUpNextStep({
  catchUpCurrent,
  detailsComplete,
  outputsGenerated = detailsComplete,
}) {
  if (!catchUpCurrent) {
    return outputsGenerated
      ? "Review the latest report. A separate explicit approval is still required before any future production apply."
      : "Run the inventory automation again to continue pending details, or complete manual verification if requested.";
  }
  if (!detailsComplete) {
    return "Continue baseline catch-up before enabling daily update.";
  }
  return outputsGenerated
    ? "Review generated next-dry-run outputs before formal apply."
    : "Review readiness report and fix candidate classification / conversion issues. Do not continue crawling.";
}

export function classifyRunnerError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const captcha = /captcha|verification blocked|manual verification/i.test(
    message
  );
  const invalidExistingDryRun =
    error?.code === "INVALID_EXISTING_DRY_RUN";
  const checkpointFailed = error?.code === "CHECKPOINT_FAILED";
  return {
    status:
      captcha ||
      invalidExistingDryRun ||
      checkpointFailed ||
      error?.code === "LOCK_EXISTS"
        ? "blocked"
        : "failed",
    message,
    manualActionRequired:
      captcha || invalidExistingDryRun || checkpointFailed,
    captchaRequired: captcha,
    checkpointFailed,
    currentProductId: error?.currentProductId || null,
    targetPath: error?.targetPath || null,
    tempPath: error?.tempPath || null,
    attempts: error?.attempts || 0,
    lastErrorCode: error?.lastError?.code || null,
    productionWritten: false,
  };
}

export function formatCheckpointFailureReport(run) {
  if (!run?.checkpointFailed) return "";
  return `## Queue Checkpoint Failure

- checkpoint failed: true
- last detail id: ${run.currentProductId || "unknown"}
- target queue path: ${run.checkpointTargetPath || "unknown"}
- temp queue path: ${run.checkpointTempPath || "unknown"}
- attempts: ${run.checkpointAttempts || 0}
- last error code: ${run.checkpointLastErrorCode || "unknown"}
- production data written: false
`;
}

export function initialInventoryState() {
  return {
    version: "smokingpipes-inventory-state-v1",
    source: "smokingpipes",
    lastRunAt: null,
    lastSuccessfulFetchAt: null,
    lastSuccessfulApplyAt: null,
    status: "idle",
    lastStep: "idle",
    lastError: null,
    manualActionRequired: false,
    captchaRequired: false,
    checkpointFailed: false,
    checkpointTargetPath: null,
    checkpointTempPath: null,
    checkpointAttempts: 0,
    checkpointLastErrorCode: null,
    currentProductId: null,
    currentRunId: null,
    latestReport: null,
  };
}
