import fs from "node:fs";
import {
  acquireRunLock,
  formatRunId,
  getRunnerPaths,
  releaseRunLock,
  writeJsonAtomic,
  writeTextAtomic,
} from "./inventory-runner-core-v1.mjs";
import { fetchSmokingpipesCurrentList } from "./smokingpipes-fetch-current-list-v1.mjs";
import {
  buildVerificationProbeTelemetry,
  buildVerificationTelemetryMarkdown,
} from "./smokingpipes-verification-telemetry-v1.mjs";
import { buildSmokingpipesBrowserDescriptor } from "../lib/smokingpipes-browser-profile-v1.mjs";

function pacingFromOptions(options) {
  return {
    pageWarmupMinMs: options.pageWarmupMinMs,
    pageWarmupMaxMs: options.pageWarmupMaxMs,
    pageDelayMinMs: options.pageDelayMinMs,
    pageDelayMaxMs: options.pageDelayMaxMs,
    pageBatchSize: options.pageBatchSize,
    pageBatchCooldownMinMs: options.pageBatchCooldownMinMs,
    pageBatchCooldownMaxMs: options.pageBatchCooldownMaxMs,
  };
}

function mockPages(options, startedAt) {
  const strongPage =
    options.mockVerification === "strong"
      ? Math.min(73, options.maxPages)
      : null;
  const pageCount = strongPage || options.maxPages;
  const simulatedAverageMs =
    options.pageDelayMinMs >= 3000 ? 9045 : 4627;
  return Array.from({ length: pageCount }, (_, index) => {
    const page = index + 1;
    const pageStarted = new Date(
      Date.parse(startedAt) + index * simulatedAverageMs
    ).toISOString();
    const pageEnded = new Date(
      Date.parse(pageStarted) + simulatedAverageMs
    ).toISOString();
    const strong = page === strongPage ? ["challenge-dom"] : [];
    const weak = [];
    return {
      page,
      url: `https://example.invalid/smokingpipes?page=${page}`,
      startedAt: pageStarted,
      endedAt: pageEnded,
      durationMs: simulatedAverageMs,
      warmupMs: options.pageWarmupMinMs,
      delayMs: page < options.maxPages ? options.pageDelayMinMs : 0,
      batchCooldownMs:
        page < options.maxPages &&
        options.pageBatchSize > 0 &&
        page % options.pageBatchSize === 0
          ? options.pageBatchCooldownMinMs
          : 0,
      productsParsed: strong.length ? 0 : 48,
      outOfStockProducts: page >= 104 ? 12 : 0,
      missingPriceProducts: page >= 104 ? 12 : 0,
      weakVerificationSignals: weak,
      strongVerificationSignals: strong,
      finalClassification: strong.length
        ? "strong-verification"
        : weak.length
          ? "normal-content-with-verification-warning"
          : "normal-content",
      screenshotPath: null,
      htmlSamplePath: null,
    };
  });
}

async function writeProbeOutputs(paths, telemetry) {
  await writeJsonAtomic(paths.verificationTelemetry, telemetry);
  await writeTextAtomic(
    paths.verificationTelemetryReport,
    buildVerificationTelemetryMarkdown(telemetry)
  );
}

export async function runSmokingpipesVerificationProbe({
  root = process.cwd(),
  options,
}) {
  const paths = getRunnerPaths(root, { mock: options.mock });
  const runId = formatRunId();
  const startedAt = new Date().toISOString();
  const pages = [];
  let blockedReason = "";
  let lock = null;
  let browser = buildSmokingpipesBrowserDescriptor({
    root,
    browserChannel: options.browserChannel,
    browserProfile: options.browserProfile,
    browserProfileDir: options.browserProfileDir,
  });
  let manualVerificationRecovered = false;

  try {
    lock = acquireRunLock(
      paths.verificationProbeLock,
      { runId, source: "smokingpipes", mode: "verification-probe" },
      options.forceUnlock
    );

    if (options.mock) {
      pages.push(...mockPages(options, startedAt));
      if (
        pages.some(
          (page) =>
            (page.strongVerificationSignals || []).length > 0
        )
      ) {
        blockedReason =
          "strong verification detected in mock probe";
      }
    } else {
      try {
        const currentPayload =
          await fetchSmokingpipesCurrentList({
          root,
          runId,
          mode: "verification-probe",
          maxPages: options.maxPages,
          expectedPages: options.expectedPages,
          browserChannel: options.browserChannel,
          browserProfile: options.browserProfile,
          browserProfileDir: options.browserProfileDir,
          browserProfileLockPath: paths.browserProfileLock,
          allowManualVerification: options.allowManualVerification,
          manualVerificationTimeoutMs:
            options.manualVerificationTimeoutMs,
          pageDelayMinMs: options.pageDelayMinMs,
          pageDelayMaxMs: options.pageDelayMaxMs,
          pageWarmupMinMs: options.pageWarmupMinMs,
          pageWarmupMaxMs: options.pageWarmupMaxMs,
          pageBatchSize: options.pageBatchSize,
          pageBatchCooldownMinMs: options.pageBatchCooldownMinMs,
          pageBatchCooldownMaxMs: options.pageBatchCooldownMaxMs,
          captchaCooldownMs: 0,
          verbose: options.verbose,
          writeCurrentList: false,
          useCheckpoint: false,
          onPageTelemetry: async (pageTelemetry) => {
            pages.push(pageTelemetry);
          },
        });
        browser =
          currentPayload.config?.browser || browser;
        manualVerificationRecovered =
          currentPayload.summary
            ?.manualVerificationRecovered === true;
      } catch (error) {
        blockedReason = error.message;
        browser = error?.browser || browser;
        manualVerificationRecovered =
          error?.manualVerificationRecovered === true;
        if (error?.code !== "CAPTCHA_REQUIRED") throw error;
      }
    }

    const endedAt =
      options.mock && pages.length
        ? pages.at(-1).endedAt
        : new Date().toISOString();
    const telemetry = buildVerificationProbeTelemetry({
      runId,
      startedAt,
      endedAt,
      pagesRequested: options.maxPages,
      pacing: pacingFromOptions(options),
      pages,
      blockedReason,
      browser,
      manualVerificationAllowed:
        options.allowManualVerification,
      manualVerificationRecovered,
    });
    await writeProbeOutputs(paths, telemetry);
    return {
      status: telemetry.captchaDetected ? "blocked" : "probe-complete",
      telemetry,
      telemetryPath: paths.verificationTelemetry,
      reportPath: paths.verificationTelemetryReport,
      candidateGenerated: false,
      detailsFetched: false,
      productionWritten: false,
      commitPerformed: false,
      pushPerformed: false,
    };
  } finally {
    if (lock && fs.existsSync(paths.verificationProbeLock)) {
      releaseRunLock(lock);
    }
  }
}
