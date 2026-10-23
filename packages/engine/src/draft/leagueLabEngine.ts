// League Lab: takes the league's REAL manager tendency profiles and lets
// the user stress-test against adjusted versions of them — "what if my
// league drafts RB more aggressively this year," "what if tendencies are
// looser than usual." Pure transform functions; the actual simulation
// reuses strategyLabEngine's simulateStrategy with a "balanced" (best
// player available) strategy for the user, since League Lab is about
// changing OPPONENT behavior, not the user's own approach.

import type { ManagerProfile } from "./mockDraftEngine";

export type LeagueLabSliders = {
  rbAggression: number; // 0.5 - 2.0, 1.0 = unchanged
  qbAggression: number; // 0.5 - 2.0, 1.0 = unchanged
  tendencyStrength: number; // 0 - 1, 1.0 = real tendencies as-is, 0 = flattened/neutral
};

function scalePosition(profile: ManagerProfile, position: string, multiplier: number): ManagerProfile {
  if (multiplier === 1) return profile;
  const scale = (bucket: Record<string, number>) => {
    if (!(position in bucket)) return bucket;
    return { ...bucket, [position]: Math.max(0, bucket[position] * multiplier) };
  };
  return {
    ...profile,
    early: scale(profile.early),
    mid: scale(profile.mid),
    late: scale(profile.late),
    reach_bias: profile.reach_bias
      ? { ...profile.reach_bias, [position]: (profile.reach_bias[position] ?? 0) * multiplier }
      : profile.reach_bias,
  };
}

// Interpolates a manager's positional tendency toward a flat/neutral
// distribution — at strength 0, every position in a bucket looks equally
// preferred (roughly "random" positional behavior); at strength 1, real
// historical tendencies are used unchanged.
function flattenTendencies(profile: ManagerProfile, strength: number): ManagerProfile {
  if (strength === 1) return profile;
  const flatten = (bucket: Record<string, number>) => {
    const values = Object.values(bucket);
    if (values.length === 0) return bucket;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const out: Record<string, number> = {};
    for (const pos of Object.keys(bucket)) {
      out[pos] = strength * bucket[pos] + (1 - strength) * avg;
    }
    return out;
  };
  return {
    ...profile,
    early: flatten(profile.early),
    mid: flatten(profile.mid),
    late: flatten(profile.late),
  };
}

export function applyLeagueLabSliders(
  profiles: ManagerProfile[],
  sliders: LeagueLabSliders
): ManagerProfile[] {
  return profiles.map((p) => {
    let next = scalePosition(p, "RB", sliders.rbAggression);
    next = scalePosition(next, "QB", sliders.qbAggression);
    next = flattenTendencies(next, sliders.tendencyStrength);
    return next;
  });
}
