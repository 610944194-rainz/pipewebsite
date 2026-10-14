import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { loadProductNameContext, withResolvedProductName } from "../lib/product-name-resolver.mjs";
const root = process.cwd();
const publicRoot = "data/generated/public-products";
const read = p => JSON.parse(fs.readFileSync(path.join(root,p), "utf8"));
const context = loadProductNameContext();
const catalogFile = publicRoot + "/catalog.json";
const manifestFile = publicRoot + "/manifest.json";
const catalog = read(catalogFile);
const manifest = read(manifestFile);
const files = [catalogFile, ...(manifest.detailFiles || []), publicRoot + "/recent-new.json"];
const nextFiles = new Map();
const allowed = new Set(["displayName", "displayNameZh", "brandNameZh", "displayNameQuality"]);
function resolve(product, detail = false) {
  const next = withResolvedProductName(product, context);
  if (detail) next.displayNameZh = next.displayNameQuality === "fallback-original" ? null : next.displayName;
  for (const [k,v] of Object.entries(product)) if (!allowed.has(k)) assert.deepEqual(next[k],v, "Non-Chinese field changed: " + product.id + "." + k);
  const old = context.names.get(product.id);
  if (old?.displayTitle) assert.equal(next.displayName, old.displayTitle);
  assert.ok(["ready", "candidate", "fallback-original"].includes(next.displayNameQuality));
  assert.ok(next.displayName);
  return next;
}
for (const file of files) {
  const payload = read(file);
  const products = payload.products.map(p => resolve(p, file.includes("/details/")));
  assert.equal(products.length, payload.products.length);
  nextFiles.set(file, JSON.stringify({...payload, products}) + "\n");
}
const after = JSON.parse(nextFiles.get(catalogFile)).products;
const average = after.reduce((sum,p) => sum + Buffer.byteLength(JSON.stringify(p)),0) / after.length;
assert.ok(average <= 1300, "catalog average exceeds existing budget");
const byId = new Map(after.map(p => [p.id,p]));
for (const [file,content] of nextFiles) if (file.includes("/details/")) for (const p of JSON.parse(content).products) {
  assert.equal(p.displayName, byId.get(p.id).displayName);
  assert.equal(p.brandNameZh, byId.get(p.id).brandNameZh);
}
const newlyResolved = after.filter(p=>!context.names.has(p.id));
const summary = {
  total: after.length, previouslyMissing: newlyResolved.length,
  newTitlesContainingChinese: newlyResolved.filter(p=>/[\u3400-\u9fff]/.test(p.displayName)).length,
  intentionalOriginalFallback: newlyResolved.filter(p=>p.displayNameQuality === "fallback-original").length,
  confirmedBrandChineseCount: after.filter(p=>p.brandNameZh).length,
  historicalTitlesPreserved: after.length - newlyResolved.length,
  averageRecordBytes: average,
  nonChineseFieldsChanged: 0,
  qualityCounts: after.reduce((r,p)=>(r[p.displayNameQuality]=(r[p.displayNameQuality]||0)+1,r),{}),
};
if (process.argv.includes("--write")) {
  assert.ok(!manifest.fileHashes, "Use the full index builder for a hash-based manifest");
  for (const [file,content] of nextFiles) fs.writeFileSync(path.join(root,file),content);
  const nextManifest = {...manifest, productNameResolverVersion: "v1", productNameResolution: summary};
  fs.writeFileSync(path.join(root,manifestFile),JSON.stringify(nextManifest)+"\n");
}
console.log(JSON.stringify({status:"passed",written:process.argv.includes("--write"),...summary},null,2));
