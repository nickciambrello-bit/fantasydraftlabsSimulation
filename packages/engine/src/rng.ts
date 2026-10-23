// Seedable random number generation for every simulation in the engine.
// Passing the same seed to two runs gives identical draws, which is what
// makes results reproducible and lets "world A vs world B" comparisons use
// common random numbers so the difference reflects the decision, not noise.

export type Rng = {
  /** Uniform float in [0, 1). */
  next(): number;
};

// xoshiro128** (Blackman & Vigna): fast, 32-bit only, good statistical
// quality, and small enough to clone cheaply for branching sims.
export function createRng(seed: number | string): Rng {
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
  // splitmix32 expands the seed into the four state words.
  let x = typeof seed === "string" ? hashString(seed) : seed >>> 0;
  const splitmix = () => {
    x = (x + 0x9e3779b9) >>> 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  s0 = splitmix(); s1 = splitmix(); s2 = splitmix(); s3 = splitmix();

  return {
    next() {
      const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
      const t = (s1 << 9) >>> 0;
      s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3;
      s2 = (s2 ^ t) >>> 0;
      s3 = rotl(s3, 11);
      return result / 4294967296;
    },
  };
}

/** Unseeded generator backed by Math.random, used when no seed is given. */
export const defaultRng: Rng = { next: () => Math.random() };

/** Unbiased Fisher-Yates shuffle that returns a new array. */
export function shuffle<T>(items: readonly T[], rng: Rng = defaultRng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function rotl(v: number, k: number): number {
  return ((v << k) | (v >>> (32 - k))) >>> 0;
}

// FNV-1a, so string seeds like a sim_id hash map to a stable number.
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
