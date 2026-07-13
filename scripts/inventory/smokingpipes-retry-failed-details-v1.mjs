import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getRunnerPaths,
  readJsonIfExists,
  writeJsonAtomic,
} from "./inventory-runner-core-v1.mjs";
import {
  buildProgressiveStateSummary,
} from "./smokingpipes-progressive-daily-v1.mjs";
import {
  validateProgressiveDailyState,
} from "./smokingpipes-progressive-state-v1.mjs";

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function countDetailStatuses(state) {
  const candidates = Array.isArray(state?.candidates)
    ? state.candidates
    : [];
  const count = (status) =>
    candidates.filter((candidate) => candidate.detailStatus === status)
      .length;
  return {
    complete: count("complete"),
    failed: count("failed"),
    pending: count("pending"),
    blocked: count("blocked"),
    excluded: count("excluded"),
    excludedListNotPublic: count("excluded-list-not-public"),
    total: candidates.length,
  };
}

export function parseFailedDetailRetryOptions(argv = []) {
  const values = new Map();
  const flags = new Set();
  for (const rawArg of argv) {
    const arg = String(rawArg || "");
    if (!arg.startsWith("--")) continue;
    const [name, ...rest] = arg.slice(2).split("=");
    if (rest.length) values.set(name, rest.join("="));
    else flags.add(name);
  }
  const ids = String(values.get("source-product-ids") || "")
    .split(",")
    .map(text)
    .filter(Boolean);
  return {
    source: text(values.get("source")),
    sourceProductIds: [...new Set(ids)],
    write: flags.has("write"),
    help: flags.has("help") || flags.has("h"),
  };
}

function assertRetryInputs({ state, taskState, sourceProductIds }) {
  const validation = validateProgressiveDailyState(state);
  if (!validation.valid) {
    throw new Error(
      `progressive state is invalid: ${validation.errors.join("; ")}`
    );
  }
  if (state.productionWritten !== false) {
    throw new Error("progressive state productionWritten must be false");
  }
  if (!taskState || typeof taskState !== "object") {
    throw new Error("daily task state is required");
  }
  if (taskState.productionWritten === true) {
    throw new Error("daily task state productionWritten must be false");
  }
  const cachedListResume = taskState.cachedListResume;
  if (
    !cachedListResume ||
    cachedListResume.lockedUntilComplete !== true ||
    cachedListResume.completed === true ||
    cachedListResume.allowNextListFetch !== false
  ) {
    throw new Error(
      "cached List must be locked until detail recovery is complete"
    );
  }
  if (!sourceProductIds.length) {
    throw new Error("--source-product-ids requires at least one ID");
  }
}

export function planFailedSmokingpipesDetailRetry({
  state,
  taskState,
  sourceProductIds,
  now = new Date().toISOString(),
}) {
  const ids = [...new Set((sourceProductIds || []).map(text).filter(Boolean))];
  assertRetryInputs({ state, taskState, sourceProductIds: ids });
  const byId = new Map(
    state.candidates.map((candidate) => [text(candidate.sourceProductId), candidate])
  );
  const unknownIds = ids.filter((id) => !byId.has(id));
  if (unknownIds.length) {
    throw new Error(`unknown sourceProductId: ${unknownIds.join(", ")}`);
  }
  const nonFailedIds = ids.filter(
    (id) => byId.get(id).detailStatus !== "failed"
  );
  if (nonFailedIds.length) {
    throw new Error(
      `only detailStatus=failed candidates may be retried: ${nonFailedIds.join(", ")}`
    );
  }

  const nextState = structuredClone(state);
  const before = countDetailStatuses(state);
  for (const candidate of nextState.candidates) {
    const id = text(candidate.sourceProductId);
    if (!ids.includes(id)) continue;
    candidate.retryHistory = [
      ...(Array.isArray(candidate.retryHistory) ? candidate.retryHistory : []),
      {
        retriedAt: now,
        reason: "safe-failed-detail-retry",
        previousDetailStatus: candidate.detailStatus,
        previousDetailAttempts: candidate.detailAttempts,
        previousLastError: candidate.lastError || null,
      },
    ];
    candidate.detailStatus = "pending";
    candidate.queueDisposition = "eligible-this-batch";
    candidate.retryCount = Number(candidate.retryCount || 0) + 1;
    candidate.lastRetryAt = now;
    candidate.nextEligibleAt = null;
  }
  nextState.updatedAt = now;
  nextState.summary = buildProgressiveStateSummary(nextState, now);
  nextState.failedDetailRetry = {
    performedAt: now,
    sourceProductIds: ids,
    mode: "safe-failed-detail-retry",
    productionWritten: false,
  };
  nextState.productionWritten = false;

  const nextTaskState = structuredClone(taskState);
  nextTaskState.status = "detail-progress";
  nextTaskState.productionWritten = false;
  nextTaskState.detailPhaseStatus = "detail-progress";
  nextTaskState.detailPendingCount = nextState.summary.pending;
  nextTaskState.detailPending = nextState.summary.pending;
  nextTaskState.detailCompletedThisRun = 0;
  nextTaskState.updatedAt = now;
  nextTaskState.failedDetailRetry = {
    performedAt: now,
    sourceProductIds: ids,
    previousFailures: ids.map((id) => ({
      sourceProductId: id,
      lastError: byId.get(id).lastError || null,
      detailAttempts: byId.get(id).detailAttempts,
    })),
  };

  return {
    state: nextState,
    taskState: nextTaskState,
    report: {
      status: "planned",
      source: "smokingpipes",
      sourceProductIds: ids,
      before,
      after: countDetailStatuses(nextState),
      remainingPendingCount: nextState.summary.pending,
      productionWritten: false,
      cachedListLocked: true,
    },
  };
}

function assertNoActiveRetryLocks(paths, dailyTaskLockPath) {
  const activeLocks = [paths.lock, paths.progressiveLock, dailyTaskLockPath]
    .filter((filePath) => fs.existsSync(filePath));
  if (activeLocks.length) {
    throw new Error(`active inventory lock: ${activeLocks.join(", ")}`);
  }
}

export async function runFailedSmokingpipesDetailRetry({
  root = process.cwd(),
  source,
  sourceProductIds,
  write = false,
  now = new Date().toISOString(),
}) {
  if (source !== "smokingpipes") {
    throw new Error("--source=smokingpipes is required");
  }
  const paths = getRunnerPaths(root, { mock: false });
  const dailyTaskStatePath = path.join(
    root,
    "data",
    "inventory",
    "smokingpipes-daily-task-state.json"
  );
  const dailyTaskLockPath = path.join(
    root,
    "data",
    "inventory",
    "smokingpipes-daily-task-lock.json"
  );
  const state = readJsonIfExists(paths.progressiveState, null);
  const taskState = readJsonIfExists(dailyTaskStatePath, null);
  const planned = planFailedSmokingpipesDetailRetry({
    state,
    taskState,
    sourceProductIds,
    now,
  });
  if (!write) {
    return {
      ...planned.report,
      status: "dry-run",
      wrote: false,
      statePath: paths.progressiveState,
      dailyTaskStatePath,
    };
  }
  assertNoActiveRetryLocks(paths, dailyTaskLockPath);
  await writeJsonAtomic(paths.progressiveState, planned.state);
  await writeJsonAtomic(dailyTaskStatePath, planned.taskState);
  return {
    ...planned.report,
    status: "recovered",
    wrote: true,
    statePath: paths.progressiveState,
    dailyTaskStatePath,
  };
}

function usage() {
  return [
    "Usage:",
    "  node scripts/inventory/smokingpipes-retry-failed-details-v1.mjs --source=smokingpipes --source-product-ids=715858,715884",
    "",
    "Default is dry-run. Add --write only after reviewing the planned IDs and counts.",
  ].join("\n");
}

async function main() {
  const options = parseFailedDetailRetryOptions(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const result = await runFailedSmokingpipesDetailRetry(options);
  console.log(JSON.stringify(result, null, 2));
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
