import type { SkillTerm } from "@/modules/profiles/config-schema";
import type { NormalizedJob } from "@/modules/job-sources/types";

export type MatchLocation = "skills" | "title" | "description";

export interface TermMatch {
  term: string;
  matchedVariant: string | null;
  locations: MatchLocation[];
  descriptionMentions: number;
  /**
   * STRONG: listed in structured skills, named in the title, or mentioned at
   * least twice in the description. WEAK: a single incidental mention, which
   * is never enough on its own to satisfy a required skill.
   */
  strength: "STRONG" | "WEAK" | "NONE";
}

export interface SearchableJob {
  title: string;
  description: string;
  skills: string[];
}

export function toSearchable(job: Pick<NormalizedJob, "title" | "description" | "skills">): SearchableJob {
  return {
    title: normalizeText(job.title),
    description: normalizeText(job.description),
    skills: job.skills.map(normalizeText),
  };
}

export function matchSkill(job: SearchableJob, skill: SkillTerm): TermMatch {
  const variants = [skill.name, ...skill.aliases];
  let best: TermMatch = {
    term: skill.name,
    matchedVariant: null,
    locations: [],
    descriptionMentions: 0,
    strength: "NONE",
  };
  for (const variant of variants) {
    const candidate = matchVariant(job, skill.name, variant);
    if (rank(candidate.strength) > rank(best.strength)) best = candidate;
    if (best.strength === "STRONG") break;
  }
  return best;
}

/** Plain keyword presence anywhere in the job (used for include/exclude keyword rules). */
export function containsTerm(job: SearchableJob, termText: string): boolean {
  const pattern = termPattern(termText);
  if (!pattern) return false;
  return pattern.test(job.title) || pattern.test(job.description) || job.skills.some((s) => pattern.test(s));
}

function matchVariant(job: SearchableJob, name: string, variant: string): TermMatch {
  const pattern = termPattern(variant);
  const locations: MatchLocation[] = [];
  let descriptionMentions = 0;
  if (pattern) {
    if (job.skills.some((s) => pattern.test(s))) locations.push("skills");
    if (pattern.test(job.title)) locations.push("title");
    const global = new RegExp(pattern.source, "gu");
    descriptionMentions = job.description.match(global)?.length ?? 0;
    if (descriptionMentions > 0) locations.push("description");
  }
  const strong = locations.includes("skills") || locations.includes("title") || descriptionMentions >= 2;
  const strength = strong ? "STRONG" : descriptionMentions === 1 ? "WEAK" : "NONE";
  return {
    term: name,
    matchedVariant: strength === "NONE" ? null : variant,
    locations,
    descriptionMentions,
    strength,
  };
}

function rank(strength: TermMatch["strength"]): number {
  return strength === "STRONG" ? 2 : strength === "WEAK" ? 1 : 0;
}

export function normalizeText(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

const patternCache = new Map<string, RegExp | null>();

/**
 * Word-boundary match that treats letters/digits as word characters, so
 * "react" does not match "reactive" and "node.js" matches literally.
 */
function termPattern(termText: string): RegExp | null {
  const key = normalizeText(termText);
  if (patternCache.has(key)) return patternCache.get(key) ?? null;
  if (key.length === 0) {
    patternCache.set(key, null);
    return null;
  }
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "[\\s\\-_/]+");
  // A leading "." is also excluded so the alias "js" does not match inside "node.js".
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}.])${escaped}(?![\\p{L}\\p{N}])`, "u");
  patternCache.set(key, pattern);
  return pattern;
}
