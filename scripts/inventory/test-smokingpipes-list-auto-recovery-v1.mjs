import assert from "node:assert/strict";
import { fetchSmokingpipesCurrentList } from "./smokingpipes-fetch-current-list-v1.mjs";

// Run the real collector against a clock-driven page double. No source requests,
// browser profiles, inventory files, or production state are touched.
function fixture({ releaseMs = 20000, navigationError = false,
  oldPage = false, persistent = false, totalPages = 1, clearBeforeReadyMs = 0 } = {}) {
  let clock = 0;
  let currentUrl = "about:blank";
  let readyAt = Infinity;
  const navigations = [];
  const ready = () => !persistent && clock >= readyAt;
  const challenge = () => persistent || clock < readyAt - clearBeforeReadyMs;
  const products = () => ready() ? [{
    sourceProductId: String(new URL(currentUrl).searchParams.get("page") || 1),
    sourceUrl: "https://www.smokingpipes.com/pipes/new/test/moreinfo.cfm?product_id=100",
    title: "Fixture: Billiard", brand: "Fixture", price: "$100.00",
    rawText: "Fixture: Billiard $100.00", listPageUrl: currentUrl,
  }] : [];
  const page = {
    url: () => currentUrl,
    async goto(url) {
      navigations.push(url);
      if (oldPage && navigations.length === 1) {
        currentUrl = url.replace("page=1", "page=9");
        readyAt = 0;
        throw new Error("net::ERR_CONNECTION_RESET");
      }
      currentUrl = url;
      readyAt = clock + releaseMs;
      if (navigationError) throw new Error("page.goto: navigation interrupted");
      return { status: () => releaseMs ? 403 : 200 };
    },
    async title() { return challenge() ? "Security verification" : "Pipes"; },
    locator() { return { innerText: async () => challenge() ? "Verify you are human" : "Pipes" }; },
    async evaluate(_fn, arg) {
      if (typeof arg === "object") return products();
      return { bodyStart: challenge() ? "Verify you are human" : "Pipes",
        productLinkCount: ready() ? 1 : 0, explicitChallengeElement: challenge() };
    },
    async content() {
      return ready() ? `<a href="?page=${totalPages}">Last</a>` : "<title>Security verification</title>";
    },
    async waitForSelector(_selector, { timeout }) {
      if (persistent || readyAt - clock > timeout) {
        clock += timeout;
        throw new Error("selector timed out");
      }
      clock = Math.max(clock, readyAt);
    },
    async waitForTimeout(ms) { clock += ms; },
    async bringToFront() {},
    async screenshot() { throw new Error("fixture: screenshots disabled"); },
  };
  return { page, navigations, now: () => clock };
}

async function collect(f, options = {}) {
  return fetchSmokingpipesCurrentList({
    maxPages: 1, expectedPages: 1, allowManualVerification: false,
    browserSession: { context: { pages: () => [f.page] }, browser: {} },
    useCheckpoint: false, useOutOfStockTailCache: false,
    writeOutOfStockTailCache: false, writeDuplicateAudit: false, writeCurrentList: false,
    pageWarmupMinMs: 0, pageWarmupMaxMs: 0,
    pageDelayMinMs: 0, pageDelayMaxMs: 0,
    nowMs: f.now,
    ...options,
  });
}

const originalLog = console.log;
console.log = () => {};
try {
  for (const navigationError of [false, true]) {
    const f = fixture({ navigationError });
    const result = await collect(f);
    assert.equal(result.products.length, 1);
    assert.deepEqual(result.summary.failedPages, []);
    assert.equal(result.summary.captchaDetected, false);
    assert.equal(f.navigations.length, 1, "automatic verification must not be refreshed");
  }

  const pagination = fixture({ releaseMs: 20000, totalPages: 2 });
  const paged = await collect(pagination);
  assert.equal(paged.summary.detectedTotalPages, 2, "read pagination after verification clears");
  assert.equal(paged.summary.pagesScanned, 2);
  assert.equal(pagination.navigations.length, 2);

  const stale = fixture({ oldPage: true, releaseMs: 0 });
  const retried = await collect(stale);
  assert.equal(stale.navigations.length, 2, "a failed navigation still showing page 9 must retry page 1");
  assert.equal(retried.products[0].sourceProductId, "1");

  const manual = fixture({ releaseMs: 100000 });
  const recovered = await collect(manual, { allowManualVerification: true });
  assert.equal(recovered.summary.manualVerificationRecovered, true);
  assert.equal(manual.navigations.length, 1, "manual recovery must preserve the recovered list");

  const loading = fixture({ releaseMs: 130000, clearBeforeReadyMs: 60000 });
  const loaded = await collect(loading, { allowManualVerification: true });
  assert.equal(loaded.products.length, 1);
  assert.equal(loading.navigations.length, 1, "challenge disappearance must not refresh a still-loading target list");

  const blocked = fixture({ persistent: true });
  await assert.rejects(collect(blocked), error => error.code === "CAPTCHA_REQUIRED");
  assert.equal(blocked.navigations.length, 1, "persistent verification must not trigger repeated requests");

  const deadline = fixture({ persistent: true });
  await assert.rejects(collect(deadline, { deadlineAtMs: 5000 }),
    error => error.code === "DAILY_DEADLINE_REACHED");
  assert.equal(deadline.navigations.length, 1);
} finally {
  console.log = originalLog;
}
console.log("Smokingpipes list auto recovery: 8 scenarios passed.");
