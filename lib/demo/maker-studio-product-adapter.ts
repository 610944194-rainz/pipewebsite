import "server-only";

import { getPublicProductDetailById } from "@/lib/public-products/server";
import {
  demoWorkSeeds,
  type DemoMakerProduct,
  type DemoWorkAvailability,
} from "./maker-studio-fixtures";

function distinctImages(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))
  );
}

function adaptedWork(seed: (typeof demoWorkSeeds)[number]): DemoMakerProduct | null {
  const source = getPublicProductDetailById(seed.sourceProductId);
  if (!source) return null;

  const images = distinctImages([source.mainImage, ...source.gallery]);
  if (images.length === 0) return null;

  const measurements = source.measurements;
  return {
    ...seed,
    shape: source.shapeZh || source.shape || seed.shape,
    finish: source.finishZh || source.finish || seed.finish,
    bowlMaterial: source.bowlMaterialZh || source.bowlMaterial || seed.bowlMaterial,
    stemMaterial: source.stemMaterialZh || source.stemMaterial || seed.stemMaterial,
    filterSpec: source.filter || seed.filterSpec,
    weightGrams: measurements.weightGrams ?? source.weightGrams ?? seed.weightGrams,
    lengthMillimeters: measurements.lengthMm ?? seed.lengthMillimeters,
    bowlHeightMillimeters: measurements.heightMm ?? seed.bowlHeightMillimeters,
    bowlWidthMillimeters: measurements.outsideDiameterMm ?? seed.bowlWidthMillimeters,
    chamberDiameterMillimeters: measurements.chamberDiameterMm ?? seed.chamberDiameterMillimeters,
    chamberDepthMillimeters: measurements.chamberDepthMm ?? seed.chamberDepthMillimeters,
    images,
    isDemo: true,
    source: "ui-fixture",
  };
}

let allWorksCache: readonly DemoMakerProduct[] | null = null;

export function getDemoMakerProducts(makerSlug: string) {
  if (!allWorksCache) {
    allWorksCache = demoWorkSeeds
      .map(adaptedWork)
      .filter((work): work is DemoMakerProduct => work !== null);
  }

  return allWorksCache.filter((work) => work.makerSlug === makerSlug);
}

export const getDemoWorksByMakerSlug = getDemoMakerProducts;

export function getDemoMakerProductsByAvailability(
  makerSlug: string,
  availability: DemoWorkAvailability
) {
  return getDemoMakerProducts(makerSlug).filter(
    (product) => product.availability === availability
  );
}

export function getDemoMakerStats(makerSlug: string) {
  const works = getDemoMakerProducts(makerSlug);
  return {
    totalWorks: works.length,
    availableWorks: works.filter((work) => work.availability === "available").length,
  };
}

export function getDemoMakerProduct(identifier: string) {
  if (!allWorksCache) getDemoMakerProducts("");
  return allWorksCache?.find(
    (product) => product.id === identifier || product.slug === identifier
  );
}

export function getDemoRelatedProducts(product: DemoMakerProduct) {
  return getDemoMakerProducts(product.makerSlug).filter(
    (candidate) => candidate.id !== product.id
  );
}

export function getDemoPublicWorkCount(makerSlug: string) {
  return getDemoMakerStats(makerSlug).totalWorks;
}

export function isDemoMakerStudioRecord(
  value: DemoMakerProduct | undefined
) {
  return value?.isDemo === true && value.source === "ui-fixture";
}
