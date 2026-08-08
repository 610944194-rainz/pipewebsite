import fs from "node:fs";
import path from "node:path";
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
  createProgressiveDailyState,
  readProgressiveDailyState,
  writeProgressiveDailyState,
} from "./smokingpipes-progressive-state-v1.mjs";
import {
  buildProgressiveStateSummary,
  ingestProgressiveListSnapshot,
  runProgressiveDetailChunk,
} from "./smokingpipes-progressive-daily-v1.mjs";
import {
  randomDelayMs,
} from "./smokingpipes-fetch-current-list-v1.mjs";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function refreshSummary(state, now = new Date().toISOString()) {
  const next = structuredClone(state);
  next.updatedAt = now;
  next.summary = buildProgressiveStateSummary(next, now);
  return next;
}

function deadlineRemainingMs(options = {}) {
  const deadlineAtMs =
    options.deadlineAtMs === null || options.deadlineAtMs === undefined
      ? Number.NaN
      : Number(options.deadlineAtMs);
  if (!Number.isFinite(deadlineAtMs)) return null;
  const nowMs = typeof options.nowMs === "function" ? options.nowMs : Date.now;
  return Math.max(0, deadlineAtMs - nowMs());
}

function dailyDeadlineError(stage) {
  return Object.assign(new Error(`daily deadline reached ${stage}`), {
    code: "DAILY_DEADLINE_REACHED",
  });
}

async function createDetailProcessor({ root, paths, options, runId, browserSession = null }) {
  const ownsBrowserSession = !browserSession;
  const session = browserSession || await launchSmokingpipesContext({
    root,
    browserChannel: options.browserChannel,
    browserProfile: options.browserProfile,
    profileLockPath: paths.browserProfileLock,
    runId,
    mode: "smokingpipes-v2-detail-enrichment",
  });
  const page = session.context.pages()[0] || await session.context.newPage();
  const verificationState = { verificationDetected: false, manualVerificationRecovered: false };
  let requestCount = 0;
  return {
    browserStarted: true,
    verificationState,
    async process(candidate) {
      if (deadlineRemainingMs(options) === 0) {
        throw dailyDeadlineError("before detail request");
      }
      const response = await page.goto(candidate.sourceUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      requestCount += 1;
      if (options.detailBatchSize > 0 && requestCount % options.detailBatchSize === 0) {
        await page.waitForTimeout(randomDelayMs(options.detailBatchCooldownMinMs, options.detailBatchCooldownMaxMs));
      }
      await page.waitForTimeout(randomDelayMs(options.detailWarmupMinMs, options.detailWarmupMaxMs));
      const detection = await detectSmokingpipesVerification(page, { pageKind: "detail", httpStatus: response?.status() || 0 });
      let detail = null;
      if (detection.verificationBlocked && options.allowManualVerification) {
        verificationState.verificationDetected = true;
        const remainingMs = deadlineRemainingMs(options);
        if (remainingMs === 0) throw dailyDeadlineError("during detail verification");
        const recovery = await waitForSmokingpipesManualRecovery(page, {
          pageKind: "detail",
          timeoutMs:
            remainingMs === null
              ? options.manualVerificationTimeoutMs
              : Math.min(options.manualVerificationTimeoutMs, remainingMs),
          restoreTargetPage: (target) => target.goto(candidate.sourceUrl, { waitUntil: "domcontentloaded", timeout: 60000 }),
          verifyNormalContent: async (target) => {
            const parsed = addParsedMeasurements(await extractDetailProduct(target, candidate, "new"));
            return { valid: isNormalSmokingpipesDetail(parsed, candidate.sourceProductId), parsedValue: parsed };
          },
        });
        if (deadlineRemainingMs(options) === 0) {
          throw dailyDeadlineError("after detail verification");
        }
        if (recovery.recovered) {
          verificationState.manualVerificationRecovered = true;
          detail = recovery.parsedValue;
        }
      }
      if (detection.verificationBlocked && !detail) {
        throw Object.assign(new Error(`strong verification at ${candidate.sourceProductId}`), { code: "CAPTCHA_REQUIRED" });
      }
      detail ||= addParsedMeasurements(await extractDetailProduct(page, candidate, "new"));
      if (!isNormalSmokingpipesDetail(detail, candidate.sourceProductId)) {
        throw new Error(`detail parse failed for ${candidate.sourceProductId}`);
      }
      const conversion = convertSmokingpipesCandidateDetails([detail], [{
        sourceProductId: candidate.sourceProductId,
        sourceUrl: candidate.sourceUrl,
        title: candidate.listTitle,
        price: candidate.listPrice,
        imageUrl: candidate.listPrimaryImage,
      }]);
      return {
        detail,
        convertedProduct: conversion.products[0] || null,
        publicReady: conversion.products.length === 1 && conversion.failures.length === 0,
        reviewOnly: conversion.products.length !== 1 || conversion.failures.length > 0,
      };
    },
    close: () => ownsBrowserSession ? session.close() : Promise.resolve(),
  };
}

export async function ingestSmokingpipesListV2({ paths, snapshotPath, diffPath, productionProducts, runId }) {
  const existing = readProgressiveDailyState(paths.progressiveState);
  if (existing.status === "blocked") return { status: "blocked", blockedReason: existing.errors.join("; ") };
  const snapshot = readJson(snapshotPath);
  const diff = readJson(diffPath);
  const state = ingestProgressiveListSnapshot({
    state: existing.state || createProgressiveDailyState({ dailyRunId: runId, expectedPages: Number(snapshot.summary?.expectedPages || 1) }),
    currentPayload: snapshot,
    diffPayload: diff,
    productionProducts,
    runId,
    currentListPath: snapshotPath,
    diffPath,
    currentListFresh: true,
  });
  await writeProgressiveDailyState(paths.progressiveState, refreshSummary(state));
  return { status: "ingest-ready", state };
}

export async function enrichSmokingpipesDetailsV2({ root, paths, detailLimit = 50, options = {}, processDetail = null, browserSession = null, onDetailSettled = async () => {} }) {
  const stateRead = readProgressiveDailyState(paths.progressiveState);
  if (stateRead.status !== "passed") return { status: "blocked", blockedReason: stateRead.errors.join("; ") };
  const runId = `sp-v2-${Date.now()}`;
  const processor = typeof processDetail === "function"
    ? { browserStarted: false, process: processDetail, close: async () => {} }
    : await createDetailProcessor({ root, paths, options, runId, browserSession });
  try {
    const result = await runProgressiveDetailChunk({
      state: stateRead.state,
      maxItems: Math.min(50, Math.max(1, Number(detailLimit) || 50)),
      runId,
      processDetail: processor.process,
      retryFailedDetails: true,
      maxDetailAttempts: 3,
      onDetailSettled,
      checkpoint: (state) => writeProgressiveDailyState(paths.progressiveState, refreshSummary(state)),
      shouldStartDetail: () => {
        if (deadlineRemainingMs(options) === 0) {
          return {
            allowed: false,
            code: "DAILY_DEADLINE_REACHED",
            reason: "daily deadline reached before the next detail",
          };
        }
        return { allowed: true };
      },
    });
    result.browserStarted = processor.browserStarted;
    result.state = refreshSummary(result.state);
    await writeProgressiveDailyState(paths.progressiveState, result.state);
    return result.deadlineReached
      ? { ...result, status: "deadline-reached" }
      : result;
  } finally {
    await processor.close();
  }
}
