import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const DEFAULT_INVENTORY_LOCK_DEFINITIONS = [
  {
    name: "global",
    path: "data/inventory/state/smokingpipes.lock",
  },
  {
    name: "progressiveDaily",
    path: "data/inventory/state/smokingpipes-progressive-daily.lock",
  },
];

const DEFAULT_STALE_AGE_MS = 4 * 60 * 60 * 1000;
const DEFAULT_NO_PID_STALE_AGE_MS = 30 * 60 * 1000;

function parseArgs(argv = process.argv.slice(2)) {
  const out = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const body = item.slice(2);
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

function defaultProcessAlive(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return null;
  try {
    process.kill(value, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    return null;
  }
}

function publicLockPath(lockPath, root = process.cwd()) {
  const relative = path.relative(root, lockPath).replace(/\\/g, "/");
  return relative && !relative.startsWith("..") ? relative : lockPath;
}

function lockAgeMs({ stat, payload, nowMs }) {
  const createdAtMs = Date.parse(payload?.createdAt || payload?.startedAt || "");
  const baseMs = Number.isFinite(createdAtMs) ? createdAtMs : stat.mtimeMs;
  return Math.max(0, nowMs - baseMs);
}

function resolveLockDefinitions({ root, lockDefinitions }) {
  return lockDefinitions.map((definition) => {
    const lockPath = path.isAbsolute(definition.path)
      ? definition.path
      : path.join(root, definition.path);
    return {
      name: definition.name,
      path: lockPath,
    };
  });
}

export function inspectInventoryLock({
  name,
  lockPath,
  nowMs = Date.now(),
  staleAgeMs = DEFAULT_STALE_AGE_MS,
  noPidStaleAgeMs = DEFAULT_NO_PID_STALE_AGE_MS,
  isProcessAlive = defaultProcessAlive,
  root = process.cwd(),
} = {}) {
  const resolvedLockPath = path.resolve(lockPath);
  const publicPath = publicLockPath(resolvedLockPath, root);

  if (!fs.existsSync(resolvedLockPath)) {
    return {
      name,
      path: publicPath,
      exists: false,
      status: "missing",
      stale: false,
      pid: null,
      processAlive: null,
      ageMs: 0,
      reason: "missing",
    };
  }

  const stat = fs.statSync(resolvedLockPath);
  let payload = null;
  let invalidJson = false;

  try {
    payload = JSON.parse(fs.readFileSync(resolvedLockPath, "utf8"));
  } catch {
    invalidJson = true;
  }

  const ageMs = Math.round(lockAgeMs({ stat, payload, nowMs }));
  const pid = payload?.pid ?? null;
  const processAlive = pid ? isProcessAlive(pid) : null;

  if (invalidJson) {
    const stale = ageMs > staleAgeMs;
    return {
      name,
      path: publicPath,
      exists: true,
      status: stale ? "stale" : "active",
      stale,
      pid: null,
      processAlive: null,
      ageMs,
      reason: stale ? "invalid-json-old" : "fresh-invalid-json",
    };
  }

  if (pid && processAlive === false) {
    return {
      name,
      path: publicPath,
      exists: true,
      status: "stale",
      stale: true,
      pid,
      processAlive,
      ageMs,
      reason: "process-not-found",
    };
  }

  if (ageMs > staleAgeMs) {
    return {
      name,
      path: publicPath,
      exists: true,
      status: "stale",
      stale: true,
      pid,
      processAlive,
      ageMs,
      reason: "stale-age",
    };
  }

  if (!pid && ageMs > noPidStaleAgeMs) {
    return {
      name,
      path: publicPath,
      exists: true,
      status: "stale",
      stale: true,
      pid,
      processAlive,
      ageMs,
      reason: "stale-age",
    };
  }

  return {
    name,
    path: publicPath,
    exists: true,
    status: "active",
    stale: false,
    pid,
    processAlive,
    ageMs,
    reason: pid ? "active-pid" : "fresh-no-pid",
  };
}

function summarizeLocks(locks, clearedLocks = []) {
  const activeLocks = locks.filter((lock) => lock.status === "active");
  return {
    locks,
    hasActiveLock: activeLocks.length > 0,
    clearedLocks,
    activeLocks,
  };
}

export function inspectInventoryLocks({
  root = process.cwd(),
  lockDefinitions = DEFAULT_INVENTORY_LOCK_DEFINITIONS,
  nowMs = Date.now(),
  staleAgeMs = DEFAULT_STALE_AGE_MS,
  noPidStaleAgeMs = DEFAULT_NO_PID_STALE_AGE_MS,
  isProcessAlive = defaultProcessAlive,
} = {}) {
  const locks = resolveLockDefinitions({ root, lockDefinitions }).map((definition) =>
    inspectInventoryLock({
      name: definition.name,
      lockPath: definition.path,
      nowMs,
      staleAgeMs,
      noPidStaleAgeMs,
      isProcessAlive,
      root,
    })
  );
  return summarizeLocks(locks);
}

export function clearStaleInventoryLocks(options = {}) {
  const {
    root = process.cwd(),
    lockDefinitions = DEFAULT_INVENTORY_LOCK_DEFINITIONS,
    nowMs = Date.now(),
    staleAgeMs = DEFAULT_STALE_AGE_MS,
    noPidStaleAgeMs = DEFAULT_NO_PID_STALE_AGE_MS,
    isProcessAlive = defaultProcessAlive,
  } = options;
  const resolvedDefinitions = resolveLockDefinitions({ root, lockDefinitions });
  const inspections = resolvedDefinitions.map((definition) =>
    inspectInventoryLock({
      name: definition.name,
      lockPath: definition.path,
      nowMs,
      staleAgeMs,
      noPidStaleAgeMs,
      isProcessAlive,
      root,
    })
  );
  const clearedLocks = [];

  for (const inspection of inspections) {
    if (!inspection.exists || inspection.status !== "stale") continue;
    const definition = resolvedDefinitions.find(
      (item) => item.name === inspection.name
    );
    fs.unlinkSync(definition.path);
    clearedLocks.push({
      ...inspection,
      status: "cleared",
      cleared: true,
    });
  }

  const locks = resolvedDefinitions.map((definition) => {
    const cleared = clearedLocks.find((item) => item.name === definition.name);
    if (cleared) return cleared;
    return inspectInventoryLock({
      name: definition.name,
      lockPath: definition.path,
      nowMs,
      staleAgeMs,
      noPidStaleAgeMs,
      isProcessAlive,
      root,
    });
  });

  return summarizeLocks(locks, clearedLocks);
}

export function isDirectCliInvocation({
  importMetaUrl = import.meta.url,
  argv1 = process.argv[1],
} = {}) {
  return Boolean(argv1) && importMetaUrl === pathToFileURL(argv1).href;
}

if (isDirectCliInvocation()) {
  const args = parseArgs();
  const payload = args.has("clear-stale")
    ? clearStaleInventoryLocks()
    : inspectInventoryLocks();
  console.log(JSON.stringify(payload, null, 2));
}
