import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { buildDiffPreview, evaluateIntegrity, inspectHtml, parseListHtml, runPreview, writeAtomic } from "./danish-full-refresh-preview-v1.mjs";

const fixture = (name) => fs.readFileSync(path.join(process.cwd(), "scripts", "inventory", "fixtures", "danish-full-refresh", name), "utf8");
assert.equal(parseListHtml(fixture("page-1.html")).products.length, 2); // A normal first page
assert.equal(parseListHtml(fixture("page-1.html")).expectedPages, 3); // first page is not total pages
assert.equal(parseListHtml(fixture("page-2.html"), "https://example.test/p2", 2).nextUrl, "https://example.test/p3"); // multi page
assert.equal(inspectHtml(fixture("blocked-cloudflare.html")).kind, "blocked"); // E Cloudflare/Verify/CAPTCHA/denied/just-a-moment
assert.equal(inspectHtml(fixture("structure-change.html")).kind, "structure-change");
assert.equal(parseListHtml(fixture("empty.html")).products.length, 0); // B/C caller treats first/middle empty as failure, final empty as normal end

const production = [
  { id: 1, brand: "Alpha", name: "Sold next", status: "可购买", originalPriceValue: 10, originalCurrency: "EUR", sourceUrl: "https://x/d/-zh/a-i1.html", imageUrl: "a.jpg" },
  { id: 2, brand: "Beta", name: "Back", status: "已售", originalPriceValue: 20, originalCurrency: "EUR", sourceUrl: "https://x/d/-zh/b-i2.html", imageUrl: "b.jpg" },
  { id: 3, brand: "Gone", name: "Missing", status: "可购买", originalPriceValue: 30, originalCurrency: "EUR", sourceUrl: "https://x/d/-zh/c-i3.html" },
];
const current = [
  { sourceProductId: "1", sourceUrl: "https://x/d/-zh/a-i1.html", brand: "Alpha", title: "Sold next", inventoryStatus: "sold", priceAmount: 11, currency: "EUR" },
  { sourceProductId: "2", sourceUrl: "https://x/d/-zh/b-i2.html", brand: "Beta", title: "Back", inventoryStatus: "available", priceAmount: 20, currency: "EUR" },
  { sourceProductId: "4", sourceUrl: "https://x/d/-zh/new-i4.html", brand: "New", title: "New", inventoryStatus: "available", priceAmount: 40, currency: "EUR" },
  { sourceProductId: "5", sourceUrl: "https://x/d/-zh/falcon-i5.html", brand: "Falcon", title: "Falcon pipe", inventoryStatus: "available" },
  { sourceProductId: "6", sourceUrl: "https://x/d/-zh/unknown-i6.html", brand: "U", title: "Unknown", inventoryStatus: "unknown", detail: { error: "retry" } },
  { sourceProductId: "4", sourceUrl: "https://x/d/-zh/new-i4.html", brand: "New", title: "New duplicate", inventoryStatus: "available" },
];
const gate = { complete: true, homepageSuccess: true, expectedPages: 3, successfulPages: 3, failedPages: 0, abnormalEmptyPages: 0, blockedPages: 0, endConditionTrusted: true, uniqueIdStable: false, duplicateIds: 1, duplicateUrls: 1, unknown: 1, blocked: 0, detailFailures: 1, detailFailureRate: 0.2, noFailureMappedToSold: true, diffReproducible: true };
const first = buildDiffPreview(current, production, [{ id: "danish-1", source: "danish", inventoryStatus: "available", sourceProductId: "1" }], gate);
const second = buildDiffPreview(current, production, [{ id: "danish-1", source: "danish", inventoryStatus: "available", sourceProductId: "1" }], gate);
assert.equal(first.counts.new, 3); assert.equal(first.counts["available-to-sold"], 1); assert.equal(first.counts["sold-to-available"], 1); assert.equal(first.counts["price-change"], 1); assert.equal(first.counts["missing-from-current-list"], 1); // G/H
assert.equal(first.counts.unknown, 1); assert.equal(first.counts["detail-failed"], 1); assert.equal(first.counts["falcon-excluded"], 1); // I/J/K/M
assert.equal(first.counts["unique-id-conflict"], 1); assert.equal(first.counts["duplicate-product"], 1); assert.equal(first.counts["production-public-mismatch"], 2); // F/N
assert.equal(first.reproducibilityHash, second.reproducibilityHash); // L
assert.equal(first.allowApply, false); assert.equal(first.productionWritten, false); assert.equal(first.publicWritten, false); // P

const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), "danish-preview-run-"));
const productionPath = path.join(process.cwd(), "data", "products", "danish-products.json");
const productionHash = crypto.createHash("sha256").update(fs.readFileSync(productionPath)).digest("hex");
const list = { expectedPages: 2, pages: [{ pageIndex: 1, kind: "success", endReason: "next" }, { pageIndex: 2, kind: "success", endReason: "no-next" }], products: current.filter((item) => item.sourceProductId !== "4" || item.title === "New") };
const firstRun = await runPreview({ automationWorktree: process.cwd(), outputRoot: runRoot, runId: "fixture-run-001", collectedList: list, detailState: { 1: { sourceProductId: "1", sourceUrl: list.products[0].sourceUrl, title: "ok" }, 6: { sourceProductId: "6", sourceUrl: list.products[4].sourceUrl, error: "retry" } }, baseline: { production, publicCatalog: [] } });
assert.equal(firstRun.manifest.pending > 0, true); assert.equal(firstRun.manifest.detailFailed, 1); // J checkpoint / K failed detail retry
const secondRun = await runPreview({ automationWorktree: process.cwd(), outputRoot: runRoot, runId: "fixture-run-001", resume: true, collectedList: list, detailState: { 1: { sourceProductId: "1", sourceUrl: list.products[0].sourceUrl, title: "ok", reused: true }, 6: { sourceProductId: "6", sourceUrl: list.products[4].sourceUrl, title: "retried ok" } }, baseline: { production, publicCatalog: [] } });
assert.equal(secondRun.manifest.detailFailed, 0); assert.equal(secondRun.manifest.detailReused, 1); assert.equal(fs.existsSync(path.join(runRoot, "data", "raw", "danish-full-refresh", "fixture-run-001", "checkpoint.json")), true);
await assert.rejects(() => writeAtomic(path.join(runRoot, "too-large.json"), "x".repeat(10), 8), /report-size-limit/); // O atomic size limit
const blockedGate = evaluateIntegrity({ pages: [{ pageIndex: 1, kind: "blocked", endReason: "blocked" }], currentProducts: [], expectedPages: 1, detailState: {} });
assert.equal(blockedGate.complete, false); // B/C/D/E gate distinction is retained in page audit
assert.equal(crypto.createHash("sha256").update(fs.readFileSync(productionPath)).digest("hex"), productionHash); // no Production write
console.log("Danish full refresh preview fixtures passed");
