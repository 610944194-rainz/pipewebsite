import fs from "node:fs";
import path from "node:path";
import {
  buildUnifiedProductsFromInputs,
} from "../build-unified-products-staging-v1.mjs";
import {
  buildPublicProductsFullCandidate,
  loadPublicProductsPricingContext,
} from "../build-public-product-indexes-v1.mjs";
import {
  convertSmokingpipesCandidateDetails,
} from "../convert-smokingpipes-products-v2.mjs";
import {
  addParsedMeasurements,
  detectSmokingpipesVerification,
  extractDetailProduct,
  isNormalSmokingpipesDetail,
  launchSmokingpipesContext,
  waitForSmokingpipesManualRecovery,
} from "../lib/smokingpipes-utils.mjs";
import {
  acquireRunLock,
  formatRunId,
  getRunnerPaths,
  readJsonIfExists,
  releaseRunLock,
  writeJsonAtomic,
  writeTextAtomic,
} from "./inventory-runner-core-v1.mjs";
import {
  createProgressiveDailyState,
  readProgressiveDailyState,
  writeProgressiveDailyState,
} from "./smokingpipes-progressive-state-v1.mjs";
import {
  buildProgressiveStateSummary,
  ingestProgressiveListSnapshot,
  normalizeProgressivePublicStatuses,
  runProgressiveDetailChunk,
  selectProgressiveDetailCandidates,
  summarizeProgressiveState,
} from "./smokingpipes-progressive-daily-v1.mjs";
import {
  applySmokingpipesBrandExclusions,
  smokingpipesBrandExclusionMarkdown,
} from "../lib/smokingpipes-brand-exclusions-v1.mjs";
import {
  buildSmokingpipesManualBackfillVerificationMessage,
  runSmokingpipesManualDetailBackfill,
  smokingpipesManualBackfillMarkdown,
} from "./smokingpipes-manual-detail-backfill-v1.mjs";
import {
  auditProgressivePartialCandidate,
  buildProgressivePartialApplyPreview,
  buildProgressivePartialProducts,
  diagnoseProgressiveApplyGap,
  selectProgressiveRecentNew,
} from "./smokingpipes-progressive-candidate-v1.mjs";
import {
  sendPushDeerNotification,
} from "./inventory-pushdeer-notifier-v1.mjs";
import {
  randomDelayMs,
} from "./smokingpipes-fetch-current-list-v1.mjs";

function items(payload) {
  return Array.isArray(payload) ? payload : payload?.products || [];
}

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function sourceProductId(item) {
  return text(item?.sourceProductId);
}

function progressiveMarkdown(report) {
  return `# Smokingpipes Progressive Daily

- runStatus: ${report.runStatus}
- mode: ${report.mode}
- dailyRunId: ${report.dailyRunId || "none"}
- listSnapshotStatus: ${report.listSnapshotStatus || "none"}
- pagesScanned: ${report.pagesScanned || 0}
- expectedPages: ${report.expectedPages || 107}
- fullExpectedRangeScanned: ${Boolean(report.fullExpectedRangeScanned)}
- captchaDetected: ${Boolean(report.captchaDetected)}
- verificationDetected: ${Boolean(report.verificationDetected)}
- currentListPath: ${report.currentListPath || "none"}
- diffPath: ${report.diffPath || "none"}
- newProductCandidates: ${report.newProductCandidates || 0}
- priceChangeCandidates: ${report.priceChangeCandidates || 0}
- explicitOutOfStockCandidates: ${report.explicitOutOfStockCandidates || 0}
- reappearedCandidates: ${report.reappearedCandidates || 0}
- disappearedCandidatesRecorded: ${report.disappearedCandidatesRecorded || 0}
- disappearedCandidatesApplyAllowed: false
- newCandidates: ${report.newCandidates || 0}
- detailsCompletedThisRun: ${report.detailsCompletedThisRun || 0}
- detailsCompletedTotal: ${report.detailsCompletedTotal || 0}
- detailsPending: ${report.detailsPending || 0}
- detailsFailed: ${report.detailsFailed || 0}
- detailsBlocked: ${report.detailsBlocked || 0}
- readyForPartialApply: ${report.readyForPartialApply || 0}
- partialAppliedCount: ${report.partialAppliedCount || 0}
- candidateCount: ${report.candidateCount || 0}
- wouldApplyCount: ${report.wouldApplyCount || 0}
- isolatedCandidateCount: ${report.isolatedCandidateCount || 0}
- productionWritten: ${Boolean(report.productionWritten)}
- commitPerformed: ${Boolean(report.commitPerformed)}
- pushPerformed: ${Boolean(report.pushPerformed)}
- nextRecommendedRunAt: ${report.nextRecommendedRunAt || "none"}
- blockedReason: ${report.blockedReason || "none"}
`;
}

function auditMarkdown(audit) {
  return `# Smokingpipes Progressive Partial Audit

- verdict: ${audit.verdict}
- productionWritten: false
- newProductReady: ${audit.newProductReady || 0}
- newProductReviewOnly: ${audit.newProductReviewOnly || 0}
- newProductNotReady: ${audit.newProductNotReady || 0}
- candidateCount: ${audit.candidateCount || 0}
- wouldApplyCount: ${audit.wouldApplyCount || 0}
- isolatedCandidateCount: ${audit.isolatedCandidateCount || 0}
- safeToApplyWouldApplySubset: ${Boolean(audit.applyGap?.safeToApplyWouldApplySubset)}
- deletedProducts: ${audit.counts.deletedProducts}
- pendingLeak: ${audit.counts.pendingLeak}
- failedLeak: ${audit.counts.failedLeak}
- blockedLeak: ${audit.counts.blockedLeak}
- reviewOnlyLeak: ${audit.counts.reviewOnlyLeak}
- zeroPriceSellable: ${audit.counts.zeroPriceSellable}

## Blockers

${audit.blockers.length ? audit.blockers.map((item) => `- ${item}`).join("\n") : "- none"}

## Filtered New Products

${audit.filteredNewProducts?.length ? audit.filteredNewProducts.map((item) => `- ${item.sourceProductId}: ${item.publicStatus} / ${item.detailStatus} — ${item.reason}`).join("\n") : "- none"}
`;
}

async function writeProgressiveReport(paths, report) {
  await writeJsonAtomic(paths.progressiveReportJson, report);
  await writeTextAtomic(
    paths.progressiveReportMarkdown,
    progressiveMarkdown(report)
  );
}

function makeReport({ mode, state, result = {} }) {
  const lifecycleSummary = state
    ? summarizeProgressiveState(state)
    : {
        newCandidates: 0,
        detailsCompletedTotal: 0,
        detailsPending: 0,
        detailsFailed: 0,
        detailsBlocked: 0,
        readyForPartialApply: 0,
      };
  const summary = state?.summary || {};
  return {
    version: "smokingpipes-progressive-daily-report-v1",
    generatedAt: new Date().toISOString(),
    mode,
    runStatus: result.status || "blocked",
    dailyRunId: state?.dailyRunId || null,
    listSnapshotStatus: state?.listSnapshotStatus || null,
    pagesScanned: state?.pagesScanned || 0,
    expectedPages: state?.expectedPages || 107,
    fullExpectedRangeScanned:
      state?.fullExpectedRangeScanned === true,
    captchaDetected: state?.captchaDetected === true,
    verificationDetected:
      state?.verificationDetected === true,
    currentListPath: state?.currentListPath || null,
    diffPath: state?.diffPath || null,
    newProductCandidates:
      summary.newProductCandidates ||
      lifecycleSummary.newCandidates ||
      0,
    priceChangeCandidates:
      summary.priceChangeCandidates || 0,
    explicitOutOfStockCandidates:
      summary.explicitOutOfStockCandidates || 0,
    reappearedCandidates:
      summary.reappearedCandidates || 0,
    disappearedCandidatesRecorded:
      summary.disappearedCandidatesRecorded || 0,
    disappearedCandidatesApplyAllowed: false,
    newCandidates:
      summary.newProductCandidates ||
      lifecycleSummary.newCandidates ||
      0,
    detailsCompletedThisRun:
      result.completedThisRun || 0,
    detailsCompletedTotal:
      lifecycleSummary.detailsCompletedTotal,
    detailsPending: lifecycleSummary.detailsPending,
    detailsFailed: lifecycleSummary.detailsFailed,
    detailsBlocked: lifecycleSummary.detailsBlocked,
    readyForPartialApply:
      lifecycleSummary.readyForPartialApply,
    partialAppliedCount:
      result.partialAppliedCount || 0,
    candidateCount: result.candidateCount || 0,
    wouldApplyCount: result.wouldApplyCount || 0,
    isolatedCandidateCount:
      result.isolatedCandidateCount || 0,
    productionWritten: result.productionWritten === true,
    commitPerformed: result.commitPerformed === true,
    pushPerformed: result.pushPerformed === true,
    nextRecommendedRunAt:
      result.recommendedNextRunAt ||
      state?.latestRun?.recommendedNextRunAt ||
      null,
    blockedReason:
      result.blockedReason ||
      state?.latestRun?.blockedReason ||
      state?.blockedReason ||
      null,
  };
}

function mockCurrentPayload() {
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      pagesScanned: 3,
      expectedPages: 107,
      fullExpectedRangeScanned: false,
      captchaDetected: true,
      captchaPages: [4],
    },
    products: Array.from({ length: 5 }, (_, index) => {
      const id = String(990101 + index);
      return {
        sourceProductId: id,
        sourceUrl: `https://example.invalid/moreinfo.cfm?product_id=${id}`,
        title: `Progressive mock pipe ${index + 1}`,
        price: `$${101 + index}.00`,
        imageUrl: `https://example.invalid/${id}.jpg`,
        rawText: "Available",
      };
    }),
  };
}

function loadProduction(paths, mock) {
  const products = items(
    readJsonIfExists(paths.existingProducts, [])
  );
  return mock ? products.slice(0, 20) : products;
}

function loadProductionPublicProducts(paths, mock) {
  if (mock) return [];
  return items(
    readJsonIfExists(
      productionPublicFile(paths, "catalog.json"),
      []
    )
  );
}

function refreshProgressiveSummary(state, now = new Date().toISOString()) {
  const next = structuredClone(state);
  next.updatedAt = now;
  next.summary = buildProgressiveStateSummary(next, now);
  return next;
}

async function writeBrandExclusionReport(paths, report) {
  await writeJsonAtomic(
    paths.progressiveBrandExclusionReportJson,
    report
  );
  await writeTextAtomic(
    paths.progressiveBrandExclusionReportMarkdown,
    smokingpipesBrandExclusionMarkdown(report)
  );
}

function seedMockState(paths, runId) {
  const state = createProgressiveDailyState({
    dailyRunId: runId,
  });
  return ingestProgressiveListSnapshot({
    state,
    currentPayload: mockCurrentPayload(),
    productionProducts: [],
    runId,
    currentListPath: "mock://partial-current-list",
  });
}

function mockConvertedProduct(template, candidate) {
  const amount = Number.parseFloat(
    candidate.listPrice.replace(/[^0-9.]/g, "")
  );
  return {
    ...structuredClone(template),
    id: `smokingpipes-${candidate.sourceProductId}`,
    source: "smokingpipes",
    sourceProductId: candidate.sourceProductId,
    sourceUrl: candidate.sourceUrl,
    rawTitle: candidate.listTitle,
    fullTitle: candidate.listTitle,
    displayNameEn: candidate.listTitle,
    inventoryStatus: "available",
    includedInActiveListRange: true,
    imageUrl: candidate.listPrimaryImage,
    mainImageUrl: candidate.listPrimaryImage,
    detailImageUrl: candidate.listPrimaryImage,
    galleryImages: [candidate.listPrimaryImage],
    galleryCount: 1,
    price: {
      ...(template.price || {}),
      current: {
        rawText: candidate.listPrice,
        currency: "USD",
        amount,
        parseStatus: "parsed",
      },
      listPrice: {
        rawText: candidate.listPrice,
        currency: "USD",
        amount,
        parseStatus: "parsed",
      },
    },
    publication: {
      ...(template.publication || {}),
      status: "eligible",
      publicIndexEligible: true,
      publiclySellable: true,
      listingEligible: true,
    },
  };
}

async function createRealDetailProcessor({
  root,
  paths,
  options,
  runId,
  mode = "progressive-detail-chunk",
  onVerificationDetected = async () => {},
}) {
  const session = await launchSmokingpipesContext({
    root,
    browserChannel: options.browserChannel,
    browserProfile: options.browserProfile,
    browserProfileDir: options.browserProfileDir,
    profileLockPath: paths.browserProfileLock,
    runId,
    mode,
  });
  const page =
    session.context.pages()[0] ||
    (await session.context.newPage());
  const verificationState = {
    verificationDetected: false,
    manualVerificationRecovered: false,
    notification: null,
  };
  return {
    browserStarted: true,
    verificationState,
    async process(candidate) {
      const response = await page.goto(candidate.sourceUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      const warmupMs = randomDelayMs(
        options.detailWarmupMinMs,
        options.detailWarmupMaxMs
      );
      if (warmupMs > 0) {
        await page.waitForTimeout(warmupMs);
      }
      const detection = await detectSmokingpipesVerification(
        page,
        {
          pageKind: "detail",
          httpStatus: response?.status() || 0,
        }
      );
      let detail = null;
      if (
        detection.verificationBlocked &&
        options.allowManualVerification
      ) {
        if (!verificationState.verificationDetected) {
          verificationState.verificationDetected = true;
          verificationState.notification =
            await onVerificationDetected({
              candidate,
              detection,
              page,
            });
        }
        const recovery =
          await waitForSmokingpipesManualRecovery(page, {
            pageKind: "detail",
            timeoutMs:
              options.manualVerificationTimeoutMs,
            verbose: options.verbose,
            restoreTargetPage: async (targetPage) => {
              await targetPage.goto(candidate.sourceUrl, {
                waitUntil: "domcontentloaded",
                timeout: 60000,
              });
            },
            verifyNormalContent: async (targetPage) => {
              const parsed = addParsedMeasurements(
                await extractDetailProduct(
                  targetPage,
                  candidate,
                  "new"
                )
              );
              return {
                valid: isNormalSmokingpipesDetail(
                  parsed,
                  candidate.sourceProductId
                ),
                parsedValue: parsed,
              };
            },
          });
        if (recovery.recovered) {
          verificationState.manualVerificationRecovered = true;
          detail = recovery.parsedValue;
        }
      }
      if (
        detection.verificationBlocked &&
        !options.allowManualVerification &&
        !verificationState.verificationDetected
      ) {
        verificationState.verificationDetected = true;
        verificationState.notification =
          await onVerificationDetected({
            candidate,
            detection,
            page,
          });
      }
      if (detection.verificationBlocked && !detail) {
        throw Object.assign(
          new Error(
            `strong verification at ${candidate.sourceProductId}`
          ),
          { code: "CAPTCHA_REQUIRED" }
        );
      }
      detail ||=
        addParsedMeasurements(
          await extractDetailProduct(
            page,
            candidate,
            "new"
          )
        );
      if (
        !isNormalSmokingpipesDetail(
          detail,
          candidate.sourceProductId
        )
      ) {
        throw new Error(
          `detail parse failed for ${candidate.sourceProductId}`
        );
      }
      const conversion = convertSmokingpipesCandidateDetails(
        [detail],
        [
          {
            sourceProductId: candidate.sourceProductId,
            sourceUrl: candidate.sourceUrl,
            title: candidate.listTitle,
            price: candidate.listPrice,
            imageUrl: candidate.listPrimaryImage,
          },
        ]
      );
      const convertedProduct = conversion.products[0];
      if (!convertedProduct || conversion.failures.length) {
        return {
          detail,
          convertedProduct: null,
          publicReady: false,
          reviewOnly: true,
        };
      }
      return {
        detail,
        convertedProduct,
        publicReady:
          convertedProduct.publication
            ?.publicIndexEligible === true &&
          convertedProduct.publication
            ?.publiclySellable === true,
      };
    },
    close: () => session.close(),
  };
}

async function writePublicCandidate(
  paths,
  publicPayloads
) {
  await writeJsonAtomic(
    path.join(paths.progressivePublicNextRoot, "catalog.json"),
    publicPayloads.catalog
  );
  await writeJsonAtomic(
    path.join(paths.progressivePublicNextRoot, "filters.json"),
    publicPayloads.filters
  );
  await writeJsonAtomic(
    path.join(paths.progressivePublicNextRoot, "brands.json"),
    publicPayloads.brands
  );
  await writeJsonAtomic(
    path.join(paths.progressivePublicNextRoot, "recent-new.json"),
    publicPayloads.recentNew
  );
  await writeJsonAtomic(
    path.join(paths.progressivePublicNextRoot, "detail-lookup.json"),
    publicPayloads.lookup
  );
  await writeJsonAtomic(
    path.join(paths.progressivePublicNextRoot, "manifest.json"),
    publicPayloads.manifest
  );
  for (const shard of publicPayloads.detailShards || []) {
    await writeJsonAtomic(
      path.join(
        paths.progressivePublicNextRoot,
        "details",
        `${shard.shard}.json`
      ),
      shard.content
    );
  }
}

function publicNextFile(paths, name) {
  return path.join(paths.progressivePublicNextRoot, name);
}

function productionPublicFile(paths, name) {
  return path.join(paths.productionPublicRoot, name);
}

function readRequiredJson(filePath, blockers) {
  if (!fs.existsSync(filePath)) {
    blockers.push(`missing required file: ${filePath}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    blockers.push(
      `invalid JSON in ${filePath}: ${error.message}`
    );
    return null;
  }
}

function readProgressivePublicNext(paths) {
  const blockers = [];
  const payloads = {
    catalog: readRequiredJson(
      publicNextFile(paths, "catalog.json"),
      blockers
    ),
    filters: readRequiredJson(
      publicNextFile(paths, "filters.json"),
      blockers
    ),
    brands: readRequiredJson(
      publicNextFile(paths, "brands.json"),
      blockers
    ),
    recentNew: readRequiredJson(
      publicNextFile(paths, "recent-new.json"),
      blockers
    ),
    lookup: readRequiredJson(
      publicNextFile(paths, "detail-lookup.json"),
      blockers
    ),
    manifest: readRequiredJson(
      publicNextFile(paths, "manifest.json"),
      blockers
    ),
    detailShards: [],
  };
  const detailsDir = path.join(
    paths.progressivePublicNextRoot,
    "details"
  );
  if (fs.existsSync(detailsDir)) {
    for (const entry of fs
      .readdirSync(detailsDir)
      .filter((name) => name.endsWith(".json"))
      .sort()) {
      const content = readRequiredJson(
        path.join(detailsDir, entry),
        blockers
      );
      if (content) {
        payloads.detailShards.push({
          shard: entry.replace(/\.json$/i, ""),
          content,
        });
      }
    }
  }
  return { payloads, blockers };
}

export function progressiveMaxAutoApplyFromEnv(env = process.env) {
  const parsed = Number.parseInt(
    String(env.YANDOUBUY_SMOKINGPIPES_MAX_AUTO_APPLY || ""),
    10
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300;
}

function stateIsManualReconcile(state) {
  return /^manual-reconcile/i.test(text(state?.dailyRunId));
}

export function evaluateProgressiveProductionApplyGate({
  state,
  audit,
  preview,
  candidateProducts,
  publicPayloads,
  maxAutoApply = progressiveMaxAutoApplyFromEnv(),
}) {
  const blockers = [];
  const stateDailyRunId = text(state?.dailyRunId);
  const stateManualReconcileBlocked =
    stateIsManualReconcile(state);
  if (stateManualReconcileBlocked) {
    blockers.push(
      `progressive state dailyRunId ${stateDailyRunId} comes from manual-reconcile and cannot be used by automatic daily apply`
    );
  }
  const auditStatus = audit?.verdict || audit?.status;
  if (auditStatus !== "PASS") {
    blockers.push(`auditStatus=${auditStatus || "missing"}`);
  }
  if ((audit?.blockers || []).length) {
    blockers.push(...audit.blockers);
  }
  for (const key of [
    "deletedProducts",
    "pendingLeak",
    "failedLeak",
    "blockedLeak",
    "reviewOnlyLeak",
    "zeroPriceSellable",
  ]) {
    const value = Number(audit?.counts?.[key] || 0);
    if (value !== 0) blockers.push(`${key}=${value}`);
  }
  const candidateCount = Number(
    audit?.candidateCount ??
      preview?.candidateCount ??
      preview?.wouldApplyCount ??
      0
  );
  const previewWouldApplyCount = Number(preview?.wouldApplyCount || 0);
  const auditWouldApplyCount = Number(
    audit?.wouldApplyCount ?? previewWouldApplyCount
  );
  const previewCandidateCount = Number(
    preview?.candidateCount ?? candidateCount
  );
  const wouldApplyCount = previewWouldApplyCount;
  if (!(candidateCount > 0)) {
    blockers.push("candidateCount must be greater than 0");
  }
  if (!(previewWouldApplyCount > 0)) {
    blockers.push("preview wouldApplyCount must be greater than 0");
  }
  if (previewWouldApplyCount > maxAutoApply) {
    blockers.push(
      `wouldApplyCount ${previewWouldApplyCount} exceeds max auto apply ${maxAutoApply}`
    );
  }
  const applyGap = audit?.applyGap || null;
  const gapCount = Number(applyGap?.gapCount || 0);
  const unknownGapCount = Number(
    applyGap?.unknownGapCount ??
      applyGap?.gapClassifications?.other ??
      0
  );
  const readyUnexpectedlyExcludedCount = Number(
    applyGap?.readyUnexpectedlyExcludedCount ??
      applyGap?.gapClassifications
        ?.readyUnexpectedlyExcluded ??
      0
  );
  const safeGap =
    gapCount > 0 &&
    applyGap?.safeToApplyWouldApplySubset === true &&
    unknownGapCount === 0 &&
    readyUnexpectedlyExcludedCount === 0;
  if (candidateCount !== wouldApplyCount) {
    if (!safeGap) {
      blockers.push(
        `candidateCount ${candidateCount} does not match wouldApplyCount ${wouldApplyCount}`
      );
    }
  }
  if (gapCount > 0 && unknownGapCount > 0) {
    blockers.push(`unknown gap candidates=${unknownGapCount}`);
  }
  if (gapCount > 0 && readyUnexpectedlyExcludedCount > 0) {
    blockers.push(
      `ready candidate unexpectedly excluded=${readyUnexpectedlyExcludedCount}`
    );
  }
  if (
    gapCount > 0 &&
    applyGap?.safeToApplyWouldApplySubset !== true &&
    unknownGapCount === 0 &&
    readyUnexpectedlyExcludedCount === 0
  ) {
    blockers.push("apply gap is not approved for safe subset apply");
  }
  if (auditWouldApplyCount !== previewWouldApplyCount) {
    blockers.push(
      `audit wouldApplyCount ${auditWouldApplyCount} does not match preview wouldApplyCount ${previewWouldApplyCount}`
    );
  }
  if (candidateCount !== previewCandidateCount) {
    blockers.push(
      `audit candidateCount ${candidateCount} does not match preview candidateCount ${previewCandidateCount}`
    );
  }
  if (preview?.status !== "preview-ready") {
    blockers.push(
      `preview status is ${preview?.status || "missing"}`
    );
  }
  if (preview?.productionWritten !== false) {
    blockers.push("preview productionWritten must be false");
  }
  if (!Array.isArray(candidateProducts) || !candidateProducts.length) {
    blockers.push("candidate products are missing or empty");
  }
  for (const [name, payload] of Object.entries(
    publicPayloads || {}
  )) {
    if (name === "detailShards") continue;
    if (!payload) blockers.push(`public next ${name} is missing`);
  }
  return {
    status: blockers.length ? "apply-blocked" : "apply-ready",
    blockers: [...new Set(blockers)],
    blockedReason: [...new Set(blockers)].join("; ") || null,
    applyReady: blockers.length === 0,
    candidateCount,
    wouldApplyCount,
    safeSubsetApply: safeGap && blockers.length === 0,
    isolatedCandidateCount: gapCount,
    applyGap,
    maxAutoApply,
    stateDailyRunId,
    stateManualReconcileBlocked,
    auditGeneratedAt: audit?.generatedAt || null,
    previewGeneratedAt: preview?.generatedAt || null,
    productionWritten: false,
    commitPerformed: false,
    pushPerformed: false,
  };
}

export function buildSafeSubsetProductionProducts({
  productionProducts = [],
  candidateProducts = [],
  wouldApplyProductIds = [],
}) {
  const allowedIds = new Set(
    wouldApplyProductIds.map(String).filter(Boolean)
  );
  const productionById = new Map(
    productionProducts.map((item) => [
      sourceProductId(item),
      item,
    ])
  );
  const candidateById = new Map(
    candidateProducts.map((item) => [
      sourceProductId(item),
      item,
    ])
  );
  for (const id of allowedIds) {
    if (!candidateById.has(id)) {
      throw new Error(
        `safe subset candidate product is missing: ${id}`
      );
    }
  }
  const emitted = new Set();
  const merged = candidateProducts
    .map((candidate) => {
      const id = sourceProductId(candidate);
      const production = productionById.get(id);
      if (allowedIds.has(id)) {
        emitted.add(id);
        return candidate;
      }
      if (production) {
        emitted.add(id);
        return production;
      }
      return null;
    })
    .filter(Boolean);
  for (const production of productionProducts) {
    const id = sourceProductId(production);
    if (!emitted.has(id)) {
      merged.push(production);
      emitted.add(id);
    }
  }
  return merged;
}


function textValue(value) {
  return String(value ?? "").trim();
}

function relativeToRoot(root, filePath) {
  return path.relative(root, filePath).replaceAll("\\", "/");
}

function countByValue(rows, getter) {
  const counts = {};
  for (const row of rows || []) {
    const key = textValue(getter(row)) || "(empty)";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function duplicateValues(rows, getter) {
  const seen = new Set();
  const duplicates = new Set();
  for (const row of rows || []) {
    const value = textValue(getter(row));
    if (!value) continue;
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function backupFileIfExists({ root, backupDir, sourcePath, targetRelativePath }) {
  if (!fs.existsSync(sourcePath)) return null;
  const targetPath = path.join(backupDir, targetRelativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  return relativeToRoot(root, targetPath);
}

function backupDirectoryIfExists({ root, backupDir, sourcePath, targetRelativePath }) {
  if (!fs.existsSync(sourcePath)) return null;
  const targetPath = path.join(backupDir, targetRelativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.cpSync(sourcePath, targetPath, { recursive: true });
  return relativeToRoot(root, targetPath);
}


function assertMockProductionPathsAreIsolated(paths, options) {
  if (!options?.mock) return;

  const mockRoot = path.resolve(
    paths.root,
    ".cache",
    "inventory-v1",
    "mock"
  );
  const checkedPaths = {
    existingProducts: paths.existingProducts,
    unifiedProductsStaging: paths.unifiedProductsStaging,
    backupRoot: paths.backupRoot,
    productionPublicRoot: paths.productionPublicRoot,
  };

  const unsafe = Object.entries(checkedPaths)
    .filter(([, value]) => value)
    .filter(([, value]) => {
      const resolved = path.resolve(value);
      return resolved !== mockRoot && !resolved.startsWith(mockRoot + path.sep);
    })
    .map(([key, value]) => `${key}: ${value}`);

  if (unsafe.length) {
    throw Object.assign(
      new Error(
        `Mock production write paths are not isolated under .cache: ${unsafe.join("; ")}`
      ),
      {
        code: "MOCK_PRODUCTION_PATH_NOT_ISOLATED",
        unsafePaths: unsafe,
      }
    );
  }
}
function createProgressiveProductionBackup(paths) {
  const backupDir = path.join(
    paths.backupRoot || path.join(paths.root, "data", "backups"),
    `smokingpipes-progressive-production-apply-${formatRunId()}`
  );

  const files = [
    backupFileIfExists({
      root: paths.root,
      backupDir,
      sourcePath: paths.existingProducts,
      targetRelativePath: path.join(
        "data",
        "products",
        "smokingpipes-products.before.json"
      ),
    }),
    backupFileIfExists({
      root: paths.root,
      backupDir,
      sourcePath: paths.unifiedProductsStaging,
      targetRelativePath: path.join(
        "data",
        "products",
        "unified-products-staging.before.json"
      ),
    }),
    backupDirectoryIfExists({
      root: paths.root,
      backupDir,
      sourcePath: paths.productionPublicRoot,
      targetRelativePath: path.join(
        "data",
        "generated",
        "public-products.before"
      ),
    }),
  ].filter(Boolean);

  return {
    backupDir: relativeToRoot(paths.root, backupDir),
    files,
  };
}

function summarizeSmokingpipesProducts(products) {
  return {
    total: (products || []).length,
    inventoryStatus: countByValue(
      products,
      (product) => product.inventoryStatus || product.inventory?.status
    ),
    duplicateIds: duplicateValues(products, (product) => product.id),
    duplicateSourceProductIds: duplicateValues(products, sourceProductId),
    duplicateSourceUrls: duplicateValues(
      products,
      (product) => product.sourceUrl
    ),
  };
}

function summarizePublicPayloads(publicPayloads) {
  const catalog = items(publicPayloads?.catalog);
  return {
    total: catalog.length,
    bySource: countByValue(catalog, (product) => product.source),
    byInventoryStatus: countByValue(
      catalog,
      (product) => product.inventoryStatus || product.inventory?.status
    ),
    duplicateIds: duplicateValues(catalog, (product) => product.id),
    duplicateSourceProductKeys: duplicateValues(
      catalog,
      (product) => `${product.source || ""}:${sourceProductId(product)}`
    ),
  };
}

function validateProgressiveProductionWrite({
  productionBefore = [],
  productionAfter = [],
  publicPayloads = {},
  preview = {},
}) {
  const blockers = [];
  const warnings = [];
  const productionBeforeSummary =
    summarizeSmokingpipesProducts(productionBefore);
  const productionAfterSummary =
    summarizeSmokingpipesProducts(productionAfter);
  const publicCatalog = summarizePublicPayloads(publicPayloads);
  const appliedIds = [
    ...new Set((preview.wouldApplyProductIds || []).map(String).filter(Boolean)),
  ].sort();

  const publicSmokingpipesIds = new Set(
    items(publicPayloads.catalog)
      .filter((product) => product.source === "smokingpipes")
      .map(sourceProductId)
      .filter(Boolean)
  );
  const appliedIdsMissingFromPublicCatalog = appliedIds.filter(
    (id) => !publicSmokingpipesIds.has(id)
  );

  if (productionAfterSummary.total <= 0) {
    blockers.push("productionAfter is empty");
  }
  if (productionAfterSummary.duplicateIds.length) {
    blockers.push(
      `duplicate production ids: ${productionAfterSummary.duplicateIds
        .slice(0, 10)
        .join(", ")}`
    );
  }
  if (productionAfterSummary.duplicateSourceProductIds.length) {
    blockers.push(
      `duplicate production sourceProductIds: ${productionAfterSummary.duplicateSourceProductIds
        .slice(0, 10)
        .join(", ")}`
    );
  }
  if (productionAfterSummary.duplicateSourceUrls.length) {
    blockers.push(
      `duplicate production sourceUrls: ${productionAfterSummary.duplicateSourceUrls
        .slice(0, 10)
        .join(", ")}`
    );
  }
  if (publicCatalog.total <= 0) {
    blockers.push("public catalog is empty");
  }
  if (publicCatalog.duplicateIds.length) {
    blockers.push(
      `duplicate public ids: ${publicCatalog.duplicateIds
        .slice(0, 10)
        .join(", ")}`
    );
  }
  if (publicCatalog.duplicateSourceProductKeys.length) {
    blockers.push(
      `duplicate public sourceProduct keys: ${publicCatalog.duplicateSourceProductKeys
        .slice(0, 10)
        .join(", ")}`
    );
  }

  const manifestPublicCount = Number(
    publicPayloads?.manifest?.publicProductCount
  );
  if (
    Number.isFinite(manifestPublicCount) &&
    manifestPublicCount !== publicCatalog.total
  ) {
    blockers.push(
      `manifest publicProductCount ${manifestPublicCount} does not match catalog ${publicCatalog.total}`
    );
  }

  if (appliedIdsMissingFromPublicCatalog.length) {
    warnings.push(
      `${appliedIdsMissingFromPublicCatalog.length} applied ids are not present in public catalog`
    );
  }

  return {
    status: blockers.length ? "failed" : "passed",
    blockers,
    warnings,
    productionBefore: productionBeforeSummary,
    productionAfter: productionAfterSummary,
    publicCatalog,
    appliedIds,
    appliedIdsMissingFromPublicCatalog,
  };
}
async function writeProductionPublicCandidate(
  paths,
  publicPayloads
) {
  await writeJsonAtomic(
    productionPublicFile(paths, "catalog.json"),
    publicPayloads.catalog
  );
  await writeJsonAtomic(
    productionPublicFile(paths, "filters.json"),
    publicPayloads.filters
  );
  await writeJsonAtomic(
    productionPublicFile(paths, "brands.json"),
    publicPayloads.brands
  );
  await writeJsonAtomic(
    productionPublicFile(paths, "recent-new.json"),
    publicPayloads.recentNew
  );
  await writeJsonAtomic(
    productionPublicFile(paths, "detail-lookup.json"),
    publicPayloads.lookup
  );
  await writeJsonAtomic(
    productionPublicFile(paths, "manifest.json"),
    {
      ...(publicPayloads.manifest || {}),
      productionWritten: true,
      productionWrittenAt: new Date().toISOString(),
    }
  );
  for (const shard of publicPayloads.detailShards || []) {
    await writeJsonAtomic(
      path.join(
        paths.productionPublicRoot,
        "details",
        `${shard.shard}.json`
      ),
      shard.content
    );
  }
}

async function buildCandidateArtifacts({
  root,
  paths,
  state,
  options,
}) {
  const productionProducts = loadProduction(
    paths,
    options.mock
  );
  const danishProducts = options.mock
    ? []
    : items(readJsonIfExists(paths.danishProducts, []));
  const candidate = buildProgressivePartialProducts({
    productionProducts,
    state,
  });
  const unifiedRows = buildUnifiedProductsFromInputs({
    danishProducts,
    smokingpipesProducts: candidate.products,
  });
  const pricingContext =
    await loadPublicProductsPricingContext();
  const publicBase = buildPublicProductsFullCandidate(
    unifiedRows,
    pricingContext
  );
  const recentNewProducts = selectProgressiveRecentNew({
    catalog: publicBase.catalog.products,
    newProductIds: candidate.newProductIds,
  });
  const recentNew = {
    schemaVersion: 1,
    generatedAt: candidate.generatedAt,
    source: "smokingpipes",
    products: recentNewProducts,
  };
  const manifest = {
    schemaVersion: 1,
    generatorVersion:
      "smokingpipes-progressive-daily-v1",
    generatedAt: candidate.generatedAt,
    productionWritten: false,
    publicProductCount: publicBase.catalog.products.length,
    excludedProductCount: publicBase.excludedCount,
    brandCount: publicBase.brands.brands.length,
    detailCount: publicBase.details.length,
    detailShardCount: publicBase.detailShards.length,
    recentNewCount: recentNew.products.length,
  };
  const audit = auditProgressivePartialCandidate({
    productionProducts,
    candidateProducts: candidate.products,
    state,
    publicCatalog: publicBase.catalog.products,
    recentNew: recentNew.products,
  });
  audit.attemptedCandidateCount =
    candidate.attemptedCandidateIds.length;
  audit.candidateCount = audit.attemptedCandidateCount;
  audit.effectiveCandidateCount =
    candidate.appliedCandidateIds.length;
  const applyPreview = buildProgressivePartialApplyPreview({
    state,
    audit,
    productionProducts,
    candidateProducts: candidate.products,
  });
  audit.wouldApplyCount = applyPreview.wouldApplyCount || 0;
  audit.applyGap = diagnoseProgressiveApplyGap({
    state,
    productionProducts,
    candidateProducts: candidate.products,
    candidateIds: candidate.attemptedCandidateIds,
    wouldApplyProductIds:
      applyPreview.wouldApplyProductIds || [],
  });
  audit.isolatedCandidateCount = audit.applyGap.gapCount;
  await writeJsonAtomic(
    paths.progressiveProductsNext,
    candidate.products
  );
  await writePublicCandidate(paths, {
    ...publicBase,
    recentNew,
    manifest,
  });
  await writeJsonAtomic(paths.progressiveAuditJson, audit);
  await writeTextAtomic(
    paths.progressiveAuditMarkdown,
    auditMarkdown(audit)
  );
  return {
    candidate,
    audit,
    publicPayloads: {
      ...publicBase,
      recentNew,
      manifest,
    },
  };
}

async function prepareProgressiveApplyGate({
  root,
  paths,
  state,
  options,
}) {
  const normalized =
    normalizeProgressivePublicStatuses(state);
  let nextState = normalized.state;
  if (normalized.changed) {
    await writeProgressiveDailyState(
      paths.progressiveState,
      nextState
    );
  }
  const artifacts = await buildCandidateArtifacts({
    root,
    paths,
    state: nextState,
    options,
  });
  const productionProducts = loadProduction(
    paths,
    options.mock
  );
  const candidateProducts = artifacts.candidate.products || [];
  const preview = buildProgressivePartialApplyPreview({
    state: nextState,
    audit: artifacts.audit,
    productionProducts,
    candidateProducts,
  });
  await writeJsonAtomic(paths.progressiveApplyPreview, preview);
  const publicNext = readProgressivePublicNext(paths);
  const gate = evaluateProgressiveProductionApplyGate({
    state: nextState,
    audit: artifacts.audit,
    preview,
    candidateProducts,
    publicPayloads: publicNext.payloads,
    maxAutoApply: progressiveMaxAutoApplyFromEnv(),
  });
  gate.blockers.push(...publicNext.blockers);
  gate.blockers = [...new Set(gate.blockers)];
  gate.blockedReason = gate.blockers.join("; ") || null;
  gate.applyReady = gate.blockers.length === 0;
  gate.status = gate.applyReady ? "apply-ready" : "apply-blocked";
  const report = {
    version: "smokingpipes-progressive-apply-gate-report-v2",
    generatedAt: new Date().toISOString(),
    status: gate.status,
    applyReady: gate.applyReady,
    blockedReason: gate.blockedReason,
    blockers: gate.blockers,
    candidateCount: gate.candidateCount,
    wouldApplyCount: gate.wouldApplyCount,
    isolatedCandidateCount: gate.isolatedCandidateCount,
    safeSubsetApply: gate.safeSubsetApply,
    maxAutoApply: gate.maxAutoApply,
    stateDailyRunId: gate.stateDailyRunId,
    stateManualReconcileBlocked:
      gate.stateManualReconcileBlocked,
    auditGeneratedAt: gate.auditGeneratedAt,
    previewGeneratedAt: gate.previewGeneratedAt,
    auditPath: path.relative(root, paths.progressiveAuditJson),
    previewPath: path.relative(root, paths.progressiveApplyPreview),
    productionWritten: false,
    commitPerformed: false,
    pushPerformed: false,
  };
  await writeJsonAtomic(paths.progressiveApplyGateReport, report);
  return {
    state: nextState,
    artifacts,
    preview,
    gate,
    report,
  };
}

export async function runSmokingpipesProgressiveMode({
  root = process.cwd(),
  options,
}) {
  const paths = getRunnerPaths(root, {
    mock: options.mock,
  });
  const runId = formatRunId();
  let lock = null;
  let state = null;
  try {
    lock = acquireRunLock(
      paths.progressiveLock,
      {
        runId,
        source: "smokingpipes",
        mode: options.mode,
      },
      options.forceUnlock
    );
    const stateRead = readProgressiveDailyState(
      paths.progressiveState
    );
    if (stateRead.status === "blocked") {
      const result = {
        status: "blocked",
        blockedReason: stateRead.errors.join("; "),
        productionWritten: false,
      };
      await writeProgressiveReport(
        paths,
        makeReport({ mode: options.mode, state: null, result })
      );
      return result;
    }
    state = stateRead.state;

    if (options.mode === "progressive-ingest-list") {
      const currentListPath =
        options.currentListPath || paths.currentList;
      const diffPath = options.diffPath || paths.diff;
      let currentPayload;
      let diffPayload;
      try {
        currentPayload = readJsonIfExists(
          currentListPath,
          null
        );
        diffPayload = readJsonIfExists(diffPath, null);
      } catch (error) {
        const result = {
          status: "blocked",
          blockedReason: `progressive ingest input parse failed: ${error.message}`,
          browserStarted: false,
          productionWritten: false,
        };
        await writeProgressiveReport(
          paths,
          makeReport({
            mode: options.mode,
            state,
            result,
          })
        );
        return result;
      }
      if (!currentPayload || !diffPayload) {
        const missing = [
          !currentPayload ? currentListPath : null,
          !diffPayload ? diffPath : null,
        ].filter(Boolean);
        const result = {
          status: "blocked",
          blockedReason: `progressive ingest input missing: ${missing.join(", ")}`,
          browserStarted: false,
          productionWritten: false,
        };
        await writeProgressiveReport(
          paths,
          makeReport({
            mode: options.mode,
            state,
            result,
          })
        );
        return result;
      }
      state ||= createProgressiveDailyState({
        dailyRunId: runId,
        expectedPages: Number(
          currentPayload.summary?.expectedPages ||
            diffPayload.coverage?.expectedPages ||
            107
        ),
      });
      state = ingestProgressiveListSnapshot({
        state,
        currentPayload,
        diffPayload,
        productionProducts: loadProduction(paths, false),
        runId,
        currentListPath,
        diffPath,
      });
      await writeProgressiveDailyState(
        paths.progressiveState,
        state
      );
      const result = {
        status: "ingest-ready",
        browserStarted: false,
        detailsFetched: false,
        candidateGenerated: false,
        productionWritten: false,
      };
      await writeProgressiveReport(
        paths,
        makeReport({
          mode: options.mode,
          state,
          result,
        })
      );
      return result;
    }

    if (
      !state &&
      options.mode === "progressive-detail-chunk"
    ) {
      if (options.mock) {
        state = seedMockState(paths, runId);
      } else {
        const currentPayload = readJsonIfExists(
          paths.currentList,
          null
        );
        if (!currentPayload) {
          const result = {
            status: "blocked",
            blockedReason:
              "progressive state and current-list input are missing",
            productionWritten: false,
          };
          await writeProgressiveReport(
            paths,
            makeReport({
              mode: options.mode,
              state: null,
              result,
            })
          );
          return result;
        }
        state = ingestProgressiveListSnapshot({
          state: createProgressiveDailyState({
            dailyRunId: runId,
          }),
          currentPayload,
          productionProducts: loadProduction(paths, false),
          runId,
          currentListPath: paths.currentList,
          diffPath: paths.diff,
        });
      }
      await writeProgressiveDailyState(
        paths.progressiveState,
        state
      );
    }

    if (!state) {
      const result = {
        status: "blocked",
        blockedReason:
          "progressive state is required before this mode",
        productionWritten: false,
      };
      await writeProgressiveReport(
        paths,
        makeReport({ mode: options.mode, state: null, result })
      );
      return result;
    }

    if (options.mode === "progressive-apply-brand-exclusions") {
      const now = new Date().toISOString();
      const exclusion = applySmokingpipesBrandExclusions({
        state,
        productionProducts: loadProduction(paths, options.mock),
        publicProducts: loadProductionPublicProducts(
          paths,
          options.mock
        ),
        now,
      });
      state = refreshProgressiveSummary(exclusion.state, now);
      state.latestRun = {
        ...(state.latestRun || {}),
        runId,
        mode: options.mode,
        finishedAt: now,
        blockedReason: null,
        recommendedNextRunAt: null,
      };
      await writeProgressiveDailyState(
        paths.progressiveState,
        state
      );
      await writeBrandExclusionReport(
        paths,
        exclusion.report
      );
      const result = {
        status: "brand-exclusions-applied",
        browserStarted: false,
        detailsFetched: false,
        candidateGenerated: false,
        excludedBrandCount:
          exclusion.report.excludedBrandCount,
        excludedBrandBreakdown:
          exclusion.report.excludedBrandBreakdown,
        pendingBefore: exclusion.report.pendingBefore,
        pendingAfterBrandExclusion:
          exclusion.report.pendingAfterBrandExclusion,
        plannedHideProductionCount:
          exclusion.report.plannedHideProductionCount,
        plannedHidePublicCount:
          exclusion.report.plannedHidePublicCount,
        productionWritten: false,
      };
      await writeProgressiveReport(
        paths,
        makeReport({ mode: options.mode, state, result })
      );
      return result;
    }

    if (options.mode === "progressive-manual-detail-backfill") {
      const now = new Date().toISOString();
      const productionProducts = loadProduction(
        paths,
        options.mock
      );
      const publicProducts = loadProductionPublicProducts(
        paths,
        options.mock
      );
      const stateBeforeExclusion = state;
      const preflightExclusion =
        applySmokingpipesBrandExclusions({
          state,
          productionProducts,
          publicProducts,
          now,
        });
      state = refreshProgressiveSummary(
        preflightExclusion.state,
        now
      );
      await writeProgressiveDailyState(
        paths.progressiveState,
        state
      );
      await writeBrandExclusionReport(
        paths,
        preflightExclusion.report
      );

      const pendingForBackfill =
        selectProgressiveDetailCandidates({
          state,
          maxItems: 1,
          now,
        }).length;
      let processor = null;
      if (pendingForBackfill === 0) {
        processor = {
          browserStarted: false,
          verificationState: {
            verificationDetected: false,
            manualVerificationRecovered: false,
            notification: null,
          },
          async process() {
            throw new Error(
              "processDetail should not be called without pending candidates"
            );
          },
          async close() {},
        };
      } else if (options.mock) {
        const template = loadProduction(paths, true)[0] || {};
        processor = {
          browserStarted: false,
          verificationState: {
            verificationDetected: false,
            manualVerificationRecovered: false,
            notification: null,
          },
          async process(candidate, index) {
            if (
              options.mockVerification === "strong" &&
              index === 3
            ) {
              throw Object.assign(
                new Error("strong verification"),
                { code: "CAPTCHA_REQUIRED" }
              );
            }
            const convertedProduct = mockConvertedProduct(
              template,
              candidate
            );
            return {
              detail: {
                sourceProductId:
                  candidate.sourceProductId,
                fullTitle: candidate.listTitle,
              },
              convertedProduct,
              publicReady: true,
            };
          },
          async close() {},
        };
      } else {
        processor = await createRealDetailProcessor({
          root,
          paths,
          options,
          runId,
          mode: options.mode,
          onVerificationDetected: async ({ candidate }) => {
            const message =
              buildSmokingpipesManualBackfillVerificationMessage({
                sourceProductId:
                  candidate.sourceProductId,
                sourceUrl: candidate.sourceUrl,
              });
            return sendPushDeerNotification({
              title: message.title,
              body: message.body,
              dryRun: false,
            });
          },
        });
      }

      let backfill;
      try {
        backfill =
          await runSmokingpipesManualDetailBackfill({
            state: stateBeforeExclusion,
            productionProducts,
            publicProducts,
            batchLimit: options.manualDetailLimit,
            untilEmpty: options.manualDetailUntilEmpty,
            cooldownMs: options.manualDetailCooldownMs,
            maxTotal: options.manualDetailMaxTotal,
            runId,
            processDetail: processor.process,
            checkpoint: (checkpointState) =>
              writeProgressiveDailyState(
                paths.progressiveState,
                refreshProgressiveSummary(
                  checkpointState,
                  new Date().toISOString()
                )
              ),
            wait: (ms) =>
              new Promise((resolve) => setTimeout(resolve, ms)),
            smokingpipesAccessed:
              !options.mock && pendingForBackfill > 0,
            manualVerificationRecovered:
              processor.verificationState
                ?.manualVerificationRecovered === true,
          });
      } finally {
        await processor.close();
      }
      backfill.report.manualVerificationRecovered =
        processor.verificationState
          ?.manualVerificationRecovered === true;
      backfill.report.verificationNotification =
        processor.verificationState?.notification || null;
      state = refreshProgressiveSummary(
        backfill.state,
        new Date().toISOString()
      );
      await writeProgressiveDailyState(
        paths.progressiveState,
        state
      );
      await writeBrandExclusionReport(
        paths,
        backfill.exclusionReport
      );
      await writeJsonAtomic(
        paths.progressiveManualBackfillReportJson,
        backfill.report
      );
      await writeTextAtomic(
        paths.progressiveManualBackfillReportMarkdown,
        smokingpipesManualBackfillMarkdown(backfill.report)
      );
      const result = {
        ...backfill.report,
        status: backfill.report.status,
        browserStarted: processor.browserStarted === true,
        completedThisRun: backfill.report.completed,
        blockedReason: backfill.report.blockedReason,
        recommendedNextRunAt:
          state.latestRun?.recommendedNextRunAt || null,
        productionWritten: false,
      };
      await writeProgressiveReport(
        paths,
        makeReport({ mode: options.mode, state, result })
      );
      return result;
    }

    if (options.mode === "progressive-detail-chunk") {
      const now = new Date().toISOString();
      const exclusion = applySmokingpipesBrandExclusions({
        state,
        productionProducts: loadProduction(paths, options.mock),
        publicProducts: loadProductionPublicProducts(
          paths,
          options.mock
        ),
        now,
      });
      state = refreshProgressiveSummary(exclusion.state, now);
      await writeProgressiveDailyState(
        paths.progressiveState,
        state
      );
      await writeBrandExclusionReport(
        paths,
        exclusion.report
      );
      const pendingForChunk =
        selectProgressiveDetailCandidates({
          state,
          maxItems: 1,
          now,
        }).length;
      if (pendingForChunk === 0) {
        const result = {
          status: "no-eligible-candidates",
          browserStarted: false,
          selected: 0,
          completedThisRun: 0,
          failedThisRun: 0,
          blockedReason: null,
          recommendedNextRunAt: null,
          excludedBrandCount:
            exclusion.report.excludedBrandCount,
          pendingBefore: exclusion.report.pendingBefore,
          pendingAfterBrandExclusion:
            exclusion.report.pendingAfterBrandExclusion,
          productionWritten: false,
        };
        await writeProgressiveReport(
          paths,
          makeReport({ mode: options.mode, state, result })
        );
        return result;
      }
      let processor = null;
      if (options.mock) {
        const template =
          loadProduction(paths, true)[0] || {};
        processor = {
          browserStarted: false,
          async process(candidate, index) {
            if (
              options.mockVerification === "strong" &&
              index === 3
            ) {
              throw Object.assign(
                new Error("strong verification"),
                { code: "CAPTCHA_REQUIRED" }
              );
            }
            const convertedProduct = mockConvertedProduct(
              template,
              candidate
            );
            return {
              detail: {
                sourceProductId:
                  candidate.sourceProductId,
                fullTitle: candidate.listTitle,
              },
              convertedProduct,
              publicReady: true,
            };
          },
          async close() {},
        };
      } else {
        processor = await createRealDetailProcessor({
          root,
          paths,
          options,
          runId,
        });
      }
      let result;
      try {
        result = await runProgressiveDetailChunk({
          state,
          maxItems: options.progressiveDetailMax,
          runId,
          processDetail: processor.process,
          checkpoint: (checkpointState) =>
            writeProgressiveDailyState(
              paths.progressiveState,
              checkpointState
            ),
        });
      } finally {
        await processor.close();
      }
      result.browserStarted = processor.browserStarted === true;
      state = result.state;
      await writeProgressiveDailyState(
        paths.progressiveState,
        state
      );
      await writeProgressiveReport(
        paths,
        makeReport({ mode: options.mode, state, result })
      );
      return result;
    }

    if (options.mode === "progressive-build-candidate") {
      const normalized =
        normalizeProgressivePublicStatuses(state);
      state = normalized.state;
      if (normalized.changed) {
        await writeProgressiveDailyState(
          paths.progressiveState,
          state
        );
      }
      const artifacts = await buildCandidateArtifacts({
        root,
        paths,
        state,
        options,
      });
      const result = {
        status:
          artifacts.audit.verdict === "PASS"
            ? "candidate-ready"
            : "blocked",
        audit: artifacts.audit,
        candidateCount:
          artifacts.candidate.attemptedCandidateIds.length,
        wouldApplyCount:
          artifacts.candidate.appliedCandidateIds.length,
        isolatedCandidateCount:
          artifacts.audit.isolatedCandidateCount || 0,
        productionWritten: false,
      };
      await writeProgressiveReport(
        paths,
        makeReport({ mode: options.mode, state, result })
      );
      return result;
    }

    if (options.mode === "progressive-prepare-apply") {
      const prepared = await prepareProgressiveApplyGate({
        root,
        paths,
        state,
        options,
      });
      state = prepared.state;
      const result = {
        ...prepared.report,
        audit: prepared.artifacts.audit,
        preview: prepared.preview,
      };
      await writeProgressiveReport(
        paths,
        makeReport({ mode: options.mode, state, result })
      );
      return result;
    }

    let audit = readJsonIfExists(paths.progressiveAuditJson, null);
    let candidateProducts = items(
      readJsonIfExists(paths.progressiveProductsNext, [])
    );
    const productionProducts = loadProduction(
      paths,
      options.mock
    );
    const preview = buildProgressivePartialApplyPreview({
      state,
      audit,
      productionProducts,
      candidateProducts,
    });
    if (options.writeProduction) {
      assertMockProductionPathsAreIsolated(paths, options);
      const prepared = await prepareProgressiveApplyGate({
        root,
        paths,
        state,
        options,
      });
      state = prepared.state;
      audit = prepared.artifacts.audit;
      candidateProducts = prepared.artifacts.candidate.products || [];
      const freshPreview = prepared.preview;
      const gate = prepared.gate;
      const publicNext = readProgressivePublicNext(paths);
      gate.blockers.push(...publicNext.blockers);
      gate.blockers = [...new Set(gate.blockers)];
      gate.blockedReason = gate.blockers.join("; ") || null;
      gate.applyReady = gate.blockers.length === 0;
      gate.status = gate.applyReady ? "apply-ready" : "apply-blocked";
      if (gate.blockers.length) {
        const blocked = {
          version:
            "smokingpipes-progressive-partial-apply-preview-v1",
          generatedAt: new Date().toISOString(),
          status: "apply-blocked",
          candidateCount: gate.candidateCount,
          wouldApplyCount: gate.wouldApplyCount,
          blockers: gate.blockers,
          blockedReason: gate.blockedReason,
          wouldApplyProductIds:
            freshPreview.wouldApplyProductIds || [],
          applyGap: gate.applyGap,
          isolatedCandidateCount:
            gate.isolatedCandidateCount,
          safeSubsetApply: gate.safeSubsetApply,
          maxAutoApply: gate.maxAutoApply,
          stateDailyRunId: gate.stateDailyRunId,
          stateManualReconcileBlocked:
            gate.stateManualReconcileBlocked,
          auditGeneratedAt: gate.auditGeneratedAt,
          previewGeneratedAt: gate.previewGeneratedAt,
          productionWritten: false,
          commitPerformed: false,
          pushPerformed: false,
        };
        await writeJsonAtomic(
          paths.progressiveApplyPreview,
          blocked
        );
        await writeProgressiveReport(
          paths,
          makeReport({
            mode: options.mode,
            state,
            result: blocked,
          })
        );
        return blocked;
      }
      if (gate.safeSubsetApply && options.verbose) {
        console.log(
          "APPLY gate: candidateCount differs from wouldApplyCount, but gap candidates are safely excluded"
        );
        console.log(
          `APPLY safe subset: ${gate.wouldApplyCount}/${gate.candidateCount}`
        );
        console.log(
          `NON-APPLY candidates retained for review: ${gate.isolatedCandidateCount}`
        );
      }
      const productionSafeSubset =
        buildSafeSubsetProductionProducts({
          productionProducts,
          candidateProducts,
          wouldApplyProductIds:
            freshPreview.wouldApplyProductIds || [],
        });
      const danishProducts = options.mock
        ? []
        : items(readJsonIfExists(paths.danishProducts, []));
      const unifiedRows = buildUnifiedProductsFromInputs({
        danishProducts,
        smokingpipesProducts: productionSafeSubset,
      });
      const postApplyValidation = validateProgressiveProductionWrite({
        productionBefore: productionProducts,
        productionAfter: productionSafeSubset,
        publicPayloads: publicNext.payloads,
        preview: freshPreview,
      });
      if (postApplyValidation.blockers.length) {
        const blocked = {
          version:
            "smokingpipes-progressive-partial-apply-preview-v1",
          generatedAt: new Date().toISOString(),
          status: "apply-blocked",
          candidateCount: gate.candidateCount,
          wouldApplyCount: gate.wouldApplyCount,
          blockers: postApplyValidation.blockers,
          blockedReason: postApplyValidation.blockers.join("; "),
          warnings: postApplyValidation.warnings,
          wouldApplyProductIds:
            freshPreview.wouldApplyProductIds || [],
          applyGap: gate.applyGap,
          isolatedCandidateCount:
            gate.isolatedCandidateCount,
          postApplyValidation,
          productionWritten: false,
          commitPerformed: false,
          pushPerformed: false,
        };
        await writeJsonAtomic(
          paths.progressiveApplyPreview,
          blocked
        );
        await writeProgressiveReport(
          paths,
          makeReport({
            mode: options.mode,
            state,
            result: blocked,
          })
        );
        return blocked;
      }
      const backup = createProgressiveProductionBackup(paths);
      await writeJsonAtomic(
        paths.existingProducts,
        productionSafeSubset
      );
      await writeJsonAtomic(
        paths.unifiedProductsStaging,
        unifiedRows
      );
      await writeProductionPublicCandidate(
        paths,
        publicNext.payloads
      );
      const completed = {
        version:
          "smokingpipes-progressive-partial-apply-preview-v1",
        generatedAt: new Date().toISOString(),
        status: "apply-complete",
        candidateCount: gate.candidateCount,
        wouldApplyCount: gate.wouldApplyCount,
        partialAppliedCount: gate.wouldApplyCount,
        appliedCount: gate.wouldApplyCount,
        wouldApplyProductIds: freshPreview.wouldApplyProductIds,
        safeSubsetApply: gate.safeSubsetApply,
        isolatedCandidateCount:
          gate.isolatedCandidateCount,
        applyGap: gate.applyGap,
        productionWritten: true,
        publicCatalogWritten: true,
        unifiedProductsStagingWritten: true,
        backup,
        postApplyValidation,
        productionBeforeCount: productionProducts.length,
        productionAfterCount: productionSafeSubset.length,
        publicCatalogAfterCount: postApplyValidation.publicCatalog.total,
        commitPerformed: false,
        pushPerformed: false,
      };
      await writeJsonAtomic(
        paths.progressiveApplyPreview,
        completed
      );
      await writeProgressiveReport(
        paths,
        makeReport({
          mode: options.mode,
          state,
          result: completed,
        })
      );
      return completed;
    }
    await writeJsonAtomic(
      paths.progressiveApplyPreview,
      preview
    );
    await writeProgressiveReport(
      paths,
      makeReport({
        mode: options.mode,
        state,
        result: preview,
      })
    );
    return preview;
  } finally {
    if (lock && fs.existsSync(paths.progressiveLock)) {
      releaseRunLock(lock);
    }
  }
}
