/**
 * CSV formula-injection guard (OWASP "CSV Injection").
 *
 * Spreadsheet apps evaluate a cell that starts with `=`, `+`, `-`, `@`, a tab or a
 * carriage return as a formula — so a transaction described as
 * `=HYPERLINK("https://evil.example","Click")` would become a live link, or
 * worse, the moment an exported file is opened. Prefixing such a *text* cell with
 * an apostrophe makes the app show it as plain text.
 *
 * Only ever applied to free-text columns. Numeric columns must stay numeric —
 * `-1250.00` is a legitimate negative balance, not an attack.
 */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;
const ESCAPED_FORMULA = /^'[=+\-@\t\r]/;

/** Escape a free-text value on its way into a CSV cell. */
export function csvText(value: string | null | undefined): string {
  const text = value ?? '';
  return FORMULA_TRIGGER.test(text) ? `'${text}` : text;
}

/**
 * The reverse, for values read back from a CSV: drop the apostrophe `csvText`
 * added, so exporting and re-importing leaves descriptions exactly as they were.
 */
export function csvTextIn(value: string | null | undefined): string {
  const text = value ?? '';
  return ESCAPED_FORMULA.test(text) ? text.slice(1) : text;
}
