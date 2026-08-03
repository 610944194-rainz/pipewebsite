import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  acquireOwnerTokenLock,
  createCycle,
  cyclePaths,
  hashFile,
  loadOrCreateCycle,
  readCycle,
  readJson,
  releaseOwnerTokenLock,
  resolveActiveSmokingpipesCycle,
  transitionCycle,
  writeCycle,
  writeJsonAtomic,
} from "./smokingpipes-cycle-store-v2.mjs";
import {
  runSmokingpipesCollectOnlyV2,
} from "./smokingpipes-collect-only-v2.mjs";
import {
  buildSmokingpipesReleaseBundleV2,
  GIT_JSON_MAX_BUFFER_BYTES,
  readJsonAtGitRef,
} from "./smokingpipes-build-release-bundle-v2.mjs";
import {
  validateSmokingpipesReleaseBundleV2,
} from "./validate-smokingpipes-release-bundle-v2.mjs";
import {
  runSmokingpipesAutoPublishV2,
  buildSmokingpipesV2Notification,
  smokingpipesV2ExitCode,
} from "./smokingpipes-auto-publish-v2.mjs";
import {
  markSmokingpipesReleaseState,
} from "./smokingpipes-release-state-v2.mjs";
import {
  createProgressiveDailyState,
} from "./smokingpipes-progressive-state-v1.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

async function readWorkspaceJson(relativeFile) {
  return JSON.parse(await fs.promises.readFile(path.join(workspaceRoot, relativeFile), "utf8"));
}

function git(directory, arguments_) {
  return execFileSync("git", ["-C", directory, ...arguments_], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function writeText(root, relativePath, contents) {
  const target = path.join(root, relativePath);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(target, contents, "utf8");
}

function runPublisher(arguments_, { env = {} } = {}) {
  return spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join(workspaceRoot, "scripts", "inventory", "publish-smokingpipes-release-bundle-v2.ps1"),
    ...arguments_,
  ], { encoding: "utf8", windowsHide: true, env: { ...process.env, ...env } });
}

function lastJson(stdout) {
  for (let start = stdout.lastIndexOf("{"); start >= 0; start = stdout.lastIndexOf("{", start - 1)) {
    try {
      return JSON.parse(stdout.slice(start));
    } catch {
      // Continue until the outer PowerShell JSON object is found.
    }
  }
  throw new Error(`publisher did not emit JSON: ${stdout}`);
}

function trustedSnapshot(products) {
  return {
    version: "smokingpipes-current-list-dry-run-v1",
    source: "smokingpipes",
    products,
    summary: {
      expectedPages: 1,
      effectiveScannedPages: 1,
      fullExpectedRangeScanned: true,
      failedPages: [],
      captchaDetected: false,
      verificationDetected: false,
    },
  };
}

function listItem(id, brand = "Test Brand") {
  return {
    source: "smokingpipes",
    sourceProductId: id,
    sourceUrl: "https://example.test/moreinfo.cfm?product_id=" + id,
    title: "Fixture Pipe " + id,
    rawTitle: "Fixture Pipe " + id,
    brand,
    price: "$120.00",
    image: "https://example.test/" + id + ".jpg",
    mainImage: "https://example.test/" + id + ".jpg",
    listPage: 1,
    listPosition: Number(id),
  };
}

async function transitionToReady({ stateRoot, cycleId }) {
  let cycle = await readCycle(stateRoot, cycleId);
  cycle = await transitionCycle({ stateRoot, cycle, phase: "collecting-list", reason: "fixture" });
  cycle = await transitionCycle({ stateRoot, cycle, phase: "list-ready", reason: "fixture" });
  return transitionCycle({ stateRoot, cycle, phase: "ready-to-bundle", reason: "fixture" });
}

async function main() {
  const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "smokingpipes-v2-e2e-"));
  const runtimeRoot = path.join(temporaryRoot, "runtime");
  const stateRoot = path.join(temporaryRoot, "state");
  try {
    const template = (await readWorkspaceJson("data/products/smokingpipes-products.json"))[0];
    await writeJsonAtomic(
      path.join(runtimeRoot, "data", "products", "smokingpipes-products.json"),
      [template]
    );
    await writeJsonAtomic(
      path.join(runtimeRoot, "data", "products", "danish-products.json"),
      []
    );
    await writeText(runtimeRoot, "scripts/validate-public-product-indexes-v1.mjs", "process.exit(0);\n");
    await writeText(runtimeRoot, "scripts/test-public-products-inventory-default-v1.mjs", "process.exit(0);\n");
    await writeText(runtimeRoot, "package.json", JSON.stringify({
      private: true,
      scripts: { build: "node -e \"process.exit(9)\"" },
    }));
    git(temporaryRoot, ["init", "--initial-branch=main", runtimeRoot]);
    git(runtimeRoot, ["config", "user.email", "fixture@example.invalid"]);
    git(runtimeRoot, ["config", "user.name", "Fixture"]);
    git(runtimeRoot, ["add", "--", "."]);
    git(runtimeRoot, ["commit", "-m", "fixture baseline"]);
    const runtimeBaseSha = git(runtimeRoot, ["rev-parse", "HEAD"]);
    const bareOrigin = path.join(temporaryRoot, "origin.git");
    execFileSync("git", ["clone", "--bare", runtimeRoot, bareOrigin], { stdio: "ignore" });
    git(runtimeRoot, ["remote", "add", "origin", bareOrigin]);
    git(runtimeRoot, ["fetch", "origin"]);
    git(runtimeRoot, ["branch", "--set-upstream-to=origin/main", "main"]);
    const releaseRoot = path.join(temporaryRoot, "release");
    execFileSync("git", ["clone", bareOrigin, releaseRoot], { stdio: "ignore" });
    const largeGitRoot = path.join(temporaryRoot, "large-git-json");
    await fs.promises.mkdir(largeGitRoot, { recursive: true });
    await writeText(largeGitRoot, "large.json", JSON.stringify({ payload: "x".repeat(2 * 1024 * 1024) }));
    git(temporaryRoot, ["init", "--initial-branch=main", largeGitRoot]);
    git(largeGitRoot, ["config", "user.email", "fixture@example.invalid"]);
    git(largeGitRoot, ["config", "user.name", "Fixture"]);
    git(largeGitRoot, ["add", "--", "large.json"]);
    git(largeGitRoot, ["commit", "-m", "large JSON fixture"]);
    const largeJson = readJsonAtGitRef({ runtimeRoot: largeGitRoot, ref: "HEAD", relativePath: "large.json" });
    assert.equal(largeJson.payload.length, 2 * 1024 * 1024);
    assert.ok(GIT_JSON_MAX_BUFFER_BYTES > 2 * 1024 * 1024);
    let preflightDetailCalled = false;
    const preflight = await runSmokingpipesAutoPublishV2({
      stateRoot,
      runtimeRoot,
      cycleId: "2030-01-04",
      skipSync: true,
      preflightOnly: true,
      processDetail: async () => {
        preflightDetailCalled = true;
        throw new Error("preflight must not process details");
      },
    });
    assert.equal(preflight.status, "preflight-passed");
    assert.equal(preflight.networkAccessed, false);
    assert.equal(preflightDetailCalled, false);

    const bundleFailureId = "2030-01-05";
    const bundleFailureCycle = createCycle({ cycleId: bundleFailureId });
    bundleFailureCycle.phase = "ready-to-bundle";
    bundleFailureCycle.collection = {
      ...bundleFailureCycle.collection,
      observedCandidateCount: 1,
      completedDetailIds: ["900000"],
      pendingDetailIds: [],
    };
    bundleFailureCycle.history.push({ at: bundleFailureCycle.updatedAt, phase: bundleFailureCycle.phase, reason: "fixture-ready" });
    await writeCycle(stateRoot, bundleFailureCycle);
    const bundleFailure = await runSmokingpipesAutoPublishV2({
      stateRoot,
      runtimeRoot,
      cycleId: bundleFailureId,
      skipSync: true,
      collector: async () => ({ status: "ready-to-bundle", cycle: await readCycle(stateRoot, bundleFailureId), networkAccessed: false }),
      bundleBuilder: async () => { throw new Error("fixture bundle builder failure"); },
    });
    assert.equal(bundleFailure.status, "release-retryable");
    assert.equal(bundleFailure.failureStage, "bundle-build");
    assert.equal(bundleFailure.networkAccessed, false);
    assert.equal(bundleFailure.publishedCount, 0);
    assert.equal(smokingpipesV2ExitCode(bundleFailure.status), 1);
    const retainedBundleFailureCycle = await readCycle(stateRoot, bundleFailureId);
    assert.equal(retainedBundleFailureCycle.phase, "release-retryable");
    assert.equal(retainedBundleFailureCycle.failure.stage, "bundle-build");
    const products = [
      ...Array.from({ length: 48 }, (_, index) => listItem(String(900000 + index))),
      listItem("999999", "Falcon"),
    ];
    const listPath = path.join(temporaryRoot, "list.json");
    await writeJsonAtomic(listPath, trustedSnapshot(products));
    const detailProcessor = async (candidate) => ({
      detail: { sourceProductId: candidate.sourceProductId, title: candidate.listTitle },
      convertedProduct: {
        ...structuredClone(template),
        id: "smokingpipes-" + candidate.sourceProductId,
        sourceProductId: candidate.sourceProductId,
        sourceUrl: candidate.sourceUrl,
        brand: candidate.listBrand || "Test Brand",
        rawTitle: candidate.listTitle,
        fullTitle: candidate.listTitle,
        displayNameEn: candidate.listTitle,
        imageUrl: candidate.listPrimaryImage,
        mainImageUrl: candidate.listPrimaryImage,
        detailImageUrl: candidate.listPrimaryImage,
        galleryImages: [candidate.listPrimaryImage],
        price: {
          ...template.price,
          current: { ...template.price.current, rawText: candidate.listPrice, amount: 120 },
          listPrice: { ...template.price.listPrice, rawText: candidate.listPrice, amount: 120 },
        },
      },
      publicReady: true,
    });

    const first = await runSmokingpipesCollectOnlyV2({
      stateRoot,
      runtimeRoot,
      cycleId: "2030-01-01",
      listInputPath: listPath,
      detailLimit: 24,
      processDetail: detailProcessor,
    });
    assert.equal(first.status, "enriching-details");
    assert.equal(first.cycle.collection.pendingDetailIds.length, 24);
    const second = await runSmokingpipesCollectOnlyV2({
      stateRoot,
      runtimeRoot,
      cycleId: "2030-01-01",
      detailLimit: 24,
      processDetail: detailProcessor,
    });
    assert.equal(second.status, "ready-to-bundle");
    assert.equal(second.networkAccessed, false);
    assert.equal(second.cycle.collection.completedDetailIds.length, 48);
    assert.equal(fs.existsSync(path.join(stateRoot, "details", "900000.json")), true);
    assert.equal(fs.existsSync(path.join(stateRoot, "details", "999999.json")), false);

    const built = await buildSmokingpipesReleaseBundleV2({
      stateRoot,
      cycleId: "2030-01-01",
      baselineRoot: runtimeRoot,
      baseMainSha: "fixture-base",
      generatorCommitSha: "fixture-generator",
      maxAutoApply: 2000,
    });
    assert.equal(built.status, "bundle-ready");
    const validation = await validateSmokingpipesReleaseBundleV2({
      bundleRoot: built.bundleRoot,
      baselineRoot: runtimeRoot,
    });
    assert.equal(validation.valid, true, validation.blockers.join("; "));
    const outputProducts = await readJson(
      path.join(built.bundleRoot, "outputs", "data", "products", "smokingpipes-products.json")
    );
    assert.equal(outputProducts.some((product) => /falcon/i.test(String(product.brand || product.brandName || ""))), false);

    const invalidBundleRoot = path.join(temporaryRoot, "invalid-bundle");
    await writeJsonAtomic(path.join(invalidBundleRoot, "manifest.json"), {
      schemaVersion: "smokingpipes-release-bundle-v2",
      bundleId: "invalid-fixture-bundle",
      baseMainSha: runtimeBaseSha,
      selectedIds: ["invalid-fixture"],
      actualAppliedCount: 1,
      maxAutoApply: 10,
      changeTypeCounts: { other: 1 },
      featuredExcluded: true,
      outputFileHashes: { "data/products/smokingpipes-products.json": "not-a-real-hash" },
    });
    await writeJsonAtomic(path.join(invalidBundleRoot, "summary.json"), {});
    await writeJsonAtomic(path.join(invalidBundleRoot, "changes.json"), []);
    const validatorFailure = runPublisher([
      "-StateRoot", stateRoot,
      "-CycleId", "2030-01-01",
      "-BundleRoot", invalidBundleRoot,
      "-ReleaseRoot", releaseRoot,
      "-RuntimeRoot", workspaceRoot,
    ]);
    assert.notEqual(validatorFailure.status, 0);
    assert.match(`${validatorFailure.stdout}\n${validatorFailure.stderr}`, /release-retryable/);
    assert.equal(git(releaseRoot, ["status", "--short"]), "");

    const publishBundle = await buildSmokingpipesReleaseBundleV2({
      stateRoot,
      cycleId: "2030-01-01",
      runtimeRoot,
      baseMainSha: runtimeBaseSha,
      generatorCommitSha: runtimeBaseSha,
      maxAutoApply: 2000,
    });
    assert.equal(publishBundle.status, "bundle-ready");
    const buildFailure = runPublisher([
      "-StateRoot", stateRoot,
      "-CycleId", "2030-01-01",
      "-BundleRoot", publishBundle.bundleRoot,
      "-ReleaseRoot", releaseRoot,
      "-RuntimeRoot", workspaceRoot,
    ]);
    assert.notEqual(buildFailure.status, 0);
    assert.match(`${buildFailure.stdout}\n${buildFailure.stderr}`, /release-retryable/);
    assert.equal(git(releaseRoot, ["status", "--short"]), "");
    assert.equal(
      git(releaseRoot, ["rev-parse", "HEAD"]),
      git(releaseRoot, ["rev-parse", "origin/main"]),
      `${buildFailure.stdout}\n${buildFailure.stderr}`
    );

    const retainedDetail = await readJson(path.join(stateRoot, "details", "900000.json"));
    const releaseRetry = await readCycle(stateRoot, "2030-01-01");
    assert.equal(releaseRetry.phase, "release-retryable");
    assert.equal((await readJson(path.join(stateRoot, "details", "900000.json"))).sourceProductId, retainedDetail.sourceProductId);
    const retry = await runSmokingpipesCollectOnlyV2({
      stateRoot,
      runtimeRoot,
      cycleId: "2030-01-01",
      detailLimit: 24,
      processDetail: detailProcessor,
    });
    assert.equal(retry.status, "release-resume-required");
    assert.equal(retry.networkAccessed, false);

    const remoteWriter = path.join(temporaryRoot, "remote-writer");
    execFileSync("git", ["clone", bareOrigin, remoteWriter], { stdio: "ignore" });
    git(remoteWriter, ["config", "user.email", "writer@example.invalid"]);
    git(remoteWriter, ["config", "user.name", "Writer"]);
    await writeText(remoteWriter, "remote-advance.txt", "advance\n");
    git(remoteWriter, ["add", "--", "remote-advance.txt"]);
    git(remoteWriter, ["commit", "-m", "fixture remote advance"]);
    git(remoteWriter, ["push", "origin", "HEAD:main"]);
    const staleBase = await runSmokingpipesAutoPublishV2({
      stateRoot,
      runtimeRoot,
      cycleId: "2030-01-01",
      live: false,
      publisher: async ({ bundleRoot }) => {
        assert.equal(bundleRoot, publishBundle.bundleRoot);
        return { status: "stale-base", remoteMainSha: git(runtimeRoot, ["rev-parse", "origin/main"]), exitCode: 2 };
      },
    });
    assert.equal(staleBase.status, "stale-base");
    assert.equal(staleBase.networkAccessed, false);
    assert.equal((await readCycle(stateRoot, "2030-01-01")).phase, "release-retryable");
    assert.equal((await readCycle(stateRoot, "2030-01-01")).failure.stage, "stale-base");
    assert.equal(fs.existsSync(publishBundle.bundleRoot), true);
    const rebuiltAfterStaleBase = await runSmokingpipesAutoPublishV2({
      stateRoot,
      runtimeRoot,
      cycleId: "2030-01-01",
      live: false,
      publisher: async ({ bundleRoot, cycleId }) => {
        const manifest = await readJson(path.join(bundleRoot, "manifest.json"));
        assert.equal(manifest.baseMainSha, git(runtimeRoot, ["rev-parse", "origin/main"]));
        assert.notEqual(bundleRoot, publishBundle.bundleRoot);
        await markSmokingpipesReleaseState({
          stateRoot,
          cycleId,
          bundleId: manifest.bundleId,
          status: "published",
          commitSha: "fixture-stale-base-published",
        });
        return { status: "published", commitSha: "fixture-stale-base-published", exitCode: 0 };
      },
    });
    assert.equal(rebuiltAfterStaleBase.status, "published");
    assert.equal(rebuiltAfterStaleBase.networkAccessed, false);
    assert.equal(git(runtimeRoot, ["status", "--short"]), "");
    assert.equal(git(runtimeRoot, ["rev-parse", "HEAD"]), git(runtimeRoot, ["rev-parse", "origin/main"]));

    const detailFailureId = "2030-01-03";
    const detailFailureList = path.join(temporaryRoot, "detail-failure-list.json");
    await writeJsonAtomic(detailFailureList, trustedSnapshot([listItem("910000")]));
    const failedDetailRun = await runSmokingpipesCollectOnlyV2({
      stateRoot,
      runtimeRoot,
      cycleId: detailFailureId,
      listInputPath: detailFailureList,
      detailLimit: 1,
      processDetail: async () => {
        throw new Error("fixture detail failure");
      },
    });
    assert.equal(failedDetailRun.status, "enriching-details");
    const failedDetailPath = path.join(stateRoot, "details", "910000.json");
    const failedDetail = await readJson(failedDetailPath);
    assert.equal(failedDetail.detailStatus, "blocked");
    const failedPaths = cyclePaths(stateRoot, detailFailureId);
    const retryState = await readJson(failedPaths.legacyProgressiveState);
    retryState.candidates[0].nextEligibleAt = new Date(0).toISOString();
    await writeJsonAtomic(failedPaths.legacyProgressiveState, retryState);
    const resumedDetailRun = await runSmokingpipesCollectOnlyV2({
      stateRoot,
      runtimeRoot,
      cycleId: detailFailureId,
      detailLimit: 1,
      processDetail: detailProcessor,
    });
    assert.equal(resumedDetailRun.status, "ready-to-bundle");
    assert.equal((await readJson(failedDetailPath)).detailStatus, "complete");
    assert.equal(resumedDetailRun.networkAccessed, false);

    const noChangeId = "2030-01-02";
    const { cycle: noChangeCycle } = await loadOrCreateCycle({ stateRoot, cycleId: noChangeId });
    const noChangePaths = cyclePaths(stateRoot, noChangeId);
    await writeJsonAtomic(noChangePaths.legacyProgressiveState, createProgressiveDailyState({ dailyRunId: noChangeId }));
    await writeJsonAtomic(noChangePaths.listManifest, {
      schemaVersion: "smokingpipes-list-manifest-v2",
      snapshotHash: "fixture-snapshot",
    });
    await transitionToReady({ stateRoot, cycleId: noChangeId });
    const noChange = await buildSmokingpipesReleaseBundleV2({
      stateRoot,
      cycleId: noChangeId,
      baselineRoot: runtimeRoot,
      baseMainSha: "fixture-base",
      generatorCommitSha: "fixture-generator",
    });
    assert.equal(noChange.status, "no-change");

    const lockOne = await acquireOwnerTokenLock({ stateRoot, ownerToken: "fixture-owner" });
    const lockTwo = await acquireOwnerTokenLock({ stateRoot, ownerToken: "other-owner" });
    assert.equal(lockOne.acquired, true);
    assert.equal(lockTwo.acquired, false);
    await releaseOwnerTokenLock({ stateRoot, ownerToken: "fixture-owner" });

    const atomicTarget = path.join(stateRoot, "atomic", "value.json");
    await writeJsonAtomic(atomicTarget, { value: 1 });
    assert.deepEqual(await readJson(atomicTarget), { value: 1 });
    const invalid = createCycle({ cycleId: "2030-01-03" });
    await writeCycle(stateRoot, invalid);
    await assert.rejects(
      transitionCycle({ stateRoot, cycle: invalid, phase: "published", reason: "illegal" }),
      /illegal cycle transition/
    );

    // A normal invocation on Aug 1 must resume the incomplete Jul 31 cycle
    // from latest.json and process only its pending details.
    const catchupId = "2026-07-31";
    const catchupListPath = path.join(temporaryRoot, "catchup-list.json");
    await writeJsonAtomic(catchupListPath, trustedSnapshot([listItem("920001"), listItem("920002")]));
    const catchupFirst = await runSmokingpipesCollectOnlyV2({
      stateRoot,
      runtimeRoot,
      cycleId: catchupId,
      listInputPath: catchupListPath,
      detailLimit: 1,
      processDetail: detailProcessor,
    });
    assert.equal(catchupFirst.status, "enriching-details");
    assert.equal(catchupFirst.cycle.collection.pendingDetailIds.length, 1);
    const catchupSecond = await runSmokingpipesAutoPublishV2({
      stateRoot,
      runtimeRoot,
      now: new Date("2026-08-01T02:00:00.000Z"),
      detailLimit: 1,
      noPublish: true,
      skipSync: true,
      processDetail: detailProcessor,
    });
    assert.equal(catchupSecond.cycleId, catchupId);
    assert.equal(catchupSecond.status, "bundle-ready");
    assert.equal(catchupSecond.networkAccessed, false);
    assert.equal(fs.existsSync(path.join(stateRoot, "cycles", "2026-08-01")), false);
    assert.equal(catchupSecond.cycle.collection.pendingDetailIds.length, 0);

    // Terminal latest cycles start the current date, while manual review never
    // silently advances to another cycle.
    await writeCycle(stateRoot, {
      ...catchupSecond.cycle,
      phase: "published",
      updatedAt: "2026-08-01T02:01:00.000Z",
      history: [...catchupSecond.cycle.history, { at: "2026-08-01T02:01:00.000Z", phase: "published", reason: "fixture-terminal" }],
    });
    const terminalResolution = await resolveActiveSmokingpipesCycle({
      stateRoot,
      now: new Date("2026-08-01T03:00:00.000Z"),
    });
    assert.equal(terminalResolution.cycleId, "2026-08-01");
    const tomorrow = await runSmokingpipesCollectOnlyV2({
      stateRoot,
      runtimeRoot,
      now: new Date("2026-08-01T03:00:00.000Z"),
      listInputPath: catchupListPath,
      detailLimit: 2,
      processDetail: detailProcessor,
    });
    assert.equal(tomorrow.cycle.cycleId, "2026-08-01");

    const manualId = "2026-08-02";
    const manual = createCycle({ cycleId: manualId });
    manual.phase = "manual-review-required";
    manual.history.push({ at: manual.updatedAt, phase: manual.phase, reason: "fixture-manual" });
    await writeCycle(stateRoot, manual);
    const manualResult = await runSmokingpipesAutoPublishV2({
      stateRoot,
      runtimeRoot,
      now: new Date("2026-08-03T03:00:00.000Z"),
      skipSync: true,
      preflightOnly: true,
    });
    assert.equal(manualResult.status, "manual-review-required");
    assert.equal(fs.existsSync(path.join(stateRoot, "cycles", "2026-08-03")), false);
    const manualCli = spawnSync(process.execPath, [
      path.join(workspaceRoot, "scripts", "inventory", "smokingpipes-auto-publish-v2.mjs"),
      `--state-root=${stateRoot}`,
      `--runtime-root=${runtimeRoot}`,
      "--preflight-only=true",
      "--skip-sync=true",
    ], { encoding: "utf8", windowsHide: true });
    assert.equal(manualCli.status, 1);
    assert.match(manualCli.stdout, /manual-review-required/);

    const interruptedId = "2026-08-03";
    const { cycle: interruptedNew } = await loadOrCreateCycle({ stateRoot, cycleId: interruptedId });
    let interrupted = await transitionCycle({ stateRoot, cycle: interruptedNew, phase: "collecting-list", reason: "fixture" });
    interrupted = await transitionCycle({ stateRoot, cycle: interrupted, phase: "list-ready", reason: "fixture" });
    interrupted = await transitionCycle({ stateRoot, cycle: interrupted, phase: "ready-to-bundle", reason: "fixture" });
    interrupted = await transitionCycle({
      stateRoot,
      cycle: interrupted,
      phase: "bundle-ready",
      reason: "fixture",
      patch: { bundle: { bundleId: "retained-fixture-bundle", path: "cycles/2026-08-03/bundles/retained-fixture-bundle" } },
    });
    interrupted = await transitionCycle({ stateRoot, cycle: interrupted, phase: "validating-release", reason: "fixture" });
    const recovered = await runSmokingpipesAutoPublishV2({
      stateRoot,
      runtimeRoot,
      now: new Date("2026-08-04T03:00:00.000Z"),
      skipSync: true,
      preflightOnly: true,
    });
    assert.equal(recovered.status, "preflight-passed");
    assert.equal(recovered.cycle.cycleId, interruptedId);
    assert.equal(recovered.cycle.phase, "release-retryable");
    assert.equal(recovered.cycle.failure.stage, "interrupted-validating-release");
    assert.equal(recovered.networkAccessed, false);

    for (const status of [
      "published", "no-change", "same-day-complete", "enriching-details",
      "ready-to-bundle", "bundle-ready", "preflight-passed", "already-running",
    ]) {
      assert.equal(smokingpipesV2ExitCode(status), 0, status);
    }
    for (const status of [
      "collection-retryable", "release-retryable", "manual-review-required", "stale-base",
      "push-retryable", "publisher-output-invalid", "stale-lock-requires-manual-recovery",
      "bundle-validator-failed", "unknown-status",
    ]) {
      assert.equal(smokingpipesV2ExitCode(status), 1, status);
    }

    const notificationStateRoot = path.join(temporaryRoot, "notification-state");
    const notificationCycle = createCycle({ cycleId: "2026-08-04" });
    notificationCycle.phase = "manual-review-required";
    notificationCycle.collection = {
      ...notificationCycle.collection,
      observedCandidateCount: 211,
      completedDetailIds: ["1", "2"],
      pendingDetailIds: ["3"],
      quarantinedDetailIds: ["4"],
    };
    notificationCycle.history.push({ at: notificationCycle.updatedAt, phase: notificationCycle.phase, reason: "fixture-notification" });
    await writeCycle(notificationStateRoot, notificationCycle);
    let notificationCalls = 0;
    const notified = await runSmokingpipesAutoPublishV2({
      stateRoot: notificationStateRoot,
      runtimeRoot,
      skipSync: true,
      notificationsEnabled: true,
      notifier: async () => {
        notificationCalls += 1;
        return { notificationSent: true, notificationReason: "fixture-sent" };
      },
    });
    assert.equal(notified.status, "manual-review-required");
    assert.equal(notificationCalls, 1);
    assert.equal(notified.notificationFailed, false);
    const notificationFailure = await runSmokingpipesAutoPublishV2({
      stateRoot: notificationStateRoot,
      runtimeRoot,
      skipSync: true,
      notificationsEnabled: true,
      notifier: async () => { throw new Error("fixture PushDeer failure"); },
    });
    assert.equal(notificationFailure.status, "manual-review-required");
    assert.equal(notificationFailure.notificationFailed, true);
    assert.match(notificationFailure.notificationReason, /fixture PushDeer failure/);
    const detailMessage = buildSmokingpipesV2Notification({
      status: "enriching-details",
      cycleId: notificationCycle.cycleId,
      cycle: notificationCycle,
      networkAccessed: false,
    }).body;
    assert.match(detailMessage, /待处理详情: 1/);
    assert.match(detailMessage, /下一窗口/);

    // Publisher E2E: a bundle can own many output files while only the files
    // whose content changed are staged. Hashes are verified on both sides of
    // the copy, empty staged diffs block, and injected unexpected staging is
    // rejected and cleaned from the temporary release clone.
    const subsetRoot = path.join(temporaryRoot, "publisher-subset");
    const subsetSource = path.join(subsetRoot, "source");
    const subsetBare = path.join(subsetRoot, "origin.git");
    const subsetRelease = path.join(subsetRoot, "release");
    const subsetBundleRoot = path.join(subsetRoot, "bundle");
    const fakeRuntimeRoot = path.join(subsetRoot, "runtime");
    const subsetStateRoot = path.join(subsetRoot, "state");
    const ownedFiles = [
      "data/products/smokingpipes-products.json",
      "data/products/unified-products-staging.json",
      "data/generated/public-products/catalog.json",
      "data/generated/public-products/filters.json",
      "data/generated/public-products/brands.json",
      "data/generated/public-products/detail-lookup.json",
      "data/generated/public-products/recent-new.json",
      "data/generated/public-products/manifest.json",
    ];
    const baselineOutputs = Object.fromEntries(ownedFiles.map((file) => [file, { file, version: "baseline" }]));
    for (const [file, value] of Object.entries(baselineOutputs)) {
      await writeJsonAtomic(path.join(subsetSource, file), value);
    }
    await writeText(subsetSource, "scripts/validate-public-product-indexes-v1.mjs", [
      'import fs from "node:fs";',
      'import path from "node:path";',
      'import { execFileSync } from "node:child_process";',
      'if (process.env.SMOKINGPIPES_TEST_STAGE_UNEXPECTED === "1") {',
      '  const root = process.env.SMOKINGPIPES_TEST_RELEASE_ROOT;',
      '  fs.writeFileSync(path.join(root, "unexpected.txt"), "unexpected\\n");',
      '  execFileSync("git", ["-C", root, "add", "--", "unexpected.txt"]);',
      '}',
    ].join("\n"));
    await writeText(subsetSource, "scripts/test-public-products-inventory-default-v1.mjs", "process.exit(0);\n");
    await writeText(subsetSource, "package.json", JSON.stringify({ private: true, type: "module", scripts: { build: "node -e \"process.exit(0)\"" } }));
    git(temporaryRoot, ["init", "--initial-branch=main", subsetSource]);
    git(subsetSource, ["config", "user.email", "fixture@example.invalid"]);
    git(subsetSource, ["config", "user.name", "Fixture"]);
    git(subsetSource, ["add", "--", "."]);
    git(subsetSource, ["commit", "-m", "subset baseline"]);
    const subsetBaseSha = git(subsetSource, ["rev-parse", "HEAD"]);
    execFileSync("git", ["clone", "--bare", subsetSource, subsetBare], { stdio: "ignore" });
    execFileSync("git", ["clone", subsetBare, subsetRelease], { stdio: "ignore" });
    git(subsetRelease, ["config", "user.email", "fixture@example.invalid"]);
    git(subsetRelease, ["config", "user.name", "Fixture"]);
    await writeText(fakeRuntimeRoot, "scripts/inventory/validate-smokingpipes-release-bundle-v2.mjs", "process.exit(0);\n");
    await writeText(fakeRuntimeRoot, "scripts/inventory/smokingpipes-release-state-v2.mjs", "process.exit(0);\n");

    async function writeFixtureBundle(bundleRoot, outputValues, baseMainSha, bundleId) {
      const outputFileHashes = {};
      for (const [file, value] of Object.entries(outputValues)) {
        const target = path.join(bundleRoot, "outputs", file);
        await writeJsonAtomic(target, value);
        outputFileHashes[file] = await hashFile(target);
      }
      await writeJsonAtomic(path.join(bundleRoot, "manifest.json"), {
        bundleId,
        baseMainSha,
        actualAppliedCount: 2,
        outputFileHashes,
      });
      return outputFileHashes;
    }

    const changedFiles = ownedFiles.slice(0, 2);
    const subsetOutputs = structuredClone(baselineOutputs);
    for (const file of changedFiles) subsetOutputs[file] = { file, version: "changed" };
    const subsetHashes = await writeFixtureBundle(subsetBundleRoot, subsetOutputs, subsetBaseSha, "subset-bundle");
    const subsetPublish = runPublisher([
      "-StateRoot", subsetStateRoot,
      "-CycleId", "2030-02-01",
      "-BundleRoot", subsetBundleRoot,
      "-ReleaseRoot", subsetRelease,
      "-RuntimeRoot", fakeRuntimeRoot,
    ]);
    assert.equal(subsetPublish.status, 0, `${subsetPublish.stdout}\n${subsetPublish.stderr}`);
    const subsetPayload = lastJson(subsetPublish.stdout);
    assert.equal(Array.isArray(subsetPayload.stagedFiles), true, JSON.stringify(subsetPayload));
    assert.deepEqual([...subsetPayload.stagedFiles].sort(), [...changedFiles].sort());
    for (const [file, expectedHash] of Object.entries(subsetHashes)) {
      assert.equal(await hashFile(path.join(subsetRelease, file)), expectedHash, file);
    }
    assert.equal(git(subsetRelease, ["status", "--short"]), "");

    const emptyBundleRoot = path.join(subsetRoot, "empty-bundle");
    await writeFixtureBundle(
      emptyBundleRoot,
      subsetOutputs,
      git(subsetRelease, ["rev-parse", "origin/main"]),
      "empty-bundle"
    );
    const emptyPublish = runPublisher([
      "-StateRoot", subsetStateRoot,
      "-CycleId", "2030-02-02",
      "-BundleRoot", emptyBundleRoot,
      "-ReleaseRoot", subsetRelease,
      "-RuntimeRoot", fakeRuntimeRoot,
    ]);
    assert.notEqual(emptyPublish.status, 0);
    assert.match(`${emptyPublish.stdout}\n${emptyPublish.stderr}`, /bundle has no staged product change/);
    assert.equal(git(subsetRelease, ["status", "--short"]), "");

    const unexpectedBundleRoot = path.join(subsetRoot, "unexpected-bundle");
    const unexpectedOutputs = structuredClone(subsetOutputs);
    for (const file of changedFiles) unexpectedOutputs[file] = { file, version: "changed-again" };
    await writeFixtureBundle(
      unexpectedBundleRoot,
      unexpectedOutputs,
      git(subsetRelease, ["rev-parse", "origin/main"]),
      "unexpected-bundle"
    );
    const unexpectedPublish = runPublisher([
      "-StateRoot", subsetStateRoot,
      "-CycleId", "2030-02-03",
      "-BundleRoot", unexpectedBundleRoot,
      "-ReleaseRoot", subsetRelease,
      "-RuntimeRoot", fakeRuntimeRoot,
    ], {
      env: {
        SMOKINGPIPES_TEST_STAGE_UNEXPECTED: "1",
        SMOKINGPIPES_TEST_RELEASE_ROOT: subsetRelease,
      },
    });
    assert.notEqual(unexpectedPublish.status, 0);
    assert.match(`${unexpectedPublish.stdout}\n${unexpectedPublish.stderr}`, /staged file whitelist mismatch; unexpected=unexpected.txt/);
    assert.equal(git(subsetRelease, ["status", "--short"]), "");

    const autoPublishScript = await fs.promises.readFile(
      path.join(workspaceRoot, "scripts", "inventory", "run-smokingpipes-auto-publish.ps1"),
      "utf8"
    );
    assert.equal(autoPublishScript.includes("test-inventory-runner-v1.mjs"), false);
    console.log("Smokingpipes V2 pipeline E2E passed");
  } finally {
    await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
