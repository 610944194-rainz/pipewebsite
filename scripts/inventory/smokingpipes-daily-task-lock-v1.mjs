import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const DEFAULT_DAILY_TIMEOUT_SECONDS = 3600;
export const DEFAULT_HEARTBEAT_SECONDS = 30;
export const DEFAULT_HEARTBEAT_STALE_MS = 3 * DEFAULT_HEARTBEAT_SECONDS * 1000;
export const DEFAULT_DAILY_TASK_LOCK_PATH = path.join(
  process.cwd(),
  "data",
  "inventory",
  "smokingpipes-daily-task-lock.json"
);

const REQUIRED_FIELDS = [
  "schemaVersion",
  "runId",
  "pid",
  "parentPid",
  "processStartedAt",
  "host",
  "worktree",
  "command",
  "createdAt",
  "heartbeatAt",
  "ownerToken",
];
const DAILY_COMMAND_PATTERN = /run-smokingpipes-(?:progressive-daily|auto-publish|scheduled-task)(?:-v1)?\.ps1/i;

function parseArgs(argv = process.argv.slice(2)) {
  const options = new Map();
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const [key, inline] = value.slice(2).split(/=(.*)/s);
    if (inline !== undefined) {
      options.set(key, inline);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      options.set(key, next);
      index += 1;
    } else {
      options.set(key, true);
    }
  }
  return { options, positional };
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizePath(value) {
  return path.resolve(String(value || "")).replace(/[\\/]+$/, "").toLowerCase();
}

function readLock(lockPath) {
  if (!fs.existsSync(lockPath)) return { exists: false, payload: null, invalidJson: false, stat: null };
  const stat = fs.statSync(lockPath);
  try {
    return { exists: true, payload: JSON.parse(fs.readFileSync(lockPath, "utf8").replace(/^\ufeff/, "")), invalidJson: false, stat };
  } catch {
    return { exists: true, payload: null, invalidJson: true, stat };
  }
}

function defaultProcessInfo(pid) {
  const normalizedPid = Number(pid);
  if (!Number.isInteger(normalizedPid) || normalizedPid <= 0) return null;
  if (process.platform !== "win32") {
    try {
      process.kill(normalizedPid, 0);
      return { exists: true, pid: normalizedPid, parentPid: null, processStartedAt: null, commandLine: null };
    } catch (error) {
      return error?.code === "ESRCH" ? null : { exists: true, pid: normalizedPid, parentPid: null, processStartedAt: null, commandLine: null };
    }
  }
  const command = [
    "$p=Get-CimInstance Win32_Process -Filter 'ProcessId=" + normalizedPid + "' -ErrorAction SilentlyContinue",
    "if($null -eq $p){exit 3}",
    "$started=([datetime]$p.CreationDate).ToUniversalTime().ToString('o')",
    "[ordered]@{exists=$true;pid=[int]$p.ProcessId;parentPid=[int]$p.ParentProcessId;processStartedAt=$started;commandLine=[string]$p.CommandLine}|ConvertTo-Json -Compress",
  ].join(";");
  const result = spawnSync(`${process.env.SystemRoot || "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`, ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  if (result.status === 3) return null;
  if (result.status !== 0 || !result.stdout.trim()) return { exists: null, inspectionError: result.stderr.trim() || `process query exit ${result.status}` };
  try {
    return JSON.parse(result.stdout);
  } catch {
    return { exists: null, inspectionError: "process query returned invalid JSON" };
  }
}

function hasRequiredFields(payload) {
  return REQUIRED_FIELDS.every((field) => payload?.[field] !== undefined && payload?.[field] !== null && payload?.[field] !== "");
}

function inspection({ lockPath, root, nowMs, heartbeatStaleMs, getProcessInfo, commandPattern }) {
  const current = readLock(lockPath);
  const relativePath = path.relative(root, lockPath).replace(/\\/g, "/");
  if (!current.exists) return { exists: false, status: "missing", stale: false, reason: "missing", path: relativePath, pid: null, payload: null };
  const ageMs = Math.max(0, nowMs - current.stat.mtimeMs);
  if (current.invalidJson) return { exists: true, status: "stale", stale: true, reason: "invalid-json", path: relativePath, pid: null, ageMs, payload: null };
  const payload = current.payload;
  if (!hasRequiredFields(payload)) return { exists: true, status: "stale", stale: true, reason: "missing-owner-metadata", path: relativePath, pid: payload?.pid ?? null, ageMs, payload };
  const heartbeatAtMs = Date.parse(payload.heartbeatAt);
  if (!Number.isFinite(heartbeatAtMs) || nowMs - heartbeatAtMs > heartbeatStaleMs) return { exists: true, status: "stale", stale: true, reason: "heartbeat-expired", path: relativePath, pid: payload.pid, ageMs, payload };
  if (normalizePath(payload.worktree) !== normalizePath(root)) return { exists: true, status: "stale", stale: true, reason: "worktree-mismatch", path: relativePath, pid: payload.pid, ageMs, payload };
  if (String(payload.host).toLowerCase() !== os.hostname().toLowerCase()) return { exists: true, status: "stale", stale: true, reason: "host-mismatch", path: relativePath, pid: payload.pid, ageMs, payload };
  if (!commandPattern.test(String(payload.command))) return { exists: true, status: "stale", stale: true, reason: "command-mismatch", path: relativePath, pid: payload.pid, ageMs, payload };
  const processInfo = getProcessInfo(payload.pid);
  if (!processInfo || processInfo.exists === false) return { exists: true, status: "stale", stale: true, reason: "process-not-found", path: relativePath, pid: payload.pid, ageMs, payload };
  if (processInfo.exists !== true) return { exists: true, status: "active", stale: false, reason: "process-inspection-unavailable", path: relativePath, pid: payload.pid, ageMs, payload };
  const expectedStartedAtMs = Date.parse(payload.processStartedAt);
  const actualStartedAtMs = Date.parse(processInfo.processStartedAt);
  if (!Number.isFinite(expectedStartedAtMs) || !Number.isFinite(actualStartedAtMs) || Math.abs(expectedStartedAtMs - actualStartedAtMs) > 5_000) return { exists: true, status: "stale", stale: true, reason: "process-start-time-mismatch", path: relativePath, pid: payload.pid, ageMs, payload };
  if (Number(payload.parentPid) !== Number(processInfo.parentPid)) return { exists: true, status: "stale", stale: true, reason: "parent-pid-mismatch", path: relativePath, pid: payload.pid, ageMs, payload };
  if (!commandPattern.test(String(processInfo.commandLine || ""))) return { exists: true, status: "stale", stale: true, reason: "command-mismatch", path: relativePath, pid: payload.pid, ageMs, payload };
  if (!String(processInfo.commandLine).toLowerCase().includes(normalizePath(root))) return { exists: true, status: "stale", stale: true, reason: "process-worktree-mismatch", path: relativePath, pid: payload.pid, ageMs, payload };
  return { exists: true, status: "active", stale: false, reason: "matching-live-owner", path: relativePath, pid: payload.pid, ageMs, payload, processInfo };
}

export function inspectDailyTaskLock({
  lockPath = DEFAULT_DAILY_TASK_LOCK_PATH,
  root = process.cwd(),
  nowMs = Date.now(),
  heartbeatStaleMs = DEFAULT_HEARTBEAT_STALE_MS,
  getProcessInfo = defaultProcessInfo,
  commandPattern = DAILY_COMMAND_PATTERN,
} = {}) {
  return inspection({ lockPath: path.resolve(lockPath), root: path.resolve(root), nowMs, heartbeatStaleMs, getProcessInfo, commandPattern });
}

export function acquireDailyTaskLock({
  lockPath = DEFAULT_DAILY_TASK_LOCK_PATH,
  root = process.cwd(),
  pid = process.pid,
  parentPid = process.ppid,
  processInfo = defaultProcessInfo(pid),
  command = process.argv.join(" "),
  now = new Date(),
  ownerToken = crypto.randomUUID(),
  runId = `smokingpipes-daily-${crypto.randomUUID()}`,
} = {}) {
  const resolvedPath = path.resolve(lockPath);
  const nowIso = toIso(now);
  const payload = {
    schemaVersion: 1,
    source: "smokingpipes",
    runId,
    pid: Number(pid),
    parentPid: Number(parentPid),
    processStartedAt: toIso(processInfo?.processStartedAt) || nowIso,
    host: os.hostname(),
    worktree: path.resolve(root),
    command: String(command),
    createdAt: nowIso,
    heartbeatAt: nowIso,
    ownerToken: String(ownerToken),
  };
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  let descriptor;
  try {
    descriptor = fs.openSync(resolvedPath, "wx", 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.fsyncSync(descriptor);
    return { acquired: true, lock: payload, path: resolvedPath };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    return { acquired: false, inspection: inspectDailyTaskLock({ lockPath: resolvedPath, root }) };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

export function updateDailyTaskLockHeartbeat({ lockPath = DEFAULT_DAILY_TASK_LOCK_PATH, ownerToken, pid, now = new Date() } = {}) {
  const resolvedPath = path.resolve(lockPath);
  const current = readLock(resolvedPath);
  if (!current.exists || current.invalidJson || current.payload?.ownerToken !== ownerToken || Number(current.payload?.pid) !== Number(pid)) return { updated: false, reason: "ownership-mismatch" };
  const descriptor = fs.openSync(resolvedPath, "r+");
  try {
    const payload = JSON.parse(fs.readFileSync(descriptor, "utf8"));
    if (payload.ownerToken !== ownerToken || Number(payload.pid) !== Number(pid)) return { updated: false, reason: "ownership-mismatch" };
    payload.heartbeatAt = toIso(now);
    const serialized = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.ftruncateSync(descriptor, 0);
    fs.writeSync(descriptor, serialized, 0, serialized.length, 0);
    fs.fsyncSync(descriptor);
    return { updated: true, heartbeatAt: payload.heartbeatAt };
  } finally {
    fs.closeSync(descriptor);
  }
}

export function releaseDailyTaskLock({ lockPath = DEFAULT_DAILY_TASK_LOCK_PATH, ownerToken, pid } = {}) {
  const resolvedPath = path.resolve(lockPath);
  const current = readLock(resolvedPath);
  if (!current.exists) return { released: false, reason: "missing" };
  if (current.invalidJson || current.payload?.ownerToken !== ownerToken || Number(current.payload?.pid) !== Number(pid)) return { released: false, reason: "ownership-mismatch" };
  fs.unlinkSync(resolvedPath);
  return { released: true, reason: "released" };
}

export function recoverStaleDailyTaskLock({
  lockPath = DEFAULT_DAILY_TASK_LOCK_PATH,
  root = process.cwd(),
  archiveDir = path.join(root, "data", "audits", "smokingpipes-daily-lock-archive"),
  ...options
} = {}) {
  const resolvedPath = path.resolve(lockPath);
  const details = inspectDailyTaskLock({ lockPath: resolvedPath, root, ...options });
  if (!details.exists || !details.stale) return { recovered: false, inspection: details, archivePath: null };
  fs.mkdirSync(archiveDir, { recursive: true });
  const stamp = new Date(options.nowMs ?? Date.now()).toISOString().replace(/[:.]/g, "-");
  const archivePath = path.join(archiveDir, `${path.basename(resolvedPath)}.${stamp}.${details.reason}.json`);
  fs.renameSync(resolvedPath, archivePath);
  return { recovered: true, inspection: details, archivePath };
}

export function resolveDailyTimeoutSeconds({ requestedSeconds = 0, environment = process.env } = {}) {
  const raw = Number(requestedSeconds || environment.SMOKINGPIPES_DAILY_TIMEOUT_SECONDS || DEFAULT_DAILY_TIMEOUT_SECONDS);
  if (!Number.isInteger(raw) || raw < 900 || raw > 14_400) throw new Error("SMOKINGPIPES_DAILY_TIMEOUT_SECONDS must be an integer from 900 to 14400");
  return raw;
}

async function heartbeatLoop(options) {
  const intervalSeconds = Number(options.get("interval-seconds") || DEFAULT_HEARTBEAT_SECONDS);
  const lockPath = path.resolve(String(options.get("path") || DEFAULT_DAILY_TASK_LOCK_PATH));
  const ownerToken = String(options.get("owner-token") || "");
  const pid = Number(options.get("pid"));
  if (!ownerToken || !Number.isInteger(pid) || intervalSeconds < 5) throw new Error("heartbeat-loop requires owner-token, pid, and interval-seconds >= 5");
  const beat = () => updateDailyTaskLockHeartbeat({ lockPath, ownerToken, pid });
  while (true) {
    const result = beat();
    if (!result.updated || !defaultProcessInfo(pid)?.exists) return;
    await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
  }
}

export function isDirectCliInvocation({ importMetaUrl = import.meta.url, argv1 = process.argv[1] } = {}) {
  return Boolean(argv1) && importMetaUrl === pathToFileURL(argv1).href;
}

if (isDirectCliInvocation()) {
  const { options, positional } = parseArgs();
  const action = positional[0] || "inspect";
  const lockPath = path.resolve(String(options.get("path") || DEFAULT_DAILY_TASK_LOCK_PATH));
  const root = path.resolve(String(options.get("root") || process.cwd()));
  let output;
  if (action === "acquire") output = acquireDailyTaskLock({ lockPath, root, pid: Number(options.get("pid") || process.ppid), parentPid: Number(options.get("parent-pid") || 0), command: String(options.get("command") || ""), runId: String(options.get("run-id") || `smokingpipes-daily-${crypto.randomUUID()}`), ownerToken: String(options.get("owner-token") || crypto.randomUUID()) });
  else if (action === "heartbeat") output = updateDailyTaskLockHeartbeat({ lockPath, ownerToken: String(options.get("owner-token") || ""), pid: Number(options.get("pid")) });
  else if (action === "release") output = releaseDailyTaskLock({ lockPath, ownerToken: String(options.get("owner-token") || ""), pid: Number(options.get("pid")) });
  else if (action === "recover") output = recoverStaleDailyTaskLock({ lockPath, root, archiveDir: options.has("archive-dir") ? path.resolve(String(options.get("archive-dir"))) : undefined });
  else if (action === "heartbeat-loop") await heartbeatLoop(options);
  else output = inspectDailyTaskLock({ lockPath, root });
  if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
}
