import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const runId = process.env.DANISH_RUN_ID || "danish-v18-list-20260715-02";
const runRoot = path.join(root, "data", "review", "danish-full-refresh", runId);
const rawRoot = path.join(root, "data", "raw", "danish-full-refresh", runId);
const publicRoot = path.join(root, "data", "generated", "public-products");
const backupRoot = process.env.DANISH_ROLLBACK_BACKUP || "";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function hash(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function danishId(product) {
  return text(product?.sourceProductId || product?.id).replace(/^danish-/i, "");
}

function isFalcon(product) {
  return /^(falcon)(\b| |,|-)/i.test(text(product?.brand?.name || product?.brand)) || /^(falcon)(\b| |,|-)/i.test(text(product?.displayName || product?.name));
}

function writeAtomic(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const suffix = `${process.pid}.${Date.now()}`;
  const temporary = `${filePath}.${suffix}.tmp`;
  const previous = `${filePath}.${suffix}.previous`;
  let moved = false;
  fs.writeFileSync(temporary, contents, "utf8");
  try {
    if (fs.existsSync(filePath)) {
      fs.renameSync(filePath, previous);
      moved = true;
    }
    fs.renameSync(temporary, filePath);
    if (moved && fs.existsSync(previous)) fs.rmSync(previous, { force: true });
  } catch (error) {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    if (moved && fs.existsSync(previous) && !fs.existsSync(filePath)) fs.renameSync(previous, filePath);
    throw error;
  }
}

const list = readJson(path.join(rawRoot, "list.json"));
const details = readJson(path.join(rawRoot, "details.json"));
const detailErrors = readJson(path.join(rawRoot, "detail-errors.json"));
const productionPath = path.join(root, "data", "products", "danish-products.json");
const candidatePath = path.join(runRoot, "danish-products-v18-production-candidate.json");
const production = readJson(productionPath);
const candidate = readJson(candidatePath);
const stagingPath = path.join(root, "data", "products", "unified-products-staging.json");
const staging = readJson(stagingPath);
const catalogPath = path.join(publicRoot, "catalog.json");
const lookupPath = path.join(publicRoot, "detail-lookup.json");
const manifestPath = path.join(publicRoot, "manifest.json");
const catalog = readJson(catalogPath).products;
const lookup = readJson(lookupPath);
const manifest = readJson(manifestPath);
const detailsRoot = path.join(publicRoot, "details");
const expectedShards = Array.from({ length: 64 }, (_, index) => index.toString(16).padStart(2, "0"));
const shards = expectedShards.map((shard) => ({ shard, relative: `data/generated/public-products/details/${shard}.json`, payload: readJson(path.join(detailsRoot, `${shard}.json`)) }));
const productionIds = production.map((product) => text(product.id));
const stagingDanish = staging.filter((product) => product.source === "danish");
const stagingDanishIds = new Set(stagingDanish.map(danishId));
const publicDanish = catalog.filter((product) => product.source === "danish");
const publicDanishIds = publicDanish.map(danishId);
const catalogIds = new Set(catalog.map((product) => text(product.id)));
const lookupIds = new Set(Object.keys(lookup.byId || {}));
const shardProducts = shards.flatMap((shard) => shard.payload.products || []);
const shardIds = new Set(shardProducts.map((product) => text(product.id)));
const expectedPublicDanish = stagingDanish.filter((product) => product.inventory?.publicIndexEligible === true);
const publicSmokingpipes = catalog.filter((product) => product.source === "smokingpipes");
const previousSmokingpipes = backupRoot && fs.existsSync(path.join(backupRoot, "public-products", "catalog.json"))
  ? readJson(path.join(backupRoot, "public-products", "catalog.json")).products.filter((product) => product.source === "smokingpipes").length
  : null;
const productionStatus = production.reduce((counts, product) => ({ ...counts, [text(product.status)]: (counts[text(product.status)] || 0) + 1 }), {});
const stagingStatus = stagingDanish.reduce((counts, product) => ({ ...counts, [text(product.inventory?.status)]: (counts[text(product.inventory?.status)] || 0) + 1 }), {});
const missingImages = production.filter((product) => !text(product.imageUrl) || !text(product.detailImageUrl) || !product.galleryImages?.length);
const missingProductCodes = production.filter((product) => !text(product.productCode));
const malformed = production.filter((product) => JSON.stringify(product).includes("??") || JSON.stringify(product).includes("�"));
const manifestHashesMatch = Object.entries(manifest.fileHashes || {}).every(([relative, value]) => fs.existsSync(path.join(root, relative)) && hash(path.join(root, relative)).toLowerCase() === text(value).toLowerCase());
const checks = {
  rawCounts: list.products?.length === 2172 && details.products?.length === 2172 && details.successCount === 2172 && details.failCount === 0 && detailErrors.errors?.length === 0,
  production: production.length === 2372 && new Set(productionIds).size === 2372 && productionIds.every((id) => /^\d+$/.test(id) && Number(id) > 0) && productionStatus["可购买"] === 1762 && productionStatus["已售"] === 610 && !production.some(isFalcon) && !productionIds.includes("32447") && malformed.length === 0 && missingImages.length <= 1,
  candidateSha: hash(productionPath) === hash(candidatePath),
  staging: staging.length === 9269 && stagingDanish.length === 2372 && staging.filter((product) => product.source === "smokingpipes").length === 6897 && stagingDanishIds.size === 2372 && stagingStatus.available === 1762 && stagingStatus.sold === 610 && !stagingDanish.some(isFalcon),
  publicFiles: ["catalog.json", "detail-lookup.json", "brands.json", "filters.json", "manifest.json"].every((file) => fs.existsSync(path.join(publicRoot, file))),
  publicIntegrity: manifestHashesMatch && shards.length === 64 && new Set(shards.map((shard) => shard.payload.shard)).size === 64 && catalogIds.size === catalog.length && lookupIds.size === catalog.length && shardIds.size === catalog.length && [...catalogIds].every((id) => lookupIds.has(id) && shardIds.has(id)),
  publicDanish: publicDanish.length === expectedPublicDanish.length && new Set(publicDanishIds).size === publicDanish.length && publicDanishIds.every((id) => stagingDanishIds.has(id) && productionIds.includes(id)) && !publicDanish.some(isFalcon) && !publicDanishIds.includes("32447") && !publicDanish.some((product) => text(product.inventoryStatus) === "unknown"),
  smokingpipesPreserved: previousSmokingpipes === null || publicSmokingpipes.length >= previousSmokingpipes,
  offlineTests: process.env.DANISH_OFFLINE_TESTS_PASSED === "true",
  npmBuild: process.env.DANISH_NPM_BUILD_PASSED === "true",
  diffCheck: process.env.DANISH_DIFF_CHECK_PASSED === "true",
};
const passed = Object.values(checks).every(Boolean);
const report = {
  runId,
  generatedAt: new Date().toISOString(),
  status: passed ? "passed" : "failed",
  raw: { listCount: list.products?.length || 0, detailCount: details.products?.length || 0, successCount: details.successCount, failCount: details.failCount },
  production: { count: production.length, statusCounts: productionStatus, missingImages: missingImages.length, missingProductCodes: missingProductCodes.length, sha256: hash(productionPath) },
  staging: { total: staging.length, danish: stagingDanish.length, smokingpipes: staging.filter((product) => product.source === "smokingpipes").length, danishStatusCounts: stagingStatus, sha256: hash(stagingPath) },
  public: { total: catalog.length, danish: publicDanish.length, smokingpipes: publicSmokingpipes.length, expectedDanishEligible: expectedPublicDanish.length, previousSmokingpipes, detailShardCount: shards.length, manifestSha256: hash(manifestPath), catalogSha256: hash(catalogPath) },
  exclusions: { falconExcluded: 54, bpk32447Excluded: !productionIds.includes("32447"), retainedHistoricalAsSold: 255 },
  duplicates: { productionIds: productionIds.length - new Set(productionIds).size, stagingDanishIds: stagingDanish.length - stagingDanishIds.size, publicDanishIds: publicDanishIds.length - new Set(publicDanishIds).size },
  checks,
  tests: { offline: process.env.DANISH_OFFLINE_TESTS_PASSED === "true", npmBuild: process.env.DANISH_NPM_BUILD_PASSED === "true", gitDiffCheck: process.env.DANISH_DIFF_CHECK_PASSED === "true" },
  productionWritten: true,
  publicWritten: true,
  allowApply: passed,
  rollbackBackupDirectory: backupRoot || null,
};
const markdown = [
  `# Danish V18 最终验收`, "", `- RunId: ${runId}`, `- 结论: ${report.status}`, `- Raw: List ${report.raw.listCount}; Details ${report.raw.detailCount}; success ${report.raw.successCount}; fail ${report.raw.failCount}`, `- Production: ${report.production.count}（可购买 ${productionStatus["可购买"] || 0}；已售 ${productionStatus["已售"] || 0}）`, `- Staging: ${report.staging.total}（Danish ${report.staging.danish}；Smokingpipes ${report.staging.smokingpipes}）`, `- Public: ${report.public.total}（Danish ${report.public.danish}；Smokingpipes ${report.public.smokingpipes}；detail shards ${report.public.detailShardCount}）`, `- 缺图: ${report.production.missingImages}; 缺产品编号: ${report.production.missingProductCodes}`, `- Production/Candidate SHA256: ${report.production.sha256}`, `- Staging SHA256: ${report.staging.sha256}`, `- Public manifest/catalog SHA256: ${report.public.manifestSha256} / ${report.public.catalogSha256}`, `- rollback backup: ${report.rollbackBackupDirectory || "未提供"}`, "", "## 校验", "", ...Object.entries(checks).map(([name, value]) => `- ${name}: ${value ? "passed" : "failed"}`), ""
].join("\n");
writeAtomic(path.join(runRoot, "final-rollout-validation.json"), `${JSON.stringify(report, null, 2)}\n`);
writeAtomic(path.join(runRoot, "final-rollout-validation.md"), markdown);
console.log(`Danish V18 final rollout validation ${report.status}`);
if (!passed) process.exitCode = 1;
