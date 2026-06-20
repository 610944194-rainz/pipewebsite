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

function activeCandidates(queue, limit) {
  return (queue.items || [])
    .filter(
      (item) =>
        item.active !== false &&
        item.status !== "completed" &&
        item.status !== "superseded"
    )
    .slice(0, limit);
}

async function waitForVerification(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  await page.bringToFront().catch(() => {});

  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);
    const detection = await detectSmokingpipesVerification(page, {
      pageKind: "detail",
    });
    if (!detection.verificationBlocked) return true;
  }

  return false;
}

function updateQueueSummary(queue) {
  queue.updatedAt = new Date().toISOString();
  queue.summary = summarizeDetailsQueue(queue);
}

async function checkpoint(queue, queuePath) {
  updateQueueSummary(queue);
  await writeJsonAtomic(queuePath, queue);
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

export async function processSmokingpipesDetailsQueue({
  queue,
  queuePath,
  maxItems = 100,
  batchSize = 50,
  allowManualVerification = false,
  manualVerificationTimeoutMs = 30 * 60 * 1000,
  verbose = false,
  mock = false,
}) {
  const candidates = activeCandidates(queue, maxItems);
  const result = {
    requested: maxItems,
    selected: candidates.length,
    attempted: 0,
    completed: 0,
    failed: 0,
    captchaRequired: false,
  };

  if (!candidates.length) {
    await checkpoint(queue, queuePath);
    return { queue, result };
  }

  if (mock) {
    const mockLimit = Math.min(candidates.length, 2);
    for (const item of candidates.slice(0, mockLimit)) {
      result.attempted += 1;
      result.completed += 1;
      markMockComplete(item);
    }
    await checkpoint(queue, queuePath);
    return { queue, result };
  }

  process.env.SMOKINGPIPES_HEADLESS = allowManualVerification
    ? "false"
    : process.env.SMOKINGPIPES_HEADLESS || "true";

  const context = await launchSmokingpipesContext();
  const page = context.pages()[0] || (await context.newPage());

  try {
    for (let index = 0; index < candidates.length; index += 1) {
      const item = candidates[index];
      const now = new Date().toISOString();
      item.status = "in-progress";
      item.lastTriedAt = now;
      item.updatedAt = now;
      result.attempted += 1;
      await checkpoint(queue, queuePath);

      try {
        if (verbose) {
          console.log(
            `Fetching new detail ${index + 1}/${candidates.length}: ${item.sourceProductId}`
          );
        }

        const response = await page.goto(item.sourceUrl, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });
        let detection = await detectSmokingpipesVerification(page, {
          pageKind: "detail",
          httpStatus: response?.status() || 0,
        });

        if (detection.verificationBlocked) {
          result.captchaRequired = true;
          if (!allowManualVerification) {
            throw Object.assign(
              new Error(
                `Smokingpipes CAPTCHA requires manual action at product ${item.sourceProductId}.`
              ),
              { code: "CAPTCHA_REQUIRED" }
            );
          }

          console.warn(
            `Smokingpipes verification requires attention for product ${item.sourceProductId}. Complete it in the visible browser.`
          );
          const recovered = await waitForVerification(
            page,
            manualVerificationTimeoutMs
          );
          if (!recovered) {
            throw Object.assign(
              new Error(
                `Smokingpipes manual verification timed out at product ${item.sourceProductId}.`
              ),
              { code: "CAPTCHA_REQUIRED" }
            );
          }
          detection = await detectSmokingpipesVerification(page, {
            pageKind: "detail",
          });
          if (detection.verificationBlocked) {
            throw Object.assign(
              new Error(
                `Smokingpipes verification remained blocked at product ${item.sourceProductId}.`
              ),
              { code: "CAPTCHA_REQUIRED" }
            );
          }
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
      } catch (error) {
        const failedAt = new Date().toISOString();
        item.status = "failed";
        item.retryCount = Number(item.retryCount || 0) + 1;
        item.lastError = error instanceof Error ? error.message : String(error);
        item.updatedAt = failedAt;
        result.failed += 1;
        await checkpoint(queue, queuePath);

        if (error?.code === "CAPTCHA_REQUIRED") throw error;
      }

      await checkpoint(queue, queuePath);
      if (
        verbose &&
        ((index + 1) % Math.max(1, batchSize) === 0 ||
          index === candidates.length - 1)
      ) {
        console.log(
          `Detail queue checkpoint: ${index + 1}/${candidates.length}`
        );
      }
    }
  } finally {
    await context.close().catch(() => {});
  }

  await checkpoint(queue, queuePath);
  return { queue, result };
}
