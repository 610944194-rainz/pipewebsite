import {
  addParsedMeasurements,
  detectSmokingpipesVerification,
  extractDetailProduct,
  launchSmokingpipesContext,
} from "../lib/smokingpipes-utils.mjs";
import {
  summarizeDetailsQueue,
  writeJsonAtomic,
} from "./inventory-runner-core-v1.mjs";
import { randomDelayMs } from "./smokingpipes-fetch-current-list-v1.mjs";

function activeCandidates(queue, limit) {
  return (queue.items || [])
    .filter(
      (item) =>
        item.active !== false &&
        item.status !== "completed" &&
        item.status !== "superseded" &&
        item.status !== "ignored"
    )
    .slice(0, limit);
}

function updateQueueSummary(queue) {
  queue.updatedAt = new Date().toISOString();
  queue.summary = summarizeDetailsQueue(queue);
}

export async function writeSmokingpipesQueueCheckpoint(
  queue,
  queuePath,
  {
    atomicWriteOptions = {},
    currentProductId = null,
    verbose = false,
  } = {}
) {
  updateQueueSummary(queue);
  try {
    await writeJsonAtomic(queuePath, queue, {
      ...atomicWriteOptions,
      verbose: atomicWriteOptions.verbose ?? verbose,
    });
  } catch (error) {
    if (error?.code !== "ATOMIC_WRITE_RENAME_FAILED") throw error;
    throw Object.assign(
      new Error(
        `Queue checkpoint failed after retries: ${queuePath}`
      ),
      {
        code: "CHECKPOINT_FAILED",
        checkpointFailed: true,
        currentProductId,
        targetPath: error.targetPath,
        tempPath: error.tempPath,
        attempts: error.attempts,
        lastError: error.lastError,
        cause: error,
      }
    );
  }
}

function markMockComplete(item) {
  const now = new Date().toISOString();
  item.status = "completed";
  item.lastError = null;
  item.lastTriedAt = now;
  item.completedAt = now;
  item.updatedAt = now;
  item.detail = {
    sourceSite: "Smokingpipes",
    sourceUrl: item.sourceUrl,
    sourceProductId: item.sourceProductId,
    brand: item.brand,
    title: item.title || `Mock pipe ${item.sourceProductId}`,
    status: "available",
    galleryImages: item.mainImage ? [item.mainImage] : [],
    galleryCount: item.mainImage ? 1 : 0,
    mock: true,
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function processSmokingpipesDetailsQueue({
  queue,
  queuePath,
  maxItems = 10,
  batchSize = 5,
  detailWarmupMinMs = 5000,
  detailWarmupMaxMs = 12000,
  detailDelayMinMs = 15000,
  detailDelayMaxMs = 35000,
  detailBatchCooldownMinMs = 90000,
  detailBatchCooldownMaxMs = 180000,
  browserChannel = null,
  allowManualVerification = false,
  verbose = false,
  mock = false,
  mockVerificationAt = null,
  deadlineAtMs = null,
  nowMs = () => Date.now(),
  atomicWriteOptions = {},
}) {
  const candidates = activeCandidates(queue, maxItems);
  const result = {
    requested: maxItems,
    selected: candidates.length,
    attempted: 0,
    completed: 0,
    failed: 0,
    captchaRequired: false,
    runtimeLimitReached: false,
  };

  if (!candidates.length) {
    await writeSmokingpipesQueueCheckpoint(queue, queuePath, {
      atomicWriteOptions,
      verbose,
    });
    return { queue, result };
  }

  if (mock) {
    for (let index = 0; index < candidates.length; index += 1) {
      if (deadlineAtMs !== null && nowMs() >= deadlineAtMs) {
        result.runtimeLimitReached = true;
        break;
      }
      const item = candidates[index];
      result.attempted += 1;
      if (verbose) {
        console.log(
          `fetching new detail ${index + 1}/${candidates.length}: ${item.sourceProductId}`
        );
      }
      if (mockVerificationAt === index + 1) {
        const blockedAt = new Date().toISOString();
        item.status = "blocked";
        item.lastError = `Mock Smokingpipes verification at product ${item.sourceProductId}.`;
        item.lastTriedAt = blockedAt;
        item.updatedAt = blockedAt;
        result.failed += 1;
        result.captchaRequired = true;
        await writeSmokingpipesQueueCheckpoint(queue, queuePath, {
          atomicWriteOptions,
          currentProductId: item.sourceProductId,
          verbose,
        });
        throw Object.assign(
          new Error(item.lastError),
          {
            code: "CAPTCHA_REQUIRED",
            currentProductId: item.sourceProductId,
          }
        );
      }
      result.completed += 1;
      markMockComplete(item);
      if (verbose) {
        console.log(`detail parsed / saved: ${item.sourceProductId}`);
      }
      await writeSmokingpipesQueueCheckpoint(queue, queuePath, {
        atomicWriteOptions,
        currentProductId: item.sourceProductId,
        verbose,
      });
    }
    return { queue, result };
  }

  process.env.SMOKINGPIPES_HEADLESS = allowManualVerification
    ? "false"
    : process.env.SMOKINGPIPES_HEADLESS || "true";

  const context = await launchSmokingpipesContext({ browserChannel });
  const page = context.pages()[0] || (await context.newPage());

  try {
    for (let index = 0; index < candidates.length; index += 1) {
      if (deadlineAtMs !== null && nowMs() >= deadlineAtMs) {
        result.runtimeLimitReached = true;
        break;
      }
      const item = candidates[index];
      const now = new Date().toISOString();
      item.status = "in-progress";
      item.lastTriedAt = now;
      item.updatedAt = now;
      result.attempted += 1;
      await writeSmokingpipesQueueCheckpoint(queue, queuePath, {
        atomicWriteOptions,
        currentProductId: item.sourceProductId,
        verbose,
      });

      try {
        if (verbose) {
          console.log(
            `fetching new detail ${index + 1}/${candidates.length}: ${item.sourceProductId}`
          );
        }

        const response = await page.goto(item.sourceUrl, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });
        const warmupDelayMs = randomDelayMs(
          detailWarmupMinMs,
          detailWarmupMaxMs
        );
        if (verbose) {
          console.log(`detail warmup delay: ${warmupDelayMs} ms`);
        }
        if (warmupDelayMs > 0) {
          await page.waitForTimeout(warmupDelayMs);
        }

        const detection = await detectSmokingpipesVerification(page, {
          pageKind: "detail",
          httpStatus: response?.status() || 0,
        });

        if (detection.verificationBlocked) {
          result.captchaRequired = true;
          const blockedAt = new Date().toISOString();
          item.status = "blocked";
          item.lastError = `Smokingpipes CAPTCHA requires manual action at product ${item.sourceProductId}.`;
          item.lastTriedAt = blockedAt;
          item.updatedAt = blockedAt;
          console.warn(
            `Smokingpipes verification detected at product ${item.sourceProductId}. Detail fetching is stopping immediately; no automatic bypass will be attempted.`
          );
          await writeSmokingpipesQueueCheckpoint(queue, queuePath, {
            atomicWriteOptions,
            currentProductId: item.sourceProductId,
            verbose,
          });
          throw Object.assign(new Error(item.lastError), {
            code: "CAPTCHA_REQUIRED",
            currentProductId: item.sourceProductId,
          });
        }

        const detail = addParsedMeasurements(
          await extractDetailProduct(page, item, "new")
        );
        if (
          !detail.sourceProductId ||
          String(detail.sourceProductId) !== String(item.sourceProductId)
        ) {
          throw new Error(
            `Detail identity mismatch for ${item.sourceProductId}.`
          );
        }

        const completedAt = new Date().toISOString();
        item.status = "completed";
        item.detail = detail;
        item.lastError = null;
        item.completedAt = completedAt;
        item.updatedAt = completedAt;
        result.completed += 1;
        if (verbose) {
          console.log(
            `detail parsed / saved: ${item.sourceProductId}`
          );
        }
      } catch (error) {
        if (error?.code === "CAPTCHA_REQUIRED") throw error;

        const failedAt = new Date().toISOString();
        item.status = "failed";
        item.retryCount = Number(item.retryCount || 0) + 1;
        item.lastError = error instanceof Error ? error.message : String(error);
        item.updatedAt = failedAt;
        result.failed += 1;
        await writeSmokingpipesQueueCheckpoint(queue, queuePath, {
          atomicWriteOptions,
          currentProductId: item.sourceProductId,
          verbose,
        });
        if (verbose) {
          console.log(
            `detail skipped after error: ${item.sourceProductId} | ${item.lastError}`
          );
        }
      }

      await writeSmokingpipesQueueCheckpoint(queue, queuePath, {
        atomicWriteOptions,
        currentProductId: item.sourceProductId,
        verbose,
      });
      const processedCount = index + 1;
      const hasMore = processedCount < candidates.length;
      if (hasMore && processedCount % Math.max(1, batchSize) === 0) {
        const cooldownMs = randomDelayMs(
          detailBatchCooldownMinMs,
          detailBatchCooldownMaxMs
        );
        if (verbose) {
          console.log(
            `detail batch cooldown after ${processedCount} items: ${cooldownMs} ms`
          );
        }
        if (cooldownMs > 0) await page.waitForTimeout(cooldownMs);
      } else if (hasMore) {
        const nextDelayMs = randomDelayMs(
          detailDelayMinMs,
          detailDelayMaxMs
        );
        if (verbose) {
          console.log(`detail next delay: ${nextDelayMs} ms`);
        }
        if (nextDelayMs > 0) await page.waitForTimeout(nextDelayMs);
      }
    }
  } finally {
    await context.close().catch(() => {});
  }

  return { queue, result };
}

export async function processSmokingpipesCatchUpCycles({
  queue,
  queuePath,
  detailMaxPerRun = 50,
  autoRepeat = false,
  maxCycles = 1,
  repeatDelayMinMs = 300000,
  repeatDelayMaxMs = 600000,
  maxTotalDetails = 200,
  maxRuntimeMinutes = 90,
  mock = false,
  verbose = false,
  mockVerificationAt = null,
  now = () => Date.now(),
  sleep = wait,
  ...detailOptions
}) {
  const startedAtMs = now();
  const deadlineAtMs =
    startedAtMs + Math.max(1, maxRuntimeMinutes) * 60 * 1000;
  const cycleLimit = autoRepeat ? Math.max(1, maxCycles) : 1;
  const runtimeLimitMs = Math.max(1, maxRuntimeMinutes) * 60 * 1000;
  const result = {
    requested: Math.min(
      detailMaxPerRun * cycleLimit,
      maxTotalDetails
    ),
    selected: 0,
    attempted: 0,
    completed: 0,
    failed: 0,
    captchaRequired: false,
    cyclesCompleted: 0,
    stopReason: "cycle-limit",
  };
  let currentQueue = queue;

  for (let cycle = 1; cycle <= cycleLimit; cycle += 1) {
    const totalRemaining = maxTotalDetails - result.attempted;
    if (totalRemaining <= 0) {
      result.stopReason = "total-detail-limit";
      break;
    }
    if (now() - startedAtMs >= runtimeLimitMs) {
      result.stopReason = "runtime-limit";
      break;
    }

    const maxItems = Math.min(detailMaxPerRun, totalRemaining);
    if (verbose) {
      console.log(
        `baseline catch-up cycle ${cycle}/${cycleLimit}: max ${maxItems} details`
      );
    }

    let processed;
    try {
      processed = await processSmokingpipesDetailsQueue({
        queue: currentQueue,
        queuePath,
        maxItems,
        mock,
        verbose,
        mockVerificationAt,
        deadlineAtMs,
        nowMs: now,
        ...detailOptions,
      });
    } catch (error) {
      error.catchUpCyclesCompleted = result.cyclesCompleted;
      throw error;
    }

    currentQueue = processed.queue;
    result.cyclesCompleted += 1;
    result.selected += processed.result.selected;
    result.attempted += processed.result.attempted;
    result.completed += processed.result.completed;
    result.failed += processed.result.failed;
    result.captchaRequired =
      result.captchaRequired || processed.result.captchaRequired;

    const summary = summarizeDetailsQueue(currentQueue);
    if (processed.result.runtimeLimitReached) {
      result.stopReason = "runtime-limit";
      break;
    }
    if (summary.remaining === 0) {
      result.stopReason = "queue-complete";
      break;
    }
    if (processed.result.selected === 0) {
      result.stopReason = "no-candidates";
      break;
    }
    if (result.attempted >= maxTotalDetails) {
      result.stopReason = "total-detail-limit";
      break;
    }
    if (now() - startedAtMs >= runtimeLimitMs) {
      result.stopReason = "runtime-limit";
      break;
    }
    if (cycle >= cycleLimit) {
      result.stopReason = "cycle-limit";
      break;
    }

    const repeatDelayMs = randomDelayMs(
      repeatDelayMinMs,
      repeatDelayMaxMs
    );
    if (verbose) {
      console.log(
        mock
          ? `mock catch-up repeat delay skipped: ${repeatDelayMs} ms`
          : `catch-up repeat delay: ${repeatDelayMs} ms`
      );
    }
    if (!mock && repeatDelayMs > 0) {
      await sleep(repeatDelayMs);
    }
  }

  return { queue: currentQueue, result };
}
