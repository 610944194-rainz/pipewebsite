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
  [/please\s+confirm\s+that\s+you\s+are\s+not\s+a\s+robot|i\s+am\s+not\s+a\s+robot/i, "robot-confirmation"],
  [/just a moment/i, "just-a-moment"], [/checking your browser|managed challenge|cf-chl/i, "browser-challenge"],
  [/error\s*404|page not found|not found/i, "soft-404"],
];
class PreviewFailure extends Error { constructor(message, exitCode, failureStage) { super(message); this.exitCode = exitCode; this.failureStage = failureStage; } }

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
  return { inspection, products: found, nextUrl: nextRaw ? absolute(nextRaw, listUrl) : "", expectedPages: pageNumbers.length ? Math.max(...pageNumbers, pageIndex) : null };
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
export function evaluateIntegrity({ pages, currentProducts, expectedPages, detailState, listing = null, ageLanguageGate = null }) {
  const blocked = pages.filter((page) => page.kind === "blocked").length;
  const first = pages.find((page) => page.pageIndex === 1);
  const abnormalEmpty = pages.filter((page) => page.kind === "empty-failure").length;
  const ids = currentProducts.map(sourceId).filter(Boolean), urls = currentProducts.map((item) => item.sourceUrl || item.href).filter(Boolean);
  const duplicateIds = ids.length - new Set(ids).size, duplicateUrls = urls.length - new Set(urls).size;
  const unknown = currentProducts.filter((item) => item.inventoryStatus === "unknown").length;
  const detailFailures = Object.values(detailState || {}).filter((detail) => detail?.error).length;
  const detailTotal = Object.keys(detailState || {}).length;
  const successfulPages = pages.filter((page) => page.kind === "success").length;
  const endConditionTrusted = ["no-next", "normal-end-empty", "shown-total-reached", "two-stable-checks-no-show-more"].includes(pages.at(-1)?.endReason) || pages.at(-1)?.kind === "normal-end-empty";
  const total = listing?.detectedTotalCount;
  const totalKnown = Number.isFinite(total);
  const totalMatched = totalKnown ? currentProducts.length >= total : listing?.listTotalMatched !== false;
  const showMoreComplete = listing?.listCompletionReason
    ? listing.requireAbove48 === false || ["shown-total-reached", "two-stable-checks-no-show-more"].includes(listing.listCompletionReason)
    : true;
  const pageReady = listing?.pageReady !== false;
  const gateDismissed = !ageLanguageGate?.detected || Boolean(ageLanguageGate.completed);
  const minimumSatisfied = !listing?.requireAbove48 || (totalKnown ? currentProducts.length > 48 || total <= 48 : currentProducts.length > 48);
  const complete = Boolean(first?.kind === "success" && successfulPages >= 1 && !blocked && !abnormalEmpty && currentProducts.length > 0 && endConditionTrusted && duplicateIds === 0 && duplicateUrls === 0 && (!expectedPages || successfulPages >= expectedPages) && totalMatched && showMoreComplete && pageReady && gateDismissed && minimumSatisfied);
  return { complete, homepageSuccess: first?.kind === "success", expectedPages, successfulPages, failedPages: pages.filter((page) => !["success", "normal-end-empty"].includes(page.kind)).length, abnormalEmptyPages: abnormalEmpty, blockedPages: blocked, endConditionTrusted, uniqueIdStable: duplicateIds === 0, duplicateIds, duplicateUrls, duplicateRate: currentProducts.length ? Number(((duplicateIds + duplicateUrls) / currentProducts.length).toFixed(6)) : 1, unknown, blocked, detailFailures, detailFailureRate: detailTotal ? Number((detailFailures / detailTotal).toFixed(6)) : 0, noFailureMappedToSold: !currentProducts.some((item) => item.collectError && item.inventoryStatus === "sold"), diffReproducible: true, detectedTotalCount: totalKnown ? total : null, listTotalMatched: totalMatched, showMoreComplete, pageReady, ageLanguageGateDismissed: gateDismissed, minimumProductThresholdSatisfied: minimumSatisfied };
}
function makeManifest({ runId, root, paths, startedAt, list, details, diff }) {
  const files = [path.join(paths.raw, "list.json"), path.join(paths.raw, "details.json"), path.join(paths.raw, "checkpoint.json"), path.join(paths.audits, "page-audit.json"), path.join(paths.audits, "detail-audit.json"), path.join(paths.review, "diff-preview.json")].filter(fs.existsSync);
  const hashes = Object.fromEntries(files.map((file) => [path.relative(root, file).replaceAll("\\", "/"), sha256(fs.readFileSync(file))]));
  return { schemaVersion: 1, source: SOURCE, runId, mode: "preview-only", startedAt, completedAt: iso(), entryUrl: list.entryUrl || START_URL, expectedPages: list.expectedPages, successfulPages: diff.integrityGate.successfulPages, failedPages: diff.integrityGate.failedPages, emptyPages: list.pages.filter((page) => page.kind.includes("empty")).length, blockedPages: diff.integrityGate.blockedPages, uniqueProducts: list.products.length, available: list.products.filter((item) => item.inventoryStatus === "available").length, sold: list.products.filter((item) => item.inventoryStatus === "sold").length, unavailable: list.products.filter((item) => item.inventoryStatus === "unavailable").length, unknown: diff.integrityGate.unknown, blocked: diff.integrityGate.blocked, duplicateIds: diff.integrityGate.duplicateIds, duplicateUrls: diff.integrityGate.duplicateUrls, detailSuccess: Object.values(details).filter(isCompleteDetail).length, detailFailed: diff.integrityGate.detailFailures, detailReused: Object.values(details).filter((detail) => detail?.reused).length, pending: list.products.filter((item) => !isCompleteDetail(details[item.sourceProductId])).length, integrityGate: diff.integrityGate, failureStage: list.failureStage || null, browserMode: list.browser?.mode || "fixture", browserChannel: list.browser?.channel || null, manualVerificationRequested: Boolean(list.manualVerification?.requested), manualVerificationCompleted: Boolean(list.manualVerification?.completed), manualVerificationTimeoutSeconds: list.manualVerification?.timeoutSeconds ?? null, manualVerificationWaitedSeconds: list.manualVerification?.waitedSeconds ?? 0, blockerType: list.manualVerification?.blockerType || null, blockerDetectedAt: list.manualVerification?.detectedAt || null, verificationCompletedAt: list.manualVerification?.completedAt || null, screenshotPath: list.manualVerification?.screenshotPath || null, blockedHtmlPath: list.manualVerification?.blockedHtmlPath || null, languageSelectionDetected: Boolean(list.languageSelection?.detected), languageSelectionAutomatic: Boolean(list.languageSelection?.automatic), languageSelectionPreferredLanguage: list.languageSelection?.preferredLanguage || null, languageSelectionSelectedLanguage: list.languageSelection?.selectedLanguage || null, languageSelectionAttemptCount: list.languageSelection?.attemptCount ?? 0, languageSelectionCompleted: Boolean(list.languageSelection?.completed), languageSelectionFallbackToManual: Boolean(list.languageSelection?.fallbackToManual), languageSelectionFailureReason: list.languageSelection?.failureReason || null, ageLanguageGateDetected: Boolean(list.languageSelection?.detected), ageLanguageGateClickAttempted: Boolean(list.languageSelection?.clickAttempted), ageLanguageGateSelectedText: list.languageSelection?.selectedLanguage || null, ageLanguageGateElementTag: list.languageSelection?.elementTag || null, ageLanguageGateCompleted: Boolean(list.languageSelection?.completed), ageLanguageGateDismissedAt: list.languageSelection?.dismissedAt || null, ageLanguageGateFailureReason: list.languageSelection?.failureReason || null, initialShownCount: list.listing?.initialShownCount ?? null, detectedTotalCount: list.listing?.detectedTotalCount ?? null, showMoreClickCount: list.listing?.showMoreClickCount ?? 0, showMoreProgress: list.listing?.showMoreProgress ?? [], finalShownCount: list.listing?.finalShownCount ?? null, finalUniqueCount: list.listing?.finalUniqueCount ?? list.products.length, listTotalMatched: list.listing?.listTotalMatched ?? null, listCompletionReason: list.listing?.listCompletionReason ?? null, pageReady: Boolean(list.listing?.pageReady), filesSha256: hashes, scriptCommitSha: gitSha(root), allowApply: false, productionWritten: false, publicWritten: false };
}

async function launchDanishContext(options) {
  const { chromium } = await import("playwright");
  await fs.promises.mkdir(options.profileDir, { recursive: true });
  return chromium.launchPersistentContext(options.profileDir, {
    channel: options.browserChannel ?? (options.headed ? "chrome" : undefined),
    headless: !options.headed,
    viewport: { width: 1440, height: 1000 },
  });
}
const GATE_TITLE = "Welcome to The Danish Pipe Shop";
const GATE_ENGLISH = "CLICK HERE TO CHOOSE ENGLISH";
const GATE_CHINESE = "\u8bf7\u70b9\u51fb\u8fd9\u91cc\u9009\u62e9\u4e2d\u6587";
const OVERLAY_SELECTOR = ".modal-overlay,.modal-backdrop,[data-overlay],[data-backdrop],[class*='overlay' i],[class*='backdrop' i]";

async function visible(locator) { return Boolean(await locator.count().catch(() => 0) && await locator.first().isVisible().catch(() => false)); }
async function hasVisibleOverlay(page) {
  return page.locator(OVERLAY_SELECTOR).evaluateAll((nodes) => nodes.some((node) => {
    const style = getComputedStyle(node); const box = node.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0 && box.width > 0 && box.height > 0;
  })).catch(() => false);
}
async function findAgeLanguageGate(page) {
  const title = page.getByText(GATE_TITLE, { exact: true }).first();
  const english = page.getByText(GATE_ENGLISH, { exact: true }).first();
  const chinese = page.getByText(GATE_CHINESE, { exact: true }).first();
  const titleVisible = await visible(title), englishVisible = await visible(english), chineseVisible = await visible(chinese);
  const detected = titleVisible || englishVisible || chineseVisible;
  if (!detected) return { detected: false, modal: null, titleVisible, englishVisible, chineseVisible };
  const anchor = titleVisible ? title : englishVisible ? english : chinese;
  const modal = anchor.locator("xpath=ancestor::*[@role='dialog' or contains(translate(@class, 'MODAL', 'modal'), 'modal') or contains(translate(@class, 'WELCOME', 'welcome'), 'welcome') or contains(translate(@id, 'MODAL', 'modal'), 'modal')][1]");
  return { detected: true, modal: (await modal.count().catch(() => 0)) ? modal : anchor.locator("xpath=parent::*"), titleVisible, englishVisible, chineseVisible };
}
async function readPageState(page) {
  const [html, title, gate, overlayVisible] = await Promise.all([page.content(), page.title(), findAgeLanguageGate(page), hasVisibleOverlay(page)]);
  const inspection = inspectHtml(html);
  // Never inspect cards behind an age/language overlay: the DOM is intentionally present there.
  if (gate.detected || overlayVisible) return { html, title: text(title), url: page.url(), cardCount: 0, pipesNavigation: false, listVisible: false, gate, overlayVisible, inspection };
  const [cardCount, listPresent, listVisible, pipesNavigation] = await Promise.all([
    page.locator("#list-container-inner .list-item").count().catch(() => 0),
    page.locator("#list-container-inner").count().catch(() => 0),
    page.locator("#list-container-inner").isVisible().catch(() => false),
    page.getByText("PIPES", { exact: true }).count().catch(() => 0),
  ]);
  return { html, title: text(title), url: page.url(), cardCount, pipesNavigation: pipesNavigation > 0, listPresent: listPresent > 0, listVisible, gate, overlayVisible, inspection };
}
async function isReadyForProducts(page) {
  const state = await readPageState(page);
  return { ready: !state.gate.detected && !state.overlayVisible && state.inspection.kind !== "blocked" && state.listPresent, state };
}
async function clickEvidence(locator) {
  const evidence = await locator.evaluate((node) => ({ tagName: node.tagName, role: node.getAttribute("role"), text: (node.textContent || "").replace(/\s+/g, " ").trim(), href: node.getAttribute("href"), onclick: node.getAttribute("onclick"), visible: Boolean(node.offsetWidth || node.offsetHeight || node.getClientRects().length), enabled: !node.hasAttribute("disabled") && node.getAttribute("aria-disabled") !== "true" })).catch(() => null);
  return evidence ? { ...evidence, boundingBox: await locator.boundingBox().catch(() => null) } : null;
}
async function gateClickTargets(modal, value) {
  const roleTargets = [modal.getByRole("button", { name: new RegExp(`^${value}$`, "i") }).first(), modal.getByRole("link", { name: new RegExp(`^${value}$`, "i") }).first()];
  const exactText = modal.getByText(value, { exact: true }).first();
  const clickableAncestor = exactText.locator("xpath=ancestor-or-self::*[self::button or self::a or @role='button' or @onclick or self::input or self::label][1]");
  return [...roleTargets, exactText, clickableAncestor];
}
async function languageCandidates(modal) {
  const selectChoices = await modal.locator("select").evaluateAll((selects) => selects.flatMap((select, selectIndex) => Array.from(select.options).map((option) => ({ selectIndex, value: option.value, text: (option.textContent || "").replace(/\s+/g, " ").trim(), disabled: option.disabled }))));
  const textChoices = await modal.locator("button,a,[role='button'],[data-language],[lang],label,li").evaluateAll((nodes) => nodes.map((node) => ({ text: (node.textContent || "").replace(/\s+/g, " ").trim(), disabled: node.hasAttribute("disabled") || node.getAttribute("aria-disabled") === "true", visible: Boolean(node.offsetWidth || node.offsetHeight || node.getClientRects().length), close: /^(close|cancel|back)$/i.test((node.textContent || "").replace(/\s+/g, " ").trim()) || /privacy|terms|help/i.test((node.textContent || "").replace(/\s+/g, " ").trim()) })).filter((choice) => choice.text));
  const validText = textChoices.filter((choice) => choice.visible && !choice.disabled && !choice.close);
  const preferred = /^(english|english us|english uk|en)$/i;
  const exactEnglish = "CLICK HERE TO CHOOSE ENGLISH";
  const exactChinese = "请点击这里选择中文";
  const ordered = [
    { kind: "text", text: exactEnglish, preferred: true },
    ...selectChoices.filter((choice) => !choice.disabled && (preferred.test(choice.text) || /english/i.test(choice.text))).map((choice) => ({ kind: "select", ...choice, preferred: true })),
    ...validText.filter((choice) => preferred.test(choice.text) || /^english/i.test(choice.text)).map((choice) => ({ kind: "text", text: choice.text, preferred: true })),
    { kind: "text", text: exactChinese, preferred: false, chinese: true },
    ...selectChoices.filter((choice) => !choice.disabled && !preferred.test(choice.text)).map((choice) => ({ kind: "select", ...choice, preferred: false })),
    ...validText.filter((choice) => !preferred.test(choice.text) && choice.text !== exactEnglish && choice.text !== exactChinese).map((choice) => ({ kind: "text", text: choice.text, preferred: false })),
  ];
  return ordered.filter((choice, index, values) => choice.text && values.findIndex((other) => `${other.kind}:${other.selectIndex ?? ""}:${other.value ?? other.text}` === `${choice.kind}:${choice.selectIndex ?? ""}:${choice.value ?? choice.text}`) === index);
}
async function waitForGateDismissalAndProducts(page, seconds) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() <= deadline) {
    const ready = await isReadyForProducts(page);
    if (ready.ready) return { passed: true, state: ready.state };
    await page.waitForTimeout(250);
  }
  return { passed: false, state: await readPageState(page) };
}
async function waitForManualLanguageFallback(page, options, pageIndex, state, language) {
  const started = Date.now(); console.log("[WAIT] automatic language selection failed"); console.log("please select any language manually");
  while (Date.now() - started <= options.manualVerificationSeconds * 1000) {
    const gate = await findAgeLanguageGate(page); const ready = await isReadyForProducts(page);
    if (!gate.detected && ready.ready) return { passed: true, state: ready.state, language: { ...language, completed: true, fallbackToManual: true, failureReason: language.failureReason || "automatic-selection-failed", dismissedAt: iso() } };
    await page.waitForTimeout(1000);
  }
  const finalState = await readPageState(page); const diagnostics = await saveBlockDiagnostics(page, options, pageIndex, finalState);
  return { passed: false, state: finalState, language: { ...language, completed: false, fallbackToManual: true, failureReason: language.failureReason || "age-language-gate-not-dismissed", ...diagnostics } };
}
async function handleLanguageModal(page, options, pageIndex) {
  const gate = await findAgeLanguageGate(page); if (!gate.detected) return null;
  const modal = gate.modal;
  console.log("[INFO] Danish age/language gate detected"); console.log("[INFO] Danish language modal detected");
  const language = { detected: true, automatic: false, preferredLanguage: "English", selectedLanguage: null, attemptCount: 0, completed: false, fallbackToManual: false, failureReason: null, clickAttempted: false, elementTag: null, dismissedAt: null, clickEvidence: [] };
  const exactCandidates = [{ kind: "exact", text: GATE_ENGLISH, preferred: true }, { kind: "exact", text: GATE_CHINESE, preferred: false }];
  const candidates = [...exactCandidates, ...(await languageCandidates(modal)).filter((candidate) => candidate.text !== GATE_ENGLISH && candidate.text !== GATE_CHINESE)];
  for (const candidate of candidates) {
    if (language.attemptCount >= 3) break;
    try {
      let clicked = false;
      if (candidate.kind === "select") { await modal.locator("select").nth(candidate.selectIndex).selectOption(candidate.value); clicked = true; }
      else {
        for (const target of await gateClickTargets(modal, candidate.text)) {
          if (!(await visible(target))) continue;
          const evidence = await clickEvidence(target); language.clickEvidence.push(evidence); language.clickAttempted = true;
          try { await target.click({ timeout: 3000, force: false }); clicked = true; language.elementTag = evidence?.tagName || null; } catch (error) { language.failureReason = text(error?.message || error); continue; }
          const result = await waitForGateDismissalAndProducts(page, Math.min(2, options.manualVerificationSeconds, (options.languageRetryDelayMs ?? 2000) / 1000));
          if (result.passed) {
            language.attemptCount += 1; language.selectedLanguage = candidate.text; language.automatic = true; language.completed = true; language.dismissedAt = iso();
            if (candidate.preferred) { console.log("[INFO] automatically selecting English"); console.log("[INFO] selected language: English"); } else console.log(`[INFO] selected fallback language: ${candidate.text}`);
            console.log("[PASS] Danish age/language gate completed"); console.log("[PASS] Danish language selection completed");
            return { passed: true, state: result.state, language };
          }
        }
      }
      if (!clicked) continue;
      language.attemptCount += 1;
      language.selectedLanguage = candidate.text;
      if (candidate.preferred) { console.log("[INFO] automatically selecting English"); console.log("[INFO] selected language: English"); } else console.log(`[INFO] selected fallback language: ${candidate.text}`);
      await page.waitForTimeout(options.languageRetryDelayMs ?? 2000);
      const result = await waitForGateDismissalAndProducts(page, options.manualVerificationSeconds);
      if (result.passed) { language.automatic = true; language.completed = true; language.dismissedAt = iso(); console.log("[PASS] Danish age/language gate completed"); console.log("[PASS] Danish language selection completed"); return { passed: true, state: result.state, language }; }
    } catch (error) { language.failureReason = text(error?.message || error); }
  }
  language.failureReason = language.failureReason || "age-language-gate-not-dismissed";
  return waitForManualLanguageFallback(page, options, pageIndex, await readPageState(page), language);
}
async function saveBlockDiagnostics(page, options, pageIndex, state) {
  await fs.promises.mkdir(options.auditDir, { recursive: true });
  const stem = `blocked-page-${String(pageIndex).padStart(3, "0")}-${Date.now()}`;
  const htmlPath = path.join(options.auditDir, `${stem}.html`);
  const screenshotPath = path.join(options.auditDir, `${stem}.png`);
  await fs.promises.writeFile(htmlPath, state.html, "utf8");
  await page.screenshot({ path: screenshotPath, fullPage: true, timeout: 5000 }).catch(() => {});
  return { screenshotPath: path.relative(options.root, screenshotPath).replaceAll("\\", "/"), blockedHtmlPath: path.relative(options.root, htmlPath).replaceAll("\\", "/") };
}
async function waitForManualVerification(page, options, pageIndex, initialState) {
  const startedAt = iso(); const started = Date.now(); const timeoutMs = options.manualVerificationSeconds * 1000;
  const initialDelayMs = Math.max(0, Number(options.manualVerificationInitialDelaySeconds ?? 3) * 1000);
  if (initialDelayMs) await page.waitForTimeout(Math.min(initialDelayMs, timeoutMs));
  console.log("[WAIT] Danish manual verification required");
  console.log("browser remains open");
  console.log(`timeout: ${options.manualVerificationSeconds} seconds`);
  console.log("please complete verification in the browser");
  let state = initialState;
  while (Date.now() - started <= timeoutMs) {
    state = await readPageState(page);
    if (state.inspection.kind !== "blocked") {
      const waitedSeconds = Number(((Date.now() - started) / 1000).toFixed(1));
      console.log("[PASS] Danish manual verification completed");
      return { passed: true, state, event: { pageIndex, url: state.url, blockerType: initialState.inspection.code, detectedAt: startedAt, completedAt: iso(), waitedSeconds } };
    }
    await page.waitForTimeout(1000);
  }
  const diagnostics = await saveBlockDiagnostics(page, options, pageIndex, state);
  return { passed: false, state, event: { pageIndex, url: state.url, blockerType: initialState.inspection.code, detectedAt: startedAt, waitedSeconds: Number(((Date.now() - started) / 1000).toFixed(1)), ...diagnostics } };
}
async function liveItems(page, currentUrl, pageIndex) {
  const live = await page.locator("#list-container-inner .list-item").evaluateAll((cards) => cards.map((card) => {
    const a = [...card.querySelectorAll("a[href]")].find((node) => /\/d\/-zh\/.*-i\d+\.html/i.test(node.href)); const img = card.querySelector("img"); const raw = (card.innerText || card.textContent || "").replace(/\s+/g, " ").trim();
    return a ? { href: a.href, sourceUrl: a.href, title: (img?.alt || a.title || a.textContent || raw).replace(/\s+/g, " ").trim(), name: (img?.alt || a.title || a.textContent || raw).replace(/\s+/g, " ").trim(), imageUrl: img?.currentSrc || img?.src || "", rawStatusText: raw, priceRaw: (raw.match(/(?:USD|EUR|DKK|\$|€|kr\.?)[\s\d.,-]+/i) || [""])[0], rawText: raw } : null;
  }).filter(Boolean));
  return live.map((item) => ({ ...item, sourceProductId: sourceId(item), id: `danish-${sourceId(item)}`, ...price(item.priceRaw), inventoryStatus: status(item.rawStatusText), listPageUrl: currentUrl, listPageIndex: pageIndex })).filter((item) => item.sourceProductId);
}
async function listingMetrics(page, currentUrl, pageIndex) {
  const items = await liveItems(page, currentUrl, pageIndex);
  const listText = await page.locator("#list-container-inner").innerText().catch(() => "");
  const match = text(listText).match(/showing\s+([\d,]+)\s+of\s+([\d,]+)/i);
  return { items, domCount: items.length, shownCount: match ? Number(match[1].replaceAll(",", "")) : null, totalCount: match ? Number(match[2].replaceAll(",", "")) : null };
}
async function findShowMore(page) {
  const root = page.locator("#list-container-inner").first();
  const candidates = [
    root.getByRole("button", { name: /^show more$/i }).first(),
    root.getByRole("link", { name: /^show more$/i }).first(),
    root.getByText("Show more", { exact: true }).first(),
  ];
  for (const candidate of candidates) if (await visible(candidate)) return candidate;
  return null;
}
function uniquePageItems(items) { return new Map(items.map((item) => [item.sourceProductId, item])); }
async function loadAllShowMore(page, options, pageIndex, initialState) {
  let state = initialState, metrics = await listingMetrics(page, state.url, pageIndex), languageSelection = null;
  const progress = [], initialShownCount = metrics.shownCount ?? metrics.domCount, detectedTotalCount = metrics.totalCount;
  let showMoreClickCount = 0, stableChecks = 0;
  while (true) {
    const uniqueCount = uniquePageItems(metrics.items).size;
    const showMore = await findShowMore(page);
    const knownTotal = Number.isFinite(metrics.totalCount) ? metrics.totalCount : detectedTotalCount;
    if (knownTotal !== null && knownTotal !== undefined && uniqueCount >= knownTotal) {
      return { passed: true, state, items: metrics.items, initialShownCount, detectedTotalCount: knownTotal, showMoreClickCount, showMoreProgress: progress, finalShownCount: metrics.shownCount ?? metrics.domCount, finalUniqueCount: uniqueCount, listTotalMatched: true, listCompletionReason: "shown-total-reached", languageSelection };
    }
    if (!showMore) {
      if (knownTotal !== null && knownTotal !== undefined && uniqueCount < knownTotal) return { passed: false, failureStage: "show-more-missing-before-total", failureMessage: `show more missing before total (${uniqueCount}/${knownTotal})`, state, items: metrics.items, initialShownCount, detectedTotalCount: knownTotal, showMoreClickCount, showMoreProgress: progress, finalShownCount: metrics.shownCount ?? metrics.domCount, finalUniqueCount: uniqueCount, listTotalMatched: false, listCompletionReason: "show-more-missing-before-total", languageSelection };
      // No declared total: require two stable observations, not merely a missing button once.
      const before = uniqueCount; await page.waitForTimeout(500); state = await readPageState(page);
      if (!state.gate.detected && !state.overlayVisible && state.inspection.kind !== "blocked" && state.listVisible) {
        const again = await listingMetrics(page, state.url, pageIndex);
        if (uniquePageItems(again.items).size === before && !(await findShowMore(page))) stableChecks += 1;
        metrics = again;
      }
      if (stableChecks >= 1) return { passed: true, state, items: metrics.items, initialShownCount, detectedTotalCount: null, showMoreClickCount, showMoreProgress: progress, finalShownCount: metrics.shownCount ?? metrics.domCount, finalUniqueCount: uniquePageItems(metrics.items).size, listTotalMatched: true, listCompletionReason: "two-stable-checks-no-show-more", languageSelection };
      continue;
    }
    const countBefore = uniqueCount, started = Date.now(); showMoreClickCount += 1;
    await showMore.click({ timeout: 5000, force: false });
    let progressed = false;
    const deadline = Date.now() + (options.showMoreProgressTimeoutMs ?? 20000);
    while (Date.now() <= deadline) {
      state = await readPageState(page);
      if (state.inspection.kind === "blocked") {
        const verification = await waitForManualVerification(page, options, pageIndex, state);
        if (!verification.passed) return { passed: false, failureStage: "manual-verification-timeout", failureMessage: "manual verification timed out during show more", state: verification.state, items: metrics.items, initialShownCount, detectedTotalCount: knownTotal ?? null, showMoreClickCount, showMoreProgress: progress, finalShownCount: metrics.shownCount ?? metrics.domCount, finalUniqueCount: countBefore, listTotalMatched: false, listCompletionReason: "blocker-during-show-more", languageSelection };
        state = verification.state;
      }
      if (state.gate.detected) {
        const language = await handleLanguageModal(page, options, pageIndex); languageSelection = language?.language || languageSelection;
        if (!language?.passed) return { passed: false, failureStage: "age-language-gate-reappeared", failureMessage: language?.language?.failureReason || "age/language gate reappeared", state: language?.state || state, items: metrics.items, initialShownCount, detectedTotalCount: knownTotal ?? null, showMoreClickCount, showMoreProgress: progress, finalShownCount: metrics.shownCount ?? metrics.domCount, finalUniqueCount: countBefore, listTotalMatched: false, listCompletionReason: "age-language-gate-reappeared", languageSelection };
        state = language.state;
      }
      if (state.listVisible && !state.overlayVisible) {
        const next = await listingMetrics(page, state.url, pageIndex);
        if (uniquePageItems(next.items).size > countBefore) { metrics = next; progressed = true; break; }
        if (knownTotal !== null && knownTotal !== undefined && !(await findShowMore(page))) return { passed: false, failureStage: "show-more-missing-before-total", failureMessage: `show more disappeared before total (${countBefore}/${knownTotal})`, state, items: next.items, initialShownCount, detectedTotalCount: knownTotal, showMoreClickCount, showMoreProgress: progress, finalShownCount: next.shownCount ?? next.domCount, finalUniqueCount: countBefore, listTotalMatched: false, listCompletionReason: "show-more-missing-before-total", languageSelection };
      }
      await page.waitForTimeout(250);
    }
    progress.push({ batchIndex: showMoreClickCount, countBefore, countAfter: uniquePageItems(metrics.items).size, detectedShownCount: metrics.shownCount, detectedTotalCount: metrics.totalCount ?? knownTotal ?? null, showMoreVisible: true, showMoreClicked: true, duration: Number(((Date.now() - started) / 1000).toFixed(3)), url: state.url });
    if (!progressed) return { passed: false, failureStage: "show-more-no-progress", failureMessage: "show more did not increase unique product count", state, items: metrics.items, initialShownCount, detectedTotalCount: knownTotal ?? null, showMoreClickCount, showMoreProgress: progress, finalShownCount: metrics.shownCount ?? metrics.domCount, finalUniqueCount: countBefore, listTotalMatched: false, listCompletionReason: "show-more-no-progress", languageSelection };
  }
}
export async function collectLiveList(options) {
  const browser = { mode: options.headed ? "headed" : "headless", channel: options.browserChannel ?? (options.headed ? "chrome" : "playwright-default"), profilePath: path.relative(options.root, options.profileDir).replaceAll("\\", "/") };
  const pages = [], output = [], seen = new Set(), verificationEvents = []; let languageSelection = { detected: false, automatic: false, preferredLanguage: "English", selectedLanguage: null, attemptCount: 0, completed: false, fallbackToManual: false, failureReason: null };
  let listing = { initialShownCount: null, detectedTotalCount: null, showMoreClickCount: 0, showMoreProgress: [], finalShownCount: null, finalUniqueCount: 0, listTotalMatched: false, listCompletionReason: null, requireAbove48: true, pageReady: false };
  const completeResult = (extra = {}) => {
    const latestVerification = verificationEvents.at(-1) || null;
    return { entryUrl: options.startUrl, products: output, pages, expectedPages, browser, languageSelection, listing, manualVerification: { requested: verificationEvents.length > 0, completed: verificationEvents.length > 0, timeoutSeconds: options.manualVerificationSeconds, waitedSeconds: verificationEvents.reduce((sum, event) => sum + event.waitedSeconds, 0), screenshotPath: latestVerification?.screenshotPath || null, blockedHtmlPath: latestVerification?.blockedHtmlPath || null, events: verificationEvents }, ...extra };
  };
  let context; const ownsContext = !options.context;
  let expectedPages = null;
  try { context = options.context || await launchDanishContext(options); }
  catch (error) { return completeResult({ failureStage: "browser-launch", exitCode: 1, failureMessage: text(error?.message || error) }); }
  const page = context.pages()[0] || await context.newPage(); let currentUrl = options.startUrl, pageIndex = 1;
  try {
    while (currentUrl && pageIndex <= 500) {
      await page.goto(currentUrl, { waitUntil: "domcontentloaded", timeout: 60000 }); await page.waitForTimeout(800);
      let state = await readPageState(page);
      if (state.inspection.kind === "blocked") {
        const verification = await waitForManualVerification(page, options, pageIndex, state); verificationEvents.push(verification.event);
        if (!verification.passed) { pages.push({ pageIndex, url: state.url, kind: "blocked", reason: state.inspection.code, itemCount: 0, manualVerification: verification.event }); return completeResult({ failureStage: "manual-verification-timeout", exitCode: 3, failureMessage: "manual verification timed out" }); }
        state = verification.state;
      }
      const language = await handleLanguageModal(page, options, pageIndex);
      if (language) {
        languageSelection = language.language;
        if (!language.passed) { pages.push({ pageIndex, url: state.url, kind: "language-selection-failed", reason: language.language.failureReason, itemCount: 0, languageSelection }); return completeResult({ failureStage: "age-language-gate-not-dismissed", exitCode: 3, failureMessage: language.language.failureReason || "age/language gate not dismissed" }); }
        state = language.state;
      }
      const ready = await isReadyForProducts(page); state = ready.state; listing.pageReady = ready.ready;
      if (!ready.ready || (state.inspection.kind === "structure-change" && !state.listVisible)) { pages.push({ pageIndex, url: state.url, kind: "structure-change", reason: state.inspection.code, itemCount: 0 }); return completeResult({ failureStage: "page-structure-unrecognized", exitCode: 5, failureMessage: state.inspection.code || "product list not ready" }); }
      const parsed = parseListHtml(state.html, state.url, pageIndex); expectedPages = Math.max(expectedPages || 0, parsed.expectedPages || 0) || null;
      if (state.cardCount === 0) { const hasNext = Boolean(parsed.nextUrl); pages.push({ pageIndex, url: state.url, kind: pageIndex === 1 || hasNext ? "empty-failure" : "normal-end-empty", reason: "no-list-items", itemCount: 0, endReason: hasNext ? "unexpected-empty" : "no-next" }); return completeResult({ failureStage: "empty-list", exitCode: 4, failureMessage: "list page has no products" }); }
      const loaded = await loadAllShowMore(page, options, pageIndex, state);
      if (loaded.languageSelection) languageSelection = loaded.languageSelection;
      listing = { ...listing, initialShownCount: listing.initialShownCount ?? loaded.initialShownCount, detectedTotalCount: loaded.detectedTotalCount ?? listing.detectedTotalCount, showMoreClickCount: listing.showMoreClickCount + loaded.showMoreClickCount, showMoreProgress: [...listing.showMoreProgress, ...loaded.showMoreProgress], finalShownCount: loaded.finalShownCount, finalUniqueCount: loaded.finalUniqueCount, listTotalMatched: loaded.listTotalMatched, listCompletionReason: loaded.listCompletionReason, pageReady: true };
      if (!loaded.passed) { pages.push({ pageIndex, url: state.url, kind: "incomplete-list", reason: loaded.failureStage, itemCount: loaded.items.length, listing }); return completeResult({ failureStage: loaded.failureStage, exitCode: 2, failureMessage: loaded.failureMessage }); }
      const items = loaded.items;
      if (!items.length) { const hasNext = Boolean(parsed.nextUrl); pages.push({ pageIndex, url: state.url, kind: pageIndex === 1 || hasNext ? "empty-failure" : "normal-end-empty", reason: "no-list-items", itemCount: 0, endReason: hasNext ? "unexpected-empty" : "no-next" }); return completeResult({ failureStage: "empty-list", exitCode: 4, failureMessage: "list page has no products" }); }
      for (const item of items) if (!seen.has(item.sourceProductId)) { seen.add(item.sourceProductId); output.push(item); }
      const next = parsed.nextUrl; pages.push({ pageIndex, url: state.url, kind: "success", itemCount: items.length, uniqueCount: output.length, endReason: next ? "next" : loaded.listCompletionReason, manualVerification: verificationEvents.at(-1) || null, listing });
      currentUrl = next; pageIndex += 1;
    }
  } catch (error) { pages.push({ pageIndex, url: page.url(), kind: "collector-error", reason: text(error?.message || error), itemCount: 0 }); return completeResult({ failureStage: "list-collector-error", exitCode: 2, failureMessage: text(error?.message || error) }); }
  finally { if (ownsContext) await context.close(); }
  listing.finalUniqueCount = output.length;
  if (listing.detectedTotalCount !== null) listing.listTotalMatched = output.length >= listing.detectedTotalCount;
  return completeResult();
}
async function collectLiveDetails(items, existing, maxItems, onUpdate, browserOptions) {
  const context = await launchDanishContext(browserOptions); const page = context.pages()[0] || await context.newPage(); const updated = { ...existing }; let processed = 0;
  try { for (const item of items) { if (processed >= maxItems) break; if (isFalcon(item)) continue; if (isCompleteDetail(updated[item.sourceProductId])) { updated[item.sourceProductId] = { ...updated[item.sourceProductId], reused: true }; continue; }
    try { await page.goto(item.sourceUrl, { waitUntil: "domcontentloaded", timeout: 60000 }); await page.waitForTimeout(800); const html = await page.content(); const inspection = inspectHtml(html); if (inspection.kind !== "ok") throw new Error(`detail-${inspection.code}`); const title = text(await page.title()); const images = unique(await page.locator("img").evaluateAll((nodes) => nodes.map((node) => node.currentSrc || node.src).filter((url) => /danishpipeshop\.com\/img\//i.test(url)))); updated[item.sourceProductId] = { sourceProductId: item.sourceProductId, sourceUrl: item.sourceUrl, title, images, galleryImages: images, completedAt: iso(), reused: false }; } catch (error) { updated[item.sourceProductId] = { sourceProductId: item.sourceProductId, sourceUrl: item.sourceUrl, error: text(error?.message || error), attemptedAt: iso() }; } processed += 1; if (onUpdate) await onUpdate(updated);
  }} finally { await context.close(); } return updated;
}
function markdownReport(manifest, diff) { return [`# Danish full refresh preview: ${manifest.runId}`, "", `完整性门：${diff.integrityGate.complete ? "通过" : "不通过"}`, `预计变更数：${diff.expectedChangeCount}`, `预计变更比例：${diff.expectedChangeRatio}`, "", "## 分类数量", "", ...Object.entries(diff.counts).map(([key, value]) => `- ${key}: ${value}`), ""].join("\n"); }
function csvReport(diff) { return ["product_id,brand,product_name,old_status,new_status,old_price,new_price,url,reason", ...Object.entries(diff.samples).flatMap(([, values]) => values).map((row) => [row.productId, row.brand, row.productName, row.oldStatus, row.newStatus, row.oldPrice, row.newPrice, row.url, row.reason].map(csv).join(","))].join("\n"); }

export async function runPreview(options) {
  const root = path.resolve(options.automationWorktree || process.cwd()), outputRoot = path.resolve(options.outputRoot || root), runId = options.runId; assertRunId(runId);
  const manualVerificationSeconds = Number(options.manualVerificationSeconds ?? 20);
  if (!Number.isInteger(manualVerificationSeconds) || manualVerificationSeconds < 1 || manualVerificationSeconds > 600) throw new Error("ManualVerificationSeconds must be an integer from 1 to 600.");
  const paths = runPaths(outputRoot, runId), startedAt = iso(); const checkpointPath = path.join(paths.raw, "checkpoint.json");
  if (!options.collectedList && fs.existsSync(path.join(paths.raw, "list.json")) && !options.resume) throw new Error(`RunId already exists; use -Resume or select a new RunId: ${runId}`);
  let list = options.collectedList || (fs.existsSync(path.join(paths.raw, "list.json")) && options.resume ? read(path.join(paths.raw, "list.json")) : await collectLiveList({ root, startUrl: options.entryUrl || START_URL, headed: Boolean(options.headed), browserChannel: options.browserChannel, context: options.context, manualVerificationSeconds, profileDir: path.join(root, "data", "runtime", "danish-browser-profile"), auditDir: paths.audits }));
  if (options.collectedList) list = { ...list, entryUrl: list.entryUrl || "fixture", browser: { mode: "fixture", channel: null }, manualVerification: { requested: false, completed: false, timeoutSeconds: manualVerificationSeconds, waitedSeconds: 0 }, languageSelection: list.languageSelection || { detected: false, automatic: false, preferredLanguage: "English", selectedLanguage: null, attemptCount: 0, completed: false, fallbackToManual: false, failureReason: null }, listing: list.listing || { pageReady: true, requireAbove48: false, listTotalMatched: true, listCompletionReason: "fixture-complete", finalUniqueCount: list.products.length } };
  list.products = list.products.map((item) => ({ ...item, inventoryStatus: item.inventoryStatus || status(item.rawStatusText) }));
  await writeAtomic(path.join(paths.raw, "list.json"), list, 25 * 1024 * 1024); await writeAtomic(path.join(paths.audits, "page-audit.json"), { source: SOURCE, runId, pages: list.pages, expectedPages: list.expectedPages, browserMode: list.browser?.mode || "fixture", browserChannel: list.browser?.channel || null, manualVerification: list.manualVerification || null, languageSelection: list.languageSelection || null, ageLanguageGate: list.languageSelection || null, listing: list.listing || null, failureStage: list.failureStage || null });
  let details = options.detailState || (fs.existsSync(path.join(paths.raw, "details.json")) ? read(path.join(paths.raw, "details.json")) : {});
  if (!options.listOnly && !options.detailState) details = await collectLiveDetails(list.products, details, options.maxDetailItems ?? 30, async (partial) => {
    await writeAtomic(path.join(paths.raw, "details.json"), partial, 25 * 1024 * 1024);
    await writeAtomic(checkpointPath, { runId, updatedAt: iso(), detailState: partial, pending: list.products.filter((item) => !isCompleteDetail(partial[item.sourceProductId]) && !isFalcon(item)).map((item) => item.sourceProductId) }, 25 * 1024 * 1024);
  }, { root, headed: Boolean(options.headed), manualVerificationSeconds, profileDir: path.join(root, "data", "runtime", "danish-browser-profile"), auditDir: paths.audits });
  await writeAtomic(path.join(paths.raw, "details.json"), details, 25 * 1024 * 1024); await writeAtomic(checkpointPath, { runId, updatedAt: iso(), detailState: details, pending: list.products.filter((item) => !isCompleteDetail(details[item.sourceProductId]) && !isFalcon(item)).map((item) => item.sourceProductId) }, 25 * 1024 * 1024);
  const integrity = evaluateIntegrity({ pages: list.pages, currentProducts: list.products, expectedPages: list.expectedPages, detailState: details, listing: list.listing, ageLanguageGate: list.languageSelection }); const baseline = options.baseline || getBaseline(root); const diff = buildDiffPreview(list.products.map((item) => ({ ...item, detail: details[item.sourceProductId] })), baseline.production, baseline.publicCatalog, integrity);
  await writeAtomic(path.join(paths.audits, "detail-audit.json"), { source: SOURCE, runId, attempted: Object.keys(details).length, successful: Object.values(details).filter(isCompleteDetail).length, failed: Object.values(details).filter((detail) => detail?.error).length }); await writeAtomic(path.join(paths.review, "diff-preview.json"), diff); const manifest = makeManifest({ runId, root, paths, startedAt, list, details, diff }); await writeAtomic(path.join(paths.raw, "manifest.json"), manifest); await writeAtomic(path.join(paths.review, "diff-preview.md"), markdownReport(manifest, diff)); await writeAtomic(path.join(paths.review, "diff-candidates.csv"), csvReport(diff));
  if (list.failureStage) throw new PreviewFailure(list.failureMessage || list.failureStage, list.exitCode || 2, list.failureStage);
  if (!integrity.complete) {
    const empty = integrity.successfulPages === 0 || list.products.length === 0;
    throw new PreviewFailure(empty ? "List integrity failed: no successful pages or unique products." : "List integrity gate failed.", empty ? 4 : 2, empty ? "empty-list" : "integrity-gate-failed");
  }
  return { paths, manifest, diff };
}
export function readRunReport(root, runId) { const paths = runPaths(path.resolve(root), runId); return { manifest: read(path.join(paths.raw, "manifest.json")), diff: read(path.join(paths.review, "diff-preview.json")), paths }; }
function fixtureList(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  if (path.extname(filePath).toLowerCase() === ".html") {
    const parsed = parseListHtml(content, `file://${filePath.replaceAll("\\", "/")}`, 1);
    return { products: parsed.products, pages: [{ pageIndex: 1, url: filePath, kind: parsed.products.length ? "success" : "empty-failure", itemCount: parsed.products.length, endReason: "no-next", fixture: true }], expectedPages: 1 };
  }
  const parsed = JSON.parse(content);
  return { products: products(parsed), pages: parsed.pages || [{ pageIndex: 1, url: filePath, kind: "success", itemCount: products(parsed).length, endReason: "no-next", fixture: true }], expectedPages: parsed.expectedPages || 1 };
}
function args(argv) { const values = {}; for (let index = 0; index < argv.length; index += 1) { const key = argv[index]; if (!key.startsWith("--")) continue; values[key.slice(2)] = argv[index + 1]?.startsWith("--") || argv[index + 1] === undefined ? true : argv[++index]; } return values; }
function isDirectExecution() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]).toLowerCase() === path.resolve(fileURLToPath(import.meta.url)).toLowerCase();
}
if (isDirectExecution()) {
  try { const cli = args(process.argv.slice(2)); const fixturePath = cli["fixture-list"] ? path.resolve(cli["fixture-list"]) : ""; if (cli.report) { console.log(json(readRunReport(cli["automation-worktree"], cli["run-id"]))); } else { console.log(`[NODE] Danish full refresh mode=${fixturePath ? "fixture" : "live"} listOnly=${Boolean(cli["list-only"])} resume=${Boolean(cli.resume)} headed=${Boolean(cli.headed)}`); const result = await runPreview({ automationWorktree: cli["automation-worktree"], runId: cli["run-id"], listOnly: Boolean(cli["list-only"]), resume: Boolean(cli.resume), headed: Boolean(cli.headed), manualVerificationSeconds: Number(cli["manual-verification-seconds"] || 20), maxDetailItems: Number(cli["max-detail-items"] || 30), collectedList: fixturePath ? fixtureList(fixturePath) : undefined, detailState: fixturePath ? {} : undefined }); console.log(json({ runId: result.manifest.runId, integrityGate: result.diff.integrityGate.complete, pending: result.manifest.pending, allowApply: false, productionWritten: false, publicWritten: false })); } } catch (error) { console.error(error?.stack || error); process.exitCode = error?.exitCode || 1; }
}
