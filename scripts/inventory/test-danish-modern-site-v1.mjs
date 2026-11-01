import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { parseDanishSpecs } from './danish-specs-parser-v1.mjs';
import { ensureManualVerificationIfNeeded } from '../collect-danish-full-v18.mjs';
import { parsePipeCondition } from '../collect-danish-details-v16.mjs';
import { danishProductId, readModernDanishList, readModernDanishDetail, collectModernDanishList } from '../lib/danish-modern-site.mjs';
import { buildDanishListPatch, buildIncrementalDetailQueue, validateIncrementalDetailQueue } from './run-danish-daily-v1.mjs';

assert.equal(danishProductId('https://www.danishpipeshop.com/d/-zh/Test-i37184.html'), '37184');
assert.equal(danishProductId('https://www.danishpipeshop.cn/zh/products/test-i37184?currency=usd'), '37184');
assert.equal(danishProductId('https://example.com/products/test-i37184-other'), '');
const migrationList = Array.from({ length: 20 }, (_, index) => ({
  id: index + 1, name: `Pipe ${index + 1}`, href: `https://www.danishpipeshop.cn/zh/products/pipe-i${index + 1}`,
  imageUrl: 'https://dps-media.aperi.io/image.jpg', status: '可购买',
}));
const migrationProduction = migrationList.map(p => ({ ...p, sourceUrl: p.href,
  imageUrl: 'https://www.danishpipeshop.com/img/retired.jpg', specsText: ['Length: 120 mm'] }));
const migrationQueue = buildIncrementalDetailQueue({ listProducts: migrationList, productionProducts: migrationProduction });
assert.equal(migrationQueue.mediaMigrationCount, 5);
assert.equal(migrationQueue.reusedProductionCount, 15);
assert(validateIncrementalDetailQueue({ detailQueue: migrationQueue, productionProducts: migrationProduction }).passed);
// Recovery must recognize the new .cn host and modern list readiness.
let probe = 0, bridgeCalls = 0;
const verificationTab = {
  isClosed: () => false,
  url: () => 'https://www.danishpipeshop.cn/zh/categories/piber',
  evaluate: async () => ({ title: probe < 3 ? 'Verification' : 'Pipes',
    challenge: probe++ < 3, hasListContainer: true, listItemCount: 2 }),
  bringToFront: async () => {},
};
await ensureManualVerificationIfNeeded(verificationTab, {
  requireList: true, timeoutMs: 1000, pollMs: 1, log: () => {},
  sleep: async () => {}, launchVerificationBridge: () => { bridgeCalls += 1; return true; },
});
assert.equal(bridgeCalls, 1);
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const base = 'https://www.danishpipeshop.cn/zh/categories/piber';
  const card = (id, sold = false) => `<article class="product-card"><span class="font-semibold">独一无二</span><img src="https://dps-media.aperi.io/${id}.jpg"><div class="space-y-1.5"><p>Test Brand</p><h3><a href="/zh/products/pipe-i${id}">Pipe ${id}</a></h3><p><span class="font-semibold">US$120.00</span><del>US$150.00</del></p>${sold ? '<span class="font-semibold">已售出</span>' : ''}</div></article>`;
  let broken = false;
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    const second = u.searchParams.get('page') === '2';
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<main><p>2 件商品</p>${card(second && !broken ? 2 : 1, second)}${second ? '' : '<a href="?per=96&page=2">下一页</a>'}</main>` });
  });
  await page.goto(base);
  const first = await readModernDanishList(page);
  assert.equal(first.products[0].brand, 'Test Brand');
  assert.equal(first.products[0].price, 'US$120.00');
  const complete = await collectModernDanishList(page, { targetCount: 10, minimumExpectedCount: 2, delayMs: 0 });
  assert.equal(complete.products.length, 2);
  assert.equal(complete.products[1].status, '已售');
  const production = [{ id: 1, sourceUrl: 'https://www.danishpipeshop.com/d/-zh/pipe-i1.html', status: '可购买', specsText: ['Length: 120 mm'], imageUrl: 'https://example.com/a.jpg' }];
  const patch = buildDanishListPatch({ listProducts: complete.products, productionProducts: production });
  assert.equal(patch.identityAnomalyCount, 0);
  assert.equal(patch.sourceUrlChangedCount, 1);
  const queue = buildIncrementalDetailQueue({ listProducts: complete.products, productionProducts: production });
  assert.equal(queue.identityAnomalyCount, 0);
  broken = true;
  await assert.rejects(collectModernDanishList(page, { targetCount: 10, minimumExpectedCount: 2, delayMs: 0 }), /duplicate/);
  // Captured live pages can be supplied for reproducible full-storefront regression checks.
  {
    await page.unroute('**/*');
    const root = new URL('./fixtures/danish-modern', import.meta.url).pathname;
    await page.route('**/*', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: fs.readFileSync(`${root}/danish-live.html`, 'utf8') }));
    await page.goto(base);
    const live = await readModernDanishList(page);
    assert.equal(live.products.length, 2);
    assert(live.totalCount > 1000);
    assert(live.products.every(p => p.brand && p.price && danishProductId(p.href)));
    await page.unroute('**/*');
    const url = live.products[0].href;
    await page.route('**/*', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: fs.readFileSync(`${root}/danish-detail.html`, 'utf8') }));
    await page.goto(url);
    const detail = await readModernDanishDetail(page, url);
    assert.equal(detail.galleryImages.length, 6);
    assert(detail.specsText.includes('Length: 134.0 mm'));
    assert.equal(detail.status, '已售');
    const specs = parseDanishSpecs(detail);
    assert.equal(specs.dimensions.lengthMm, 134);
    assert.equal(specs.weightGrams, 45);
    assert.equal(specs.dimensions.bowlOuterDiameterMm, 42);
    assert.equal(specs.dimensions.chamberDiameterMm, 19);
    const condition = parsePipeCondition([{ source: 'specsText', text: detail.specsText.join('\n') }]);
    assert.equal(condition.conditionType, 'new');
    await assert.rejects(readModernDanishDetail(page, url.replace(/i\d+$/, 'i999')), /id-mismatch/);
    console.log(JSON.stringify({ liveCards: live.products.length, total: live.totalCount, gallery: detail.galleryImages.length, specs: detail.specsText.length }));
  }
} finally { await browser.close(); }
console.log('Danish modern storefront regression checks passed.');
