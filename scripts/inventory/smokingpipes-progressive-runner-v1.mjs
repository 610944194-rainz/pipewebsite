import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
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
  buildSmokingpipesActionableApplyPlan,
  createSmokingpipesCatchupPlan,
  markSmokingpipesActionEventsApplied,
  SMOKINGPIPES_CATCHUP_BATCH_LIMIT,
  selectSmokingpipesCatchupBatch,
  stableProductHash,
} from "./smokingpipes-actionable-events-v1.mjs";
import {
  sendPushDeerNotification,
} from "./inventory-pushdeer-notifier-v1.mjs";
import {
  randomDelayMs,
} from "./smokingpipes-fetch-current-list-v1.mjs";
import {
  updateLegacyDuplicateOverrideAudit,
} from "./smokingpipes-diff-inventory-v1.mjs";

export const LARGE_APPLY_WARNING_THRESHOLD = 300;
export const DEFAULT_MAX_AUTO_APPLY = 2000;
export const EFFECTIVE_APPLY_SCHEMA_VERSION = "smokingpipes-effective-apply-v2";
export const EFFECTIVE_APPLY_GENERATOR_MODULE =
  "scripts/inventory/smokingpipes-progressive-runner-v1.mjs";

function resolveCodeCommitSha(root) {
  for (const directory of [root, process.cwd()]) {
    try {
      const sha = execFileSync("git", ["-C", directory, "rev-parse", "HEAD"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (/^[0-9a-f]{40}$/i.test(sha)) return sha;
    } catch {
      // Test fixtures can use a temporary root outside the repository.
    }
  }
  return "unknown";
}

function stampEffectiveApplyArtifact(artifact, { root, runId }) {
  return Object.assign(artifact, {
    schemaVersion: EFFECTIVE_APPLY_SCHEMA_VERSION,
    codeCommitSha: resolveCodeCommitSha(root),
    generatorModule: EFFECTIVE_APPLY_GENERATOR_MODULE,
    runId,
    generatedAt: new Date().toISOString(),
  });
}

export function validateEffectiveApplyArtifacts({
  preview,
  gateReport,
  runId,
  codeCommitSha,
  invocationStartedAt = null,
} = {}) {
  const blockers = [];
  const expectedCommit = text(codeCommitSha);
  const minimumGeneratedAt = Date.parse(invocationStartedAt || "");
  for (const [label, artifact] of [
    ["apply preview", preview],
    ["apply gate", gateReport],
  ]) {
    if (!artifact || typeof artifact !== "object") {
      blockers.push(`${label} is missing`);
      continue;
    }
    if (artifact.schemaVersion !== EFFECTIVE_APPLY_SCHEMA_VERSION) {
      blockers.push(`${label}.schemaVersion is incompatible`);
    }
    if (text(artifact.codeCommitSha) !== expectedCommit) {
      blockers.push(`${label}.codeCommitSha does not match current HEAD`);
    }
    if (text(artifact.generatorModule) !== EFFECTIVE_APPLY_GENERATOR_MODULE) {
      blockers.push(`${label}.generatorModule is incompatible`);
    }
    if (text(artifact.runId) !== text(runId)) {
      blockers.push(`${label}.runId does not match current run`);
    }
    const generatedAt = Date.parse(artifact.generatedAt || "");
    if (!Number.isFinite(generatedAt)) {
      blockers.push(`${label}.generatedAt is invalid`);
    } else if (
      Number.isFinite(minimumGeneratedAt) &&
      generatedAt < minimumGeneratedAt
    ) {
      blockers.push(`${label}.generatedAt predates current invocation`);
    }
    if (!Number.isSafeInteger(artifact.effectiveApplyCount) || artifact.effectiveApplyCount < 0) {
      blockers.push(`${label}.effectiveApplyCount is invalid`);
    }
    if (artifact.effectiveApplyConsistency?.valid !== true) {
      blockers.push(`${label}.effectiveApplyConsistency is not valid`);
    }
    if (
      label === "apply preview" &&
      !Array.isArray(artifact.appliedCandidateIds)
    ) {
      blockers.push("apply preview.appliedCandidateIds is missing");
    }
    if (label === "apply preview" && !Array.isArray(artifact.fieldChanges)) {
      blockers.push("apply preview.fieldChanges is missing");
    }
  }
  if (
    preview &&
    gateReport &&
    preview.effectiveApplyCount !== gateReport.effectiveApplyCount
  ) {
    blockers.push("apply preview and gate effectiveApplyCount differ");
  }
  return {
    valid: blockers.length === 0,
    blockers: [...new Set(blockers)],
  };
}

function items(payload) {
  return Array.isArray(payload) ? payload : payload?.products || [];
}

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function sourceProductId(item) {
  return text(item?.sourceProductId);
}

export function legacyDuplicateOverrideGateBlockReason({
  diff,
  legacyDuplicateSnapshotSha256,
} = {}) {
  const requestedSha256 = text(legacyDuplicateSnapshotSha256).toUpperCase();
  const override = diff?.legacyDuplicateOverride;
  if (!override) return null;
  if (!requestedSha256) {
    return "legacy duplicate snapshot authorization is required for this diff";
  }
  if (
    override.authorized !== true ||
    text(override.snapshotSha256).toUpperCase() !== requestedSha256
  ) {
    return "legacy duplicate snapshot authorization does not match the diff evidence";
  }
  return null;
}

function progressiveMarkdown(report) {
  return `# Smokingpipes Progressive Daily

- runStatus: ${report.runStatus}
- mode: ${report.mode}
- dailyRunId: ${report.dailyRunId || "none"}
- listSnapshotStatus: ${report.listSnapshotStatus || "none"}
- pagesScanned: ${report.pagesScanned || 0}
- expectedPages: ${report.expectedPages || "unavailable"}
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
- effectiveApplyCount: ${report.effectiveApplyCount || 0}
- largeApplyWarningThreshold: ${report.largeApplyWarningThreshold ?? LARGE_APPLY_WARNING_THRESHOLD}
- maxAutoApply: ${report.maxAutoApply ?? DEFAULT_MAX_AUTO_APPLY}
- largeApplyWarning: ${Boolean(report.largeApplyWarning)}
- largeApplyBlocked: ${Boolean(report.largeApplyBlocked)}
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
    expectedPages: state?.expectedPages || 0,
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
    effectiveApplyCount: result.effectiveApplyCount || 0,
    largeApplyWarningThreshold:
      result.largeApplyWarningThreshold ??
      LARGE_APPLY_WARNING_THRESHOLD,
    maxAutoApply:
      result.maxAutoApply ?? DEFAULT_MAX_AUTO_APPLY,
    largeApplyWarning: result.largeApplyWarning === true,
    largeApplyBlocked: result.largeApplyBlocked === true,
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
      expectedPages: 3,
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
  const raw = String(
    env.YANDOUBUY_SMOKINGPIPES_MAX_AUTO_APPLY || ""
  ).trim();
  if (!raw) return DEFAULT_MAX_AUTO_APPLY;
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(
      "YANDOUBUY_SMOKINGPIPES_MAX_AUTO_APPLY must be a positive integer."
    );
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(
      "YANDOUBUY_SMOKINGPIPES_MAX_AUTO_APPLY must be a positive safe integer."
    );
  }
  return parsed;
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
  largeApplyWarningThreshold = LARGE_APPLY_WARNING_THRESHOLD,
}) {
  const blockers = [];
  const failedCandidates = (state?.candidates || []).filter(
    (candidate) => candidate.detailStatus === "failed"
  );
  const wouldApplyIds = new Set(
    (preview?.wouldApplyProductIds || []).map(String)
  );
  const publicCatalogIds = new Set(
    (Array.isArray(publicPayloads?.catalog)
      ? publicPayloads.catalog
      : publicPayloads?.catalog?.products || [])
      .map((item) => sourceProductId(item))
      .filter(Boolean)
  );
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
  const hasEffectiveApplyEvidence =
    Number.isSafeInteger(preview?.effectiveApplyCount) &&
    preview.effectiveApplyCount >= 0 &&
    preview?.effectiveApplyConsistency &&
    typeof preview.effectiveApplyConsistency === "object";
  const effectiveApplyCount = hasEffectiveApplyEvidence
    ? Number(preview.effectiveApplyCount)
    : 0;
  const effectiveApplyConsistency = preview?.effectiveApplyConsistency || {
    valid: false,
    reason: "preview effective apply evidence is missing",
    appliedCandidateIds: [],
  };
  const largeApplyWarning =
    effectiveApplyCount > largeApplyWarningThreshold;
  const largeApplyBlocked = effectiveApplyCount > maxAutoApply;
  if (!(candidateCount > 0)) {
    blockers.push("candidateCount must be greater than 0");
  }
  if (!(previewWouldApplyCount > 0)) {
    blockers.push("preview wouldApplyCount must be greater than 0");
  }
  if (!hasEffectiveApplyEvidence) {
    blockers.push("preview effective apply evidence is missing");
  }
  if (largeApplyBlocked) {
    blockers.push(
      `effectiveApplyCount ${effectiveApplyCount} exceeds max auto apply ${maxAutoApply}`
    );
  }
  if (effectiveApplyConsistency.valid !== true) {
    blockers.push(
      effectiveApplyConsistency.reason || "effective apply count mismatch"
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
  const failedIsolatedCandidates = [];
  for (const candidate of failedCandidates) {
    const id = sourceProductId(candidate);
    const requiresProductionMutation = (candidate.changeTypes || []).some(
      (changeType) =>
        [
          "price-change",
          "explicit-out-of-stock",
          "confirmed-disappeared",
          "reappeared",
        ].includes(changeType)
    );
    const safelyIsolated =
      ["not-public", "review-only"].includes(candidate.publicStatus) &&
      !wouldApplyIds.has(id) &&
      !publicCatalogIds.has(id) &&
      !requiresProductionMutation &&
      (safeGap || gapCount === 0) &&
      unknownGapCount === 0 &&
      readyUnexpectedlyExcludedCount === 0;
    if (safelyIsolated) {
      failedIsolatedCandidates.push(candidate);
      continue;
    }
    if (candidate.publicStatus === "ready" || wouldApplyIds.has(id)) {
      blockers.push(`failed candidate requires apply=${id}`);
    } else if (publicCatalogIds.has(id)) {
      blockers.push(`failed candidate leaked into public catalog=${id}`);
    } else if (requiresProductionMutation) {
      blockers.push(`failed candidate requires production mutation=${id}`);
    } else {
      blockers.push(`failed candidate is not safely isolated=${id}`);
    }
  }
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
    effectiveApplyCount,
    appliedCandidateIds: effectiveApplyConsistency.appliedCandidateIds || [],
    appliedEventIds: preview?.appliedEventIds || [],
    fieldChanges: preview?.fieldChanges || [],
    effectiveApplyConsistency,
    safeSubsetApply: safeGap && blockers.length === 0,
    isolatedCandidateCount: gapCount,
    failedIsolatedCount: failedIsolatedCandidates.length,
    applyGap,
    maxAutoApply,
    largeApplyWarningThreshold,
    largeApplyWarning,
    largeApplyBlocked,
    failureType: largeApplyBlocked ? "catchup-required" : null,
    requiresManualVerification: false,
    suggestedCatchupBatchCount: largeApplyBlocked
      ? Math.ceil(effectiveApplyCount / SMOKINGPIPES_CATCHUP_BATCH_LIMIT)
      : 0,
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

function sourceUsdPrice(product) {
  const price = product?.price?.current || product?.price?.listPrice || {};
  const amount = Number(price.amount ?? product?.sourcePriceAmount);
  const currency = text(price.currency || product?.sourcePriceCurrency || "USD");
  return currency === "USD" && Number.isFinite(amount) ? amount : null;
}

export function buildSmokingpipesChangeSummary({
  productionBefore = [],
  productionAfter = [],
  state,
  actualAppliedCount = 0,
  isolatedCandidateCount = 0,
  failedIsolatedCount = 0,
  appliedCandidateIds = null,
  fieldChanges = null,
} = {}) {
  const beforeById = new Map(
    productionBefore.map((item) => [sourceProductId(item), item])
  );
  const afterById = new Map(
    productionAfter.map((item) => [sourceProductId(item), item])
  );
  const candidatesById = new Map(
    (state?.candidates || []).map((item) => [sourceProductId(item), item])
  );
  const changedIds = new Set();
  const summary = {
    newlyPublishedCount: 0,
    sourcePriceIncreaseCount: 0,
    sourcePriceDecreaseCount: 0,
    explicitOutOfStockCount: 0,
    confirmedDisappearedCount: 0,
    reappearedCount: 0,
    disappearedPendingConfirmationCount: Object.values(
      state?.globalReconcile?.disappearanceTracking?.items || {}
    ).filter((item) => item?.disappearanceStatus === "pending-confirmation")
      .length,
    isolatedCandidateCount: Number(isolatedCandidateCount || 0),
    failedIsolatedCount: Number(failedIsolatedCount || 0),
    otherAppliedCount: 0,
    actualAppliedCount: 0,
  };
  for (const [id, after] of afterById) {
    const before = beforeById.get(id);
    if (before && JSON.stringify(before) === JSON.stringify(after)) continue;
    changedIds.add(id);
    const candidate = candidatesById.get(id);
    const changeTypes = candidate?.changeTypes || [];
    if (!before) summary.newlyPublishedCount += 1;
    else if (changeTypes.includes("confirmed-disappeared")) summary.confirmedDisappearedCount += 1;
    else if (changeTypes.includes("explicit-out-of-stock")) summary.explicitOutOfStockCount += 1;
    else if (changeTypes.includes("reappeared")) summary.reappearedCount += 1;
    else {
      const beforePrice = sourceUsdPrice(before);
      const afterPrice = sourceUsdPrice(after);
      if (beforePrice !== null && afterPrice !== null && afterPrice > beforePrice) {
        summary.sourcePriceIncreaseCount += 1;
      } else if (beforePrice !== null && afterPrice !== null && afterPrice < beforePrice) {
        summary.sourcePriceDecreaseCount += 1;
      } else {
        summary.otherAppliedCount += 1;
      }
    }
  }
  const classified =
    summary.newlyPublishedCount +
    summary.sourcePriceIncreaseCount +
    summary.sourcePriceDecreaseCount +
    summary.explicitOutOfStockCount +
    summary.confirmedDisappearedCount +
    summary.reappearedCount +
    summary.otherAppliedCount;
  summary.actualAppliedCount = changedIds.size;
  const expectedActualAppliedCount = Number(actualAppliedCount || 0);
  const expectedAppliedCandidateIds = Array.isArray(appliedCandidateIds)
    ? [...new Set(appliedCandidateIds.map(String).filter(Boolean))].sort()
    : null;
  const expectedFieldChangeIds = Array.isArray(fieldChanges)
    ? [...new Set(fieldChanges.map((change) => sourceProductId(change)).filter(Boolean))].sort()
    : null;
  const changedIdList = [...changedIds].sort();
  const appliedCandidateIdsMatch = expectedAppliedCandidateIds === null ||
    JSON.stringify(changedIdList) === JSON.stringify(expectedAppliedCandidateIds);
  const fieldChangesMatch = expectedFieldChangeIds === null ||
    JSON.stringify(changedIdList) === JSON.stringify(expectedFieldChangeIds);
  const countMatches = expectedActualAppliedCount === changedIds.size;
  const valid = classified === summary.actualAppliedCount && countMatches && appliedCandidateIdsMatch && fieldChangesMatch;
  summary.consistency = {
    valid,
    classifiedAppliedCount: classified,
    reason:
      valid
        ? null
        : `effective apply count mismatch: changeSummary=${summary.actualAppliedCount}, classified=${classified}, expected=${expectedActualAppliedCount}, appliedCandidateIds=${expectedAppliedCandidateIds?.length ?? "missing"}, fieldChanges=${expectedFieldChangeIds?.length ?? "missing"}`,
  };
  if (expectedAppliedCandidateIds !== null) {
    summary.consistency.appliedCandidateCount = expectedAppliedCandidateIds.length;
  }
  if (expectedFieldChangeIds !== null) {
    summary.consistency.fieldChangeCount = expectedFieldChangeIds.length;
  }
  return summary;
}

export function evaluateSmokingpipesProductionWriteNeed({
  effectiveApplyCount = 0,
  fieldChanges = [],
  productionBefore = [],
  productionAfter = [],
} = {}) {
  const fieldChangeProductIds = new Set(
    (fieldChanges || []).map((change) => sourceProductId(change)).filter(Boolean)
  );
  const beforeById = new Map(
    (productionBefore || []).map((item) => [sourceProductId(item), item])
  );
  const afterById = new Map(
    (productionAfter || []).map((item) => [sourceProductId(item), item])
  );
  const changedProductIds = new Set();
  for (const id of new Set([...beforeById.keys(), ...afterById.keys()])) {
    if (JSON.stringify(beforeById.get(id)) !== JSON.stringify(afterById.get(id))) {
      changedProductIds.add(id);
    }
  }
  const reason =
    Number(effectiveApplyCount || 0) === 0
      ? "effectiveApplyCount=0"
      : fieldChangeProductIds.size === 0
        ? "fieldChanges contain no unique products"
        : changedProductIds.size === 0
          ? "production before/after contain no product changes"
          : null;
  return {
    shouldSkipProductionWrite: reason !== null,
    reason,
    fieldChangeProductCount: fieldChangeProductIds.size,
    productionChangedProductCount: changedProductIds.size,
  };
}

function markSmokingpipesActionEventsSuperseded({
  state,
  eventIds = [],
  supersededRunId,
  supersededAt = new Date().toISOString(),
  reason = "selected apply produced no production change",
}) {
  const next = structuredClone(state);
  next.actionEvents ||= {};
  for (const eventId of [...new Set(eventIds.map(String).filter(Boolean))]) {
    const event = next.actionEvents[eventId];
    if (!event || event.status !== "pending") continue;
    event.status = "superseded";
    event.supersededReason = reason;
    event.supersededAt = supersededAt;
    event.supersededRunId = supersededRunId || null;
    event.updatedAt = supersededAt;
  }
  return next;
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

function buildCatchupReceipt({
  selection,
  runId,
  productionBefore,
  productionAfter,
  phase,
  backup = null,
  prior = null,
}) {
  const selectedItems = selection?.actionablePlan?.items || [];
  const timestamps = { ...(prior?.timestamps || {}) };
  timestamps[phase] = new Date().toISOString();
  return {
    schemaVersion: "smokingpipes-catchup-receipt-v1",
    planId: selection?.plan?.planId || null,
    batchNumber: selection?.batch?.batchNumber || null,
    batchHash: selection?.batch?.batchHash || null,
    runId,
    phase,
    selectedEventIds: selectedItems.map((item) => item.event.eventId),
    selectedSourceProductIds: selectedItems.map(
      (item) => item.event.sourceProductId
    ),
    selectedDesiredProductHashes: selectedItems.map((item) => ({
      sourceProductId: item.event.sourceProductId,
      desiredProductHash: item.event.desiredProductHash,
    })),
    productionBeforeHash: stableProductHash(productionBefore),
    expectedProductionAfterHash: stableProductHash(productionAfter),
    actualProductionAfterHash:
      phase === "prepared" ? null : stableProductHash(productionAfter),
    backup,
    commitSha: prior?.commitSha || null,
    pushStatus: prior?.pushStatus || "not-requested",
    timestamps,
  };
}

function receiptMatchesWrittenProduction({ receipt, productionProducts }) {
  if (receipt?.phase !== "production-written") return false;
  if (
    !receipt.expectedProductionAfterHash ||
    receipt.expectedProductionAfterHash !== stableProductHash(productionProducts)
  ) {
    return false;
  }
  const productionById = new Map(
    productionProducts.map((item) => [sourceProductId(item), item])
  );
  return (receipt.selectedDesiredProductHashes || []).every(
    ({ sourceProductId: id, desiredProductHash }) =>
      desiredProductHash &&
      desiredProductHash === stableProductHash(productionById.get(String(id)))
  );
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
  runId = null,
  selectedEventIds = null,
}) {
  const productionProducts = loadProduction(
    paths,
    options.mock
  );
  const danishProducts = options.mock
    ? []
    : items(readJsonIfExists(paths.danishProducts, []));
  const actionPlan = buildSmokingpipesActionableApplyPlan({
    productionProducts,
    state,
    currentPayload: readJsonIfExists(paths.currentList, null),
    diffPayload: readJsonIfExists(paths.diff, null),
  });
  const stateWithActionEvents = {
    ...state,
    actionEvents: actionPlan.eventsById,
  };
  const selectedActionPlan = Array.isArray(selectedEventIds)
    ? {
        ...actionPlan,
        items: actionPlan.items.filter((item) =>
          selectedEventIds.includes(item.event.eventId)
        ),
      }
    : actionPlan;
  const isCatchupBatch = Array.isArray(selectedEventIds);
  const globalCandidateIds = (stateWithActionEvents?.candidates || [])
    .map(sourceProductId)
    .filter(Boolean);
  const selectedCandidateIds = isCatchupBatch
    ? [
        ...new Set(
          (selectedActionPlan.items || [])
            .map((item) => sourceProductId(item.event))
            .filter(Boolean)
        ),
      ]
    : globalCandidateIds;
  const selectedCandidateIdSet = new Set(selectedCandidateIds);
  const gateState = isCatchupBatch
    ? {
        ...stateWithActionEvents,
        candidates: (stateWithActionEvents.candidates || []).filter(
          (item) => selectedCandidateIdSet.has(sourceProductId(item))
        ),
      }
    : stateWithActionEvents;
  const candidate = buildProgressivePartialProducts({
    productionProducts,
    state: stateWithActionEvents,
    actionablePlan: selectedActionPlan,
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
    state: gateState,
    publicCatalog: publicBase.catalog.products,
    recentNew: recentNew.products,
  });
  audit.runId = runId || null;
  audit.scope = isCatchupBatch ? "manual-catchup-batch" : "all-candidates";
  audit.globalCandidateCount = globalCandidateIds.length;
  audit.globalActionableEventCount = actionPlan.items.length;
  audit.deferredActionableCount = isCatchupBatch
    ? actionPlan.items.length - selectedActionPlan.items.length
    : 0;
  audit.attemptedCandidateCount = selectedCandidateIds.length;
  audit.candidateCount = audit.attemptedCandidateCount;
  audit.effectiveCandidateCount =
    candidate.appliedCandidateIds.length;
  audit.actionEventLifecycle = {
    schemaVersion: actionPlan.schemaVersion,
    sourceSnapshotId: actionPlan.sourceSnapshotId,
    sourceSnapshotHash: actionPlan.sourceSnapshotHash,
    pendingEventCount: actionPlan.items.length,
    isolatedEventCount: actionPlan.isolated.length,
    supersededEventCount: actionPlan.superseded.length,
    catchupBatches: actionPlan.catchupBatches.map((batch) => ({
      batchNumber: batch.batchNumber,
      count: batch.sourceProductIds.length,
      requiresManualApproval: batch.requiresManualApproval,
    })),
  };
  const applyPreview = buildProgressivePartialApplyPreview({
    state: stateWithActionEvents,
    audit,
    productionProducts,
    candidateProducts: candidate.products,
    appliedCandidateIds: candidate.appliedCandidateIds,
    fieldChanges: candidate.fieldChanges,
    appliedEventIds: candidate.appliedEventIds || [],
  });
  audit.wouldApplyCount = applyPreview.wouldApplyCount || 0;
  audit.applyGap = diagnoseProgressiveApplyGap({
    state: gateState,
    productionProducts,
    candidateProducts: candidate.products,
    candidateIds: selectedCandidateIds,
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
    state: stateWithActionEvents,
    gateState,
    actionPlan,
    selectedActionPlan,
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
  runId,
  maxAutoApplyOverride = null,
  selectedEventIds = null,
  persistCatchupPlan = true,
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
    runId,
    selectedEventIds,
  });
  nextState = artifacts.state;
  await writeProgressiveDailyState(paths.progressiveState, nextState);
  const catchupPlan = createSmokingpipesCatchupPlan({
    actionablePlan: artifacts.actionPlan,
    productionProducts: loadProduction(paths, options.mock),
    runId,
    codeCommitSha: resolveCodeCommitSha(root),
  });
  // A manual catch-up apply must validate the immutable plan it was given;
  // never replace that plan during the validation/rebuild pass.
  if (persistCatchupPlan) {
    await writeJsonAtomic(paths.smokingpipesCatchupPlan, catchupPlan);
  }
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
    appliedCandidateIds: artifacts.candidate.appliedCandidateIds,
    fieldChanges: artifacts.candidate.fieldChanges,
    appliedEventIds: artifacts.candidate.appliedEventIds || [],
  });
  stampEffectiveApplyArtifact(preview, { root, runId });
  await writeJsonAtomic(paths.progressiveApplyPreview, preview);
  const publicNext = readProgressivePublicNext(paths);
  const diff = readJsonIfExists(paths.diff, null);
  const gate = evaluateProgressiveProductionApplyGate({
    state: artifacts.gateState,
    audit: artifacts.audit,
    preview,
    candidateProducts,
    publicPayloads: publicNext.payloads,
    maxAutoApply:
      Number.isFinite(maxAutoApplyOverride) &&
      maxAutoApplyOverride > 0
        ? maxAutoApplyOverride
        : Number.isFinite(options.maxAutoApply) &&
            options.maxAutoApply > 0
          ? options.maxAutoApply
          : progressiveMaxAutoApplyFromEnv(),
  });
  gate.actionEventLifecycle = artifacts.audit.actionEventLifecycle;
  gate.catchupPlan = {
    planId: catchupPlan.planId,
    totalEventCount: catchupPlan.totalEventCount,
    batchCount: catchupPlan.batches.length,
  };
  gate.blockers.push(...publicNext.blockers);
  const legacyOverrideBlockReason = legacyDuplicateOverrideGateBlockReason({
    diff,
    legacyDuplicateSnapshotSha256:
      options.legacyDuplicateSnapshotSha256,
  });
  if (legacyOverrideBlockReason) {
    gate.blockers.push(legacyOverrideBlockReason);
  }
  gate.blockers = [...new Set(gate.blockers)];
  gate.blockedReason = gate.blockers.join("; ") || null;
  gate.applyReady = gate.blockers.length === 0;
  gate.status = gate.applyReady ? "apply-ready" : "apply-blocked";
  const stateCandidates = nextState?.candidates || [];
  const readyCandidates = stateCandidates.filter(
    (candidate) =>
      candidate.publicStatus === "ready" &&
      candidate.detailStatus === "complete" &&
      !isExcludedBrandCandidate(candidate)
  );
  const reviewOnlyCandidates = stateCandidates.filter(
    (candidate) => candidate.publicStatus === "review-only"
  );
  const notPublicCandidates = stateCandidates.filter(
    (candidate) => candidate.publicStatus === "not-public"
  );
  const failedNotPublicCandidates = stateCandidates.filter(
    (candidate) =>
      candidate.detailStatus === "failed" &&
      candidate.publicStatus === "not-public"
  );
  const excludedBrandCandidates = stateCandidates.filter(
    isExcludedBrandCandidate
  );
  const report = {
    version: "smokingpipes-progressive-apply-gate-report-v2",
    schemaVersion: EFFECTIVE_APPLY_SCHEMA_VERSION,
    codeCommitSha: resolveCodeCommitSha(root),
    generatorModule: EFFECTIVE_APPLY_GENERATOR_MODULE,
    runId,
    generatedAt: new Date().toISOString(),
    status: gate.status,
    applyReady: gate.applyReady,
    blockedReason: gate.blockedReason,
    blockers: gate.blockers,
    readyCount: readyCandidates.length,
    reviewOnlyCount: reviewOnlyCandidates.length,
    notPublicCount: notPublicCandidates.length,
    failedNotPublicCount: failedNotPublicCandidates.length,
    excludedBrandCount: excludedBrandCandidates.length,
    candidateCount: gate.candidateCount,
    wouldApplyCount: gate.wouldApplyCount,
    effectiveApplyCount: gate.effectiveApplyCount,
    effectiveApplyConsistency: gate.effectiveApplyConsistency,
    isolatedCandidateCount: gate.isolatedCandidateCount,
    safeSubsetApply: gate.safeSubsetApply,
    maxAutoApply: gate.maxAutoApply,
    largeApplyWarningThreshold:
      gate.largeApplyWarningThreshold,
    largeApplyWarning: gate.largeApplyWarning,
    largeApplyBlocked: gate.largeApplyBlocked,
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
  await updateLegacyDuplicateOverrideAudit({
    root,
    diff,
    snapshotPath: paths.currentList,
    runScopedMaxAutoApply: gate.maxAutoApply,
    wouldApplyCount: gate.wouldApplyCount,
    finalGateDecision: gate.status,
  });
  return {
    state: nextState,
    artifacts,
    preview,
    gate,
    report,
    catchupPlan,
  };
}

export function validateManualLargeApplyEvidence({
  state,
  gateReport,
  preview,
  audit,
}) {
  const blockers = [];
  const candidates = state?.candidates || [];
  const excludedCandidates = candidates.filter(
    isExcludedBrandCandidate
  );
  const readyCandidates = candidates.filter(
    (candidate) =>
      candidate.publicStatus === "ready" &&
      candidate.detailStatus === "complete" &&
      !isExcludedBrandCandidate(candidate)
  );
  const reviewOnlyCandidates = candidates.filter(
    (candidate) => candidate.publicStatus === "review-only"
  );
  const notPublicCandidates = candidates.filter(
    (candidate) => candidate.publicStatus === "not-public"
  );
  const failedCandidates = candidates.filter(
    (candidate) => candidate.detailStatus === "failed"
  );
  const pendingCandidates = candidates.filter(
    (candidate) => candidate.detailStatus === "pending"
  );
  const readyIds = new Set(
    readyCandidates.map(sourceProductId)
  );
  const previewWouldApplyIds = Array.isArray(
    preview?.wouldApplyProductIds
  )
    ? preview.wouldApplyProductIds.map(String)
    : [];
  const previewWouldApplyIdSet = new Set(
    previewWouldApplyIds
  );
  const isolatedLeakIds = [
    ...reviewOnlyCandidates,
    ...notPublicCandidates,
    ...failedCandidates.filter(
      (candidate) =>
        ["not-public", "review-only"].includes(candidate.publicStatus)
    ),
    ...excludedCandidates,
  ]
    .map(sourceProductId)
    .filter((id) => previewWouldApplyIdSet.has(id));
  const missingReadyIds = [...readyIds].filter(
    (id) => !previewWouldApplyIdSet.has(id)
  );
  const duplicateWouldApplyIds =
    previewWouldApplyIds.length -
    previewWouldApplyIdSet.size;

  if (!state) blockers.push("progressive state is missing");
  if (state?.productionWritten !== false) {
    blockers.push(
      "progressive state productionWritten must be false"
    );
  }
  if (pendingCandidates.length) {
    blockers.push(`pending candidates=${pendingCandidates.length}`);
  }
  for (const candidate of failedCandidates) {
    const requiresProductionMutation = (candidate.changeTypes || []).some(
      (changeType) =>
        [
          "price-change",
          "explicit-out-of-stock",
          "confirmed-disappeared",
          "reappeared",
        ].includes(changeType)
    );
    const safelyIsolated =
      ["not-public", "review-only"].includes(candidate.publicStatus) &&
      !requiresProductionMutation &&
      !previewWouldApplyIdSet.has(sourceProductId(candidate));
    if (!safelyIsolated) {
      blockers.push(
        `failed candidate is not safely isolated=${sourceProductId(candidate)}`
      );
    }
  }
  if (audit?.verdict !== "PASS") {
    blockers.push(`audit verdict=${audit?.verdict || "missing"}`);
  }
  if ((audit?.blockers || []).length) {
    blockers.push(...audit.blockers);
  }
  for (const key of [
    "pendingLeak",
    "failedLeak",
    "blockedLeak",
    "reviewOnlyLeak",
    "excludedBrandLeak",
    "zeroPriceSellable",
  ]) {
    const value = Number(audit?.counts?.[key] || 0);
    if (value !== 0) blockers.push(`${key}=${value}`);
  }
  for (const [name, report] of [
    ["gate report", gateReport],
    ["preview", preview],
    ["audit", audit],
  ]) {
    if (!report) {
      blockers.push(`${name} is missing`);
      continue;
    }
    if (report.productionWritten !== false) {
      blockers.push(`${name} productionWritten must be false`);
    }
  }
  if (preview?.status !== "preview-ready") {
    blockers.push(
      `preview status=${preview?.status || "missing"}`
    );
  }
  if (duplicateWouldApplyIds) {
    blockers.push(
      `duplicate wouldApplyProductIds=${duplicateWouldApplyIds}`
    );
  }
  if (isolatedLeakIds.length) {
    blockers.push(
      `isolated candidates leaked into preview=${isolatedLeakIds.length}`
    );
  }
  if (missingReadyIds.length) {
    blockers.push(
      `ready candidates missing from preview=${missingReadyIds.length}`
    );
  }

  const expectedCounts = {
    candidateCount: candidates.length,
    wouldApplyCount: readyCandidates.length,
    isolatedCandidateCount:
      candidates.length - readyCandidates.length,
    readyCount: readyCandidates.length,
    reviewOnlyCount: reviewOnlyCandidates.length,
    notPublicCount: notPublicCandidates.length,
    failedNotPublicCount: failedCandidates.filter(
      (candidate) => candidate.publicStatus === "not-public"
    ).length,
    excludedBrandCount: excludedCandidates.length,
  };
  for (const [key, expected] of Object.entries(expectedCounts)) {
    for (const [name, report] of [
      ["gate report", gateReport],
      ["audit", audit],
    ]) {
      if (
        report &&
        Object.prototype.hasOwnProperty.call(report, key) &&
        Number(report[key]) !== expected
      ) {
        blockers.push(
          `${name} ${key}=${report[key]} does not match state ${expected}`
        );
      }
    }
    if (
      ["candidateCount", "wouldApplyCount", "isolatedCandidateCount"].includes(
        key
      ) &&
      preview &&
      Number(preview[key]) !== expected
    ) {
      blockers.push(
        `preview ${key}=${preview[key]} does not match state ${expected}`
      );
    }
  }
  if (
    gateReport?.stateDailyRunId &&
    gateReport.stateDailyRunId !== state?.dailyRunId
  ) {
    blockers.push(
      `gate report stateDailyRunId=${gateReport.stateDailyRunId} does not match state ${state?.dailyRunId}`
    );
  }
  const stateUpdatedAt = Date.parse(state?.updatedAt || "");
  const gateGeneratedAt = Date.parse(
    gateReport?.generatedAt || ""
  );
  if (
    Number.isFinite(stateUpdatedAt) &&
    (!Number.isFinite(gateGeneratedAt) ||
      gateGeneratedAt < stateUpdatedAt)
  ) {
    blockers.push("gate report is older than progressive state");
  }
  const gateBlockReasons =
    gateReport?.blockReasons ||
    gateReport?.blockers ||
    (gateReport?.blockedReason
      ? [gateReport.blockedReason]
      : []);
  const unexpectedGateBlockReasons = gateBlockReasons;
  if (unexpectedGateBlockReasons.length) {
    blockers.push(...unexpectedGateBlockReasons);
  }

  return {
    allowed: blockers.length === 0,
    blockers: [...new Set(blockers)],
    blockedReason: [...new Set(blockers)].join("; ") || null,
    ...expectedCounts,
    authorizedWouldApplyCount: readyCandidates.length,
    authorizedWouldApplyIds: [...readyIds].sort(),
  };
}

function readOfflinePrepareInput(filePath, label, blockReasons) {
  if (!fs.existsSync(filePath)) {
    blockReasons.push(`${label} is missing`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    blockReasons.push(`${label} JSON parse failed: ${error.message}`);
    return null;
  }
}

function isExcludedBrandCandidate(candidate) {
  return (
    candidate?.detailStatus === "excluded" ||
    /excluded-brand:/i.test(
      text(
        candidate?.exclusionReason ||
          candidate?.reviewReason ||
          candidate?.reason
      )
    )
  );
}

function offlinePrepareInputBlockReasons({
  state,
  stateErrors,
  currentList,
  diff,
  options,
}) {
  const blockReasons = [...stateErrors];
  const currentSummary = currentList?.summary || {};
  const diffCoverage = diff?.coverage || {};

  if (!state) {
    blockReasons.push("progressive state is required");
  } else {
    if (stateIsManualReconcile(state)) {
      blockReasons.push(
        `progressive state dailyRunId ${state.dailyRunId} comes from manual-reconcile and cannot be used by automatic daily apply`
      );
    }
    if (state.listSnapshotStatus !== "complete") {
      blockReasons.push(
        `state listSnapshotStatus=${state.listSnapshotStatus || "missing"}`
      );
    }
    if (state.fullExpectedRangeScanned !== true) {
      blockReasons.push("state fullExpectedRangeScanned must be true");
    }
    if (
      state.captchaDetected === true ||
      state.verificationDetected === true
    ) {
      blockReasons.push("state contains verification/captcha evidence");
    }
  }

  if (!currentList) {
    blockReasons.push("current-list evidence is required");
  } else {
    if (currentSummary.fullExpectedRangeScanned !== true) {
      blockReasons.push(
        "current-list fullExpectedRangeScanned must be true"
      );
    }
    if (
      currentSummary.captchaDetected === true ||
      currentSummary.verificationDetected === true ||
      currentSummary.verificationDetectedAt
    ) {
      blockReasons.push(
        "current-list contains verification/captcha evidence"
      );
    }
  }

  if (!diff) {
    blockReasons.push("inventory diff evidence is required");
  } else {
    if (diff.allowApply !== true) {
      blockReasons.push("inventory diff allowApply must be true");
    }
    if (diffCoverage.fullExpectedRangeScanned !== true) {
      blockReasons.push(
        "inventory diff fullExpectedRangeScanned must be true"
      );
    }
    if ((diff.fatalWarnings || []).length) {
      blockReasons.push(
        `inventory diff fatal warnings: ${diff.fatalWarnings.join("; ")}`
      );
    }
    const legacyOverrideBlockReason = legacyDuplicateOverrideGateBlockReason({
      diff,
      legacyDuplicateSnapshotSha256:
        options?.legacyDuplicateSnapshotSha256,
    });
    if (legacyOverrideBlockReason) {
      blockReasons.push(legacyOverrideBlockReason);
    }
  }

  return [...new Set(blockReasons)];
}

async function disabledLegacyOfflinePreparePath({
  root = process.cwd(),
  options = {},
}) {
  throw new Error(
    "runtime-artifact-version-mismatch: legacy offline progressive prepare path is disabled"
  );
  const paths = getRunnerPaths(root, {
    mock: options.mock,
  });
  const inputBlockReasons = [];
  const stateRead = readProgressiveDailyState(
    paths.progressiveState
  );
  const state =
    stateRead.status === "passed" ? stateRead.state : null;
  const stateErrors =
    stateRead.status === "missing"
      ? ["progressive state is required"]
      : stateRead.errors || [];
  const currentList = readOfflinePrepareInput(
    paths.currentList,
    "current-list",
    inputBlockReasons
  );
  const diff = readOfflinePrepareInput(
    paths.diff,
    "inventory diff",
    inputBlockReasons
  );
  const brandExclusionReport = readOfflinePrepareInput(
    paths.progressiveBrandExclusionReportJson,
    "brand exclusion report",
    inputBlockReasons
  );
  const candidates = state?.candidates || [];
  const readyCandidates = candidates.filter(
    (candidate) =>
      candidate.publicStatus === "ready" &&
      candidate.detailStatus === "complete" &&
      !isExcludedBrandCandidate(candidate)
  );
  const reviewOnlyCandidates = candidates.filter(
    (candidate) => candidate.publicStatus === "review-only"
  );
  const notPublicCandidates = candidates.filter(
    (candidate) => candidate.publicStatus === "not-public"
  );
  const failedNotPublicCandidates = candidates.filter(
    (candidate) =>
      candidate.detailStatus === "failed" &&
      candidate.publicStatus === "not-public"
  );
  const failedIsolatedCandidates = candidates.filter(
    (candidate) =>
      candidate.detailStatus === "failed" &&
      ["not-public", "review-only"].includes(candidate.publicStatus) &&
      !(candidate.changeTypes || []).some((changeType) =>
        [
          "price-change",
          "explicit-out-of-stock",
          "confirmed-disappeared",
          "reappeared",
        ].includes(changeType)
      )
  );
  const excludedBrandCandidates = candidates.filter(
    isExcludedBrandCandidate
  );
  const pendingReadyCandidates = candidates.filter(
    (candidate) =>
      candidate.detailStatus === "pending" &&
      candidate.publicStatus === "ready"
  );
  const failedReadyCandidates = candidates.filter(
    (candidate) =>
      candidate.detailStatus === "failed" &&
      candidate.publicStatus === "ready"
  );
  const blockedReadyCandidates = candidates.filter(
    (candidate) =>
      candidate.detailStatus === "blocked" &&
      candidate.publicStatus === "ready"
  );
  const excludedReadyCandidates = candidates.filter(
    (candidate) =>
      candidate.publicStatus === "ready" &&
      isExcludedBrandCandidate(candidate)
  );
  const inputGateReasons = offlinePrepareInputBlockReasons({
    state,
    stateErrors: inputBlockReasons.concat(stateErrors),
    currentList,
    diff,
    options,
  });
  const productionProducts = loadProduction(
    paths,
    options.mock
  );
  const applyGap = diagnoseProgressiveApplyGap({
    state,
    productionProducts,
    candidateIds: candidates.map(sourceProductId),
    wouldApplyProductIds: readyCandidates.map(sourceProductId),
  });
  const safeSubsetApply =
    applyGap.gapCount > 0 &&
    applyGap.safeToApplyWouldApplySubset === true;
  const auditBlockers = [...inputGateReasons];
  if (pendingReadyCandidates.length) {
    auditBlockers.push(
      `pending ready candidates=${pendingReadyCandidates.length}`
    );
  }
  if (failedReadyCandidates.length) {
    auditBlockers.push(
      `failed candidates leaked into ready=${failedReadyCandidates.length}`
    );
  }
  if (blockedReadyCandidates.length) {
    auditBlockers.push(
      `blocked candidates leaked into ready=${blockedReadyCandidates.length}`
    );
  }
  if (excludedReadyCandidates.length) {
    auditBlockers.push(
      `excluded-brand candidates leaked into ready=${excludedReadyCandidates.length}`
    );
  }
  if (applyGap.unknownGapCount > 0) {
    auditBlockers.push(
      `unknown gap candidates=${applyGap.unknownGapCount}`
    );
  }
  if (applyGap.readyUnexpectedlyExcludedCount > 0) {
    auditBlockers.push(
      `ready candidate unexpectedly excluded=${applyGap.readyUnexpectedlyExcludedCount}`
    );
  }
  if (
    candidates.length !== readyCandidates.length &&
    !safeSubsetApply
  ) {
    auditBlockers.push(
      "apply gap is not approved for safe subset apply"
    );
  }
  const uniqueAuditBlockers = [...new Set(auditBlockers)];
  const readyIds = readyCandidates.map(sourceProductId);
  const excludedBrandCount = excludedBrandCandidates.length;
  const reportedExcludedBrandCount = Number(
    brandExclusionReport?.excludedBrandCount || 0
  );
  const warnings = [];
  if (
    brandExclusionReport &&
    reportedExcludedBrandCount !== excludedBrandCount
  ) {
    warnings.push(
      `brand exclusion report count ${reportedExcludedBrandCount} differs from state ${excludedBrandCount}`
    );
  }
  const audit = {
    version:
      "smokingpipes-progressive-partial-audit-report-offline-v1",
    generatedAt: new Date().toISOString(),
    mode: "progressive-prepare-apply",
    verdict: uniqueAuditBlockers.length ? "FAIL" : "PASS",
    blockers: uniqueAuditBlockers,
    warnings,
    networkAccessed: false,
    browserStarted: false,
    productionWritten: false,
    candidateCount: candidates.length,
    wouldApplyCount: readyCandidates.length,
    isolatedCandidateCount: applyGap.gapCount,
    applyGap,
    readyCount: readyCandidates.length,
    reviewOnlyCount: reviewOnlyCandidates.length,
    notPublicCount: notPublicCandidates.length,
    failedNotPublicCount: failedNotPublicCandidates.length,
    failedIsolatedCount: failedIsolatedCandidates.length,
    excludedBrandCount,
    counts: {
      deletedProducts: 0,
      pendingLeak: pendingReadyCandidates.length,
      failedLeak: failedReadyCandidates.length,
      blockedLeak: blockedReadyCandidates.length,
      reviewOnlyLeak: 0,
      excludedBrandLeak: excludedReadyCandidates.length,
      zeroPriceSellable: 0,
    },
    sourceEvidence: {
      statePath: path.relative(root, paths.progressiveState),
      currentListPath: path.relative(root, paths.currentList),
      diffPath: path.relative(root, paths.diff),
      brandExclusionReportPath: path.relative(
        root,
        paths.progressiveBrandExclusionReportJson
      ),
      currentListFullExpectedRangeScanned:
        currentList?.summary?.fullExpectedRangeScanned === true,
      currentListCaptchaDetected:
        currentList?.summary?.captchaDetected === true,
      diffAllowApply: diff?.allowApply === true,
    },
  };
  const preview = {
    version:
      "smokingpipes-progressive-partial-apply-preview-offline-v1",
    generatedAt: new Date().toISOString(),
    status:
      audit.verdict === "PASS" && readyCandidates.length
        ? "preview-ready"
        : "preview-blocked",
    candidateCount: candidates.length,
    wouldApplyCount: readyCandidates.length,
    isolatedCandidateCount: applyGap.gapCount,
    wouldApplyProductIds: readyIds,
    isolatedCandidateIds: applyGap.gapCandidates.map(
      (candidate) => candidate.sourceProductId
    ),
    applyGap,
    safeSubsetApply,
    reviewOnlyIds: reviewOnlyCandidates.map(sourceProductId),
    notPublicIds: notPublicCandidates.map(sourceProductId),
    failedNotPublicIds:
      failedNotPublicCandidates.map(sourceProductId),
    failedIsolatedIds:
      failedIsolatedCandidates.map(sourceProductId),
    excludedBrandIds:
      excludedBrandCandidates.map(sourceProductId),
    falconPlannedHide: {
      productionCount: Number(
        brandExclusionReport?.plannedHideProductionCount || 0
      ),
      productionIds:
        brandExclusionReport?.plannedHideProductionIds || [],
      publicCount: Number(
        brandExclusionReport?.plannedHidePublicCount || 0
      ),
      publicIds:
        brandExclusionReport?.plannedHidePublicIds || [],
      applied: false,
    },
    networkAccessed: false,
    browserStarted: false,
    productionWritten: false,
    commitPerformed: false,
    pushPerformed: false,
  };
  const blockReasons = [...uniqueAuditBlockers];
  if (!readyCandidates.length) {
    blockReasons.push("wouldApplyCount must be greater than 0");
  }
  const maxAutoApply =
    Number.isFinite(options.maxAutoApply) &&
    options.maxAutoApply > 0
      ? options.maxAutoApply
      : progressiveMaxAutoApplyFromEnv();
  const largeApplyWarning =
    readyCandidates.length > LARGE_APPLY_WARNING_THRESHOLD;
  const largeApplyBlocked = readyCandidates.length > maxAutoApply;
  if (largeApplyBlocked) {
    blockReasons.push(
      "legacy offline progressive prepare path is disabled"
    );
  }
  const uniqueBlockReasons = [...new Set(blockReasons)];
  const gateReport = {
    version:
      "smokingpipes-progressive-apply-gate-report-offline-v1",
    generatedAt: new Date().toISOString(),
    mode: "progressive-prepare-apply",
    status: uniqueBlockReasons.length
      ? "apply-blocked"
      : "apply-ready",
    applyReady: uniqueBlockReasons.length === 0,
    blockedReason: uniqueBlockReasons.join("; ") || null,
    blockReasons: uniqueBlockReasons,
    blockers: uniqueBlockReasons,
    networkAccessed: false,
    browserStarted: false,
    productionWritten: false,
    commitPerformed: false,
    pushPerformed: false,
    readyCount: readyCandidates.length,
    reviewOnlyCount: reviewOnlyCandidates.length,
    notPublicCount: notPublicCandidates.length,
    failedNotPublicCount: failedNotPublicCandidates.length,
    failedIsolatedCount: failedIsolatedCandidates.length,
    excludedBrandCount,
    candidateCount: candidates.length,
    wouldApplyCount: readyCandidates.length,
    isolatedCandidateCount: applyGap.gapCount,
    applyGap,
    safeSubsetApply,
    maxAutoApply,
    largeApplyWarningThreshold: LARGE_APPLY_WARNING_THRESHOLD,
    largeApplyWarning,
    largeApplyBlocked,
    stateDailyRunId: state?.dailyRunId || null,
    stateManualReconcileBlocked:
      state ? stateIsManualReconcile(state) : false,
    auditPath: path.relative(root, paths.progressiveAuditJson),
    previewPath: path.relative(
      root,
      paths.progressiveApplyPreview
    ),
    brandExclusionReport: {
      excludedBrandCount: reportedExcludedBrandCount,
      excludedBrandBreakdown:
        brandExclusionReport?.excludedBrandBreakdown || {},
      plannedHideProductionCount: Number(
        brandExclusionReport?.plannedHideProductionCount || 0
      ),
      plannedHidePublicCount: Number(
        brandExclusionReport?.plannedHidePublicCount || 0
      ),
      applied: false,
    },
  };
  await writeJsonAtomic(paths.progressiveAuditJson, audit);
  await writeJsonAtomic(paths.progressiveApplyPreview, preview);
  await writeJsonAtomic(
    paths.progressiveApplyGateReport,
    gateReport
  );
  await updateLegacyDuplicateOverrideAudit({
    root,
    diff,
    snapshotPath: paths.currentList,
    runScopedMaxAutoApply: maxAutoApply,
    wouldApplyCount: readyCandidates.length,
    finalGateDecision: gateReport.status,
  });
  return {
    ...gateReport,
    audit,
    preview,
  };
}

export async function runSmokingpipesProgressiveMode({
  root = process.cwd(),
  options,
}) {
  const paths = getRunnerPaths(root, {
    mock: options.mock,
  });
  const runId = options.runId || formatRunId();
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
            0
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
        currentListFresh: options.currentListFresh === true,
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

    if (options.mode === "progressive-prepare-apply") {
      const prepared = await prepareProgressiveApplyGate({
        root,
        paths,
        state,
        options,
        runId,
      });
      const result = {
        ...prepared.report,
        ...prepared.gate,
        schemaVersion: EFFECTIVE_APPLY_SCHEMA_VERSION,
        codeCommitSha: resolveCodeCommitSha(root),
        generatorModule: EFFECTIVE_APPLY_GENERATOR_MODULE,
        runId,
        generatedAt: prepared.report.generatedAt,
        audit: prepared.artifacts.audit,
        preview: prepared.preview,
        networkAccessed: false,
        browserStarted: false,
        productionWritten: false,
        commitPerformed: false,
        pushPerformed: false,
      };
      await writeProgressiveReport(
        paths,
        makeReport({ mode: options.mode, state: prepared.state, result })
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
              refreshProgressiveSummary(
                checkpointState,
                new Date().toISOString()
              )
            ),
        });
      } finally {
        await processor.close();
      }
      result.browserStarted = processor.browserStarted === true;
      state = refreshProgressiveSummary(
        result.state,
        new Date().toISOString()
      );
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
    stampEffectiveApplyArtifact(preview, { root, runId });
    if (options.writeProduction) {
      assertMockProductionPathsAreIsolated(paths, options);
      let catchupSelection = null;
      if (options.manualCatchupBatch !== null) {
        const persistedCatchupPlan = readJsonIfExists(
          paths.smokingpipesCatchupPlan,
          null
        );
        const existingReceipt = readJsonIfExists(
          paths.smokingpipesCatchupReceipt,
          null
        );
        if (
          existingReceipt?.planId === options.catchupPlanId &&
          existingReceipt?.batchNumber === options.manualCatchupBatch &&
          existingReceipt?.batchHash === options.catchupBatchHash &&
          receiptMatchesWrittenProduction({
            receipt: existingReceipt,
            productionProducts,
          })
        ) {
          state = markSmokingpipesActionEventsApplied({
            state,
            eventIds: existingReceipt.selectedEventIds || [],
            appliedRunId: existingReceipt.runId || runId,
          });
          await writeProgressiveDailyState(paths.progressiveState, state);
          const recoveredReceipt = {
            ...existingReceipt,
            phase: "events-committed",
            timestamps: {
              ...(existingReceipt.timestamps || {}),
              "events-committed": new Date().toISOString(),
            },
          };
          await writeJsonAtomic(
            paths.smokingpipesCatchupReceipt,
            recoveredReceipt
          );
          const recovered = {
            version: "smokingpipes-catchup-apply-v1",
            generatedAt: new Date().toISOString(),
            status: "catchup-recovery-complete",
            catchupPlanId: options.catchupPlanId,
            catchupBatchNumber: options.manualCatchupBatch,
            catchupBatchHash: options.catchupBatchHash,
            productionWritten: false,
            productionRewritten: false,
            commitPerformed: false,
            pushPerformed: false,
          };
          await writeProgressiveReport(
            paths,
            makeReport({ mode: options.mode, state, result: recovered })
          );
          return recovered;
        }
        const freshActionPlan = buildSmokingpipesActionableApplyPlan({
          productionProducts,
          state,
          currentPayload: readJsonIfExists(paths.currentList, null),
          diffPayload: readJsonIfExists(paths.diff, null),
        });
        catchupSelection = selectSmokingpipesCatchupBatch({
          actionablePlan: freshActionPlan,
          plan: persistedCatchupPlan,
          batchNumber: options.manualCatchupBatch,
          planId: options.catchupPlanId,
          batchHash: options.catchupBatchHash,
          codeCommitSha: resolveCodeCommitSha(root),
          productionProducts,
        });
        if (!catchupSelection.valid) {
          const blocked = {
            version: "smokingpipes-catchup-apply-v1",
            generatedAt: new Date().toISOString(),
            status: "catchup-plan-stale",
            failureType: "catchup-plan-stale",
            catchupPlanId: options.catchupPlanId,
            catchupBatchNumber: options.manualCatchupBatch,
            catchupBatchHash: options.catchupBatchHash,
            blockers: catchupSelection.blockers,
            blockedReason: catchupSelection.blockers.join("; "),
            productionWritten: false,
            commitPerformed: false,
            pushPerformed: false,
          };
          await writeJsonAtomic(paths.progressiveApplyPreview, blocked);
          await writeProgressiveReport(
            paths,
            makeReport({ mode: options.mode, state, result: blocked })
          );
          return blocked;
        }
      }
      let manualLargeApplyEvidence = null;
      if (options.manualLargeApply && !catchupSelection) {
        const existingGateReport = readJsonIfExists(
          paths.progressiveApplyGateReport,
          null
        );
        const existingPreview = readJsonIfExists(
          paths.progressiveApplyPreview,
          null
        );
        manualLargeApplyEvidence =
          validateManualLargeApplyEvidence({
            state,
            gateReport: existingGateReport,
            preview: existingPreview,
            audit,
          });
        if (
          manualLargeApplyEvidence.allowed &&
          manualLargeApplyEvidence.authorizedWouldApplyCount >
            SMOKINGPIPES_CATCHUP_BATCH_LIMIT
        ) {
          manualLargeApplyEvidence.allowed = false;
          manualLargeApplyEvidence.blockers = [
            ...manualLargeApplyEvidence.blockers,
            `manual-large-apply cannot authorize more than ${SMOKINGPIPES_CATCHUP_BATCH_LIMIT}; use an immutable catch-up batch`,
          ];
          manualLargeApplyEvidence.blockedReason =
            manualLargeApplyEvidence.blockers.join("; ");
        }
        if (!manualLargeApplyEvidence.allowed) {
          return {
            version:
              "smokingpipes-progressive-partial-apply-preview-v1",
            generatedAt: new Date().toISOString(),
            status: "apply-blocked",
            manualLargeApply: true,
            candidateCount:
              manualLargeApplyEvidence.candidateCount,
            wouldApplyCount:
              manualLargeApplyEvidence.wouldApplyCount,
            isolatedCandidateCount:
              manualLargeApplyEvidence.isolatedCandidateCount,
            maxAutoApply: progressiveMaxAutoApplyFromEnv(),
            largeApplyWarningThreshold:
              LARGE_APPLY_WARNING_THRESHOLD,
            largeApplyWarning:
              manualLargeApplyEvidence.wouldApplyCount >
              LARGE_APPLY_WARNING_THRESHOLD,
            largeApplyBlocked:
              manualLargeApplyEvidence.wouldApplyCount >
              progressiveMaxAutoApplyFromEnv(),
            blockers: manualLargeApplyEvidence.blockers,
            blockedReason:
              manualLargeApplyEvidence.blockedReason,
            productionWritten: false,
            commitPerformed: false,
            pushPerformed: false,
          };
        }
      }
      const prepared = await prepareProgressiveApplyGate({
        root,
        paths,
        state,
        options,
        runId,
        maxAutoApplyOverride:
          catchupSelection
            ? SMOKINGPIPES_CATCHUP_BATCH_LIMIT
            : manualLargeApplyEvidence?.authorizedWouldApplyCount ||
          options.maxAutoApply,
        selectedEventIds: catchupSelection?.batch?.eventIds || null,
        persistCatchupPlan: !catchupSelection,
      });
      state = prepared.state;
      audit = prepared.artifacts.audit;
      candidateProducts = prepared.artifacts.candidate.products || [];
      const freshPreview = prepared.preview;
      const gate = prepared.gate;
      const publicNext = readProgressivePublicNext(paths);
      gate.blockers.push(...publicNext.blockers);
      if (gate.largeApplyWarning && options.verbose) {
        console.log(
          `APPLY warning: effectiveApplyCount ${gate.effectiveApplyCount} exceeds large-apply warning threshold ${gate.largeApplyWarningThreshold}; automatic apply remains subject to all safety gates and maxAutoApply=${gate.maxAutoApply}`
        );
      }
      if (manualLargeApplyEvidence) {
        if (
          gate.wouldApplyCount !==
          manualLargeApplyEvidence.wouldApplyCount
        ) {
          gate.blockers.push(
            `rebuilt wouldApplyCount ${gate.wouldApplyCount} does not match authorized ${manualLargeApplyEvidence.wouldApplyCount}`
          );
        }
        const rebuiltWouldApplyIds = [
          ...new Set(
            (freshPreview.wouldApplyProductIds || [])
              .map(String)
              .filter(Boolean)
          ),
        ].sort();
        if (
          JSON.stringify(rebuiltWouldApplyIds) !==
          JSON.stringify(
            manualLargeApplyEvidence.authorizedWouldApplyIds
          )
        ) {
          gate.blockers.push(
            "rebuilt wouldApplyProductIds do not match the offline authorized set"
          );
        }
      }
      if (catchupSelection) {
        const rebuiltSelection = selectSmokingpipesCatchupBatch({
          actionablePlan: prepared.artifacts.actionPlan,
          plan: readJsonIfExists(paths.smokingpipesCatchupPlan, null),
          batchNumber: options.manualCatchupBatch,
          planId: options.catchupPlanId,
          batchHash: options.catchupBatchHash,
          codeCommitSha: resolveCodeCommitSha(root),
          productionProducts,
        });
        if (!rebuiltSelection.valid) {
          gate.blockers.push(...rebuiltSelection.blockers);
        }
        if (
          gate.effectiveApplyCount !==
          catchupSelection.batch.expectedEffectiveApplyCount
        ) {
          gate.blockers.push(
            `catch-up effectiveApplyCount ${gate.effectiveApplyCount} does not match expected ${catchupSelection.batch.expectedEffectiveApplyCount}`
          );
        }
        if (
          new Set(gate.appliedEventIds || []).size !==
          catchupSelection.batch.eventIds.length
        ) {
          gate.blockers.push("catch-up selected event set is incomplete or duplicated");
        }
        gate.catchupBatch = {
          planId: options.catchupPlanId,
          batchNumber: options.manualCatchupBatch,
          batchHash: options.catchupBatchHash,
          expectedEffectiveApplyCount:
            catchupSelection.batch.expectedEffectiveApplyCount,
        };
      }
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
          largeApplyWarningThreshold:
            gate.largeApplyWarningThreshold,
          largeApplyWarning: gate.largeApplyWarning,
          largeApplyBlocked: gate.largeApplyBlocked,
          stateDailyRunId: gate.stateDailyRunId,
          stateManualReconcileBlocked:
            gate.stateManualReconcileBlocked,
          auditGeneratedAt: gate.auditGeneratedAt,
          previewGeneratedAt: gate.previewGeneratedAt,
          manualLargeApply:
            options.manualLargeApply === true,
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
      const productionWriteNeed = evaluateSmokingpipesProductionWriteNeed({
        effectiveApplyCount: gate.effectiveApplyCount,
        fieldChanges: gate.fieldChanges,
        productionBefore: productionProducts,
        productionAfter: productionSafeSubset,
      });
      if (productionWriteNeed.shouldSkipProductionWrite) {
        const noOpEventIds = [
          ...(gate.appliedEventIds || []),
          ...((prepared.artifacts.selectedActionPlan?.items || []).map(
            (item) => item.event?.eventId
          )),
        ];
        state = markSmokingpipesActionEventsSuperseded({
          state,
          eventIds: noOpEventIds,
          supersededRunId: runId,
        });
        await writeProgressiveDailyState(paths.progressiveState, state);
        const noChange = {
          version: "smokingpipes-progressive-partial-apply-preview-v1",
          generatedAt: new Date().toISOString(),
          status: "no-production-change",
          candidateCount: gate.candidateCount,
          wouldApplyCount: gate.wouldApplyCount,
          effectiveApplyCount: 0,
          appliedCount: 0,
          partialAppliedCount: 0,
          appliedCandidateIds: [],
          fieldChanges: [],
          isolatedCandidateCount: gate.isolatedCandidateCount,
          safeSubsetApply: gate.safeSubsetApply,
          maxAutoApply: gate.maxAutoApply,
          largeApplyWarningThreshold: gate.largeApplyWarningThreshold,
          largeApplyWarning: false,
          largeApplyBlocked: false,
          changeSummary: buildSmokingpipesChangeSummary({
            productionBefore: productionProducts,
            productionAfter: productionProducts,
            state,
            actualAppliedCount: 0,
            isolatedCandidateCount: gate.isolatedCandidateCount,
            failedIsolatedCount: gate.failedIsolatedCount,
            appliedCandidateIds: [],
            fieldChanges: [],
          }),
          productionWritten: false,
          commitPerformed: false,
          pushPerformed: false,
        };
        await writeJsonAtomic(paths.progressiveApplyPreview, noChange);
        await writeProgressiveReport(paths, makeReport({ mode: options.mode, state, result: noChange }));
        return noChange;
      }
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
      const changeSummary = buildSmokingpipesChangeSummary({
        productionBefore: productionProducts,
        productionAfter: productionSafeSubset,
        state,
        actualAppliedCount: gate.effectiveApplyCount,
        isolatedCandidateCount: gate.isolatedCandidateCount,
        failedIsolatedCount: gate.failedIsolatedCount,
        appliedCandidateIds: gate.appliedCandidateIds,
        fieldChanges: gate.fieldChanges,
      });
      if (!changeSummary.consistency.valid) {
        postApplyValidation.blockers.push(changeSummary.consistency.reason);
      }
      if (postApplyValidation.blockers.length) {
        const blocked = {
          version:
            "smokingpipes-progressive-partial-apply-preview-v1",
          generatedAt: new Date().toISOString(),
          status: "apply-blocked",
          candidateCount: gate.candidateCount,
          wouldApplyCount: gate.wouldApplyCount,
          effectiveApplyCount: gate.effectiveApplyCount,
          blockers: postApplyValidation.blockers,
          blockedReason: postApplyValidation.blockers.join("; "),
          warnings: postApplyValidation.warnings,
          wouldApplyProductIds:
            freshPreview.wouldApplyProductIds || [],
          applyGap: gate.applyGap,
          isolatedCandidateCount:
            gate.isolatedCandidateCount,
          failedIsolatedCount: gate.failedIsolatedCount,
          maxAutoApply: gate.maxAutoApply,
          largeApplyWarningThreshold:
            gate.largeApplyWarningThreshold,
          largeApplyWarning: gate.largeApplyWarning,
          largeApplyBlocked: gate.largeApplyBlocked,
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
      let catchupReceipt = null;
      if (catchupSelection) {
        catchupReceipt = buildCatchupReceipt({
          selection: catchupSelection,
          runId,
          productionBefore: productionProducts,
          productionAfter: productionSafeSubset,
          phase: "prepared",
        });
        await writeJsonAtomic(paths.smokingpipesCatchupReceipt, catchupReceipt);
      }
      const backup = createProgressiveProductionBackup(paths);
      if (catchupReceipt) {
        catchupReceipt = {
          ...catchupReceipt,
          backup,
        };
        await writeJsonAtomic(paths.smokingpipesCatchupReceipt, catchupReceipt);
      }
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
      if (catchupReceipt) {
        catchupReceipt = buildCatchupReceipt({
          selection: catchupSelection,
          runId,
          productionBefore: productionProducts,
          productionAfter: productionSafeSubset,
          phase: "production-written",
          backup,
          prior: catchupReceipt,
        });
        await writeJsonAtomic(paths.smokingpipesCatchupReceipt, catchupReceipt);
      }
      state = markSmokingpipesActionEventsApplied({
        state,
        eventIds: gate.appliedEventIds || [],
        appliedRunId: runId,
      });
      await writeProgressiveDailyState(paths.progressiveState, state);
      if (catchupReceipt) {
        catchupReceipt = buildCatchupReceipt({
          selection: catchupSelection,
          runId,
          productionBefore: productionProducts,
          productionAfter: productionSafeSubset,
          phase: "events-committed",
          backup,
          prior: catchupReceipt,
        });
        await writeJsonAtomic(paths.smokingpipesCatchupReceipt, catchupReceipt);
      }
      const completed = {
        version:
          "smokingpipes-progressive-partial-apply-preview-v1",
        generatedAt: new Date().toISOString(),
        status: "apply-complete",
        candidateCount: gate.candidateCount,
        wouldApplyCount: gate.wouldApplyCount,
        effectiveApplyCount: gate.effectiveApplyCount,
        partialAppliedCount: gate.effectiveApplyCount,
        appliedCount: gate.effectiveApplyCount,
        wouldApplyProductIds: freshPreview.wouldApplyProductIds,
        appliedCandidateIds: gate.appliedCandidateIds,
        fieldChanges: gate.fieldChanges,
        safeSubsetApply: gate.safeSubsetApply,
        isolatedCandidateCount:
          gate.isolatedCandidateCount,
        failedIsolatedCount: gate.failedIsolatedCount,
        changeSummary,
        applyGap: gate.applyGap,
        maxAutoApply: gate.maxAutoApply,
        largeApplyWarningThreshold:
          gate.largeApplyWarningThreshold,
        largeApplyWarning: gate.largeApplyWarning,
        largeApplyBlocked: gate.largeApplyBlocked,
        manualLargeApply:
          options.manualLargeApply === true,
        catchupBatch: catchupSelection
          ? {
              planId: options.catchupPlanId,
              batchNumber: options.manualCatchupBatch,
              batchHash: options.catchupBatchHash,
              receiptPath: path.relative(root, paths.smokingpipesCatchupReceipt),
            }
          : null,
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
      await writeJsonAtomic(paths.progressiveAuditJson, {
        ...audit,
        isolatedCandidateCount: gate.isolatedCandidateCount,
        failedIsolatedCount: gate.failedIsolatedCount,
        changeSummary,
      });
      await writeJsonAtomic(paths.progressiveApplyGateReport, {
        ...gate,
        isolatedCandidateCount: gate.isolatedCandidateCount,
        failedIsolatedCount: gate.failedIsolatedCount,
        changeSummary,
      });
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
