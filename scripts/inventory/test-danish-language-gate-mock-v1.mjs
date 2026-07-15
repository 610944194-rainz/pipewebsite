import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

import { collectLiveList } from "./danish-full-refresh-preview-v1.mjs";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "danish-language-gate-v1-"));
const card = (id, next = "", extra = "") => `<!doctype html><html><body><nav>PIPES</nav>${extra}<div id="list-container-inner"><div class="list-item"><a href="/d/-zh/Test-${id}-i${id}.html"><img alt="Test ${id}" src="/img/${id}.jpg"></a>EUR ${id},- Available</div></div>${next}</body></html>`;
const modal = (options) => `<div class="site-modal" role="dialog"><h1>Welcome to The Danish Pipe Shop</h1>${options}</div><div class="modal-overlay"></div>`;
const page = (options) => `<!doctype html><html><body><nav><a>UK / USD</a></nav>${modal(options)}</body></html>`;
const server = http.createServer((request, response) => {
  const url = request.url;
  const body = url === "/english" ? page('<button onclick="location.href=\'/english-ready\'">CLICK HERE TO CHOOSE ENGLISH</button>')
    : url === "/english-ready" ? card(301, "", '<script>localStorage.setItem("danish-language", "English")</script>')
    : url === "/div-english" ? page('<div role="button" onclick="location.href=\'/english-ready\'">CLICK HERE TO CHOOSE ENGLISH</div>')
    : url === "/fallback" ? page('<button data-language="Danish" onclick="location.href=\'/fallback-ready\'">Danish</button>')
    : url === "/fallback-ready" ? card(302)
    : url === "/disabled" ? page('<button disabled>English</button><button data-language="French" onclick="location.href=\'/fallback-ready\'">French</button>')
    : url === "/close" ? page('<button>Close</button><button>Cancel</button><button onclick="location.href=\'/english-ready\'">CLICK HERE TO CHOOSE ENGLISH</button>')
    : url === "/retry" ? page('<button data-language="French">French</button><button data-language="German" onclick="location.href=\'/fallback-ready\'">German</button>')
    : url === "/manual-fail" ? page('<button data-language="French">French</button><button data-language="German">German</button><a>Privacy policy</a>')
    : url === "/delayed" ? page('<button onclick="location.href=\'/delayed-ready\'">CLICK HERE TO CHOOSE ENGLISH</button>')
    : url === "/delayed-ready" ? '<!doctype html><html><body><script>setTimeout(() => document.body.innerHTML=\'<nav>PIPES</nav><div id="list-container-inner"><div class="list-item"><a href="/d/-zh/Test-303-i303.html">ready</a></div></div>\', 2500)</script></body></html>'
    : url === "/persist" ? '<!doctype html><html><body><script>if(localStorage.getItem("danish-language")){document.body.innerHTML=\'<nav>PIPES</nav><div id="list-container-inner"><div class="list-item"><a href="/d/-zh/Test-304-i304.html">persisted</a></div></div>\'}else{document.body.innerHTML=\'<div class="site-modal" role="dialog"><h1>Welcome to The Danish Pipe Shop</h1><button>English</button></div>\'}</script></body></html>'
    : url === "/middle" ? card(305, '<a rel="next" href="/middle-language">Next</a>')
    : url === "/middle-language" ? page('<button onclick="location.href=\'/middle-ready\'">CLICK HERE TO CHOOSE ENGLISH</button>')
    : url === "/middle-ready" ? card(306)
    : '<!doctype html><html><body>not found</body></html>';
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" }); response.end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const profileDir = path.join(tempRoot, "profile");
const context = await chromium.launchPersistentContext(profileDir, { channel: "chrome", headless: true });
const options = (route, seconds = 5) => ({ root: tempRoot, startUrl: `${base}${route}`, headed: false, browserChannel: "chrome", manualVerificationSeconds: seconds, languageRetryDelayMs: 50, profileDir, auditDir: path.join(tempRoot, "audit", route.replaceAll("/", "")), context });
process.on("uncaughtException", (error) => { console.error(error.stack || error); process.exit(1); });

const english = await collectLiveList(options("/english"));
assert.equal(english.products.length, 1); assert.equal(english.languageSelection.selectedLanguage, "CLICK HERE TO CHOOSE ENGLISH"); assert.equal(english.languageSelection.automatic, true); // A + exact modal scope, not UK/USD
const divEnglish = await collectLiveList(options("/div-english"));
assert.equal(divEnglish.products.length, 1); assert.equal(divEnglish.languageSelection.completed, true); // div rather than button
const fallback = await collectLiveList(options("/fallback"));
assert.equal(fallback.languageSelection.selectedLanguage, "Danish"); assert.equal(fallback.languageSelection.automatic, true); // B
const disabled = await collectLiveList(options("/disabled"));
assert.equal(disabled.languageSelection.selectedLanguage, "French"); assert.equal(disabled.languageSelection.attemptCount, 1); // C
const close = await collectLiveList(options("/close"));
assert.equal(close.languageSelection.selectedLanguage, "CLICK HERE TO CHOOSE ENGLISH"); // D
const retry = await collectLiveList(options("/retry"));
assert.equal(retry.languageSelection.selectedLanguage, "German"); assert.equal(retry.languageSelection.attemptCount, 2); // E
const delayed = await collectLiveList(options("/delayed", 6));
assert.equal(delayed.products.length, 1); assert.equal(delayed.languageSelection.completed, true); // G overlay/modal closes before cards
const persisted = await collectLiveList(options("/persist"));
assert.equal(persisted.products.length, 1); assert.equal(persisted.languageSelection.detected, false); // H persistent profile state remains
const middle = await collectLiveList(options("/middle"));
assert.equal(middle.products.length, 2); assert.equal(middle.languageSelection.completed, true); // I
const failed = await collectLiveList(options("/manual-fail", 2));
assert.equal(failed.failureStage, "age-language-gate-not-dismissed"); assert.equal(failed.exitCode, 3); assert.equal(failed.languageSelection.fallbackToManual, true); // F

await context.close(); await new Promise((resolve) => server.close(resolve));
console.log("Danish language gate mock E2E tests passed");
process.exit(0);
