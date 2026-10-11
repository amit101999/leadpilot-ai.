export interface RankCandidate {
  id: string;
  score: number;
  firstSeenAt: Date;
  sourceJobId: string;
}

/**
 * Deterministic order: score desc, then earliest discovery, then stable source id.
 * The same inputs always produce the same order regardless of input order.
 */
export function rankCandidates<T extends RankCandidate>(candidates: readonly T[]): T[] {
  return [...candidates].sort(
    (a, b) =>
      b.score - a.score ||
      a.firstSeenAt.getTime() - b.firstSeenAt.getTime() ||
      (a.sourceJobId < b.sourceJobId ? -1 : a.sourceJobId > b.sourceJobId ? 1 : 0),
  );
}

/** Picks at most `limit` candidates. Never lowers any threshold to fill the limit. */
export function selectTop<T extends RankCandidate>(candidates: readonly T[], limit: number): T[] {
  return rankCandidates(candidates).slice(0, Math.max(0, limit));
}
