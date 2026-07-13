import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const options = { commandArgs: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--") {
      options.commandArgs = argv.slice(index + 1);
      break;
    }
    const key = value.startsWith("--") ? value.slice(2) : "";
    if (!key || index + 1 >= argv.length) throw new Error(`invalid helper argument: ${value}`);
    options[key] = argv[++index];
  }
  return options;
}

function appendTail(current, chunk, limit) {
  const combined = current + chunk;
  return combined.length <= limit ? combined : combined.slice(combined.length - limit);
}

function quoteCmdArg(value) {
  if (!/[\s"&|<>^()%!]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

function writeJsonAtomically(target, value) {
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, "utf8");
    JSON.parse(fs.readFileSync(temporary, "utf8"));
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

function terminateTree(pid) {
  if (process.platform === "win32") {
    return spawnSync(`${process.env.SystemRoot}\\System32\\taskkill.exe`, ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      encoding: "utf8",
    });
  }
  try { process.kill(-pid, "SIGKILL"); } catch {}
  return { status: 0, stdout: "", stderr: "" };
}

const startedAt = Date.now();
let resultPath;
try {
  const rawOptions = parseArgs(process.argv.slice(2));
  const options = rawOptions.request
    ? JSON.parse(fs.readFileSync(path.resolve(rawOptions.request), "utf8"))
    : rawOptions;
  const stage = options.stage;
  const filePath = path.resolve(options.file);
  const cwd = path.resolve(options.cwd);
  resultPath = path.resolve(options.result);
  const timeoutSeconds = Number(options.timeout);
  const tailCharacters = Number(options.tail);
  if (!stage || !fs.statSync(filePath).isFile() || !fs.statSync(cwd).isDirectory()) throw new Error("invalid command runner paths");
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1) throw new Error("invalid timeout");
  if (!Number.isInteger(tailCharacters) || tailCharacters < 1024 || tailCharacters > 32768) throw new Error("invalid tail limit");

  let executable = filePath;
  let commandArgs = options.commandArgs;
  let windowsVerbatimArguments = false;
  if (process.platform === "win32" && /\.(?:cmd|bat)$/i.test(filePath)) {
    executable = process.env.ComSpec || `${process.env.SystemRoot}\\System32\\cmd.exe`;
    commandArgs = ["/d", "/s", "/c", `call ${quoteCmdArg(filePath)} ${commandArgs.map(quoteCmdArg).join(" ")}`];
    // Node's default Windows argument quoting turns the embedded cmd.exe
    // quotes into literal \" characters. cmd.exe then looks for an executable
    // whose name includes those quotes. This command line is already escaped
    // for cmd.exe, so pass it through verbatim.
    windowsVerbatimArguments = true;
  }

  process.stdout.write(`[START] ${stage} timeout=${timeoutSeconds}s\n`);
  const child = spawn(executable, commandArgs, {
    cwd,
    shell: false,
    windowsHide: true,
    windowsVerbatimArguments,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdoutTail = "";
  let stderrTail = "";
  let timedOut = false;
  let timeoutTermination = null;
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    process.stdout.write(chunk);
    stdoutTail = appendTail(stdoutTail, text, tailCharacters);
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    process.stderr.write(chunk);
    stderrTail = appendTail(stderrTail, text, tailCharacters);
  });
  const heartbeat = setInterval(() => {
    process.stdout.write(`[PROGRESS] ${stage} still-running elapsed=${Math.floor((Date.now() - startedAt) / 1000)}s pid=${child.pid}\n`);
  }, 60_000);
  const timeout = setTimeout(() => {
    timedOut = true;
    timeoutTermination = terminateTree(child.pid);
  }, timeoutSeconds * 1000);

  const completion = await new Promise((resolve) => {
    child.once("error", (error) => resolve({ exitCode: null, signal: null, spawnError: error.message }));
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal, spawnError: null }));
  });
  clearInterval(heartbeat);
  clearTimeout(timeout);
  const durationSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(2));
  const result = {
    stage,
    pid: child.pid ?? null,
    exitCode: completion.exitCode,
    signal: completion.signal,
    timedOut,
    durationSeconds,
    stdoutTail,
    stderrTail,
    spawnError: completion.spawnError,
    terminationExitCode: timeoutTermination?.status ?? null,
  };
  writeJsonAtomically(resultPath, result);
  if (timedOut || completion.exitCode !== 0 || completion.spawnError) {
    process.stderr.write(`[FAIL] ${stage} exitCode=${completion.exitCode ?? "null"} timedOut=${timedOut} duration=${durationSeconds}s\n`);
  } else {
    process.stdout.write(`[PASS] ${stage} duration=${durationSeconds}s pid=${child.pid} exitCode=0\n`);
  }
} catch (error) {
  const failure = { stage: "command-runner", pid: null, exitCode: null, timedOut: false, durationSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)), stdoutTail: "", stderrTail: String(error?.message || error), spawnError: String(error?.message || error) };
  if (resultPath) {
    try { writeJsonAtomically(resultPath, failure); } catch {}
  }
  process.stderr.write(`[FAIL] command-runner ${failure.stderrTail}\n`);
  process.exitCode = 2;
}
