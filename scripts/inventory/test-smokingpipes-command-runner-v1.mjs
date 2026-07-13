import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const projectRoot = process.cwd();
const modulePath = path.join(projectRoot, "scripts", "inventory", "smokingpipes-command-execution-v1.psm1");
const nodePath = process.execPath;
const powershellPath = `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smokingpipes-command-stream-"));

function psLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function runPowerShellCommand({ name, code = "", filePath = nodePath, args = null, timeout = 30, result = true }) {
  const driverPath = path.join(fixtureRoot, `${name}.ps1`);
  const resultPath = path.join(fixtureRoot, `${name}.result.json`);
  fs.writeFileSync(driverPath, [
    "$ErrorActionPreference='Stop'",
    `Import-Module -Force ${psLiteral(modulePath)}`,
    "try {",
    `  $r=Invoke-SmokingpipesCommand -Stage ${psLiteral(name)} -FilePath ${psLiteral(filePath)} -Arguments @(${(args || ["-e", code]).map(psLiteral).join(",")}) -WorkingDirectory ${psLiteral(fixtureRoot)} -TimeoutSeconds ${timeout}`,
    result ? `  [IO.File]::WriteAllText(${psLiteral(resultPath)},($r | ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))` : "  Write-Output 'COMMAND-SUCCEEDED'",
    `} catch { if ($_.Exception.Data['stdoutTail'] -or $_.Exception.Data['stderrTail']) { $failure=[ordered]@{stdoutTail=[string]$_.Exception.Data['stdoutTail'];stderrTail=[string]$_.Exception.Data['stderrTail']};[IO.File]::WriteAllText(${psLiteral(resultPath)},($failure | ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false)) }; Write-Error $_.Exception.Message; exit 1 }`,
  ].join("\r\n"), "utf8");
  const started = Date.now();
  const events = [];
  const child = spawn(powershellPath, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", driverPath], { cwd: projectRoot, shell: false, windowsHide: true });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); events.push({ stream: "stdout", text: chunk.toString("utf8"), at: Date.now() }); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); events.push({ stream: "stderr", text: chunk.toString("utf8"), at: Date.now() }); });
  const exitCode = await new Promise((resolve) => child.on("close", resolve));
  const commandResult = fs.existsSync(resultPath) ? JSON.parse(fs.readFileSync(resultPath, "utf8")) : null;
  return { exitCode, stdout, stderr, events, started, ended: Date.now(), commandResult };
}

function count(text, marker) {
  return text.split(marker).length - 1;
}

try {
  const stream = await runPowerShellCommand({
    name: "stream-timing",
    code: "process.stdout.write('STREAM-OUT-1\\n');setTimeout(()=>process.stderr.write('STREAM-ERR-1\\n'),3000);setTimeout(()=>process.stdout.write('STREAM-OUT-2\\n'),6000);setTimeout(()=>process.exit(0),7000);",
  });
  assert.equal(stream.exitCode, 0, stream.stderr);
  const out1 = stream.events.find((event) => event.text.includes("STREAM-OUT-1"));
  const err1 = stream.events.find((event) => event.text.includes("STREAM-ERR-1"));
  const out2 = stream.events.find((event) => event.text.includes("STREAM-OUT-2"));
  const pass = stream.events.find((event) => event.text.includes("[PASS] stream-timing"));
  assert.ok(out1 && stream.ended - out1.at >= 4000, "first stdout marker was not streamed early");
  assert.ok(err1 && err1.at < stream.ended, "stderr marker was not streamed before exit");
  assert.ok(out2 && out2.at < stream.ended, "second stdout marker was not streamed before exit");
  assert.ok(pass && pass.at >= out2.at, "PASS must follow child output");
  assert.equal(count(stream.stdout + stream.stderr, "STREAM-OUT-1"), 1);
  assert.equal(count(stream.stdout + stream.stderr, "STREAM-ERR-1"), 1);
  assert.equal(count(stream.stdout + stream.stderr, "STREAM-OUT-2"), 1);
  const streamResult = stream.commandResult;
  assert.equal(streamResult.exitCode, 0);
  assert.match(streamResult.stdoutTail, /STREAM-OUT-1[\s\S]*STREAM-OUT-2/);
  assert.match(streamResult.stderrTail, /STREAM-ERR-1/);

  const repeated = await runPowerShellCommand({ name: "stream-repeated", code: "let i=0;const t=setInterval(()=>{console.log('TICK-'+(++i));if(i===10){clearInterval(t)}},1000);setTimeout(()=>process.exit(0),10500);" });
  assert.equal(repeated.exitCode, 0, repeated.stderr);
  const repeatedLines = repeated.stdout.split(/\r?\n/);
  for (let index = 1; index <= 10; index += 1) assert.equal(repeatedLines.filter((line) => line === `TICK-${index}`).length, 1);

  const concurrent = await runPowerShellCommand({ name: "stream-concurrent", code: "for(let i=0;i<20;i++){process.stdout.write('OUT-'+i+'\\n');process.stderr.write('ERR-'+i+'\\n')}process.stdout.write('X'.repeat(40000)+'TAIL-END\\n');" });
  assert.equal(concurrent.exitCode, 0, concurrent.stderr);
  const concurrentResult = concurrent.commandResult;
  assert.ok(concurrentResult.stdoutTail.length <= 32768);
  assert.ok(concurrentResult.stderrTail.length <= 32768);
  assert.match(concurrentResult.stdoutTail, /TAIL-END/);

  const nonzero = await runPowerShellCommand({ name: "stream-nonzero", code: "process.stderr.write('EXPECTED-FAIL\\n');process.exit(7);", result: false });
  assert.notEqual(nonzero.exitCode, 0);
  assert.equal(count(nonzero.stderr, "EXPECTED-FAIL"), 1, "live stderr must not be printed again in the exception");
  assert.match(nonzero.commandResult.stderrTail, /EXPECTED-FAIL/);

  const diffRoot = path.join(fixtureRoot, "crlf-diff");
  fs.mkdirSync(diffRoot);
  const gitPath = spawnSync("where.exe", ["git.exe"], { encoding: "utf8" }).stdout.split(/\r?\n/).find(Boolean);
  spawnSync(gitPath, ["init"], { cwd: diffRoot });
  spawnSync(gitPath, ["config", "user.email", "stream@example.invalid"], { cwd: diffRoot });
  spawnSync(gitPath, ["config", "user.name", "Stream Test"], { cwd: diffRoot });
  const noisyPath = path.join(diffRoot, "noisy.txt");
  fs.writeFileSync(noisyPath, Array.from({ length: 12000 }, (_, index) => `line-${index}`).join("\n") + "\n");
  spawnSync(gitPath, ["add", "noisy.txt"], { cwd: diffRoot });
  spawnSync(gitPath, ["commit", "-m", "fixture"], { cwd: diffRoot });
  fs.writeFileSync(noisyPath, Array.from({ length: 12000 }, (_, index) => `line-${index}   \r\n`).join(""));
  const diffCheck = await runPowerShellCommand({ name: "crlf-diff-check", filePath: gitPath, args: ["-C", diffRoot, "diff", "--check"], result: false });
  assert.notEqual(diffCheck.exitCode, 0);
  assert.ok(diffCheck.commandResult.stdoutTail.length <= 32768);
  assert.ok(diffCheck.commandResult.stderrTail.length <= 32768);
  assert.match(diffCheck.commandResult.stdoutTail, /trailing whitespace/);

  const grandchildPidPath = path.join(fixtureRoot, "grandchild.pid");
  const grandchildCode = "setInterval(()=>{},1000)";
  const timeoutCode = `const{spawn}=require('child_process');const fs=require('fs');const c=spawn(process.execPath,['-e',${JSON.stringify(grandchildCode)}],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(grandchildPidPath)},String(c.pid));setInterval(()=>{},1000);`;
  const timed = await runPowerShellCommand({ name: "stream-timeout", code: timeoutCode, timeout: 3, result: false });
  assert.notEqual(timed.exitCode, 0);
  assert.match(timed.stderr, /timed out/i);
  const grandchildPid = Number(fs.readFileSync(grandchildPidPath, "utf8"));
  const processCheck = spawnSync(powershellPath, ["-NoProfile", "-Command", `if(Get-Process -Id ${grandchildPid} -ErrorAction SilentlyContinue){exit 1}else{exit 0}`]);
  assert.equal(processCheck.status, 0, `grandchild process ${grandchildPid} survived timeout`);

  console.log("Smokingpipes streaming command runner tests passed.");
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
