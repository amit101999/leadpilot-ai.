/**
 * Minimal state-machine helper. Transition maps are declared per domain and
 * enforced twice: here (pure, unit-tested) and in SQL via
 * `UPDATE ... WHERE status = ANY(allowedFrom(target))` so concurrent writers
 * cannot race a row into an invalid state.
 */
export type TransitionMap<S extends string> = Readonly<Record<S, readonly S[]>>;

export function canTransition<S extends string>(map: TransitionMap<S>, from: S, to: S): boolean {
  return map[from].includes(to);
}

export function assertTransition<S extends string>(
  map: TransitionMap<S>,
  from: S,
  to: S,
  entity: string,
): void {
  if (!canTransition(map, from, to)) {
    throw new InvalidTransitionError(entity, from, to);
  }
}

/** Every state from which `to` can be reached in one step. */
export function allowedFrom<S extends string>(map: TransitionMap<S>, to: S): S[] {
  return (Object.keys(map) as S[]).filter((from) => map[from].includes(to));
}

export function isTerminal<S extends string>(map: TransitionMap<S>, state: S): boolean {
  return map[state].length === 0;
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly entity: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`Invalid ${entity} transition ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}
