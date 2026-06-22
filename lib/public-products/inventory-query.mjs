/**
 * @typedef {"all" | "available" | "sold"} ProductInventoryQuery
 */

/**
 * @param {string | undefined} value
 * @returns {ProductInventoryQuery}
 */
export function parseInventoryQuery(value) {
  if (value === "all" || value === "sold") return value;
  return "available";
}

/**
 * @param {ProductInventoryQuery | undefined} value
 * @returns {ProductInventoryQuery | null}
 */
export function inventoryQueryParam(value) {
  if (value === "all" || value === "sold") return value;
  return null;
}
