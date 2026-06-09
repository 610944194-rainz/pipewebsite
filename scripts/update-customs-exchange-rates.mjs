import fs from "node:fs";
import path from "node:path";

const exchangeRatesPath = path.join(process.cwd(), "data", "exchange-rates.ts");
const sourceName = "中国外汇交易中心人民币汇率中间价公告";

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getDefaultEffectiveMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

function parseEffectiveMonth(value) {
  const normalized = normalizeText(value || getDefaultEffectiveMonth());

  if (!/^\d{4}-\d{2}$/.test(normalized)) {
    throw new Error(`Invalid CUSTOMS_EFFECTIVE_MONTH: ${normalized}`);
  }

  return normalized;
}

function getThirdWednesday(year, monthIndex) {
  const date = new Date(year, monthIndex, 1);
  let wednesdayCount = 0;

  while (date.getMonth() === monthIndex) {
    if (date.getDay() === 3) {
      wednesdayCount += 1;

      if (wednesdayCount === 3) {
        return new Date(date);
      }
    }

    date.setDate(date.getDate() + 1);
  }

  throw new Error("Could not calculate third Wednesday.");
}

function getBasisDate(effectiveMonth) {
  const [yearText, monthText] = effectiveMonth.split("-");
  const year = Number.parseInt(yearText, 10);
  const month = Number.parseInt(monthText, 10);
  const previousMonth = new Date(year, month - 2, 1);

  return getThirdWednesday(
    previousMonth.getFullYear(),
    previousMonth.getMonth()
  );
}

function getSourceUrl(dateText) {
  return `https://www.chinamoney.com.cn/chinese/ccprnoticecontent/index.html?searchDate=${dateText}`;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 PipeSearch exchange-rate updater (+https://pipesearch.local)",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function parseUsdRate(text) {
  const normalized = normalizeText(text);
  const directPatterns = [
    /1\s*美元\s*对\s*人民币\s*([0-9]+(?:\.[0-9]+)?)\s*元/i,
    /美元\s*\/\s*人民币[^\d]{0,20}([0-9]+(?:\.[0-9]+)?)/i,
    /USD\s*\/\s*CNY[^\d]{0,20}([0-9]+(?:\.[0-9]+)?)/i,
  ];

  for (const pattern of directPatterns) {
    const match = normalized.match(pattern);
    const parsed = Number.parseFloat(match?.[1] || "");

    if (Number.isFinite(parsed) && parsed > 0) {
      return Number(parsed.toFixed(4));
    }
  }

  const hundredUsdPatterns = [
    /100\s*美元[^\d]{0,20}([0-9]+(?:\.[0-9]+)?)\s*人民币/i,
    /100\s*USD[^\d]{0,20}([0-9]+(?:\.[0-9]+)?)\s*CNY/i,
  ];

  for (const pattern of hundredUsdPatterns) {
    const match = normalized.match(pattern);
    const parsed = Number.parseFloat(match?.[1] || "");

    if (Number.isFinite(parsed) && parsed > 0) {
      return Number((parsed / 100).toFixed(4));
    }
  }

  return null;
}

function createExchangeRatesFile({
  effectiveMonth,
  basisDate,
  sourceUrl,
  usdRate,
}) {
  return `export const customsExchangeRates = {
  effectiveMonth: "${effectiveMonth}",
  basisDate: "${basisDate}",
  sourceName: "${sourceName}",
  sourceUrl:
    "${sourceUrl}",
  updatedAt: "${formatDate(new Date())}",
  rates: {
    USD: ${usdRate},
  },
} as const;
`;
}

function writeExchangeRatesFile(content) {
  const tempPath = `${exchangeRatesPath}.tmp`;

  fs.writeFileSync(tempPath, content, "utf8");
  fs.renameSync(tempPath, exchangeRatesPath);
}

async function tryUpdateExchangeRates() {
  const effectiveMonth = parseEffectiveMonth(process.env.CUSTOMS_EFFECTIVE_MONTH);
  const basisDate = getBasisDate(effectiveMonth);
  const attempts = [];

  for (let offset = 0; offset <= 7; offset += 1) {
    const date = new Date(basisDate);
    date.setDate(date.getDate() + offset);
    attempts.push(formatDate(date));
  }

  for (const dateText of attempts) {
    const sourceUrl = getSourceUrl(dateText);

    try {
      console.log(`Trying customs exchange rate notice: ${dateText}`);
      const text = await fetchText(sourceUrl);
      const usdRate = parseUsdRate(text);

      if (!usdRate) {
        throw new Error("USD rate was not found in notice text.");
      }

      writeExchangeRatesFile(
        createExchangeRatesFile({
          effectiveMonth,
          basisDate: dateText,
          sourceUrl,
          usdRate,
        })
      );

      console.log(`Updated customs exchange rates: USD=${usdRate}`);
      return true;
    } catch (error) {
      console.warn(
        `Customs exchange rate update failed for ${dateText}: ${
          error?.message || error
        }`
      );
    }
  }

  console.warn(
    "Customs exchange rate update skipped. Existing data/exchange-rates.ts was preserved."
  );
  return false;
}

tryUpdateExchangeRates()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.warn(
      `Customs exchange rate updater failed safely: ${error?.message || error}`
    );
    process.exit(0);
  });
