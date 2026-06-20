import fs from "node:fs";
import path from "node:path";
import process from "node:process";

export const ROOT = process.cwd();
export const INVENTORY_DIR = path.join(ROOT, "data", "inventory");
export const REVIEW_DIR = path.join(ROOT, "data", "review");

export const PATHS = {
  currentList: path.join(
    INVENTORY_DIR,
    "smokingpipes-current-list-dry-run.json"
  ),
  diff: path.join(
    INVENTORY_DIR,
    "smokingpipes-inventory-diff-dry-run.json"
  ),
  recentNew: path.join(INVENTORY_DIR, "recent-new-dry-run.json"),
  report: path.join(
    REVIEW_DIR,
    "smokingpipes-inventory-update-report-v1.md"
  ),
  existingProducts: path.join(
    ROOT,
    "data",
    "products",
    "smokingpipes-products.json"
  ),
};

export function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseCliOptions(argv = process.argv.slice(2)) {
  const options = {};

  for (const argument of argv) {
    if (!argument.startsWith("--")) continue;
    const [rawKey, ...rawValue] = argument.slice(2).split("=");
    options[rawKey] = rawValue.length ? rawValue.join("=") : true;
  }

  return options;
}

export function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required JSON file does not exist: ${relativePath(filePath)}`);
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function arrayFromPayload(payload, candidateKeys = []) {
  if (Array.isArray(payload)) return payload;

  for (const key of candidateKeys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }

  return [];
}

export function relativePath(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

function assertDryRunWritePath(filePath) {
  const resolved = path.resolve(filePath);
  const inventoryRoot = path.resolve(INVENTORY_DIR);
  const reportPath = path.resolve(PATHS.report);

  if (
    resolved !== reportPath &&
    !resolved.startsWith(`${inventoryRoot}${path.sep}`)
  ) {
    throw new Error(
      `Refusing to write outside dry-run inventory/report paths: ${relativePath(
        filePath
      )}`
    );
  }
}

async function replaceFileWithRetry(tempPath, targetPath) {
  let lastError = null;

  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      await fs.promises.rename(tempPath, targetPath);
      return;
    } catch (error) {
      lastError = error;
      if (!["EPERM", "EACCES", "EBUSY"].includes(error.code)) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 80));
    }
  }

  const pendingPath = `${targetPath}.pending`;
  await fs.promises.rename(tempPath, pendingPath);
  throw new Error(
    `Could not replace ${relativePath(
      targetPath
    )}; complete output preserved at ${relativePath(pendingPath)}. ${
      lastError?.message || ""
    }`
  );
}

export async function writeTextAtomic(filePath, content) {
  assertDryRunWritePath(filePath);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.promises.writeFile(tempPath, content, "utf8");

  if (filePath.endsWith(".json")) {
    JSON.parse(await fs.promises.readFile(tempPath, "utf8"));
  }

  await replaceFileWithRetry(tempPath, filePath);
}

export async function writeJsonAtomic(filePath, payload) {
  await writeTextAtomic(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

export function sortIds(values) {
  return [...values].sort((left, right) =>
    String(left).localeCompare(String(right), "en", { numeric: true })
  );
}

export function duplicateValues(values) {
  const counts = new Map();
  for (const value of values.map(normalizeText).filter(Boolean)) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return sortIds(
    [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([value]) => value)
  );
}

export function isDirectExecution(importMetaUrl) {
  if (!process.argv[1]) return false;

  const normalizedScript = path.resolve(process.argv[1]).replace(/\\/g, "/");
  const normalizedModule = decodeURIComponent(new URL(importMetaUrl).pathname)
    .replace(/^\/([A-Za-z]:)/, "$1")
    .replace(/\\/g, "/");

  return normalizedScript.toLowerCase() === normalizedModule.toLowerCase();
}
