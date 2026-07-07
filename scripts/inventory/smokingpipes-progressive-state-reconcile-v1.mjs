#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  getRunnerPaths,
  writeJsonAtomic,
} from "./inventory-runner-core-v1.mjs";
import {
  readProgressiveDailyState,
} from "./smokingpipes-progressive-state-v1.mjs";

const ARCHIVE_REASON =
  "manual-reconcile state archived to unblock daily automation";

function text(value) {
  return String(value ?? "").trim();
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    root: process.cwd(),
    dryRun: true,
    archive: false,
    write: false,
    statePath: null,
  };
  for (const arg of argv) {
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--archive") {
      options.archive = true;
      options.dryRun = false;
    } else if (arg === "--write") {
      options.write = true;
      options.dryRun = false;
    } else if (arg.startsWith("--root=")) {
      options.root = path.resolve(arg.slice("--root=".length));
    } else if (arg.startsWith("--state-path=")) {
      options.statePath = path.resolve(arg.slice("--state-path=".length));
    } else {
      throw new Error(`Unsupported argument: ${arg}`);
    }
  }
  if (!options.archive) {
    options.dryRun = true;
  }
  return options;
}

function countBy(items, fieldName) {
  const counts = {};
  for (const item of items || []) {
    const value = text(item?.[fieldName]) || "missing";
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function reasonKey(candidate) {
  const values = [
    candidate?.reviewReason,
    candidate?.publicReviewReason,
    candidate?.blockedReason,
    candidate?.lastBlockedReason,
    candidate?.lastError,
    candidate?.reason,
  ];
  for (const value of values) {
    if (text(value)) return text(value);
  }
  if (Array.isArray(candidate?.reviewReasons) && candidate.reviewReasons.length) {
    return candidate.reviewReasons.map(text).filter(Boolean).join("; ");
  }
  if (Array.isArray(candidate?.reasons) && candidate.reasons.length) {
    return candidate.reasons.map(text).filter(Boolean).join("; ");
  }
  return "missing";
}

function countByReason(candidates = []) {
  const counts = {};
  for (const candidate of candidates) {
    const key = reasonKey(candidate);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function formatTimestamp(date = new Date()) {
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

export function summarizeProgressiveState(state) {
  const candidates = Array.isArray(state?.candidates)
    ? state.candidates
    : [];
  const byDetailStatus = countBy(candidates, "detailStatus");
  const byPublicStatus = countBy(candidates, "publicStatus");
  const byReason = countByReason(candidates);
  return {
    stateDailyRunId: text(state?.dailyRunId) || null,
    stateIsManualReconcile: /^manual-reconcile/i.test(
      text(state?.dailyRunId)
    ),
    createdAt: state?.createdAt || null,
    updatedAt: state?.updatedAt || null,
    totalCandidates: candidates.length,
    byReason,
    byDetailStatus,
    byPublicStatus,
    readyCount: byPublicStatus.ready || 0,
    reviewOnlyCount: byPublicStatus["review-only"] || 0,
    notPublicCount: byPublicStatus["not-public"] || 0,
  };
}

function relativeOrAbsolute(root, targetPath) {
  const relative = path.relative(root, targetPath);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.replaceAll(path.sep, "/");
  }
  return targetPath;
}

export async function reconcileProgressiveState({
  root = process.cwd(),
  statePath = null,
  dryRun = undefined,
  archive = false,
  now = new Date(),
} = {}) {
  const effectiveDryRun = dryRun === undefined ? !archive : dryRun;
  const paths = getRunnerPaths(root);
  const resolvedStatePath = statePath || paths.progressiveState;
  const stateRead = readProgressiveDailyState(resolvedStatePath);
  const summaryBase = {
    dryRun: effectiveDryRun,
    archivePerformed: false,
    statePath: relativeOrAbsolute(root, resolvedStatePath),
    stateExists: fs.existsSync(resolvedStatePath),
    productionWritten: false,
    commitPerformed: false,
    pushPerformed: false,
  };

  if (stateRead.status === "missing") {
    return {
      status: "missing-state",
      ...summaryBase,
      stateDailyRunId: null,
      stateIsManualReconcile: false,
      createdAt: null,
      updatedAt: null,
      totalCandidates: 0,
      byReason: {},
      byDetailStatus: {},
      byPublicStatus: {},
      readyCount: 0,
      reviewOnlyCount: 0,
      notPublicCount: 0,
      recommendedAction:
        "No progressive state exists. The next trusted list ingest can create a fresh state.",
      archiveTarget: null,
    };
  }

  if (stateRead.status === "blocked") {
    return {
      status: "blocked",
      ...summaryBase,
      stateDailyRunId: null,
      stateIsManualReconcile: false,
      createdAt: null,
      updatedAt: null,
      totalCandidates: 0,
      byReason: {},
      byDetailStatus: {},
      byPublicStatus: {},
      readyCount: 0,
      reviewOnlyCount: 0,
      notPublicCount: 0,
      errors: stateRead.errors,
      recommendedAction:
        "State is unreadable or invalid. Inspect it manually before archive.",
      archiveTarget: null,
    };
  }

  const state = stateRead.state;
  const stateSummary = summarizeProgressiveState(state);
  const archiveDir = path.join(
    root,
    "data",
    "backups",
    `smokingpipes-progressive-state-archive-${formatTimestamp(now)}`
  );
  const archivePath = path.join(
    archiveDir,
    "smokingpipes-progressive-daily-state.json"
  );
  const archiveTarget = relativeOrAbsolute(root, archivePath);
  const manual = stateSummary.stateIsManualReconcile;

  if (!manual) {
    return {
      status: "no-action-needed",
      ...summaryBase,
      ...stateSummary,
      recommendedAction:
        "State is not from manual reconcile. Archive is not recommended.",
      archiveTarget,
    };
  }

  if (!archive || effectiveDryRun) {
    return {
      status: "archive-recommended",
      ...summaryBase,
      ...stateSummary,
      recommendedAction:
        "Archive this manual-reconcile state before resuming daily automation.",
      archiveTarget,
    };
  }

  fs.mkdirSync(archiveDir, { recursive: true });
  fs.copyFileSync(resolvedStatePath, archivePath);
  const manifest = {
    archivedAt: now.toISOString(),
    originalPath: relativeOrAbsolute(root, resolvedStatePath),
    archivePath: archiveTarget,
    stateDailyRunId: stateSummary.stateDailyRunId,
    totalCandidates: stateSummary.totalCandidates,
    byDetailStatus: stateSummary.byDetailStatus,
    byPublicStatus: stateSummary.byPublicStatus,
    byReason: stateSummary.byReason,
    reason: ARCHIVE_REASON,
    postArchiveStateHandling:
      "original state deleted; progressive runner accepts missing state and will create a fresh state on the next trusted ingest",
  };
  await writeJsonAtomic(path.join(archiveDir, "manifest.json"), manifest);
  fs.unlinkSync(resolvedStatePath);

  return {
    status: "archived",
    ...summaryBase,
    archivePerformed: true,
    stateExists: false,
    ...stateSummary,
    recommendedAction:
      "Manual-reconcile state archived. Keep daily task paused until the operator confirms restart.",
    archiveTarget,
    manifestPath: relativeOrAbsolute(root, path.join(archiveDir, "manifest.json")),
  };
}

async function main() {
  const options = parseArgs();
  const result = await reconcileProgressiveState(options);
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}
