import fs from "node:fs";
import {
  addParsedMeasurements,
  detectSmokingpipesVerification,
  extractDetailProduct,
  isNormalSmokingpipesDetail,
  launchSmokingpipesContext,
  waitForSmokingpipesManualRecovery,
} from "../lib/smokingpipes-utils.mjs";
import { buildSmokingpipesBrowserDescriptor } from "../lib/smokingpipes-browser-profile-v1.mjs";
import {
  acquireRunLock,
  formatRunId,
  getRunnerPaths,
  readJsonIfExists,
  releaseRunLock,
  writeJsonAtomic,
  writeTextAtomic,
} from "./inventory-runner-core-v1.mjs";
import { randomDelayMs } from "./smokingpipes-fetch-current-list-v1.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function durationMs(startedAt, endedAt) {
  const start = Date.parse(startedAt || "");
  const end = Date.parse(endedAt || "");
  return Number.isFinite(start) && Number.isFinite(end) && end >= start
    ? end - start
    : 0;
}

export function selectTrustedDetailProbeCandidates({
  diff,
  currentProducts = [],
  detailProbeMax = 5,
}) {
  const trusted =
    diff?.allowApply === true &&
    diff?.coverage?.fullExpectedRangeScanned === true &&
    diff?.coverage?.captchaDetected !== true &&
    (diff?.fatalWarnings || []).length === 0;
  if (!trusted) {
    return {
      trusted: false,
      reason:
        "detail-probe requires allowApply=true, captchaDetected=false, and fullExpectedRangeScanned=true",
      candidates: [],
    };
  }

  const currentById = new Map(
    currentProducts.map((item) => [
      text(item.sourceProductId),
      item,
    ])
  );
  const candidates = (diff.newIds || [])
    .map((id) => currentById.get(String(id)))
    .filter((item) => item && text(item.sourceUrl))
    .slice(0, Math.max(1, Number(detailProbeMax) || 5));
  return {
    trusted: true,
    reason: candidates.length
      ? "trusted daily diff newIds"
      : "no trusted daily diff newIds are available",
    candidates,
  };
}

export function simulateDetailProbe({
  candidates = [],
  detailProbeMax = 5,
  strongVerificationAt = null,
  weakVerificationAt = null,
  manualVerificationRecoveredAt = null,
  startedAt = "2026-06-22T00:00:00.000Z",
}) {
  const observations = [];
  let stoppedForStrongVerification = false;
  let stoppedAfterWeakVerification = false;
  const selected = candidates.slice(
    0,
    Math.max(1, Number(detailProbeMax) || 5)
  );
  for (let index = 0; index < selected.length; index += 1) {
    const item = selected[index];
    const position = index + 1;
    const strong = position === strongVerificationAt;
    const weak = position === weakVerificationAt;
    const manuallyRecovered =
      strong && position === manualVerificationRecoveredAt;
    const detailStartedAt = new Date(
      Date.parse(startedAt) + index * 10000
    ).toISOString();
    const detailEndedAt = new Date(
      Date.parse(detailStartedAt) + 8000
    ).toISOString();
    observations.push({
      sourceProductId: text(item.sourceProductId),
      url: text(item.sourceUrl),
      startedAt: detailStartedAt,
      endedAt: detailEndedAt,
      durationMs: 8000,
      warmupMs: 2000,
      delayMs: position < selected.length ? 6000 : 0,
      parsedSuccessfully: !strong || manuallyRecovered,
      weakVerificationSignals: weak
        ? ["verification-keyword"]
        : [],
      strongVerificationSignals: strong && !manuallyRecovered
        ? ["challenge-dom"]
        : [],
      finalClassification: strong && !manuallyRecovered
        ? "strong-verification"
        : weak
          ? "normal-content-with-verification-warning"
          : "normal-content",
      verificationDetectedAt: strong
        ? detailStartedAt
        : null,
      manualVerificationAllowed: manuallyRecovered,
      manualVerificationRecovered: manuallyRecovered,
      error:
        strong && !manuallyRecovered
          ? "strong verification detected"
          : null,
    });
    if (strong && !manuallyRecovered) {
      stoppedForStrongVerification = true;
      break;
    }
    if (weak) {
      stoppedAfterWeakVerification = true;
      break;
    }
  }
  return {
    observations,
    stoppedForStrongVerification,
    stoppedAfterWeakVerification,
  };
}

export function buildDetailProbeTelemetry({
  runId,
  startedAt,
  endedAt,
  detailProbeMax,
  observations = [],
  blockedReason = "",
  candidateSource = "trusted-diff-newIds",
  browser = null,
  manualVerificationAllowed = false,
  manualVerificationRecovered = false,
}) {
  const firstWeak = observations.find(
    (item) => (item.weakVerificationSignals || []).length
  );
  const firstStrong = observations.find(
    (item) => (item.strongVerificationSignals || []).length
  );
  const verificationObservation = observations.find(
    (item) =>
      item.verificationDetectedAt ||
      (item.strongVerificationSignals || []).length
  );
  const succeeded = observations.filter(
    (item) => item.parsedSuccessfully
  ).length;
  const failed = observations.length - succeeded;
  const totalDuration = durationMs(startedAt, endedAt);
  return {
    version: "smokingpipes-detail-probe-telemetry-v1",
    runId,
    mode: "detail-probe",
    source: "smokingpipes",
    startedAt,
    endedAt,
    totalDurationMs: totalDuration,
    detailProbeMax: Number(detailProbeMax) || 5,
    candidateSource,
    detailsAttempted: observations.length,
    detailsSucceeded: succeeded,
    detailsFailed: failed,
    firstWeakSignalDetail: firstWeak?.sourceProductId || null,
    firstStrongSignalDetail: firstStrong?.sourceProductId || null,
    captchaDetected: Boolean(firstStrong),
    verificationDetectedAt:
      verificationObservation?.verificationDetectedAt ||
      verificationObservation?.startedAt ||
      null,
    blockedReason: blockedReason || null,
    browser: browser || null,
    manualVerificationAllowed: Boolean(
      manualVerificationAllowed
    ),
    manualVerificationRecovered: Boolean(
      manualVerificationRecovered
    ),
    avgSecondsPerDetail:
      observations.length > 0
        ? Math.round(
            (totalDuration / 1000 / observations.length) * 1000
          ) / 1000
        : 0,
    observations,
    candidateGenerated: false,
    productionWritten: false,
    commitPerformed: false,
    pushPerformed: false,
  };
}

function buildDetailProbeMarkdown(telemetry) {
  const rows = telemetry.observations
    .map(
      (item) =>
        `| ${item.sourceProductId} | ${item.durationMs} | ${item.parsedSuccessfully} | ${(item.weakVerificationSignals || []).join(", ") || "none"} | ${(item.strongVerificationSignals || []).join(", ") || "none"} | ${item.finalClassification} | ${item.error || "none"} |`
    )
    .join("\n");
  return `# Smokingpipes Detail Probe

- runId: ${telemetry.runId}
- mode: detail-probe
- status: ${telemetry.blockedReason ? "blocked" : telemetry.detailsAttempted ? "probe-complete" : "no-detail-probe-candidates"}
- detailProbeMax: ${telemetry.detailProbeMax}
- candidate source: ${telemetry.candidateSource}
- details attempted: ${telemetry.detailsAttempted}
- details succeeded: ${telemetry.detailsSucceeded}
- details failed: ${telemetry.detailsFailed}
- first weak signal detail: ${telemetry.firstWeakSignalDetail || "none"}
- first strong signal detail: ${telemetry.firstStrongSignalDetail || "none"}
- CAPTCHA detected: ${telemetry.captchaDetected}
- verification detectedAt: ${telemetry.verificationDetectedAt || "none"}
- blocked reason: ${telemetry.blockedReason || "none"}
- requested browser channel: ${telemetry.browser?.requestedBrowserChannel || "automatic"}
- effective browser channel: ${telemetry.browser?.effectiveBrowserChannel || "automatic"}
- requested browser profile: ${telemetry.browser?.requestedBrowserProfile || "none"}
- requested browser profile dir: ${telemetry.browser?.requestedBrowserProfileDir || "none"}
- effective profile dir: ${telemetry.browser?.profileDir || "none"}
- profile source: ${telemetry.browser?.profileSource || "none"}
- persistent context: ${Boolean(telemetry.browser?.persistentContext)}
- executable path: ${telemetry.browser?.executablePath || "unavailable"}
- user data dir created: ${Boolean(telemetry.browser?.userDataDirCreated)}
- manual verification allowed: ${Boolean(telemetry.manualVerificationAllowed)}
- manual verification recovered: ${Boolean(telemetry.manualVerificationRecovered)}
- average seconds per detail: ${telemetry.avgSecondsPerDetail}
- total duration ms: ${telemetry.totalDurationMs}
- candidate generated: false
- production written: false
- commit performed: false
- push performed: false

| Source product ID | Duration ms | Parsed | Weak signals | Strong signals | Classification | Error |
| --- | ---: | --- | --- | --- | --- | --- |
${rows || "| none | 0 | false | none | none | no-candidates | none |"}
`;
}

async function writeOutputs(paths, telemetry) {
  await writeJsonAtomic(paths.detailProbeTelemetry, telemetry);
  await writeTextAtomic(
    paths.detailProbeReport,
    buildDetailProbeMarkdown(telemetry)
  );
}

export async function runSmokingpipesDetailProbe({
  root = process.cwd(),
  options,
}) {
  const paths = getRunnerPaths(root, { mock: options.mock });
  const runId = formatRunId();
  const startedAt = new Date().toISOString();
  const requestedBrowser =
    buildSmokingpipesBrowserDescriptor({
      root,
      browserChannel: options.browserChannel,
      browserProfile: options.browserProfile,
      browserProfileDir: options.browserProfileDir,
    });
  const diff = options.mock
    ? {
        allowApply: true,
        coverage: {
          fullExpectedRangeScanned: true,
          captchaDetected: false,
        },
        fatalWarnings: [],
        newIds: ["990001", "990002", "990003", "990004", "990005"],
      }
    : readJsonIfExists(paths.diff, null);
  const currentPayload = options.mock
    ? {
        products: diff.newIds.map((id) => ({
          sourceProductId: id,
          sourceUrl: `https://example.invalid/moreinfo.cfm?product_id=${id}`,
          title: `Mock probe ${id}`,
        })),
      }
    : readJsonIfExists(paths.currentList, null);
  const selection = selectTrustedDetailProbeCandidates({
    diff,
    currentProducts: currentPayload?.products || [],
    detailProbeMax: options.detailProbeMax,
  });
  let lock = null;

  if (!selection.trusted || selection.candidates.length === 0) {
    const endedAt = new Date().toISOString();
    const telemetry = buildDetailProbeTelemetry({
      runId,
      startedAt,
      endedAt,
      detailProbeMax: options.detailProbeMax,
      observations: [],
      blockedReason: "",
      candidateSource: selection.reason,
      browser: requestedBrowser,
      manualVerificationAllowed:
        options.allowManualVerification,
      manualVerificationRecovered: false,
    });
    await writeOutputs(paths, telemetry);
    return {
      status: "no-detail-probe-candidates",
      telemetry,
      browserStarted: false,
    };
  }

  try {
    lock = acquireRunLock(
      paths.detailProbeLock,
      { runId, source: "smokingpipes", mode: "detail-probe" },
      options.forceUnlock
    );
    const observations = [];
    let blockedReason = "";
    let browser = requestedBrowser;
    let manualVerificationRecovered = false;

    if (options.mock) {
      const simulated = simulateDetailProbe({
        candidates: selection.candidates,
        detailProbeMax: options.detailProbeMax,
        startedAt,
        weakVerificationAt:
          options.mockVerification === "weak" ? 3 : null,
        manualVerificationRecoveredAt:
          options.mockVerification === "strong-recovered"
            ? 3
            : null,
        strongVerificationAt:
          ["strong", "strong-recovered"].includes(
            options.mockVerification
          )
            ? 3
            : null,
      });
      observations.push(...simulated.observations);
      manualVerificationRecovered = observations.some(
        (item) =>
          item.manualVerificationRecovered === true
      );
      if (simulated.stoppedForStrongVerification) {
        blockedReason = "strong verification detected";
      }
    } else {
      process.env.SMOKINGPIPES_HEADLESS =
        options.allowManualVerification ? "false" : "true";
      const browserSession = await launchSmokingpipesContext({
        root,
        browserChannel: options.browserChannel,
        browserProfile: options.browserProfile,
        browserProfileDir: options.browserProfileDir,
        profileLockPath: paths.browserProfileLock,
        runId,
        mode: "detail-probe",
      });
      const context = browserSession.context;
      browser = browserSession.browser;
      const page = context.pages()[0] || (await context.newPage());
      try {
        for (
          let index = 0;
          index < selection.candidates.length;
          index += 1
        ) {
          const item = selection.candidates[index];
          const detailStartedAt = new Date().toISOString();
          const warmupMs = randomDelayMs(
            options.detailWarmupMinMs,
            options.detailWarmupMaxMs
          );
          let parsedSuccessfully = false;
          let errorText = null;
          let weakSignals = [];
          let strongSignals = [];
          let finalClassification = "unknown-or-parse-failure";
          let verificationDetectedAt = null;
          let recoveredThisDetail = false;
          try {
            const response = await page.goto(item.sourceUrl, {
              waitUntil: "domcontentloaded",
              timeout: 60000,
            });
            if (warmupMs > 0) await page.waitForTimeout(warmupMs);
            const detection = await detectSmokingpipesVerification(
              page,
              {
                pageKind: "detail",
                httpStatus: response?.status() || 0,
              }
            );
            weakSignals = detection.weakVerificationSignals || [];
            strongSignals = detection.strongVerificationSignals || [];
            finalClassification = detection.classification;
            if (detection.verificationBlocked || strongSignals.length) {
              if (options.allowManualVerification) {
                const recovery =
                  await waitForSmokingpipesManualRecovery(
                    page,
                    {
                      pageKind: "detail",
                      timeoutMs:
                        options.manualVerificationTimeoutMs,
                      verbose: options.verbose,
                      restoreTargetPage: async (targetPage) => {
                        await targetPage.goto(item.sourceUrl, {
                          waitUntil: "domcontentloaded",
                          timeout: 60000,
                        });
                      },
                      verifyNormalContent: async (
                        targetPage
                      ) => {
                        const parsed =
                          addParsedMeasurements(
                            await extractDetailProduct(
                              targetPage,
                              item,
                              "new"
                            )
                          );
                        return {
                          valid:
                            isNormalSmokingpipesDetail(
                              parsed,
                              item.sourceProductId
                            ),
                          parsedValue: parsed,
                        };
                      },
                    }
                  );
                verificationDetectedAt =
                  recovery.verificationDetectedAt;
                recoveredThisDetail =
                  recovery.manualVerificationRecovered;
                manualVerificationRecovered ||= recoveredThisDetail;
                if (recovery.recovered) {
                  parsedSuccessfully = true;
                  strongSignals = [];
                  finalClassification = "normal-content";
                }
              }
              if (!parsedSuccessfully) {
                blockedReason =
                  `strong verification detected at ${item.sourceProductId}`;
                errorText = blockedReason;
              }
            } else {
              const detail = addParsedMeasurements(
                await extractDetailProduct(page, item, "new")
              );
              parsedSuccessfully =
                text(detail.sourceProductId) ===
                text(item.sourceProductId);
              if (!parsedSuccessfully) {
                errorText = "detail identity mismatch";
              }
            }
          } catch (error) {
            errorText =
              error instanceof Error ? error.message : String(error);
          }
          const hasMore =
            index + 1 < selection.candidates.length &&
            !blockedReason &&
            weakSignals.length === 0;
          let delayMs = 0;
          if (hasMore) {
            const processedCount = index + 1;
            delayMs =
              processedCount %
                Math.max(1, options.detailBatchSize) ===
              0
                ? randomDelayMs(
                    options.detailBatchCooldownMinMs,
                    options.detailBatchCooldownMaxMs
                  )
                : randomDelayMs(
                    options.detailDelayMinMs,
                    options.detailDelayMaxMs
                  );
          }
          const detailEndedAt = new Date().toISOString();
          observations.push({
            sourceProductId: text(item.sourceProductId),
            url: text(item.sourceUrl),
            startedAt: detailStartedAt,
            endedAt: detailEndedAt,
            durationMs: durationMs(
              detailStartedAt,
              detailEndedAt
            ),
            warmupMs,
            delayMs,
            parsedSuccessfully,
            weakVerificationSignals: weakSignals,
            strongVerificationSignals: strongSignals,
            finalClassification,
            verificationDetectedAt,
            manualVerificationAllowed:
              options.allowManualVerification,
            manualVerificationRecovered:
              recoveredThisDetail,
            error: errorText,
          });
          if (blockedReason || weakSignals.length > 0) break;
          if (delayMs > 0) await page.waitForTimeout(delayMs);
        }
      } finally {
        await browserSession.close();
      }
    }

    const endedAt =
      options.mock && observations.length
        ? observations.at(-1).endedAt
        : new Date().toISOString();
    const telemetry = buildDetailProbeTelemetry({
      runId,
      startedAt,
      endedAt,
      detailProbeMax: options.detailProbeMax,
      observations,
      blockedReason,
      browser,
      manualVerificationAllowed:
        options.allowManualVerification,
      manualVerificationRecovered,
    });
    await writeOutputs(paths, telemetry);
    return {
      status: blockedReason ? "blocked" : "probe-complete",
      telemetry,
      browserStarted: !options.mock,
    };
  } finally {
    if (lock && fs.existsSync(paths.detailProbeLock)) {
      releaseRunLock(lock);
    }
  }
}
