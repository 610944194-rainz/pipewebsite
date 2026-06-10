export const brandAliases = {
  "Nørding": "Nørding",
  "Nording Pipes": "Nørding",
  Nording: "Nørding",
  "Nording Pipe": "Nørding",
  "Erik Nording": "Nørding",
  "Rattray's": "Rattray's",
  Rattrays: "Rattray's",
  "Rattray’s": "Rattray's",
  "W. O. Larsen": "W.Ø. Larsen",
  "W.O. Larsen": "W.Ø. Larsen",
  "Dagner": "Dagner Pipes",
  "Dagner Pipes": "Dagner Pipes",
  "Paul Olsen": "Poul Olsen",
  "Poul Olsen": "Poul Olsen",
  "Poul Winsløw": "Winsløw",
  "Poul Winslow": "Winsløw",
  "White Star Pipes": "White Star",
  "White Star": "White Star",
  Meerschaum: "Unknown Meerschaum",
  "Unbranded Meerschaum": "Unknown Meerschaum",
  "Unknown Meerschaum": "Unknown Meerschaum",
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

function slugifyCanonicalBrand(value: string) {
  return normalizeBrandAliasKey(value).replace(/\s+/g, "-") || "unknown";
}

function findPatternCanonicalBrand(key: string) {
  if (
    key === "nording" ||
    key.startsWith("nording ") ||
    key.includes("nording keystone shorty")
  ) {
    return {
      canonicalName: "Nørding",
      canonicalSlug: "nording",
    };
  }

  if (
    key === "rattray s" ||
    key === "rattrays" ||
    key.startsWith("rattray s the witch") ||
    key.startsWith("rattrays the witch")
  ) {
    return {
      canonicalName: "Rattray's",
      canonicalSlug: "rattrays",
    };
  }

  if (
    key === "tom eltang" ||
    key.startsWith("tom eltang ") ||
    key === "eltang" ||
    key.startsWith("eltang ")
  ) {
    return {
      canonicalName: "Tom Eltang",
      canonicalSlug: "tom-eltang",
    };
  }

  if (
    key === "winslow" ||
    key.startsWith("winslow crown") ||
    key === "poul winslow" ||
    key.startsWith("poul winslow ")
  ) {
    return {
      canonicalName: "Winsløw",
      canonicalSlug: "winslow",
    };
  }

  if (key === "white star" || key === "white star pipes") {
    return {
      canonicalName: "White Star",
      canonicalSlug: "white-star",
    };
  }

  if (key === "dagner" || key === "dagner pipes") {
    return {
      canonicalName: "Dagner Pipes",
      canonicalSlug: "dagner-pipes",
    };
  }

  if (key === "paul olsen" || key === "poul olsen") {
    return {
      canonicalName: "Poul Olsen",
      canonicalSlug: "poul-olsen",
    };
  }

  if (
    key === "unknown meerschaum" ||
    key === "unbranded meerschaum" ||
    key === "meerschaum"
  ) {
    return {
      canonicalName: "Unknown Meerschaum",
      canonicalSlug: "unknown-meerschaum",
    };
  }

  return null;
}

export function normalizeBrandForIndex(value: string) {
  const brand = String(value || "").trim().replace(/\s+/g, " ");
  const key = normalizeBrandAliasKey(brand);
  const patternCanonical = findPatternCanonicalBrand(key);

  if (patternCanonical) {
    return patternCanonical;
  }

  const aliasName = aliasLookup.get(key) || brand;
  const aliasKey = normalizeBrandAliasKey(aliasName);
  const aliasPatternCanonical = findPatternCanonicalBrand(aliasKey);

  if (aliasPatternCanonical) {
    return aliasPatternCanonical;
  }

  return {
    canonicalName: aliasName,
    canonicalSlug: slugifyCanonicalBrand(aliasName),
  };
}

export function canonicalizeBrandName(value: string) {
  return normalizeBrandForIndex(value).canonicalName;
}

export function shouldHideBrandFromIndex(value: string) {
  const canonicalBrand = normalizeBrandForIndex(value).canonicalName;
  return hiddenBrandLookup.has(normalizeBrandAliasKey(canonicalBrand));
}
