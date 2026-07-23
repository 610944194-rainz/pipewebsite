import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sendPushDeerNotification } from "./inventory-pushdeer-notifier-v1.mjs";

const DEFAULT_STATE_PATH = path.join(
  process.cwd(),
  "data",
  "inventory",
  "smokingpipes-progressive-daily-state.json"
);
const DEFAULT_AUDIT_PATH = path.join(
  process.cwd(),
  "data",
  "review",
  "smokingpipes-progressive-partial-audit-report.json"
);
const DEFAULT_REPORT_JSON_PATH = path.join(
  process.cwd(),
  "data",
  "review",
  "smokingpipes-daily-mobile-report.json"
);
const DEFAULT_REPORT_MD_PATH = path.join(
  process.cwd(),
  "data",
  "review",
  "smokingpipes-daily-mobile-report.md"
);
const DEFAULT_ENV_PATH = path.join(process.cwd(), ".env.inventory.local");
const DEFAULT_TASK_LOG_PATH = path.join(
  process.cwd(),
  "data",
  "review",
  "smokingpipes-daily-task-latest.log"
);
const DEFAULT_TASK_STATE_PATH = path.join(
  process.cwd(),
  "data",
  "inventory",
  "smokingpipes-daily-task-state.json"
);
const REPORT_TITLE = "烟斗派库存日报｜Smokingpipes";

const VERIFICATION_PATTERN =
  /strong verification detected|captcha\/currentlistverificationdetected|current-list verification was detected|verification detected|captcha\s+(?:detected|required|blocked|challenge)|cloudflare|manual verification|profile blocked|\bblocked\b/i;
const BENIGN_VERIFICATION_PATTERN =
  /"?(?:captchaDetected|verificationDetected|verificationDetectedAt|manualVerificationRecovered|weakVerificationDetected|blocked)"?\s*:\s*(?:false|null)/i;
const DAILY_TASK_FAILED_PATTERN = /DAILY TASK FAILED:\s*(.+)$/im;
const NON_VERIFICATION_BLOCKED_PATTERN =
  /apply\s+blocked|inventory automation is already running|missing input|lock:/i;
const PROGRESSIVE_LOCK_FILE_NAME = "smokingpipes-progressive-daily.lock";

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sanitizeMobileText(value) {
  const text = normalizeText(value)
    .replace(/\{[\s\S]*?\}/g, "")
    .replace(
      /[A-Za-z]:\\[^\s;，。]*smokingpipes-progressive-daily\.lock/gi,
      PROGRESSIVE_LOCK_FILE_NAME
    )
    .replace(
      /Lock:\s*smokingpipes-progressive-daily\.lock\.?/gi,
      "任务锁：progressive-daily.lock"
    )
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function sanitizeMobileTextV2(value) {
  const text = normalizeText(value)
    .replace(/\{[\s\S]*?\}/g, "")
    .replace(
      /[A-Za-z]:\\[^\s;，。]*smokingpipes(?:-progressive-daily)?\.lock/gi,
      "inventory lock"
    )
    .replace(
      /Lock:\s*(?:inventory lock|smokingpipes(?:-progressive-daily)?\.lock)\.?/gi,
      "任务锁：inventory lock"
    )
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function inventoryLocksFromTaskState(taskState) {
  return taskState?.inventoryLocks && typeof taskState.inventoryLocks === "object"
    ? taskState.inventoryLocks
    : null;
}

function progressiveLockFromTaskState(taskState) {
  return taskState?.progressiveLock && typeof taskState.progressiveLock === "object"
    ? taskState.progressiveLock
    : null;
}

function isActiveInventoryLock(taskState) {
  const inventoryLocks = inventoryLocksFromTaskState(taskState);
  if (!inventoryLocks) return false;
  return (
    taskState?.lastFailureType === "lock" &&
    (inventoryLocks.hasActiveLock === true ||
      toArray(inventoryLocks.activeLocks).length > 0)
  );
}

function isStaleInventoryLockCleared(taskState) {
  const inventoryLocks = inventoryLocksFromTaskState(taskState);
  if (!inventoryLocks) return false;
  return (
    inventoryLocks.hasActiveLock !== true &&
    toArray(inventoryLocks.clearedLocks).length > 0
  );
}

function isActiveProgressiveLock(taskState) {
  const progressiveLock = progressiveLockFromTaskState(taskState);
  return (
    taskState?.lastFailureType === "lock" &&
    ["active", "active-skip"].includes(normalizeText(progressiveLock?.status))
  );
}

function isStaleProgressiveLockCleared(taskState) {
  const progressiveLock = progressiveLockFromTaskState(taskState);
  return (
    normalizeText(progressiveLock?.status) === "stale-cleared" ||
    progressiveLock?.cleared === true
  );
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\ufeff/, ""));
}

function readTextIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return "";
  }

  const buffer = fs.readFileSync(filePath);
  const utf8Text = buffer.toString("utf8").replace(/\u0000/g, "");
  const utf16Text =
    buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff
      ? Buffer.from(buffer).swap16().toString("utf16le")
      : buffer.toString("utf16le");

  return `${utf8Text}\n${utf16Text}`.replace(/\ufeff/g, "");
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function countBy(items, predicate) {
  return toArray(items).filter(predicate).length;
}

function countNewProducts(items, predicate) {
  return countBy(
    items,
    (item) =>
      toArray(item?.changeTypes).includes("new-product") &&
      predicate(item)
  );
}

function getAuditStatus(audit) {
  return normalizeText(audit?.auditStatus || audit?.verdict || "").toUpperCase();
}

function getAuditCounts(audit) {
  return audit?.counts && typeof audit.counts === "object"
    ? audit.counts
    : {};
}

function findVerificationBlocker({ state, audit, taskLogText }) {
  const blockers = toArray(audit?.blockers).map(normalizeText).filter(Boolean);
  const candidates = [
    taskLogText,
    state?.blockedReason,
    state?.status,
    ...blockers,
  ]
    .map((candidate) => String(candidate || "").replace(/\u0000/g, ""))
    .filter(Boolean);

  for (const candidate of candidates) {
    const match = candidate.match(VERIFICATION_PATTERN);

    if (match) {
      const failedLine = candidate
        .split(/\r?\n/)
        .map(normalizeText)
        .find(
          (line) =>
            VERIFICATION_PATTERN.test(line) &&
            !BENIGN_VERIFICATION_PATTERN.test(line) &&
            !NON_VERIFICATION_BLOCKED_PATTERN.test(line)
        );

      if (failedLine) {
        return failedLine;
      }
    }
  }

  if (state?.captchaDetected || state?.verificationDetected || state?.verificationDetectedAt) {
    return normalizeText(state?.blockedReason) || "Smokingpipes verification detected";
  }

  const stateBlockedReason = normalizeText(state?.blockedReason);
  const stateStatus = normalizeText(state?.status || state?.listSnapshotStatus);
  if (
    stateStatus === "blocked" &&
    (!stateBlockedReason ||
      (VERIFICATION_PATTERN.test(stateBlockedReason) &&
        !NON_VERIFICATION_BLOCKED_PATTERN.test(stateBlockedReason)))
  ) {
    return stateBlockedReason || "Smokingpipes verification detected";
  }

  return "";
}

function findDailyTaskFailure(taskLogText) {
  const text = String(taskLogText || "").replace(/\u0000/g, "");
  const match = text.match(DAILY_TASK_FAILED_PATTERN);
  return normalizeText(match?.[1] || "");
}

function hasApplyBlockedSignal(audit) {
  return toArray(audit?.blockers).some((item) =>
    /apply\s+blocked|write-production|production\s+write|missing input/i.test(
      normalizeText(item)
    )
  );
}

function isNoProductionWriteTask(taskState) {
  const runMode = normalizeText(taskState?.runMode);
  return (
    runMode === "safe-bootstrap" ||
    taskState?.safeBootstrap === true ||
    taskState?.noProductionWrite === true
  );
}

function isCurrentListFailureBeforePrepare(taskState) {
  const failureType = normalizeText(taskState?.lastFailureType);
  const detailPhaseStatus = normalizeText(taskState?.detailPhaseStatus);
  const currentListStatus = normalizeText(taskState?.currentList?.status);
  return (
    failureType === "current-list" ||
    (currentListStatus === "failed" &&
      (!detailPhaseStatus || detailPhaseStatus === "not-started"))
  );
}

function isSafeBootstrapCurrentListFailure(taskState) {
  return (
    isNoProductionWriteTask(taskState) &&
    isCurrentListFailureBeforePrepare(taskState)
  );
}

function getAppliedCount({ audit, wouldApplyCount }) {
  if (Number.isFinite(audit?.appliedCount)) {
    return Number(audit.appliedCount);
  }

  if (audit?.productionWritten) {
    return Number(wouldApplyCount || 0);
  }

  return 0;
}

function normalizeTaskStatus(taskState) {
  const status = normalizeText(taskState?.status);
  const knownStatuses = new Set([
    "success",
    "retryable-failed",
    "terminal-failed",
    "manual-review-required",
    "safety-gate-blocked",
    "skipped-success",
    "safe-bootstrap-complete",
    "safe-bootstrap-current-list-failed",
    "detail-progress",
    "detail-in-progress",
    "detail-complete",
    "ready-to-apply",
    "applied",
    "committed",
    "pushed",
    "deployment-pending-verification",
    "deployment-verified",
    "failed",
    "running",
  ]);

  if (status === "detail-progress") return "detail-in-progress";
  return knownStatuses.has(status) ? status : "";
}

function isTodayAlreadySucceeded(taskState) {
  const status = normalizeTaskStatus(taskState);
  return (
    (status === "success" || status === "skipped-success") &&
    taskState?.productionWritten === true
  );
}

function deriveStatus({ state, audit, taskLogText, taskState }) {
  const taskStatus = normalizeTaskStatus(taskState);
  const detailPhaseStatus = normalizeText(taskState?.detailPhaseStatus);

  if (taskStatus === "detail-in-progress") {
    return "detail-in-progress";
  }

  if (["detail-complete", "ready-to-apply", "applied", "committed", "pushed", "deployment-pending-verification", "deployment-verified", "failed"].includes(taskStatus)) {
    return taskStatus;
  }

  const auditStatus = getAuditStatus(audit);
  const blockers = toArray(audit?.blockers);
  const verificationBlocker = findVerificationBlocker({
    state,
    audit,
    taskLogText,
  });
  const taskFailure = findDailyTaskFailure(taskLogText);
  const candidateCount = Number.isFinite(audit?.candidateCount)
    ? Number(audit.candidateCount)
    : toArray(state?.candidates).length;
  const wouldApplyCount = Number.isFinite(audit?.wouldApplyCount)
    ? Number(audit.wouldApplyCount)
    : 0;
  const appliedCount = getAppliedCount({ audit, wouldApplyCount });

  if (isSafeBootstrapCurrentListFailure(taskState)) {
    return "safe-bootstrap-current-list-failed";
  }

  if (verificationBlocker) {
    return "blocked";
  }

  if (
    Number(audit?.applyGap?.gapCount || 0) > 0 &&
    audit?.applyGap?.safeToApplyWouldApplySubset !== true
  ) {
    return "failed";
  }

  if (isActiveInventoryLock(taskState) || isActiveProgressiveLock(taskState)) {
    return "lock-active";
  }

  if (taskStatus === "retryable-failed") {
    return "retryable-failed";
  }

  if (taskStatus === "terminal-failed") {
    return "terminal-failed";
  }

  if (taskStatus === "manual-review-required") {
    return "manual-review-required";
  }

  if (taskStatus === "safety-gate-blocked") {
    return "safety-gate-blocked";
  }

  if (taskStatus === "skipped-success") {
    return "skipped-success";
  }

  if (taskStatus === "safe-bootstrap-complete") {
    return "safe-bootstrap-complete";
  }

  if (
    taskStatus === "running" &&
    (isStaleInventoryLockCleared(taskState) ||
      isStaleProgressiveLockCleared(taskState))
  ) {
    return "stale-lock-cleared";
  }

  if (
    taskStatus === "running" &&
    ["no-eligible-candidates", "chunk-complete", "completed"].includes(
      detailPhaseStatus
    )
  ) {
    return "detail-complete";
  }

  if (
    taskFailure ||
    auditStatus === "FAIL" ||
    blockers.length > 0 ||
    hasApplyBlockedSignal(audit)
  ) {
    return "failed";
  }

  if ((audit?.productionWritten || taskState?.productionWritten) && appliedCount > 0) {
    return "success";
  }

  if (
    !audit?.productionWritten &&
    appliedCount === 0 &&
    candidateCount > 0 &&
    wouldApplyCount > 0
  ) {
    return "preview";
  }

  return "noop";
}

function normalizeSmokingpipesChangeSummary(value, appliedCount = 0, isolatedCandidateCount = 0) {
  const input = value && typeof value === "object" ? value : {};
  const number = (name, fallback = 0) => Number(input[name] ?? fallback) || 0;
  return {
    newlyPublishedCount: number("newlyPublishedCount"),
    sourcePriceIncreaseCount: number("sourcePriceIncreaseCount"),
    sourcePriceDecreaseCount: number("sourcePriceDecreaseCount"),
    explicitOutOfStockCount: number("explicitOutOfStockCount"),
    confirmedDisappearedCount: number("confirmedDisappearedCount"),
    reappearedCount: number("reappearedCount"),
    disappearedPendingConfirmationCount: number("disappearedPendingConfirmationCount"),
    isolatedCandidateCount: number("isolatedCandidateCount", isolatedCandidateCount),
    failedIsolatedCount: number("failedIsolatedCount"),
    otherAppliedCount: number("otherAppliedCount"),
    actualAppliedCount: number("actualAppliedCount", appliedCount),
    consistency: input.consistency || { valid: true, classifiedAppliedCount: number("actualAppliedCount", appliedCount), reason: null },
  };
}

export function buildSmokingpipesDailyMobileReport({
  state,
  audit,
  taskState,
  taskLogText = "",
  runAt = new Date().toISOString(),
  notification = {},
} = {}) {
  const candidates = toArray(state?.candidates);
  const counts = getAuditCounts(audit);
  const taskStatus = normalizeTaskStatus(taskState);
  const isDetailProgress = taskStatus === "detail-in-progress";
  const blockers = isDetailProgress ? [] : [...toArray(audit?.blockers)];
  const warnings = toArray(audit?.warnings);
  const currentList =
    taskState?.currentList && typeof taskState.currentList === "object"
      ? taskState.currentList
        : state?.currentList && typeof state.currentList === "object"
        ? state.currentList
        : null;
  const cachedListResume =
    taskState?.cachedListResume && typeof taskState.cachedListResume === "object"
      ? taskState.cachedListResume
      : null;
  const progressiveLock = progressiveLockFromTaskState(taskState);
  const inventoryLocks = inventoryLocksFromTaskState(taskState);
  const stateBlockedReason = normalizeText(state?.blockedReason);
  const verificationBlocker = isDetailProgress
    ? ""
    : findVerificationBlocker({
        state,
        audit,
        taskLogText,
      });
  const taskFailure = findDailyTaskFailure(taskLogText);
  const detailPhaseStatus = normalizeText(taskState?.detailPhaseStatus);
  const detailCompletedThisRun = Number(taskState?.detailCompletedThisRun || 0);
  const progressiveDetailMax = Number(taskState?.progressiveDetailMax || 0);
  const detailQueueSpike =
    taskState?.detailQueueSpike &&
    typeof taskState.detailQueueSpike === "object"
      ? taskState.detailQueueSpike
      : null;
  const detailQueueSpikeBlocked =
    taskState?.lastFailureType === "detail-queue-spike" ||
    detailQueueSpike?.blocked === true;
  const manualFullReconcileMode =
    taskState?.runMode === "manual-full-reconcile" ||
    Boolean(state?.manualFullReconcile);
  const manualFullReconcile =
    taskState?.manualFullReconcile &&
    typeof taskState.manualFullReconcile === "object"
      ? taskState.manualFullReconcile
      : state?.manualFullReconcile &&
          typeof state.manualFullReconcile === "object"
        ? state.manualFullReconcile
        : null;
  const manualDetailBatch =
    manualFullReconcile?.detailBatch &&
    typeof manualFullReconcile.detailBatch === "object"
      ? manualFullReconcile.detailBatch
      : null;

  if (isSafeBootstrapCurrentListFailure(taskState)) {
    const failureReason = sanitizeMobileTextV2(
      taskState?.lastFailureReason ||
        taskState?.currentList?.reuseReason ||
        taskFailure ||
        "current-list failed before candidate generation"
    );
    return {
      source: "smokingpipes",
      status: "safe-bootstrap-current-list-failed",
      statusLabel: "安全首跑失败，未写入生产",
      reason: failureReason,
      nextStep:
        "定时任务尚未恢复。请先检查 data/review/smokingpipes-failure-snapshots/ 里的失败快照；修复后手动重新运行 Safe Bootstrap。",
      runAt,
      pagesScanned: Number(taskState?.currentList?.pagesScanned || state?.pagesScanned || 0),
      expectedPages: Number(taskState?.currentList?.expectedPages || state?.expectedPages || 0),
      candidateCount: 0,
      attemptedCandidateCount: 0,
      wouldApplyCount: 0,
      isolatedCandidateCount: 0,
      appliedCount: 0,
      productionWritten: false,
      taskStatus: normalizeTaskStatus(taskState) || null,
      inventoryLocks,
      progressiveLock,
      currentList,
      cachedListResume,
      detailPhaseStatus: "not-started",
      detailQueueSpike,
      runMode: "safe-bootstrap",
      manualFullReconcile: null,
      manualDetailBatch: null,
      verificationRequired: false,
      retryAllowed:
        typeof taskState?.retryAllowed === "boolean"
          ? taskState.retryAllowed
          : true,
      nextRetryRecommendedAt: taskState?.nextRetryRecommendedAt || null,
      failureType: "current-list",
      todayAlreadySucceeded: false,
      attempts: Number(taskState?.attempts || 0),
      newProductReady: 0,
      newProductReviewOnly: 0,
      newProductNotReady: 0,
      detailComplete: 0,
      detailFailed: 0,
      detailPending: 0,
      detailDeferred: 0,
      publicReady: 0,
      publicReviewOnly: 0,
      publicNotPublic: 0,
      pendingDetailCount: 0,
      blockers: [failureReason],
      warnings: [],
      auditStatus: null,
      auditCounts: {
        deletedProducts: 0,
        pendingLeak: 0,
        failedLeak: 0,
        blockedLeak: 0,
        reviewOnlyLeak: 0,
        zeroPriceSellable: 0,
      },
      notificationSent: Boolean(notification.notificationSent),
      notificationSkipped: Boolean(notification.notificationSkipped),
      notificationReason: notification.notificationReason || "not requested",
    };
  }

  if (!isDetailProgress && verificationBlocker && !blockers.includes(verificationBlocker)) {
    blockers.unshift(verificationBlocker);
  }
  if (
    !isDetailProgress &&
    taskFailure &&
    !verificationBlocker &&
    !blockers.includes(taskFailure)
  ) {
    blockers.unshift(taskFailure);
  }
  if (!isDetailProgress && stateBlockedReason && blockers.length === 0) {
    blockers.push(stateBlockedReason);
  }

  const candidateCount =
    Number.isFinite(audit?.attemptedCandidateCount)
      ? audit.attemptedCandidateCount
      : Number.isFinite(taskState?.candidateCount)
      ? taskState.candidateCount
      : Number.isFinite(audit?.candidateCount)
      ? audit.candidateCount
      : candidates.length;
  const wouldApplyCount =
    Number.isFinite(audit?.wouldApplyCount) ? audit.wouldApplyCount : 0;
  const isolatedCandidateCount = Number(
    audit?.isolatedCandidateCount ??
      audit?.applyGap?.gapCount ??
      taskState?.isolatedCandidateCount ??
      0
  );
  const attemptedCandidateCount = Number(
    audit?.attemptedCandidateCount ??
      audit?.applyGap?.candidateCount ??
      candidateCount
  );
  const unsafeApplyGap =
    isolatedCandidateCount > 0 &&
    audit?.applyGap?.safeToApplyWouldApplySubset !== true;
  const appliedCount = Number.isFinite(taskState?.appliedCount)
    ? Number(taskState.appliedCount)
      : getAppliedCount({ audit, wouldApplyCount });
  const changeSummary = normalizeSmokingpipesChangeSummary(
    taskState?.changeSummary,
    appliedCount,
    isolatedCandidateCount
  );
  const detailComplete = countBy(
    candidates,
    (item) => item?.detailStatus === "complete"
  );
  const detailFailed = countBy(
    candidates,
    (item) => item?.detailStatus === "failed"
  );
  const candidateDetailPending = countBy(
    candidates,
    (item) => item?.detailStatus === "pending"
  );
  const detailDeferred = countBy(
    candidates,
    (item) => item?.detailStatus === "deferred"
  );
  const publicReady = countBy(
    candidates,
    (item) => item?.publicStatus === "ready"
  );
  const publicReviewOnly = countBy(
    candidates,
    (item) => item?.publicStatus === "review-only"
  );
  const publicNotPublic = countBy(
    candidates,
    (item) => item?.publicStatus === "not-public"
  );
  const taskPendingDetailCount = Number(
    taskState?.detailPending ?? taskState?.detailPendingCount
  );
  const detailPending =
    Number.isFinite(taskPendingDetailCount) && taskPendingDetailCount >= 0
      ? taskPendingDetailCount
      : candidateDetailPending;
  const pendingDetailCount = calculatePendingDetailCount({ detailPending });
  const status = deriveStatus({ state, audit, taskLogText, taskState });
  const failureType = isDetailProgress
    ? null
    : taskState?.lastFailureType || null;
  const reason = detailQueueSpikeBlocked
    ? `待处理详情突然增加到 ${pendingDetailCount}，超过正常范围，已暂停自动续跑。`
    : manualFullReconcileMode
      ? "这是人工全量对齐模式，不是每日自动更新。"
    : deriveReasonV2({
        status,
        verificationBlocker,
        taskFailure,
        taskState,
        progressiveLock,
        currentList,
        audit,
        candidateCount,
        wouldApplyCount,
        productionWritten: Boolean(
          audit?.productionWritten ||
            taskState?.productionWritten
        ),
      });
  const statusLabel =
    detailQueueSpikeBlocked
      ? verificationBlocker
        ? "暂停，详情队列异常 + 源站验证"
        : "暂停，详情队列异常"
      : manualFullReconcileMode
        ? verificationBlocker
          ? "人工全量对齐暂停：源站验证"
          : "人工全量对齐：详情分批处理中"
      : status === "detail-in-progress"
      ? "详情分批处理中"
      : unsafeApplyGap
      ? "候选应用被安全门禁阻断"
      : status === "success"
      ? statusLabelV2(status)
      : status === "detail-complete"
      ? "详情队列已完成，正在进入候选应用"
      : cachedListResume?.enabled === true &&
          cachedListResume?.completed === true
      ? "本轮缓存列表恢复完成"
      : failureType === "preflight" &&
          (status === "retryable-failed" || status === "terminal-failed")
          ? "恢复预检失败"
      : ["blocked", "failed", "retryable-failed", "terminal-failed", "lock-active"].includes(
          status
        )
        ? statusLabelV2(status)
      : cachedListResume?.enabled === true &&
          cachedListResume?.completed !== true
        ? "详情继续处理中，将自动续跑"
        : statusLabelV2(status);

  return {
    source: "smokingpipes",
    status,
    statusLabel,
    reason,
    nextStep: detailQueueSpikeBlocked
      ? "先查看 detail-pending-spike 诊断报告，不要直接完成验证或重跑。"
      : manualFullReconcileMode
        ? verificationBlocker
          ? "完成验证后手动重跑 FetchDetailBatch，不要恢复 daily task。"
          : "继续手动运行 FetchDetailBatch；全部详情完成后再进入安全预览和人工审计。"
      : status === "detail-in-progress"
      ? "下轮继续处理剩余详情；将复用同一天完整 current-list 快照，不进入候选应用。"
      : unsafeApplyGap
      ? "检查 data/review/smokingpipes-apply-gap-diagnosis-report.md，确认隔离候选的分类。"
      : deriveNextStepV2({ status, failureType, cachedListResume }),
    runAt,
    pagesScanned: Number(state?.pagesScanned || 0),
    expectedPages: Number(state?.expectedPages || 0),
    candidateCount,
    attemptedCandidateCount,
    wouldApplyCount,
    isolatedCandidateCount,
    appliedCount,
    changeSummary,
    productionWritten: Boolean(audit?.productionWritten || taskState?.productionWritten),
    taskStatus: normalizeTaskStatus(taskState) || null,
    inventoryLocks,
    progressiveLock,
    currentList,
    cachedListResume,
    detailPhaseStatus: detailPhaseStatus || null,
    detailCompletedThisRun,
    progressiveDetailMax,
    detailQueueSpike,
    runMode: manualFullReconcileMode
      ? "manual-full-reconcile"
      : "daily-update",
    manualFullReconcile,
    manualDetailBatch,
    verificationRequired: !isDetailProgress && Boolean(verificationBlocker),
    retryAllowed:
      typeof taskState?.retryAllowed === "boolean"
        ? taskState.retryAllowed
        : status === "retryable-failed",
    nextRetryRecommendedAt: taskState?.nextRetryRecommendedAt || null,
    failureType,
    todayAlreadySucceeded: isTodayAlreadySucceeded(taskState),
    attempts: Number(taskState?.attempts || 0),
    newProductReady:
      Number.isFinite(audit?.newProductReady)
        ? audit.newProductReady
        : countNewProducts(
            candidates,
            (item) => item?.publicStatus === "ready"
          ),
    newProductReviewOnly:
      Number.isFinite(audit?.newProductReviewOnly)
        ? audit.newProductReviewOnly
        : countNewProducts(
            candidates,
            (item) => item?.publicStatus === "review-only"
          ),
    newProductNotReady:
      Number.isFinite(audit?.newProductNotReady)
        ? audit.newProductNotReady
        : countNewProducts(
            candidates,
            (item) =>
              item?.publicStatus !== "ready" &&
              item?.publicStatus !== "review-only"
          ),
    detailComplete,
    detailFailed,
    detailPending,
    detailDeferred,
    publicReady,
    publicReviewOnly,
    publicNotPublic,
    pendingDetailCount,
    blockers,
    warnings,
    auditStatus: isDetailProgress
      ? "DEFERRED"
      : getAuditStatus(audit) || null,
    auditCounts: {
      deletedProducts: Number(counts.deletedProducts || 0),
      pendingLeak: Number(counts.pendingLeak || 0),
      failedLeak: Number(counts.failedLeak || 0),
      blockedLeak: Number(counts.blockedLeak || 0),
      reviewOnlyLeak: Number(counts.reviewOnlyLeak || 0),
      zeroPriceSellable: Number(counts.zeroPriceSellable || 0),
    },
    notificationSent: Boolean(notification.notificationSent),
    notificationSkipped: Boolean(notification.notificationSkipped),
    notificationReason: notification.notificationReason || "not requested",
  };
}

function statusLabelV2(status) {
  if (status === "detail-in-progress") return "\u8be6\u60c5\u5206\u6279\u5904\u7406\u4e2d";
  if (status === "ready-to-apply") return "\u8be6\u60c5\u5df2\u5b8c\u6210\uff0c\u7b49\u5f85\u5019\u9009\u5e94\u7528";
  if (status === "applied") return "Production \u5df2\u5b9e\u9645\u5199\u5165\uff0c\u7b49\u5f85\u63d0\u4ea4";
  if (status === "committed") return "\u5df2\u63d0\u4ea4\uff0c\u7b49\u5f85\u63a8\u9001";
  if (status === "pushed") return "\u5df2\u63a8\u9001\uff0c\u7b49\u5f85\u90e8\u7f72\u9a8c\u8bc1";
  if (status === "deployment-pending-verification") return "\u5df2\u63a8\u9001\uff0c\u90e8\u7f72\u5f85\u9a8c\u8bc1";
  if (status === "deployment-verified") return "\u90e8\u7f72\u5df2\u9a8c\u8bc1";
  if (status === "lock-active") return "库存任务正在运行，等待下一轮";
  if (status === "stale-lock-cleared") return "已清理过期任务锁，继续执行";
  if (status === "detail-complete") return "详情队列已完成，正在进入候选应用";
  if (status === "detail-in-progress") return "详情分批处理中";
  if (status === "retryable-failed") return "更新失败，将自动重试";
  if (status === "terminal-failed") return "更新失败，已停止重试";
  if (status === "manual-review-required") return "需要人工复核，已停止自动重试";
  if (status === "safety-gate-blocked") return "安全门禁已阻断，已停止自动重试";
  if (status === "skipped-success") return "已跳过";
  if (status === "blocked") return "需要人工验证";
  if (status === "failed") return "更新失败";
  if (status === "success") return "已更新";
  if (status === "preview") return "未更新，仅生成预览";
  if (status === "noop") return "无可更新";
  if (status === "safe-bootstrap-complete")
    return "安全首跑完成，等待人工确认";
  return status || "未知";
}

function deriveReasonV2({
  status,
  verificationBlocker,
  taskFailure,
  taskState,
  currentList,
  audit,
  candidateCount,
  wouldApplyCount,
  productionWritten,
}) {
  const isolatedCandidateCount = Number(
    audit?.isolatedCandidateCount ??
      audit?.applyGap?.gapCount ??
      0
  );
  if (
    isolatedCandidateCount > 0 &&
    audit?.applyGap?.safeToApplyWouldApplySubset !== true
  ) {
    return `${candidateCount} 个候选中只有 ${wouldApplyCount} 个允许自动应用，${isolatedCandidateCount} 个需要分类确认。`;
  }
  if (status === "lock-active") {
    return "检测到已有 Smokingpipes 库存任务锁，暂不启动第二个任务。";
  }

  if (status === "stale-lock-cleared") {
    return "检测到上一次任务遗留 lock，已自动清理。";
  }

  if (status === "detail-complete") {
    return "详情队列已完成，正在进入候选应用。";
  }

  if (status === "detail-in-progress") {
    return `本轮已完成 ${Number(taskState?.detailCompletedThisRun || 0)} 条详情，剩余 ${Number(taskState?.detailPendingCount || 0)} 条；当前列表快照已保留，下一轮继续处理。`;
  }

  if (["retryable-failed", "terminal-failed", "manual-review-required", "safety-gate-blocked"].includes(status)) {
    if (taskState?.lastFailureType === "preflight") {
      return `恢复预检失败：${sanitizeMobileTextV2(
        taskState?.lastFailureReason || "请查看 recovery preflight report"
      )}`;
    }
    if (taskState?.lastFailureType === "lock") {
      return "已有任务锁定，暂不启动第二个库存任务。";
    }
    return sanitizeMobileTextV2(taskState?.lastFailureReason || "daily task failed");
  }

  if (status === "skipped-success") {
    return "今天已经成功更新，后续重复触发已跳过。";
  }

  if (status === "safe-bootstrap-complete") {
    return "安全首跑完成：已生成候选、audit、preview 和 gate report，未写 production，等待人工确认。";
  }

  if (status === "blocked") {
    return verificationBlocker
      ? sanitizeMobileTextV2(verificationBlocker)
      : "verification/captcha/blocked signal detected";
  }

  if (status === "failed") {
    if (taskFailure) {
      return `daily task failed: ${sanitizeMobileTextV2(taskFailure)}`;
    }

    const blockers = toArray(audit?.blockers).map(normalizeText).filter(Boolean);
    if (blockers.length > 0) {
      return blockers.map(sanitizeMobileTextV2).join("; ");
    }

    return `auditStatus=${getAuditStatus(audit) || "unknown"}`;
  }

  if (status === "success") {
    return isolatedCandidateCount > 0
      ? `已写入 ${wouldApplyCount} 个可安全应用候选；${isolatedCandidateCount} 个不可自动应用候选保留复核。`
      : "productionWritten=true，已写入 production。";
  }

  if (status === "preview") {
    if (currentList?.manualRecovery) {
      return "跳过 current-list 抓取，复用已有完整 current-list（人工恢复模式）；本次未写入 production。";
    }

    if (currentList?.reused) {
      return "已复用今日 current-list，但本次未写入 production。";
    }

    return `productionWritten=${productionWritten}，appliedCount=0，candidateCount=${candidateCount}，wouldApplyCount=${wouldApplyCount}。`;
  }

  return `candidateCount=${candidateCount}，wouldApplyCount=${wouldApplyCount}。`;
}

function deriveNextStepV2({ status, failureType = null, cachedListResume = null }) {
  if (cachedListResume?.enabled === true && cachedListResume?.completed === true) {
    return "下一次自动更新可重新抓取新列表。";
  }

  if (status === "detail-complete") {
    return "执行 candidate/audit/apply";
  }

  if (status === "detail-in-progress") {
    return "继续处理剩余详情；复用同一天完整 current-list 快照，待 pending 归零后才进入 apply gate。";
  }

  if (
    failureType === "preflight" &&
    (status === "retryable-failed" || status === "terminal-failed")
  ) {
    return "先查看 data/review/smokingpipes-daily-recovery-preflight-report.md，按报告修复后再重跑恢复任务。";
  }

  if (status === "terminal-failed") {
    return "人工检查 audit report";
  }

  if (status === "manual-review-required" || status === "safety-gate-blocked") {
    return "查看 audit / gate report 并人工确认；不要自动重试。";
  }

  if (cachedListResume?.enabled === true && cachedListResume?.completed !== true) {
    return "继续复用同一份列表快照，不重新扫列表页。";
  }

  if (status === "lock-active") {
    return "无需操作，等待下一轮自动重试。";
  }

  if (status === "stale-lock-cleared") {
    return "无需操作，本轮会继续执行后续库存流程。";
  }

  if (status === "retryable-failed") {
    return "等待 Windows 定时任务在下一轮自动重试；如需立即处理，可人工重新运行 daily task。";
  }

  if (status === "skipped-success") {
    return "无需处理。";
  }

  if (status === "safe-bootstrap-complete") {
    return "人工检查 audit / preview / gate report；确认无误后再决定是否执行正式写入。";
  }

  if (status === "blocked") {
    return "请在电脑上完成 Smokingpipes 验证，之后重新运行每日任务。";
  }

  if (status === "failed") {
    return "查看 data/review/smokingpipes-daily-task-latest.log";
  }

  if (status === "preview") {
    return "检查每日任务是否完成 formal apply；确认无误后再决定是否写入 production。";
  }

  return "无需处理。";
}

function statusLabel(status) {
  if (status === "lock-active") return "库存任务正在运行，等待下一轮";
  if (status === "stale-lock-cleared") return "已清理过期任务锁，继续执行";
  if (status === "retryable-failed") return "更新失败，将自动重试";
  if (status === "terminal-failed") return "更新失败，已停止重试";
  if (status === "skipped-success") return "已跳过";
  if (status === "blocked") return "需要人工验证";
  if (status === "failed") return "更新失败";
  if (status === "success") return "已更新";
  if (status === "preview") return "未更新，仅生成预览";
  if (status === "noop") return "无可更新";
  if (status === "safe-bootstrap-complete")
    return "安全首跑完成，等待人工确认";
  return status || "未知";
}

function calculatePendingDetailCount({ detailPending }) {
  return Number(detailPending || 0);
}

function deriveReason({
  status,
  verificationBlocker,
  taskFailure,
  taskState,
  progressiveLock,
  currentList,
  audit,
  candidateCount,
  wouldApplyCount,
  productionWritten,
}) {
  if (status === "lock-active") {
    return "检测到已有 Smokingpipes 库存任务正在运行。";
  }

  if (status === "stale-lock-cleared") {
    return "检测到上一次任务遗留 lock，已自动清理。";
  }

  if (status === "retryable-failed" || status === "terminal-failed") {
    if (taskState?.lastFailureType === "lock") {
      return "已有任务锁定，暂不启动第二个库存任务。";
    }
    return sanitizeMobileText(taskState?.lastFailureReason || "daily task failed");
  }

  if (status === "skipped-success") {
    return "今天已经成功更新，后续重复触发已跳过。";
  }

  if (status === "blocked") {
    return verificationBlocker || "verification/captcha/blocked signal detected";
  }

  if (status === "failed") {
    if (taskFailure) {
      return `daily task failed: ${sanitizeMobileText(taskFailure)}`;
    }

    const blockers = toArray(audit?.blockers).map(normalizeText).filter(Boolean);
    if (blockers.length > 0) {
      return blockers.map(sanitizeMobileText).join("; ");
    }

    return `auditStatus=${getAuditStatus(audit) || "unknown"}`;
  }

  if (status === "success") {
    return "productionWritten=true，已写入 production。";
  }

  if (status === "preview") {
    if (currentList?.reused) {
      return "已复用今日 current-list，但本次未写入 production。";
    }

    return `productionWritten=${productionWritten}，appliedCount=0，candidateCount=${candidateCount}，wouldApplyCount=${wouldApplyCount}。`;
  }

  return `candidateCount=${candidateCount}，wouldApplyCount=${wouldApplyCount}。`;
}

function deriveNextStep({ status }) {
  if (status === "lock-active") {
    return "无需操作，等待下一轮自动重试。";
  }

  if (status === "stale-lock-cleared") {
    return "无需操作，本轮会继续执行后续库存流程。";
  }

  if (status === "retryable-failed") {
    return "等待 Windows 定时任务在下一轮自动重试；如需立即处理，可人工重新运行 daily task。";
  }

  if (status === "terminal-failed") {
    return "人工检查 audit report";
  }

  if (status === "skipped-success") {
    return "无需处理。";
  }

  if (status === "blocked") {
    return "请在电脑上完成 Smokingpipes 验证，之后重新运行每日任务。";
  }

  if (status === "failed") {
    return "查看 data/review/smokingpipes-daily-task-latest.log";
  }

  if (status === "preview") {
    return "检查每日任务是否完成 formal apply；确认无误后再决定是否写入 production。";
  }

  return "无需处理。";
}

export function shouldSendDailyMobileNotification(report, options = {}) {
  if (report?.status === "skipped-success") {
    return false;
  }

  return Boolean(options.send || options.dryRunNotify);
}

function buildSourceScanText(report) {
  if (report?.currentList?.reused) {
    const pagesScanned = Number(
      report.currentList.pagesScanned || report.pagesScanned || 0
    );
    const expectedPages = Number(
      report.currentList.expectedPages || report.expectedPages || 0
    );
    const pageText =
      pagesScanned && expectedPages
        ? `${pagesScanned}/${expectedPages}`
        : "未知";
    return `复用今日完整列表快照（${pageText}）`;
  }

  return report.pagesScanned && report.expectedPages
    ? `${report.pagesScanned}/${report.expectedPages} 页`
    : "未知";
}

function buildPushDeerDailyMessageLegacy(report) {
  const lockActive = report.status === "lock-active";
  const blockedText =
    lockActive
      ? "任务锁定"
      : report.blockers?.length > 0
        ? report.blockers.map(sanitizeMobileText).join("; ")
        : "无";
  const scanText = buildSourceScanText(report);
  const pendingDetailCount = Number.isFinite(report.pendingDetailCount)
    ? report.pendingDetailCount
    : calculatePendingDetailCount({
        detailPending: report.detailPending,
        publicNotPublic: report.publicNotPublic,
        detailFailed: report.detailFailed,
      });

  return {
    title: REPORT_TITLE,
    body: [
      `结论：${report.statusLabel || statusLabel(report.status)}`,
      "",
      `源站扫描：${scanText}`,
      `候选更新：${report.candidateCount}`,
      `正式应用：${report.appliedCount || 0}`,
      ...(report.isolatedCandidateCount > 0
        ? [`隔离候选：${report.isolatedCandidateCount}`]
        : []),
      `新增可公开：${report.newProductReady}`,
      "",
      `人工复核：${report.newProductReviewOnly}`,
      `失败保留：${report.detailFailed}`,
      `待处理详情：${pendingDetailCount}`,
      `阻断：${blockedText}`,
      `失败类型：${failureTypeLabel(report.failureType)}`,
      `重试状态：${report.retryAllowed ? "允许重试" : "不重试"}`,
      `下一次重试：${report.nextRetryRecommendedAt || "无"}`,
      `是否当天已成功：${report.todayAlreadySucceeded ? "是" : "否"}`,
      "",
      "原因：",
      sanitizeMobileText(report.reason || "无"),
      "",
      "下一步：",
      report.nextStep || deriveNextStep({ status: report.status }),
      "",
      "说明：待处理详情 = 尚未完成 detail / pending / not-public 的商品，不会进入 production。",
    ].join("\n"),
  };
}

function buildSourceScanTextV2(report) {
  if (report?.cachedListResume?.enabled) {
    return "未重新抓取，复用已有完整列表快照";
  }

  if (report?.currentList?.manualRecovery) {
    return "跳过，复用已有完整列表快照（人工恢复模式）";
  }

  if (report?.currentList?.reused) {
    const pagesScanned = Number(
      report.currentList.pagesScanned || report.pagesScanned || 0
    );
    const expectedPages = Number(
      report.currentList.expectedPages || report.expectedPages || 0
    );
    const pageText =
      pagesScanned && expectedPages
        ? `${pagesScanned}/${expectedPages}`
        : "未知";
    return `复用今日完整列表快照（${pageText}）`;
  }

  return report.pagesScanned && report.expectedPages
    ? `${report.pagesScanned}/${report.expectedPages} 页`
    : "未知";
}

function buildDetailAccessTextV2(report) {
  if (report?.detailPhaseStatus === "no-eligible-candidates") {
    return "当前没有待抓取详情";
  }

  if (report?.cachedListResume?.enabled) {
    return "继续抓取更新商品详情";
  }

  return "按当前任务计划执行";
}

function buildExecutionModeTextV2(report) {
  if (report?.cachedListResume?.enabled) {
    return "缓存列表断点恢复";
  }

  return "每日库存更新";
}

function buildNextListFetchTextV2(report) {
  if (report?.cachedListResume?.enabled) {
    return report.cachedListResume.completed
      ? "当前快照已完成，下次可重新抓取新列表"
      : "当前快照完成后恢复；未完成前继续复用同一份列表快照";
  }

  return "按每日任务策略执行";
}

function buildSourceAccessTextV2(report) {
  if (report?.cachedListResume?.enabled) {
    return "仅访问商品详情页，未重新抓列表页";
  }

  if (report?.currentList?.manualRecovery) {
    return "未重新访问 Smokingpipes";
  }

  return "按当前任务计划执行";
}

function failureTypeLabelV2(value) {
  const type = normalizeText(value);
  if (type === "lock") return "任务锁定";
  if (type === "verification") return "源站验证";
  if (type === "network") return "网络异常";
  if (type === "browser") return "浏览器异常";
  if (type === "audit") return "安全审计";
  if (type === "preflight") return "恢复预检";
  if (type === "detail-queue-spike")
    return "详情队列异常";
  return type || "无";
}

function smokingpipesChangeSummaryLines(report) {
  const summary = normalizeSmokingpipesChangeSummary(
    report?.changeSummary,
    Number(report?.appliedCount || 0),
    Number(report?.isolatedCandidateCount || 0)
  );
  return [
    `\u65b0\u589e\u4e0a\u67b6\uff1a${summary.newlyPublishedCount}`,
    `\u539f\u7ad9\u6da8\u4ef7\uff1a${summary.sourcePriceIncreaseCount}`,
    `\u539f\u7ad9\u964d\u4ef7\uff1a${summary.sourcePriceDecreaseCount}`,
    `\u660e\u786e\u4e0b\u67b6\uff1a${summary.explicitOutOfStockCount}`,
    `\u8fde\u7eed\u6d88\u5931\u786e\u8ba4\u4e0b\u67b6\uff1a${summary.confirmedDisappearedCount}`,
    `\u91cd\u65b0\u4e0a\u67b6\uff1a${summary.reappearedCount}`,
    `\u5217\u8868\u6d88\u5931\u5f85\u786e\u8ba4\uff1a${summary.disappearedPendingConfirmationCount}`,
    `\u9694\u79bb\u5019\u9009\uff1a${summary.isolatedCandidateCount}`,
    `\u5931\u8d25\u9694\u79bb\uff1a${summary.failedIsolatedCount}`,
    `\u5b9e\u9645\u5e94\u7528\uff1a${summary.actualAppliedCount}`,
  ];
}

export function buildPushDeerDailyMessage(report) {
  const changeLines = smokingpipesChangeSummaryLines(report);
  if (report?.status === "no-production-change") {
    return {
      title: "烟斗派库存日更｜Smokingpipes",
      body: [
        "状态：今日检查完成，无库存变化",
        "Production：未写入",
        ...changeLines,
        "提交：无",
        "推送：无",
        "阻断：无",
      ].join("\n"),
    };
  }
  const lockActive = report.status === "lock-active";
  const blockedText =
    lockActive
      ? "任务锁定"
      : report.blockers?.length > 0
        ? report.blockers.map(sanitizeMobileTextV2).join("; ")
        : "无";
  const scanText = buildSourceScanTextV2(report);
  const detailAccessText = buildDetailAccessTextV2(report);
  const executionModeText = buildExecutionModeTextV2(report);
  const nextListFetchText = buildNextListFetchTextV2(report);
  const sourceAccessText = buildSourceAccessTextV2(report);
  const pendingDetailCount = Number.isFinite(report.pendingDetailCount)
    ? report.pendingDetailCount
    : calculatePendingDetailCount({
        detailPending: report.detailPending,
        publicNotPublic: report.publicNotPublic,
        detailFailed: report.detailFailed,
      });
  if (report.status === "safe-bootstrap-current-list-failed") {
    const scanText =
      report.pagesScanned && report.expectedPages
        ? `${report.pagesScanned}/${report.expectedPages} 页`
        : "未完成";
    return {
      title: "烟斗派库存日报｜Smokingpipes",
      body: [
        "结论：安全首跑失败，未写入生产",
        "",
        "阶段：current-list 源站列表抓取",
        "结果：failed",
        `原因：${report.reason || "current-list failed"}`,
        `扫描：${scanText}`,
        "源站访问：已访问",
        "详情抓取：未开始",
        "候选生成：未开始",
        "自动写入：已禁止",
        "production 写入：0",
        "",
        "说明：production apply 尚未到达，本轮没有写入生产数据。",
        "",
        "下一步：",
        report.nextStep,
      ].join("\n"),
    };
  }
  if (report.runMode === "manual-full-reconcile") {
    const manual = report.manualFullReconcile || {};
    const detailBatch =
      report.manualDetailBatch || manual.detailBatch || {};
    const detailEligibleThisBatch = Number(
      manual.detailEligibleThisBatch || 0
    );
    const detailPendingTotal = Number(
      manual.detailPendingTotal || 0
    );
    const totalNewCandidates = Number(
      manual.totalNewCandidates || 0
    );
    const appliedTargetCount = Number(
      manual.appliedTargetCount ||
        report.wouldApplyCount ||
        0
    );
    const completedThisBatch = Number(
      detailBatch.completedCount || 0
    );
    const attemptedThisBatch = Number(
      detailBatch.attemptedCount || 0
    );
    const remainingPending = Number(
      detailBatch.remainingPendingCount ??
        report.pendingDetailCount ??
        detailPendingTotal
    );
    const deferredCount = Number(
      detailBatch.deferredCount ?? report.detailDeferred ?? 0
    );
    const reviewOnlyCount = Number(
      detailBatch.reviewOnlyCount ?? report.publicReviewOnly ?? 0
    );
    return {
      title: "烟斗派人工全量对齐｜Smokingpipes",
      body: [
        `结论：${report.statusLabel}`,
        "",
        ...(report.verificationRequired
          ? [
              "验证对象：Smokingpipes",
              "验证位置：运行任务的电脑",
              "浏览器：Chrome profile sp-chrome",
              "验证页面：已打开的 Smokingpipes 页面",
              "下一步：完成验证后手动重跑 FetchDetailBatch，不要恢复 daily task。",
              "",
            ]
          : []),
        `本批详情：已完成 ${completedThisBatch} / 尝试 ${attemptedThisBatch}`,
        `剩余待抓：${remainingPending}`,
        `延后队列：${deferredCount}`,
        `复核队列：${reviewOnlyCount}`,
        `列表快照：${Number(report.pagesScanned || 0)}/${Number(report.expectedPages || 0)} 页`,
        `本轮新增候选：${totalNewCandidates}`,
        `本轮待抓详情：${detailEligibleThisBatch} / 总待处理 ${detailPendingTotal}`,
        `本轮正式应用：${Number(report.appliedCount || 0)} / ${appliedTargetCount}`,
        "说明：这是人工对齐模式，不是每日自动更新。",
        "production 写入：否",
        ...(report.verificationRequired
          ? [
              "",
              "说明：手机里不能完成验证",
            ]
          : []),
        "",
        "下一步：",
        report.nextStep,
      ].join("\n"),
    };
  }

  return {
    title: "烟斗派库存日报｜Smokingpipes",
    body: [
      `结论：${report.statusLabel || statusLabelV2(report.status)}`,
      "",
      ...(report.detailQueueSpike?.blocked
        ? [
            `核心风险：待处理详情突然增加到 ${pendingDetailCount}，超过正常范围，已暂停自动续跑。`,
            `源站验证：${
              report.verificationRequired
                ? "Smokingpipes 出现强验证。"
                : "本轮未检测到新的强验证。"
            }`,
            "验证页面：请在运行任务的电脑上查看已打开的 Chrome / sp-chrome 浏览器窗口；如窗口不存在，不要手动继续。",
            "",
          ]
        : report.status === "blocked"
          ? [
              "验证对象：Smokingpipes",
              "验证页面：Smokingpipes 当前列表/详情页",
              "操作位置：运行任务的电脑，不是在手机里",
              "浏览器：Chrome profile sp-chrome",
              "",
            ]
          : []),
      `源站扫描：${scanText}`,
      `详情抓取：${detailAccessText}`,
      `执行方式：${executionModeText}`,
      `下次列表抓取：${nextListFetchText}`,
      `源站访问：${sourceAccessText}`,
      `候选更新：${report.candidateCount}`,
      `正式应用：${report.appliedCount || 0}`,
      ...changeLines,
      ...(report.status === "detail-in-progress"
        ? [
            `本轮详情完成：${Number(report.detailCompletedThisRun || 0)}`,
            `本轮详情 chunk 上限：${Number(report.progressiveDetailMax || 0) || 50}`,
            `剩余详情：${pendingDetailCount}`,
            "下轮：继续处理详情，不进入候选应用",
          ]
        : []),
      ...(report.isolatedCandidateCount > 0
        ? [`隔离候选：${report.isolatedCandidateCount}`]
        : []),
      `新增可公开：${report.newProductReady}`,
      "",
      `人工复核：${report.newProductReviewOnly}`,
      `失败保留：${report.detailFailed}`,
      `待处理详情：${pendingDetailCount}`,
      `阻断：${blockedText}`,
      `失败类型：${failureTypeLabelV2(report.failureType)}`,
      `重试状态：${report.retryAllowed ? "允许重试" : "不重试"}`,
      `下一次重试：${report.nextRetryRecommendedAt || "无"}`,
      `是否当天已成功：${report.todayAlreadySucceeded ? "是" : "否"}`,
      "",
      "原因：",
      sanitizeMobileTextV2(report.reason || "无"),
      "",
      "下一步：",
      report.nextStep || deriveNextStepV2({ status: report.status }),
      "",
      report.cachedListResume?.enabled
        ? report.productionWritten && report.isolatedCandidateCount > 0
          ? "说明：已写入可安全应用候选；不可自动应用候选保留复核。"
          : "说明：本轮可访问商品详情页，但不会重新抓 Smokingpipes 列表页。"
        : report.currentList?.manualRecovery
        ? "说明：本轮未重新访问 Smokingpipes；不会根据旧列表自动判定下架。"
        : "说明：待处理详情 = 尚未完成 detail / pending / not-public 的商品，不会进入 production。",
    ].join("\n"),
  };
}

function failureTypeLabel(value) {
  const type = normalizeText(value);
  if (type === "lock") return "任务锁定";
  if (type === "verification") return "源站验证";
  if (type === "network") return "网络异常";
  if (type === "browser") return "浏览器异常";
  if (type === "audit") return "安全审计";
  return type || "无";
}

function buildMarkdownReportLegacy(report) {
  const blockers = report.blockers.length
    ? report.blockers.map((item) => `- ${sanitizeMobileText(item)}`).join("\n")
    : "- 无";
  const warnings = report.warnings.length
    ? report.warnings.map((item) => `- ${item}`).join("\n")
    : "- 无";
  const scanText = buildSourceScanText(report);

  return `# Smokingpipes 每日库存手机报告

- 结论：${report.statusLabel || statusLabel(report.status)}
- 运行时间：${report.runAt}
- 源站扫描：${scanText}
- 候选更新：${report.candidateCount}
- 正式应用：${report.appliedCount || 0}
- 隔离候选：${report.isolatedCandidateCount || 0}
- 变化摘要：${JSON.stringify(normalizeSmokingpipesChangeSummary(report.changeSummary, report.appliedCount, report.isolatedCandidateCount))}
- 已写入 production：${report.productionWritten ? "是" : "否"}
- 新增可公开：${report.newProductReady}
- 人工复核：${report.newProductReviewOnly}
- 失败保留：${report.detailFailed}
- 待处理详情：${report.pendingDetailCount}
- 详情完成：${report.detailComplete}
- 可公开库存：${report.publicReady}
- 需人工复核：${report.publicReviewOnly}
- 安全排除：${report.publicNotPublic}
- 阻断：${report.status === "lock-active" ? "任务锁定" : report.blockers.length ? report.blockers.map(sanitizeMobileText).join("; ") : "无"}
- 失败类型：${failureTypeLabel(report.failureType)}
- 重试状态：${report.retryAllowed ? "允许重试" : "不重试"}
- 下一次重试：${report.nextRetryRecommendedAt || "无"}
- 是否当天已成功：${report.todayAlreadySucceeded ? "是" : "否"}
- 原因：${sanitizeMobileText(report.reason || "无")}
- 下一步：${report.nextStep || deriveNextStep({ status: report.status })}
- 通知已发送：${report.notificationSent ? "是" : "否"}
- 通知已跳过：${report.notificationSkipped ? "是" : "否"}
- 通知原因：${report.notificationReason}
- PowerShell 推荐查看命令：Get-Content "data\\review\\smokingpipes-daily-mobile-report.md" -Encoding utf8

${report.currentList?.manualRecovery
  ? "说明：本轮未重新访问 Smokingpipes；不会根据旧列表自动判定下架。"
  : "说明：待处理详情 = 尚未完成 detail / pending / not-public 的商品，不会进入 production。"}

## 阻断

${blockers}

## Warning

${warnings}
`;
}

function buildMarkdownReportV2(report) {
  const blockers = report.blockers.length
    ? report.blockers.map((item) => `- ${sanitizeMobileTextV2(item)}`).join("\n")
    : "- 无";
  const warnings = report.warnings.length
    ? report.warnings.map((item) => `- ${item}`).join("\n")
    : "- 无";
  const scanText = buildSourceScanTextV2(report);

  return `# Smokingpipes 每日库存手机报告

- 结论：${report.statusLabel || statusLabelV2(report.status)}
- 运行时间：${report.runAt}
- 源站扫描：${scanText}
- 候选更新：${report.candidateCount}
- 正式应用：${report.appliedCount || 0}
- 隔离候选：${report.isolatedCandidateCount || 0}
- 变化摘要：${JSON.stringify(normalizeSmokingpipesChangeSummary(report.changeSummary, report.appliedCount, report.isolatedCandidateCount))}
- 已写入 production：${report.productionWritten ? "是" : "否"}
- 新增可公开：${report.newProductReady}
- 人工复核：${report.newProductReviewOnly}
- 失败保留：${report.detailFailed}
- 待处理详情：${report.pendingDetailCount}
- 详情完成：${report.detailComplete}
- 可公开库存：${report.publicReady}
- 需人工复核：${report.publicReviewOnly}
- 安全排除：${report.publicNotPublic}
- 阻断：${report.status === "lock-active" ? "任务锁定" : report.blockers.length ? report.blockers.map(sanitizeMobileTextV2).join("; ") : "无"}
- 失败类型：${failureTypeLabelV2(report.failureType)}
- 重试状态：${report.retryAllowed ? "允许重试" : "不重试"}
- 下一次重试：${report.nextRetryRecommendedAt || "无"}
- 是否当天已成功：${report.todayAlreadySucceeded ? "是" : "否"}
- 原因：${sanitizeMobileTextV2(report.reason || "无")}
- 下一步：${report.nextStep || deriveNextStepV2({ status: report.status })}
- 通知已发送：${report.notificationSent ? "是" : "否"}
- 通知已跳过：${report.notificationSkipped ? "是" : "否"}
- 通知原因：${report.notificationReason}
- PowerShell 推荐查看命令：Get-Content "data\\review\\smokingpipes-daily-mobile-report.md" -Encoding utf8

说明：待处理详情 = 尚未完成 detail / pending / not-public 的商品，不会进入 production。

## 阻断

${blockers}

## Warning

${warnings}
`;
}

function parseArgs(argv) {
  const values = new Map(
    argv
      .filter((value) => value.startsWith("--"))
      .map((value) => {
        const [key, ...parts] = value.slice(2).split("=");
        return [key, parts.join("=") || true];
      })
  );
  return {
    send: values.has("send"),
    dryRunNotify: values.has("dry-run-notify"),
    runId: String(values.get("run-id") || "").trim(),
    invocationStartedAt: String(values.get("invocation-started-at") || "").trim(),
    taskStatePath: String(values.get("task-state") || "").trim(),
  };
}

function validTimestamp(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function validateDailyMobileNotificationInvocation({
  report,
  taskState,
  runId,
  invocationStartedAt,
} = {}) {
  const expectedRunId = String(runId || "").trim();
  const expectedStart = validTimestamp(invocationStartedAt);
  const reportStart = validTimestamp(report?.startedAt);
  const reportCompleted = validTimestamp(report?.completedAt);
  if (!expectedRunId || String(report?.runId || "") !== expectedRunId || String(taskState?.runId || "") !== expectedRunId) {
    return { allowed: false, reason: "stale-report-blocked: runId mismatch" };
  }
  if (!expectedStart || !reportStart || !reportCompleted || reportStart < expectedStart || reportCompleted < reportStart) {
    return { allowed: false, reason: "stale-report-blocked: invocation timestamp mismatch" };
  }
  if (String(taskState?.lastNotificationRunId || "") === expectedRunId) {
    return { allowed: false, reason: "notification-already-sent-for-run" };
  }
  return { allowed: true, reason: "current-invocation" };
}

function markDailyMobileNotificationSent(taskStatePath, taskState, runId) {
  if (!taskStatePath || !taskState || !runId) return;
  fs.writeFileSync(
    taskStatePath,
    `${JSON.stringify({ ...taskState, lastNotificationRunId: runId }, null, 2)}\n`,
    "utf8"
  );
}

function loadInventoryEnv(filePath = DEFAULT_ENV_PATH) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");

    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

export async function runSmokingpipesDailyMobileReport({
  argv = process.argv.slice(2),
  now = new Date().toISOString(),
  statePath = DEFAULT_STATE_PATH,
  auditPath = DEFAULT_AUDIT_PATH,
  taskLogPath = DEFAULT_TASK_LOG_PATH,
  taskStatePath = DEFAULT_TASK_STATE_PATH,
  reportJsonPath = DEFAULT_REPORT_JSON_PATH,
  reportMarkdownPath = DEFAULT_REPORT_MD_PATH,
} = {}) {
  const options = parseArgs(argv);
  loadInventoryEnv();

  const missingInputs = [];
  const state = readJsonIfExists(statePath);
  const audit = readJsonIfExists(auditPath);
  const effectiveTaskStatePath = options.taskStatePath || taskStatePath;
  const taskState = readJsonIfExists(effectiveTaskStatePath);
  const taskLogText = readTextIfExists(taskLogPath);

  if (!state) missingInputs.push(statePath);
  if (!audit) missingInputs.push(auditPath);

  const invocationStartedAt = options.invocationStartedAt || taskState?.invocationStartedAt || now;
  const runId = options.runId || taskState?.runId || "";
  const initialReport = {
    ...buildSmokingpipesDailyMobileReport({
    runAt: now,
    taskLogText,
    taskState,
    state: state || {
      source: "smokingpipes",
      listSnapshotStatus: "blocked",
      blockedReason: `missing input: ${missingInputs.join(", ")}`,
      candidates: [],
    },
    audit: audit || {
      auditStatus: "FAIL",
      blockers: missingInputs.map((item) => `missing input: ${item}`),
      warnings: [],
      productionWritten: false,
    },
    }),
    runId,
    startedAt: invocationStartedAt,
    completedAt: now,
  };
  if (taskState?.status === "no-production-change") {
    initialReport.status = "no-production-change";
    initialReport.candidateCount = 0;
    initialReport.wouldApplyCount = 0;
    initialReport.appliedCount = 0;
    initialReport.changeSummary = normalizeSmokingpipesChangeSummary({}, 0, 0);
    initialReport.productionWritten = false;
    initialReport.commitPerformed = false;
    initialReport.pushPerformed = false;
    initialReport.deployStatus = "not-requested";
    initialReport.blockers = [];
  }
  const message = buildPushDeerDailyMessage(initialReport);
  const invocationValidation = validateDailyMobileNotificationInvocation({
    report: initialReport,
    taskState,
    runId,
    invocationStartedAt,
  });
  const notification = shouldSendDailyMobileNotification(initialReport, options) && invocationValidation.allowed
      ? await sendPushDeerNotification({
          title: message.title,
          body: message.body,
          dryRun: options.dryRunNotify,
        })
      : {
          notificationSent: false,
          notificationSkipped: true,
          notificationReason: shouldSendDailyMobileNotification(initialReport, options)
            ? invocationValidation.reason
            : "not requested",
        };
  if (notification.notificationSent) {
    markDailyMobileNotificationSent(effectiveTaskStatePath, taskState, runId);
  }
  const report = {
    ...initialReport,
    notificationSent: Boolean(notification.notificationSent),
    notificationSkipped: Boolean(notification.notificationSkipped),
    notificationReason: notification.notificationReason || "not requested",
  };

  fs.mkdirSync(path.dirname(reportJsonPath), { recursive: true });
  fs.writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(reportMarkdownPath, `\ufeff${buildMarkdownReportV2(report)}`, "utf8");

  return {
    report,
    message,
    notification,
    paths: {
      reportJsonPath,
      reportMarkdownPath,
    },
  };
}

export function isDirectCliInvocation({
  importMetaUrl = import.meta.url,
  argv1 = process.argv[1],
} = {}) {
  return Boolean(argv1) && importMetaUrl === pathToFileURL(argv1).href;
}

if (isDirectCliInvocation()) {
  runSmokingpipesDailyMobileReport()
    .then((result) => {
      console.log(JSON.stringify(result.report, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
