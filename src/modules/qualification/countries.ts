/**
 * Upwork writes some client countries in more than one way (seen live on 2026-11-24: "United States" and "USA" in
 * the same search). Country rules and the priority-country bonus compare these canonical, lower-case names, so a
 * profile listing "United States" also matches "USA", and the other way round.
 */
const ALIASES: Record<string, string> = {
  usa: "united states",
  us: "united states",
  "u.s.": "united states",
  "u.s.a.": "united states",
  "united states of america": "united states",
  uk: "united kingdom",
  "u.k.": "united kingdom",
  "great britain": "united kingdom",
  britain: "united kingdom",
  england: "united kingdom",
  scotland: "united kingdom",
  wales: "united kingdom",
  "northern ireland": "united kingdom",
  czechia: "czech republic",
  holland: "netherlands",
  "the netherlands": "netherlands",
  uae: "united arab emirates",
};

export function canonicalCountry(name: string): string {
  const key = name.trim().replace(/\s+/g, " ").toLowerCase();
  return ALIASES[key] ?? key;
}
