import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const runId = process.env.DANISH_RUN_ID || "danish-v18-list-20260715-02";
const runRoot = path.join(root, "data", "review", "danish-full-refresh", runId);
const baselinePath = process.env.DANISH_STRUCTURED_BASELINE_PATH || "";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function idFromUrl(value) {
  return text(value).match(/-i(\d+)\.html/i)?.[1] || "";
}

function atomicWrite(filePath, contents) {
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

const production = readJson(path.join(root, "data", "products", "danish-products.json"));
const raw = readJson(path.join(root, "data", "raw", "danish-full-refresh", runId, "details.json")).products;
const baseline = baselinePath && fs.existsSync(baselinePath) ? readJson(baselinePath) : [];
const previewText = fs.readFileSync(path.join(root, "data", "danish-products-v18-preview.ts"), "utf8");
const previewMarker = "export const danishProducts: DanishPipeProduct[] = ";
const preview = JSON.parse(previewText.slice(previewText.indexOf(previewMarker) + previewMarker.length, previewText.lastIndexOf(";")).trim());
const baselineIds = new Set(baseline.map((product) => text(product.id)));
const rawById = new Map(raw.map((product) => [idFromUrl(product.href), product]));
const current = production.filter((product) => rawById.has(text(product.id)));
const newProducts = current.filter((product) => !baselineIds.has(text(product.id)));
const fields = {
  shape: (product) => Boolean(text(product.shape)),
  weightGrams: (product) => Number.isFinite(product.weightGrams),
  lengthMm: (product) => Number.isFinite(product.dimensions?.lengthMm),
  heightMm: (product) => Number.isFinite(product.dimensions?.heightMm),
  chamberDiameterMm: (product) => Number.isFinite(product.dimensions?.chamberDiameterMm),
  chamberDepthMm: (product) => Number.isFinite(product.dimensions?.chamberDepthMm),
  bowlDiameterMm: (product) => Number.isFinite(product.dimensions?.bowlOuterDiameterMm),
  finish: (product) => Boolean(text(product.finish)),
  material: (product) => Boolean(text(product.material)),
  stemMaterial: (product) => Boolean(text(product.stemMaterial)),
  filterSpec: (product) => Boolean(text(product.filterSpec || product.filter)),
};
const coverage = Object.fromEntries(Object.entries(fields).map(([name, present]) => [name, production.filter(present).length]));
const currentCoverage = Object.fromEntries(Object.entries(fields).map(([name, present]) => [name, current.filter(present).length]));
const newCoverage = Object.fromEntries(Object.entries(fields).map(([name, present]) => [name, newProducts.filter(present).length]));
const failures = Object.fromEntries(Object.entries(fields).map(([name, present]) => [name, current.filter((product) => {
  const rawProduct = rawById.get(text(product.id));
  return Array.isArray(rawProduct?.specsText) && rawProduct.specsText.length > 0 && !present(product);
}).slice(0, 20).map((product) => ({ id: product.id, name: product.name, specsText: rawById.get(text(product.id))?.specsText || [] }))]));
const fallbackFields = Object.fromEntries(Object.keys(fields).map((name) => [name, 0]));
const baselineById = new Map(baseline.map((product) => [text(product.id), product]));
const previewById = new Map(preview.map((product) => [text(product.id), product]));
for (const product of current) {
  const old = baselineById.get(text(product.id));
  const fresh = previewById.get(text(product.id));
  if (!old || !fresh) continue;
  for (const [name, present] of Object.entries(fields)) {
    if (!present(fresh) && present(old) && present(product)) fallbackFields[name] += 1;
  }
}
const sampleIds = {
  dunhill: production.filter((p) => /dunhill/i.test(p.brand)).slice(0, 3).map((p) => p.id),
  peterson: production.filter((p) => /peterson/i.test(p.brand)).slice(0, 3).map((p) => p.id),
  newProducts: newProducts.slice(0, 10).map((p) => p.id),
  estate: production.filter((p) => /estate/i.test(p.name) || p.conditionType === "estate").slice(0, 5).map((p) => p.id),
};
const report = {
  runId,
  generatedAt: new Date().toISOString(),
  currentProductCount: current.length,
  productionCount: production.length,
  specsTextNonEmpty: current.filter((p) => rawById.get(text(p.id))?.specsText?.length).length,
  coverage,
  currentCoverage,
  newProductCoverage: { total: newProducts.length, fields: newCoverage },
  parseFailuresWithRawSpecs: Object.fromEntries(Object.entries(failures).map(([name, samples]) => [name, { count: current.filter((product) => {
    const rawProduct = rawById.get(text(product.id));
    return Array.isArray(rawProduct?.specsText) && rawProduct.specsText.length > 0 && !fields[name](product);
  }).length, samples }])),
  oldDataBackfill: { baselineCount: baseline.length, fieldDistribution: fallbackFields },
  acceptanceSamples: sampleIds,
};
const markdown = [
  "# Danish V18 结构化参数验收", "", `- RunId: ${runId}`, `- 当前商品: ${report.currentProductCount}`, `- Production: ${report.productionCount}`, `- specsText 非空: ${report.specsTextNonEmpty}`, "", "## 字段覆盖", "", ...Object.entries(coverage).map(([name, count]) => `- ${name}: ${count}/${production.length}`), "", "## 新增商品覆盖", "", `- total: ${newProducts.length}`, ...Object.entries(newCoverage).map(([name, count]) => `- ${name}: ${count}/${newProducts.length}`), "", "## 原始规格存在但未解析", "", ...Object.entries(report.parseFailuresWithRawSpecs).map(([name, value]) => `- ${name}: ${value.count}`), "", "## 抽查 ID", "", ...Object.entries(sampleIds).map(([name, ids]) => `- ${name}: ${ids.join(", ")}`), ""
].join("\n");
atomicWrite(path.join(runRoot, "structured-specs-validation.json"), `${JSON.stringify(report, null, 2)}\n`);
const validationMarkdown = [
  "# Danish V18 structured specs validation",
  "",
  `- RunId: ${runId}`,
  `- Danish current products: ${report.currentProductCount}`,
  `- Danish Production: ${report.productionCount}`,
  `- Nonempty specsText: ${report.specsTextNonEmpty}`,
  "",
  "## Field coverage",
  "",
  ...Object.entries(coverage).map(([name, count]) => `- ${name}: ${count}/${production.length}`),
  "",
  "## New-product coverage",
  "",
  `- total: ${newProducts.length}`,
  ...Object.entries(newCoverage).map(([name, count]) => `- ${name}: ${count}/${newProducts.length}`),
  "",
  "## Old-data backfill",
  "",
  `- baseline: ${baseline.length}`,
  ...Object.entries(fallbackFields).map(([name, count]) => `- ${name}: ${count}`),
  "",
  "## Raw specs present but not parsed",
  "",
  ...Object.entries(report.parseFailuresWithRawSpecs).flatMap(([name, value]) => [
    `- ${name}: ${value.count}`,
    ...value.samples.map((sample) => `  - ${sample.id}: ${sample.name}`),
  ]),
  "",
  "## Acceptance sample IDs",
  "",
  ...Object.entries(sampleIds).map(([name, ids]) => `- ${name}: ${ids.join(", ")}`),
  "",
].join("\n");
atomicWrite(path.join(runRoot, "structured-specs-validation.md"), validationMarkdown);
console.log("Danish structured specs validation written");
