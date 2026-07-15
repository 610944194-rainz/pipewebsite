import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "danish-v18-structured-backfill-"));
const previewPath = path.join(temp, "preview.ts");
const baselinePath = path.join(temp, "baseline.json");
const listPath = path.join(temp, "list.json");
const candidatePath = path.join(temp, "candidate.json");
const reportPath = path.join(temp, "report.json");
const current = {
  id: 100,
  name: "Fresh Billiard",
  status: "可购买",
  sourceUrl: "https://example.test/fresh-i100.html",
  imageUrl: "fresh.jpg",
  detailImageUrl: "fresh.jpg",
  galleryImages: ["fresh.jpg"],
  shape: "Billiard",
  shapeZh: "撞球斗",
  finish: "Smooth",
  finishZh: "光面",
  material: "Briar",
  materialZh: "石楠木",
  stemMaterial: "Acrylic",
  stemMaterialZh: "亚克力",
  filter: "9mm",
  filterSpec: "9mm",
  filterSizeMm: 9,
  weightGrams: 31.18,
  dimensions: { lengthMm: null, heightMm: 40, bowlOuterDiameterMm: null, chamberDiameterMm: 18, chamberDepthMm: 35, buttonWidthMm: null, bitThicknessMm: null },
};
const old = {
  ...current,
  shape: "Apple",
  shapeZh: "苹果斗",
  weightGrams: 55,
  dimensions: { ...current.dimensions, lengthMm: 120, bowlOuterDiameterMm: 42 },
};
fs.writeFileSync(previewPath, `export const danishProducts: DanishPipeProduct[] = ${JSON.stringify([current], null, 2)};\n`, "utf8");
fs.writeFileSync(baselinePath, `${JSON.stringify([old], null, 2)}\n`, "utf8");
fs.writeFileSync(listPath, `${JSON.stringify({ products: [] })}\n`, "utf8");
const result = spawnSync(process.execPath, [
  "scripts/inventory/build-danish-v18-production-candidate.mjs",
  "--run-id", "candidate-test-001",
  "--preview", previewPath,
  "--baseline", baselinePath,
  "--list", listPath,
  "--candidate", candidatePath,
  "--report", reportPath,
], { cwd: root, encoding: "utf8" });
assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
const candidate = JSON.parse(fs.readFileSync(candidatePath, "utf8"))[0];
assert.equal(candidate.shape, "Billiard");
assert.equal(candidate.weightGrams, 31.18);
assert.equal(candidate.dimensions.lengthMm, 120);
assert.equal(candidate.dimensions.bowlOuterDiameterMm, 42);
console.log("Danish candidate structured-field backfill test passed");
