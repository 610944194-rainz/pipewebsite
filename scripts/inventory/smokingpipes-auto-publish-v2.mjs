import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import {
  acquireOwnerTokenLock,
  cleanupRetention,
  readCycle,
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
import {
  validateSmokingpipesReleaseBundleV2,
} from "./validate-smokingpipes-release-bundle-v2.mjs";

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

function errorTail(value) {
  return String(value || "").split(/\r?\n/).filter(Boolean).slice(-8).join("\n");
}

export function buildSmokingpipesV2Notification(result = {}) {
  const status = String(result.status || "unknown");
  const cycle = result.cycle || {};
  const collection = cycle.collection || {};
  const cycleId = String(result.cycleId || cycle.cycleId || "unknown");
  const bundleId = String(result.bundleId || cycle.bundle?.bundleId || "-");
  const observed = number(result.observedCandidateCount ?? collection.observedCandidateCount);
  const completed = Array.isArray(collection.completedDetailIds) ? collection.completedDetailIds.length : 0;
  const pending = number(result.pendingDetailCount ?? collection.pendingDetailIds?.length);
  const quarantined = Array.isArray(collection.quarantinedDetailIds) ? collection.quarantinedDetailIds.length : 0;
  if (status === "enriching-details") {
    return {
      title: "Smokingpipes V2｜详情续跑",
      body: [
        `cycleId: ${cycleId}`,
        "状态: enriching-details",
        `候选: ${observed}`,
        `已完成详情: ${completed}`,
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
        `实际发布数: ${number(result.publishedCount ?? result.bundleAppliedCount)}`,
        `变更类型: ${JSON.stringify(cycle.bundle?.changeTypeCounts || result.changeTypeCounts || {})}`,
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
  return {
    title: "Smokingpipes V2｜Bundle/发布待重试",
    body: [
      `cycleId: ${cycleId}`,
      `bundleId: ${bundleId}`,
      `计划发布数: ${number(result.readyChangeCount ?? cycle.bundle?.actualAppliedCount)}`,
      "实际发布数: 0",
      `失败阶段: ${failureStage}`,
      `错误尾部: ${errorTail(result.error || result.stderrTail || cycle.failure?.message) || "-"}`,
      "采集结果: 已保留",
      "Bundle: 已保留",
      `下一窗口: ${failureStage === "stale-base" ? "以新 main 基线重建 Bundle；不重新抓取。" : "发布重试；不重新抓取。"}`,
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

function parseLastJson(stdout) {
  for (let start = stdout.lastIndexOf("{"); start >= 0; start = stdout.lastIndexOf("{", start - 1)) {
    try {
      return JSON.parse(stdout.slice(start).trim());
    } catch {
      // PowerShell's ConvertTo-Json may emit nested objects; try its outer object.
    }
  }
  return { status: "publisher-output-invalid", raw: stdout };
}

async function invokePublisher({
  stateRoot,
  cycleId,
  bundleRoot,
  releaseRoot,
  runtimeRoot,
  noPush,
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
  const result = spawnSync("powershell.exe", arguments_, {
    encoding: "utf8",
    windowsHide: true,
  });
  const payload = parseLastJson(String(result.stdout || ""));
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
  notificationsEnabled = false,
  notifier = sendPushDeerNotification,
  processDetail = null,
  publisher = invokePublisher,
} = {}) {
  const lock = await acquireOwnerTokenLock({
    stateRoot,
    command: "run-smokingpipes-auto-publish.ps1 V2",
  });
  if (!lock.acquired) return { status: lock.status, lock, networkAccessed: false };
  let notificationAttempted = false;
  const finalize = async (result) => {
    if (!notificationsEnabled || preflightOnly || notificationAttempted) return result;
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
    if (active.status === "manual-review-required") {
      return finalize({
        status: active.status,
        cycleId: active.cycleId,
        cycle: active.cycle,
        networkAccessed: false,
      });
    }
    const activeCycleId = active.cycleId;
    const runtimeSha = skipSync ? git(resolvedRuntimeRoot, ["rev-parse", "HEAD"]) : syncSmokingpipesRuntimeV2(resolvedRuntimeRoot);
    if (expectedRuntimeSha && runtimeSha !== String(expectedRuntimeSha).trim()) {
      throw new Error(`runtime HEAD changed before Node startup: expected ${expectedRuntimeSha}, got ${runtimeSha}`);
    }
    let activeCycle = active.cycle || await readCycle(stateRoot, activeCycleId);
    if (activeCycle?.phase === "validating-release") {
      activeCycle = await transitionCycle({
        stateRoot,
        cycle: activeCycle,
        phase: "release-retryable",
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
    const collection = await runSmokingpipesCollectOnlyV2({
      stateRoot,
      runtimeRoot: resolvedRuntimeRoot,
      cycleId: activeCycleId,
      now,
      live,
      listInputPath,
      detailLimit,
      maxAutoApply,
      processDetail,
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
    console.error("SCHEDULER_STAGE release");
    let cycle = collection.cycle || await readCycle(stateRoot, activeCycleId);
    let built;
    const staleBaseRetry = collection.status === "release-resume-required" && cycle.failure?.stage === "stale-base";
    if (collection.status === "release-resume-required" && !staleBaseRetry) {
      built = {
        status: "bundle-ready",
        bundleId: cycle.bundle?.bundleId,
        bundleRoot: path.join(stateRoot, cycle.bundle?.path || ""),
        cycle,
      };
    } else {
      built = await buildSmokingpipesReleaseBundleV2({
        stateRoot,
        cycleId: activeCycleId,
        runtimeRoot: resolvedRuntimeRoot,
        baseMainSha: runtimeSha,
        maxAutoApply,
      });
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
    const validation = await validateSmokingpipesReleaseBundleV2({
      bundleRoot: built.bundleRoot,
      runtimeRoot: resolvedRuntimeRoot,
    });
    if (!validation.valid) {
      const retryCycle = await transitionCycle({
        stateRoot,
        cycle,
        phase: "release-retryable",
        reason: "bundle-validator-failed",
        patch: { failure: { stage: "bundle-validator", message: validation.blockers.join("; ") } },
      });
      return finalize({ status: "release-retryable", cycleId: activeCycleId, cycle: retryCycle, validation, networkAccessed: collection.networkAccessed });
    }
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
      phase: "validating-release",
      reason: "standalone-release-publish-started",
    });
    const published = await publisher({
      stateRoot,
      cycleId: activeCycleId,
      bundleRoot: built.bundleRoot,
      releaseRoot,
      runtimeRoot: resolvedRuntimeRoot,
      noPush,
    });
    if (published.status === "stale-base") {
      cycle = await transitionCycle({
        stateRoot,
        cycle,
        phase: "release-retryable",
        reason: "stale-base",
        patch: {
          failure: {
            stage: "stale-base",
            message: "origin/main changed after bundle creation",
            bundleId: built.bundleId,
            baseMainSha: cycle.bundle?.baseMainSha || built.manifest?.baseMainSha || null,
            remoteMainSha: published.remoteMainSha || null,
            at: new Date().toISOString(),
          },
        },
      });
    } else {
      const persistedCycle = await readCycle(stateRoot, activeCycleId);
      if (published.status !== "published" && persistedCycle?.phase === "validating-release") {
        cycle = await transitionCycle({
          stateRoot,
          cycle: persistedCycle,
          phase: "release-retryable",
          reason: `publisher-${published.status || "output-invalid"}`,
          patch: {
            failure: {
              stage: published.status || "publisher-output-invalid",
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
      bundleId: built.bundleId,
      cycle,
      observedCandidateCount: cycle.collection.observedCandidateCount,
      readyChangeCount: built.manifest?.actualAppliedCount || 0,
      pendingDetailCount: cycle.collection.pendingDetailIds.length,
      bundleAppliedCount: built.manifest?.actualAppliedCount || 0,
      publishedCount: published.status === "published" ? built.manifest?.actualAppliedCount || 0 : 0,
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
    notificationsEnabled: options.get("notify") === true || options.get("notify") === "true",
  });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = smokingpipesV2ExitCode(result.status);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"))) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
