/**
 * Validates the AI provider's Stage B (component evaluation) response
 * before it is trusted for the deterministic rollup. This is defense in
 * depth: even though we ask the provider for a structured/schema-
 * constrained response, we never trust external output blindly (see
 * README "Security" section).
 *
 * This validator is intentionally hand-rolled rather than pulling in a
 * schema library — the shape is small and fixed, so a dependency wasn't
 * worth adding for it.
 *
 * This does NOT check that componentEvaluations covers exactly the
 * expected componentIds — that requires the canonical requirement list
 * for comparison, so it's a separate check: validateComponentCoverage()
 * in server/utils/rollup.js, run after this validator succeeds.
 */

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidComponentEvaluation(item) {
  if (!item || typeof item !== "object") return false;
  if (!isNonEmptyString(item.componentId)) return false;
  if (typeof item.supported !== "boolean") return false;
  if (typeof item.evidence !== "string") return false;
  return true;
}

/**
 * Validates and normalizes Stage B's raw response.
 * Returns { valid: true, data } on success, or { valid: false, reason } on failure.
 */
function validateComponentEvaluationResponse(raw) {
  if (!raw || typeof raw !== "object") {
    return { valid: false, reason: "Response was not a JSON object." };
  }

  const { componentEvaluations, summary } = raw;

  if (!Array.isArray(componentEvaluations) || !componentEvaluations.every(isValidComponentEvaluation)) {
    return { valid: false, reason: "componentEvaluations is missing or malformed." };
  }
  if (!isNonEmptyString(summary)) {
    return { valid: false, reason: "summary is missing or empty." };
  }

  return {
    valid: true,
    data: {
      componentEvaluations,
      summary: summary.trim(),
    },
  };
}

module.exports = { validateComponentEvaluationResponse };
