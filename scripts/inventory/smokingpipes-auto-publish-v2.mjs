import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import {
  acquireOwnerTokenLock,
  cleanupRetention,
  cycleIdForDate,
  readCycle,
  releaseOwnerTokenLock,
  transitionCycle,
} from "./smokingpipes-cycle-store-v2.mjs";
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
  cycleId = cycleIdForDate(),
  live = false,
  listInputPath = null,
  detailLimit = 50,
  maxAutoApply = 2000,
  noPublish = false,
  noPush = false,
  skipSync = false,
  processDetail = null,
  publisher = invokePublisher,
} = {}) {
  const lock = await acquireOwnerTokenLock({
    stateRoot,
    command: "run-smokingpipes-auto-publish.ps1 V2",
  });
  if (!lock.acquired) return { status: lock.status, lock, networkAccessed: false };
  try {
    const resolvedRuntimeRoot = path.resolve(runtimeRoot);
    const runtimeSha = skipSync ? git(resolvedRuntimeRoot, ["rev-parse", "HEAD"]) : syncSmokingpipesRuntimeV2(resolvedRuntimeRoot);
    const collection = await runSmokingpipesCollectOnlyV2({
      stateRoot,
      runtimeRoot: resolvedRuntimeRoot,
      cycleId,
      live,
      listInputPath,
      detailLimit,
      maxAutoApply,
      processDetail,
    });
    if (!["ready-to-bundle", "release-resume-required"].includes(collection.status)) {
      return {
        ...collection,
        runtimeSha,
        observedCandidateCount: collection.cycle?.collection?.observedCandidateCount || 0,
        readyChangeCount: 0,
        pendingDetailCount: collection.cycle?.collection?.pendingDetailIds?.length || 0,
        bundleAppliedCount: 0,
        publishedCount: 0,
      };
    }
    let cycle = collection.cycle || await readCycle(stateRoot, cycleId);
    let built;
    if (collection.status === "release-resume-required") {
      built = {
        status: "bundle-ready",
        bundleId: cycle.bundle?.bundleId,
        bundleRoot: path.join(stateRoot, cycle.bundle?.path || ""),
        cycle,
      };
    } else {
      built = await buildSmokingpipesReleaseBundleV2({
        stateRoot,
        cycleId,
        runtimeRoot: resolvedRuntimeRoot,
        baseMainSha: runtimeSha,
        maxAutoApply,
      });
      if (built.status === "no-change") {
        return {
          status: "no-change",
          cycle: built.cycle,
          runtimeSha,
          observedCandidateCount: built.cycle.collection.observedCandidateCount,
          readyChangeCount: 0,
          pendingDetailCount: 0,
          bundleAppliedCount: 0,
          publishedCount: 0,
          networkAccessed: collection.networkAccessed,
        };
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
      return { status: "release-retryable", cycle: retryCycle, validation, networkAccessed: collection.networkAccessed };
    }
    if (noPublish) {
      return {
        status: "bundle-ready",
        cycle,
        bundleId: built.bundleId,
        bundleAppliedCount: built.manifest?.actualAppliedCount || cycle.bundle?.actualAppliedCount || 0,
        publishedCount: 0,
        networkAccessed: collection.networkAccessed,
      };
    }
    cycle = await transitionCycle({
      stateRoot,
      cycle,
      phase: "validating-release",
      reason: "standalone-release-publish-started",
    });
    const published = await publisher({
      stateRoot,
      cycleId,
      bundleRoot: built.bundleRoot,
      releaseRoot,
      runtimeRoot: resolvedRuntimeRoot,
      noPush,
    });
    return {
      ...published,
      cycleId,
      bundleId: built.bundleId,
      observedCandidateCount: cycle.collection.observedCandidateCount,
      readyChangeCount: built.manifest?.actualAppliedCount || 0,
      pendingDetailCount: cycle.collection.pendingDetailIds.length,
      bundleAppliedCount: built.manifest?.actualAppliedCount || 0,
      publishedCount: published.status === "published" ? built.manifest?.actualAppliedCount || 0 : 0,
      networkAccessed: collection.networkAccessed,
    };
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
    cycleId: options.get("cycle-id") || cycleIdForDate(),
    live: options.get("live") === true || options.get("live") === "true",
    listInputPath: options.get("list-input") || null,
    detailLimit: options.get("detail-limit") || 50,
    maxAutoApply: options.get("max-auto-apply") || 2000,
    noPublish: options.get("no-publish") === true || options.get("no-publish") === "true",
    noPush: options.get("no-push") === true || options.get("no-push") === "true",
  });
  console.log(JSON.stringify(result, null, 2));
  if (["collection-retryable", "release-retryable", "manual-review-required"].includes(result.status)) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"))) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
