// The October 2026 storefront retains legacy numeric IDs in product handles.
export function danishProductId(value) {
  return String(value || '').match(/-i(\d+)(?:\.html)?\/?(?:[?#].*)?$/i)?.[1] || '';
}

export function isModernDanishUrl(value) {
  try { return /^\/(?:zh\/|en\/|da\/)?(?:categories|products)\//.test(new URL(value).pathname); }
  catch { return false; }
}

export async function readModernDanishList(tab) {
  await tab.waitForSelector('main article.product-card h3 a', { state: 'attached', timeout: 60000 });
  return tab.evaluate(() => {
    const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
    const root = document.querySelector('main article.product-card')?.closest('main') || document.querySelector('main');
    const total = text(root).match(/([\d,\.]+)\s*(?:件商品|products?|produkter)/i);
    const products = [...root.querySelectorAll('article.product-card')].map(card => {
      const a = card.querySelector('h3 a[href]');
      const price = text(card.querySelector('h3 + p span.font-semibold'));
      return {
        href: a?.href, name: text(a), imageAlt: card.querySelector('img')?.alt || '',
        imageUrl: card.querySelector('img')?.src || '',
        brand: text(card.querySelector('div.space-y-1\\.5 > p')),
        price, status: /售罄|已售出|sold out|udsolgt/i.test(text(card)) ? '已售' : '可购买', rawText: text(card),
      };
    });
    const current = new URL(location.href);
    const nextPage = Number(current.searchParams.get('page') || 1) + 1;
    const next = [...root.querySelectorAll('a[href]')].map(a => new URL(a.href)).find(u =>
      u.pathname === current.pathname && Number(u.searchParams.get('page')) === nextPage);
    return { products, totalCount: Number(total?.[1].replace(/[,\.]/g, '') || 0), nextUrl: next?.href || '' };
  });
}

export async function collectModernDanishList(tab, { targetCount, minimumExpectedCount, maxPages = 200, delayMs = 1000, log = () => {}, recoverPage = async () => true }) {
  const first = new URL(tab.url());
  first.searchParams.set('per', '96');
  first.searchParams.set('page', '1');
  // Pin the price context instead of relying on a persisted shopper preference.
  first.searchParams.set('currency', 'usd');
  const products = [], seen = new Set(), pages = new Set();
  let next = first.href, total = 0;
  while (next) {
    if (pages.has(next) || pages.size >= maxPages) throw new Error('modern-list-pagination-incomplete');
    pages.add(next);
    const response = await tab.goto(next, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const recovered = await recoverPage(next);
    if (recovered === false) throw new Error('modern-list-verification-unresolved');
    if (response && !response.ok() && !(await tab.locator('main article.product-card').count())) throw new Error(`modern-list-http-${response.status()}`);
    const page = await readModernDanishList(tab);
    if (!page.totalCount || (total && total !== page.totalCount)) throw new Error(`modern-list-total-missing-or-changed ${total}/${page.totalCount} at ${next}`);
    total = page.totalCount;
    if (!page.products.length) throw new Error('modern-list-empty-page');
    for (const item of page.products) {
      const id = danishProductId(item.href);
      if (!id || seen.has(id) || !item.name || !item.imageUrl || !/^US\$[\d,.]+$/.test(item.price)) throw new Error('modern-list-invalid-or-duplicate-product');
      seen.add(id);
      products.push({ ...item, listPageUrl: next, listPageIndex: pages.size, listPosition: products.length + 1 });
    }
    log('modern-list-page', { page: pages.size, count: products.length, total });
    if (products.length > targetCount) throw new Error('modern-list-target-limit');
    next = page.nextUrl;
    if (next) await tab.waitForTimeout(delayMs);
  }
  if (products.length !== total || total < minimumExpectedCount) throw new Error(`modern-list-count-mismatch ${products.length}/${total}`);
  return { products, report: { integrityGate: true, detectedTotalCount: total, uniqueCount: products.length,
    completionReason: 'modern-pagination-exhausted', integrityFailureReason: '', fallbackPagesVisited: pages.size } };
}

export async function readModernDanishDetail(tab, expectedUrl) {
  await tab.waitForSelector('main h1', { state: 'attached', timeout: 60000 });
  await tab.waitForFunction(() => [...document.querySelectorAll('script[type="application/ld+json"]')].some(s => s.textContent.includes('"Product"')));
  const result = await tab.evaluate(() => {
    const nodes = [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap(s => {
      try { const j = JSON.parse(s.textContent); return j['@graph'] || [j]; } catch { return []; }
    });
    const product = nodes.find(p => p['@type'] === 'Product');
    const specs = [...document.querySelectorAll('main table tr')].map(row => [row.querySelector('th')?.textContent?.trim(), row.querySelector('td')?.textContent?.trim()]).filter(([k,v]) => k && v);
    return { product, specs, url: location.href, title: document.querySelector('h1')?.textContent?.trim() };
  });
  const p = result.product, offer = Array.isArray(p?.offers) ? p.offers[0] : p?.offers;
  if (!p || !danishProductId(expectedUrl) || danishProductId(result.url) !== danishProductId(expectedUrl) || danishProductId(p.url) !== danishProductId(expectedUrl)) throw new Error('modern-detail-id-mismatch');
  if (!offer || offer.priceCurrency !== 'USD' || !(Number(offer.price) > 0)) throw new Error('modern-detail-invalid-price-context');
  const status = /\/(?:OutOfStock|SoldOut|Discontinued)$/.test(offer.availability) ? '已售' : /\/InStock$/.test(offer.availability) ? '可购买' : '';
  const galleryImages = [...new Set((Array.isArray(p.image) ? p.image : [p.image]).filter(u => {
    try { return new URL(u).hostname === 'dps-media.aperi.io'; } catch { return false; }
  }))];
  const labels = { '烟斗高度': 'Height', '烟斗长度': 'Length', '烟膛深度': 'Chamber depth', '烟膛内径': 'Chamber diameter', '烟嘴宽度': 'Button width', '烟嘴厚度': 'Bit thickness', '斗钵外径': 'Bowl diameter', '重量': 'Weight', '滤芯规格': 'Filter', '全新 / 二手': 'Condition', '款式': 'Shape', '斗型': 'Bend', '表面处理': 'Finish', '烟嘴': 'Mouthpiece' };
  const specsText = result.specs.map(([key, value]) => `${labels[key] || key}: ${value === '无滤芯' ? 'No filter' : value === '全新' ? 'New pipe' : value === '二手' ? 'Estate pipe' : value.replace(/(\d)(mm|g)\b/g, '$1 $2')}`);
  if (!status || !galleryImages.length || !specsText.length || !p.brand?.name || !p.name) throw new Error('modern-detail-required-fields-missing');
  return { title: p.name, brand: p.brand.name, productCode: p.sku || '', price: `$${Number(offer.price).toFixed(2)}`,
    status, mainImage: galleryImages[0], listImageUrl: galleryImages[0], galleryImages, specsText,
    sourceUrl: result.url, description: p.description || '', productDetailText: [p.description, ...specsText].filter(Boolean).join('\n'),
    rawText: specsText.join('\n'), imageMatchStatus: 'matched', imageMatchNotes: 'Product JSON-LD gallery; stable numeric ID verified', qualityWarnings: [] };
}
