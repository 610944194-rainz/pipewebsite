import path from "node:path";
import process from "node:process";
import {
  readCycle,
  recordPublishedBundle,
  transitionCycle,
} from "./smokingpipes-cycle-store-v2.mjs";

function parseArgs(argv = process.argv.slice(2)) {
  const options = new Map();
  for (const argument of argv) {
    const [key, ...rest] = argument.replace(/^--/, "").split("=");
    options.set(key, rest.length ? rest.join("=") : true);
  }
  return options;
}

export async function markSmokingpipesReleaseState({
  stateRoot,
  cycleId,
  bundleId,
  status,
  commitSha = null,
  reason = null,
} = {}) {
  const cycle = await readCycle(stateRoot, cycleId);
  if (!cycle) throw new Error(`cycle not found: ${cycleId}`);
  if (status === "published") {
    const next = await transitionCycle({
      stateRoot,
      cycle,
      phase: "published",
      reason: "release-published",
      patch: {
        release: {
          bundleId,
          commitSha,
          publishedAt: new Date().toISOString(),
        },
      },
    });
    await recordPublishedBundle({ stateRoot, bundleId, cycleId, commitSha });
    return next;
  }
  if (status === "release-retryable") {
    return transitionCycle({
      stateRoot,
      cycle,
      phase: "release-retryable",
      reason: reason || "release-failed",
      patch: {
        failure: {
          stage: "release",
          message: reason || "release failed",
          at: new Date().toISOString(),
        },
      },
    });
  }
  throw new Error(`unsupported release state status: ${status}`);
}

async function main() {
  const options = parseArgs();
  const next = await markSmokingpipesReleaseState({
    stateRoot: options.get("state-root"),
    cycleId: options.get("cycle-id"),
    bundleId: options.get("bundle-id"),
    status: options.get("status"),
    commitSha: options.get("commit-sha") || null,
    reason: options.get("reason") || null,
  });
  console.log(JSON.stringify(next, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"))) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
