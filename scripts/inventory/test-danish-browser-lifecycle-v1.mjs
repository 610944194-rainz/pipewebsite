import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  acquireDanishBrowserProfileLock,
  allocateDanishCdpPort,
  isDanishStrongVerificationFailure,
  navigateInitialDanishList,
  releaseDanishBrowserProfileLock,
  splitResumableDetailRecords,
  waitForOwnedDanishCdpEndpoint,
} from "../collect-danish-full-v18.mjs";
import { terminateOwnedProcessTree } from "./run-danish-daily-v1.mjs";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "danish-browser-lifecycle-"));
const profilePath = path.join(tempRoot, "profile");
fs.mkdirSync(profilePath, { recursive: true });

// A persistent profile belongs to one collector at a time, and only its owner can release it.
{
  const first = acquireDanishBrowserProfileLock({
    profilePath,
    ownerToken: "owner-one",
    pid: 101,
    isPidAlive: () => true,
  });
  assert.equal(first.acquired, true);
  const blocked = acquireDanishBrowserProfileLock({
    profilePath,
    ownerToken: "owner-two",
    pid: 102,
    isPidAlive: () => true,
  });
  assert.equal(blocked.acquired, false);
  assert.equal(releaseDanishBrowserProfileLock({ ...first, payload: { ...first.payload, ownerToken: "wrong-owner" } }), false);
  assert.equal(releaseDanishBrowserProfileLock(first), true);
}

// A failed detail is retryable data, never part of the completed resume set.
{
  const records = splitResumableDetailRecords([
    { href: "https://example.test/complete", detail: "ok" },
    { href: "https://example.test/blocked", error: { message: "manual-verification-timeout" } },
    { href: "https://example.test/permanent", error: { message: "malformed product markup" } },
  ]);
  assert.deepEqual(records.completed.map((item) => item.href), ["https://example.test/complete"]);
  assert.deepEqual(records.retryableFailures.map((item) => item.href), ["https://example.test/blocked"]);
  assert.deepEqual(records.terminalFailures.map((item) => item.href), ["https://example.test/permanent"]);
  assert.equal(isDanishStrongVerificationFailure(new Error("manual-verification-timeout after 900 seconds")), true);
}

// A stale DevToolsActivePort cannot be reused; only a file written after this Chrome launch is accepted.
{
  const activePortPath = path.join(profilePath, "DevToolsActivePort");
  fs.writeFileSync(activePortPath, "9222\n/devtools/browser/historical\n", "utf8");
  const oldTime = new Date(1_000);
  fs.utimesSync(activePortPath, oldTime, oldTime);
  let clock = 2_000;
  const aliveChrome = { pid: 200, killed: false, exitCode: null };
  await assert.rejects(
    () => waitForOwnedDanishCdpEndpoint({
      profilePath,
      chromeProcess: aliveChrome,
      startedAtMs: 1_500,
      timeoutMs: 5,
      now: () => clock,
      sleepFn: async () => { clock += 10; },
    }),
    /danish-chrome-cdp-ready-timeout/
  );
  fs.writeFileSync(activePortPath, "45678\n/devtools/browser/current-round\n", "utf8");
  const currentTime = new Date(3_000);
  fs.utimesSync(activePortPath, currentTime, currentTime);
  const endpoint = await waitForOwnedDanishCdpEndpoint({
    profilePath,
    chromeProcess: aliveChrome,
    startedAtMs: 2_500,
    timeoutMs: 5,
  });
  assert.equal(endpoint.endpoint, "http://127.0.0.1:45678");
  assert.equal(endpoint.browserPath, "/devtools/browser/current-round");
}

// Scheduled-task Chrome can expose CDP over its chosen port without writing DevToolsActivePort.
{
  const allocated = await allocateDanishCdpPort();
  assert.ok(allocated > 0 && allocated <= 65535);
  let requestedUrl = "";
  let clock = 0;
  let attempts = 0;
  const endpoint = await waitForOwnedDanishCdpEndpoint({
    profilePath,
    chromeProcess: { pid: 201, killed: false, exitCode: 0 },
    cdpPort: allocated,
    timeoutMs: 100,
    now: () => clock,
    sleepFn: async () => { clock += 10; },
    fetchFn: async (url) => {
      attempts += 1;
      requestedUrl = url;
      if (attempts === 1) throw new Error("CDP endpoint is still starting");
      return {
        ok: true,
        json: async () => ({ webSocketDebuggerUrl: `ws://127.0.0.1:${allocated}/devtools/browser/scheduler-round` }),
      };
    },
  });
  assert.equal(attempts, 2);
  assert.equal(requestedUrl, `http://127.0.0.1:${allocated}/json/version`);
  assert.equal(endpoint.endpoint, `http://127.0.0.1:${allocated}`);
  assert.equal(endpoint.browserPath, "/devtools/browser/scheduler-round");
}

// A hung initial navigation closes its tab and fails in 60 seconds (shortened here for the fixture).
{
  let closed = false;
  const events = [];
  const tab = {
    url: () => "about:blank",
    title: async () => "Blank tab",
    goto: async () => await new Promise(() => {}),
    close: async () => { closed = true; },
  };
  await assert.rejects(
    () => navigateInitialDanishList(tab, {
      targetUrl: "https://www.danishpipeshop.com/l/-zh/Pipes1",
      timeoutMs: 10,
      stderrTail: () => "Chrome navigation diagnostic",
      log: (event, value) => events.push({ event, value }),
    }),
    /danish-initial-navigation-failed.*about:blank.*Chrome navigation diagnostic/
  );
  assert.equal(closed, true);
  assert.equal(events.at(-1).event, "initial-navigation-failed");
}

// A normal initial navigation retains the tab and reaches the requested List URL.
{
  let currentUrl = "about:blank";
  const events = [];
  const tab = {
    url: () => currentUrl,
    goto: async (url) => { currentUrl = url; },
  };
  await navigateInitialDanishList(tab, {
    targetUrl: "https://www.danishpipeshop.com/l/-zh/Pipes1",
    timeoutMs: 10,
    log: (event) => events.push(event),
  });
  assert.equal(currentUrl, "https://www.danishpipeshop.com/l/-zh/Pipes1");
  assert.deepEqual(events, ["initial-navigation-start", "initial-navigation-complete"]);
}

// Daily-stage timeout uses taskkill /T /F for the owned Windows process tree.
{
  const calls = [];
  const fakeKiller = {
    once(event, listener) {
      if (event === "close") queueMicrotask(() => listener(0));
      return fakeKiller;
    },
  };
  const terminated = await terminateOwnedProcessTree({ pid: 3456 }, {
    platform: "win32",
    spawnProcess: (command, args, options) => {
      calls.push({ command, args, options });
      return fakeKiller;
    },
  });
  assert.equal(terminated, true);
  assert.deepEqual(calls, [{
    command: "taskkill.exe",
    args: ["/PID", "3456", "/T", "/F"],
    options: { windowsHide: true, stdio: "ignore" },
  }]);
}

console.log("Danish browser lifecycle focused tests passed");
