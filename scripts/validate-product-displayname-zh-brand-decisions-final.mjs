import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");

const INPUT_JSON = "data/review/product-displayname-zh-brand-decisions-final-20260616.json";
const OUTPUT_MD = "data/review/product-displayname-zh-brand-decisions-final-20260616.md";

const EXPECTED_HASHES = {
  [INPUT_JSON]: "a4dbcac63bb7803b18b9f3b797aaf2a3ef3244f2259554cb4d0ecc64136b353f",
  "data/i18n/product-displayname-zh-safe-candidates.json": "552f0b5ecd40104247cf424b8c56d4f7addcaa762439696aa0b9b39fdd108bd2",
  "data/products/danish-products.json": "f3b5fb0473dbb77e3908abe312d641a04881854c0530ef0875e02f5abd0f7128",
  "data/products/smokingpipes-products.json": "d3f0772472cd30683a93eb27ed497956577e352b3d9ade3ed81db25e6992b9c7",
  "data/products/unified-products-staging.json": "b0446cbf44f6ea50df1a7f1acc131f000a168e80527e96053daac9df93b09b7e",
  "app/products/page.tsx": "00f37a5b9df3d6d0673dc1e8217ca8e2d921b3affd53d6f63e04680af1e703cc",
  "app/products/[id]/page.tsx": "121f54bc77b6df4a40ac45af22474286fb20dc86071c1a7c902faf819311c11c",
  "components/products/ProductCard.tsx": "4c577b5e64c67df91d3d122c77bcb8b26d6f956d6b147188a4c74b0d61be78a9",
  "lib/public-products/query.ts": "f6a188c4908a0a466793dca265c927ef74a6ab41f0bf2aa7c52edcc6970d6b36",
  "lib/product-display-name.ts": "2955719fa6bc7d4b32d556be6bf58cd7393ffd4fbf68aee80980dcf904b66495",
  "lib/product-display-name-server.ts": "252011bdc2311a37cadb5bc75da139528f5c150daec37d6fe92d9806b0be9b07",
};

function projectPath(relativePath) {
  return path.join(PROJECT_ROOT, relativePath);
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(projectPath(relativePath), "utf8"));
}

async function sha256File(relativePath) {
  const data = await readFile(projectPath(relativePath));
  return createHash("sha256").update(data).digest("hex");
}

function rowsBetween(markdown, startHeading, endHeading) {
  const start = markdown.indexOf(startHeading);
  if (start < 0) return [];
  const rest = markdown.slice(start + startHeading.length);
  const end = endHeading ? rest.indexOf(endHeading) : -1;
  const section = end >= 0 ? rest.slice(0, end) : rest;
  return section
    .split(/\r?\n/)
    .filter((line) => /^\|\s/.test(line) && !/^\|\s*-/.test(line))
    .filter((line) => {
      const firstCell = line.replace(/^\|/, "").split("|")[0].trim();
      return firstCell !== "序号" && firstCell !== "规则";
    });
}

async function main() {
  const errors = [];
  const files = [];

  for (const file of [INPUT_JSON, OUTPUT_MD]) {
    if (!existsSync(projectPath(file))) {
      errors.push(`${file} is missing`);
      continue;
    }
    const info = await stat(projectPath(file));
    files.push({ path: file, bytes: info.size });
    if (info.size === 0) errors.push(`${file} is empty`);
  }

  let data = null;
  let markdown = "";
  try { data = await readJson(INPUT_JSON); } catch (error) { errors.push(`final JSON parse failed: ${error.message}`); }
  try { markdown = await readFile(projectPath(OUTPUT_MD), "utf8"); } catch (error) { errors.push(`markdown read failed: ${error.message}`); }

  const decisions = Object.entries(data?.brandDecisions || {});
  const aliases = Object.entries(data?.brandAliasCorrections || {});
  const reviewRequired = Array.isArray(data?.reviewRequiredAfterApply)
    ? data.reviewRequiredAfterApply
    : Object.keys(data?.reviewRequiredAfterApply || {});
  const translated = decisions.filter(([, item]) => item.action === "translate");
  const keepOriginal = decisions.filter(([, item]) => item.action === "keep-original");

  if (!data?.version) errors.push("final JSON missing version");
  if (decisions.length !== 100) errors.push(`brandDecisions count must be 100, got ${decisions.length}`);
  if (translated.length !== 43) errors.push(`translate decisions count must be 43, got ${translated.length}`);
  if (keepOriginal.length !== 57) errors.push(`keep-original decisions count must be 57, got ${keepOriginal.length}`);
  if (aliases.length !== 5) errors.push(`brandAliasCorrections count must be 5, got ${aliases.length}`);
  if (reviewRequired.length !== 7) errors.push(`reviewRequiredAfterApply count must be 7, got ${reviewRequired.length}`);

  for (const [brand, item] of decisions) {
    if (!["translate", "keep-original"].includes(item.action)) {
      errors.push(`${brand} has invalid action: ${item.action}`);
    }
    if (item.action === "translate" && !String(item.zh || "").trim()) {
      errors.push(`${brand} translate decision must include zh`);
    }
    if (item.action === "keep-original" && String(item.zh || "").trim()) {
      errors.push(`${brand} keep-original decision must not include zh`);
    }
    if (!String(item.decisionSource || "").trim()) {
      errors.push(`${brand} missing decisionSource`);
    }
  }

  for (const [brand, item] of aliases) {
    if (!String(item.action || "").startsWith("alias-to-brand")) {
      errors.push(`${brand} alias correction has invalid action: ${item.action}`);
    }
    if (!String(item.canonicalBrand || "").trim()) {
      errors.push(`${brand} alias correction missing canonicalBrand`);
    }
  }

  if (!markdown.includes("# 商品中文名品牌最终人工决策表")) errors.push("markdown missing title");
  const decisionRows = rowsBetween(markdown, "## 3. 品牌中文名最终决策", "## 4. 仅保留英文品牌");
  const keepRows = rowsBetween(markdown, "## 4. 仅保留英文品牌", "## 5. 品牌 / 系列边界修正");
  const aliasRows = rowsBetween(markdown, "## 5. 品牌 / 系列边界修正", "## 6. 应用后仍需复核");
  const reviewRows = rowsBetween(markdown, "## 6. 应用后仍需复核", "## 7. 备注");
  if (decisionRows.length !== decisions.length) errors.push(`markdown decision rows mismatch: ${decisionRows.length} vs ${decisions.length}`);
  if (keepRows.length !== keepOriginal.length) errors.push(`markdown keep-original rows mismatch: ${keepRows.length} vs ${keepOriginal.length}`);
  if (aliasRows.length !== aliases.length) errors.push(`markdown alias rows mismatch: ${aliasRows.length} vs ${aliases.length}`);
  if (reviewRows.length !== reviewRequired.length) errors.push(`markdown review rows mismatch: ${reviewRows.length} vs ${reviewRequired.length}`);

  for (const [file, expectedHash] of Object.entries(EXPECTED_HASHES)) {
    if (!existsSync(projectPath(file))) {
      errors.push(`${file} is missing`);
      continue;
    }
    const actualHash = await sha256File(file);
    if (actualHash !== expectedHash) {
      errors.push(`${file} hash changed: ${actualHash}`);
    }
  }

  const result = {
    status: errors.length === 0 ? "passed" : "failed",
    files,
    counts: {
      brandDecisions: decisions.length,
      translated: translated.length,
      keepOriginal: keepOriginal.length,
      aliasCorrections: aliases.length,
      reviewRequiredAfterApply: reviewRequired.length,
    },
    errors,
  };

  console.log(JSON.stringify(result, null, 2));
  if (errors.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
