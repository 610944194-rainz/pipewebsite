const legacyBrandName = ["Pipe", "Search"].join("");

export function displayBrandCopy(value: string) {
  return value.replaceAll(legacyBrandName, "烟斗派");
}
