import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

import { collectLiveList, runPreview } from "./danish-full-refresh-preview-v1.mjs";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "danish-age-show-more-v1-"));
const cards = (count, duplicate = false) => Array.from({ length: count }, (_, index) => {
  const id = duplicate && index === count - 1 ? 1 : index + 1;
  return `<div class="list-item"><a href="/d/-zh/Test-${id}-i${id}.html"><img alt="Pipe ${id}" src="/img/${id}.jpg"></a>EUR ${id},- Available</div>`;
}).join("");
const listing = (count, total, action = "more") => `<!doctype html><html><body><nav>PIPES</nav><a id="more-info">More info</a><div id="list-container-inner"><p>Showing ${count} of ${total}</p>${cards(count)}<button id="show-more" onclick="${action}">Show more</button></div></body></html>`;
const gate = (target = "after-gate", hiddenCards = 48, english = true) => `<!doctype html><html><body><nav><a>UK / USD</a></nav><div id="list-container-inner"><p>Showing ${hiddenCards} of ${hiddenCards}</p>${cards(hiddenCards)}</div><div class="site-modal" role="dialog"><h1>Welcome to The Danish Pipe Shop</h1>${english ? `<button onclick="location.href='/${target}'">CLICK HERE TO CHOOSE ENGLISH</button>` : ""}</div><div class="modal-overlay"></div></body></html>`;
const progressive = (mode) => `<!doctype html><html><body><nav>PIPES</nav><a id="more-info">More info</a><div id="list-container-inner"></div><script>
let shown=48; const total=${mode === "stuck-total" ? 2238 : 144};
function cards(n){return Array.from({length:n},(_,i)=>'<div class="list-item"><a href="/d/-zh/Test-'+(i+1)+'-i'+(i+1)+'.html">Pipe</a> EUR 1,- Available</div>').join('')}
function render(){document.querySelector('#list-container-inner').innerHTML='<p>Showing '+shown+' of '+total+'</p>'+cards(shown)+(shown<total?'<button id="show-more" onclick="more()">Show more</button>':'')}
function more(){${mode === "no-progress" || mode === "stuck-total" ? "" : mode === "missing" ? "document.querySelector('#show-more').remove()" : mode === "mid-gate" ? "document.body.innerHTML=`<nav>PIPES</nav><div id=list-container-inner></div><div class=site-modal role=dialog><h1>Welcome to The Danish Pipe Shop</h1><a onclick=\\\"shown=96;document.querySelector('.site-modal').remove();document.querySelector('.modal-overlay').remove();render()\\\">CLICK HERE TO CHOOSE ENGLISH</a></div><div class=modal-overlay></div>`" : "shown=Math.min(total,shown+48);render()"}}
render();</script></body></html>`;

const server = http.createServer((request, response) => {
  const body = request.url === "/gate" ? gate()
    : request.url === "/after-gate" ? listing(48, 48, "")
    : request.url === "/div-gate" ? gate("after-gate", 48).replace("<button onclick", "<div role=\"button\" onclick").replace("</button>", "</div>")
    : request.url === "/persisting-gate" ? gate("persisting-gate", 48)
    : request.url === "/progress" ? progressive("progress")
    : request.url === "/stuck" ? progressive("stuck-total")
    : request.url === "/no-progress" ? progressive("no-progress")
    : request.url === "/missing" ? progressive("missing")
    : request.url === "/duplicates" ? listing(3, 4, "document.querySelector('#show-more').remove()") .replace(cards(3), cards(3, true))
    : "<!doctype html><html><body>not found</body></html>";
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" }); response.end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const context = await chromium.launchPersistentContext(path.join(tempRoot, "profile"), { channel: "chrome", headless: true });
const options = (route) => ({ root: tempRoot, startUrl: `${base}${route}`, headed: false, browserChannel: "chrome", manualVerificationSeconds: 2, languageRetryDelayMs: 50, showMoreProgressTimeoutMs: 1200, profileDir: path.join(tempRoot, "profile"), auditDir: path.join(tempRoot, "audit", route.replaceAll("/", "")), context });

const ageGate = await collectLiveList(options("/gate"));
assert.equal(ageGate.languageSelection.completed, true); assert.equal(ageGate.products.length, 48); assert.equal(ageGate.pages[0].itemCount, 48); // overlay cards were not considered ready until exact gate click
const divGate = await collectLiveList(options("/div-gate"));
assert.equal(divGate.languageSelection.elementTag, "DIV"); // exact text's clickable parent works
const persisting = await collectLiveList(options("/persisting-gate"));
assert.equal(persisting.failureStage, "age-language-gate-not-dismissed"); assert.equal(persisting.languageSelection.completed, false); // never emits gate PASS

const complete = await collectLiveList(options("/progress"));
assert.equal(complete.products.length, 144); assert.equal(complete.listing.showMoreClickCount, 2); assert.equal(complete.listing.listTotalMatched, true); // two exact list-scoped Show more clicks
const stuck = await collectLiveList(options("/stuck"));
assert.equal(stuck.failureStage, "show-more-no-progress");
const noProgress = await collectLiveList(options("/no-progress"));
assert.equal(noProgress.failureStage, "show-more-no-progress");
const missing = await collectLiveList(options("/missing"));
assert.equal(missing.failureStage, "show-more-missing-before-total");
const duplicates = await collectLiveList(options("/duplicates"));
assert.equal(duplicates.failureStage, "show-more-missing-before-total"); // DOM count and unique ID completion differ

await assert.rejects(() => runPreview({ automationWorktree: process.cwd(), outputRoot: path.join(tempRoot, "strict"), runId: "strict-total-mismatch-001", listOnly: true, collectedList: { products: ageGate.products, pages: [{ pageIndex: 1, kind: "success", endReason: "shown-total-reached" }], expectedPages: 1, listing: { pageReady: true, requireAbove48: true, detectedTotalCount: 144, listTotalMatched: false, listCompletionReason: "shown-total-reached" } }, detailState: {}, baseline: { production: [], publicCatalog: [] } }), (error) => error.exitCode === 2);

await context.close(); await new Promise((resolve) => server.close(resolve));
console.log("Danish age gate and show-more mock E2E tests passed");
