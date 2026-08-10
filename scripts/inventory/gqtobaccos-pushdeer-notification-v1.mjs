import { sendPushDeerNotification } from "./inventory-pushdeer-notifier-v1.mjs";

function nonNegativeInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function notificationMetrics(dailyResult = {}) {
  const list = dailyResult?.list || {};
  const coverage = dailyResult?.diff?.coverage || {};
  const counts = dailyResult?.diff?.counts || {};
  const validation = dailyResult?.validation?.counts || {};
  const queue = dailyResult?.queue || {};

  return {
    pagesCompleted: nonNegativeInteger(list.pagesCompleted, nonNegativeInteger(coverage.pagesScanned)),
    pagesDiscovered: nonNegativeInteger(
      list.pagesDiscovered,
      nonNegativeInteger(coverage.detectedTotalPages, nonNegativeInteger(coverage.expectedPages))
    ),
    rawListCount: nonNegativeInteger(list.productsExtracted, nonNegativeInteger(counts.currentAvailable)),
    publicEligibleCount: nonNegativeInteger(validation.publicEligible),
    newCount: nonNegativeInteger(counts.new),
    disappearedCount: nonNegativeInteger(counts.disappeared),
    reappearedCount: nonNegativeInteger(counts.reappeared),
    detailQueue: nonNegativeInteger(queue.queued),
    detailFailed: nonNegativeInteger(queue.failures),
    rateLimitRetryCount: nonNegativeInteger(list.rateLimitRetryCount),
  };
}

function failureStage(error) {
  const message = String(error?.message || "");
  if (error?.stage) return String(error.stage);
  if (error?.listProgress || error?.status || /GQ page|pagination|category page|HTTP \d+/i.test(message)) return "List";
  if (/allowPublish|blocked by the shared anomaly gate|required-detail validation/i.test(message)) return "Validation";
  if (/detail/i.test(message)) return "Detail";
  if (/production pipeline/i.test(message)) return "Production";
  return "Unknown";
}

function failureReason(error) {
  const normalized = String(error?.message || error || "unknown GQ Daily failure")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.slice(0, 500) || "unknown GQ Daily failure";
}

export function buildGqDailySuccessPushDeerMessage(dailyResult = {}) {
  const metrics = notificationMetrics(dailyResult);
  const hasInventoryChange = metrics.newCount > 0 || metrics.disappearedCount > 0 || metrics.reappearedCount > 0 || metrics.detailQueue > 0;

  return {
    title: "烟斗派库存日报｜GQ Tobaccos ✅",
    body: [
      "状态：更新成功",
      `扫描：${metrics.pagesCompleted}/${metrics.pagesDiscovered} 页`,
      `源站商品：${metrics.rawListCount}`,
      `公开商品：${metrics.publicEligibleCount}`,
      `新增：${metrics.newCount}`,
      `下架：${metrics.disappearedCount}`,
      `重新出现：${metrics.reappearedCount}`,
      `详情补抓：${metrics.detailQueue}`,
      `详情失败：${metrics.detailFailed}`,
      `429 重试：${metrics.rateLimitRetryCount}`,
      `Production：${hasInventoryChange ? "已更新" : "无变化"}`,
      `allowPublish：${dailyResult?.allowPublish === true ? "true" : "false"}`,
    ].join("\n"),
  };
}

export function buildGqDailyFailurePushDeerMessage({ error, dailyResult } = {}) {
  const metrics = notificationMetrics(dailyResult);
  const progress = error?.listProgress || {};
  const pagesCompleted = nonNegativeInteger(progress.pagesCompleted, metrics.pagesCompleted);
  const pagesDiscovered = nonNegativeInteger(progress.pagesDiscovered, metrics.pagesDiscovered);
  const failedPage = pagesCompleted + 1;
  const httpStatus = Number.isInteger(error?.status) ? error.status : "未知";
  const rateLimitRetries = nonNegativeInteger(error?.rateLimitRetries, metrics.rateLimitRetryCount);

  return {
    title: "烟斗派库存日报｜GQ Tobaccos ❌",
    body: [
      "状态：更新失败",
      `失败阶段：${failureStage(error)}`,
      `扫描：${pagesCompleted}/${pagesDiscovered} 页`,
      `失败页：${failedPage}`,
      `HTTP：${httpStatus}`,
      `429 重试：${rateLimitRetries}`,
      "allowPublish：false",
      "Production：未修改",
      `失败原因：${failureReason(error)}`,
    ].join("\n"),
  };
}

export function buildGqPushDeerTestMessage() {
  return {
    title: "烟斗派｜GQ PushDeer 测试 ✅",
    body: "GQ Tobaccos 自动日更通知已连接。",
  };
}

export async function sendGqDailyPushDeerNotification({
  dailyResult = null,
  error = null,
  testNotification = false,
  dryRun = false,
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const message = testNotification
    ? buildGqPushDeerTestMessage()
    : error || dailyResult?.allowPublish !== true
      ? buildGqDailyFailurePushDeerMessage({ error, dailyResult })
      : buildGqDailySuccessPushDeerMessage(dailyResult);
  const notification = await sendPushDeerNotification({
    title: message.title,
    body: message.body,
    dryRun,
    env,
    fetchImpl,
  });

  return {
    ...notification,
    title: message.title,
    body: message.body,
  };
}
