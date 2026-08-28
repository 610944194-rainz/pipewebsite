import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  acquireDanishLock,
  applyDanishListPatch,
  buildDanishListPatch,
  buildIncrementalDetailQueue,
  buildDifferenceSummary,
  evaluateDegradedFieldFallbacks,
  localRunTimestamp,
  mergeConvertedWithProduction,
  nonPublicDanishComponentIds,
  productsEquivalentForDiff,
  releaseDanishLock,
  runDanishDaily,
  runDanishDailyWithStrongVerificationRetry,
  isDanishStrongVerificationFailure,
  validateIncrementalDetailQueue,
} from "./run-danish-daily-v1.mjs";
import {
  ensureAgeLanguageGateHandled,
  ensureManualVerificationIfNeeded,
  inspectAgeLanguageGateSafely,
} from "../collect-danish-full-v18.mjs";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "danish-daily-v1-"));

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function makeProduct(id, overrides = {}) {
  return {
    id,
    name: `Danish Pipe ${id}`,
    sourceUrl: `https://www.danishpipeshop.com/d/-zh/Danish-Pipe-${id}-i${id}.html`,
    originalUrl: `https://www.danishpipeshop.com/d/-zh/Danish-Pipe-${id}-i${id}.html`,
    status: "available",
    brand: "Test Brand",
    specsText: ["Length: 120 mm"],
    imageUrl: `https://example.test/${id}.jpg`,
    ...overrides,
  };
}

function makeRawProduct(id, overrides = {}) {
  return {
    href: `https://www.danishpipeshop.com/d/-zh/Danish-Pipe-${id}-i${id}.html`,
    name: `Danish Pipe ${id}`,
    status: "available",
    specsText: ["Length: 120 mm"],
    imageUrl: `https://example.test/${id}.jpg`,
    ...overrides,
  };
}

function convertedSource(products) {
  return `export const danishProducts = ${JSON.stringify(products, null, 2)};\n`;
}

function verificationPage(states, options = {}) {
  let index = 0;
  const navigations = [];
  const page = {
    isClosed: () => Boolean(options.closed),
    url: () => states[Math.min(index, states.length - 1)]?.url || "https://www.danishpipeshop.com/l/-zh/Pipes1",
    evaluate: async () => states[Math.min(index, states.length - 1)],
    waitForTimeout: async () => { index = Math.min(index + 1, states.length - 1); },
    goto: async (url) => {
      navigations.push(url);
      index = Math.min(index + 1, states.length - 1);
    },
  };
  return { page, navigations };
}

function ageLanguageGatePage(inspections) {
  let index = 0;
  const calls = { clicks: [], loadStates: [], waits: [] };
  const page = {
    isClosed: () => false,
    evaluate: async () => {
      const next = inspections[Math.min(index, inspections.length - 1)];
      index += 1;
      if (next instanceof Error) throw next;
      return next;
    },
    waitForLoadState: async (state, options) => {
      calls.loadStates.push({ state, options });
    },
    waitForTimeout: async (milliseconds) => {
      calls.waits.push(milliseconds);
    },
    getByText: (text) => ({
      first: () => ({
        count: async () => 1,
        isVisible: async () => true,
        click: async () => { calls.clicks.push(text); },
      }),
    }),
  };
  return { page, calls };
}

function readyListGateState(overrides = {}) {
  return {
    gatePresent: false,
    titlePresent: false,
    chinesePresent: false,
    englishPresent: false,
    listContainerVisible: true,
    listItemCount: 1,
    visibleListItemCount: 1,
    url: "https://www.danishpipeshop.com/l/-zh/Pipes1",
    pageTitle: "Pipes",
    ...overrides,
  };
}

// V18 verification recovery must not wait for terminal input or rely on an automatic redirect.
{
  const states = [
    { title: "Just a moment...", challenge: true, hasListContainer: false, listItemCount: 0, url: "https://www.danishpipeshop.com/l/-zh/Pipes1" },
    { title: "Danish Pipe Shop", challenge: false, hasListContainer: false, listItemCount: 0, url: "https://www.danishpipeshop.com/" },
    { title: "Pipes", challenge: false, hasListContainer: true, listItemCount: 1, url: "https://www.danishpipeshop.com/l/-zh/Pipes1" },
  ];
  const { page, navigations } = verificationPage(states);
  const events = [];
  assert.equal(await ensureManualVerificationIfNeeded(page, {
    targetUrl: states[0].url,
    requireList: true,
    timeoutMs: 100,
    pollMs: 1,
    log: (stage) => events.push(stage),
  }), true);
  assert.deepEqual(navigations, [states[0].url]);
  assert.equal(events.includes("manual-verification-required"), true);
  assert.equal(events.includes("manual-verification-completed"), true);
  assert.equal(events.includes("normal-list-page-ready"), true);
}

// Timeout and closed-page states fail explicitly instead of waiting indefinitely.
{
  let clock = 0;
  const { page } = verificationPage([
    { title: "Just a moment...", challenge: true, hasListContainer: false, listItemCount: 0, url: "https://www.danishpipeshop.com/l/-zh/Pipes1" },
  ]);
  await assert.rejects(
    () => ensureManualVerificationIfNeeded(page, {
      targetUrl: page.url(),
      requireList: true,
      timeoutMs: 10,
      pollMs: 5,
      now: () => clock,
      sleep: async (milliseconds) => { clock += milliseconds; },
      log: () => {},
    }),
    /manual-verification-timeout/
  );
  const closed = verificationPage([], { closed: true }).page;
  await assert.rejects(
    () => ensureManualVerificationIfNeeded(closed, { targetUrl: "https://www.danishpipeshop.com/l/-zh/Pipes1" }),
    /manual-verification-page-closed/
  );
}

// A transient navigation race during the initial age/language inspect recovers after domcontentloaded.
{
  const { page, calls } = ageLanguageGatePage([
    new Error("Execution context was destroyed, most likely because of a navigation"),
    readyListGateState(),
  ]);
  const state = await inspectAgeLanguageGateSafely(page, { settleDelayMs: 0 });
  assert.equal(state.gatePresent, false);
  assert.equal(state.listContainerVisible, true);
  assert.equal(state.listItemCount > 0, true);
  assert.equal(calls.loadStates.length, 1);
  assert.equal(calls.loadStates[0].state, "domcontentloaded");
}

// A language click can redirect before the first dismissal inspect; the safe inspect resumes normally.
{
  const gateState = readyListGateState({
    gatePresent: true,
    chinesePresent: true,
    listContainerVisible: false,
    listItemCount: 0,
  });
  const { page, calls } = ageLanguageGatePage([
    gateState,
    gateState,
    new Error("Cannot find context with specified id"),
    readyListGateState(),
    readyListGateState(),
  ]);
  const result = await ensureAgeLanguageGateHandled(page, { requireList: true });
  assert.equal(result.detected, true);
  assert.equal(result.automatic, true);
  assert.equal(calls.clicks.length, 1);
  assert.equal(calls.loadStates.length, 1);
}

// A real evaluate failure is not classified as navigation and must be thrown immediately.
{
  const { page, calls } = ageLanguageGatePage([
    new Error("selector/logic unexpected error"),
  ]);
  await assert.rejects(
    () => inspectAgeLanguageGateSafely(page, { settleDelayMs: 0 }),
    /selector\/logic unexpected error/
  );
  assert.equal(calls.loadStates.length, 0);
}

// Repeated transient context failures stop at the bounded retry limit instead of looping forever.
{
  const { page, calls } = ageLanguageGatePage([
    new Error("Execution context was destroyed"),
  ]);
  await assert.rejects(
    () => inspectAgeLanguageGateSafely(page, { maxAttempts: 3, settleDelayMs: 0 }),
    /age-language-navigation-race-retry-exhausted attempts=3/
  );
  assert.equal(calls.loadStates.length, 2);
}

// Comparison normalizes only non-business representation differences.
{
  const old = makeProduct(1, {
    updatedAt: "2026-08-05 19:18",
    weightGrams: 42,
    tags: ["新斗", "Peterson"],
    sourceUrl: "https://WWW.DANISHPIPESHOP.COM/d/-zh/Test-i1.html",
    detail: "A line\n  wrapped once",
  });
  const equivalent = {
    ...old,
    updatedAt: "2030-01-01 00:00",
    weightGrams: "42",
    tags: ["Peterson", "新斗"],
    sourceUrl: "https://www.danishpipeshop.com/d/-zh/Test-i1.html",
    detail: "  A line wrapped once  ",
    optionalField: "",
  };
  assert.equal(productsEquivalentForDiff(old, equivalent), true);
  assert.equal(productsEquivalentForDiff(old, { ...equivalent, originalPriceValue: 999 }), false);
  assert.equal(productsEquivalentForDiff(old, { ...equivalent, galleryImages: ["https://example.test/b.jpg", "https://example.test/a.jpg"] }), false);
  assert.equal(localRunTimestamp(new Date("2026-08-05T19:18:51.000Z")), "20260806-031851");
}

// The summary must compare the merged candidate, not raw converter blanks.
{
  const production = [makeProduct(1, { material: "unknown", finish: "unknown" })];
  const converted = [makeProduct(1, { material: "", finish: "", updatedAt: "future" })];
  const merged = mergeConvertedWithProduction({ convertedProducts: converted, productionProducts: production });
  const summary = buildDifferenceSummary({
    collectedCount: 1,
    currentProducts: converted,
    candidateProducts: merged.products,
    convertedCount: converted.length,
    productionProducts: production,
    failedDetails: 0,
    duplicates: 0,
    checkpoint: { exists: false },
  });
  assert.equal(summary.updated, 0);
  assert.deepEqual(summary.changedFields, {});
}

// List-level business changes patch Production directly; only new, reappeared, and missing details enter the queue.
{
  const production = [
    makeProduct(1, {
      originalPrice: "$ 100,-",
      price: "$ 100,-",
      originalCurrency: "USD",
      originalPriceValue: 100,
      estimatedCny: "约 ¥730",
      estimatedCnyValue: 730,
      galleryImages: ["https://example.test/1-gallery.jpg"],
      detailImageUrl: "https://example.test/1-detail.jpg",
      updatedAt: "old",
    }),
    makeProduct(2, { status: "sold" }),
    makeProduct(3, { originalPrice: "$ 100,-", price: "$ 100,-", originalCurrency: "USD", originalPriceValue: 100, specsText: [] }),
    makeProduct(4),
  ];
  const list = [
    makeRawProduct(1, { name: "Danish Pipe 1 renamed", price: "$ 120,-", brand: "List Brand", updatedAt: "new" }),
    makeRawProduct(2),
    makeRawProduct(3, { price: "$ 120,-" }),
    makeRawProduct(4, { status: "sold" }),
    makeRawProduct(5),
    makeRawProduct(6, { name: "Falcon test pipe" }),
    makeRawProduct(32447, { name: "BPK, Barry, Seven (7) Pipes" }),
  ];
  const listPatch = buildDanishListPatch({ listProducts: list, productionProducts: production, generatedAt: "2026-08-06T00:00:00.000Z" });
  const patched = applyDanishListPatch({ productionProducts: production, listPatch });
  const queue = buildIncrementalDetailQueue({ listProducts: list, productionProducts: production, listPatch, generatedAt: "2026-08-06T00:00:00.000Z" });
  assert.equal(listPatch.priceChangedCount, 2);
  assert.equal(listPatch.statusChangedCount, 2);
  assert.equal(listPatch.nameChangedCount, 1);
  assert.equal(listPatch.brandChangedCount, 1);
  assert.equal(listPatch.products.some((entry) => entry.id === "1" && entry.changedFields.includes("price") && entry.changedFields.includes("name") && entry.changedFields.includes("brand")), true);
  const patchedOne = patched.find((item) => item.id === 1);
  assert.equal(patchedOne.originalPrice, "$ 120,-");
  assert.equal(patchedOne.originalPriceValue, 120);
  assert.equal(patchedOne.name, "Danish Pipe 1 renamed");
  assert.deepEqual(patchedOne.galleryImages, production[0].galleryImages);
  assert.deepEqual(patchedOne.specsText, production[0].specsText);
  assert.equal(patchedOne.detailImageUrl, production[0].detailImageUrl);
  assert.equal(queue.newCount, 1);
  assert.equal(queue.reappearedCount, 1);
  assert.equal(queue.missingRequiredProductionDataCount, 1);
  assert.equal(queue.reusedProductionCount, 2);
  assert.equal(queue.excludedCount, 2);
  assert.deepEqual(queue.products.map((item) => [item.id, item.reason]), [
    ["2", "reappeared"],
    ["3", "missing-required-production-data"],
    ["5", "new-product"],
  ]);
  const nonPublicComponentQueue = buildIncrementalDetailQueue({
    listProducts: list,
    productionProducts: production,
    listPatch,
    nonPublicComponentIds: nonPublicDanishComponentIds([{
      source: "danish",
      sourceProductId: "3",
      entityType: "component-stem",
      inventory: { publicIndexEligible: false },
    }]),
    generatedAt: "2026-08-06T00:00:00.000Z",
  });
  assert.equal(nonPublicComponentQueue.missingRequiredProductionDataCount, 0);
  assert.equal(nonPublicComponentQueue.products.some((entry) => entry.id === "3"), false);
  assert.equal(validateIncrementalDetailQueue({ detailQueue: queue, productionProducts: production }).passed, false);
  // The deliberately small fixture has three queued records out of five eligible records.
  assert.match(validateIncrementalDetailQueue({ detailQueue: queue, productionProducts: production }).errors.join(","), /full-refresh-risk/);
}

// Large queue, missing Production, and stable-ID failures are fail-closed; no full-detail fallback exists.
{
  const production = Array.from({ length: 20 }, (_, index) => makeProduct(index + 1, { specsText: [] }));
  const changedList = production.map((item) => makeRawProduct(item.id, { name: `${item.name} changed`, price: "$ 120,-" }));
  const queue = buildIncrementalDetailQueue({ listProducts: changedList, productionProducts: production });
  const gate = validateIncrementalDetailQueue({ detailQueue: queue, productionProducts: production });
  assert.equal(gate.passed, false);
  assert.match(gate.errors.join(","), /detail-queue-abnormal-full-refresh-risk/);
  assert.match(gate.errors.join(","), /reused-production-count-zero/);
  assert.equal(validateIncrementalDetailQueue({ detailQueue: { ...queue, queueCount: 0, reusedProductionCount: 1 }, productionProducts: [] }).errors.includes("production-baseline-missing-or-empty"), true);
  const missingId = buildIncrementalDetailQueue({ listProducts: [{ href: "https://example.test/no-stable-id", name: "unknown" }], productionProducts: production });
  assert.equal(validateIncrementalDetailQueue({ detailQueue: missingId, productionProducts: production }).errors.includes("list-stable-id-missing"), true);
}

// A large number of source-price changes is a List Patch only and cannot trip the detail queue gate.
{
  const production = Array.from({ length: 20 }, (_, index) => makeProduct(index + 1, {
    originalPrice: "$ 100,-",
    price: "$ 100,-",
    originalCurrency: "USD",
    originalPriceValue: 100,
  }));
  const list = production.map((item) => makeRawProduct(item.id, { price: "$ 120,-" }));
  const listPatch = buildDanishListPatch({ listProducts: list, productionProducts: production });
  const queue = buildIncrementalDetailQueue({ listProducts: list, productionProducts: production, listPatch });
  assert.equal(listPatch.priceChangedCount, 20);
  assert.equal(queue.queueCount, 0);
  assert.equal(queue.reusedProductionCount, 20);
  assert.equal(validateIncrementalDetailQueue({ detailQueue: queue, productionProducts: production }).passed, true);
}

// An ID/URL mismatch is never patched onto an existing product; it becomes an explicit anomaly queue record.
{
  const production = [makeProduct(1)];
  const list = [{ ...makeRawProduct(1), id: 1, href: "https://www.danishpipeshop.com/d/-zh/Danish-Pipe-2-i2.html" }];
  const listPatch = buildDanishListPatch({ listProducts: list, productionProducts: production });
  const queue = buildIncrementalDetailQueue({ listProducts: list, productionProducts: production, listPatch });
  assert.equal(listPatch.identityAnomalyCount, 1);
  assert.deepEqual(listPatch.products, []);
  assert.deepEqual(queue.products.map((item) => [item.id, item.reason]), [["1", "identity-or-url-anomaly"]]);
}

// Only the explicitly protected Danish content fields are backfilled on a partial detail result.
{
  const old = makeProduct(1, {
    galleryImages: ["https://example.test/old-1.jpg", "https://example.test/old-2.jpg"],
    galleryCount: 2,
    specsText: ["Length: 120 mm"],
    imageUrl: "https://example.test/old-main.jpg",
    detailImageUrl: "https://example.test/old-detail.jpg",
    originalPriceValue: 100,
    status: "sold",
  });
  const fresh = makeProduct(1, {
    galleryImages: [],
    galleryCount: 0,
    specsText: [],
    imageUrl: "",
    detailImageUrl: "",
    originalPriceValue: 120,
    status: "sold",
  });
  const merged = mergeConvertedWithProduction({ convertedProducts: [fresh], productionProducts: [old] });
  const product = merged.products[0];
  assert.deepEqual(product.galleryImages, old.galleryImages);
  assert.equal(product.galleryCount, 2);
  assert.deepEqual(product.specsText, old.specsText);
  assert.equal(product.imageUrl, old.imageUrl);
  assert.equal(product.detailImageUrl, old.detailImageUrl);
  assert.equal(product.originalPriceValue, 120);
  assert.equal(product.status, "sold");
  const listPatch = buildDanishListPatch({
    productionProducts: [old],
    listProducts: [makeRawProduct(1, {
      status: "available",
      price: "$ 130,-",
      name: "List-authoritative name",
    })],
  });
  const candidate = applyDanishListPatch({ productionProducts: merged.products, listPatch });
  assert.equal(candidate[0].status, "available");
  assert.equal(candidate[0].originalPrice, "$ 130,-");
  assert.equal(candidate[0].originalPriceValue, 130);
  assert.equal(candidate[0].name, "List-authoritative name");
  assert.deepEqual(candidate[0].galleryImages, old.galleryImages);
  assert.deepEqual(candidate[0].specsText, old.specsText);
  assert.equal(candidate[0].imageUrl, old.imageUrl);
  assert.equal(candidate[0].detailImageUrl, old.detailImageUrl);
  assert.deepEqual(merged.degradedFieldFallbacks, {
    affectedProducts: 1,
    galleryImages: 1,
    specsText: 1,
    imageUrl: 1,
    detailImageUrl: 1,
    affectedIds: ["1"],
  });
  const summary = buildDifferenceSummary({
    collectedCount: 1,
    currentProducts: [fresh],
    candidateProducts: merged.products,
    convertedCount: 1,
    productionProducts: [old],
    failedDetails: 0,
    duplicates: 0,
    checkpoint: { exists: false },
  });
  assert.equal(summary.updated, 1);
  assert.deepEqual(summary.changedFields, { originalPriceValue: 1 });
  assert.equal(evaluateDegradedFieldFallbacks(merged.degradedFieldFallbacks, 100).passed, true);
  assert.equal(evaluateDegradedFieldFallbacks({ ...merged.degradedFieldFallbacks, affectedProducts: 6 }, 100).passed, false);
  assert.equal(evaluateDegradedFieldFallbacks({ ...merged.degradedFieldFallbacks, galleryImages: 101 }, 1000).passed, false);
}

function createScenario(name, options = {}) {
  const root = path.join(tempRoot, name);
  const rawRoot = path.join(root, "raw");
  const runRoot = path.join(root, "run");
  const productionPath = path.join(root, "production", "danish-products.json");
  const backupRoot = path.join(root, "backup");
  const lockPath = path.join(root, "state", "danish.lock");
  const logPath = path.join(root, "logs", "daily.log");
  const production = options.production || [1, 2, 3, 4].map((id) => makeProduct(id));
  const rawProducts = options.rawProducts || [1, 2, 3, 4].map((id) => makeRawProduct(id));
  const converted = options.converted || rawProducts
    .filter((item) => !item.detailError && !item.error && item.success !== false)
    .map((item) => makeProduct(Number(item.href.match(/-i(\d+)\.html/)[1])));
  writeJson(productionPath, production);
  if (!options.omitList) {
    writeJson(path.join(rawRoot, "list.json"), {
      integrityGate: true,
      products: rawProducts.map((item) => ({ href: item.href, name: item.name, price: item.price, status: item.status })),
    });
  }
  writeJson(path.join(rawRoot, "details.json"), {
    successCount: converted.length,
    failCount: rawProducts.length - converted.length,
    products: rawProducts,
  });
  writeJson(path.join(rawRoot, "detail-errors.json"), {
    failCount: rawProducts.length - converted.length,
    errors: rawProducts.filter((item) => item.detailError || item.error || item.success === false),
  });
  const calls = [];
  const pushExitCodes = [...(options.pushExitCodes || [])];
  const sleepDelays = [];
  const execute = async (request) => {
    calls.push(request.stage);
    if ((request.stage === "collect-list" || request.stage === "collect-details") && options.collectorOutput) {
      request.onOutput?.("stdout", options.collectorOutput);
    }
    if (options.failStage === request.stage) {
      return { exitCode: options.failExitCode || 1, timedOut: false, stdout: "", stderr: `${request.stage} fixture failure` };
    }
    if (request.stage === "git-push" && pushExitCodes.length > 0) {
      const exitCode = pushExitCodes.shift();
      const attempt = calls.filter((stage) => stage === "git-push").length;
      return {
        exitCode,
        timedOut: false,
        stdout: "",
        stderr: exitCode === 0 ? "" : `git-push fixture failure attempt ${attempt}`,
      };
    }
    if (request.stage === "git-cached-diff") {
      return {
        exitCode: options.cachedDiffExitCode ?? 1,
        timedOut: false,
        stdout: "",
        stderr: "",
      };
    }
    if (request.stage === "convert" && !options.omitConvertedOutput) {
      const conversionInput = JSON.parse(fs.readFileSync(request.env.DANISH_FULL_INPUT, "utf8"));
      const selectedIds = new Set(conversionInput.products.map((item) => Number(item.href.match(/-i(\d+)\.html/)[1])));
      const selectedConverted = converted.filter((item) => selectedIds.has(item.id));
      fs.mkdirSync(path.dirname(request.env.DANISH_PRODUCTS_OUTPUT), { recursive: true });
      fs.writeFileSync(
        request.env.DANISH_PRODUCTS_OUTPUT,
        options.malformedConvertedOutput ? "export const danishProducts = [not json];\n" : convertedSource(selectedConverted),
        "utf8"
      );
    }
    if (options.onStage) options.onStage(request, { productionPath, backupRoot });
    return { exitCode: 0, timedOut: false, stdout: "fixture pass", stderr: "" };
  };
  return {
    root,
    rawRoot,
    runRoot,
    productionPath,
    backupRoot,
    lockPath,
    logPath,
    production,
    rawProducts,
    converted,
    calls,
    execute,
    sleep: async (milliseconds) => { sleepDelays.push(milliseconds); },
    sleepDelays,
  };
}

// Collector output is appended to the main Danish log before the stage exits.
{
  const scenario = createScenario("collector-output-log", {
    collectorOutput: "[manual-verification-required] fixture",
    production: [makeProduct(1, { specsText: [] }), makeProduct(2), makeProduct(3), makeProduct(4)],
    rawProducts: [makeRawProduct(1), makeRawProduct(2), makeRawProduct(3), makeRawProduct(4)],
  });
  writeJson(path.join(scenario.rawRoot, "details.partial.json"), { checkpoint: true, products: scenario.rawProducts });
  const report = await runScenario(scenario, "collect-only");
  assert.equal(report.status, "collect-only-passed");
  assert.equal(report.stages["collect-list"].reason, "existing-list-reused");
  assert.equal(report.detailQueueCount, 1);
  assert.equal(report.detailProgress.alreadyCompletedDetailCount, 1);
  assert.equal(report.alreadyCompletedDetailCount, 1);
  assert.equal(report.collection.checkpoint.exists, true);
  assert.match(fs.readFileSync(scenario.logPath, "utf8"), /manual-verification-required/);
}

async function runScenario(scenario, mode, extra = {}) {
  return await runDanishDaily({
    root: scenario.root,
    rawRoot: scenario.rawRoot,
    runRoot: scenario.runRoot,
    productionPath: scenario.productionPath,
    backupRoot: scenario.backupRoot,
    lockPath: scenario.lockPath,
    logPath: scenario.logPath,
    runId: path.basename(scenario.root),
    mode,
    ...extra,
  }, { execute: scenario.execute, sleep: scenario.sleep });
}

// DryRun validates and converts, but leaves Production and every publishing stage untouched.
{
  const scenario = createScenario("dry-run");
  const before = fs.readFileSync(scenario.productionPath, "utf8");
  const report = await runScenario(scenario, "dry-run");
  assert.equal(report.status, "dry-run-passed");
  assert.equal(report.productionWritten, false);
  assert.equal(fs.readFileSync(scenario.productionPath, "utf8"), before);
  assert.deepEqual(scenario.calls, []);
  assert.equal(scenario.calls.includes("build"), false);
  assert.equal(scenario.calls.includes("git-commit"), false);
  assert.equal(scenario.calls.includes("git-push"), false);
  assert.equal(report.diff.checkpoint.exists, false);
  const log = fs.readFileSync(scenario.logPath, "utf8");
  assert.match(log, /collection-summary/);
  assert.match(log, /difference-summary/);
  assert.match(log, /productionWritten/);
}

// A converter exit 0 with malformed output still blocks before Production.
{
  const scenario = createScenario("converter-malformed-json", {
    malformedConvertedOutput: true,
    production: [makeProduct(1, { specsText: [] }), makeProduct(2), makeProduct(3), makeProduct(4)],
    rawProducts: [makeRawProduct(1), makeRawProduct(2), makeRawProduct(3), makeRawProduct(4)],
  });
  const report = await runScenario(scenario, "daily");
  assert.equal(report.status, "failed");
  assert.match(report.failureReason, /Unexpected token|JSON/);
  assert.equal(report.productionWritten, false);
  assert.deepEqual(scenario.calls, ["collect-details", "convert"]);
}

// CollectOnly runs collection validation and never enters conversion.
{
  const scenario = createScenario("collect-only");
  const report = await runScenario(scenario, "collect-only");
  assert.equal(report.status, "collect-only-passed");
  assert.deepEqual(scenario.calls, []);
  assert.equal(report.productionWritten, false);
}

// A collector exit failure stops the workflow immediately.
{
  const scenario = createScenario("collector-failure", { failStage: "collect-list", omitList: true });
  const report = await runScenario(scenario, "daily");
  assert.equal(report.status, "failed");
  assert.match(report.failureReason, /collect-list-failed/);
  assert.deepEqual(scenario.calls, ["collect-list"]);
}

// Invalid source JSON blocks before conversion.
{
  const scenario = createScenario("invalid-json");
  fs.writeFileSync(path.join(scenario.rawRoot, "details.json"), "{not json", "utf8");
  const report = await runScenario(scenario, "dry-run");
  assert.equal(report.status, "failed");
  assert.deepEqual(scenario.calls, []);
}

// A List omission retains historical Production records instead of pretending this is a detail failure.
{
  const production = Array.from({ length: 20 }, (_, index) => makeProduct(index + 1));
  const rawProducts = [makeRawProduct(1), makeRawProduct(2)];
  const scenario = createScenario("abnormal-drop", { production, rawProducts });
  const report = await runScenario(scenario, "dry-run");
  assert.equal(report.status, "dry-run-passed");
  assert.deepEqual(scenario.calls, []);
  assert.equal(report.diff.disappeared, 18);
}

// A missing Production baseline blocks before either List or details collection; it never falls back to full details.
{
  const scenario = createScenario("missing-production");
  fs.unlinkSync(scenario.productionPath);
  const report = await runScenario(scenario, "collect-only");
  assert.equal(report.status, "failed");
  assert.match(report.failureReason, /production-baseline-missing/);
  assert.deepEqual(scenario.calls, []);
}

// An abnormal incremental queue is blocked before the collector can fetch every product.
{
  const production = Array.from({ length: 20 }, (_, index) => makeProduct(index + 1, { specsText: [] }));
  const rawProducts = production.map((item) => makeRawProduct(item.id, { name: `${item.name} changed` }));
  const scenario = createScenario("queue-gate", { production, rawProducts });
  const report = await runScenario(scenario, "collect-only");
  assert.equal(report.status, "failed");
  assert.match(report.failureReason, /detail-queue-abnormal-full-refresh-risk/);
  assert.deepEqual(scenario.calls, []);
}

// A converter exit failure stops before backup, Production, build, and Git.
{
  const scenario = createScenario("converter-failure", {
    failStage: "convert",
    production: [makeProduct(1, { specsText: [] }), makeProduct(2), makeProduct(3), makeProduct(4)],
    rawProducts: [makeRawProduct(1), makeRawProduct(2), makeRawProduct(3), makeRawProduct(4)],
  });
  const report = await runScenario(scenario, "daily");
  assert.equal(report.status, "failed");
  assert.match(report.failureReason, /convert-failed/);
  assert.equal(report.backupCreated, false);
  assert.equal(report.productionWritten, false);
  assert.deepEqual(scenario.calls, ["collect-details", "convert"]);
}

// Daily creates a backup before writing Production, then rebuilds and builds without Git.
{
  let backupObservedBeforeRebuild = false;
  const scenario = createScenario("daily-success", {
    converted: [1, 2, 3, 4, 5].map((id) => makeProduct(id)),
    rawProducts: [1, 2, 3, 4, 5].map((id) => makeRawProduct(id)),
    onStage(request, paths) {
      if (request.stage === "rebuild-unified") {
        backupObservedBeforeRebuild = fs.existsSync(path.join(paths.backupRoot, "danish-products.before.json"));
      }
    },
  });
  const report = await runScenario(scenario, "daily");
  assert.equal(report.status, "daily-passed");
  assert.equal(report.backupCreated, true);
  assert.equal(report.productionWritten, true);
  assert.equal(backupObservedBeforeRebuild, true);
  assert.deepEqual(scenario.calls, ["collect-details", "convert", "rebuild-unified", "rebuild-public", "build"]);
  assert.equal(report.commitExecuted, false);
  assert.equal(report.pushExecuted, false);
}

// Build failure in Publish mode must prevent commit and push.
{
  const scenario = createScenario("publish-build-failure", { failStage: "build" });
  const report = await runScenario(scenario, "publish");
  assert.equal(report.status, "failed");
  assert.equal(report.commitExecuted, false);
  assert.equal(report.pushExecuted, false);
  assert.equal(scenario.calls.includes("git-commit"), false);
  assert.equal(scenario.calls.includes("git-push"), false);
}

// Staged changes make the cached diff exit 1, so Publish reaches commit and push.
{
  const scenario = createScenario("publish-success");
  const report = await runScenario(scenario, "publish");
  assert.equal(report.status, "publish-passed");
  assert.equal(report.buildPassed, true);
  assert.equal(report.commitExecuted, true);
  assert.equal(report.pushExecuted, true);
  assert.equal(report.commitSkipped, false);
  assert.equal(report.pushSkipped, false);
  assert.deepEqual(scenario.calls.slice(-6), ["build", "git-diff-check", "git-add", "git-cached-diff", "git-commit", "git-push"]);
}

// Transient publication failures retry only git push and eventually preserve a successful publication.
{
  const scenario = createScenario("publish-push-retry-success", { pushExitCodes: [1, 1, 0] });
  const report = await runScenario(scenario, "publish");
  assert.equal(report.status, "publish-passed");
  assert.equal(report.commitExecuted, true);
  assert.equal(report.pushExecuted, true);
  assert.equal(report.pushAttempts, 3);
  assert.deepEqual(scenario.sleepDelays, [10000, 30000]);
  assert.equal(scenario.calls.filter((stage) => stage === "git-push").length, 3);
  assert.equal(scenario.calls.filter((stage) => stage === "git-commit").length, 1);
}

// A final publication failure retains the completed local commit and reports the third Git error.
{
  const scenario = createScenario("publish-push-retry-failure", { pushExitCodes: [1, 1, 1] });
  const report = await runScenario(scenario, "publish");
  assert.equal(report.status, "failed");
  assert.equal(report.commitExecuted, true);
  assert.equal(report.pushExecuted, false);
  assert.equal(report.pushAttempts, 3);
  assert.deepEqual(scenario.sleepDelays, [10000, 30000]);
  assert.equal(scenario.calls.filter((stage) => stage === "git-push").length, 3);
  assert.equal(scenario.calls.filter((stage) => stage === "git-commit").length, 1);
  assert.match(report.failureReason, /git-push fixture failure attempt 3/);
}

// An empty staged diff is a successful no-op, even when unrelated local files exist.
{
  const scenario = createScenario("publish-noop", { cachedDiffExitCode: 0 });
  const unrelatedLocalPath = path.join(scenario.root, "raw", "untracked-local-note.txt");
  fs.writeFileSync(unrelatedLocalPath, "preserve this local artifact", "utf8");
  const report = await runScenario(scenario, "publish");
  assert.equal(report.status, "publish-noop");
  assert.equal(report.allowPublish, true);
  assert.equal(report.failureReason, null);
  assert.equal(report.commitExecuted, false);
  assert.equal(report.pushExecuted, false);
  assert.equal(report.commitSkipped, true);
  assert.equal(report.pushSkipped, true);
  assert.equal(report.skipReason, "no-changes");
  assert.equal(scenario.calls.includes("git-commit"), false);
  assert.equal(scenario.calls.includes("git-push"), false);
  assert.deepEqual(scenario.calls.slice(-4), ["build", "git-diff-check", "git-add", "git-cached-diff"]);
}

// Any cached-diff exit other than 0 or 1 is a real Git failure.
{
  const scenario = createScenario("publish-cached-diff-failure", { cachedDiffExitCode: 2 });
  const report = await runScenario(scenario, "publish");
  assert.equal(report.status, "failed");
  assert.equal(report.allowPublish, false);
  assert.match(report.failureReason, /git-cached-diff-failed exitCode=2/);
  assert.equal(report.commitExecuted, false);
  assert.equal(report.pushExecuted, false);
  assert.equal(scenario.calls.includes("git-commit"), false);
  assert.equal(scenario.calls.includes("git-push"), false);
}

// A failed detail retains the existing Production record instead of deleting it.
{
  const failedOld = makeProduct(3, {
    name: "Keep old detail after one failure",
    specsText: [],
    detail: "Keep old detail body after one failure",
    galleryImages: ["https://example.test/old-detail-3.jpg"],
    originalPrice: "$ 100,-",
    price: "$ 100,-",
    originalCurrency: "USD",
    originalPriceValue: 100,
  });
  const rawProducts = [
    makeRawProduct(1),
    makeRawProduct(2),
    makeRawProduct(3, { price: "$ 120,-", detailError: "fixture timeout", success: false }),
    makeRawProduct(4),
  ];
  const scenario = createScenario("detail-failure-retained", {
    production: [makeProduct(1), makeProduct(2), failedOld, makeProduct(4)],
    rawProducts,
  });
  const report = await runScenario(scenario, "daily");
  assert.equal(report.status, "daily-passed");
  assert.equal(report.collection.failedDetails, 1);
  assert.equal(report.conversion.retainedFromProduction, 4);
  assert.equal(report.detailProgress.failedDetailCount, 1);
  assert.equal(report.diff.disappeared, 0);
  const written = JSON.parse(fs.readFileSync(scenario.productionPath, "utf8"));
  assert.equal(written.find((item) => item.id === 3).name, "Danish Pipe 3");
  assert.equal(written.find((item) => item.id === 3).originalPrice, "$ 120,-");
  assert.equal(written.find((item) => item.id === 3).detail, failedOld.detail);
  assert.deepEqual(written.find((item) => item.id === 3).galleryImages, failedOld.galleryImages);
}

// A failed new detail is recorded but never inserted into Production.
{
  const rawProducts = [
    makeRawProduct(1),
    makeRawProduct(2),
    makeRawProduct(3),
    makeRawProduct(4),
    makeRawProduct(5, { detailError: "fixture timeout", success: false }),
  ];
  const scenario = createScenario("new-detail-failure-not-published", { rawProducts });
  const report = await runScenario(scenario, "daily");
  assert.equal(report.status, "daily-passed");
  assert.equal(report.detailQueue.newCount, 1);
  assert.equal(report.detailProgress.failedDetailCount, 1);
  const written = JSON.parse(fs.readFileSync(scenario.productionPath, "utf8"));
  assert.equal(written.some((item) => item.id === 5), false);
  assert.equal(written.length, 4);
}

// Simple Danish-only lock: live PID blocks, dead PID is recoverable.
{
  const lockPath = path.join(tempRoot, "locks", "live.lock");
  const first = acquireDanishLock({ lockPath, mode: "daily", isPidAlive: () => false });
  assert.equal(first.acquired, true);
  const blocked = acquireDanishLock({ lockPath, mode: "publish", isPidAlive: () => true });
  assert.equal(blocked.acquired, false);
  assert.equal(blocked.current.mode, "daily");
  assert.equal(releaseDanishLock({ lockPath }), true);

  const stalePath = path.join(tempRoot, "locks", "stale.lock");
  writeJson(stalePath, { pid: 999999, startedAt: "2000-01-01T00:00:00.000Z", mode: "daily" });
  const recovered = acquireDanishLock({ lockPath: stalePath, mode: "dry-run", isPidAlive: () => false });
  assert.equal(recovered.acquired, true);
  assert.equal(recovered.recoveredStale, true);
  assert.equal(releaseDanishLock({ lockPath: stalePath }), true);
}

// The merge helper also independently proves fresh values win while missing IDs stay retained.
{
  const old = [makeProduct(1, { name: "old" }), makeProduct(2, { name: "retained" })];
  const merged = mergeConvertedWithProduction({
    convertedProducts: [makeProduct(1, { name: "fresh" })],
    productionProducts: old,
  });
  assert.equal(merged.products.find((item) => item.id === 1).name, "fresh");
  assert.equal(merged.products.find((item) => item.id === 2).name, "retained");
  assert.equal(merged.retainedFromProduction, 1);
}

// Source-side verification errors alone get exactly two delayed whole-run retries.
{
  assert.equal(isDanishStrongVerificationFailure("collect-list-failed exitCode=1 manual-verification-timeout after 900 seconds"), true);
  assert.equal(isDanishStrongVerificationFailure("robot-verification-still-present"), true);
  assert.equal(isDanishStrongVerificationFailure("parser contract failure"), false);
  assert.equal(isDanishStrongVerificationFailure("production gate failure"), false);
  assert.equal(isDanishStrongVerificationFailure("git diverged"), false);

  const attempts = [];
  const waits = [];
  let inventoryLockHeld = false;
  const report = await runDanishDailyWithStrongVerificationRetry({ runId: "verification-fixture" }, {
    runOnce: async (options, attempt) => {
      inventoryLockHeld = true;
      attempts.push(options.runId);
      // Mirrors runDanishDaily: its finally block releases before the outer retry loop regains control.
      inventoryLockHeld = false;
      return { status: "failed", failureReason: "manual-verification-timeout", productionWritten: false };
    },
    wait: async (milliseconds) => {
      assert.equal(inventoryLockHeld, false);
      waits.push(milliseconds);
    },
  });
  assert.deepEqual(attempts, ["verification-fixture-attempt-1", "verification-fixture-attempt-2", "verification-fixture-attempt-3"]);
  assert.deepEqual(waits, [30 * 60 * 1000, 60 * 60 * 1000]);
  assert.equal(report.status, "failed");
  assert.equal(report.productionWritten, false);
  assert.equal(report.strongVerificationRetry.attempt, 3);
  assert.equal(report.strongVerificationRetry.final, true);

  let successfulAttempts = 0;
  const successfulWaits = [];
  const success = await runDanishDailyWithStrongVerificationRetry({ runId: "verification-then-success" }, {
    runOnce: async () => {
      successfulAttempts += 1;
      return successfulAttempts === 1
        ? { status: "failed", failureReason: "robot-verification-still-present", productionWritten: false }
        : { status: "daily-passed", failureReason: null, productionWritten: false };
    },
    wait: async (milliseconds) => successfulWaits.push(milliseconds),
  });
  assert.equal(successfulAttempts, 2);
  assert.deepEqual(successfulWaits, [30 * 60 * 1000]);
  assert.equal(success.status, "daily-passed");
  assert.equal(success.strongVerificationRetry.final, true);

  let ordinaryAttempts = 0;
  const ordinary = await runDanishDailyWithStrongVerificationRetry({ runId: "ordinary-failure" }, {
    runOnce: async () => ({ status: "failed", failureReason: "conversion-validation-failed parser contract", productionWritten: false, attempt: ++ordinaryAttempts }),
    wait: async () => assert.fail("ordinary failures must not wait or retry"),
  });
  assert.equal(ordinaryAttempts, 1);
  assert.equal(ordinary.strongVerificationRetry.retryable, false);
}

console.log("Danish daily v1 offline tests passed");
