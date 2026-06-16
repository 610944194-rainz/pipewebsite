import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");

const FINAL_JSON = "data/review/product-displayname-zh-shape-decisions-final-20260616.json";
const FINAL_MD = "data/review/product-displayname-zh-shape-decisions-final-20260616.md";

const EXPECTED_PROTECTED_HASHES = {
  "data/i18n/product-displayname-zh-safe-candidates.json": "552f0b5ecd40104247cf424b8c56d4f7addcaa762439696aa0b9b39fdd108bd2",
  "data/products/danish-products.json": "f3b5fb0473dbb77e3908abe312d641a04881854c0530ef0875e02f5abd0f7128",
  "data/products/smokingpipes-products.json": "d3f0772472cd30683a93eb27ed497956577e352b3d9ade3ed81db25e6992b9c7",
  "data/products/unified-products-staging.json": "b0446cbf44f6ea50df1a7f1acc131f000a168e80527e96053daac9df93b09b7e",
  "data/audits/product-displayname-zh-preview-20260616.json": "671162215517969a04cbf0cc135a01cf896ab6458e6ec7b21bbdcc42b6b71319",
  "data/audits/product-displayname-zh-preview-20260616-v2-simplified.json": "3ae75f717580d8c4a644bb516021cedcd5d9244a41491dc511a16e5c57e0a5e0",
  "app/products/page.tsx": "00f37a5b9df3d6d0673dc1e8217ca8e2d921b3affd53d6f63e04680af1e703cc",
  "app/products/[id]/page.tsx": "121f54bc77b6df4a40ac45af22474286fb20dc86071c1a7c902faf819311c11c",
  "components/products/ProductCard.tsx": "4c577b5e64c67df91d3d122c77bcb8b26d6f956d6b147188a4c74b0d61be78a9",
  "lib/public-products/query.ts": "f6a188c4908a0a466793dca265c927ef74a6ab41f0bf2aa7c52edcc6970d6b36",
  "lib/product-display-name.ts": "2955719fa6bc7d4b32d556be6bf58cd7393ffd4fbf68aee80980dcf904b66495",
  "lib/product-display-name-server.ts": "252011bdc2311a37cadb5bc75da139528f5c150daec37d6fe92d9806b0be9b07",
};

const REQUIRED_TRANSLATIONS = {
  Freehand: "自由式斗",
  "Oom Paul": "匈牙利式斗",
  "Reverse Calabash": "大气室斗",
  Blowfish: "河豚斗",
  Tulip: "郁金香斗",
  Ball: "球形斗",
  Pickaxe: "十字镐斗",
  Diplomat: "外交官斗",
  Cavalier: "骑士斗",
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

async function main() {
  const errors = [];
  const files = [];

  for (const file of [FINAL_JSON, FINAL_MD]) {
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
  try {
    data = await readJson(FINAL_JSON);
  } catch (error) {
    errors.push(`final shape JSON parse failed: ${error.message}`);
  }
  try {
    markdown = await readFile(projectPath(FINAL_MD), "utf8");
    if (markdown.trim().length === 0) errors.push(`${FINAL_MD} is empty`);
  } catch (error) {
    errors.push(`final shape markdown read failed: ${error.message}`);
  }

  const decisions = data?.shapeDecisions || {};
  if (data?.version !== "20260616-final-human-shape-decisions") {
    errors.push(`version mismatch: ${data?.version}`);
  }

  for (const [term, zh] of Object.entries(REQUIRED_TRANSLATIONS)) {
    if (decisions?.[term]?.zh !== zh) {
      errors.push(`shapeDecisions.${term}.zh must be ${zh}, got ${decisions?.[term]?.zh}`);
    }
  }

  for (const term of ["Stack", "Skater"]) {
    const item = decisions?.[term];
    if (!item) {
      errors.push(`shapeDecisions.${term} is missing`);
      continue;
    }
    if (item.action !== "do-not-display") errors.push(`${term}.action must be do-not-display`);
    if (item.display !== false) errors.push(`${term}.display must be false`);
    if (item.zh !== null) errors.push(`${term}.zh must be null`);
    if (item.isShape !== false) errors.push(`${term}.isShape must be false`);
  }

  const horn = decisions?.Horn;
  if (!horn?.contextRules) {
    errors.push("Horn must include contextRules");
  } else {
    const notShapeWhen = horn.contextRules.notShapeWhen || [];
    for (const phrase of ["w. Horn", "with Horn", "Horn stem", "Horn mount"]) {
      if (!notShapeWhen.includes(phrase)) {
        errors.push(`Horn.contextRules.notShapeWhen must include ${phrase}`);
      }
    }
  }
  if (data?.contextualShapeKeywords?.Horn?.shapeZh !== "号角斗") {
    errors.push("contextualShapeKeywords.Horn.shapeZh must be 号角斗");
  }
  for (const keyword of ["Stack", "Skater"]) {
    if (!(data?.doNotDisplayShapeKeywords || []).includes(keyword)) {
      errors.push(`doNotDisplayShapeKeywords must include ${keyword}`);
    }
  }

  if (!markdown.includes("# 斗型 / 结构词人工决策 Final 20260616")) {
    errors.push("markdown missing expected title");
  }
  if (!markdown.includes("| Stack | 7 | do-not-display |") || !markdown.includes("| Skater | 3 | do-not-display |")) {
    errors.push("markdown must list Stack and Skater as do-not-display");
  }
  for (const required of ["自由式斗", "葫芦斗", "号角斗", "匈牙利式斗", "大气室斗", "河豚斗", "郁金香斗"]) {
    if (!markdown.includes(required)) errors.push(`markdown missing ${required}`);
  }

  for (const [file, expectedHash] of Object.entries(EXPECTED_PROTECTED_HASHES)) {
    if (!existsSync(projectPath(file))) {
      errors.push(`${file} is missing`);
      continue;
    }
    const actualHash = await sha256File(file);
    if (actualHash !== expectedHash) {
      errors.push(`${file} hash changed: ${actualHash}`);
    }
  }

  const displayCount = Object.values(decisions).filter((item) => item.display === true).length;
  const doNotDisplayCount = Object.values(decisions).filter((item) => item.display === false).length;
  const result = {
    status: errors.length === 0 ? "passed" : "failed",
    files,
    counts: {
      shapeDecisions: Object.keys(decisions).length,
      display: displayCount,
      doNotDisplay: doNotDisplayCount,
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
