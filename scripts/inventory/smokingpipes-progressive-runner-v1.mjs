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
  ingestProgressiveListSnapshot,
  normalizeProgressivePublicStatuses,
  runProgressiveDetailChunk,
  summarizeProgressiveState,
} from "./smokingpipes-progressive-daily-v1.mjs";
import {
  auditProgressivePartialCandidate,
  buildProgressivePartialApplyPreview,
  buildProgressivePartialProducts,
  selectProgressiveRecentNew,
} from "./smokingpipes-progressive-candidate-v1.mjs";
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
- wouldApplyCount: ${report.wouldApplyCount || 0}
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
    wouldApplyCount: result.wouldApplyCount || 0,
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
}) {
  const session = await launchSmokingpipesContext({
    root,
    browserChannel: options.browserChannel,
    browserProfile: options.browserProfile,
    browserProfileDir: options.browserProfileDir,
    profileLockPath: paths.browserProfileLock,
    runId,
    mode: "progressive-detail-chunk",
  });
  const page =
    session.context.pages()[0] ||
    (await session.context.newPage());
  return {
    browserStarted: true,
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
          detail = recovery.parsedValue;
        }
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

function evaluateProgressiveProductionApplyGate({
  audit,
  preview,
  candidateProducts,
  publicPayloads,
}) {
  const blockers = [];
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
    audit?.candidateCount ?? preview?.wouldApplyCount ?? 0
  );
  const wouldApplyCount = Number(
    audit?.wouldApplyCount ?? preview?.wouldApplyCount ?? 0
  );
  if (!(candidateCount > 0)) {
    blockers.push("candidateCount must be greater than 0");
  }
  if (candidateCount !== wouldApplyCount) {
    blockers.push(
      `candidateCount ${candidateCount} does not match wouldApplyCount ${wouldApplyCount}`
    );
  }
  if (wouldApplyCount !== Number(preview?.wouldApplyCount || 0)) {
    blockers.push(
      `audit wouldApplyCount ${wouldApplyCount} does not match preview wouldApplyCount ${preview?.wouldApplyCount || 0}`
    );
  }
  if (preview?.status !== "preview-ready") {
    blockers.push(
      `preview status is ${preview?.status || "missing"}`
    );
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
    candidateCount,
    wouldApplyCount,
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
  const applyPreview = buildProgressivePartialApplyPreview({
    state,
    audit,
    productionProducts,
    candidateProducts: candidate.products,
  });
  audit.candidateCount = candidate.appliedCandidateIds.length;
  audit.wouldApplyCount = applyPreview.wouldApplyCount || 0;
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

    if (options.mode === "progressive-detail-chunk") {
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
          artifacts.candidate.appliedCandidateIds.length,
        wouldApplyCount:
          artifacts.candidate.appliedCandidateIds.length,
        productionWritten: false,
      };
      await writeProgressiveReport(
        paths,
        makeReport({ mode: options.mode, state, result })
      );
      return result;
    }

    const audit = readJsonIfExists(
      paths.progressiveAuditJson,
      null
    );
    const candidateProducts = items(
      readJsonIfExists(
        paths.progressiveProductsNext,
        []
      )
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
      const publicNext = readProgressivePublicNext(paths);
      const gate = evaluateProgressiveProductionApplyGate({
        audit,
        preview,
        candidateProducts,
        publicPayloads: publicNext.payloads,
      });
      gate.blockers.push(...publicNext.blockers);
      gate.blockers = [...new Set(gate.blockers)];
      if (gate.blockers.length) {
        const blocked = {
          version:
            "smokingpipes-progressive-partial-apply-preview-v1",
          generatedAt: new Date().toISOString(),
          status: "apply-blocked",
          candidateCount: gate.candidateCount,
          wouldApplyCount: gate.wouldApplyCount,
          blockers: gate.blockers,
          wouldApplyProductIds:
            preview.wouldApplyProductIds || [],
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
      await writeJsonAtomic(
        paths.existingProducts,
        candidateProducts
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
        wouldApplyProductIds: preview.wouldApplyProductIds,
        productionWritten: true,
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
