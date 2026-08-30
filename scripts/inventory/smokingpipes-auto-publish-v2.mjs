import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import {
  acquireOwnerTokenLock,
  cleanupRetention,
  readCycle,
  readJson,
  recordPublishedBundle,
  releaseOwnerTokenLock,
  resolveActiveSmokingpipesCycle,
  transitionCycle,
} from "./smokingpipes-cycle-store-v2.mjs";
import {
  sendPushDeerNotification,
} from "./inventory-pushdeer-notifier-v1.mjs";
import {
  runSmokingpipesCollectOnlyV2,
} from "./smokingpipes-collect-only-v2.mjs";
import {
  buildSmokingpipesReleaseBundleV2,
} from "./smokingpipes-build-release-bundle-v2.mjs";

function git(runtimeRoot, arguments_, allowed = [0]) {
  const result = spawnSync("git", ["-C", runtimeRoot, ...arguments_], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (!allowed.includes(result.status)) {
    throw new Error(
      "git command failed: git -C " + runtimeRoot + " " + arguments_.join(" ") +
      "; gitExitCode=" + result.status + "; stderr-tail=" +
      String(result.stderr || "").split(/\r?\n/).slice(-20).join("\n")
    );
  }
  return String(result.stdout || "").trim();
}

function assertCleanRuntime(runtimeRoot) {
  const dirty = git(runtimeRoot, ["status", "--porcelain", "--untracked-files=no"]);
  if (dirty) throw new Error("runtime tracked worktree is not clean: " + dirty);
}

export const SMOKINGPIPES_V2_SUCCESS_STATUSES = new Set([
  "published",
  "no-change",
  "same-day-complete",
  "enriching-details",
  "ready-to-bundle",
  "bundle-ready",
  "preflight-passed",
  "already-running",
]);

export function smokingpipesV2ExitCode(status) {
  return SMOKINGPIPES_V2_SUCCESS_STATUSES.has(String(status || "")) ? 0 : 1;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// ===== BEGIN PROTECTED OPTIMIZATION: cooperative Daily deadline =====
// The scheduler owns process termination. V2 checks its own deadline only at
// phase boundaries so it never interrupts an atomic state or bundle write.
const RELEASE_DEADLINE_RESERVE_MS = 3 * 60 * 1000;

function createDailyDeadline(timeoutSeconds, nowMs = Date.now) {
  const seconds = Number(timeoutSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const startedAtMs = nowMs();
  return { startedAtMs, deadlineAtMs: startedAtMs + seconds * 1000, nowMs };
}

function hasDeadlineBudget(deadline, reserveMs = 0) {
  return !deadline || deadline.nowMs() + reserveMs < deadline.deadlineAtMs;
}
// ===== END PROTECTED OPTIMIZATION =====

const CHANGE_TYPE_LABELS = {
  "new-product": "新增",
  "price-change": "改价",
  "explicit-out-of-stock": "下架",
  reappeared: "恢复库存",
  "confirmed-disappeared": "确认消失",
  other: "其他",
};

function resolvedChangeTypeCounts(result, cycle) {
  for (const counts of [result.changeTypeCounts, cycle.bundle?.changeTypeCounts]) {
    if (
      counts &&
      typeof counts === "object" &&
      Object.values(counts).some((count) => number(count) > 0)
    ) {
      return counts;
    }
  }
  return {};
}

function formatChangeTypeCounts(result, cycle) {
  const counts = resolvedChangeTypeCounts(result, cycle);
  const lines = Object.entries(CHANGE_TYPE_LABELS)
    .map(([type, label]) => [label, number(counts[type])])
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `- ${label}: ${count}`);
  return lines.length ? ["变更类型:", ...lines] : ["变更类型: 无"];
}

function errorTail(value) {
  const source = String(value || "");
  try {
    const parsed = JSON.parse(source);
    if (Array.isArray(parsed?.errors) && parsed.errors.length) return String(parsed.errors[0]);
    if (Array.isArray(parsed?.warnings) && parsed.warnings.length) return String(parsed.warnings[0]);
  } catch {
    const errors = source.match(/"errors"\s*:\s*\[\s*"([^"]+)/);
    if (errors) return errors[1];
  }
  return source.split(/\r?\n/).filter(Boolean).slice(-8).join("\n");
}

export function buildSmokingpipesV2Notification(result = {}) {
  const status = String(result.status || "unknown");
  const cycle = result.cycle || {};
  const collection = cycle.collection || {};
  const cycleId = String(result.cycleId || cycle.cycleId || "unknown");
  const bundleId = String(result.bundleId || cycle.bundle?.bundleId || "-");
  const observed = number(result.observedCandidateCount ?? collection.observedCandidateCount);
  const completed = Array.isArray(collection.completedDetailIds) ? collection.completedDetailIds.length : 0;
  const completedWithoutDetail = number(collection.completedWithoutDetailCount);
  const pending = number(result.pendingDetailCount ?? collection.pendingDetailIds?.length);
  const quarantined = Array.isArray(collection.quarantinedDetailIds)
    ? collection.quarantinedDetailIds.length
    : 0;
  const duplicateHandling =
    result.duplicateHandling || collection.duplicateHandling || cycle.failure?.duplicateHandling || {};
  if (status === "enriching-details") {
    return {
      title: "Smokingpipes V2｜详情续跑",
      body: [
        `cycleId: ${cycleId}`,
        "状态: enriching-details",
        `候选: ${observed}`,
        `实际详情完成: ${completed}`,
        `无需抓详情的状态变更: ${completedWithoutDetail}`,
        `待处理详情: ${pending}`,
        `隔离: ${quarantined}`,
        `本轮访问源站: ${result.networkAccessed === true ? "是" : "否"}`,
        "下一窗口: 继续待处理详情，不重新抓取已可信列表。",
      ].join("\n"),
    };
  }
  if (["published"].includes(status)) {
    return {
      title: "Smokingpipes V2｜发布成功",
      body: [
        `cycleId: ${cycleId}`,
        `bundleId: ${bundleId}`,
        `List: ${number(result.listTotal ?? duplicateHandling.total ?? observed)}`,
        `Published: ${number(result.publishedCount ?? result.bundleAppliedCount)}`,
        `Isolated: ${number(result.isolatedCount ?? duplicateHandling.isolatedDuplicateCount)}`,
        ...formatChangeTypeCounts(result, cycle),
        `commit: ${result.commitSha || "-"}`,
        "push: 成功",
      ].join("\n"),
    };
  }
  if (["no-change", "same-day-complete"].includes(status)) {
    return {
      title: "Smokingpipes V2｜无需发布",
      body: [
        `cycleId: ${cycleId}`,
        `状态: ${status}`,
        status === "no-change" ? "Production: 没有真实变更。" : "同日任务已完成，未重复处理。",
      ].join("\n"),
    };
  }
  const failureStage = String(cycle.failure?.stage || result.failureStage || status);
  if (failureStage === "list-diff") {
    return {
      title: "Smokingpipes V2｜List 已保留 / Diff 待处理",
      body: [
        `cycleId: ${cycleId}`,
        "List: 已保留",
        "Diff: 已保留",
        "Bundle: 未生成",
        "Production: 未写入",
        `错误: ${errorTail(cycle.failure?.fatalWarnings?.[0] || cycle.failure?.message) || "-"}`,
        "下一窗口: 使用已保存 List/Diff；不重新访问 Smokingpipes。",
      ].join("\n"),
    };
  }
  if (failureStage === "list") {
    return {
      title: "Smokingpipes V2｜List 采集待重试",
      body: [
        `cycleId: ${cycleId}`,
        "List: 未通过采集完整性检查",
        "Bundle: 未生成",
        "Production: 未写入",
        ...(number(duplicateHandling.blockedDuplicateCount) > 0
          ? [
              "Duplicate gate blocked",
              `duplicateIds: ${number(duplicateHandling.duplicateIds)}`,
              `ratio: ${number(duplicateHandling.duplicateRatio)}`,
            ]
          : []),
        `错误: ${errorTail(result.error || result.stderrTail || cycle.failure?.message) || "-"}`,
        "下一窗口: 需要重新抓 List。",
      ].join("\n"),
    };
  }
  return {
    title: "Smokingpipes V2｜Bundle/发布待重试",
    body: [
      `cycleId: ${cycleId}`,
      `bundleId: ${bundleId}`,
      `计划发布数: ${number(result.readyChangeCount ?? cycle.bundle?.actualAppliedCount)}`,
      "实际发布数: 0",
      `失败阶段: ${failureStage}`,
      ...(number(duplicateHandling.blockedDuplicateCount) > 0
        ? [
            "Duplicate gate blocked",
            `duplicateIds: ${number(duplicateHandling.duplicateIds)}`,
            `ratio: ${number(duplicateHandling.duplicateRatio)}`,
          ]
        : []),
      `错误尾部: ${errorTail(result.error || result.stderrTail || cycle.failure?.message) || "-"}`,
      "采集结果: 已保留",
      "Bundle: 已保留",
      "下一窗口: 基于已保存的 Smokingpipes 变更集重试发布；不重新抓取。",
    ].join("\n"),
  };
}

export function syncSmokingpipesRuntimeV2(runtimeRoot) {
  assertCleanRuntime(runtimeRoot);
  git(runtimeRoot, ["fetch", "origin"]);
  const head = git(runtimeRoot, ["rev-parse", "HEAD"]);
  const remote = git(runtimeRoot, ["rev-parse", "origin/main"]);
  if (head !== remote) {
    const headIsAncestor = spawnSync(
      "git",
      ["-C", runtimeRoot, "merge-base", "--is-ancestor", "HEAD", "origin/main"],
      { windowsHide: true }
    ).status === 0;
    if (!headIsAncestor) {
      throw new Error("runtime is ahead of or diverged from origin/main; automatic sync is blocked");
    }
    git(runtimeRoot, ["merge", "--ff-only", "origin/main"]);
  }
  assertCleanRuntime(runtimeRoot);
  return git(runtimeRoot, ["rev-parse", "HEAD"]);
}

export function parseSmokingpipesPublisherResult(stdout = "") {
  const prefix = "SMOKINGPIPES_PUBLISHER_RESULT_JSON=";
  const markers = String(stdout).split(/\r?\n/).filter((line) => line.startsWith(prefix));
  if (markers.length !== 1) return { status: "publisher-output-invalid", error: `expected exactly one publisher result marker, got ${markers.length}` };
  try {
    const parsed = JSON.parse(markers[0].slice(prefix.length));
    const allowed = new Set(["published", "no-change", "push-retryable", "release-retryable", "commit-created-no-push"]);
    if (!allowed.has(parsed?.status)) throw new Error(`unsupported publisher status: ${parsed?.status}`);
    return parsed;
  } catch (error) {
    return { status: "publisher-output-invalid", error: error.message };
  }
}

async function invokePublisher({
  stateRoot,
  cycleId,
  bundleRoot,
  releaseRoot,
  runtimeRoot,
  noPush,
  pushRetryAttempt = 0,
}) {
  const script = path.join(runtimeRoot, "scripts", "inventory", "publish-smokingpipes-release-bundle-v2.ps1");
  const arguments_ = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    script,
    "-StateRoot",
    stateRoot,
    "-CycleId",
    cycleId,
    "-BundleRoot",
    bundleRoot,
    "-ReleaseRoot",
    releaseRoot,
    "-RuntimeRoot",
    runtimeRoot,
  ];
  if (noPush) arguments_.push("-NoPush");
  if (pushRetryAttempt) arguments_.push("-PushRetryAttempt", String(pushRetryAttempt));
  const result = spawnSync("powershell.exe", arguments_, {
    encoding: "utf8",
    windowsHide: true,
  });
  const payload = parseSmokingpipesPublisherResult(String(result.stdout || ""));
  return {
    ...payload,
    exitCode: result.status,
    stderrTail: String(result.stderr || "").split(/\r?\n/).slice(-20).join("\n"),
  };
}

export async function runSmokingpipesAutoPublishV2({
  stateRoot,
  runtimeRoot = process.cwd(),
  releaseRoot = "C:\\Users\\NING MEI\\Desktop\\pipewebsite-smokingpipes-release",
  cycleId = null,
  now = new Date(),
  live = false,
  listInputPath = null,
  detailLimit = 50,
  maxAutoApply = 2000,
  noPublish = false,
  noPush = false,
  preflightOnly = false,
  skipSync = false,
  expectedRuntimeSha = null,
  timeoutSeconds = 3600,
  nowMs = Date.now,
  notificationsEnabled = false,
  notifier = sendPushDeerNotification,
  collector = runSmokingpipesCollectOnlyV2,
  processDetail = null,
  bundleBuilder = buildSmokingpipesReleaseBundleV2,
  publisher = invokePublisher,
} = {}) {
  const deadline = createDailyDeadline(timeoutSeconds, nowMs);
  const lock = await acquireOwnerTokenLock({
    stateRoot,
    command: "run-smokingpipes-auto-publish.ps1 V2",
  });
  if (!lock.acquired) return { status: lock.status, lock, networkAccessed: false };
  let notificationAttempted = false;
  const finalize = async (result) => {
    if (
      !notificationsEnabled ||
      preflightOnly ||
      notificationAttempted ||
      result?.status === "same-day-complete"
    ) return result;
    notificationAttempted = true;
    try {
      const message = buildSmokingpipesV2Notification(result);
      const notification = await notifier({ title: message.title, body: message.body });
      return {
        ...result,
        notificationSent: notification?.notificationSent === true,
        notificationFailed: notification?.notificationSent !== true,
        notificationReason: notification?.notificationReason || "unknown notification result",
      };
    } catch (error) {
      return {
        ...result,
        notificationSent: false,
        notificationFailed: true,
        notificationReason: error?.message || String(error),
      };
    }
  };
  try {
    const resolvedRuntimeRoot = path.resolve(runtimeRoot);
    const active = await resolveActiveSmokingpipesCycle({ stateRoot, cycleId, now });
    const activeCycleId = active.cycleId;
    const runtimeSha = skipSync ? git(resolvedRuntimeRoot, ["rev-parse", "HEAD"]) : syncSmokingpipesRuntimeV2(resolvedRuntimeRoot);
    if (expectedRuntimeSha && runtimeSha !== String(expectedRuntimeSha).trim()) {
      throw new Error(`runtime HEAD changed before Node startup: expected ${expectedRuntimeSha}, got ${runtimeSha}`);
    }
    let activeCycle = active.cycle || await readCycle(stateRoot, activeCycleId);
    if (activeCycle?.phase === "publishing") {
      activeCycle = await transitionCycle({
        stateRoot,
        cycle: activeCycle,
        phase: "retryable",
        reason: "interrupted-validating-release",
        patch: {
          failure: {
            stage: "interrupted-validating-release",
            message: "previous release validation was interrupted; retained bundle requires a release retry",
            at: new Date().toISOString(),
          },
        },
      });
    }
    if (activeCycle?.failure?.requiresManualReview === true) {
      return finalize({
        status: "manual-review-required",
        cycleId: activeCycleId,
        cycle: activeCycle,
        runtimeSha,
        observedCandidateCount: activeCycle.collection?.observedCandidateCount || 0,
        readyChangeCount: 0,
        pendingDetailCount: activeCycle.collection?.pendingDetailIds?.length || 0,
        bundleAppliedCount: 0,
        publishedCount: 0,
        networkAccessed: false,
      });
    }
    if (preflightOnly) {
      return finalize({
        status: "preflight-passed",
        preflightOnly: true,
        runtimeSha,
        cycleId: activeCycleId,
        cycle: activeCycle,
        observedCandidateCount: activeCycle?.collection?.observedCandidateCount || 0,
        readyChangeCount: 0,
        pendingDetailCount: activeCycle?.collection?.pendingDetailIds?.length || 0,
        bundleAppliedCount: 0,
        publishedCount: 0,
        networkAccessed: false,
      });
    }
    console.error("SCHEDULER_STAGE collection");
    const collection = await collector({
      stateRoot,
      runtimeRoot: resolvedRuntimeRoot,
      cycleId: activeCycleId,
      now,
      live,
      listInputPath,
      detailLimit,
      maxAutoApply,
      processDetail,
      deadline,
    });
    if (!["ready-to-bundle", "release-resume-required"].includes(collection.status)) {
      return finalize({
        ...collection,
        cycleId: activeCycleId,
        runtimeSha,
        observedCandidateCount: collection.cycle?.collection?.observedCandidateCount || 0,
        readyChangeCount: 0,
        pendingDetailCount: collection.cycle?.collection?.pendingDetailIds?.length || 0,
        bundleAppliedCount: 0,
        publishedCount: 0,
      });
    }
    if (!hasDeadlineBudget(deadline, RELEASE_DEADLINE_RESERVE_MS)) {
      const timeoutCycle = await transitionCycle({
        stateRoot,
        cycle: collection.cycle || await readCycle(stateRoot, activeCycleId),
        phase: "retryable",
        reason: "daily-deadline-before-release",
        patch: {
          failure: {
            stage: "daily-timeout",
            message: "Daily timeout budget is insufficient to start release safely",
            at: new Date().toISOString(),
          },
        },
      });
      return finalize({
        status: "release-retryable",
        failureStage: "daily-timeout",
        error: timeoutCycle.failure?.message,
        cycleId: activeCycleId,
        cycle: timeoutCycle,
        runtimeSha,
        observedCandidateCount: timeoutCycle.collection?.observedCandidateCount || 0,
        readyChangeCount: 0,
        pendingDetailCount: timeoutCycle.collection?.pendingDetailIds?.length || 0,
        bundleAppliedCount: 0,
        publishedCount: 0,
        networkAccessed: collection.networkAccessed,
      });
    }
    console.error("SCHEDULER_STAGE release");
    let cycle = collection.cycle || await readCycle(stateRoot, activeCycleId);
    let built;
    const retainedBundle = collection.status === "release-resume-required" && cycle.bundle?.bundleId && cycle.bundle?.path;
    if (retainedBundle) {
      const bundleRoot = path.join(stateRoot, cycle.bundle?.path || "");
      built = {
        status: "bundle-ready",
        bundleId: cycle.bundle?.bundleId,
        bundleRoot,
        manifest: await readJson(path.join(bundleRoot, "manifest.json"), null),
        cycle,
      };
    } else {
      try {
        built = await bundleBuilder({
          stateRoot,
          cycleId: activeCycleId,
          runtimeRoot: resolvedRuntimeRoot,
          baseMainSha: runtimeSha,
          maxAutoApply,
        });
      } catch (error) {
        const retryCycle = await transitionCycle({
          stateRoot,
          cycle,
          phase: "retryable",
          reason: "bundle-build-failed",
          patch: {
            failure: {
              stage: "bundle-build",
              message: errorTail(error?.message || error),
              at: new Date().toISOString(),
            },
          },
        });
        return finalize({
          status: "release-retryable",
          failureStage: "bundle-build",
          error: errorTail(error?.message || error),
          cycleId: activeCycleId,
          cycle: retryCycle,
          runtimeSha,
          observedCandidateCount: retryCycle.collection?.observedCandidateCount || 0,
          readyChangeCount: 0,
          pendingDetailCount: retryCycle.collection?.pendingDetailIds?.length || 0,
          bundleAppliedCount: 0,
          publishedCount: 0,
          networkAccessed: false,
        });
      }
      if (built.status === "no-change") {
        return finalize({
          status: "no-change",
          cycleId: activeCycleId,
          cycle: built.cycle,
          runtimeSha,
          observedCandidateCount: built.cycle.collection.observedCandidateCount,
          readyChangeCount: 0,
          pendingDetailCount: 0,
          bundleAppliedCount: 0,
          publishedCount: 0,
          networkAccessed: collection.networkAccessed,
        });
      }
      cycle = built.cycle;
    }
    // ===== BEGIN PROTECTED OPTIMIZATION: one final validator =====
    // Only the Publisher validates the complete latest-main release candidate.
    // Orchestrator-side validation would validate an obsolete intermediate twice.
    // ===== END PROTECTED OPTIMIZATION =====
    if (noPublish) {
      return finalize({
        status: "bundle-ready",
        cycleId: activeCycleId,
        cycle,
        bundleId: built.bundleId,
        bundleAppliedCount: built.manifest?.actualAppliedCount || cycle.bundle?.actualAppliedCount || 0,
        publishedCount: 0,
        networkAccessed: collection.networkAccessed,
      });
    }
    cycle = await transitionCycle({
      stateRoot,
      cycle,
      phase: "publishing",
      reason: "standalone-release-publish-started",
    });
    let published = await publisher({
      stateRoot,
      cycleId: activeCycleId,
      bundleRoot: built.bundleRoot,
      releaseRoot,
      runtimeRoot: resolvedRuntimeRoot,
      noPush,
    });
    if (published.status === "push-retryable" && !noPush) {
      // ===== BEGIN PROTECTED OPTIMIZATION: one normal Git race retry =====
      // Rebuild against current origin/main from saved V2 state only. The
      // collector is not invoked again and no source-site request is made.
      console.error("SCHEDULER_STAGE release-push-retry");
      published = await publisher({
        stateRoot,
        cycleId: activeCycleId,
        bundleRoot: built.bundleRoot,
        releaseRoot,
        runtimeRoot: resolvedRuntimeRoot,
        noPush,
        pushRetryAttempt: 1,
      });
      // ===== END PROTECTED OPTIMIZATION =====
    }
    if (["published", "no-change"].includes(published.status)) {
      const rebuiltCycle = await readCycle(stateRoot, activeCycleId);
      const publishedBundleId = published.bundleId || rebuiltCycle?.bundle?.bundleId || built.bundleId;
      cycle = await transitionCycle({
        stateRoot,
        cycle,
        phase: "done",
        reason: published.status === "published" ? "release-published" : "release-no-change",
        patch: {
          bundle: rebuiltCycle?.bundle || cycle.bundle,
          release: published.status === "published"
            ? { bundleId: publishedBundleId, commitSha: published.commitSha || null, publishedAt: new Date().toISOString() }
            : null,
          failure: null,
        },
      });
      if (published.status === "published") {
        await recordPublishedBundle({ stateRoot, bundleId: publishedBundleId, cycleId: activeCycleId, commitSha: published.commitSha || null });
      }
    } else {
      const persistedCycle = await readCycle(stateRoot, activeCycleId);
      if (published.status !== "published" && persistedCycle?.phase === "publishing") {
        cycle = await transitionCycle({
          stateRoot,
          cycle: persistedCycle,
          phase: "retryable",
          reason: `publisher-${published.status || "output-invalid"}`,
          patch: {
            failure: {
              stage: published.failureStage || published.status || "publisher-output-invalid",
              message: errorTail(published.error || published.stderrTail || "publisher did not complete"),
              at: new Date().toISOString(),
            },
          },
        });
      } else {
        cycle = persistedCycle || cycle;
      }
    }
    return finalize({
      ...published,
      cycleId: activeCycleId,
      bundleId: published.bundleId || cycle.bundle?.bundleId || built.bundleId,
      cycle,
      observedCandidateCount: cycle.collection.observedCandidateCount,
      readyChangeCount: published.publishedCount ?? built.manifest?.actualAppliedCount ?? 0,
      pendingDetailCount: cycle.collection.pendingDetailIds.length,
      bundleAppliedCount: published.publishedCount ?? built.manifest?.actualAppliedCount ?? 0,
      publishedCount: published.status === "published" ? published.publishedCount ?? built.manifest?.actualAppliedCount ?? 0 : 0,
      changeTypeCounts:
        built.manifest?.changeTypeCounts ||
        cycle.bundle?.changeTypeCounts ||
        {},
      networkAccessed: collection.networkAccessed,
    });
  } finally {
    await releaseOwnerTokenLock({ stateRoot, ownerToken: lock.ownerToken });
    await cleanupRetention({ stateRoot }).catch(() => {});
  }
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = new Map();
  for (const argument of argv) {
    const [key, ...rest] = argument.replace(/^--/, "").split("=");
    options.set(key, rest.length ? rest.join("=") : true);
  }
  return options;
}

export function summarizeSmokingpipesV2CliResult(result = {}) {
  const cycle = result.cycle || {};
  const collection = cycle.collection || {};
  return {
    status: result.status || "unknown",
    cycleId: result.cycleId || cycle.cycleId || null,
    runtimeSha: result.runtimeSha || null,
    preflightOnly: result.preflightOnly === true,
    networkAccessed: result.networkAccessed === true,
    pendingDetailCount: result.pendingDetailCount ?? collection.pendingDetailIds?.length ?? 0,
    completedDetailCount: collection.completedDetailIds?.length ?? null,
    readyChangeCount: result.readyChangeCount ?? 0,
    bundleAppliedCount: result.bundleAppliedCount ?? 0,
    publishedCount: result.publishedCount ?? 0,
    failureStage: result.failureStage || cycle.failure?.stage || null,
    error: errorTail(result.error || result.stderrTail || cycle.failure?.message || "") || null,
    notification: {
      sent: result.notificationSent === true || result.notification?.sent === true,
      reason: result.notificationReason || result.notification?.reason || null,
    },
  };
}

async function main() {
  const options = parseArgs();
  const stateRoot = options.get("state-root");
  if (!stateRoot) throw new Error("--state-root is required");
  const result = await runSmokingpipesAutoPublishV2({
    stateRoot,
    runtimeRoot: options.get("runtime-root") || process.cwd(),
    releaseRoot: options.get("release-root") || undefined,
    cycleId: options.get("cycle-id") || null,
    live: options.get("live") === true || options.get("live") === "true",
    listInputPath: options.get("list-input") || null,
    detailLimit: options.get("detail-limit") || 50,
    maxAutoApply: options.get("max-auto-apply") || 2000,
    noPublish: options.get("no-publish") === true || options.get("no-publish") === "true",
    noPush: options.get("no-push") === true || options.get("no-push") === "true",
    preflightOnly: options.get("preflight-only") === true || options.get("preflight-only") === "true",
    skipSync: options.get("skip-sync") === true || options.get("skip-sync") === "true",
    expectedRuntimeSha: options.get("expected-runtime-sha") || null,
    timeoutSeconds: options.get("timeout-seconds") || 3600,
    notificationsEnabled: options.get("notify") === true || options.get("notify") === "true",
  });
  const summary = summarizeSmokingpipesV2CliResult(result);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`SMOKINGPIPES_V2_RESULT_JSON=${JSON.stringify(summary)}`);
  process.exitCode = smokingpipesV2ExitCode(result.status);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"))) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
