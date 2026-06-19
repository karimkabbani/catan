// Deterministic, serializable PRNG (mulberry32). We keep the cursor in
// GameState.rngState so a game replays identically and tests are reproducible.

export function nextRandom(state: number): { value: number; state: number } {
  let t = (state + 0x6d2b79f5) | 0;
  let x = t;
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  const value = ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  return { value, state: t };
}

/** Returns an integer in [0, max). */
export function nextInt(state: number, max: number): { value: number; state: number } {
  const r = nextRandom(state);
  return { value: Math.floor(r.value * max), state: r.state };
}

/** Fisher-Yates shuffle using the seeded stream; returns shuffled copy + new state. */
export function shuffle<T>(arr: T[], state: number): { result: T[]; state: number } {
  const result = arr.slice();
  let s = state;
  for (let i = result.length - 1; i > 0; i--) {
    const r = nextInt(s, i + 1);
    s = r.state;
    const j = r.value;
    [result[i], result[j]] = [result[j], result[i]];
  }
  return { result, state: s };
}

/** Roll two dice from the seeded stream. */
export function rollDice(state: number): { dice: [number, number]; state: number } {
  const a = nextInt(state, 6);
  const b = nextInt(a.state, 6);
  return { dice: [a.value + 1, b.value + 1], state: b.state };
}
