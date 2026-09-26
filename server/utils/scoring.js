/**
 * Model D scoring — deterministic, two-tier Core/Nice-to-Have coverage.
 *
 * Background: the original formula (matchScore = round(earnedPoints /
 * totalRequirements * 100)) weighted every canonical requirement equally,
 * regardless of whether the job description explicitly marked it as
 * mandatory or optional. That let a candidate meeting every Required
 * qualification but no Nice-to-Have ones score as low as ~54% on a
 * 7-required/6-preferred posting, while a candidate missing several
 * Required qualifications could outscore them just by covering more
 * Nice-to-Haves. See JobTrack_AI_Scoring_Model_Design_Review.md for the
 * full design review and rejected alternatives (Model A: equal weight,
 * Model B: fixed per-item weights).
 *
 * CORE = requirements with priority "required" or "unspecified".
 * NTH  = requirements with priority "preferred".
 * (unspecified is pooled with required, not given its own tier: an
 * unclear-priority item is a weaker signal than an explicit "required"
 * one, but treating it as closer to "expected" than "bonus" is the
 * safer default for the candidate, and keeps this to two tiers instead
 * of three.)
 *
 * Each requirement still contributes Met=1.0 / Partial=0.5 / Missing=0
 * points, exactly as before — Model D changes how those points are
 * combined into a final percentage, not how a single requirement earns
 * points in the first place.
 *
 * C = Core coverage = earned Core points / total Core requirements (0-1)
 * N = NTH coverage  = earned NTH points / total NTH requirements (0-1)
 *
 * Normal mode (Core requirements exist):
 *   Final = C + ((1 - C) * N * C)
 *
 * Core exists, zero NTH exist:
 *   Final = C   (N has nothing to contribute)
 *
 * Zero Core exist, NTH exist:
 *   Final = N   (NTH becomes the only signal there is)
 *
 * This intentionally uses NTH coverage (a ratio), never NTH quantity —
 * canonical requirement *count* is partially a product of Stage A's own
 * semantic decomposition, and a scoring formula that reacted to raw
 * quantity would hand Stage A's decomposition choices more influence
 * over the numeric score than they should have. A candidate with 1/1 NTH
 * and a candidate with 50/50 NTH get the identical bonus, by design.
 */

const CORE_PRIORITIES = new Set(["required", "unspecified"]);
const NTH_PRIORITY = "preferred";

function isCorePriority(priority) {
  return CORE_PRIORITIES.has(priority);
}

function isNthPriority(priority) {
  return priority === NTH_PRIORITY;
}

/**
 * Rounds to exactly 2 decimal places without the classic floating-point
 * drift (e.g. avoids something like 92.79999999999999). Used only for
 * final, user-facing values — never for the C/N values feeding the
 * Model D formula itself, which must stay at full precision.
 */
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Sums Met/Partial/Missing points for the subset of a result array
 * matching `matches(priority)`, given that array's fixed per-item point
 * value (1 for requirementsMet, 0.5 for partialMatches, 0 for
 * missingRequirements — Missing items don't need to be counted for
 * points, only for the total denominator).
 */
function sumBucket(items, matches, pointValue) {
  let count = 0;
  let earned = 0;
  for (const item of items) {
    if (matches(item.priority)) {
      count += 1;
      earned += pointValue;
    }
  }
  return { count, earned };
}

/**
 * Computes { count, earned } for one tier (Core or NTH) across all three
 * classification buckets.
 */
function tierTotals(requirementsMet, partialMatches, missingRequirements, matches) {
  const met = sumBucket(requirementsMet, matches, 1);
  const partial = sumBucket(partialMatches, matches, 0.5);
  const missing = sumBucket(missingRequirements, matches, 0);
  return {
    count: met.count + partial.count + missing.count,
    earned: met.earned + partial.earned + missing.earned,
  };
}

/**
 * Computes the Model D match score from the deterministic Met/Partial/
 * Missing classifications (each item must carry a `priority` field —
 * see server/utils/rollup.js).
 *
 * Returns:
 *   {
 *     matchScore: number | null,   // 0-100, 2 decimal places; null if there was nothing to score at all
 *     core: { count, earnedPoints, coveragePercent: number | null },
 *     nth:  { count, earnedPoints, coveragePercent: number | null },
 *   }
 * coveragePercent is null when that tier has zero requirements (nothing
 * to compute a percentage of), distinct from a tier that exists but
 * scored 0%.
 */
function calculateMatchScore(requirementsMet, partialMatches, missingRequirements) {
  const met = Array.isArray(requirementsMet) ? requirementsMet : [];
  const partial = Array.isArray(partialMatches) ? partialMatches : [];
  const missing = Array.isArray(missingRequirements) ? missingRequirements : [];

  const core = tierTotals(met, partial, missing, isCorePriority);
  const nth = tierTotals(met, partial, missing, isNthPriority);

  if (core.count === 0 && nth.count === 0) {
    // Nothing to evaluate at all. In practice this shouldn't be
    // reachable through the normal API path — Stage A validation
    // already requires at least one canonical requirement before
    // scoring is ever attempted — but this function doesn't assume
    // that and refuses to manufacture a 0% (or any other) score when
    // there was genuinely nothing to measure.
    return {
      matchScore: null,
      core: { count: 0, earnedPoints: 0, coveragePercent: null },
      nth: { count: 0, earnedPoints: 0, coveragePercent: null },
    };
  }

  let finalRaw; // full precision, 0-1, used only internally
  let coreCoveragePercent = null;
  let nthCoveragePercent = null;

  if (core.count > 0) {
    const C = core.earned / core.count;
    coreCoveragePercent = round2(C * 100);

    if (nth.count > 0) {
      const N = nth.earned / nth.count;
      nthCoveragePercent = round2(N * 100);
      finalRaw = C + (1 - C) * N * C;
    } else {
      finalRaw = C;
    }
  } else {
    // core.count === 0 here, and the earlier guard already ruled out
    // nth.count also being 0, so nth.count > 0 is guaranteed.
    const N = nth.earned / nth.count;
    nthCoveragePercent = round2(N * 100);
    finalRaw = N;
  }

  return {
    matchScore: round2(finalRaw * 100),
    core: { count: core.count, earnedPoints: core.earned, coveragePercent: coreCoveragePercent },
    nth: { count: nth.count, earnedPoints: nth.earned, coveragePercent: nthCoveragePercent },
  };
}

module.exports = { calculateMatchScore };
