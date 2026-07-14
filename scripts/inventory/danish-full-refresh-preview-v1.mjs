import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// Phase 0A preview only.  This module deliberately has no production/public writer.
const SOURCE = "danish";
const START_URL = "https://www.danishpipeshop.com/l/-zh/Pipes1";
const MAX_REPORT_BYTES = 2 * 1024 * 1024;
const FALCON = /\bfalcon\b/i;
const BLOCK_PATTERNS = [
  [/cloudflare/i, "cloudflare"], [/verify\s+(you are|you.re human|human)/i, "verify"],
  [/captcha|recaptcha|hcaptcha/i, "captcha"], [/access\s+denied|forbidden\s*\(403\)/i, "access-denied"],
  [/just a moment/i, "just-a-moment"], [/error\s*404|page not found|not found/i, "soft-404"],
];

function text(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function iso() { return new Date().toISOString(); }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
function json(value) { return `${JSON.stringify(stable(value), null, 2)}\n`; }
function products(payload) { return Array.isArray(payload) ? payload : payload?.products || payload?.items || payload?.data || []; }
function sourceId(item) {
  const direct = text(item?.sourceProductId || item?.id).replace(/^danish-/i, "");
  if (/^\d+$/.test(direct)) return direct;
  return text(item?.sourceUrl || item?.href || item?.originalUrl).match(/-i(\d+)\.html/i)?.[1] || "";
}
function status(value) {
  const v = text(value).toLowerCase();
  if (/removed|已移除/.test(v)) return "removed";
  if (/unavailable|not\s*available|缺货/.test(v)) return "unavailable";
  if (/已售|售罄|sold|out\s*of\s*stock|reserved|archive/.test(v)) return "sold";
  if (/可购买|现在购买|available|in\s*stock|add\s+to\s+(basket|cart)|buy\s*now/.test(v)) return "available";
  return "unknown";
}
function price(value) {
  const raw = text(value);
  const currency = /(?:dkk|kr\.?|dkr)/i.test(raw) ? "DKK" : /(?:eur|€)/i.test(raw) ? "EUR" : /(?:usd|\$)/i.test(raw) ? "USD" : "unknown";
  const numeric = raw.match(/\d[\d\s.,]*/)?.[0]?.replace(/\s/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(/,-?$/, "").replace(",", ".");
  const amount = Number.parseFloat(numeric);
  return { raw, currency, amount: Number.isFinite(amount) ? amount : null };
}
function absolute(href, base = START_URL) { try { return new URL(href, base).href; } catch { return ""; } }
function csv(value) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }
function unique(items) { return [...new Set(items.filter(Boolean))]; }
function isFalcon(item) { return FALCON.test([item?.brand, item?.title, item?.name, item?.rawText, item?.href].join(" ")); }
function isCompleteDetail(detail) { return Boolean(detail?.sourceProductId && detail?.sourceUrl && detail?.title && !detail?.error); }

export function inspectHtml(html) {
  const source = String(html || "");
  const normalized = text(source);
  const matched = BLOCK_PATTERNS.map(([pattern, code]) => pattern.test(normalized) && code).find(Boolean);
  if (matched) return { kind: "blocked", code: matched };
  const hasHtml = /<html|<body|<!doctype/i.test(source);
  const hasListStructure = /id=["']list-container-inner["']|class=["'][^"']*list-item/i.test(source);
  if (!hasHtml || !hasListStructure) return { kind: "structure-change", code: "list-structure-missing" };
  return { kind: "ok", code: "" };
}

// Offline HTML parser mirrors the selectors used by the live Playwright collector.
export function parseListHtml(html, listUrl = START_URL, pageIndex = 1) {
  const inspection = inspectHtml(html);
  if (inspection.kind !== "ok") return { inspection, products: [], nextUrl: "", expectedPages: null };
  const cards = String(html).match(/<[^>]+class=["'][^"']*list-item[^"']*["'][\s\S]*?<\/[^>]+>/gi) || [];
  const seen = new Set();
  const found = [];
  for (const card of cards) {
    const hrefRaw = card.match(/href=["']([^"']*-i\d+\.html[^"']*)/i)?.[1] || "";
    const href = absolute(hrefRaw, listUrl);
    const id = sourceId({ href });
    if (!href || !id || seen.has(id)) continue;
    seen.add(id);
    const title = text(card.match(/(?:alt|title)=["']([^"']+)/i)?.[1] || card.replace(/<[^>]*>/g, " "));
    const rawPrice = text(card.match(/(?:USD|EUR|DKK|\$|€|kr\.?)[\s\d.,-]+/i)?.[0]);
    const imageUrl = absolute(card.match(/(?:src|data-src|data-original)=["']([^"']+)/i)?.[1], listUrl);
    found.push({ sourceProductId: id, id: `danish-${id}`, href, sourceUrl: href, title, name: title, imageUrl, priceRaw: rawPrice, ...price(rawPrice), rawStatusText: text(card.replace(/<[^>]*>/g, " ")), inventoryStatus: status(card.replace(/<[^>]*>/g, " ")), listPageUrl: listUrl, listPageIndex: pageIndex });
  }
  const nextRaw = String(html).match(/<(?:a|link)[^>]+(?:rel=["']next["']|aria-label=["'][^"']*next[^"']*|title=["'][^"']*next[^"']*)[^>]*href=["']([^"']+)/i)?.[1]
    || String(html).match(/<a[^>]+href=["']([^"']+)["'][^>]*>\s*(?:Next|>|»|下一页)\s*<\/a>/i)?.[1] || "";
  const pageNumbers = [...String(html).matchAll(/(?:page=|\/page\/|data-page=["'])(\d+)/gi)].map((match) => Number(match[1])).filter(Number.isFinite);
  return { inspection, products: found, nextUrl: absolute(nextRaw, listUrl), expectedPages: pageNumbers.length ? Math.max(...pageNumbers, pageIndex) : null };
}

export async function writeAtomic(filePath, payload, limit = MAX_REPORT_BYTES) {
  const content = typeof payload === "string" ? payload : json(payload);
  if (Buffer.byteLength(content) > limit) throw new Error(`report-size-limit exceeded for ${filePath}`);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(temp, content, "utf8");
  await fs.promises.rename(temp, filePath);
  return sha256(content);
}
function runPaths(root, runId) {
  const suffix = path.join("danish-full-refresh", runId);
  return { raw: path.join(root, "data", "raw", suffix), audits: path.join(root, "data", "audits", suffix), review: path.join(root, "data", "review", suffix) };
}
function assertRunId(value) { if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,80}$/.test(value || "")) throw new Error("RunId must be 3-81 characters: letters, digits, dot, underscore, hyphen."); }
function read(filePath) { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
function gitSha(root) { try { return execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return "unavailable"; } }
function getBaseline(root) {
  const production = read(path.join(root, "data", "products", "danish-products.json"));
  const publicCatalog = products(read(path.join(root, "data", "generated", "public-products", "catalog.json"))).filter((item) => text(item.source).toLowerCase() === SOURCE || /^danish-/i.test(text(item.id)));
  return { production, publicCatalog };
}
function normalizeBaseline(item) {
  const sourceProductId = sourceId(item);
  const p = price(item.originalPrice || item.priceRaw || item.price);
  return { sourceProductId, id: `danish-${sourceProductId}`, brand: text(item.brand || item.brandName || item.canonicalBrand), title: text(item.name || item.title || item.displayNameEn), sourceUrl: text(item.sourceUrl || item.originalUrl), imageUrl: text(item.imageUrl || item.mainImage), galleryImages: unique(item.galleryImages || item.gallery || []), inventoryStatus: status(item.inventoryStatus || item.status), priceAmount: Number.isFinite(item.originalPriceValue) ? item.originalPriceValue : p.amount, currency: text(item.originalCurrency || item.sourcePriceCurrency || p.currency) };
}
function mapById(items) { return new Map(items.map(normalizeBaseline).filter((item) => item.sourceProductId).map((item) => [item.sourceProductId, item])); }
function sample(record, reason) { return { productId: record.id, sourceProductId: record.sourceProductId, brand: record.brand, productName: record.title, oldStatus: record.oldStatus ?? null, newStatus: record.inventoryStatus ?? record.newStatus ?? null, oldPrice: record.oldPrice ?? null, newPrice: record.priceAmount ?? null, url: record.sourceUrl || record.href || "", reason }; }

export function buildDiffPreview(currentProducts, productionInput, publicInput, integrity) {
  const current = currentProducts.map((item) => ({ ...item, sourceProductId: sourceId(item), id: `danish-${sourceId(item)}`, inventoryStatus: item.inventoryStatus || status(item.rawStatusText), priceAmount: item.priceAmount ?? price(item.priceRaw).amount, currency: item.currency || price(item.priceRaw).currency })).filter((item) => item.sourceProductId);
  const production = mapById(productionInput), publicIndex = mapById(publicInput), seen = new Map(), urls = new Map();
  const categories = Object.fromEntries(["new", "available-to-sold", "sold-to-available", "available-to-unavailable", "price-change", "name-change", "url-change", "image-change", "brand-change", "missing-from-current-list", "unique-id-conflict", "production-public-mismatch", "unknown", "blocked", "detail-failed", "duplicate-product", "falcon-excluded"].map((key) => [key, []]));
  for (const item of current) { (seen.get(item.sourceProductId) || seen.set(item.sourceProductId, []).get(item.sourceProductId)).push(item); (urls.get(item.sourceUrl) || urls.set(item.sourceUrl, []).get(item.sourceUrl)).push(item); }
  for (const [id, duplicates] of seen) if (duplicates.length > 1) categories["unique-id-conflict"].push({ ...duplicates[0], duplicates: duplicates.length });
  for (const [url, duplicates] of urls) if (url && duplicates.length > 1) categories["duplicate-product"].push({ ...duplicates[0], duplicates: duplicates.length });
  for (const item of current) {
    if (isFalcon(item)) { categories["falcon-excluded"].push(item); continue; }
    const old = production.get(item.sourceProductId);
    if (!old) categories.new.push(item);
    else {
      if (old.inventoryStatus === "available" && item.inventoryStatus === "sold") categories["available-to-sold"].push({ ...item, oldStatus: old.inventoryStatus });
      if (old.inventoryStatus === "sold" && item.inventoryStatus === "available") categories["sold-to-available"].push({ ...item, oldStatus: old.inventoryStatus });
      if (old.inventoryStatus === "available" && item.inventoryStatus === "unavailable") categories["available-to-unavailable"].push({ ...item, oldStatus: old.inventoryStatus });
      if (old.priceAmount !== null && item.priceAmount !== null && (old.priceAmount !== item.priceAmount || old.currency !== item.currency)) categories["price-change"].push({ ...item, oldPrice: old.priceAmount, oldCurrency: old.currency });
      if (old.title && item.title && old.title !== item.title) categories["name-change"].push({ ...item, oldTitle: old.title });
      if (old.sourceUrl && item.sourceUrl && old.sourceUrl !== item.sourceUrl) categories["url-change"].push(item);
      if (old.imageUrl && item.imageUrl && old.imageUrl !== item.imageUrl) categories["image-change"].push(item);
      if (old.brand && item.brand && old.brand !== item.brand) categories["brand-change"].push(item);
    }
    if (["unknown", "blocked"].includes(item.inventoryStatus)) categories[item.inventoryStatus].push(item);
    if (item.detail?.error) categories["detail-failed"].push(item);
  }
  if (integrity.complete) for (const [id, old] of production) if (!seen.has(id)) categories["missing-from-current-list"].push({ ...old, oldStatus: old.inventoryStatus, newStatus: "missing-from-current-list" });
  for (const [id, prod] of production) { const pub = publicIndex.get(id); if (!pub || prod.inventoryStatus !== pub.inventoryStatus) categories["production-public-mismatch"].push({ ...prod, publicStatus: pub?.inventoryStatus || "missing" }); }
  const counts = Object.fromEntries(Object.entries(categories).map(([key, values]) => [key, values.length]));
  const expectedChangeCount = ["new", "available-to-sold", "sold-to-available", "available-to-unavailable", "price-change", "name-change", "url-change", "image-change", "brand-change", "missing-from-current-list"].reduce((total, key) => total + counts[key], 0);
  const samples = Object.fromEntries(Object.entries(categories).map(([key, values]) => [key, values.slice(0, 20).map((value) => sample(value, key))]));
  return { source: SOURCE, generatedAt: iso(), allowApply: false, productionWritten: false, publicWritten: false, integrityGate: integrity, counts, expectedChangeCount, expectedChangeRatio: production.size ? Number((expectedChangeCount / production.size).toFixed(6)) : null, samples, reproducibilityHash: sha256(JSON.stringify(stable({ current, integrity }))) };
}
export function evaluateIntegrity({ pages, currentProducts, expectedPages, detailState }) {
  const blocked = pages.filter((page) => page.kind === "blocked").length;
  const first = pages.find((page) => page.pageIndex === 1);
  const abnormalEmpty = pages.filter((page) => page.kind === "empty-failure").length;
  const ids = currentProducts.map(sourceId).filter(Boolean), urls = currentProducts.map((item) => item.sourceUrl || item.href).filter(Boolean);
  const duplicateIds = ids.length - new Set(ids).size, duplicateUrls = urls.length - new Set(urls).size;
  const unknown = currentProducts.filter((item) => item.inventoryStatus === "unknown").length;
  const detailFailures = Object.values(detailState || {}).filter((detail) => detail?.error).length;
  const detailTotal = Object.keys(detailState || {}).length;
  const complete = Boolean(first?.kind === "success" && !blocked && !abnormalEmpty && currentProducts.length && (!expectedPages || pages.filter((page) => page.kind === "success").length >= expectedPages));
  return { complete, homepageSuccess: first?.kind === "success", expectedPages, successfulPages: pages.filter((page) => page.kind === "success").length, failedPages: pages.filter((page) => !["success", "normal-end-empty"].includes(page.kind)).length, abnormalEmptyPages: abnormalEmpty, blockedPages: blocked, endConditionTrusted: pages.at(-1)?.endReason === "no-next" || pages.at(-1)?.kind === "normal-end-empty", uniqueIdStable: duplicateIds === 0, duplicateIds, duplicateUrls, duplicateRate: currentProducts.length ? Number(((duplicateIds + duplicateUrls) / currentProducts.length).toFixed(6)) : 1, unknown, blocked, detailFailures, detailFailureRate: detailTotal ? Number((detailFailures / detailTotal).toFixed(6)) : 0, noFailureMappedToSold: !currentProducts.some((item) => item.collectError && item.inventoryStatus === "sold"), diffReproducible: true };
}
function makeManifest({ runId, root, paths, startedAt, list, details, diff }) {
  const files = [path.join(paths.raw, "list.json"), path.join(paths.raw, "details.json"), path.join(paths.raw, "checkpoint.json"), path.join(paths.audits, "page-audit.json"), path.join(paths.audits, "detail-audit.json"), path.join(paths.review, "diff-preview.json")].filter(fs.existsSync);
  const hashes = Object.fromEntries(files.map((file) => [path.relative(root, file).replaceAll("\\", "/"), sha256(fs.readFileSync(file))]));
  return { schemaVersion: 1, source: SOURCE, runId, mode: "preview-only", startedAt, completedAt: iso(), entryUrl: START_URL, expectedPages: list.expectedPages, successfulPages: diff.integrityGate.successfulPages, failedPages: diff.integrityGate.failedPages, emptyPages: list.pages.filter((page) => page.kind.includes("empty")).length, blockedPages: diff.integrityGate.blockedPages, uniqueProducts: list.products.length, available: list.products.filter((item) => item.inventoryStatus === "available").length, sold: list.products.filter((item) => item.inventoryStatus === "sold").length, unavailable: list.products.filter((item) => item.inventoryStatus === "unavailable").length, unknown: diff.integrityGate.unknown, blocked: diff.integrityGate.blocked, duplicateIds: diff.integrityGate.duplicateIds, duplicateUrls: diff.integrityGate.duplicateUrls, detailSuccess: Object.values(details).filter(isCompleteDetail).length, detailFailed: diff.integrityGate.detailFailures, detailReused: Object.values(details).filter((detail) => detail?.reused).length, pending: list.products.filter((item) => !isCompleteDetail(details[item.sourceProductId])).length, filesSha256: hashes, scriptCommitSha: gitSha(root), allowApply: false, productionWritten: false, publicWritten: false };
}

async function collectLiveList() {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: false }); const page = await browser.newPage();
  const pages = [], output = [], seen = new Set(); let currentUrl = START_URL, pageIndex = 1, expectedPages = null;
  try {
    while (currentUrl && pageIndex <= 500) {
      await page.goto(currentUrl, { waitUntil: "domcontentloaded", timeout: 60000 }); await page.waitForTimeout(1500);
      const html = await page.content(); const parsed = parseListHtml(html, currentUrl, pageIndex); expectedPages = Math.max(expectedPages || 0, parsed.expectedPages || 0) || null;
      let kind = parsed.inspection.kind === "ok" ? "success" : parsed.inspection.kind;
      if (kind === "ok") kind = "success";
      if (parsed.inspection.kind !== "ok") { pages.push({ pageIndex, url: currentUrl, kind, reason: parsed.inspection.code, itemCount: 0 }); break; }
      // Use DOM extraction when the old source's list item nesting defeats the fixture parser.
      const live = await page.locator("#list-container-inner .list-item").evaluateAll((cards) => cards.map((card) => {
        const a = [...card.querySelectorAll("a[href]")].find((node) => /\/d\/-zh\/.*-i\d+\.html/i.test(node.href)); const img = card.querySelector("img"); const raw = (card.innerText || card.textContent || "").replace(/\s+/g, " ").trim();
        return a ? { href: a.href, sourceUrl: a.href, title: (img?.alt || a.title || a.textContent || raw).replace(/\s+/g, " ").trim(), name: (img?.alt || a.title || a.textContent || raw).replace(/\s+/g, " ").trim(), imageUrl: img?.currentSrc || img?.src || "", rawStatusText: raw, priceRaw: (raw.match(/(?:USD|EUR|DKK|\$|€|kr\.?)[\s\d.,-]+/i) || [""])[0], rawText: raw } : null; }).filter(Boolean));
      const items = live.map((item) => ({ ...item, sourceProductId: sourceId(item), id: `danish-${sourceId(item)}`, ...price(item.priceRaw), inventoryStatus: status(item.rawStatusText), listPageUrl: currentUrl, listPageIndex: pageIndex })).filter((item) => item.sourceProductId);
      if (!items.length) { const hasNext = Boolean(parsed.nextUrl); const emptyKind = pageIndex === 1 || hasNext ? "empty-failure" : "normal-end-empty"; pages.push({ pageIndex, url: currentUrl, kind: emptyKind, reason: "no-list-items", itemCount: 0, endReason: hasNext ? "unexpected-empty" : "no-next" }); break; }
      for (const item of items) if (!seen.has(item.sourceProductId)) { seen.add(item.sourceProductId); output.push(item); }
      const next = parsed.nextUrl; pages.push({ pageIndex, url: currentUrl, kind: "success", itemCount: items.length, uniqueCount: output.length, endReason: next ? "next" : "no-next" });
      currentUrl = next; pageIndex += 1;
    }
  } finally { await browser.close(); }
  return { products: output, pages, expectedPages };
}
async function collectLiveDetails(items, existing, maxItems, onUpdate) {
  const { chromium } = await import("playwright"); const browser = await chromium.launch({ headless: false }); const page = await browser.newPage(); const updated = { ...existing }; let processed = 0;
  try { for (const item of items) { if (processed >= maxItems) break; if (isFalcon(item)) continue; if (isCompleteDetail(updated[item.sourceProductId])) { updated[item.sourceProductId] = { ...updated[item.sourceProductId], reused: true }; continue; }
    try { await page.goto(item.sourceUrl, { waitUntil: "domcontentloaded", timeout: 60000 }); await page.waitForTimeout(800); const html = await page.content(); const inspection = inspectHtml(html); if (inspection.kind !== "ok") throw new Error(`detail-${inspection.code}`); const title = text(await page.title()); const images = unique(await page.locator("img").evaluateAll((nodes) => nodes.map((node) => node.currentSrc || node.src).filter((url) => /danishpipeshop\.com\/img\//i.test(url)))); updated[item.sourceProductId] = { sourceProductId: item.sourceProductId, sourceUrl: item.sourceUrl, title, images, galleryImages: images, completedAt: iso(), reused: false }; } catch (error) { updated[item.sourceProductId] = { sourceProductId: item.sourceProductId, sourceUrl: item.sourceUrl, error: text(error?.message || error), attemptedAt: iso() }; } processed += 1; if (onUpdate) await onUpdate(updated);
  }} finally { await browser.close(); } return updated;
}
function markdownReport(manifest, diff) { return [`# Danish full refresh preview: ${manifest.runId}`, "", `完整性门：${diff.integrityGate.complete ? "通过" : "不通过"}`, `预计变更数：${diff.expectedChangeCount}`, `预计变更比例：${diff.expectedChangeRatio}`, "", "## 分类数量", "", ...Object.entries(diff.counts).map(([key, value]) => `- ${key}: ${value}`), ""].join("\n"); }
function csvReport(diff) { return ["product_id,brand,product_name,old_status,new_status,old_price,new_price,url,reason", ...Object.entries(diff.samples).flatMap(([, values]) => values).map((row) => [row.productId, row.brand, row.productName, row.oldStatus, row.newStatus, row.oldPrice, row.newPrice, row.url, row.reason].map(csv).join(","))].join("\n"); }

export async function runPreview(options) {
  const root = path.resolve(options.automationWorktree || process.cwd()), outputRoot = path.resolve(options.outputRoot || root), runId = options.runId; assertRunId(runId);
  const paths = runPaths(outputRoot, runId), startedAt = iso(); const checkpointPath = path.join(paths.raw, "checkpoint.json");
  if (!options.collectedList && fs.existsSync(path.join(paths.raw, "list.json")) && !options.resume) throw new Error(`RunId already exists; use -Resume or select a new RunId: ${runId}`);
  let list = options.collectedList || (fs.existsSync(path.join(paths.raw, "list.json")) && options.resume ? read(path.join(paths.raw, "list.json")) : await collectLiveList());
  list.products = list.products.map((item) => ({ ...item, inventoryStatus: item.inventoryStatus || status(item.rawStatusText) }));
  await writeAtomic(path.join(paths.raw, "list.json"), list, 25 * 1024 * 1024); await writeAtomic(path.join(paths.audits, "page-audit.json"), { source: SOURCE, runId, pages: list.pages, expectedPages: list.expectedPages });
  let details = options.detailState || (fs.existsSync(path.join(paths.raw, "details.json")) ? read(path.join(paths.raw, "details.json")) : {});
  if (!options.listOnly && !options.detailState) details = await collectLiveDetails(list.products, details, options.maxDetailItems ?? 30, async (partial) => {
    await writeAtomic(path.join(paths.raw, "details.json"), partial, 25 * 1024 * 1024);
    await writeAtomic(checkpointPath, { runId, updatedAt: iso(), detailState: partial, pending: list.products.filter((item) => !isCompleteDetail(partial[item.sourceProductId]) && !isFalcon(item)).map((item) => item.sourceProductId) }, 25 * 1024 * 1024);
  });
  await writeAtomic(path.join(paths.raw, "details.json"), details, 25 * 1024 * 1024); await writeAtomic(checkpointPath, { runId, updatedAt: iso(), detailState: details, pending: list.products.filter((item) => !isCompleteDetail(details[item.sourceProductId]) && !isFalcon(item)).map((item) => item.sourceProductId) }, 25 * 1024 * 1024);
  const integrity = evaluateIntegrity({ pages: list.pages, currentProducts: list.products, expectedPages: list.expectedPages, detailState: details }); const baseline = options.baseline || getBaseline(root); const diff = buildDiffPreview(list.products.map((item) => ({ ...item, detail: details[item.sourceProductId] })), baseline.production, baseline.publicCatalog, integrity);
  await writeAtomic(path.join(paths.audits, "detail-audit.json"), { source: SOURCE, runId, attempted: Object.keys(details).length, successful: Object.values(details).filter(isCompleteDetail).length, failed: Object.values(details).filter((detail) => detail?.error).length }); await writeAtomic(path.join(paths.review, "diff-preview.json"), diff); const manifest = makeManifest({ runId, root, paths, startedAt, list, details, diff }); await writeAtomic(path.join(paths.raw, "manifest.json"), manifest); await writeAtomic(path.join(paths.review, "diff-preview.md"), markdownReport(manifest, diff)); await writeAtomic(path.join(paths.review, "diff-candidates.csv"), csvReport(diff));
  return { paths, manifest, diff };
}
export function readRunReport(root, runId) { const paths = runPaths(path.resolve(root), runId); return { manifest: read(path.join(paths.raw, "manifest.json")), diff: read(path.join(paths.review, "diff-preview.json")), paths }; }
function fixtureList(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  if (path.extname(filePath).toLowerCase() === ".html") {
    const parsed = parseListHtml(content, `file://${filePath.replaceAll("\\", "/")}`, 1);
    return { products: parsed.products, pages: [{ pageIndex: 1, url: filePath, kind: parsed.products.length ? "success" : "empty-failure", itemCount: parsed.products.length, endReason: "no-next", fixture: true }], expectedPages: parsed.expectedPages || 1 };
  }
  const parsed = JSON.parse(content);
  return { products: products(parsed), pages: parsed.pages || [{ pageIndex: 1, url: filePath, kind: "success", itemCount: products(parsed).length, endReason: "no-next", fixture: true }], expectedPages: parsed.expectedPages || 1 };
}
function args(argv) { const values = {}; for (let index = 0; index < argv.length; index += 1) { const key = argv[index]; if (!key.startsWith("--")) continue; values[key.slice(2)] = argv[index + 1]?.startsWith("--") || argv[index + 1] === undefined ? true : argv[++index]; } return values; }
function isDirectExecution() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]).toLowerCase() === path.resolve(fileURLToPath(import.meta.url)).toLowerCase();
}
if (isDirectExecution()) {
  try { const cli = args(process.argv.slice(2)); const fixturePath = cli["fixture-list"] ? path.resolve(cli["fixture-list"]) : ""; if (cli.report) { console.log(json(readRunReport(cli["automation-worktree"], cli["run-id"]))); } else { console.log(`[NODE] Danish full refresh mode=${fixturePath ? "fixture" : "live"} listOnly=${Boolean(cli["list-only"])} resume=${Boolean(cli.resume)}`); const result = await runPreview({ automationWorktree: cli["automation-worktree"], runId: cli["run-id"], listOnly: Boolean(cli["list-only"]), resume: Boolean(cli.resume), maxDetailItems: Number(cli["max-detail-items"] || 30), collectedList: fixturePath ? fixtureList(fixturePath) : undefined, detailState: fixturePath ? {} : undefined }); console.log(json({ runId: result.manifest.runId, integrityGate: result.diff.integrityGate.complete, pending: result.manifest.pending, allowApply: false, productionWritten: false, publicWritten: false })); } } catch (error) { console.error(error?.stack || error); process.exitCode = 1; }
}
