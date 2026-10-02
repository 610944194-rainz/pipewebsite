import assert from "node:assert/strict";
import { ensureManualVerificationIfNeeded, waitForManualVerificationRecovery, navigateDanishDetail } from "../collect-danish-full-v18.mjs";

async function scenario(solveOnAttempt) {
  let time = 0, launches = 0, foreground = 0;
  const events = [];
  const page = {
    url: () => "https://www.danishpipeshop.com/d/test.html",
    bringToFront: async () => { foreground++; },
    evaluate: async () => ({ challenge: !solveOnAttempt || launches < solveOnAttempt,
      title: !solveOnAttempt || launches < solveOnAttempt ? "Verify" : "Product",
      hasListContainer: false, listItemCount: 0 }),
  };
  const run = () => waitForManualVerificationRecovery(page, {
    now: () => time, sleep: async (ms) => { time += ms; }, pollMs: 5,
    attemptTimeoutsMs: [20, 20, 30],
    readVerificationTask: async (taskId) => ({ taskId, status: "completed" }),
    launchVerificationBridge: ({ log }) => {
      launches++;
      log("danish-verification-task-confirmed", { taskId: `task-${launches}`, status: "completed" });
      return true;
    },
    log: (event, value) => events.push({ event, value }),
  });
  if (solveOnAttempt) await run();
  else await assert.rejects(run(), /manual-verification-timeout/);
  assert.equal(launches, solveOnAttempt || 3);
  assert.equal(foreground, launches);
  assert.ok(time <= 70, "bounded recovery must not grow past three attempt budgets");
  if (!solveOnAttempt) {
    const timeout = events.find(({ event }) => event === "manual-verification-timeout");
    assert.equal(timeout.value.taskStatus, "completed");
    assert.equal(timeout.value.challengeAfter, true, "task completed is not page recovered");
  }
}
for (const attempt of [1, 2, 3, null]) await scenario(attempt);
{
  let launches = 0;
  await ensureManualVerificationIfNeeded({ url: () => "https://www.danishpipeshop.com/d/test.html",
    evaluate: async () => ({ challenge: false, title: "Product" }) }, {
    launchVerificationBridge: () => { launches++; },
  });
  assert.equal(launches, 0, "normal pages must not trigger ShadowBot");
}
{
  const page = { url: () => "https://www.danishpipeshop.com/d/test.html",
    evaluate: async () => ({ challenge: true, title: "Verify" }) };
  await assert.rejects(waitForManualVerificationRecovery(page, {
    launchVerificationBridge: () => false, log: () => {},
  }), /danish-verification-bridge-not-confirmed/);
}
console.log("Danish verification recovery focused tests passed (first/second/third, fail closed, completed != recovered)");

// A pending native goto must not prevent a fully rendered verification page reaching recovery.
{
  let rejectNavigation;
  const events = [];
  const page = { url: () => "https://www.danishpipeshop.com/captcha2.aspx",
    goto: () => new Promise((_, reject) => { rejectNavigation = reject; }),
    evaluate: async () => ({ challenge: true, title: "I am not a robot" }),
  };
  const result = await navigateDanishDetail(page, "https://www.danishpipeshop.com/d/test.html", {
    timeoutMs: 100, pollMs: 1, log: (event) => events.push(event),
  });
  assert.equal(result.verification, true);
  assert.ok(events.includes("detail-navigation-verification-handoff"));
  rejectNavigation(new Error("navigation interrupted by recovered page"));
}
{
  const page = { url: () => "https://www.danishpipeshop.com/d/test.html", goto: async () => {},
    evaluate: async () => ({ challenge: false, title: "Product" }) };
  assert.equal((await navigateDanishDetail(page, page.url())).verification, false);
}
{
  const page = { url: () => "about:blank", goto: () => new Promise(() => {}),
    evaluate: async () => ({ challenge: false, title: "" }) };
  await assert.rejects(navigateDanishDetail(page, "https://www.danishpipeshop.com/d/test.html", {
    timeoutMs: 30, pollMs: 1,
  }), /danish-detail-navigation-failed/);
}
{
  const page = { url: () => "about:blank", goto: async () => { throw new Error("network failed"); },
    evaluate: async () => ({ challenge: false, title: "" }) };
  await assert.rejects(navigateDanishDetail(page, "https://www.danishpipeshop.com/d/test.html"), /network failed/);
}
console.log("Danish detail navigation handoff focused tests passed");
