import assert from "node:assert/strict";
import { parseDanishSpecs } from "./danish-specs-parser-v1.mjs";

const complete = parseDanishSpecs({
  name: "Example Billiard Smooth",
  specsText: [
    "Shape: Billiard",
    "Weight: 31.18 g",
    "Length: 13.5 cm",
    "Height: 45 mm",
    "Chamber Diameter: 20 mm",
    "Chamber Depth: 38 mm",
    "Outside Diameter: 42 mm",
    "Finish: Smooth",
    "Bowl Material: Briar",
    "Stem Material: Acrylic",
    "Filter: 9 mm",
  ],
});
assert.equal(complete.shape, "Billiard");
assert.equal(complete.shapeZh, "撞球斗");
assert.equal(complete.weightGrams, 31.18);
assert.equal(complete.dimensions.lengthMm, 135);
assert.equal(complete.dimensions.heightMm, 45);
assert.equal(complete.dimensions.chamberDiameterMm, 20);
assert.equal(complete.dimensions.chamberDepthMm, 38);
assert.equal(complete.dimensions.bowlOuterDiameterMm, 42);
assert.equal(complete.finish, "Smooth");
assert.equal(complete.material, "Briar");
assert.equal(complete.stemMaterial, "Acrylic");
assert.equal(complete.filterSizeMm, 9);
assert.equal(parseDanishSpecs({ name: "Example Billard" }).shape, "Billiard");

const partial = parseDanishSpecs({ specsText: ["Weight: 22 g", "Filter: 6 mm", "Surface: Sandblast", "Mouthpiece: Ebonite"] });
assert.equal(partial.weightGrams, 22);
assert.equal(partial.filter, "6mm");
assert.equal(partial.filterSizeMm, 6);
assert.equal(partial.finish, "Sandblast");
assert.equal(partial.stemMaterial, "Vulcanite");

const chinese = parseDanishSpecs({
  name: "Example Churchwarden Rusticated",
  detailBodyTextStart: "滤芯: 无滤芯\n斗嘴材质: 硬橡胶\nA: 斗钵壁直径: 40 mm\n重量: 40 gr",
});
assert.equal(chinese.shape, "Churchwarden");
assert.equal(chinese.shapeZh, "阅读斗");
assert.equal(chinese.finish, "Rusticated");
assert.equal(chinese.stemMaterial, "Vulcanite");
assert.equal(chinese.filter, "none");
assert.equal(chinese.dimensions.bowlOuterDiameterMm, 40);
assert.equal(parseDanishSpecs({ name: "Example Calabash" }).shapeZh, "葫芦斗");

const unknown = parseDanishSpecs({ specsText: ["Mystery Index: 123 foos"] });
assert.equal(unknown.weightGrams, null);
assert.equal(unknown.dimensions.lengthMm, null);
assert.equal(unknown.filter, null);
assert.deepEqual(parseDanishSpecs({}).dimensions, {
  bowlOuterDiameterMm: null,
  chamberDiameterMm: null,
  chamberDepthMm: null,
  heightMm: null,
  lengthMm: null,
  buttonWidthMm: null,
  bitThicknessMm: null,
});

console.log("Danish structured specs parser tests passed");
