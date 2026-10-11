/**
 * Exact decimal handling for money values. Amounts are represented as bigint
 * minor units (cents) so comparisons never touch floating point.
 */

const DECIMAL_RE = /^(\d{1,12})(?:\.(\d{1,2}))?$/;
const RATE_RE = /^(\d{1,9})(?:\.(\d{1,8}))?$/;
const RATE_SCALE = 100_000_000n; // 8 decimal places

export type Cents = bigint;

export function isDecimalString(value: string): boolean {
  return DECIMAL_RE.test(value);
}

/** Parses a non-negative decimal with at most 2 fractional digits. Returns null when invalid. */
export function toCents(value: string | number | null | undefined): Cents | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === "number" ? numberToDecimalString(value) : value.trim();
  if (text === null) return null;
  const match = DECIMAL_RE.exec(text);
  if (!match) return null;
  const whole = BigInt(match[1] ?? "0");
  const fraction = BigInt((match[2] ?? "").padEnd(2, "0"));
  return whole * 100n + fraction;
}

export function centsToString(cents: Cents): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / 100n;
  const fraction = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${fraction}`;
}

/**
 * Converts an amount using a rate expressed as "base currency units per one
 * foreign unit" (e.g. EUR->USD 1.08). Rounds DOWN so eligibility decisions are
 * conservative: a converted value never overstates the budget.
 */
export function convertCents(amount: Cents, rate: string): Cents | null {
  const match = RATE_RE.exec(rate.trim());
  if (!match) return null;
  const scaledRate = BigInt(match[1] ?? "0") * RATE_SCALE + BigInt((match[2] ?? "").padEnd(8, "0"));
  if (scaledRate <= 0n) return null;
  return (amount * scaledRate) / RATE_SCALE;
}

export function isValidRate(rate: string): boolean {
  return convertCents(100n, rate) !== null;
}

export function formatMoney(value: string | null | undefined, currency: string | null | undefined): string {
  if (value === null || value === undefined) return "Unknown";
  const cents = toCents(value);
  if (cents === null) return "Unknown";
  const [whole = "0", fraction = "00"] = centsToString(cents).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const amount = fraction === "00" ? grouped : `${grouped}.${fraction}`;
  return `${currency ?? ""} ${amount}`.trim();
}

/** Source data sometimes arrives as JS numbers; convert without float rounding artefacts. */
function numberToDecimalString(value: number): string | null {
  if (!Number.isFinite(value) || value < 0) return null;
  return value.toFixed(2);
}
