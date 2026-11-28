/** Display formatting shared by server and client components. */

export function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined ? "–" : new Intl.NumberFormat("en").format(value);
}

/** Decimal-string money (never parsed into floating point for arithmetic, only for display). */
export function formatMoney(amount: string | null | undefined, currency: string | null | undefined): string {
  if (!amount) return "Unknown";
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${amount} ${currency ?? ""}`.trim();
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: currency ?? "USD",
      maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    }).format(value);
  } catch {
    return `${amount} ${currency ?? ""}`.trim();
  }
}

/**
 * Formats a micro-USD amount (bigint) as dollars without floating point.
 * Amounts under $1 keep 4 decimals because a single AI call costs fractions of a cent.
 */
export function formatMicroUsd(micro: bigint | null | undefined): string {
  if (micro === null || micro === undefined) return "–";
  const negative = micro < 0n;
  const abs = negative ? -micro : micro;
  const decimals = abs >= 1_000_000n ? 2 : 4;
  const step = 10n ** BigInt(6 - decimals);
  const rounded = (abs + step / 2n) / step; // round half up
  const unit = 10n ** BigInt(decimals);
  const whole = new Intl.NumberFormat("en").format(rounded / unit);
  const fraction = (rounded % unit).toString().padStart(decimals, "0");
  return `${negative ? "-" : ""}$${whole}.${fraction}`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "–";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
