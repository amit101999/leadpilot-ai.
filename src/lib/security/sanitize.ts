/**
 * Produces error text that is safe to persist and show in the UI: strips
 * bearer tokens, API keys, URLs with credentials/query strings, phone numbers
 * and e-mail addresses, and bounds the length.
 */
const PATTERNS: Array<[RegExp, string]> = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]"],
  [/\bsk-[A-Za-z0-9_-]{10,}/g, "[redacted-key]"],
  [/\bEAA[A-Za-z0-9]{20,}/g, "[redacted-token]"],
  [/(access_token|api_key|apikey|token|secret|password)=([^&\s]+)/gi, "$1=[redacted]"],
  [/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi, "$1[redacted]@"],
  [/(https?:\/\/[^\s?]+)\?[^\s]*/gi, "$1?[query-redacted]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  [/\+?\d[\d\s-]{8,}\d/g, "[number]"],
];

export function sanitizeErrorMessage(error: unknown, maxLength = 500): string {
  const raw =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === "string"
        ? error
        : "Unknown error";
  let text = raw;
  for (const [pattern, replacement] of PATTERNS) text = text.replace(pattern, replacement);
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

/** Masks a phone number for display: +15551234567 -> +1•••••••567 */
export function maskPhone(phone: string): string {
  if (phone.length <= 5) return "•••";
  return `${phone.slice(0, 2)}${"•".repeat(Math.max(3, phone.length - 5))}${phone.slice(-3)}`;
}
