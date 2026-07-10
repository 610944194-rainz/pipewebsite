import {
  buildSmokingpipesBrowserDescriptor,
} from "../lib/smokingpipes-browser-profile-v1.mjs";
import {
  detectSmokingpipesVerification,
  launchSmokingpipesContext,
} from "../lib/smokingpipes-utils.mjs";
import {
  formatRunId,
  getRunnerPaths,
  writeJsonAtomic,
  writeTextAtomic,
} from "./inventory-runner-core-v1.mjs";

const PREFLIGHT_URL = "https://www.smokingpipes.com/";

function browserReportMarkdown(state) {
  const browser = state.browser || {};
  return `# Smokingpipes Browser Profile Preflight

- runId: ${state.runId}
- status: ${state.status}
- mock: ${state.mock}
- startedAt: ${state.startedAt}
- finishedAt: ${state.finishedAt}
- requested browser channel: ${browser.requestedBrowserChannel || "automatic"}
- effective browser channel: ${browser.effectiveBrowserChannel || "automatic"}
- requested browser profile: ${browser.requestedBrowserProfile || "none"}
- requested browser profile dir: ${browser.requestedBrowserProfileDir || "none"}
- effective profile dir: ${browser.profileDir || "none"}
- profile source: ${browser.profileSource || "none"}
- persistent context: ${Boolean(browser.persistentContext)}
- headful: ${browser.headless === false}
- executable path: ${browser.executablePath || "unavailable"}
- user data dir created: ${Boolean(browser.userDataDirCreated)}
- profile lock required: ${Boolean(browser.profileLockRequired)}
- profile lock acquired: ${Boolean(state.profileLockAcquired)}
- stale profile lock recovered: ${Boolean(browser.staleProfileLockRecovered)}
- page loaded: ${Boolean(state.pageLoaded)}
- verification detected: ${Boolean(state.verificationDetected)}
- verification detectedAt: ${state.verificationDetectedAt || "none"}
- manual verification allowed: ${Boolean(state.manualVerificationAllowed)}
- manual verification recovered: ${Boolean(state.manualVerificationRecovered)}
- blocked reason: ${state.lastBlockedReason || "none"}
- products fetched: false
- candidate generated: false
- production written: false
- commit performed: false
- push performed: false

This preflight opens only the lightweight Smokingpipes home page in real mode.
It does not parse or persist product inventory.
`;
}

async function writeOutputs(paths, state) {
  await writeJsonAtomic(paths.browserProfileState, state);
  await writeTextAtomic(
    paths.browserProfileReport,
    browserReportMarkdown(state)
  );
}

export async function runSmokingpipesBrowserPreflight({
  root = process.cwd(),
  options,
}) {
  const paths = getRunnerPaths(root, { mock: options.mock });
  const runId = formatRunId();
  const startedAt = new Date().toISOString();
  const initialBrowser = buildSmokingpipesBrowserDescriptor({
    root,
    browserChannel: options.browserChannel,
    browserProfile: options.browserProfile,
    browserProfileDir: options.browserProfileDir,
  });
  let browser = initialBrowser;
  let browserStarted = false;
  let session = null;
  let pageLoaded = false;
  let verificationDetected = false;
  let lastBlockedReason = null;

  try {
    if (!options.mock) {
      session = await launchSmokingpipesContext({
        root,
        browserChannel: options.browserChannel,
        browserProfile: options.browserProfile,
        browserProfileDir: options.browserProfileDir,
        profileLockPath: paths.browserProfileLock,
        runId,
        mode: "browser-preflight",
      });
      browserStarted = true;
      browser = session.browser;
      const page =
        session.context.pages()[0] ||
        (await session.context.newPage());
      const response = await page.goto(PREFLIGHT_URL, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      pageLoaded = Boolean(response) || Boolean(page.url());
      const detection = await detectSmokingpipesVerification(
        page,
        {
          pageKind: "detail",
          httpStatus: response?.status() || 0,
        }
      );
      verificationDetected =
        detection.verificationBlocked === true;
      if (verificationDetected) {
        lastBlockedReason =
          "strong verification detected during browser preflight";
      }
    } else {
      pageLoaded = true;
    }
  } catch (error) {
    lastBlockedReason =
      error instanceof Error ? error.message : String(error);
  } finally {
    await session?.close().catch(() => {});
  }

  const finishedAt = new Date().toISOString();
  const status = lastBlockedReason
    ? "blocked"
    : "preflight-passed";
  const state = {
    version: "smokingpipes-browser-profile-state-v1",
    runId,
    source: "smokingpipes",
    mode: "browser-preflight",
    status,
    mock: Boolean(options.mock),
    startedAt,
    finishedAt,
    lastRunAt: finishedAt,
    lastMode: "browser-preflight",
    browser,
    browserStarted,
    profileLockAcquired:
      Boolean(browser.profileLockPath) && browserStarted,
    pageUrl: PREFLIGHT_URL,
    pageLoaded,
    verificationDetected,
    verificationDetectedAt: verificationDetected
      ? finishedAt
      : null,
    lastVerificationDetected: verificationDetected
      ? finishedAt
      : null,
    manualVerificationAllowed:
      Boolean(options.allowManualVerification),
    manualVerificationRecovered: false,
    lastManualVerificationRecovered: false,
    lastBlockedReason,
    productsFetched: false,
    candidateGenerated: false,
    productionWritten: false,
    commitPerformed: false,
    pushPerformed: false,
  };
  await writeOutputs(paths, state);
  return {
    status,
    state,
    statePath: paths.browserProfileState,
    reportPath: paths.browserProfileReport,
    browserStarted,
    productsFetched: false,
    candidateGenerated: false,
    productionWritten: false,
    commitPerformed: false,
    pushPerformed: false,
  };
}
