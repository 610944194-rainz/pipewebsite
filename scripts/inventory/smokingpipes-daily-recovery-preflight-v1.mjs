import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  clearStaleInventoryLocks,
  inspectInventoryLocks,
} from "./smokingpipes-inventory-lock-v1.mjs";
import {
  evaluateSmokingpipesCurrentListCache,
} from "./smokingpipes-current-list-cache-v1.mjs";

const DEFAULT_CURRENT_LIST_PATH =
  "data/inventory/smokingpipes-current-list-dry-run.json";
const DEFAULT_TASK_STATE_PATH =
  "data/inventory/smokingpipes-daily-task-state.json";
const DEFAULT_REPORT_JSON_PATH =
  "data/review/smokingpipes-daily-recovery-preflight-report.json";
const DEFAULT_REPORT_MD_PATH =
  "data/review/smokingpipes-daily-recovery-preflight-report.md";

export const DAILY_RECOVERY_LOCK_DEFINITIONS = [
  {
    name: "dailyTask",
    path: "data/inventory/smokingpipes-daily-task-lock.json",
  },
  {
    name: "global",
    path: "data/inventory/state/smokingpipes.lock",
  },
  {
    name: "progressiveDaily",
    path: "data/inventory/state/smokingpipes-progressive-daily.lock",
  },
];

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    preflightOnly: argv.includes("--preflight-only"),
    clearStaleLocks: argv.includes("--clear-stale-locks"),
    skipCurrentList: argv.includes("--skip-current-list"),
    allowStaleCurrentListCache: argv.includes("--allow-stale-current-list-cache"),
    allowDuplicateDedupe: argv.includes("--allow-duplicate-dedupe"),
    forceRunOnce: argv.includes("--force-run-once"),
    resumeFromCachedList: argv.includes("--resume-from-cached-list"),
    lockCurrentListSnapshotUntilComplete: argv.includes(
      "--lock-current-list-snapshot-until-complete"
    ),
    writeReport: !argv.includes("--no-write-report"),
  };

  for (const arg of argv) {
    if (arg.startsWith("--current-list=")) {
      options.currentListPath = arg.slice("--current-list=".length);
    } else if (arg.startsWith("--task-state=")) {
      options.taskStatePath = arg.slice("--task-state=".length);
    } else if (arg.startsWith("--report-json=")) {
      options.reportJsonPath = arg.slice("--report-json=".length);
    } else if (arg.startsWith("--report-md=")) {
      options.reportMarkdownPath = arg.slice("--report-md=".length);
    }
  }

  return options;
}

function resolvePath(root, filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\ufeff/, ""));
  } catch {
    return null;
  }
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function dateKeyFromDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function evaluateRetryWindow({ taskState, now, forceRunOnce }) {
  const nextRetryRecommendedAt = taskState?.nextRetryRecommendedAt || null;
  let blockedByRetryWindow = false;

  if (
    taskState?.status === "retryable-failed" &&
    nextRetryRecommendedAt &&
    !forceRunOnce
  ) {
    const retryAt = new Date(nextRetryRecommendedAt);
    blockedByRetryWindow =
      !Number.isNaN(retryAt.getTime()) && retryAt > now;
  }

  return {
    checked: true,
    nextRetryRecommendedAt,
    now: now.toISOString(),
    blockedByRetryWindow,
    forceRunOnce,
  };
}

function buildCurrentListPreflight({
  root,
  currentListPath,
  now,
  allowStaleCurrentListCache,
  allowDuplicateDedupe,
}) {
  const resolvedPath = resolvePath(root, currentListPath);
  const exists = fs.existsSync(resolvedPath);
  const cache = evaluateSmokingpipesCurrentListCache({
    currentListPath: resolvedPath,
    now,
    allowStale: allowStaleCurrentListCache,
    allowDuplicateDedupe,
  });
  const complete =
    cache.pagesScanned === 107 &&
    cache.expectedPages === 107 &&
    cache.pagesScanned === cache.expectedPages &&
    cache.productsExtracted > 0 &&
    cache.uniqueProducts > 0 &&
    !["captcha", "verification", "incomplete", "empty-products"].includes(
      cache.reason
    );

  return {
    checked: true,
    path: currentListPath,
    exists,
    complete,
    stale: Boolean(cache.stale),
    manualRecoveryAllowed: Boolean(allowStaleCurrentListCache),
    duplicateIdCount: Number(cache.duplicateIdCount || 0),
    duplicateIdCountFromField: Number(cache.duplicateIdCountFromField || 0),
    duplicateIdCountFromRecords: Number(cache.duplicateIdCountFromRecords || 0),
    dedupeRequired: Boolean(cache.dedupeRequired),
    dedupeSafe: cache.dedupeSafe !== false,
    conflictDuplicateIdCount: Number(cache.conflictDuplicateIdCount || 0),
    duplicateSamples: toArray(cache.duplicateSamples),
    usable: Boolean(cache.usable),
    reason: cache.reason,
    pagesScanned: Number(cache.pagesScanned || 0),
    expectedPages: Number(cache.expectedPages || 0),
    productsExtracted: Number(cache.productsExtracted || 0),
    uniqueProducts: Number(cache.uniqueProducts || 0),
    dateKey: cache.dateKey || null,
    safety: cache.safety || {
      soldByAbsenceAllowed: false,
      disappearedApplyAllowed: false,
    },
    warnings: toArray(cache.warnings),
  };
}

function normalizeLocks(lockSummary) {
  const locks = toArray(lockSummary?.locks);
  const activeLocks = toArray(lockSummary?.activeLocks);
  const clearedLocks = toArray(lockSummary?.clearedLocks);
  const staleLocks = locks.filter((lock) => lock.status === "stale");
  return {
    checked: true,
    hasActiveLock: activeLocks.length > 0,
    activeLocks,
    staleLocks,
    clearedLocks,
    locks,
  };
}

function buildExecutionPlan(options, currentListCache) {
  const steps = [];
  const forbiddenSteps = [];

  if (options.preflightOnly) {
    steps.push("write preflight report only");
  } else {
    steps.push("clear stale locks");
  }

  if (options.skipCurrentList) {
    steps.push("reuse existing current-list cache");
    forbiddenSteps.push("fetch current-list");
  } else {
    steps.push("fetch current-list if cache is not reusable");
  }

  steps.push("run diff/ingest/detail/candidate/apply according to existing daily runner safety gates");
  forbiddenSteps.push("sold-by-absence from stale cache");
  forbiddenSteps.push("disappeared apply from stale cache");

  return {
    skipCurrentList: Boolean(options.skipCurrentList),
    allowStaleCurrentListCache: Boolean(options.allowStaleCurrentListCache),
    allowDuplicateDedupe: Boolean(options.allowDuplicateDedupe),
    forceRunOnce: Boolean(options.forceRunOnce),
    resumeFromCachedList: Boolean(options.resumeFromCachedList),
    lockCurrentListSnapshotUntilComplete: Boolean(
      options.lockCurrentListSnapshotUntilComplete
    ),
    dedupeRequired: Boolean(currentListCache.dedupeRequired),
    dedupeSafe: currentListCache.dedupeSafe !== false,
    steps,
    forbiddenSteps,
  };
}

function buildNetworkPlan(options, currentListCache) {
  const resumeFromCachedList = Boolean(options.resumeFromCachedList);
  const willFetchCurrentList = resumeFromCachedList
    ? false
    : !Boolean(options.skipCurrentList);
  const willFetchDetails = !options.preflightOnly;

  return {
    willAccessSmokingpipes: willFetchCurrentList || willFetchDetails,
    willFetchCurrentList,
    willFetchDetails,
    willStartBrowser:
      !options.preflightOnly && (willFetchCurrentList || willFetchDetails),
    willUseExistingCurrentListCache:
      Boolean(options.skipCurrentList) && Boolean(currentListCache.usable),
    willUseExistingStateOnly: false,
  };
}

function buildResumePlan(options) {
  const resumeFromCachedList = Boolean(options.resumeFromCachedList);
  return {
    mode: resumeFromCachedList
      ? "cached-list-detail-resume"
      : "standard-daily-run",
    resumeFromCachedList,
    lockCurrentListSnapshotUntilComplete: Boolean(
      options.lockCurrentListSnapshotUntilComplete
    ),
    allowNextListFetchAfterComplete: resumeFromCachedList,
  };
}

function decideOverall({
  retryWindow,
  locks,
  currentListCache,
  options,
}) {
  if (locks.hasActiveLock) {
    return {
      status: "wait",
      canRun: false,
      canRunWithoutNetworkListScan: false,
      willFetchCurrentList: false,
      willUseManualRecoveryCache: false,
      willWriteProduction: false,
      reason: "active inventory lock",
    };
  }

  if (retryWindow.blockedByRetryWindow) {
    return {
      status: "wait",
      canRun: false,
      canRunWithoutNetworkListScan: false,
      willFetchCurrentList: false,
      willUseManualRecoveryCache: false,
      willWriteProduction: false,
      reason: "retry window has not arrived",
    };
  }

  if (options.skipCurrentList && !currentListCache.usable) {
    return {
      status:
        currentListCache.conflictDuplicateIdCount > 0 ? "unsafe" : "blocked",
      canRun: false,
      canRunWithoutNetworkListScan: false,
      willFetchCurrentList: false,
      willUseManualRecoveryCache: false,
      willWriteProduction: false,
      reason:
        options.resumeFromCachedList
          ? "ResumeFromCachedList requested but no safe current-list cache is available"
          : currentListCache.conflictDuplicateIdCount > 0
          ? "existing current-list cache has conflicting duplicate IDs"
          : "SkipCurrentList requested but no safe current-list cache can be reused.",
    };
  }

  return {
    status: "ready",
    canRun: true,
    canRunWithoutNetworkListScan:
      Boolean(options.skipCurrentList) && Boolean(currentListCache.usable),
    willFetchCurrentList: !options.skipCurrentList,
    willUseManualRecoveryCache:
      Boolean(options.skipCurrentList) && Boolean(currentListCache.manualRecoveryAllowed),
    willWriteProduction: false,
    reason: options.skipCurrentList
      ? "safe current-list cache can be reused without network list scan"
      : "normal daily runner may fetch current-list if needed",
  };
}

export function evaluateSmokingpipesDailyRecoveryPreflight({
  root = process.cwd(),
  now = new Date(),
  options = {},
  isProcessAlive,
} = {}) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const resolvedOptions = {
    preflightOnly: Boolean(options.preflightOnly),
    clearStaleLocks: Boolean(options.clearStaleLocks),
    resumeFromCachedList: Boolean(options.resumeFromCachedList),
    lockCurrentListSnapshotUntilComplete: Boolean(
      options.lockCurrentListSnapshotUntilComplete
    ),
    skipCurrentList:
      Boolean(options.skipCurrentList) || Boolean(options.resumeFromCachedList),
    allowStaleCurrentListCache: Boolean(options.allowStaleCurrentListCache),
    allowDuplicateDedupe: Boolean(options.allowDuplicateDedupe),
    forceRunOnce: Boolean(options.forceRunOnce),
  };
  const currentListPath = options.currentListPath || DEFAULT_CURRENT_LIST_PATH;
  const taskStatePath = options.taskStatePath || DEFAULT_TASK_STATE_PATH;
  const taskState = readJsonIfExists(resolvePath(root, taskStatePath));
  const retryWindow = evaluateRetryWindow({
    taskState,
    now: nowDate,
    forceRunOnce: resolvedOptions.forceRunOnce,
  });
  const lockOptions = {
    root,
    nowMs: nowDate.getTime(),
    lockDefinitions: DAILY_RECOVERY_LOCK_DEFINITIONS,
    ...(isProcessAlive ? { isProcessAlive } : {}),
  };
  const lockSummary =
    resolvedOptions.clearStaleLocks && !resolvedOptions.preflightOnly
      ? clearStaleInventoryLocks(lockOptions)
      : inspectInventoryLocks(lockOptions);
  const locks = normalizeLocks(lockSummary);
  const currentListCache = buildCurrentListPreflight({
    root,
    currentListPath,
    now: nowDate,
    allowStaleCurrentListCache: resolvedOptions.allowStaleCurrentListCache,
    allowDuplicateDedupe: resolvedOptions.allowDuplicateDedupe,
  });
  const executionPlan = buildExecutionPlan(resolvedOptions, currentListCache);
  const networkPlan = buildNetworkPlan(resolvedOptions, currentListCache);
  const resumePlan = buildResumePlan(resolvedOptions);
  const overall = decideOverall({
    retryWindow,
    locks,
    currentListCache,
    options: resolvedOptions,
  });
  const errors = [];
  const warnings = [];

  warnings.push(...toArray(currentListCache.warnings));
  if (currentListCache.conflictDuplicateIdCount > 0) {
    errors.push("current-list cache has conflicting duplicate IDs");
  }
  if (currentListCache.dedupeRequired && currentListCache.dedupeSafe) {
    warnings.push("current-list cache has duplicate IDs that can be safely deduped");
  }
  if (locks.staleLocks.length > 0 && resolvedOptions.preflightOnly) {
    warnings.push("stale locks detected; preflight only did not clear them");
  }
  if (currentListCache.stale && currentListCache.usable) {
    warnings.push("using stale current-list cache in manual recovery mode");
  }

  return {
    source: "smokingpipes",
    mode: "daily-recovery-preflight",
    generatedAt: nowDate.toISOString(),
    overall,
    retryWindow,
    locks,
    currentListCache,
    networkPlan,
    resumePlan,
    executionPlan,
    errors,
    warnings,
  };
}

function buildMarkdownReport(report) {
  return `# Smokingpipes Daily Recovery Preflight

- 结论：${report.overall.status}
- 是否可继续：${report.overall.canRun ? "是" : "否"}
- 是否会抓 current-list：${report.overall.willFetchCurrentList ? "是" : "否"}
- 是否会写 production：${report.overall.willWriteProduction ? "是" : "否"}
- 原因：${report.overall.reason}
- current-list：${report.currentListCache.reason}
- active lock：${report.locks.activeLocks.length}
- stale lock：${report.locks.staleLocks.length}
- cleared lock：${report.locks.clearedLocks.length}
- duplicate ids：${report.currentListCache.duplicateIdCount}
- conflict duplicate ids：${report.currentListCache.conflictDuplicateIdCount}
- sold-by-absence allowed：${report.currentListCache.safety.soldByAbsenceAllowed}
- disappeared apply allowed：${report.currentListCache.safety.disappearedApplyAllowed}

## 下一步

${report.overall.canRun ? "可以按执行计划继续。" : "不要重新扫站；先处理阻断原因。"}

## Errors

${report.errors.length ? report.errors.map((item) => `- ${item}`).join("\n") : "- 无"}

## Warnings

${report.warnings.length ? report.warnings.map((item) => `- ${item}`).join("\n") : "- 无"}
`;
}

export function writeSmokingpipesDailyRecoveryPreflightReport({
  report,
  root = process.cwd(),
  reportJsonPath = DEFAULT_REPORT_JSON_PATH,
  reportMarkdownPath = DEFAULT_REPORT_MD_PATH,
} = {}) {
  const jsonPath = resolvePath(root, reportJsonPath);
  const mdPath = resolvePath(root, reportMarkdownPath);
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.mkdirSync(path.dirname(mdPath), { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdPath, `\ufeff${buildMarkdownReport(report)}`, "utf8");
  return { reportJsonPath: jsonPath, reportMarkdownPath: mdPath };
}

export function runSmokingpipesDailyRecoveryPreflight({
  argv = process.argv.slice(2),
  root = process.cwd(),
  now = new Date(),
} = {}) {
  const options = parseArgs(argv);
  const report = evaluateSmokingpipesDailyRecoveryPreflight({
    root,
    now,
    options,
  });
  const paths = options.writeReport
    ? writeSmokingpipesDailyRecoveryPreflightReport({
        report,
        root,
        reportJsonPath: options.reportJsonPath,
        reportMarkdownPath: options.reportMarkdownPath,
      })
    : null;
  return { report, paths };
}

export function isDirectCliInvocation({
  importMetaUrl = import.meta.url,
  argv1 = process.argv[1],
} = {}) {
  return Boolean(argv1) && importMetaUrl === pathToFileURL(argv1).href;
}

if (isDirectCliInvocation()) {
  const result = runSmokingpipesDailyRecoveryPreflight();
  console.log(JSON.stringify(result.report, null, 2));
  if (!result.report.overall.canRun) {
    process.exitCode = 2;
  }
}
