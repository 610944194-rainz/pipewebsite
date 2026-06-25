import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const DEFAULT_PROGRESSIVE_LOCK_PATH = path.join(
  process.cwd(),
  "data",
  "inventory",
  "state",
  "smokingpipes-progressive-daily.lock"
);

const DEFAULT_STALE_AGE_MS = 4 * 60 * 60 * 1000;
const DEFAULT_NO_PID_STALE_AGE_MS = 2 * 60 * 60 * 1000;

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

function lockAgeMs({ stat, payload, nowMs }) {
  const createdAtMs = Date.parse(payload?.createdAt || payload?.startedAt || "");
  const baseMs = Number.isFinite(createdAtMs) ? createdAtMs : stat.mtimeMs;
  return Math.max(0, nowMs - baseMs);
}

function publicLockPath(lockPath, root = process.cwd()) {
  const relative = path.relative(root, lockPath).replace(/\\/g, "/");
  return relative && !relative.startsWith("..") ? relative : lockPath;
}

export function inspectProgressiveLock({
  lockPath = DEFAULT_PROGRESSIVE_LOCK_PATH,
  nowMs = Date.now(),
  staleAgeMs = DEFAULT_STALE_AGE_MS,
  noPidStaleAgeMs = DEFAULT_NO_PID_STALE_AGE_MS,
  isProcessAlive = defaultProcessAlive,
  root = process.cwd(),
} = {}) {
  const resolvedLockPath = path.resolve(lockPath);
  if (!fs.existsSync(resolvedLockPath)) {
    return {
      exists: false,
      path: publicLockPath(resolvedLockPath, root),
      ageMs: 0,
      stale: false,
      pid: null,
      processAlive: null,
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
    return {
      exists: true,
      path: publicLockPath(resolvedLockPath, root),
      ageMs,
      stale: ageMs > staleAgeMs,
      pid: null,
      processAlive: null,
      reason: ageMs > staleAgeMs ? "invalid-json" : "active",
    };
  }

  if (pid && processAlive === false) {
    return {
      exists: true,
      path: publicLockPath(resolvedLockPath, root),
      ageMs,
      stale: true,
      pid,
      processAlive,
      reason: "process-not-found",
    };
  }

  if (ageMs > staleAgeMs) {
    return {
      exists: true,
      path: publicLockPath(resolvedLockPath, root),
      ageMs,
      stale: true,
      pid,
      processAlive,
      reason: "stale-age",
    };
  }

  if (!pid && ageMs > noPidStaleAgeMs) {
    return {
      exists: true,
      path: publicLockPath(resolvedLockPath, root),
      ageMs,
      stale: true,
      pid,
      processAlive,
      reason: "stale-age",
    };
  }

  return {
    exists: true,
    path: publicLockPath(resolvedLockPath, root),
    ageMs,
    stale: false,
    pid,
    processAlive,
    reason: "active",
  };
}

export function clearStaleProgressiveLock(options = {}) {
  const lockPath = path.resolve(
    options.lockPath || DEFAULT_PROGRESSIVE_LOCK_PATH
  );
  const inspection = inspectProgressiveLock({
    ...options,
    lockPath,
  });

  if (!inspection.exists) {
    return {
      cleared: false,
      inspection,
      reason: "missing",
    };
  }

  if (!inspection.stale) {
    return {
      cleared: false,
      inspection,
      reason: "active",
    };
  }

  fs.unlinkSync(lockPath);
  return {
    cleared: true,
    inspection,
    reason: inspection.reason,
  };
}

export function isDirectCliInvocation({
  importMetaUrl = import.meta.url,
  argv1 = process.argv[1],
} = {}) {
  return Boolean(argv1) && importMetaUrl === pathToFileURL(argv1).href;
}

if (isDirectCliInvocation()) {
  const args = parseArgs();
  const lockPath = args.has("path")
    ? path.resolve(String(args.get("path") || ""))
    : DEFAULT_PROGRESSIVE_LOCK_PATH;
  const payload = args.has("clear-stale")
    ? clearStaleProgressiveLock({ lockPath })
    : inspectProgressiveLock({ lockPath });
  console.log(JSON.stringify(payload, null, 2));
}
