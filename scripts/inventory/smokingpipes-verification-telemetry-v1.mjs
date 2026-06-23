function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function durationMs(startedAt, endedAt) {
  const start = Date.parse(startedAt || "");
  const end = Date.parse(endedAt || "");
  return Number.isFinite(start) && Number.isFinite(end) && end >= start
    ? end - start
    : 0;
}

export function evaluateVerificationRisk({
  captchaDetected = false,
  pagesRequested = 0,
  pagesScanned = 0,
  avgSecondsPerPage = 0,
  weakVerificationPages = [],
  strongVerificationPages = [],
}) {
  if (captchaDetected || strongVerificationPages.length > 0) {
    return {
      riskLevel: "blocked",
      warnings: ["strong verification detected"],
      recommendedNextAction:
        "Stop access. Do not retry immediately. Use conservative profile later.",
    };
  }
  if (
    Number(avgSecondsPerPage) < 6 &&
    Number(pagesRequested) > 30
  ) {
    return {
      riskLevel: "high",
      warnings: [
        "pacing too aggressive for full Smokingpipes list scan",
      ],
      recommendedNextAction:
        "Use the conservative full-reconcile profile before another long scan.",
    };
  }
  if (
    Number(pagesScanned) >= 100 &&
    Number(avgSecondsPerPage) >= 8 &&
    weakVerificationPages.length === 0 &&
    strongVerificationPages.length === 0
  ) {
    return {
      riskLevel: "low",
      warnings: [],
      recommendedNextAction:
        "This pacing is suitable for further controlled validation, but Daily Update remains unapproved.",
    };
  }
  return {
    riskLevel: "medium",
    warnings:
      weakVerificationPages.length > 0
        ? ["weak verification signals require review"]
        : [],
    recommendedNextAction:
      "Review telemetry before changing pacing or expanding the scan.",
  };
}

export function summarizeVerificationTelemetry(telemetry) {
  const pages = telemetry?.pages || [];
  const weakPages = pages
    .filter((page) => (page.weakVerificationSignals || []).length)
    .map((page) => page.page);
  const strongPages = pages
    .filter((page) => (page.strongVerificationSignals || []).length)
    .map((page) => page.page);
  const totalDurationMs =
    number(telemetry?.totalDurationMs) ||
    durationMs(telemetry?.startedAt, telemetry?.endedAt);
  const firstWeakPage = pages.find((page) =>
    (page.weakVerificationSignals || []).length
  );
  const firstStrongPage = pages.find((page) =>
    (page.strongVerificationSignals || []).length
  );
  const elapsedSeconds = (page) => {
    if (!page) return null;
    const start = Date.parse(telemetry?.startedAt || "");
    const end = Date.parse(page.endedAt || page.startedAt || "");
    return Number.isFinite(start) && Number.isFinite(end) && end >= start
      ? Math.round(((end - start) / 1000) * 1000) / 1000
      : null;
  };
  return {
    pagesRequested: number(telemetry?.pagesRequested),
    pagesScanned: pages.length,
    totalDurationMs,
    avgSecondsPerPage:
      pages.length > 0
        ? Math.round((totalDurationMs / 1000 / pages.length) * 1000) /
          1000
        : 0,
    weakVerificationPages: weakPages,
    strongVerificationPages: strongPages,
    firstWeakVerificationPage: weakPages[0] || null,
    firstStrongVerificationPage: strongPages[0] || null,
    firstWeakVerificationElapsedSeconds: elapsedSeconds(firstWeakPage),
    firstStrongVerificationElapsedSeconds: elapsedSeconds(firstStrongPage),
    outOfStockProducts: pages.reduce(
      (sum, page) => sum + number(page.outOfStockProducts),
      0
    ),
    missingPriceProducts: pages.reduce(
      (sum, page) => sum + number(page.missingPriceProducts),
      0
    ),
  };
}

export function buildVerificationProbeTelemetry({
  runId,
  mode = "verification-probe",
  source = "smokingpipes",
  startedAt,
  endedAt,
  pagesRequested,
  pacing,
  pages = [],
  blockedReason = "",
  candidateGenerated = false,
  detailsFetched = false,
  browser = null,
  manualVerificationAllowed = false,
  manualVerificationRecovered = false,
}) {
  const captchaPages = pages
    .filter((page) => (page.strongVerificationSignals || []).length)
    .map((page) => page.page);
  const verificationPage = pages.find(
    (page) =>
      page.verificationDetectedAt ||
      (page.strongVerificationSignals || []).length > 0
  );
  const telemetry = {
    version: "smokingpipes-verification-telemetry-v1",
    runId,
    mode,
    source,
    startedAt,
    endedAt,
    totalDurationMs: durationMs(startedAt, endedAt),
    pagesRequested: number(pagesRequested),
    pacingProfile: pacing || {},
    pages: pages.map((page) => ({
      ...page,
      weakVerificationSignals: unique(page.weakVerificationSignals),
      strongVerificationSignals: unique(page.strongVerificationSignals),
      screenshotPath: page.screenshotPath || null,
      htmlSamplePath: null,
    })),
    captchaDetected: captchaPages.length > 0,
    captchaPages,
    verificationDetectedAt:
      verificationPage?.verificationDetectedAt ||
      verificationPage?.startedAt ||
      null,
    blockedReason: blockedReason || null,
    browser: browser || null,
    manualVerificationAllowed: Boolean(
      manualVerificationAllowed
    ),
    manualVerificationRecovered: Boolean(
      manualVerificationRecovered
    ),
    candidateGenerated: Boolean(candidateGenerated),
    detailsFetched: Boolean(detailsFetched),
    productionWritten: false,
    commitPerformed: false,
    pushPerformed: false,
  };
  const summary = summarizeVerificationTelemetry(telemetry);
  const risk = evaluateVerificationRisk({
    captchaDetected: telemetry.captchaDetected,
    pagesRequested: summary.pagesRequested,
    pagesScanned: summary.pagesScanned,
    avgSecondsPerPage: summary.avgSecondsPerPage,
    weakVerificationPages: summary.weakVerificationPages,
    strongVerificationPages: summary.strongVerificationPages,
  });
  return {
    ...telemetry,
    riskLevel: risk.riskLevel,
    warnings: risk.warnings,
    recommendedNextAction: risk.recommendedNextAction,
    summary,
  };
}

export function buildVerificationTelemetryMarkdown(telemetry) {
  const summary =
    telemetry.summary || summarizeVerificationTelemetry(telemetry);
  const pageRows = (telemetry.pages || [])
    .map(
      (page) =>
        `| ${page.page} | ${page.productsParsed} | ${page.outOfStockProducts} | ${page.missingPriceProducts} | ${(page.weakVerificationSignals || []).join(", ") || "none"} | ${(page.strongVerificationSignals || []).join(", ") || "none"} | ${page.finalClassification} | ${page.durationMs} |`
    )
    .join("\n");
  return `# Smokingpipes Verification Telemetry

- runId: ${telemetry.runId}
- mode: ${telemetry.mode}
- startedAt: ${telemetry.startedAt}
- endedAt: ${telemetry.endedAt}
- total duration ms: ${summary.totalDurationMs}
- pages requested: ${summary.pagesRequested}
- pages scanned: ${summary.pagesScanned}
- average seconds per page: ${summary.avgSecondsPerPage}
- first weak signal page: ${summary.firstWeakVerificationPage || "none"}
- first weak signal elapsed seconds: ${summary.firstWeakVerificationElapsedSeconds ?? "none"}
- first strong signal page: ${summary.firstStrongVerificationPage || "none"}
- first strong signal elapsed seconds: ${summary.firstStrongVerificationElapsedSeconds ?? "none"}
- CAPTCHA detected: ${telemetry.captchaDetected}
- verification detectedAt: ${telemetry.verificationDetectedAt || "none"}
- riskLevel: ${telemetry.riskLevel}
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
- candidate generated: ${telemetry.candidateGenerated}
- details fetched: ${telemetry.detailsFetched}
- production written: false

## Risk warnings

${telemetry.warnings?.length ? telemetry.warnings.map((item) => `- ${item}`).join("\n") : "- none"}

## Pacing profile

${Object.entries(telemetry.pacingProfile || {})
  .map(([key, value]) => `- ${key}: ${value}`)
  .join("\n")}

## Page observations

| Page | Products | Out of stock | Missing price | Weak signals | Strong signals | Classification | Duration ms |
| --- | ---: | ---: | ---: | --- | --- | --- | ---: |
${pageRows || "| none | 0 | 0 | 0 | none | none | none | 0 |"}

## Recommended next action

${telemetry.recommendedNextAction}
`;
}
