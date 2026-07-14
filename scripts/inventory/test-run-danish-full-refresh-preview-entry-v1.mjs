import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sourceRoot = process.cwd();
const psEntry = path.join(sourceRoot, "scripts", "inventory", "run-danish-full-refresh-preview-v1.ps1");
const coreSource = path.join(sourceRoot, "scripts", "inventory", "danish-full-refresh-preview-v1.mjs");
const fixture = path.join(sourceRoot, "scripts", "inventory", "fixtures", "danish-full-refresh", "page-1.html");
const emptyFixture = path.join(sourceRoot, "scripts", "inventory", "fixtures", "danish-full-refresh", "empty.html");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "danish-entry-v1-"));

function copy(file, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(file, destination);
}
function prepareWorkingTree(root, coreText = null) {
  const corePath = path.join(root, "scripts", "inventory", "danish-full-refresh-preview-v1.mjs");
  fs.mkdirSync(path.dirname(corePath), { recursive: true });
  if (coreText === null) copy(coreSource, corePath); else fs.writeFileSync(corePath, coreText, "utf8");
  copy(path.join(sourceRoot, "data", "products", "danish-products.json"), path.join(root, "data", "products", "danish-products.json"));
  copy(path.join(sourceRoot, "data", "generated", "public-products", "catalog.json"), path.join(root, "data", "generated", "public-products", "catalog.json"));
  return corePath;
}
function run(root, runId, extra = []) {
  return spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", psEntry, "-AutomationWorktree", root, "-RunId", runId, ...extra], { encoding: "utf8", cwd: sourceRoot });
}

const successRoot = path.join(tempRoot, "success");
const successCore = prepareWorkingTree(successRoot);
const listOnly = run(successRoot, "entry-fixture-001", ["-ListOnly", "-Headed", "-ManualVerificationSeconds", "21", "-FixtureListPath", fixture]);
assert.equal(listOnly.status, 0, `${listOnly.stdout}\n${listOnly.stderr}`);
assert.match(listOnly.stdout, /\[START\] Danish full refresh/);
assert.match(listOnly.stdout, /mode: ListOnly/);
assert.match(listOnly.stdout, /headed: True/);
assert.match(listOnly.stdout, /manual verification timeout: 21 seconds/);
assert.match(listOnly.stdout, /\[NODE\] Danish full refresh mode=fixture listOnly=true resume=false headed=true/);
assert.match(listOnly.stdout, /\[PASS\] Danish ListOnly/);
for (const relative of ["data/raw/danish-full-refresh/entry-fixture-001/list.json", "data/raw/danish-full-refresh/entry-fixture-001/manifest.json", "data/audits/danish-full-refresh/entry-fixture-001/page-audit.json"]) assert.equal(fs.existsSync(path.join(successRoot, relative)), true, relative);
const manifest = JSON.parse(fs.readFileSync(path.join(successRoot, "data", "raw", "danish-full-refresh", "entry-fixture-001", "manifest.json"), "utf8"));
assert.equal(manifest.uniqueProducts, 2); // A/B/F: Node was launched, ListOnly reached the core, live network was not used.
const strictEmpty = run(successRoot, "entry-empty-001", ["-ListOnly", "-FixtureListPath", emptyFixture]);
assert.equal(strictEmpty.status, 4, `${strictEmpty.stdout}\n${strictEmpty.stderr}`); assert.doesNotMatch(strictEmpty.stdout, /\[PASS\] Danish ListOnly/); // list page/product count zero never prints PASS

fs.writeFileSync(successCore, "process.stderr.write('core must not run in ReportOnly\\n'); process.exit(93);\n", "utf8");
const reportOnly = run(successRoot, "entry-fixture-001", ["-ReportOnly"]);
assert.equal(reportOnly.status, 0, `${reportOnly.stdout}\n${reportOnly.stderr}`);
assert.match(reportOnly.stdout, /\[PASS\] Danish ReportOnly/); // G: report never invokes Node/live collection.

copy(coreSource, successCore);
const resume = run(successRoot, "entry-fixture-resume", ["-Resume", "-FixtureListPath", fixture]);
assert.equal(resume.status, 0, `${resume.stdout}\n${resume.stderr}`);
assert.match(resume.stdout, /mode: Resume/);
assert.match(resume.stdout, /listOnly=false resume=true/); // H: Resume did not become ListOnly.

const nodeFailureRoot = path.join(tempRoot, "node-failure");
prepareWorkingTree(nodeFailureRoot, "process.stderr.write('forced node failure\\n'); process.exit(47);\n");
const nodeFailure = run(nodeFailureRoot, "entry-failure-001", ["-ListOnly"]);
assert.equal(nodeFailure.status, 47, `${nodeFailure.stdout}\n${nodeFailure.stderr}`);
assert.match(`${nodeFailure.stdout}\n${nodeFailure.stderr}`, /forced node failure/); // C: external Node exit propagates.

const missingCoreRoot = path.join(tempRoot, "missing-core"); fs.mkdirSync(missingCoreRoot, { recursive: true });
const missingCore = run(missingCoreRoot, "entry-missing-001", ["-ListOnly"]);
assert.notEqual(missingCore.status, 0); assert.match(`${missingCore.stdout}\n${missingCore.stderr}`, /Preview core not found/); // D

const noOutputRoot = path.join(tempRoot, "no-output");
prepareWorkingTree(noOutputRoot, "console.log('stub node exited successfully');\n");
const noOutput = run(noOutputRoot, "entry-no-output-001", ["-ListOnly"]);
assert.notEqual(noOutput.status, 0); assert.match(`${noOutput.stdout}\n${noOutput.stderr}`, /required output was not generated/); // E

const psSource = fs.readFileSync(psEntry, "utf8");
assert.doesNotMatch(psSource, /(?:-Apply|-Commit|-Push|Register-ScheduledTask|Set-ScheduledTask|schtasks)/i); // I
console.log("Danish PowerShell entry integration tests passed");
