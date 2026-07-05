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
  /"?(?:captchaDetected|verificationDetected|verificationDetectedAt|manualVerificationRecovered|weakVerificationDetected)"?\s*:\s*(?:false|null)/i;
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
    "skipped-success",
    "running",
  ]);

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

  if (taskStatus === "skipped-success") {
    return "skipped-success";
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
  const blockers = [...toArray(audit?.blockers)];
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
  const verificationBlocker = findVerificationBlocker({
    state,
    audit,
    taskLogText,
  });
  const taskFailure = findDailyTaskFailure(taskLogText);
  const detailPhaseStatus = normalizeText(taskState?.detailPhaseStatus);
  const detailQueueSpike =
    taskState?.detailQueueSpike &&
    typeof taskState.detailQueueSpike === "object"
      ? taskState.detailQueueSpike
      : null;
  const detailQueueSpikeBlocked =
    taskState?.lastFailureType === "detail-queue-spike" ||
    detailQueueSpike?.blocked === true;

  if (verificationBlocker && !blockers.includes(verificationBlocker)) {
    blockers.unshift(verificationBlocker);
  }
  if (taskFailure && !verificationBlocker && !blockers.includes(taskFailure)) {
    blockers.unshift(taskFailure);
  }
  if (stateBlockedReason && blockers.length === 0) {
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
  const detailComplete = countBy(
    candidates,
    (item) => item?.detailStatus === "complete"
  );
  const detailFailed = countBy(
    candidates,
    (item) => item?.detailStatus === "failed"
  );
  const detailPending = countBy(
    candidates,
    (item) => item?.detailStatus === "pending"
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
  const pendingDetailCount = calculatePendingDetailCount({
    detailPending,
  });
  const status = deriveStatus({ state, audit, taskLogText, taskState });
  const failureType = taskState?.lastFailureType || null;
  const reason = detailQueueSpikeBlocked
    ? `待处理详情突然增加到 ${pendingDetailCount}，超过正常范围，已暂停自动续跑。`
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
    productionWritten: Boolean(audit?.productionWritten || taskState?.productionWritten),
    taskStatus: normalizeTaskStatus(taskState) || null,
    inventoryLocks,
    progressiveLock,
    currentList,
    cachedListResume,
    detailPhaseStatus: detailPhaseStatus || null,
    detailQueueSpike,
    verificationRequired: Boolean(verificationBlocker),
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
    publicReady,
    publicReviewOnly,
    publicNotPublic,
    pendingDetailCount,
    blockers,
    warnings,
    auditStatus: getAuditStatus(audit) || null,
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
  if (status === "lock-active") return "库存任务正在运行，等待下一轮";
  if (status === "stale-lock-cleared") return "已清理过期任务锁，继续执行";
  if (status === "detail-complete") return "详情队列已完成，正在进入候选应用";
  if (status === "retryable-failed") return "更新失败，将自动重试";
  if (status === "terminal-failed") return "更新失败，已停止重试";
  if (status === "skipped-success") return "已跳过";
  if (status === "blocked") return "需要人工验证";
  if (status === "failed") return "更新失败";
  if (status === "success") return "已更新";
  if (status === "preview") return "未更新，仅生成预览";
  if (status === "noop") return "无可更新";
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

  if (status === "retryable-failed" || status === "terminal-failed") {
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

  if (
    failureType === "preflight" &&
    (status === "retryable-failed" || status === "terminal-failed")
  ) {
    return "先查看 data/review/smokingpipes-daily-recovery-preflight-report.md，按报告修复后再重跑恢复任务。";
  }

  if (status === "terminal-failed") {
    return "人工检查 audit report";
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
        : "107/107";
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
        : "107/107";
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

export function buildPushDeerDailyMessage(report) {
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
  return {
    send: argv.includes("--send"),
    dryRunNotify: argv.includes("--dry-run-notify"),
  };
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
  const taskState = readJsonIfExists(taskStatePath);
  const taskLogText = readTextIfExists(taskLogPath);

  if (!state) missingInputs.push(statePath);
  if (!audit) missingInputs.push(auditPath);

  const initialReport = buildSmokingpipesDailyMobileReport({
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
  });
  const message = buildPushDeerDailyMessage(initialReport);
  const notification =
    shouldSendDailyMobileNotification(initialReport, options)
      ? await sendPushDeerNotification({
          title: message.title,
          body: message.body,
          dryRun: options.dryRunNotify,
        })
      : {
          notificationSent: false,
          notificationSkipped: true,
          notificationReason: "not requested",
        };
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
