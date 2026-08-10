import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  buildGqDetailQueue,
  collectGqCurrentList,
  mergeGqCurrentList,
  parseGbpAmount,
  parseGqDetailPage,
  parseGqListPage,
  runGqDaily,
  validateGqCandidate,
} from "./run-gqtobaccos-daily-v1.mjs";
import { buildInventoryDiff } from "./smokingpipes-diff-inventory-v1.mjs";
import { calculateReferencePrice } from "../../lib/pricing/reference-price.mjs";
import { buildUnifiedProductsFromInputs } from "../build-unified-products-staging-v1.mjs";
import { publicPriceFieldsFromRow } from "../build-public-product-indexes-v1.mjs";

const GBP = "\u00a3";

function card({ id, title, brand, price, msrp = null, now = null }) {
  return `<article class="card" data-entity-id="${id}" data-name="${title}" data-product-category="Pipes, Pipes/${brand}" data-product-price="${price}">
  <a class="card-figure__link" href="/pipes/${id}/"><img src="https://images.example/${id}.jpg" /></a>
  <div class="card-body"><h3 class="card-title"><a>${title}</a></h3>
  ${msrp === null ? "" : `<span>MSRP: ${GBP}${msrp}</span>`}
  ${now === null ? `<span data-product-price-with-tax class="price">${GBP}${price}</span>` : `<span>Now: ${GBP}${now}</span>`}
  </div></article>`;
}

function page({ cards = [], page = 1, total = 3, end = false, age = true }) {
  return `<main ${age ? "" : "data-no-age"}>
  ${age ? "<div>Are You The Legal Age?</div>" : ""}
  <div data-list-name="Category: Pipes"><ul class="productGrid">${cards.join("\n")}</ul></div>
  <nav class="pagination"><a aria-label="Page ${page} of ${total}" href="/pipes/?page&#x3D;${page}&amp;setCurrencyId&#x3D;1">${page}</a>
  <a aria-label="Page ${total} of ${total}" href="/pipes/?page&#x3D;${total}&amp;setCurrencyId&#x3D;1">${total}</a></nav>
  ${end ? "<p>There are no products listed under this category.</p>" : ""}
  </main>`;
}

const normalPage = page({
  cards: [
    card({ id: "100", title: "Savinelli - Test Pipe", brand: "Savinelli", price: "80.00", msrp: "120.00", now: "80.00" }),
    card({ id: "101", title: "Falcon - Excluded Pipe", brand: "Falcon", price: "70.00" }),
    card({ id: "102", title: "Replacement Stem Only", brand: "Savinelli", price: "12.00" }),
    card({ id: "103", title: "Three Pipe Set - Complete", brand: "Savinelli", price: "160.00" }),
  ],
});

const parsed = parseGqListPage(normalPage, { page: 1, url: "https://www.gqtobaccos.com/pipes/?page=1&setCurrencyId=1" });
assert.equal(parsed.normalCategory, true, "age modal must not be interpreted as a block");
assert.equal(parsed.ageModalPresent, true);
assert.equal(parsed.maxPage, 3);
assert.equal(parsed.products.length, 4);
assert.equal(parsed.products[0].sourceProductId, "100");
assert.equal(parsed.products[0].priceGBP, 80, "Now must win over MSRP");
assert.equal(parsed.products[0].msrpAmount, 120);
assert.equal(parsed.products[0].currency, "GBP");
assert.equal(parsed.products[0].inventoryStatus, "available");
assert.equal(parsed.products[1].publicEligibility.publicIndexEligible, false, "Falcon must be excluded before detail queue");
assert.equal(parsed.products[2].publicEligibility.entityType, "component");
assert.equal(parsed.products[3].publicEligibility.publicIndexEligible, true, "complete Pipe Set must remain eligible");
assert.equal(parseGbpAmount(`${GBP}1,234.50`), 1234.5);
assert.equal(parseGbpAmount("RRP only"), null);

const endPage = parseGqListPage(page({ cards: [], page: 4, total: 3, end: true }), { page: 4 });
assert.equal(endPage.endOfList, true, "only the explicit normal empty category is an end-of-list");
const invalidEmpty = parseGqListPage(page({ cards: [], page: 2, total: 3, end: false }), { page: 2 });
assert.equal(invalidEmpty.endOfList, false, "an ordinary empty intermediate page is unsafe");

function response(html, { status = 200, retryAfter = null, url = "https://www.gqtobaccos.com/pipes/" } = {}) {
  const headers = new Headers();
  if (retryAfter !== null) headers.set("retry-after", String(retryAfter));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    url,
    text: async () => html,
  };
}

function pageNumberFromUrl(url) {
  return Number(new URL(url).searchParams.get("page"));
}

const retryListPageOne = page({ cards: [card({ id: "201", title: "Savinelli - Retry One", brand: "Savinelli", price: "75.00" })], page: 1, total: 2 });
const retryListPageTwo = page({ cards: [card({ id: "202", title: "Savinelli - Retry Two", brand: "Savinelli", price: "85.00" })], page: 2, total: 2 });
const retryListEnd = page({ cards: [], page: 3, total: 2, end: true });

const retryAfterCalls = [];
const retryAfterSleeps = [];
const retryAfterList = await collectGqCurrentList({
  fetchImpl: async (url) => {
    const pageNumber = pageNumberFromUrl(url);
    retryAfterCalls.push(pageNumber);
    if (pageNumber === 1) return response(retryListPageOne, { url });
    if (pageNumber === 2 && retryAfterCalls.filter((value) => value === 2).length === 1) {
      return response("rate limited", { status: 429, retryAfter: 7, url });
    }
    if (pageNumber === 2) return response(retryListPageTwo, { url });
    return response(retryListEnd, { url });
  },
  sleep: async (ms) => retryAfterSleeps.push(ms),
  random: () => 0,
  listPageDelayRangeMs: [0, 0],
});
assert.deepEqual(retryAfterCalls, [1, 2, 2, 3], "429 retry must repeat the same current page before pagination continues");
assert.deepEqual(retryAfterSleeps.filter((ms) => ms > 0), [7_000], "Retry-After must take precedence over random backoff");
assert.equal(retryAfterList.summary.pagesDiscovered, 2);
assert.equal(retryAfterList.summary.pagesCompleted, 2);
assert.equal(retryAfterList.summary.pagesFailed, 0);
assert.equal(retryAfterList.summary.lastSuccessfulPage, 2);
assert.equal(retryAfterList.summary.rateLimitRetryCount, 1);

const fallbackSleeps = [];
let fallbackPageTwoAttempts = 0;
const fallbackList = await collectGqCurrentList({
  fetchImpl: async (url) => {
    const pageNumber = pageNumberFromUrl(url);
    if (pageNumber === 1) return response(retryListPageOne, { url });
    if (pageNumber === 2 && fallbackPageTwoAttempts++ === 0) return response("rate limited", { status: 429, url });
    if (pageNumber === 2) return response(retryListPageTwo, { url });
    return response(retryListEnd, { url });
  },
  sleep: async (ms) => fallbackSleeps.push(ms),
  random: () => 0,
  listPageDelayRangeMs: [0, 0],
});
assert.deepEqual(fallbackSleeps.filter((ms) => ms > 0), [30_000], "first 429 without Retry-After must use the 30-45 second range");
assert.equal(fallbackList.summary.pagesCompleted, fallbackList.summary.pagesDiscovered);

const failedSleeps = [];
let failedPageTwoAttempts = 0;
await assert.rejects(
  () => collectGqCurrentList({
    fetchImpl: async (url) => {
      const pageNumber = pageNumberFromUrl(url);
      if (pageNumber === 1) return response(retryListPageOne, { url });
      failedPageTwoAttempts += 1;
      return response("rate limited", { status: 429, url });
    },
    sleep: async (ms) => failedSleeps.push(ms),
    random: () => 0,
    listPageDelayRangeMs: [0, 0],
  }),
  (error) => {
    assert.equal(error.status, 429);
    assert.deepEqual(error.listProgress, {
      pagesDiscovered: 2,
      pagesCompleted: 1,
      pagesFailed: 1,
      lastSuccessfulPage: 1,
    });
    return true;
  },
);
assert.equal(failedPageTwoAttempts, 4, "a page may receive exactly three 429 retries after its original request");
assert.deepEqual(failedSleeps.filter((ms) => ms > 0), [30_000, 60_000, 120_000]);

const detailHtml = `<div class="productView" data-entity-id="100" data-product-category="Pipes, Pipes/Savinelli">
<h1 class="productView-name">Savinelli - Test Pipe</h1>
<section class="productView-images" data-zoom-image="https://images.example/100-large.jpg"></section>
<div class="productView-description"><div id="tab-description"><p>Pipe Material : Briar<br />Finish : Rusticated<br />Filter : 6mm<br />Pipe Length : 140 mm<br />Bowl Height : 48 mm<br />Pipe Weight : 42 grams</p></div><div id="tab-reviews"></div></div>
<script>var BCData = {"product_attributes":{"price":{"with_tax":{"formatted":"${GBP}80.00","value":80,"currency":"GBP"},"rrp_with_tax":{"formatted":"${GBP}120.00","value":120,"currency":"GBP"}},"instock":true,"purchasable":true,"available_to_sell":1}};</script>`;
const detail = parseGqDetailPage(detailHtml, { sourceUrl: "https://www.gqtobaccos.com/pipes/100/", sourceProductId: "100" });
assert.equal(detail.brand, "Savinelli");
assert.equal(detail.currency, "GBP");
assert.equal(detail.priceGBP, 80);
assert.equal(detail.msrpGBP, 120);
assert.equal(detail.specs.material, "Briar");
assert.equal(detail.specs.lengthMm, 140);
assert.equal(detail.specs.weightGrams, 42);
assert.equal(detail.detailOutOfStock, false);

const currentPayload = {
  source: "gqtobaccos",
  products: parsed.products,
  summary: {
    pagesRequested: 3,
    pagesScanned: 3,
    effectiveScannedPages: 3,
    expectedPages: 3,
    detectedTotalPages: 3,
    fullExpectedRangeScanned: true,
    failedPages: [],
    soldByAbsenceAllowed: true,
    disappearedApplyAllowed: true,
    duplicateStats: {
      classificationAvailable: true,
      totalDuplicateIds: 0,
      safeDuplicateCount: 0,
      suspiciousDuplicateCount: 0,
      suspiciousDuplicateIds: [],
    },
  },
};
const existingProducts = [
  {
    id: "gqtobaccos-100",
    sourceProductId: "100",
    sourceUrl: "https://www.gqtobaccos.com/pipes/100/",
    title: "Old Title",
    inventoryStatus: "sold",
    detailComplete: true,
    mainImageUrl: "https://images.example/old.jpg",
  },
  {
    id: "gqtobaccos-104",
    sourceProductId: "104",
    sourceUrl: "https://www.gqtobaccos.com/pipes/104/",
    title: "Disappeared Pipe",
    inventoryStatus: "available",
    detailComplete: true,
    mainImageUrl: "https://images.example/104.jpg",
    publicIndexEligible: true,
  },
];
const diff = buildInventoryDiff(currentPayload, existingProducts, {
  source: "gqtobaccos",
  allowedCurrencies: ["GBP"],
  allowLegacyDuplicateSnapshotOverride: false,
});
assert.deepEqual(diff.reappearedIds, ["100"]);
assert.deepEqual(diff.disappearedIds, ["104"]);
assert.equal(diff.allowApply, false, "a first synthetic surge must use the shared anomaly gate");

const emptyHistoricalBaselineBlocked = buildInventoryDiff(currentPayload, [], {
  source: "gqtobaccos",
  allowedCurrencies: ["GBP"],
  allowLegacyDuplicateSnapshotOverride: false,
});
assert.equal(emptyHistoricalBaselineBlocked.allowApply, false, "the zero-history exception must be opt-in");
const emptyHistoricalBaselineAllowed = buildInventoryDiff(currentPayload, [], {
  source: "gqtobaccos",
  allowedCurrencies: ["GBP"],
  allowLegacyDuplicateSnapshotOverride: false,
  allowEmptyHistoricalBaseline: true,
});
assert.equal(emptyHistoricalBaselineAllowed.allowApply, true, "a first complete GQ baseline must retain the shared safety gates without inventing historical coverage");
assert.equal(emptyHistoricalBaselineAllowed.coverage.emptyHistoricalBaseline, true);

const queue = buildGqDetailQueue({ currentProducts: parsed.products, existingProducts, diff });
assert.equal(queue.summary.excludedBeforeDetail, 2, "Falcon and components must never enter the queue");
assert.equal(queue.items.some((item) => item.sourceProductId === "101"), false);
assert.equal(queue.items.some((item) => item.sourceProductId === "102"), false);
assert.equal(queue.items.some((item) => item.sourceProductId === "100"), true, "reappeared products need a detail refresh");

const detailsById = new Map([["100", detail], ["103", { ...detail, sourceProductId: "103", title: "Three Pipe Set - Complete", mainImageUrl: "https://images.example/103.jpg", images: ["https://images.example/103.jpg"] }]]);
const merged = mergeGqCurrentList({ currentProducts: parsed.products, existingProducts, detailsById, diff });
assert.equal(merged.find((item) => item.sourceProductId === "100").price.current.amount, 80, "the current List price must be reapplied after detail merge");
assert.equal(merged.find((item) => item.sourceProductId === "104").inventoryStatus, "sold", "complete current-list disappearance controls inventory");

const normalReference = calculateReferencePrice({ sourcePriceAmount: 100, sourceToCny: 9, internationalShippingAmount: 20 });
assert.equal(normalReference.taxableProductCostCny, 1080, "tax factor must be 1.2");
assert.equal(normalReference.shippingCny, 180, "fixed international shipping must be converted once");
assert.equal(normalReference.baseCostCny, 1260);
assert.equal(normalReference.serviceFeeCny, 200, "minimum service fee must apply below 15%");
assert.equal(normalReference.domesticShippingCny, 30);
assert.equal(normalReference.siteDisplayAmount, 1490);
const highReference = calculateReferencePrice({ sourcePriceAmount: 300, sourceToCny: 9, internationalShippingAmount: 20 });
assert.equal(highReference.serviceFeeCny, highReference.baseCostCny * 0.15, "15% service fee must apply above the minimum");
assert.equal(calculateReferencePrice({ sourcePriceAmount: 100, sourceToCny: null, internationalShippingAmount: 20 }).siteDisplayAmount, null, "missing GBP FX must never produce CNY 0");

const unifiedGq = buildUnifiedProductsFromInputs({
  danishProducts: [],
  smokingpipesProducts: [],
  gqtobaccosProducts: [
    {
      ...merged.find((item) => item.sourceProductId === "100"),
      publicIndexEligible: true,
      detailComplete: true,
    },
  ],
});
assert.equal(unifiedGq.length, 1);
assert.equal(unifiedGq[0].source, "gqtobaccos");
assert.equal(unifiedGq[0].price.currency, "GBP");
assert.equal(unifiedGq[0].price.internationalShippingAmount, 20);
const publicGqPrice = publicPriceFieldsFromRow(unifiedGq[0], {
  exchangeRates: { rates: { USD: 6.791, GBP: 9 } },
  smokingpipesPricing: {},
});
assert.equal(publicGqPrice.siteDisplayAmount, 1274, "public build must use GBP FX and fixed shipping through the shared calculator");
assert.equal(publicGqPrice.siteDisplayReady, true);
assert.equal(publicPriceFieldsFromRow(unifiedGq[0], { exchangeRates: { rates: { USD: 6.791 } }, smokingpipesPricing: {} }).siteDisplayAmount, null, "missing GBP config must never emit an incorrect CNY price");

const safeDiff = { ...diff, allowApply: true, newIds: [], reappearedIds: [] };
const safeProducts = merged.filter((item) => !["101", "102"].includes(item.sourceProductId));
for (const product of safeProducts) {
  product.publicIndexEligible = product.sourceProductId !== "104";
  product.detailComplete = true;
}
const validation = validateGqCandidate({ currentPayload: { ...currentPayload, products: parsed.products.filter((product) => !["101", "102"].includes(product.sourceProductId)) }, diff: safeDiff, products: safeProducts, gbpToCny: 9.0839 });
assert.equal(validation.passed, true);
assert.equal(validateGqCandidate({ currentPayload: { ...currentPayload, products: [] }, diff: safeDiff, products: [], gbpToCny: null }).passed, false, "missing GBP FX blocks publish");

const runnerSource = fs.readFileSync(path.join(process.cwd(), "scripts", "inventory", "run-gqtobaccos-daily-v1.mjs"), "utf8");
assert.match(runnerSource, /calculateReferencePrice/);
assert.doesNotMatch(runnerSource, /calculateGq(?:Tobaccos)?ReferencePrice/);
assert.match(runnerSource, /allowEmptyHistoricalBaseline:\s*true/);

const runnerResult = await runGqDaily({
  currentPayload: { ...currentPayload, products: parsed.products.filter((product) => !["101", "102"].includes(product.sourceProductId)) },
  existingProducts: safeProducts,
  detailsById,
  writeArtifacts: false,
  useLock: false,
});
assert.equal(runnerResult.productionWritten, false, "daily dry-run must not write Production");
assert.equal(runnerResult.pricing.internationalShippingGBP, 20);

const notificationFailureResult = await runGqDaily({
  currentPayload: { ...currentPayload, products: parsed.products.filter((product) => !["101", "102"].includes(product.sourceProductId)) },
  existingProducts: safeProducts,
  detailsById,
  writeArtifacts: false,
  useLock: false,
  notify: true,
  notificationEnv: { PUSHDEER_KEY: "fixture-key" },
  notificationFetchImpl: async () => ({ ok: false, status: 503 }),
});
assert.equal(notificationFailureResult.allowPublish, true, "notification delivery failure must not reverse a valid daily result");
assert.equal(notificationFailureResult.notification.notificationSent, false);
assert.equal(notificationFailureResult.notification.notificationReason, "PushDeer HTTP 503");

console.log("GQ Tobaccos daily V1 fixture tests passed.");
