import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SMOKINGPIPES_CYCLE_SCHEMA_V2 = "smokingpipes-cycle-v2";
export const SMOKINGPIPES_STATE_SCHEMA_V2 = "smokingpipes-state-v2";

export const CYCLE_PHASES = new Set([
  "new",
  "collecting-list",
  "list-ready",
  "enriching-details",
  "ready-to-bundle",
  "bundle-ready",
  "validating-release",
  "published",
  "no-change",
  "collection-retryable",
  "release-retryable",
  "manual-review-required",
]);

const TERMINAL_PHASES = new Set(["published", "no-change"]);
const RESUMABLE_PHASES = new Set([
  "collecting-list",
  "collection-retryable",
  "list-ready",
  "enriching-details",
  "ready-to-bundle",
  "bundle-ready",
  "validating-release",
  "release-retryable",
]);
const TRANSITIONS = new Map([
  ["new", new Set(["collecting-list", "manual-review-required"])],
  ["collecting-list", new Set(["list-ready", "collection-retryable", "manual-review-required"])],
  ["collection-retryable", new Set(["collecting-list", "list-ready", "manual-review-required"])],
  ["list-ready", new Set(["enriching-details", "ready-to-bundle", "manual-review-required"])],
  ["enriching-details", new Set(["enriching-details", "ready-to-bundle", "collection-retryable", "manual-review-required"])],
  ["ready-to-bundle", new Set(["bundle-ready", "no-change", "release-retryable", "manual-review-required"])],
  ["bundle-ready", new Set(["validating-release", "release-retryable", "manual-review-required"])],
  ["validating-release", new Set(["published", "release-retryable", "manual-review-required"])],
  ["release-retryable", new Set(["validating-release", "bundle-ready", "manual-review-required"])],
  ["published", new Set()],
  ["no-change", new Set()],
  ["manual-review-required", new Set()],
]);

function requiredText(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function normalizedPath(value) {
  return path.resolve(String(value || "")).replace(/\\/g, "/").toLowerCase();
}

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function assertExternalStateRoot({ stateRoot, worktreeRoot } = {}) {
  const resolved = path.resolve(requiredText(stateRoot, "StateRoot"));
  if (worktreeRoot && isInside(resolved, path.resolve(worktreeRoot))) {
    throw new Error("StateRoot must be outside the Git worktree");
  }
  if (/\/.git(?:\/|$)/i.test(normalizedPath(resolved))) {
    throw new Error("StateRoot must not be Git metadata");
  }
  return resolved;
}

export function cycleIdForDate(value = new Date()) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error("cycle date is invalid");
  return date.toISOString().slice(0, 10);
}

export function cycleDirectory(stateRoot, cycleId) {
  return path.join(stateRoot, "cycles", requiredText(cycleId, "cycleId"));
}

export function cyclePath(stateRoot, cycleId) {
  return path.join(cycleDirectory(stateRoot, cycleId), "cycle.json");
}

export function cyclePaths(stateRoot, cycleId) {
  const root = cycleDirectory(stateRoot, cycleId);
  return {
    root,
    cycle: path.join(root, "cycle.json"),
    legacyProgressiveState: path.join(root, "progressive-state-v1.json"),
    listSnapshot: path.join(root, "list", "snapshot.json"),
    listManifest: path.join(root, "list", "manifest.json"),
    inventoryDiff: path.join(root, "list", "diff.json"),
    detailQueue: path.join(root, "queues", "details.json"),
    bundleRoot: path.join(root, "bundles"),
    logs: path.join(root, "logs"),
  };
}

export function hashText(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

export function hashJson(value) {
  return hashText(JSON.stringify(value));
}

export async function hashFile(filePath) {
  const contents = await fs.promises.readFile(filePath);
  return crypto.createHash("sha256").update(contents).digest("hex");
}

export async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.promises.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw new Error(`unable to read JSON ${filePath}: ${error.message}`);
  }
}

export async function writeJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  await fs.promises.mkdir(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`
  );
  await fs.promises.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    await fs.promises.rename(temporary, filePath);
  } catch (error) {
    await fs.promises.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export function createCycle({ cycleId = cycleIdForDate(), now = new Date().toISOString() } = {}) {
  return {
    schemaVersion: SMOKINGPIPES_CYCLE_SCHEMA_V2,
    source: "smokingpipes",
    cycleId,
    phase: "new",
    createdAt: now,
    updatedAt: now,
    attempts: {
      list: 0,
      details: 0,
      release: 0,
    },
    collection: {
      trustedSnapshot: null,
      pendingDetailIds: [],
      completedDetailIds: [],
      quarantinedDetailIds: [],
      observedCandidateCount: 0,
    },
    bundle: null,
    release: null,
    failure: null,
    history: [{ at: now, phase: "new", reason: "cycle-created" }],
  };
}

export function validateCycle(cycle) {
  const errors = [];
  if (!cycle || typeof cycle !== "object" || Array.isArray(cycle)) {
    return { valid: false, errors: ["cycle must be an object"] };
  }
  if (cycle.schemaVersion !== SMOKINGPIPES_CYCLE_SCHEMA_V2) {
    errors.push("unsupported cycle schemaVersion");
  }
  if (cycle.source !== "smokingpipes") errors.push("cycle source must be smokingpipes");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(cycle.cycleId || ""))) {
    errors.push("cycleId must be YYYY-MM-DD");
  }
  if (!CYCLE_PHASES.has(cycle.phase)) errors.push("cycle phase is invalid");
  for (const field of ["createdAt", "updatedAt"]) {
    if (!Number.isFinite(Date.parse(cycle[field] || ""))) {
      errors.push(`cycle ${field} is invalid`);
    }
  }
  if (!cycle.attempts || typeof cycle.attempts !== "object") {
    errors.push("cycle attempts are invalid");
  }
  if (!cycle.collection || typeof cycle.collection !== "object") {
    errors.push("cycle collection is invalid");
  }
  if (!Array.isArray(cycle.history)) errors.push("cycle history is invalid");
  return { valid: errors.length === 0, errors };
}

export async function writeCycle(stateRoot, cycle) {
  const validation = validateCycle(cycle);
  if (!validation.valid) {
    throw new Error(`cycle validation failed: ${validation.errors.join("; ")}`);
  }
  await writeJsonAtomic(cyclePath(stateRoot, cycle.cycleId), cycle);
  await writeJsonAtomic(path.join(stateRoot, "latest.json"), {
    schemaVersion: SMOKINGPIPES_STATE_SCHEMA_V2,
    cycleId: cycle.cycleId,
    phase: cycle.phase,
    updatedAt: cycle.updatedAt,
  });
  return cycle;
}

export async function readCycle(stateRoot, cycleId) {
  const cycle = await readJson(cyclePath(stateRoot, cycleId), null);
  if (!cycle) return null;
  const validation = validateCycle(cycle);
  if (!validation.valid) {
    throw new Error(`cycle validation failed: ${validation.errors.join("; ")}`);
  }
  return cycle;
}

/**
 * Resolve the one cycle a normal Daily invocation is allowed to operate on.
 * latest.json is deliberately the only historical entrypoint: scanning old
 * cycles would turn a damaged state pointer into an unsafe implicit resume.
 */
export async function resolveActiveSmokingpipesCycle({
  stateRoot,
  cycleId = null,
  now = new Date(),
} = {}) {
  const explicitCycleId = String(cycleId || "").trim();
  if (explicitCycleId) {
    return { cycleId: explicitCycleId, source: "explicit", cycle: await readCycle(stateRoot, explicitCycleId) };
  }

  const latestPath = path.join(stateRoot, "latest.json");
  const latest = await readJson(latestPath, null);
  if (!latest) {
    return { cycleId: cycleIdForDate(now), source: "current-date", cycle: null };
  }
  const latestCycleId = String(latest?.cycleId || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(latestCycleId)) {
    throw new Error("latest.json is invalid: cycleId must be YYYY-MM-DD");
  }
  const cycle = await readCycle(stateRoot, latestCycleId);
  if (!cycle) {
    throw new Error(`latest.json points to a missing cycle: ${latestCycleId}`);
  }
  if (latest.phase && latest.phase !== cycle.phase) {
    throw new Error(`latest.json phase does not match cycle ${latestCycleId}`);
  }
  if (cycle.phase === "manual-review-required") {
    return { cycleId: latestCycleId, source: "latest", cycle, status: "manual-review-required" };
  }
  if (RESUMABLE_PHASES.has(cycle.phase)) {
    return { cycleId: latestCycleId, source: "latest", cycle };
  }
  if (TERMINAL_PHASES.has(cycle.phase)) {
    return { cycleId: cycleIdForDate(now), source: "current-date", cycle: null };
  }
  throw new Error(`latest cycle has an unsupported phase: ${cycle.phase}`);
}

export async function loadOrCreateCycle({ stateRoot, cycleId = cycleIdForDate(), now } = {}) {
  const existing = await readCycle(stateRoot, cycleId);
  if (existing) return { cycle: existing, created: false };
  const cycle = createCycle({ cycleId, now });
  await writeCycle(stateRoot, cycle);
  return { cycle, created: true };
}

export async function transitionCycle({
  stateRoot,
  cycle,
  phase,
  reason,
  patch = {},
  now = new Date().toISOString(),
} = {}) {
  const nextPhase = requiredText(phase, "phase");
  if (!CYCLE_PHASES.has(nextPhase)) throw new Error(`unsupported cycle phase: ${nextPhase}`);
  if (cycle.phase !== nextPhase && !TRANSITIONS.get(cycle.phase)?.has(nextPhase)) {
    throw new Error(`illegal cycle transition: ${cycle.phase} -> ${nextPhase}`);
  }
  const next = {
    ...cycle,
    ...patch,
    phase: nextPhase,
    updatedAt: now,
    failure: patch.failure === undefined && !nextPhase.endsWith("retryable") ? null : patch.failure,
    history: [
      ...(cycle.history || []),
      { at: now, phase: nextPhase, reason: String(reason || "state-update") },
    ],
  };
  await writeCycle(stateRoot, next);
  return next;
}

export function isTerminalCycle(cycle) {
  return TERMINAL_PHASES.has(cycle?.phase);
}

export function stateLockPath(stateRoot) {
  return path.join(stateRoot, "locks", "daily.lock");
}

export async function acquireOwnerTokenLock({
  stateRoot,
  ownerToken = crypto.randomUUID(),
  command = "smokingpipes-v2",
  staleAfterMs = 4 * 60 * 60 * 1000,
  now = new Date().toISOString(),
} = {}) {
  const lockPath = stateLockPath(stateRoot);
  await fs.promises.mkdir(path.dirname(lockPath), { recursive: true });
  const payload = {
    schemaVersion: SMOKINGPIPES_STATE_SCHEMA_V2,
    ownerToken,
    pid: process.pid,
    hostname: os.hostname(),
    command,
    acquiredAt: now,
    heartbeatAt: now,
  };
  try {
    const handle = await fs.promises.open(lockPath, "wx");
    try {
      await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
    } finally {
      await handle.close();
    }
    return { acquired: true, lockPath, ownerToken, payload };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await readJson(lockPath, null);
    const heartbeatMs = Date.parse(existing?.heartbeatAt || "");
    const stale =
      Number.isFinite(heartbeatMs) &&
      Date.now() - heartbeatMs > Math.max(1, Number(staleAfterMs) || 0);
    return {
      acquired: false,
      status: stale ? "stale-lock-requires-manual-recovery" : "already-running",
      lockPath,
      existing,
    };
  }
}

export async function heartbeatOwnerTokenLock({ stateRoot, ownerToken, now = new Date().toISOString() } = {}) {
  const lockPath = stateLockPath(stateRoot);
  const lock = await readJson(lockPath, null);
  if (!lock || lock.ownerToken !== ownerToken) {
    throw new Error("owner-token lock is not held by this process");
  }
  lock.heartbeatAt = now;
  await writeJsonAtomic(lockPath, lock);
  return lock;
}

export async function releaseOwnerTokenLock({ stateRoot, ownerToken } = {}) {
  const lockPath = stateLockPath(stateRoot);
  const lock = await readJson(lockPath, null);
  if (!lock) return { released: false, reason: "missing" };
  if (lock.ownerToken !== ownerToken) {
    return { released: false, reason: "owner-token-mismatch" };
  }
  await fs.promises.rm(lockPath, { force: true });
  return { released: true };
}

async function appendLedger(filePath, entry, key) {
  const existing = await readJson(filePath, {
    schemaVersion: SMOKINGPIPES_STATE_SCHEMA_V2,
    entries: [],
  });
  const entries = Array.isArray(existing.entries) ? existing.entries : [];
  const index = entries.findIndex((item) => item?.[key] === entry?.[key]);
  const nextEntries = index >= 0
    ? entries.map((item, itemIndex) => (itemIndex === index ? entry : item))
    : [...entries, entry];
  const next = {
    schemaVersion: SMOKINGPIPES_STATE_SCHEMA_V2,
    entries: nextEntries,
    updatedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(filePath, next);
  return next;
}

export async function recordPublishedBundle({ stateRoot, bundleId, cycleId, commitSha = null, now = new Date().toISOString() } = {}) {
  return appendLedger(
    path.join(stateRoot, "ledger", "published-bundles.json"),
    { bundleId: requiredText(bundleId, "bundleId"), cycleId, commitSha, publishedAt: now },
    "bundleId"
  );
}

export async function findPublishedBundle(stateRoot, bundleId) {
  const ledger = await readJson(path.join(stateRoot, "ledger", "published-bundles.json"), { entries: [] });
  return (ledger.entries || []).find((entry) => entry.bundleId === bundleId) || null;
}

export async function recordQuarantinedProduct({
  stateRoot,
  sourceProductId,
  reason,
  cycleId,
  now = new Date().toISOString(),
} = {}) {
  return appendLedger(
    path.join(stateRoot, "ledger", "quarantined-products.json"),
    {
      sourceProductId: requiredText(sourceProductId, "sourceProductId"),
      reason: String(reason || "unspecified"),
      cycleId,
      updatedAt: now,
    },
    "sourceProductId"
  );
}

export async function cleanupRetention({
  stateRoot,
  keepDays = 14,
  keepPublishedBundles = 10,
  now = Date.now(),
} = {}) {
  const cyclesRoot = path.join(stateRoot, "cycles");
  const names = await fs.promises.readdir(cyclesRoot).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  const removedCycles = [];
  for (const name of names) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) continue;
    const cycle = await readCycle(stateRoot, name);
    const ageMs = now - Date.parse(`${name}T00:00:00.000Z`);
    if (isTerminalCycle(cycle) && ageMs > keepDays * 24 * 60 * 60 * 1000) {
      await fs.promises.rm(cycleDirectory(stateRoot, name), { recursive: true, force: true });
      removedCycles.push(name);
    }
  }
  const ledgerPath = path.join(stateRoot, "ledger", "published-bundles.json");
  const ledger = await readJson(ledgerPath, null);
  if (ledger?.entries?.length > keepPublishedBundles) {
    ledger.entries = ledger.entries
      .sort((left, right) => String(right.publishedAt).localeCompare(String(left.publishedAt)))
      .slice(0, keepPublishedBundles);
    await writeJsonAtomic(ledgerPath, ledger);
  }
  return { removedCycles };
}

async function main() {
  const options = new Map(
    process.argv.slice(2).map((argument) => {
      const [key, ...parts] = argument.replace(/^--/, "").split("=");
      return [key, parts.join("=") || true];
    })
  );
  const stateRoot = options.get("state-root");
  if (!stateRoot) throw new Error("--state-root is required");
  if (options.has("status")) {
    const latest = await readJson(path.join(stateRoot, "latest.json"), null);
    const cycle = latest?.cycleId ? await readCycle(stateRoot, latest.cycleId) : null;
    console.log(JSON.stringify({ stateRoot: path.resolve(stateRoot), latest, cycle }, null, 2));
    return;
  }
  throw new Error("supported command: --state-root=<path> --status");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"))) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
