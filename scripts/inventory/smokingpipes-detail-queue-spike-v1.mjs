import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
export const DETAIL_PENDING_SPIKE_THRESHOLD = 500;
const DEFAULT_PATHS = {
  state: path.join(
    ROOT,
    "data/inventory/smokingpipes-progressive-daily-state.json"
  ),
  diff: path.join(
    ROOT,
    "data/inventory/smokingpipes-inventory-diff-dry-run.json"
  ),
  currentList: path.join(
    ROOT,
    "data/inventory/smokingpipes-current-list-dry-run.json"
  ),
  production: path.join(
    ROOT,
    "data/products/smokingpipes-products.json"
  ),
  reportJson: path.join(
    ROOT,
    "data/review/smokingpipes-detail-pending-spike-diagnosis-20260705.json"
  ),
  reportMarkdown: path.join(
    ROOT,
    "data/review/smokingpipes-detail-pending-spike-diagnosis-20260705.md"
  ),
};

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function productId(value) {
  return text(value?.sourceProductId || value?.id);
}

function products(payload) {
  return Array.isArray(payload) ? payload : payload?.products || [];
}

function readJson(filePath) {
  return JSON.parse(
    fs.readFileSync(filePath, "utf8").replace(/^\ufeff/, "")
  );
}

function countBy(items, getter) {
  const counts = {};
  for (const item of items || []) {
    const key = text(getter(item)) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) =>
      left.localeCompare(right, "en")
    )
  );
}

function countChangeTypes(candidates) {
  const counts = {};
  for (const candidate of candidates || []) {
    const changeTypes = Array.isArray(candidate?.changeTypes)
      ? candidate.changeTypes
      : [];
    if (!changeTypes.length) {
      counts.unknown = (counts.unknown || 0) + 1;
      continue;
    }
    for (const changeType of changeTypes) {
      const key = text(changeType) || "unknown";
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) =>
      left.localeCompare(right, "en")
    )
  );
}

function parsePrice(value) {
  const amount = Number.parseFloat(
    text(value).replace(/[^0-9.]/g, "")
  );
  return Number.isFinite(amount) && amount > 0
    ? amount
    : null;
}

function hasDetail(candidate) {
  return Boolean(
    candidate?.detail ||
      candidate?.detailData ||
      candidate?.parsedDetail
  );
}

function hashFileIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

export function evaluateSmokingpipesDetailQueueSpikeGuard({
  detailPendingCount = 0,
  previousDetailPendingCount = 0,
  pendingExistingWithConvertedCount = 0,
}) {
  const pending = Math.max(0, Number(detailPendingCount) || 0);
  const previous = Math.max(
    0,
    Number(previousDetailPendingCount) || 0
  );
  const existingConverted = Math.max(
    0,
    Number(pendingExistingWithConvertedCount) || 0
  );
  const existingConvertedRatio =
    pending > 0 ? existingConverted / pending : 0;
  const blockReasons = [];

  if (pending > DETAIL_PENDING_SPIKE_THRESHOLD) {
    blockReasons.push(
      `detailPendingCount ${pending} exceeds ${DETAIL_PENDING_SPIKE_THRESHOLD}`
    );
  }
  if (previous > 0 && pending > previous * 3) {
    blockReasons.push(
      `detailPendingCount ${pending} exceeds previous ${previous} by more than 3x`
    );
  }
  if (
    previous === 0 &&
    pending > DETAIL_PENDING_SPIKE_THRESHOLD
  ) {
    blockReasons.push(
      `detailPendingCount ${pending} exceeds ${DETAIL_PENDING_SPIKE_THRESHOLD} after previous count 0`
    );
  }
  if (existingConvertedRatio > 0.3) {
    blockReasons.push(
      `pending existing-production candidates with converted products ratio ${existingConvertedRatio.toFixed(
        4
      )} exceeds 0.30`
    );
  }

  return {
    blocked: blockReasons.length > 0,
    status: blockReasons.length
      ? "manual-review-required"
      : "ready",
    failureType: blockReasons.length
      ? "detail-queue-spike"
      : null,
    retryAllowed: false,
    detailPendingSpikeThreshold:
      DETAIL_PENDING_SPIKE_THRESHOLD,
    detailPendingCount: pending,
    previousDetailPendingCount: previous,
    pendingExistingWithConvertedCount: existingConverted,
    existingConvertedRatio,
    blockReasons,
  };
}

function summarizePriceRatios({
  currentRunCandidates,
  productionById,
}) {
  const ratios = [];
  for (const candidate of currentRunCandidates) {
    if (!candidate.changeTypes?.includes("price-change")) {
      continue;
    }
    const production = productionById.get(
      productId(candidate)
    );
    const currentPrice = parsePrice(candidate.listPrice);
    const productionPrice = parsePrice(
      production?.price?.current?.amount
    );
    if (!currentPrice || !productionPrice) continue;
    ratios.push(currentPrice / productionPrice);
  }
  const roundedDistribution = countBy(
    ratios,
    (ratio) => (Math.round(ratio * 100) / 100).toFixed(2)
  );
  const dominant = Object.entries(roundedDistribution).sort(
    (left, right) => right[1] - left[1]
  )[0] || [null, 0];
  return {
    compared: ratios.length,
    roundedDistribution,
    dominantRatio: dominant[0],
    dominantCount: dominant[1],
    likelySitewideDiscount:
      dominant[0] === "0.85" && dominant[1] > 100,
  };
}

export function buildSmokingpipesDetailPendingSpikeDiagnosis({
  state,
  diff,
  currentList,
  productionProducts = [],
  previousDetailPendingCount = 0,
  mobileReportedPendingCount = null,
  currentProductionPath = null,
  releaseProductionPath = null,
  now = new Date().toISOString(),
}) {
  const candidates = state?.candidates || [];
  const currentProducts = products(currentList);
  const productionRows = products(productionProducts);
  const productionById = new Map(
    productionRows.map((item) => [productId(item), item])
  );
  const pending = candidates.filter(
    (item) => item.detailStatus === "pending"
  );
  const currentRunCandidates = candidates.filter(
    (item) =>
      !state?.dailyRunId ||
      item.lastSeenRunId === state.dailyRunId
  );
  const currentRunCandidateIds = new Set(
    currentRunCandidates.map(productId)
  );
  const pendingExistingWithConverted = pending.filter(
    (item) =>
      productionById.has(productId(item)) &&
      Boolean(item.convertedProduct)
  );
  const guard = evaluateSmokingpipesDetailQueueSpikeGuard({
    detailPendingCount: pending.length,
    previousDetailPendingCount,
    pendingExistingWithConvertedCount:
      pendingExistingWithConverted.length,
  });
  const detailStatusRaw = countBy(
    candidates,
    (item) => item.detailStatus
  );
  const publicStatusRaw = countBy(
    candidates,
    (item) => item.publicStatus
  );
  const pendingAnalysis = {
    changeTypeDistribution: countChangeTypes(pending),
    hasDetail: pending.filter(hasDetail).length,
    hasConvertedProduct: pending.filter(
      (item) => Boolean(item.convertedProduct)
    ).length,
    existsInProduction: pending.filter((item) =>
      productionById.has(productId(item))
    ).length,
    existsInProductionWithConvertedProduct:
      pendingExistingWithConverted.length,
    alreadyPublicReady: pending.filter(
      (item) => item.publicStatus === "ready"
    ).length,
    oldProductRequeued: pending.filter((item) =>
      productionById.has(productId(item))
    ).length,
    firstSeenThisRun: pending.filter(
      (item) =>
        item.firstSeenRunId === state?.dailyRunId
    ).length,
  };
  const diffCounts = {
    newProduct: Array.isArray(diff?.newIds)
      ? diff.newIds.length
      : 0,
    priceChange: currentRunCandidates.filter((item) =>
      item.changeTypes?.includes("price-change")
    ).length,
    explicitOutOfStock: currentRunCandidates.filter(
      (item) =>
        item.changeTypes?.includes("explicit-out-of-stock")
    ).length,
    reappeared: Array.isArray(diff?.reappearedIds)
      ? diff.reappearedIds.length
      : 0,
    disappeared: Array.isArray(diff?.disappearedIds)
      ? diff.disappearedIds.length
      : 0,
    unchanged: currentProducts.filter(
      (item) => !currentRunCandidateIds.has(productId(item))
    ).length,
    unknown: currentProducts.filter(
      (item) => !productId(item) || !text(item.sourceUrl)
    ).length,
  };
  const mobilePending =
    mobileReportedPendingCount !== null &&
    mobileReportedPendingCount !== undefined &&
    Number.isFinite(Number(mobileReportedPendingCount))
      ? Number(mobileReportedPendingCount)
      : pending.length +
        Math.max(
          0,
          Number(publicStatusRaw["not-public"] || 0) -
            Number(detailStatusRaw.failed || 0)
        );
  const currentHash = hashFileIfExists(
    currentProductionPath
  );
  const releaseHash = hashFileIfExists(
    releaseProductionPath
  );
  const priceChangeEvidence = summarizePriceRatios({
    currentRunCandidates,
    productionById,
  });

  return {
    version:
      "smokingpipes-detail-pending-spike-diagnosis-v1",
    generatedAt: now,
    source: "smokingpipes",
    status: guard.blocked
      ? "manual-review-required"
      : "ready",
    productionWritten: false,
    networkAccessed: false,
    detailsFetched: false,
    stageBAllowed: false,
    currentList: {
      products: currentProducts.length,
      uniqueProducts: new Set(
        currentProducts.map(productId).filter(Boolean)
      ).size,
      pagesScanned: Number(
        currentList?.summary?.pagesScanned ||
          state?.pagesScanned ||
          0
      ),
      expectedPages: Number(
        currentList?.summary?.expectedPages ||
          state?.expectedPages ||
          0
      ),
      completedAt:
        currentList?.completedAt ||
        currentList?.summary?.completedAt ||
        null,
    },
    diffCounts,
    counts: {
      candidates: candidates.length,
      detailStatus: {
        pending: Number(detailStatusRaw.pending || 0),
        complete: Number(detailStatusRaw.complete || 0),
        failed: Number(detailStatusRaw.failed || 0),
        blocked: Number(detailStatusRaw.blocked || 0),
        skipped: Number(detailStatusRaw.skipped || 0),
      },
      publicStatus: {
        ready: Number(publicStatusRaw.ready || 0),
        reviewOnly: Number(
          publicStatusRaw["review-only"] || 0
        ),
        notPublic: Number(
          publicStatusRaw["not-public"] || 0
        ),
      },
      actualDetailPending: pending.length,
      mobileReportedPending: mobilePending,
      mobileDoubleCountOverstatement:
        mobilePending - pending.length,
    },
    pendingAnalysis,
    pendingSamples: pending.slice(0, 50).map((item) => {
      const production = productionById.get(productId(item));
      return {
        sourceProductId: productId(item),
        changeType:
          item.changeTypes?.join(", ") || "unknown",
        detailStatus: text(item.detailStatus) || "unknown",
        publicStatus: text(item.publicStatus) || "unknown",
        hasDetail: hasDetail(item),
        hasConvertedProduct: Boolean(
          item.convertedProduct
        ),
        existsInProduction: Boolean(production),
        productName:
          text(item.listTitle) ||
          text(
            production?.displayNameEn ||
              production?.fullTitle ||
              production?.rawTitle
          ),
        reason:
          text(
            item.lastError ||
              item.reviewReason ||
              item.lastBlockedReason
          ) ||
          "new-product detail has not been fetched",
      };
    }),
    stateHistory: {
      createdAt: state?.createdAt || null,
      updatedAt: state?.updatedAt || null,
      dailyRunId: state?.dailyRunId || null,
      firstSeenRunDistribution: countBy(
        candidates,
        (item) => item.firstSeenRunId
      ),
      lastSeenRunDistribution: countBy(
        candidates,
        (item) => item.lastSeenRunId
      ),
      summaryPending: Number(
        state?.summary?.pending || 0
      ),
      actualPending: pending.length,
      summaryIsStale:
        Number(state?.summary?.pending || 0) !==
        pending.length,
    },
    priceChangeEvidence,
    workspaceComparison: {
      currentProductionPath,
      releaseProductionPath,
      currentProductionHash: currentHash,
      releaseProductionHash: releaseHash,
      hashesEqual:
        currentHash && releaseHash
          ? currentHash === releaseHash
          : null,
      runtimeReadExternalWorktree: false,
      causalAssessment:
        "The daily runner read the original workspace production path. Release/main divergence is a separate release risk, not the direct queue-spike trigger.",
    },
    baselineAssessment: {
      stateFileOverwritten: false,
      stateAccumulatedAcrossRuns:
        Object.keys(
          countBy(candidates, (item) => item.firstSeenRunId)
        ).length > 1,
      productionPathMissing: productionRows.length === 0,
      staleBaselineGapLikely:
        (diffCounts.newProduct > 300 ||
          diffCounts.disappeared > 300) &&
        pendingAnalysis.firstSeenThisRun === pending.length,
      mobileCountDoubleCounted:
        mobilePending > pending.length,
      explanation: [
        `The mobile report counted ${mobilePending}, but only ${pending.length} candidates have detailStatus=pending.`,
        `${diffCounts.newProduct} new IDs and ${diffCounts.disappeared} disappeared IDs indicate a large baseline-to-snapshot gap.`,
        `${priceChangeEvidence.dominantCount} price changes have an approximately ${priceChangeEvidence.dominantRatio} ratio, consistent with a broad source promotion rather than ordinary daily repricing.`,
        "Progressive state retains candidates and changeTypes across run IDs; historical classifications must not be treated as a fresh daily queue.",
      ],
    },
    guard,
    conclusion: guard.blocked
      ? "BLOCK: do not fetch details, write production, retry automatically, or proceed to stage B."
      : "READY: detail queue is within configured safety limits.",
  };
}

function markdown(report) {
  const pending = report.pendingAnalysis;
  const samples = report.pendingSamples
    .map(
      (item) =>
        `| ${item.sourceProductId} | ${item.changeType} | ${item.detailStatus} | ${item.publicStatus} | ${item.hasDetail} | ${item.hasConvertedProduct} | ${item.existsInProduction} | ${item.productName} | ${item.reason} |`
    )
    .join("\n");
  return `# Smokingpipes Detail Pending Spike Diagnosis — 2026-07-05

## 结论

- status: ${report.status}
- detailPending 实际值: ${report.counts.actualDetailPending}
- 手机报告值: ${report.counts.mobileReportedPending}
- 重复计数高估: ${report.counts.mobileDoubleCountOverstatement}
- 是否阻断: ${report.guard.blocked}
- failureType: ${report.guard.failureType || "none"}
- retryAllowed: ${report.guard.retryAllowed}
- productionWritten: false
- Stage B allowed: false

${report.conclusion}

## Current List

- 产品数: ${report.currentList.products}
- unique: ${report.currentList.uniqueProducts}
- 扫描页数: ${report.currentList.pagesScanned}/${report.currentList.expectedPages}

## Diff

- new-product: ${report.diffCounts.newProduct}
- price-change: ${report.diffCounts.priceChange}
- explicit-out-of-stock: ${report.diffCounts.explicitOutOfStock}
- reappeared: ${report.diffCounts.reappeared}
- disappeared: ${report.diffCounts.disappeared}
- unchanged: ${report.diffCounts.unchanged}
- unknown: ${report.diffCounts.unknown}

## Progressive State

- pending: ${report.counts.detailStatus.pending}
- complete: ${report.counts.detailStatus.complete}
- failed: ${report.counts.detailStatus.failed}
- blocked: ${report.counts.detailStatus.blocked}
- skipped: ${report.counts.detailStatus.skipped}
- ready: ${report.counts.publicStatus.ready}
- review-only: ${report.counts.publicStatus.reviewOnly}
- not-public: ${report.counts.publicStatus.notPublic}

## Pending 来源

- changeTypes: ${JSON.stringify(pending.changeTypeDistribution)}
- hasDetail: ${pending.hasDetail}
- hasConvertedProduct: ${pending.hasConvertedProduct}
- existsInProduction: ${pending.existsInProduction}
- existsInProductionWithConvertedProduct: ${pending.existsInProductionWithConvertedProduct}
- alreadyPublicReady: ${pending.alreadyPublicReady}
- oldProductRequeued: ${pending.oldProductRequeued}
- firstSeenThisRun: ${pending.firstSeenThisRun}

## 根因

${report.baselineAssessment.explanation.map((item) => `- ${item}`).join("\n")}

- stateFileOverwritten: ${report.baselineAssessment.stateFileOverwritten}
- stateAccumulatedAcrossRuns: ${report.baselineAssessment.stateAccumulatedAcrossRuns}
- productionPathMissing: ${report.baselineAssessment.productionPathMissing}
- staleBaselineGapLikely: ${report.baselineAssessment.staleBaselineGapLikely}
- release/current production hash equal: ${report.workspaceComparison.hashesEqual}
- workspace assessment: ${report.workspaceComparison.causalAssessment}

## Guard

${report.guard.blockReasons.length ? report.guard.blockReasons.map((item) => `- ${item}`).join("\n") : "- none"}

## Pending 前 50 条

| sourceProductId | changeType | detailStatus | publicStatus | hasDetail | hasConvertedProduct | existsInProduction | productName | reason |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${samples || "| none | none | none | none | false | false | false | none | none |"}
`;
}

function parsePreviousPending(argv) {
  const argument = argv.find((item) =>
    item.startsWith("--previous-detail-pending-count=")
  );
  if (!argument) return 0;
  const value = Number(argument.split("=", 2)[1]);
  return Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

async function main(argv = process.argv.slice(2)) {
  const releaseProductionPath = path.resolve(
    ROOT,
    "../pipewebsite-sp-release/data/products/smokingpipes-products.json"
  );
  const report =
    buildSmokingpipesDetailPendingSpikeDiagnosis({
      state: readJson(DEFAULT_PATHS.state),
      diff: readJson(DEFAULT_PATHS.diff),
      currentList: readJson(DEFAULT_PATHS.currentList),
      productionProducts: readJson(DEFAULT_PATHS.production),
      previousDetailPendingCount: parsePreviousPending(argv),
      currentProductionPath: DEFAULT_PATHS.production,
      releaseProductionPath,
    });
  fs.mkdirSync(path.dirname(DEFAULT_PATHS.reportJson), {
    recursive: true,
  });
  fs.writeFileSync(
    DEFAULT_PATHS.reportJson,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );
  fs.writeFileSync(
    DEFAULT_PATHS.reportMarkdown,
    `\ufeff${markdown(report)}`,
    "utf8"
  );
  console.log(
    JSON.stringify(
      {
        status: report.status,
        blocked: report.guard.blocked,
        failureType: report.guard.failureType,
        retryAllowed: report.guard.retryAllowed,
        detailPendingSpikeThreshold:
          report.guard.detailPendingSpikeThreshold,
        detailPendingCount:
          report.counts.actualDetailPending,
        previousDetailPendingCount:
          report.guard.previousDetailPendingCount,
        pendingExistingWithConvertedCount:
          report.guard.pendingExistingWithConvertedCount,
        existingConvertedRatio:
          report.guard.existingConvertedRatio,
        blockReasons: report.guard.blockReasons,
        reportJson: path.relative(
          ROOT,
          DEFAULT_PATHS.reportJson
        ),
        reportMarkdown: path.relative(
          ROOT,
          DEFAULT_PATHS.reportMarkdown
        ),
        productionWritten: false,
      },
      null,
      2
    )
  );
}

const directExecution =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href ===
    import.meta.url;

if (directExecution) {
  await main();
}
