import {
  applySmokingpipesBrandExclusions,
} from "../lib/smokingpipes-brand-exclusions-v1.mjs";
import {
  runProgressiveDetailChunk,
  selectProgressiveDetailCandidates,
} from "./smokingpipes-progressive-daily-v1.mjs";

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : fallback;
}

function countStatus(state, status) {
  return (state?.candidates || []).filter(
    (item) => item.detailStatus === status
  ).length;
}

export function buildSmokingpipesManualBackfillVerificationMessage({
  sourceProductId = "",
  sourceUrl = "",
} = {}) {
  return {
    title: "烟斗派人工详情补齐需要验证",
    body: [
      "Smokingpipes 详情抓取遇到源站验证。",
      "",
      "验证对象：Smokingpipes",
      "验证位置：运行任务的电脑",
      "浏览器：Chrome profile sp-chrome",
      `当前商品：${sourceProductId || "未知"}`,
      `验证页面：${sourceUrl || "当前打开的 Smokingpipes 详情页"}`,
      "",
      "请在打开的 Chrome 窗口中完成人工验证，不要关闭浏览器。",
      "验证成功后脚本会确认正常商品详情已恢复，再继续当前批次。",
      "本流程不会绕过验证，也不会写 production。",
    ].join("\n"),
  };
}

export function smokingpipesManualBackfillMarkdown(report) {
  return `# Smokingpipes Manual Full Detail Backfill

- status: ${report.status}
- pendingBefore: ${report.pendingBefore}
- pendingAfterBrandExclusion: ${report.pendingAfterBrandExclusion}
- excludedBrandCount: ${report.excludedBrandCount}
- excludedBrandBreakdown: ${JSON.stringify(report.excludedBrandBreakdown)}
- batchLimit: ${report.batchLimit}
- untilEmpty: ${report.untilEmpty}
- maxTotal: ${report.maxTotal}
- batchCount: ${report.batchCount}
- fetchedThisBatch: ${report.fetchedThisBatch}
- fetchedTotal: ${report.fetchedTotal}
- completed: ${report.completed}
- failed: ${report.failed}
- blocked: ${report.blocked}
- pendingAfter: ${report.pendingAfter}
- verificationRequired: ${report.verificationRequired}
- manualVerificationRecovered: ${report.manualVerificationRecovered}
- smokingpipesAccessed: ${report.smokingpipesAccessed}
- productionWritten: false

## Batches

${
  report.batches.length
    ? report.batches
        .map(
          (batch) =>
            `- batch ${batch.batch}: selected=${batch.selected}, completed=${batch.completed}, failed=${batch.failed}, blocked=${batch.blocked}, pendingAfter=${batch.pendingAfter}`
        )
        .join("\n")
    : "- none"
}

## Blocked reason

${report.blockedReason || "none"}
`;
}

export async function runSmokingpipesManualDetailBackfill({
  state,
  productionProducts = [],
  publicProducts = [],
  batchLimit = 30,
  untilEmpty = false,
  cooldownMs = 0,
  maxTotal = null,
  now = new Date().toISOString(),
  runId = state?.dailyRunId,
  processDetail,
  checkpoint = async () => {},
  wait = async () => {},
  smokingpipesAccessed = false,
  manualVerificationRecovered = false,
} = {}) {
  const safeBatchLimit = Math.min(
    50,
    positiveInteger(batchLimit, 30)
  );
  const safeMaxTotal = positiveInteger(
    maxTotal,
    untilEmpty ? 500 : safeBatchLimit
  );
  const exclusion = applySmokingpipesBrandExclusions({
    state,
    productionProducts,
    publicProducts,
    now,
  });
  let next = exclusion.state;
  await checkpoint(next);

  const batches = [];
  let fetchedTotal = 0;
  let completed = 0;
  let failed = 0;
  let blocked = 0;
  let blockedReason = null;
  let fetchedThisBatch = 0;

  while (fetchedTotal < safeMaxTotal) {
    const remaining = selectProgressiveDetailCandidates({
      state: next,
      maxItems: safeBatchLimit,
      now,
    });
    if (!remaining.length) break;

    const maxItems = Math.min(
      safeBatchLimit,
      safeMaxTotal - fetchedTotal
    );
    const result = await runProgressiveDetailChunk({
      state: next,
      maxItems,
      now,
      runId,
      processDetail,
      checkpoint,
    });
    next = result.state;
    fetchedThisBatch = result.selected;
    fetchedTotal += result.selected;
    completed += result.completedThisRun;
    failed += result.failedThisRun;
    const blockedThisBatch = result.blockedReason ? 1 : 0;
    blocked += blockedThisBatch;
    blockedReason ||= result.blockedReason || null;
    batches.push({
      batch: batches.length + 1,
      selected: result.selected,
      completed: result.completedThisRun,
      failed: result.failedThisRun,
      blocked: blockedThisBatch,
      pendingAfter: countStatus(next, "pending"),
    });
    await checkpoint(next);

    if (result.blockedReason || !untilEmpty) break;
    const morePending = selectProgressiveDetailCandidates({
      state: next,
      maxItems: 1,
      now,
    }).length;
    if (!morePending || fetchedTotal >= safeMaxTotal) break;
    if (Number(cooldownMs || 0) > 0) {
      await wait(Number(cooldownMs));
    }
  }

  const pendingAfter = countStatus(next, "pending");
  const verificationRequired = blocked > 0;
  next.latestRun = {
    ...(next.latestRun || {}),
    runId,
    mode: "progressive-manual-detail-backfill",
    finishedAt: new Date().toISOString(),
    selected: fetchedTotal,
    completedThisRun: completed,
    failedThisRun: failed,
    blockedReason,
    recommendedNextRunAt:
      next.latestRun?.recommendedNextRunAt || null,
  };
  const report = {
    version: "smokingpipes-manual-detail-backfill-report-v1",
    generatedAt: new Date().toISOString(),
    status: verificationRequired
      ? "verification-required"
      : pendingAfter > 0
        ? "partial-complete"
        : "complete",
    pendingBefore: exclusion.report.pendingBefore,
    pendingAfterBrandExclusion:
      exclusion.report.pendingAfterBrandExclusion,
    excludedBrandCount:
      exclusion.report.excludedBrandCount,
    excludedBrandBreakdown:
      exclusion.report.excludedBrandBreakdown,
    batchLimit: safeBatchLimit,
    untilEmpty: Boolean(untilEmpty),
    cooldownMs: Number(cooldownMs || 0),
    maxTotal: safeMaxTotal,
    batchCount: batches.length,
    fetchedThisBatch,
    fetchedTotal,
    completed,
    failed,
    blocked,
    pendingAfter,
    verificationRequired,
    manualVerificationRecovered:
      manualVerificationRecovered === true,
    blockedReason,
    batches,
    smokingpipesAccessed:
      smokingpipesAccessed === true && fetchedTotal > 0,
    productionWritten: false,
    commitPerformed: false,
    pushPerformed: false,
  };

  return {
    state: next,
    report,
    exclusionReport: exclusion.report,
  };
}
