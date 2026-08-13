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
  collectionSummary,
  SMOKINGPIPES_V2_DETAIL_PACING,
  SMOKINGPIPES_V2_LIST_MAX_PAGES,
  trustedListReason,
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
  parseSmokingpipesPublisherResult,
  buildSmokingpipesV2Notification,
  smokingpipesV2ExitCode,
} from "./smokingpipes-auto-publish-v2.mjs";
import {
  createProgressiveDailyState,
} from "./smokingpipes-progressive-state-v1.mjs";
import {
  buildInventoryDiff,
} from "./smokingpipes-diff-inventory-v1.mjs";
import {
  ingestProgressiveListSnapshot,
} from "./smokingpipes-progressive-daily-v1.mjs";
import {
  SP_CHROME_V2_PROFILE_NAME,
  buildSmokingpipesBrowserDescriptor,
} from "../lib/smokingpipes-browser-profile-v1.mjs";

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

function runPublisher(arguments_, { env = {}, cwd = workspaceRoot } = {}) {
  return spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join(workspaceRoot, "scripts", "inventory", "publish-smokingpipes-release-bundle-v2.ps1"),
    ...arguments_,
  ], { encoding: "utf8", windowsHide: true, cwd, env: { ...process.env, ...env } });
}

function lastJson(stdout) {
  return parseSmokingpipesPublisherResult(`ordinary log\n${stdout}`);
}

function trustedSnapshot(products, { summary = {}, pages = null, config = null } = {}) {
  const anchoredProducts = products.some((product) => product.sourceProductId === "109736")
    ? products
    : [trustedExistingListItem(), ...products];
  return {
    version: "smokingpipes-current-list-dry-run-v1",
    source: "smokingpipes",
    ...(pages ? { pages } : {}),
    ...(config ? { config } : {}),
    products: anchoredProducts,
    summary: {
      expectedPages: 2,
      effectiveScannedPages: 2,
      detectedTotalPages: 2,
      detectionConfidence: "high",
      fullExpectedRangeScanned: true,
      failedPages: [],
      captchaDetected: false,
      verificationDetected: false,
      ...summary,
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

function trustedExistingListItem() {
  return {
    source: "smokingpipes",
    sourceProductId: "109736",
    sourceUrl: "https://www.smokingpipes.com/pipes/new/Missourimeerschaum/moreinfo.cfm?product_id=109736",
    title: "Missouri Pride Straight (6mm) Tobacco Pipe",
    rawTitle: "Missouri Pride Straight (6mm) Tobacco Pipe",
    brand: "Missouri Meerschaum",
    price: "$8.63",
    image: "https://c647068.ssl.cf2.rackcdn.com/products/002-543-0001.jpg",
    mainImage: "https://c647068.ssl.cf2.rackcdn.com/products/002-543-0001.jpg",
    listPage: 1,
    listPosition: 1,
  };
}

async function transitionToReady({ stateRoot, cycleId }) {
  let cycle = await readCycle(stateRoot, cycleId);
  cycle = await transitionCycle({ stateRoot, cycle, phase: "collecting", reason: "fixture" });
  return transitionCycle({ stateRoot, cycle, phase: "ready", reason: "fixture" });
}

async function main() {
  const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "smokingpipes-v2-e2e-"));
  const runtimeRoot = path.join(temporaryRoot, "runtime");
  const stateRoot = path.join(temporaryRoot, "state");
  try {
    const dedicatedBrowser = buildSmokingpipesBrowserDescriptor({
      browserChannel: "chrome",
      browserProfile: SP_CHROME_V2_PROFILE_NAME,
      localAppData: path.join(temporaryRoot, "local-app-data"),
    });
    assert.equal(dedicatedBrowser.profileDir, path.join(temporaryRoot, "local-app-data", "YandouBuy", "chrome-profile-sp-v2"));
    assert.equal(dedicatedBrowser.persistentContext, true);
    assert.equal(dedicatedBrowser.headless, false);
    assert.equal(/Google[\\/]Chrome[\\/]User Data/i.test(dedicatedBrowser.profileDir), false);
    const v2CollectorSource = await fs.promises.readFile(
      path.join(workspaceRoot, "scripts", "inventory", "smokingpipes-collect-only-v2.mjs"),
      "utf8"
    );
    assert.match(v2CollectorSource, /browserProfile: "sp-chrome-v2"/);
    assert.match(v2CollectorSource, /allowManualVerification: true/);
    assert.match(v2CollectorSource, /Math\.min\(50, Math\.max\(1, Number\(detailLimit\) \|\| 50\)\)/);
    assert.match(v2CollectorSource, /allowLegacyDuplicateSnapshotOverride: false/);
    assert.equal(v2CollectorSource.includes("smokingpipes-progressive-runner-v1.mjs"), false);
    const v2DetailEnricherSource = await fs.promises.readFile(
      path.join(workspaceRoot, "scripts", "inventory", "smokingpipes-detail-enricher-v2.mjs"),
      "utf8"
    );
    assert.equal(v2DetailEnricherSource.includes("smokingpipes-progressive-runner-v1.mjs"), false);
    const template = structuredClone(
      (await readWorkspaceJson("data/products/smokingpipes-products.json"))[0]
    );
    template.inventoryStatus = "available";
    await writeJsonAtomic(
      path.join(runtimeRoot, "data", "products", "smokingpipes-products.json"),
      [
        template,
        ...Array.from({ length: 500 }, (_, index) => ({
          ...structuredClone(template),
          id: `smokingpipes-sold-${index}`,
          sourceProductId: `sold-${index}`,
          sourceUrl: `https://example.test/sold-${index}`,
          inventoryStatus: "sold",
        })),
      ]
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

    const deadlineCycleId = "2030-01-06";
    const deadlineStateRoot = path.join(temporaryRoot, "deadline-state");
    const deadlineCycle = createCycle({ cycleId: deadlineCycleId });
    deadlineCycle.phase = "ready";
    deadlineCycle.history.push({ at: deadlineCycle.updatedAt, phase: deadlineCycle.phase, reason: "fixture-ready" });
    await writeCycle(deadlineStateRoot, deadlineCycle);
    let deadlineClockCalls = 0;
    const deadlineResult = await runSmokingpipesAutoPublishV2({
      stateRoot: deadlineStateRoot,
      runtimeRoot,
      cycleId: deadlineCycleId,
      skipSync: true,
      timeoutSeconds: 1,
      nowMs: () => (deadlineClockCalls++ === 0 ? 0 : 1001),
      collector: async () => ({ status: "ready-to-bundle", cycle: await readCycle(deadlineStateRoot, deadlineCycleId), networkAccessed: false }),
      bundleBuilder: async () => {
        throw new Error("deadline must prevent bundle/release work");
      },
    });
    assert.equal(deadlineResult.status, "release-retryable");
    assert.equal(deadlineResult.failureStage, "daily-timeout");

    const bundleFailureId = "2030-01-05";
    const bundleFailureCycle = createCycle({ cycleId: bundleFailureId });
    bundleFailureCycle.phase = "ready";
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
    assert.equal(retainedBundleFailureCycle.phase, "retryable");
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

    // A live V2 Daily owns one native session for List and Detail. The
    // Collector never falls back to a Playwright launch when native startup
    // fails; it preserves retryable state with an explicit failure stage.
    const nativeFailureStateRoot = path.join(temporaryRoot, "native-cdp-failure-state");
    const nativeFailureResult = await runSmokingpipesCollectOnlyV2({
      stateRoot: nativeFailureStateRoot,
      runtimeRoot,
      cycleId: "2030-01-09",
      live: true,
      launchBrowserSession: async () => {
        throw Object.assign(new Error("fixture CDP endpoint unavailable"), {
          code: "BROWSER_NATIVE_CDP_FAILED",
        });
      },
      fetchCurrentList: async () => {
        throw new Error("native startup failure must not fetch the source");
      },
    });
    assert.equal(nativeFailureResult.status, "collection-retryable");
    assert.equal(nativeFailureResult.cycle.phase, "retryable");
    assert.equal(nativeFailureResult.cycle.failure.stage, "browser-native-cdp-failed");

    const sharedNativeStateRoot = path.join(temporaryRoot, "native-cdp-shared-state");
    let sharedNativeLaunches = 0;
    let sharedNativeCloses = 0;
    let listNativeSession = null;
    const sharedNativeSession = {
      context: { pages: () => [] },
      async close() { sharedNativeCloses += 1; },
    };
    const sharedNativeResult = await runSmokingpipesCollectOnlyV2({
      stateRoot: sharedNativeStateRoot,
      runtimeRoot,
      cycleId: "2030-01-10",
      live: true,
      detailLimit: 50,
      launchBrowserSession: async () => {
        sharedNativeLaunches += 1;
        return sharedNativeSession;
      },
      fetchCurrentList: async ({ browserSession }) => {
        listNativeSession = browserSession;
        return readJson(listPath);
      },
      processDetail: detailProcessor,
    });
    assert.equal(sharedNativeResult.status, "ready-to-bundle");
    assert.equal(sharedNativeLaunches, 1);
    assert.equal(listNativeSession, sharedNativeSession);
    assert.equal(sharedNativeCloses, 1);

    const detailStatistics = collectionSummary({
      candidates: [
        { sourceProductId: "new-complete", changeTypes: ["new-product"], detailStatus: "complete" },
        { sourceProductId: "new-pending", changeTypes: ["new-product"], detailStatus: "pending" },
        { sourceProductId: "sold-complete", changeTypes: ["explicit-out-of-stock"], detailStatus: "complete" },
        { sourceProductId: "price-complete", changeTypes: ["price-change"], detailStatus: "complete" },
        { sourceProductId: "reappeared-complete", changeTypes: ["reappeared"], detailStatus: "complete" },
      ],
    });
    assert.equal(detailStatistics.completedDetailIds.length, 1);
    assert.equal(detailStatistics.pendingDetailIds.length, 1);
    assert.equal(detailStatistics.completedWithoutDetailCount, 3);

    const incompleteThreePageSnapshot = trustedSnapshot([listItem("incomplete-three")], {
      config: { maxPages: 3, requestedMaxPages: 3 },
      summary: {
        expectedPages: 3,
        pagesScanned: 3,
        effectiveScannedPages: 3,
        detectedTotalPages: null,
        detectionConfidence: "low",
        paginationLinksFound: 0,
        normalEndOfListConfirmed: false,
        normalEndOfListPage: null,
      },
    });
    assert.match(
      trustedListReason(incompleteThreePageSnapshot),
      /no trusted pagination total or normal end-of-list evidence/
    );
    const incompleteThreePath = path.join(temporaryRoot, "incomplete-three.json");
    await writeJsonAtomic(incompleteThreePath, incompleteThreePageSnapshot);
    const incompleteThreeResult = await runSmokingpipesCollectOnlyV2({
      stateRoot,
      runtimeRoot,
      cycleId: "2030-01-06",
      listInputPath: incompleteThreePath,
      processDetail: async () => {
        throw new Error("untrusted list must not process details");
      },
    });
    assert.equal(incompleteThreeResult.status, "collection-retryable");
    assert.equal(incompleteThreeResult.cycle.phase, "retryable");
    assert.equal(fs.existsSync(path.join(stateRoot, "cycles", "2030-01-06", "bundles")), false);

    const detectedPaginationSnapshot = trustedSnapshot([listItem("detected-pagination")], {
      summary: {
        expectedPages: 105,
        effectiveScannedPages: 105,
        detectedTotalPages: 105,
        detectionConfidence: "high",
      },
    });
    assert.equal(trustedListReason(detectedPaginationSnapshot), null);

    const normalEndOfListSnapshot = trustedSnapshot([listItem("normal-end")], {
      pages: Array.from({ length: 104 }, (_, index) => ({ page: index + 1 })),
      summary: {
        expectedPages: 104,
        effectiveScannedPages: 104,
        detectedTotalPages: null,
        detectionConfidence: "low",
        normalEndOfListConfirmed: true,
        normalEndOfListPage: 105,
      },
    });
    assert.equal(trustedListReason(normalEndOfListSnapshot), null);

    // V2 must not inherit V1's one-off duplicate snapshot SHA exception. A
    // single unclassified duplicate remains a List-integrity blocker even for
    // a very large snapshot, while classified safe pagination duplicates pass.
    const legacyDuplicateSnapshot = trustedSnapshot(
      Array.from({ length: 5000 }, (_, index) => listItem(`duplicate-${index}`)),
      { summary: { duplicateSourceProductIds: ["duplicate-1"] } }
    );
    const v2DuplicateDiff = buildInventoryDiff(
      legacyDuplicateSnapshot,
      { products: [template] },
      {
        maxAutoApply: 10000,
        snapshotSha256: "legacy-authorization-must-not-be-used",
        legacyDuplicateSnapshotSha256: "legacy-authorization-must-not-be-used",
        allowLegacyDuplicateSnapshotOverride: false,
      }
    );
    assert.equal(v2DuplicateDiff.legacyDuplicateOverride, null);
    assert.equal(v2DuplicateDiff.counts.suspiciousDuplicates, 1);
    assert.match(
      trustedListReason(legacyDuplicateSnapshot, v2DuplicateDiff),
      /suspicious duplicate source product IDs/
    );
    const safePaginationDuplicateSnapshot = trustedSnapshot([listItem("safe-duplicate")], {
      summary: {
        duplicateSourceProductIds: ["safe-duplicate"],
        duplicateStats: {
          totalDuplicateIds: 1,
          safeDuplicateCount: 1,
          suspiciousDuplicateCount: 0,
          safeDuplicateIds: ["safe-duplicate"],
          suspiciousDuplicateIds: [],
        },
      },
    });
    assert.equal(
      trustedListReason(safePaginationDuplicateSnapshot, {
        counts: { suspiciousDuplicates: 0 },
        fatalWarnings: [],
      }),
      null
    );

    const oosRegressionId = "oos-regression";
    const availableOosItem = listItem(oosRegressionId);
    const explicitOosItem = {
      ...availableOosItem,
      rawListStatus: "SOLD OUT",
      rawText: "SOLD OUT",
    };
    const soldProduction = {
      ...structuredClone(template),
      id: `smokingpipes-${oosRegressionId}`,
      sourceProductId: oosRegressionId,
      sourceUrl: availableOosItem.sourceUrl,
      inventoryStatus: "sold",
    };
    const availableProduction = {
      ...soldProduction,
      inventoryStatus: "available",
    };
    const oosSummary = {
      expectedPages: 1,
      pagesScanned: 1,
      fullExpectedRangeScanned: true,
      captchaDetected: false,
      verificationDetected: false,
    };
    const availableReappearedDiff = buildInventoryDiff(
      { products: [availableOosItem], summary: oosSummary },
      { products: [soldProduction] }
    );
    assert.deepEqual(availableReappearedDiff.reappearedIds, [oosRegressionId]);
    const explicitOosDiff = buildInventoryDiff(
      { products: [explicitOosItem], summary: oosSummary },
      { products: [soldProduction] }
    );
    assert.deepEqual(explicitOosDiff.reappearedIds, []);
    const reappearedState = ingestProgressiveListSnapshot({
      state: createProgressiveDailyState({
        dailyRunId: "oos-reappeared-available",
        expectedPages: 1,
        now: "2030-01-01T00:00:00.000Z",
      }),
      currentPayload: { products: [availableOosItem], summary: oosSummary },
      diffPayload: availableReappearedDiff,
      productionProducts: [soldProduction],
      runId: "oos-reappeared-available",
      now: "2030-01-01T00:00:00.000Z",
    });
    assert.ok(reappearedState.candidates[0].changeTypes.includes("reappeared"));
    const firstExplicitOosState = ingestProgressiveListSnapshot({
      state: createProgressiveDailyState({
        dailyRunId: "oos-explicit-first",
        expectedPages: 1,
        now: "2030-01-01T00:00:00.000Z",
      }),
      currentPayload: { products: [explicitOosItem], summary: oosSummary },
      diffPayload: buildInventoryDiff(
        { products: [explicitOosItem], summary: oosSummary },
        { products: [availableProduction] }
      ),
      productionProducts: [availableProduction],
      runId: "oos-explicit-first",
      now: "2030-01-01T00:00:00.000Z",
    });
    assert.ok(firstExplicitOosState.candidates[0].changeTypes.includes("explicit-out-of-stock"));
    assert.equal(firstExplicitOosState.candidates[0].changeTypes.includes("reappeared"), false);
    assert.equal(firstExplicitOosState.candidates[0].inventoryStatus, "sold");
    const secondExplicitOosState = ingestProgressiveListSnapshot({
      state: firstExplicitOosState,
      currentPayload: { products: [explicitOosItem], summary: oosSummary },
      diffPayload: explicitOosDiff,
      productionProducts: [soldProduction],
      runId: "oos-explicit-second",
      now: "2030-01-01T01:00:00.000Z",
    });
    assert.ok(secondExplicitOosState.candidates[0].changeTypes.includes("explicit-out-of-stock"));
    assert.equal(secondExplicitOosState.candidates[0].changeTypes.includes("reappeared"), false);
    assert.equal(secondExplicitOosState.candidates[0].inventoryStatus, "sold");

    const cappedWithoutEndSnapshot = trustedSnapshot([listItem("capped-without-end")], {
      config: { maxPages: 200, requestedMaxPages: 200 },
      summary: {
        expectedPages: 200,
        effectiveScannedPages: 200,
        detectedTotalPages: null,
        detectionConfidence: "low",
        normalEndOfListConfirmed: false,
        normalEndOfListPage: null,
      },
    });
    assert.match(
      trustedListReason(cappedWithoutEndSnapshot),
      /no trusted pagination total or normal end-of-list evidence/
    );
    assert.match(
      trustedListReason(detectedPaginationSnapshot, { fatalWarnings: ["fixture"] }),
      /fatal warnings/
    );
    assert.equal(SMOKINGPIPES_V2_LIST_MAX_PAGES, 200);
    assert.deepEqual(SMOKINGPIPES_V2_DETAIL_PACING, {
      detailWarmupMinMs: 4000,
      detailWarmupMaxMs: 10000,
      detailBatchSize: 20,
      detailBatchCooldownMinMs: 30000,
      detailBatchCooldownMaxMs: 60000,
    });

    const first = await runSmokingpipesCollectOnlyV2({
      stateRoot,
      runtimeRoot,
      cycleId: "2030-01-01",
      listInputPath: listPath,
      detailLimit: 24,
      processDetail: detailProcessor,
    });
    assert.equal(first.status, "enriching-details", first.error);
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
    assert.equal(second.cycle.collection.completedDetailIds.length, 48, JSON.stringify(second.cycle.collection));
    assert.equal(fs.existsSync(path.join(stateRoot, "details", "900000.json")), true);
    assert.equal(fs.existsSync(path.join(stateRoot, "details", "999999.json")), false);

    // A Daily invocation is permanently capped to one 50-item Detail chunk,
    // even when the caller asks for more work. The remaining queue must be
    // retained for a later natural invocation rather than drained in a loop.
    const fiftyItemStateRoot = path.join(temporaryRoot, "fifty-item-detail-state");
    const fiftyItemListPath = path.join(temporaryRoot, "fifty-item-detail-list.json");
    const fiftyItemIds = Array.from({ length: 120 }, (_, index) => String(950000 + index));
    await writeJsonAtomic(fiftyItemListPath, trustedSnapshot(fiftyItemIds.map((id) => listItem(id))));
    let fiftyItemDetailRequests = 0;
    const fiftyItemRun = await runSmokingpipesCollectOnlyV2({
      stateRoot: fiftyItemStateRoot,
      runtimeRoot,
      cycleId: "2030-01-07",
      listInputPath: fiftyItemListPath,
      detailLimit: 120,
      processDetail: async (candidate) => {
        fiftyItemDetailRequests += 1;
        return detailProcessor(candidate);
      },
    });
    assert.equal(fiftyItemRun.status, "enriching-details");
    assert.equal(fiftyItemRun.cycle.phase, "details");
    assert.equal(fiftyItemDetailRequests, 50);
    assert.equal(fiftyItemRun.cycle.collection.completedDetailIds.length, 50);
    assert.equal(fiftyItemRun.cycle.collection.pendingDetailIds.length, 70);

    // A deadline stops before the next Detail begins, persists the already
    // completed checkpoint, and leaves the remaining queue for a later Daily.
    const detailDeadlineStateRoot = path.join(temporaryRoot, "detail-deadline-state");
    let detailDeadlineNow = 0;
    let detailDeadlineRequests = 0;
    const detailDeadlineResult = await runSmokingpipesCollectOnlyV2({
      stateRoot: detailDeadlineStateRoot,
      runtimeRoot,
      cycleId: "2030-01-08",
      listInputPath: listPath,
      detailLimit: 50,
      deadline: { deadlineAtMs: 100, nowMs: () => detailDeadlineNow },
      processDetail: async (candidate) => {
        detailDeadlineRequests += 1;
        detailDeadlineNow = 100;
        return detailProcessor(candidate);
      },
    });
    assert.equal(detailDeadlineResult.status, "enriching-details", JSON.stringify(detailDeadlineResult));
    assert.equal(detailDeadlineResult.cycle.phase, "retryable");
    assert.equal(detailDeadlineRequests, 1);
    assert.equal(detailDeadlineResult.cycle.collection.completedDetailIds.length, 1);
    assert.equal(detailDeadlineResult.cycle.collection.pendingDetailIds.length, 47);
    assert.equal(detailDeadlineResult.cycle.failure.stage, "daily-deadline");

    const legacyBaselineRoot = path.join(temporaryRoot, "legacy-falcon-baseline");
    const legacyFalcon = {
      ...structuredClone(template),
      id: "smokingpipes-legacy-falcon",
      sourceProductId: "legacy-falcon",
      brand: "Falcon",
      brandName: "Falcon",
    };
    await writeJsonAtomic(
      path.join(legacyBaselineRoot, "data", "products", "smokingpipes-products.json"),
      [legacyFalcon]
    );
    await writeJsonAtomic(
      path.join(legacyBaselineRoot, "data", "products", "danish-products.json"),
      []
    );
    const built = await buildSmokingpipesReleaseBundleV2({
      stateRoot,
      cycleId: "2030-01-01",
      baselineRoot: legacyBaselineRoot,
      baseMainSha: "fixture-base",
      generatorCommitSha: "fixture-generator",
      maxAutoApply: 2000,
    });
    assert.equal(built.status, "bundle-ready");
    const validation = await validateSmokingpipesReleaseBundleV2({
      bundleRoot: built.bundleRoot,
      baselineRoot: legacyBaselineRoot,
    });
    assert.equal(validation.valid, true, validation.blockers.join("; "));
    assert.equal(built.manifest.selectedIds.includes("legacy-falcon"), true);
    const outputProducts = await readJson(
      path.join(built.bundleRoot, "outputs", "data", "products", "smokingpipes-products.json")
    );
    const publicManifest = await readJson(
      path.join(built.bundleRoot, "outputs", "data", "generated", "public-products", "manifest.json")
    );
    const stagingPath = path.join(built.bundleRoot, "outputs", "data", "products", "unified-products-staging.json");
    assert.equal(publicManifest.generatorVersion, "smokingpipes-release-bundle-v2");
    assert.equal(publicManifest.inputHashes, undefined);
    assert.ok(Array.isArray(built.manifest.outputFiles));
    assert.ok(built.manifest.outputFiles.includes("data/products/unified-products-staging.json"));
    assert.equal(outputProducts.some((product) => /falcon/i.test(String(product.brand || product.brandName || ""))), false);
    // An innocuous formatting-only byte change is not a publishing gate. The
    // final validator evaluates the rebuilt product structure and diff, not a
    // SHA authorization token.
    await fs.promises.appendFile(stagingPath, "\n", "utf8");
    const formattingOnlyValidation = await validateSmokingpipesReleaseBundleV2({
      bundleRoot: built.bundleRoot,
      baselineRoot: legacyBaselineRoot,
    });
    assert.equal(formattingOnlyValidation.valid, true, formattingOnlyValidation.blockers.join("; "));

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
      outputFiles: ["data/products/smokingpipes-products.json"],
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
    assert.equal(releaseRetry.phase, "ready");
    await transitionCycle({ stateRoot, cycle: releaseRetry, phase: "retryable", reason: "fixture-orchestrator-retry" });
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

    async function createRetainedBundleFixture({ cycleId, count, legacyGeneratorCommitSha }) {
      const listInputPath = path.join(temporaryRoot, `${cycleId}-list.json`);
      const ids = Array.from({ length: count }, (_, index) => String(930000 + index));
      await writeJsonAtomic(listInputPath, trustedSnapshot(ids.map((id) => listItem(id))));
      let collected = await runSmokingpipesCollectOnlyV2({
        stateRoot,
        runtimeRoot,
        cycleId,
        listInputPath,
        detailLimit: count,
        processDetail: detailProcessor,
      });
      if (count > 50) {
        // Separate scheduled invocations may continue a retained queue. Each
        // invocation remains exactly one protected 50-detail chunk.
        assert.equal(collected.status, "enriching-details", JSON.stringify(collected.cycle?.collection));
        assert.equal(collected.cycle.collection.completedDetailIds.length, 50);
        collected = await runSmokingpipesCollectOnlyV2({
          stateRoot,
          runtimeRoot,
          cycleId,
          detailLimit: count,
          processDetail: detailProcessor,
        });
      }
      assert.equal(collected.status, "ready-to-bundle", JSON.stringify(collected.cycle?.collection));
      assert.equal(collected.networkAccessed, false);
      assert.equal(collected.cycle.collection.completedDetailIds.length, count);
      assert.equal(collected.cycle.collection.pendingDetailIds.length, 0);
      const retained = await buildSmokingpipesReleaseBundleV2({
        stateRoot,
        cycleId,
        runtimeRoot,
        baseMainSha: runtimeBaseSha,
        generatorCommitSha: legacyGeneratorCommitSha,
        maxAutoApply: 2000,
      });
      assert.deepEqual(
        retained.cycle.bundle.changeTypeCounts,
        retained.manifest.changeTypeCounts
      );
      let retryCycle = await readCycle(stateRoot, cycleId);
      retryCycle = await transitionCycle({
        stateRoot,
        cycle: retryCycle,
        phase: "retryable",
        reason: "fixture-retained-bundle-retry",
        patch: { failure: { stage: "release-retryable", message: "fixture retained bundle retry" } },
      });
      return { retained, retryCycle };
    }

    function offlineResumeCollector(cycleId, counters) {
      return async (arguments_) => {
        counters.collector += 1;
        const resumed = await runSmokingpipesCollectOnlyV2({
          ...arguments_,
          cycleId,
          live: false,
          processDetail: async () => {
            counters.details += 1;
            throw new Error("retained bundle resume must not process details");
          },
        });
        assert.equal(resumed.status, "release-resume-required");
        assert.equal(resumed.networkAccessed, false);
        return resumed;
      };
    }

    const validRetainedId = "2030-01-09";
    const validRetained = await createRetainedBundleFixture({
      cycleId: validRetainedId,
      count: 1,
      legacyGeneratorCommitSha: "legacy-builder-valid-retained",
    });
    const validRetainedCounters = { collector: 0, details: 0, builder: 0, publisher: 0 };
    const validRetainedResult = await runSmokingpipesAutoPublishV2({
      stateRoot,
      runtimeRoot,
      cycleId: validRetainedId,
      skipSync: true,
      live: false,
      collector: offlineResumeCollector(validRetainedId, validRetainedCounters),
      bundleBuilder: async () => {
        validRetainedCounters.builder += 1;
        throw new Error("valid retained bundle must not rebuild");
      },
      publisher: async ({ bundleRoot }) => {
        validRetainedCounters.publisher += 1;
        assert.equal(bundleRoot, validRetained.retained.bundleRoot);
        return { status: "published", commitSha: "fixture-valid-retained-published", exitCode: 0 };
      },
    });
    assert.equal(validRetainedResult.status, "published");
    assert.deepEqual(validRetainedCounters, { collector: 1, details: 0, builder: 0, publisher: 1 });

    const semanticFailureId = "2030-01-10";
    await createRetainedBundleFixture({
      cycleId: semanticFailureId,
      count: 1,
      legacyGeneratorCommitSha: "legacy-builder-semantic-failure",
    });
    const semanticFailureCounters = { collector: 0, details: 0 };
    const semanticFailureResult = await runSmokingpipesAutoPublishV2({
      stateRoot,
      runtimeRoot,
      cycleId: semanticFailureId,
      skipSync: true,
      live: false,
      collector: offlineResumeCollector(semanticFailureId, semanticFailureCounters),
      publisher: async () => ({
        status: "release-retryable",
        failureStage: "public-validator",
        error: "fixture public validation failure",
        exitCode: 1,
      }),
    });
    assert.equal(semanticFailureResult.status, "release-retryable");
    assert.equal((await readCycle(stateRoot, semanticFailureId)).failure.stage, "public-validator");
    assert.deepEqual(semanticFailureCounters, { collector: 1, details: 0 });

    const pushAttempts = [];
    const retainedPublishRoot = path.join(
      stateRoot,
      (await readCycle(stateRoot, "2030-01-01")).bundle.path
    );
    const pushRace = await runSmokingpipesAutoPublishV2({
      stateRoot,
      runtimeRoot,
      cycleId: "2030-01-01",
      skipSync: true,
      live: false,
      collector: offlineResumeCollector("2030-01-01", { collector: 0, details: 0 }),
      publisher: async ({ bundleRoot, pushRetryAttempt }) => {
        assert.equal(bundleRoot, retainedPublishRoot);
        pushAttempts.push(pushRetryAttempt || 0);
        return pushAttempts.length === 1
          ? { status: "push-retryable", failureStage: "push-retryable", error: "non-fast-forward", exitCode: 3 }
          : { status: "published", commitSha: "fixture-git-race-published", publishedCount: publishBundle.manifest.actualAppliedCount, exitCode: 0 };
      },
    });
    assert.equal(pushRace.status, "published");
    assert.equal(pushRace.networkAccessed, false);
    assert.deepEqual(pushAttempts, [0, 1]);
    assert.equal((await readCycle(stateRoot, "2030-01-01")).phase, "done");

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

    const publisherNoChangeId = "2030-01-08";
    const publisherNoChangeCycle = createCycle({ cycleId: publisherNoChangeId });
    publisherNoChangeCycle.phase = "ready";
    publisherNoChangeCycle.collection = {
      ...publisherNoChangeCycle.collection,
      observedCandidateCount: 1,
      completedDetailIds: ["900000"],
      pendingDetailIds: [],
    };
    await writeCycle(stateRoot, publisherNoChangeCycle);
    let noChangeNotificationCalls = 0;
    const publisherNoChange = await runSmokingpipesAutoPublishV2({
      stateRoot,
      runtimeRoot,
      cycleId: publisherNoChangeId,
      skipSync: true,
      collector: async () => ({
        status: "ready-to-bundle",
        cycle: await readCycle(stateRoot, publisherNoChangeId),
        networkAccessed: false,
      }),
      bundleBuilder: async () => ({
        status: "bundle-ready",
        bundleId: "publisher-no-change-bundle",
        bundleRoot: path.join(temporaryRoot, "publisher-no-change-bundle"),
        manifest: { actualAppliedCount: 1 },
        cycle: await readCycle(stateRoot, publisherNoChangeId),
      }),
      publisher: async () => ({ status: "no-change", bundleId: "publisher-no-change-bundle", publishedCount: 0 }),
      notificationsEnabled: true,
      notifier: async () => {
        noChangeNotificationCalls += 1;
        return { notificationSent: true, notificationReason: "fixture-sent" };
      },
    });
    assert.equal(publisherNoChange.status, "no-change");
    assert.equal(publisherNoChange.cycle.phase, "done");
    assert.equal(publisherNoChange.publishedCount, 0);
    assert.equal(noChangeNotificationCalls, 1);
    assert.equal(parseSmokingpipesPublisherResult(
      "SMOKINGPIPES_PUBLISHER_RESULT_JSON={\"status\":\"no-change\",\"bundleId\":\"fixture\"}"
    ).status, "no-change");

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

    // Legacy persisted phases migrate on read, then write only their canonical
    // V2 phase. Manual review remains a retryable cycle with its explicit
    // human-review requirement rather than a second persisted state machine.
    const legacyPhaseMappings = [
      ["new", "collecting"],
      ["collecting-list", "collecting"],
      ["list-ready", "collecting"],
      ["enriching-details", "details"],
      ["ready-to-bundle", "ready"],
      ["bundle-ready", "ready"],
      ["validating-release", "publishing"],
      ["published", "done"],
      ["no-change", "done"],
      ["collection-retryable", "retryable"],
      ["release-retryable", "retryable"],
      ["manual-review-required", "retryable"],
    ];
    for (const [legacyPhase, canonicalPhase] of legacyPhaseMappings) {
      const migrationStateRoot = path.join(temporaryRoot, "phase-migration", legacyPhase);
      const migrationCycle = createCycle({ cycleId: "2030-02-01" });
      migrationCycle.phase = legacyPhase;
      migrationCycle.history = [{ at: migrationCycle.updatedAt, phase: legacyPhase, reason: "legacy-fixture" }];
      const migrationPaths = cyclePaths(migrationStateRoot, migrationCycle.cycleId);
      await writeJsonAtomic(migrationPaths.cycle, migrationCycle);
      const migrated = await readCycle(migrationStateRoot, migrationCycle.cycleId);
      assert.equal(migrated.phase, canonicalPhase, legacyPhase);
      assert.equal(
        migrated.failure?.requiresManualReview === true,
        legacyPhase === "manual-review-required",
        legacyPhase
      );
      await writeCycle(migrationStateRoot, migrated);
      const persisted = await readJson(migrationPaths.cycle);
      assert.equal(persisted.phase, canonicalPhase, legacyPhase);
      assert.equal(
        persisted.failure?.requiresManualReview === true,
        legacyPhase === "manual-review-required",
        legacyPhase
      );
    }

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
    assert.equal(recovered.cycle.phase, "retryable");
    assert.equal(recovered.cycle.failure.stage, "interrupted-validating-release");
    assert.equal(recovered.networkAccessed, false);

    for (const status of [
      "published", "no-change", "same-day-complete", "enriching-details",
      "ready-to-bundle", "bundle-ready", "preflight-passed", "already-running",
    ]) {
      assert.equal(smokingpipesV2ExitCode(status), 0, status);
    }
    for (const status of [
      "collection-retryable", "release-retryable", "manual-review-required",
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
      completedDetailIds: ["1"],
      pendingDetailIds: ["3"],
      completedWithoutDetailCount: 3,
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
    const sameDayNotificationStateRoot = path.join(temporaryRoot, "same-day-notification-state");
    const sameDayNotificationCycle = createCycle({ cycleId: "2030-01-12" });
    await writeCycle(sameDayNotificationStateRoot, sameDayNotificationCycle);
    let sameDayNotificationCalls = 0;
    const sameDayNotification = await runSmokingpipesAutoPublishV2({
      stateRoot: sameDayNotificationStateRoot,
      runtimeRoot,
      cycleId: sameDayNotificationCycle.cycleId,
      skipSync: true,
      notificationsEnabled: true,
      collector: async () => ({
        status: "same-day-complete",
        cycle: await readCycle(sameDayNotificationStateRoot, sameDayNotificationCycle.cycleId),
        networkAccessed: false,
      }),
      notifier: async () => {
        sameDayNotificationCalls += 1;
        return { notificationSent: true, notificationReason: "fixture-sent" };
      },
    });
    assert.equal(sameDayNotification.status, "same-day-complete");
    assert.equal(sameDayNotificationCalls, 0);
    const publishedNotificationStateRoot = path.join(temporaryRoot, "published-notification-state");
    const publishedNotificationCycle = createCycle({ cycleId: "2030-01-13" });
    publishedNotificationCycle.phase = "ready";
    publishedNotificationCycle.collection = {
      ...publishedNotificationCycle.collection,
      observedCandidateCount: 1,
      completedDetailIds: ["900000"],
      pendingDetailIds: [],
    };
    await writeCycle(publishedNotificationStateRoot, publishedNotificationCycle);
    let publishedNotificationCalls = 0;
    const publishedNotification = await runSmokingpipesAutoPublishV2({
      stateRoot: publishedNotificationStateRoot,
      runtimeRoot,
      cycleId: publishedNotificationCycle.cycleId,
      skipSync: true,
      notificationsEnabled: true,
      collector: async () => ({
        status: "ready-to-bundle",
        cycle: await readCycle(publishedNotificationStateRoot, publishedNotificationCycle.cycleId),
        networkAccessed: false,
      }),
      bundleBuilder: async () => ({
        status: "bundle-ready",
        bundleId: "published-notification-bundle",
        bundleRoot: path.join(temporaryRoot, "published-notification-bundle"),
        manifest: { actualAppliedCount: 1 },
        cycle: await readCycle(publishedNotificationStateRoot, publishedNotificationCycle.cycleId),
      }),
      publisher: async () => ({
        status: "published",
        bundleId: "published-notification-bundle",
        commitSha: "fixture-published-commit",
        publishedCount: 1,
      }),
      notifier: async () => {
        publishedNotificationCalls += 1;
        return { notificationSent: true, notificationReason: "fixture-sent" };
      },
    });
    assert.equal(publishedNotification.status, "published");
    assert.equal(publishedNotificationCalls, 1);
    const detailMessage = buildSmokingpipesV2Notification({
      status: "enriching-details",
      cycleId: notificationCycle.cycleId,
      cycle: notificationCycle,
      networkAccessed: false,
    }).body;
    assert.match(detailMessage, /实际详情完成: 1/);
    assert.match(detailMessage, /无需抓详情的状态变更: 3/);
    assert.match(detailMessage, /待处理详情: 1/);
    assert.match(detailMessage, /隔离: 1/);
    assert.doesNotMatch(detailMessage, /已完成详情/);
    assert.match(detailMessage, /下一窗口/);
    const publishedMessage = buildSmokingpipesV2Notification({
      status: "published",
      cycleId: notificationCycle.cycleId,
      cycle: {
        ...notificationCycle,
        bundle: {
          changeTypeCounts: {
            "new-product": 120,
            "price-change": 10,
            "explicit-out-of-stock": 649,
            reappeared: 57,
          },
        },
      },
      changeTypeCounts: {},
    }).body;
    assert.match(publishedMessage, /新增: 120/);
    assert.match(publishedMessage, /改价: 10/);
    assert.match(publishedMessage, /下架: 649/);
    assert.match(publishedMessage, /恢复库存: 57/);
    assert.doesNotMatch(publishedMessage, /变更类型: \{\}/);

    // Publisher E2E: a bundle can own many output files while only the files
    // whose content changed are staged. The final V2 validator runs once,
    // empty staged diffs block, and injected unexpected staging is rejected
    // and cleaned from the temporary release clone.
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
    await writeText(fakeRuntimeRoot, "scripts/inventory/validate-smokingpipes-release-bundle-v2.mjs", [
      'import fs from "node:fs";',
      'if (process.env.SMOKINGPIPES_TEST_VALIDATOR_COUNT_PATH) {',
      '  fs.appendFileSync(process.env.SMOKINGPIPES_TEST_VALIDATOR_COUNT_PATH, "validated\\n");',
      '}',
    ].join("\n"));
    await writeText(fakeRuntimeRoot, "scripts/inventory/smokingpipes-build-release-bundle-v2.mjs", [
      'import fs from "node:fs";',
      'const bundleRoot = process.env.SMOKINGPIPES_TEST_BUNDLE_ROOT;',
      'if (!bundleRoot) throw new Error("SMOKINGPIPES_TEST_BUNDLE_ROOT is required");',
      'if (process.env.SMOKINGPIPES_TEST_BUILDER_COUNT_PATH) {',
      '  fs.appendFileSync(process.env.SMOKINGPIPES_TEST_BUILDER_COUNT_PATH, "rebuilt\\n");',
      '}',
      'console.log(JSON.stringify({ status: "bundle-ready", bundleRoot }));',
    ].join("\n"));

    async function writeFixtureBundle(bundleRoot, outputValues, baseMainSha, bundleId) {
      for (const [file, value] of Object.entries(outputValues)) {
        const target = path.join(bundleRoot, "outputs", file);
        await writeJsonAtomic(target, value);
      }
      await writeJsonAtomic(path.join(bundleRoot, "manifest.json"), {
        bundleId,
        baseMainSha,
        actualAppliedCount: 2,
        outputFiles: Object.keys(outputValues).sort(),
      });
      return Object.keys(outputValues).sort();
    }

    const changedFiles = ownedFiles.slice(0, 2);
    const subsetOutputs = structuredClone(baselineOutputs);
    for (const file of changedFiles) subsetOutputs[file] = { file, version: "changed" };
    await writeFixtureBundle(subsetBundleRoot, subsetOutputs, subsetBaseSha, "subset-bundle");
    const subsetValidatorCountPath = path.join(subsetRoot, "validator-count.log");
    const subsetBuilderCountPath = path.join(subsetRoot, "builder-count.log");
    const subsetPublish = runPublisher([
      "-StateRoot", subsetStateRoot,
      "-CycleId", "2030-02-01",
      "-BundleRoot", subsetBundleRoot,
      "-ReleaseRoot", subsetRelease,
      "-RuntimeRoot", fakeRuntimeRoot,
    ], { env: {
      SMOKINGPIPES_TEST_BUNDLE_ROOT: subsetBundleRoot,
      SMOKINGPIPES_TEST_VALIDATOR_COUNT_PATH: subsetValidatorCountPath,
      SMOKINGPIPES_TEST_BUILDER_COUNT_PATH: subsetBuilderCountPath,
    } });
    assert.equal(subsetPublish.status, 0, `${subsetPublish.stdout}\n${subsetPublish.stderr}`);
    const subsetPayload = lastJson(subsetPublish.stdout);
    assert.equal(subsetPayload.status, "published");
    assert.equal(Array.isArray(subsetPayload.stagedFiles), true, JSON.stringify(subsetPayload));
    assert.deepEqual([...subsetPayload.stagedFiles].sort(), [...changedFiles].sort());
    assert.deepEqual((await fs.promises.readFile(subsetValidatorCountPath, "utf8")).trim().split(/\r?\n/), ["validated"]);
    assert.equal(fs.existsSync(subsetBuilderCountPath), false, "matching baseMainSha must not rebuild the Bundle");
    for (const [file, expectedValue] of Object.entries(subsetOutputs)) {
      assert.deepEqual(await readJson(path.join(subsetRelease, file)), expectedValue, file);
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
    ], { env: { SMOKINGPIPES_TEST_BUNDLE_ROOT: emptyBundleRoot } });
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
        SMOKINGPIPES_TEST_BUNDLE_ROOT: unexpectedBundleRoot,
        SMOKINGPIPES_TEST_STAGE_UNEXPECTED: "1",
        SMOKINGPIPES_TEST_RELEASE_ROOT: subsetRelease,
      },
    });
    assert.notEqual(unexpectedPublish.status, 0);
    assert.match(`${unexpectedPublish.stdout}\n${unexpectedPublish.stderr}`, /staged file whitelist mismatch; unexpected=unexpected.txt/);
    assert.equal(git(subsetRelease, ["status", "--short"]), "");

    // A base mismatch is a rebuild trigger rather than stale-base. The
    // Publisher rebuilds exactly once against origin/main and then publishes.
    git(subsetSource, ["remote", "add", "origin", subsetBare]);
    git(subsetSource, ["fetch", "origin"]);
    git(subsetSource, ["merge", "--ff-only", "origin/main"]);
    await writeText(subsetSource, "README.md", "latest main B\n");
    git(subsetSource, ["add", "--", "README.md"]);
    git(subsetSource, ["commit", "-m", "fixture: latest-main B"]);
    git(subsetSource, ["push", "origin", "HEAD:main"]);
    const mismatchInputBundleRoot = path.join(subsetRoot, "mismatch-input-bundle");
    const mismatchRebuiltBundleRoot = path.join(subsetRoot, "mismatch-rebuilt-bundle");
    const mismatchOutputs = structuredClone(subsetOutputs);
    for (const file of changedFiles) mismatchOutputs[file] = { file, version: "rebuilt-after-main-B" };
    await writeFixtureBundle(mismatchInputBundleRoot, subsetOutputs, subsetBaseSha, "mismatch-input-bundle");
    await writeFixtureBundle(
      mismatchRebuiltBundleRoot,
      mismatchOutputs,
      git(subsetSource, ["rev-parse", "HEAD"]),
      "mismatch-rebuilt-bundle"
    );
    const mismatchPublish = runPublisher([
      "-StateRoot", subsetStateRoot,
      "-CycleId", "2030-02-04",
      "-BundleRoot", mismatchInputBundleRoot,
      "-ReleaseRoot", subsetRelease,
      "-RuntimeRoot", fakeRuntimeRoot,
    ], { env: {
      SMOKINGPIPES_TEST_BUNDLE_ROOT: mismatchRebuiltBundleRoot,
      SMOKINGPIPES_TEST_BUILDER_COUNT_PATH: subsetBuilderCountPath,
    } });
    assert.equal(mismatchPublish.status, 0, `${mismatchPublish.stdout}\n${mismatchPublish.stderr}`);
    assert.equal(lastJson(mismatchPublish.stdout).status, "published");
    assert.deepEqual(
      (await fs.promises.readFile(subsetBuilderCountPath, "utf8")).trim().split(/\r?\n/),
      ["rebuilt"]
    );

    // The Publisher must run real project gates from ReleaseRoot.  This
    // reproduces the production defect by giving the caller Runtime a broken
    // manifest while the Release clone receives a valid Bundle.
    const releaseCwdRoot = path.join(temporaryRoot, "publisher-release-cwd");
    const releaseCwdSource = path.join(releaseCwdRoot, "source");
    const releaseCwdBare = path.join(releaseCwdRoot, "origin.git");
    const releaseCwdInvalidBare = path.join(releaseCwdRoot, "invalid-origin.git");
    const releaseCwdRelease = path.join(releaseCwdRoot, "release");
    const releaseCwdInvalidRelease = path.join(releaseCwdRoot, "release-invalid");
    const releaseCwdRuntime = path.join(releaseCwdRoot, "runtime-caller");
    const releaseCwdState = path.join(releaseCwdRoot, "state");
    await fs.promises.mkdir(releaseCwdRuntime, { recursive: true });
    await writeJsonAtomic(path.join(releaseCwdRuntime, "data", "products", "unified-products-staging.json"), []);
    await writeJsonAtomic(path.join(releaseCwdRuntime, "data", "generated", "public-products", "manifest.json"), {
      generatorVersion: "runtime-fixture-is-deliberately-invalid",
    });
    execFileSync("git", ["clone", workspaceRoot, releaseCwdSource], { stdio: "ignore" });
    git(releaseCwdSource, ["checkout", "-B", "main", "HEAD"]);
    git(releaseCwdSource, ["config", "user.email", "fixture@example.invalid"]);
    git(releaseCwdSource, ["config", "user.name", "Fixture"]);
    const releaseCwdBaseSha = git(releaseCwdSource, ["rev-parse", "HEAD"]);
    execFileSync("git", ["clone", "--bare", releaseCwdSource, releaseCwdBare], { stdio: "ignore" });
    execFileSync("git", ["clone", "--bare", releaseCwdSource, releaseCwdInvalidBare], { stdio: "ignore" });
    execFileSync("git", ["clone", releaseCwdBare, releaseCwdRelease], { stdio: "ignore" });
    execFileSync("git", ["clone", releaseCwdInvalidBare, releaseCwdInvalidRelease], { stdio: "ignore" });
    for (const releaseFixture of [releaseCwdRelease, releaseCwdInvalidRelease]) {
      git(releaseFixture, ["checkout", "main"]);
      git(releaseFixture, ["config", "user.email", "fixture@example.invalid"]);
      git(releaseFixture, ["config", "user.name", "Fixture"]);
    }
    // Collection begins against A. Before the Publisher starts, a Danish-only
    // B reaches origin/main. The Publisher must rebuild against B rather than
    // reject the finished Smokingpipes change set as stale.
    const danishBPath = path.join(releaseCwdSource, "data", "products", "danish-products.json");
    const danishBProducts = await readJson(danishBPath);
    const danishBIndex = danishBProducts.findIndex((product) => product?.id != null);
    assert.notEqual(danishBIndex, -1);
    const danishBId = String(danishBProducts[danishBIndex].id);
    const danishBName = `${danishBProducts[danishBIndex].name} [latest-main-B]`;
    danishBProducts[danishBIndex] = { ...danishBProducts[danishBIndex], name: danishBName };
    await writeJsonAtomic(danishBPath, danishBProducts);
    git(releaseCwdSource, ["add", "--", "data/products/danish-products.json"]);
    git(releaseCwdSource, ["commit", "-m", "fixture: Danish latest-main B"]);
    git(releaseCwdSource, ["remote", "set-url", "origin", releaseCwdBare]);
    git(releaseCwdSource, ["push", "origin", "HEAD:main"]);
    const releaseCwdLatestMainSha = git(releaseCwdSource, ["rev-parse", "HEAD"]);
    assert.notEqual(releaseCwdLatestMainSha, releaseCwdBaseSha);
    // Turbopack rejects a node_modules junction that points outside the
    // project root, so the successful Production-gate fixture installs from
    // the local cache in strict offline mode.
    execFileSync("cmd.exe", ["/d", "/s", "/c", "npm.cmd ci --offline"], {
      cwd: releaseCwdRelease,
      stdio: "ignore",
      windowsHide: true,
    });
    await fs.promises.symlink(
      path.join(workspaceRoot, "node_modules"),
      path.join(releaseCwdInvalidRelease, "node_modules"),
      "junction"
    );
    const releaseCwdCycleId = "2030-03-01";
    const releaseCwdList = path.join(releaseCwdRoot, "list.json");
    await writeJsonAtomic(releaseCwdList, trustedSnapshot([listItem("940000")]));
    const releaseCwdCollected = await runSmokingpipesCollectOnlyV2({
      stateRoot: releaseCwdState,
      runtimeRoot,
      cycleId: releaseCwdCycleId,
      listInputPath: releaseCwdList,
      detailLimit: 1,
      processDetail: detailProcessor,
    });
    assert.equal(releaseCwdCollected.status, "ready-to-bundle");
    const releaseCwdBundle = await buildSmokingpipesReleaseBundleV2({
      stateRoot: releaseCwdState,
      cycleId: releaseCwdCycleId,
      runtimeRoot: workspaceRoot,
      baseMainSha: releaseCwdBaseSha,
      generatorCommitSha: releaseCwdBaseSha,
      maxAutoApply: 2000,
    });
    const callerCwdBeforePublisher = process.cwd();
    const releaseCwdPublish = runPublisher([
      "-StateRoot", releaseCwdState,
      "-CycleId", releaseCwdCycleId,
      "-BundleRoot", releaseCwdBundle.bundleRoot,
      "-ReleaseRoot", releaseCwdRelease,
      "-RuntimeRoot", workspaceRoot,
    ], { cwd: releaseCwdRuntime });
    assert.equal(releaseCwdPublish.status, 0, `${releaseCwdPublish.stdout}\n${releaseCwdPublish.stderr}`);
    assert.equal(lastJson(releaseCwdPublish.stdout).status, "published");
    assert.equal(process.cwd(), callerCwdBeforePublisher);
    assert.equal(git(releaseCwdRelease, ["status", "--short"]), "");
    git(releaseCwdRelease, ["merge-base", "--is-ancestor", releaseCwdLatestMainSha, "HEAD"]);
    const releaseDanishB = (await readJson(path.join(releaseCwdRelease, "data", "products", "danish-products.json")))
      .find((product) => String(product?.id) === danishBId);
    assert.equal(releaseDanishB?.name, danishBName);
    const releaseUnifiedB = await readJson(path.join(releaseCwdRelease, "data", "products", "unified-products-staging.json"));
    assert.equal(
      releaseUnifiedB.find((product) => product.id === `danish-${danishBId}`)?.displayNameEn,
      danishBName
    );

    // Structural-only keeps all real public-index integrity checks while
    // deliberately ignoring legacy manifest hash eligibility. Normal mode
    // still rejects those bad hashes, and a structural defect still fails.
    const releaseValidator = path.join(workspaceRoot, "scripts", "validate-public-product-indexes-v1.mjs");
    const releaseManifestPath = path.join(releaseCwdRelease, "data", "generated", "public-products", "manifest.json");
    const releaseManifest = await readJson(releaseManifestPath);
    releaseManifest.fileHashes = {
      "data/generated/public-products/catalog.json": "deadbeef",
    };
    releaseManifest.inputHashes = { ...(releaseManifest.inputHashes || {}), staging: "deadbeef" };
    await writeJsonAtomic(releaseManifestPath, releaseManifest);
    const normalHashGate = spawnSync(process.execPath, [releaseValidator], {
      cwd: releaseCwdRelease,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.notEqual(normalHashGate.status, 0);
    assert.match(`${normalHashGate.stdout}\n${normalHashGate.stderr}`, /Manifest (file |staging )?hash mismatch/i);
    const structuralHashGate = spawnSync(process.execPath, [releaseValidator, "--structural-only=true"], {
      cwd: releaseCwdRelease,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(structuralHashGate.status, 0, `${structuralHashGate.stdout}\n${structuralHashGate.stderr}`);
    const structuralCatalogPath = path.join(releaseCwdRelease, "data", "generated", "public-products", "catalog.json");
    const structuralCatalog = await readJson(structuralCatalogPath);
    structuralCatalog.products = [];
    await writeJsonAtomic(structuralCatalogPath, structuralCatalog);
    const structuralFailure = spawnSync(process.execPath, [releaseValidator, "--structural-only=true"], {
      cwd: releaseCwdRelease,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.notEqual(structuralFailure.status, 0);
    assert.match(`${structuralFailure.stdout}\n${structuralFailure.stderr}`, /Catalog count mismatch|catalog\.json cannot be exactly rebuilt/i);

    const invalidReleaseCwdBundleRoot = path.join(releaseCwdRoot, "invalid-public-validator-bundle");
    await fs.promises.cp(releaseCwdBundle.bundleRoot, invalidReleaseCwdBundleRoot, { recursive: true });
    const invalidCatalogPath = path.join(
      invalidReleaseCwdBundleRoot,
      "outputs",
      "data",
      "generated",
      "public-products",
      "catalog.json"
    );
    const invalidCatalog = await readJson(invalidCatalogPath);
    invalidCatalog.products[0] = {
      ...invalidCatalog.products[0],
      title: "runtime-cwd-regression-mismatch",
    };
    await writeJsonAtomic(invalidCatalogPath, invalidCatalog);
    const releaseCwdInvalidRuntime = path.join(releaseCwdRoot, "runtime-invalid-builder");
    await writeText(releaseCwdInvalidRuntime, "scripts/inventory/smokingpipes-build-release-bundle-v2.mjs", [
      'import fs from "node:fs";',
      'import path from "node:path";',
      'export const SMOKINGPIPES_BUNDLE_SCHEMA_V2 = "smokingpipes-release-bundle-v2";',
      'export function readJsonAtGitRef({ runtimeRoot, relativePath }) { return JSON.parse(fs.readFileSync(path.join(runtimeRoot, relativePath), "utf8")); }',
      'console.log(JSON.stringify({ status: "bundle-ready", bundleRoot: process.env.SMOKINGPIPES_TEST_BUNDLE_ROOT }));',
      "",
    ].join("\n"));
    await writeText(
      releaseCwdInvalidRuntime,
      "scripts/inventory/smokingpipes-cycle-store-v2.mjs",
      await fs.promises.readFile(path.join(workspaceRoot, "scripts", "inventory", "smokingpipes-cycle-store-v2.mjs"), "utf8")
    );
    await writeText(
      releaseCwdInvalidRuntime,
      "scripts/inventory/validate-smokingpipes-release-bundle-v2.mjs",
      await fs.promises.readFile(path.join(workspaceRoot, "scripts", "inventory", "validate-smokingpipes-release-bundle-v2.mjs"), "utf8")
    );
    const releaseCwdPublicValidatorFailure = runPublisher([
      "-StateRoot", releaseCwdState,
      "-CycleId", "2030-03-02",
      "-BundleRoot", invalidReleaseCwdBundleRoot,
      "-ReleaseRoot", releaseCwdInvalidRelease,
      "-RuntimeRoot", releaseCwdInvalidRuntime,
    ], {
      cwd: releaseCwdRuntime,
      env: { SMOKINGPIPES_TEST_BUNDLE_ROOT: invalidReleaseCwdBundleRoot },
    });
    assert.notEqual(releaseCwdPublicValidatorFailure.status, 0);
    const publicValidatorFailureResult = lastJson(releaseCwdPublicValidatorFailure.stdout);
    assert.equal(
      publicValidatorFailureResult.failureStage,
      "public-validator",
      JSON.stringify(publicValidatorFailureResult)
    );
    assert.equal(git(releaseCwdInvalidRelease, ["status", "--short"]), "");

    const autoPublishScript = await fs.promises.readFile(
      path.join(workspaceRoot, "scripts", "inventory", "run-smokingpipes-auto-publish.ps1"),
      "utf8"
    );
    assert.equal(autoPublishScript.includes("test-inventory-runner-v1.mjs"), false);
    assert.match(autoPublishScript, /--timeout-seconds=\$DailyTimeoutSeconds/);
    assert.match(autoPublishScript, /& \$nodeCommand\.Source @arguments 2>&1 \| ForEach-Object/);
    console.log("Smokingpipes V2 pipeline E2E passed");
  } finally {
    await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
