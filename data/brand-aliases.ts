export const brandAliases = {
  "Nording Pipes": "Nørding",
  Nording: "Nørding",
  "Nording Pipe": "Nørding",
  "Erik Nording": "Nørding",
  "W. O. Larsen": "W.Ø. Larsen",
  "W.O. Larsen": "W.Ø. Larsen",
  Meerschaum: "Unknown Meerschaum",
  "No Name": "Unbranded",
  "Economy Pipe starter set": "Unbranded",
} as const;

export const hiddenBrandIndexNames = [
  "Unknown Meerschaum",
  "Unbranded",
] as const;

export function normalizeBrandAliasKey(value: string) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/ø/g, "o")
    .replace(/Ø/g, "O")
    .replace(/æ/g, "ae")
    .replace(/Æ/g, "AE")
    .replace(/å/g, "a")
    .replace(/Å/g, "A")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

const aliasLookup = new Map(
  Object.entries(brandAliases).map(([from, to]) => [
    normalizeBrandAliasKey(from),
    to,
  ])
);

const hiddenBrandLookup = new Set(
  hiddenBrandIndexNames.map((name) => normalizeBrandAliasKey(name))
);

export function canonicalizeBrandName(value: string) {
  const brand = String(value || "").trim().replace(/\s+/g, " ");

  if (!brand) {
    return "";
  }

  return aliasLookup.get(normalizeBrandAliasKey(brand)) || brand;
}

export function shouldHideBrandFromIndex(value: string) {
  const canonicalBrand = canonicalizeBrandName(value);
  return hiddenBrandLookup.has(normalizeBrandAliasKey(canonicalBrand));
}
