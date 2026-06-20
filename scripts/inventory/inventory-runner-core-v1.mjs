import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ALLOWED_MODES = new Set(["dry-run", "apply-dry-run", "apply"]);

function booleanValue(value, fallback = false) {
  if (value === undefined) return fallback;
  if (value === true) return true;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseArguments(argv) {
  const out = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) continue;

    const body = argument.slice(2);
    if (body.includes("=")) {
      const [key, ...parts] = body.split("=");
      out.set(key, parts.join("="));
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      out.set(body, next);
      index += 1;
    } else {
      out.set(body, true);
    }
  }

  return out;
}

export function parseRunnerOptions(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  const mode = String(args.get("mode") || "dry-run").toLowerCase();
  const source = String(args.get("source") || "smokingpipes").toLowerCase();

  if (!ALLOWED_MODES.has(mode)) {
    throw new Error(
      `Unsupported mode ${mode}. Supported: dry-run, apply-dry-run, apply.`
    );
  }
  if (source !== "smokingpipes") {
    throw new Error(`V1 only supports --source=smokingpipes. Received ${source}.`);
  }
  if (mode === "apply") {
    throw new Error(
      "Production apply is not implemented in Inventory Automation V1."
    );
  }

  return {
    source,
    mode,
    maxPages: positiveInteger(args.get("max-pages"), 107),
    expectedPages: positiveInteger(args.get("expected-pages"), 107),
    allowManualVerification: booleanValue(
      args.get("allow-manual-verification"),
      false
    ),
    manualVerificationTimeoutMs: positiveInteger(
      args.get("manual-verification-timeout-ms"),
      30 * 60 * 1000
    ),
    detailsBatchSize: positiveInteger(args.get("details-batch-size"), 50),
    maxNewDetailsPerRun: positiveInteger(
      args.get("max-new-details-per-run"),
      100
    ),
    commit: args.has("commit") && !args.has("no-commit"),
    deploy: args.has("deploy") && !args.has("no-deploy"),
    verbose: booleanValue(args.get("verbose"), false),
    forceUnlock: booleanValue(args.get("force-unlock"), false),
    mock: booleanValue(args.get("mock"), false),
    help: args.has("help") || args.has("h"),
  };
}

export function formatRunId(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

export function getRunnerPaths(root, options = {}) {
  const mock = Boolean(options.mock);
  const base = mock
    ? path.join(root, ".cache", "inventory-v1", "mock")
    : root;
  const inventoryRoot = mock
    ? path.join(base, "data", "inventory")
    : path.join(root, "data", "inventory");
  const reviewRoot = mock
    ? path.join(base, "data", "review")
    : path.join(root, "data", "review");

  return {
    root,
    base,
    inventoryRoot,
    reviewRoot,
    stateDir: path.join(inventoryRoot, "state"),
    state: path.join(
      inventoryRoot,
      "state",
      "smokingpipes-inventory-state.json"
    ),
    lock: path.join(inventoryRoot, "state", "smokingpipes.lock"),
    queue: path.join(
      inventoryRoot,
      "smokingpipes-new-details-queue.json"
    ),
    currentList: path.join(
      inventoryRoot,
      "smokingpipes-current-list-dry-run.json"
    ),
    diff: path.join(
      inventoryRoot,
      "smokingpipes-inventory-diff-dry-run.json"
    ),
    recentNew: path.join(inventoryRoot, "recent-new-dry-run.json"),
    runReports: path.join(reviewRoot, "inventory-runs"),
    latestReport: path.join(
      reviewRoot,
      "smokingpipes-inventory-latest-report.md"
    ),
    legacyReport: path.join(
      reviewRoot,
      "smokingpipes-inventory-update-report-v1.md"
    ),
    applyReport: path.join(
      reviewRoot,
      "smokingpipes-apply-dry-run-report-v1.md"
    ),
    productsNext: path.join(
      base,
      "data",
      "products",
      "smokingpipes-products-next-dry-run.json"
    ),
    publicNextRoot: path.join(
      base,
      "data",
      "generated",
      "public-products-next"
    ),
  };
}

export function readJsonIfExists(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export async function writeTextAtomic(filePath, text) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.promises.writeFile(tempPath, text, "utf8");
  await fs.promises.rename(tempPath, filePath);
}

export async function writeJsonAtomic(filePath, payload) {
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  JSON.parse(content);
  await writeTextAtomic(filePath, content);
}

export function acquireRunLock(lockPath, metadata, forceUnlock = false) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  if (fs.existsSync(lockPath)) {
    if (!forceUnlock) {
      const existing = fs.readFileSync(lockPath, "utf8");
      throw Object.assign(
        new Error(
          `Inventory automation is already running. Lock: ${lockPath}. ${existing}`
        ),
        { code: "LOCK_EXISTS" }
      );
    }
    fs.unlinkSync(lockPath);
  }

  const payload = {
    version: "inventory-run-lock-v1",
    createdAt: new Date().toISOString(),
    pid: process.pid,
    ...metadata,
  };
  const descriptor = fs.openSync(lockPath, "wx");
  fs.writeFileSync(descriptor, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.closeSync(descriptor);

  return { lockPath, runId: payload.runId };
}

export function releaseRunLock(lock) {
  if (!lock?.lockPath || !fs.existsSync(lock.lockPath)) return;

  try {
    const payload = JSON.parse(fs.readFileSync(lock.lockPath, "utf8"));
    if (lock.runId && payload.runId && payload.runId !== lock.runId) return;
  } catch {
    return;
  }

  fs.unlinkSync(lock.lockPath);
}

function queueItemFromCurrent(item, now) {
  return {
    id: `smokingpipes-${item.sourceProductId}`,
    sourceProductId: String(item.sourceProductId),
    sourceUrl: item.sourceUrl || "",
    title: item.title || item.rawTitle || "",
    brand: item.brand || "",
    listPrice: item.price || "",
    mainImage: item.mainImage || item.image || "",
    active: true,
    status: "pending",
    retryCount: 0,
    lastError: null,
    lastTriedAt: null,
    completedAt: null,
    detail: null,
    addedAt: now,
    updatedAt: now,
  };
}

export function buildDetailsQueue({
  existingQueue,
  diff,
  currentProducts,
  now = new Date().toISOString(),
}) {
  const existingItems = new Map(
    (existingQueue?.items || []).map((item) => [
      String(item.sourceProductId),
      item,
    ])
  );
  const currentById = new Map(
    currentProducts.map((item) => [String(item.sourceProductId), item])
  );
  const activeIds = new Set((diff.newIds || []).map(String));
  const items = [];

  for (const sourceProductId of activeIds) {
    const current = currentById.get(sourceProductId) || {
      sourceProductId,
    };
    const existing = existingItems.get(sourceProductId);
    const next = existing
      ? {
          ...existing,
          sourceUrl: current.sourceUrl || existing.sourceUrl || "",
          title: current.title || current.rawTitle || existing.title || "",
          brand: current.brand || existing.brand || "",
          listPrice: current.price || existing.listPrice || "",
          mainImage:
            current.mainImage ||
            current.image ||
            existing.mainImage ||
            "",
          active: true,
          status:
            existing.status === "completed" ? "completed" : existing.status,
          updatedAt: now,
        }
      : queueItemFromCurrent(current, now);
    items.push(next);
  }

  for (const existing of existingItems.values()) {
    if (activeIds.has(String(existing.sourceProductId))) continue;
    items.push({
      ...existing,
      active: false,
      status: "superseded",
      updatedAt: now,
    });
  }

  items.sort((left, right) =>
    String(left.sourceProductId).localeCompare(
      String(right.sourceProductId),
      "en",
      { numeric: true }
    )
  );

  return {
    version: "smokingpipes-new-details-queue-v1",
    source: "smokingpipes",
    createdAt: existingQueue?.createdAt || now,
    updatedAt: now,
    diffGeneratedAt: diff.generatedAt || null,
    items,
    summary: summarizeDetailsQueue({ items }),
  };
}

export function summarizeDetailsQueue(queue) {
  const active = (queue.items || []).filter((item) => item.active !== false);
  const count = (status) =>
    active.filter((item) => item.status === status).length;

  return {
    totalItems: (queue.items || []).length,
    activeItems: active.length,
    pending: count("pending"),
    inProgress: count("in-progress"),
    completed: count("completed"),
    failed: count("failed"),
    superseded: (queue.items || []).filter(
      (item) => item.status === "superseded"
    ).length,
    remaining: active.filter((item) => item.status !== "completed").length,
  };
}

export function evaluateRunnerReadiness({
  inventoryValidation,
  diff,
  queue,
}) {
  const queueSummary = summarizeDetailsQueue(queue);
  const reasons = [];

  if (inventoryValidation?.status !== "passed") {
    reasons.push("inventory validation did not pass");
  }
  if (!diff?.allowApply) reasons.push("inventory diff safety gate did not pass");
  if (!diff?.coverage?.fullExpectedRangeScanned) {
    reasons.push("current list does not cover the full expected page range");
  }
  if (queueSummary.remaining > 0) {
    reasons.push(`${queueSummary.remaining} new details remain incomplete`);
  }

  const inventoryReady =
    inventoryValidation?.status === "passed" &&
    inventoryValidation?.allowApply === true &&
    diff?.allowApply === true &&
    diff?.coverage?.fullExpectedRangeScanned === true;
  const detailsComplete = queueSummary.remaining === 0;
  const allowApply = inventoryReady && detailsComplete;
  let status = "dry-run-ready";

  if (!inventoryReady) status = "blocked";
  else if (!detailsComplete) status = "details-pending";
  else status = "apply-ready";

  return {
    status,
    inventoryReady,
    detailsComplete,
    allowApply,
    reasons,
    queue: queueSummary,
  };
}

export function classifyRunnerError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const captcha = /captcha|verification blocked|manual verification/i.test(
    message
  );
  return {
    status: captcha || error?.code === "LOCK_EXISTS" ? "blocked" : "failed",
    message,
    manualActionRequired: captcha,
    captchaRequired: captcha,
  };
}

export function initialInventoryState() {
  return {
    version: "smokingpipes-inventory-state-v1",
    source: "smokingpipes",
    lastRunAt: null,
    lastSuccessfulFetchAt: null,
    lastSuccessfulApplyAt: null,
    status: "idle",
    lastStep: "idle",
    lastError: null,
    manualActionRequired: false,
    captchaRequired: false,
    currentRunId: null,
    latestReport: null,
  };
}
