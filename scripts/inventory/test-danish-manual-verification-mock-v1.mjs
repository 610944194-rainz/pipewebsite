import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

import { collectLiveList, runPreview } from "./danish-full-refresh-preview-v1.mjs";
import {
  ensureManualVerificationIfNeeded,
  launchDanishVerificationBridge,
} from "../collect-danish-full-v18.mjs";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "danish-manual-verification-v1-"));
const card = (id, next = "") => `<!doctype html><html><body><div id="list-container-inner"><div class="list-item"><a href="/d/-zh/Test-${id}-i${id}.html"><img alt="Test ${id}" src="/img/${id}.jpg"></a>EUR ${id},- Available</div></div>${next}</body></html>`;
const challenge = (redirect = "") => `<!doctype html><html><head><title>Just a moment...</title>${redirect ? `<script>setTimeout(() => location.href='${redirect}', 1100)</script>` : ""}</head><body><h1>Checking your browser</h1><div class="cf-chl-widget">CAPTCHA</div></body></html>`;
const server = http.createServer((request, response) => {
  const body = request.url === "/normal" ? card(101)
    : request.url === "/verify" ? challenge("/normal")
    : request.url === "/timeout" ? challenge()
    : request.url === "/middle" ? card(201, '<a rel="next" href="/middle-verify">Next</a>')
    : request.url === "/middle-verify" ? challenge("/middle-final")
    : request.url === "/middle-final" ? card(202)
    : request.url === "/empty" ? '<!doctype html><html><body><div id="list-container-inner"></div></body></html>'
    : '<!doctype html><html><body>not found</body></html>';
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" }); response.end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
const context = await chromium.launchPersistentContext(path.join(tempRoot, "profile"), { channel: "chrome", headless: true });
const options = (route, seconds = 3) => ({ root: tempRoot, startUrl: `${base}${route}`, headed: false, browserChannel: "chrome", manualVerificationSeconds: seconds, profileDir: path.join(tempRoot, "profile"), auditDir: path.join(tempRoot, "audit", route.replaceAll("/", "")), context });
process.on("uncaughtException", (error) => { console.error(error.stack || error); process.exit(1); });

function v18VerificationPage(states) {
  let index = 0;
  const page = {
    isClosed: () => false,
    url: () => states[Math.min(index, states.length - 1)].url,
    evaluate: async () => states[Math.min(index, states.length - 1)],
    waitForTimeout: async () => { index = Math.min(index + 1, states.length - 1); },
    goto: async () => { index = Math.min(index + 1, states.length - 1); },
  };
  return page;
}

const blockedV18State = {
  title: "Just a moment...",
  challenge: true,
  hasListContainer: false,
  listItemCount: 0,
  url: "https://www.danishpipeshop.com/l/-zh/Pipes1",
};
const normalV18State = {
  title: "Pipes",
  challenge: false,
  hasListContainer: true,
  listItemCount: 1,
  url: "https://www.danishpipeshop.com/l/-zh/Pipes1",
};

console.log("mock: V18 normal does not launch RPA");
{
  let launchCount = 0;
  assert.equal(await ensureManualVerificationIfNeeded(v18VerificationPage([normalV18State]), {
    launchVerificationBridge: () => { launchCount += 1; },
  }), true);
  assert.equal(launchCount, 0);
}

console.log("mock: V18 blocked launches RPA once and keeps waiting for recovery");
{
  let launchCount = 0;
  const events = [];
  assert.equal(await ensureManualVerificationIfNeeded(v18VerificationPage([blockedV18State, normalV18State]), {
    targetUrl: blockedV18State.url,
    requireList: true,
    timeoutMs: 100,
    pollMs: 1,
    launchVerificationBridge: () => { launchCount += 1; },
    log: (stage) => events.push(stage),
  }), true);
  assert.equal(launchCount, 1);
  assert.equal(events.includes("manual-verification-completed"), true);
}

console.log("mock: V18 RPA launch failure remains fail closed");
{
  const oldHotkey = process.env.DANISH_RPA_HOTKEY;
  process.env.DANISH_RPA_HOTKEY = "Ctrl+Shift+Alt+9";
  const bridgeEvents = [];
  assert.equal(launchDanishVerificationBridge({
    spawnProcess: () => { throw new Error("fixture SendKeys failed"); },
    log: (stage, value) => bridgeEvents.push({ stage, value }),
  }), false);
  assert.equal(bridgeEvents.at(-1).value.reason, "hotkey-send-error");
  assert.equal(launchDanishVerificationBridge({
    spawnProcess: () => ({ status: 1, stdout: "", stderr: "fixture process failure" }),
    log: (stage, value) => bridgeEvents.push({ stage, value }),
  }), false);
  assert.equal(bridgeEvents.at(-1).value.reason, "hotkey-send-failed");
  if (oldHotkey === undefined) delete process.env.DANISH_RPA_HOTKEY; else process.env.DANISH_RPA_HOTKEY = oldHotkey;

  let clock = 0;
  let launchCount = 0;
  await assert.rejects(
    () => ensureManualVerificationIfNeeded(v18VerificationPage([blockedV18State]), {
      targetUrl: blockedV18State.url,
      requireList: true,
      timeoutMs: 10,
      pollMs: 5,
      now: () => clock,
      sleep: async (milliseconds) => { clock += milliseconds; },
      launchVerificationBridge: () => { launchCount += 1; return false; },
      log: () => {},
    }),
    /danish-verification-bridge-not-confirmed/
  );
  assert.equal(launchCount, 1);
}

console.log("mock: V18 bridge sends the configured ShadowBot hotkey");
{
  const oldHotkey = process.env.DANISH_RPA_HOTKEY;
  process.env.DANISH_RPA_HOTKEY = "Ctrl+Shift+Alt+9";
  const bridgeEvents = [];
  const spawned = [];
  assert.equal(launchDanishVerificationBridge({
    spawnProcess: (...args) => { spawned.push(args); return { status: 0, stdout: '{"taskId":"fixture","statusName":"running"}', stderr: "" }; },
    log: (stage, value) => bridgeEvents.push({ stage, value }),
  }), true);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0][0], "powershell.exe");
  assert.deepEqual(spawned[0][1].slice(0, 6), ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"]);
  assert.match(spawned[0][1][6], /send-danish-verification-hotkey-v1\.ps1$/);
  assert.deepEqual(spawned[0][1].slice(7), ["-VirtualKey", "57", "-Control", "-Shift", "-Alt"]);
  const helper = fs.readFileSync(spawned[0][1][6], "utf8");
  assert.match(helper, /SendInput/);
  assert.match(helper, /console task history/);
  assert.match(helper, /taskId -notin \$before/);
  assert.doesNotMatch(helper, /console task run|SendKeys/);
  assert.deepEqual(spawned[0][2], { windowsHide: true, encoding: "utf8" });
  assert.equal(bridgeEvents.some(({ stage }) => stage === "danish-verification-bridge-mode"), true);
  assert.equal(bridgeEvents.some(({ stage }) => stage === "danish-verification-bridge-triggered"), true);
  assert.equal(bridgeEvents.some(({ stage }) => stage === "danish-verification-task-confirmed"), true);
  assert.equal(bridgeEvents.find(({ stage }) => stage === "danish-verification-bridge-mode").value.mode, "hotkey-trigger");
  if (oldHotkey === undefined) delete process.env.DANISH_RPA_HOTKEY; else process.env.DANISH_RPA_HOTKEY = oldHotkey;
}

console.log("mock: normal"); const normal = await collectLiveList(options("/normal"));
assert.equal(normal.products.length, 1); assert.equal(normal.pages[0].kind, "success"); // A

console.log("mock: initial verification"); const verified = await collectLiveList(options("/verify", 5));
assert.equal(verified.products.length, 1); assert.equal(verified.manualVerification.requested, true); assert.equal(verified.manualVerification.completed, true); assert.equal(verified.pages[0].kind, "success"); // B

console.log("mock: verification timeout"); const timedOut = await collectLiveList(options("/timeout", 2));
assert.equal(timedOut.exitCode, 3); assert.equal(timedOut.failureStage, "manual-verification-timeout"); assert.equal(fs.existsSync(path.join(tempRoot, timedOut.manualVerification.blockedHtmlPath)), true); assert.equal(fs.existsSync(path.join(tempRoot, timedOut.manualVerification.screenshotPath)), true); // C/H
await assert.rejects(() => runPreview({ automationWorktree: process.cwd(), outputRoot: path.join(tempRoot, "timeout-output"), runId: "timeout-output-001", entryUrl: `${base}/timeout`, context, browserChannel: "chrome", manualVerificationSeconds: 2, listOnly: true, baseline: { production: [], publicCatalog: [] } }), (error) => error.exitCode === 3);
const timeoutManifest = JSON.parse(fs.readFileSync(path.join(tempRoot, "timeout-output", "data", "raw", "danish-full-refresh", "timeout-output-001", "manifest.json"), "utf8"));
assert.equal(timeoutManifest.failureStage, "manual-verification-timeout"); assert.equal(timeoutManifest.manualVerificationRequested, true); assert.equal(fs.existsSync(path.resolve(process.cwd(), timeoutManifest.blockedHtmlPath)), true); // manifest/page-audit are written before exit 3

console.log("mock: middle verification"); const middle = await collectLiveList(options("/middle", 5));
assert.equal(middle.products.length, 2); assert.equal(middle.pages.length, 2); assert.equal(middle.manualVerification.events.length, 1); assert.equal(middle.manualVerification.completed, true); // G

console.log("mock: empty list"); const empty = await collectLiveList(options("/empty"));
assert.equal(empty.exitCode, 4); assert.equal(empty.failureStage, "empty-list"); // D
await assert.rejects(() => runPreview({ automationWorktree: process.cwd(), outputRoot: path.join(tempRoot, "strict-output"), runId: "strict-empty-001", collectedList: { products: [], pages: [{ pageIndex: 1, kind: "success", endReason: "no-next" }], expectedPages: 1 }, detailState: {}, baseline: { production: [], publicCatalog: [] } }), (error) => error.exitCode === 4); // E/F strict output gate

await context.close();
await new Promise((resolve) => server.close(resolve));
console.log("Danish mock manual verification E2E tests passed");
process.exit(0);
