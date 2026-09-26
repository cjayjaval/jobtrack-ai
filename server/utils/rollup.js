/**
 * Confirms Stage B's response covers every component in the canonical
 * requirement list exactly once — no missing, no duplicate, no unknown
 * componentIds. Stage B must evaluate the predefined components exactly
 * as given, never add/drop/rename them; this is the check that enforces
 * that contract rather than trusting the model to have followed it.
 */
function validateComponentCoverage(canonicalRequirements, componentEvaluations) {
  const expectedIds = new Set();
  canonicalRequirements.requirements.forEach((req) => {
    req.components.forEach((c) => expectedIds.add(c.id));
  });

  const seenIds = new Set();
  for (const evaluation of componentEvaluations) {
    if (!expectedIds.has(evaluation.componentId)) {
      return { valid: false, reason: `Unexpected componentId "${evaluation.componentId}" not in the canonical requirement list.` };
    }
    if (seenIds.has(evaluation.componentId)) {
      return { valid: false, reason: `Duplicate componentId "${evaluation.componentId}" in response.` };
    }
    seenIds.add(evaluation.componentId);
  }

  if (seenIds.size !== expectedIds.size) {
    return { valid: false, reason: `Response covers ${seenIds.size} of ${expectedIds.size} expected components.` };
  }

  return { valid: true };
}

/**
 * Deterministically rolls Stage B's per-component support flags up into
 * Met/Partial/Missing per requirement. This is plain logic, not a model
 * call — it can never drift between identical inputs, which is the
 * point: the model's remaining job is only "is this one predefined
 * component supported," and everything above that (grouping components
 * into a requirement-level verdict) is calculated, not judged.
 *
 * All components supported -> Met
 * Some (not all) supported  -> Partial
 * None supported            -> Missing
 *
 * Each result also carries the requirement's `priority` (required /
 * preferred / unspecified) through unchanged, so server/utils/scoring.js
 * can group Core vs. Nice-to-Have requirements for Model D scoring. This
 * is a pass-through of existing canonical-requirement metadata, not a
 * new classification decision.
 *
 * Assumes validateComponentCoverage() has already confirmed
 * componentEvaluations exactly covers every component — this function
 * does not re-check that.
 */
function rollupRequirements(canonicalRequirements, componentEvaluations) {
  const evaluationById = new Map();
  componentEvaluations.forEach((evaluation) => evaluationById.set(evaluation.componentId, evaluation));

  const requirementsMet = [];
  const partialMatches = [];
  const missingRequirements = [];

  canonicalRequirements.requirements.forEach((req) => {
    const componentResults = req.components.map((c) => {
      const evaluation = evaluationById.get(c.id);
      return {
        text: c.text,
        supported: !!(evaluation && evaluation.supported),
        evidence: evaluation && typeof evaluation.evidence === "string" ? evaluation.evidence.trim() : "",
      };
    });

    const supportedCount = componentResults.filter((c) => c.supported).length;
    const totalCount = componentResults.length;

    const supportingEvidence = componentResults
      .filter((c) => c.supported && c.evidence)
      .map((c) => c.evidence)
      .join(" ");
    const unsupportedDetail = componentResults
      .filter((c) => !c.supported)
      .map((c) => (c.evidence ? `${c.text}: ${c.evidence}` : c.text))
      .join("; ");

    if (supportedCount === totalCount) {
      requirementsMet.push({
        requirement: req.requirement,
        priority: req.priority,
        evidence: supportingEvidence || "Supported by resume evidence.",
      });
    } else if (supportedCount > 0) {
      partialMatches.push({
        requirement: req.requirement,
        priority: req.priority,
        evidence: supportingEvidence || "Partially supported by resume evidence.",
        gap: unsupportedDetail || "Some components are not clearly supported.",
      });
    } else {
      missingRequirements.push({
        requirement: req.requirement,
        priority: req.priority,
        reason: unsupportedDetail || "No supporting evidence found in the resume.",
      });
    }
  });

  return { requirementsMet, partialMatches, missingRequirements };
}

module.exports = { rollupRequirements, validateComponentCoverage };
