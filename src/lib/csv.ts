/**
 * CSV serialisation shared by every export (reports, collections).
 *
 * Spreadsheet apps execute cells that start with = + - @ (and tab / carriage
 * return, which some of them strip before evaluating), so such text is
 * prefixed with an apostrophe. Real numbers are written unquoted and are never
 * prefixed, so a value such as -12.5 stays numeric.
 */

const FORMULA_START = /^[=+\-@\t\r]/;
/** Plain decimal number, optionally signed or in exponent notation ("-12.5", "+3", "1e-4"). */
const NUMERIC = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Neutralises text a spreadsheet would evaluate as a formula. Numeric strings are left as they are. */
export function neutralizeFormula(s: string): string {
  return FORMULA_START.test(s) && !NUMERIC.test(s) ? `'${s}` : s;
}

/** One CSV field. Null, undefined and non-finite numbers become an empty field (unknown, not zero). */
export function csvCell(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "true" : "false";
  return `"${neutralizeFormula(String(v)).replace(/"/g, '""')}"`;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(",");
}
