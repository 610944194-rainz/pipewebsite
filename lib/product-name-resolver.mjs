import fs from "node:fs";
import path from "node:path";

const text = value => String(value ?? "").replace(/\s+/g, " ").trim();
const key = value => text(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/ø/g, "o").replace(/[’‘]/g, "'").toLowerCase();
const chinese = value => /[\u3400-\u9fff]/.test(text(value));
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const replaceToken = (value, token, replacement) => value.replace(new RegExp("(^|[^A-Za-z])" + escape(token) + "(?=$|[^A-Za-z])", "gi"), (_, prefix) => prefix + replacement);
let cached;

export function loadProductNameContext() {
  if (cached) return cached;
  const read = relative => JSON.parse(fs.readFileSync(path.join(process.cwd(), relative), "utf8"));
  return cached = createProductNameContext({
    safeNames: read("data/i18n/product-displayname-zh-safe-candidates.json"),
    brands: read("data/taxonomy/brand-aliases.json"),
    finalBrands: read("data/review/product-displayname-zh-brand-decisions-final-20260616.json"),
    shapes: read("data/taxonomy/pipe-shapes.json"),
    finalShapes: read("data/review/product-displayname-zh-shape-decisions-final-20260616.json"),
    finishes: read("data/taxonomy/pipe-finishes.json"),
  });
}

export function createProductNameContext({ safeNames, brands, finalBrands, shapes, finalShapes, finishes }) {
  const brandIndex = new Map();
  for (const brand of brands.brands || []) {
    const decision = finalBrands.brandDecisions?.[brand.canonicalBrand];
    const zh = decision?.action === "keep-original" ? null : decision?.zh || (brand.reviewStatus === "confirmed" ? brand.zhName : null);
    const entry = { name: brand.canonicalBrand, zh: text(zh) || null, aliases: [brand.canonicalBrand, ...(brand.aliases || [])] };
    for (const alias of [...entry.aliases, brand.canonicalBrandSlug]) brandIndex.set(key(alias), entry);
  }
  for (const [name, decision] of Object.entries(finalBrands.brandDecisions || {})) {
    if (!brandIndex.has(key(name))) brandIndex.set(key(name), { name, zh: decision.action === "translate" ? text(decision.zh) || null : null, aliases: [name] });
  }
  for (const [alias, correction] of Object.entries(finalBrands.brandAliasCorrections || {})) {
    const canonical = brandIndex.get(key(correction.canonicalBrand));
    if (canonical) {
      canonical.aliases = [...canonical.aliases, alias];
      brandIndex.set(key(alias), canonical);
    }
  }
  const shapeIndex = new Map();
  for (const shape of shapes.shapes || []) {
    const decision = finalShapes.shapeDecisions?.[shape.canonicalShape];
    const zh = decision?.display === false ? null : decision?.zh || (shape.reviewStatus === "confirmed" ? shape.zhName : null);
    const entry = { name: shape.canonicalShape, zh: text(zh) || null, aliases: [shape.canonicalShape, ...(shape.aliases || [])] };
    for (const alias of entry.aliases) shapeIndex.set(key(alias), entry);
  }
  const finishIndex = new Map((finishes.finishes || []).filter(x => x.reviewStatus === "confirmed").map(x => [key(x.canonicalFinish), x]));
  return { names: new Map((safeNames.items || []).map(x => [x.id, x])), brands: brandIndex, shapes: shapeIndex, finishes: finishIndex };
}

export function getProductBrandZh(product, context = loadProductNameContext()) {
  return (context.brands.get(key(product.brandSlug)) || context.brands.get(key(product.brandName)))?.zh || null;
}

export function resolveProductName(product, context = loadProductNameContext()) {
  const original = text(product.displayNameEn || product.rawTitle || product.displayName || product.id);
  const brand = context.brands.get(key(product.brandSlug)) || context.brands.get(key(product.brandName));
  const brandNameZh = brand?.zh || null;
  const historical = context.names.get(product.id);
  // Product-level human decisions remain authoritative, including intentional English names.
  if (historical && text(historical.displayTitle)) return {
    title: historical.displayTitle, quality: historical.quality || "ready",
    warnings: historical.warnings || [], brandNameZh,
    brandZhSource: historical.brandZhSource || (brandNameZh ? "taxonomy-confirmed" : "keep-original-unconfirmed"),
  };
  // A newly generated index already contains its resolved title. Do not erase it on a legacy ID miss.
  if (product.displayNameQuality && text(product.displayName)) return {
    title: product.displayName, quality: product.displayNameQuality, brandNameZh,
    warnings: brandNameZh ? [] : ["brandZhUnconfirmed"],
    brandZhSource: brandNameZh ? "taxonomy-confirmed" : "keep-original-unconfirmed",
  };
  if (chinese(product.displayNameZh || product.displayName)) return { title: text(product.displayNameZh || product.displayName), quality: "ready", warnings: [], brandNameZh, brandZhSource: "danishpipe-confirmed" };
  let title = original;
  for (const alias of [...(brand?.aliases || []), text(product.brandName)].filter(Boolean).sort((a,b) => b.length-a.length)) {
    const prefix = new RegExp("^" + escape(alias) + "(?:\\s*:\\s*|\\s+|$)", "i");
    if (prefix.test(title)) { title = title.replace(prefix, ""); break; }
  }
  title = title.replace(/\b(?:Tobacco\s+Pipe|Estate\s+Pipe|Pipe)\b/gi, "").trim();
  const shape = context.shapes.get(key(product.shape));
  if (shape?.zh && !/^(?:其他|未知)/.test(shape.zh)) {
    for (const alias of [...shape.aliases].sort((a,b) => b.length-a.length)) {
      // Horn in a mount or stem description is a material, not a shape token.
      if (/^horn$/i.test(alias) && /(?:with|w\.|w\/)\s*horn|horn\s+(?:stem|mount|accent|ferrule)/i.test(title)) continue;
      title = replaceToken(title, alias, shape.zh);
    }
  }
  const finish = context.finishes.get(key(product.finish));
  if (finish?.zhName) for (const alias of [finish.canonicalFinish, ...(finish.aliases || [])].sort((a,b) => b.length-a.length)) title = replaceToken(title, alias, finish.zhName);
  const brandLabel = brandNameZh || (text(product.brandName).toLowerCase() === "unknown" ? "" : text(product.brandName));
  title = text([brandLabel, title, shape?.zh && !/^(?:其他|未知)/.test(shape.zh) && !title.includes(shape.zh) ? shape.zh : ""].filter(Boolean).join(" "));
  const warnings = [];
  if (!brandNameZh) warnings.push("brandZhUnconfirmed");
  if (!shape?.zh) warnings.push("shapeZhUnconfirmed");
  const quality = chinese(title) ? (warnings.length ? "candidate" : "ready") : "fallback-original";
  return { title: title || original, quality, warnings, brandNameZh, brandZhSource: brandNameZh ? "taxonomy-confirmed" : "keep-original-unconfirmed" };
}

// Store the primary Chinese title once, keeping English identity, prices and stock intact.
export function withResolvedProductName(product, context = loadProductNameContext()) {
  const result = resolveProductName(product, context);
  return { ...product, displayName: result.title, brandNameZh: result.brandNameZh, displayNameQuality: result.quality };
}
