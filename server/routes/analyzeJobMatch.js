const express = require("express");
const { canonicalizeRequirements, evaluateComponents } = require("../services/aiService");
const { validateComponentEvaluationResponse } = require("../utils/schemaValidator");
const {
  validateFreshCanonicalRequirements,
  assignCanonicalRequirementIds,
  validateCachedCanonicalRequirements,
} = require("../utils/canonicalRequirementsValidator");
const { rollupRequirements, validateComponentCoverage } = require("../utils/rollup");
const { calculateMatchScore } = require("../utils/scoring");
const { computeJobSideInputFingerprint } = require("../utils/hash");
const {
  MAX_RESUME_TEXT_LENGTH,
  MAX_JOB_DESCRIPTION_LENGTH,
  MIN_TEXT_LENGTH,
  MAX_SKILLS_COUNT,
  MAX_SKILL_ITEM_LENGTH,
  MAX_SKILLS_OTHER_LENGTH,
} = require("../utils/limits");

const router = express.Router();

/** Maps a thrown AI-provider error to a safe, friendly HTTP response. Never leaks provider details/stack traces. */
function mapProviderError(err) {
  console.error("AI provider error:", err && err.message);
  const status = err && err.status;
  if (status === 429 || /rate.?limit/i.test((err && err.message) || "")) {
    return { status: 429, body: { error: "AI analysis is temporarily unavailable due to rate limits. Please try again shortly." } };
  }
  return { status: 502, body: { error: "AI analysis is temporarily unavailable. Please try again." } };
}

/**
 * Validates and normalizes a "skills" field: a frontend-controlled,
 * untrusted array of short strings. Returns { valid: true, data } or
 * { valid: false, reason }. An absent field normalizes to an empty
 * array — Required/Nice-to-have Skills are optional.
 */
function validateSkillsArray(raw, fieldLabel) {
  if (raw === undefined || raw === null) return { valid: true, data: [] };
  if (!Array.isArray(raw)) {
    return { valid: false, reason: `${fieldLabel} must be an array.` };
  }
  if (raw.length > MAX_SKILLS_COUNT) {
    return { valid: false, reason: `${fieldLabel} has too many items (max ${MAX_SKILLS_COUNT}).` };
  }
  const cleaned = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      return { valid: false, reason: `${fieldLabel} contains a non-string item.` };
    }
    const trimmed = item.trim();
    if (!trimmed) continue; // silently drop blanks rather than hard-failing the whole request
    if (trimmed.length > MAX_SKILL_ITEM_LENGTH) {
      return { valid: false, reason: `${fieldLabel} contains an item that's too long (max ${MAX_SKILL_ITEM_LENGTH} chars).` };
    }
    cleaned.push(trimmed);
  }
  return { valid: true, data: cleaned };
}

/** Validates a free-text "Other" skills field: an optional, length-bounded string. */
function validateSkillsOther(raw, fieldLabel) {
  if (raw === undefined || raw === null) return { valid: true, data: "" };
  if (typeof raw !== "string") {
    return { valid: false, reason: `${fieldLabel} must be a string.` };
  }
  const trimmed = raw.trim();
  if (trimmed.length > MAX_SKILLS_OTHER_LENGTH) {
    return { valid: false, reason: `${fieldLabel} is too long (max ${MAX_SKILLS_OTHER_LENGTH} chars).` };
  }
  return { valid: true, data: trimmed };
}

router.post("/analyze-job-match", async (req, res, next) => {
  try {
    const body = req.body || {};
    const resumeText = typeof body.resumeText === "string" ? body.resumeText.trim() : "";
    const jobDescription = typeof body.jobDescription === "string" ? body.jobDescription.trim() : "";

    const requiredSkillsValidation = validateSkillsArray(body.requiredSkills, "requiredSkills");
    if (!requiredSkillsValidation.valid) {
      return res.status(400).json({ error: "Required Skills input is invalid." });
    }
    const niceToHaveSkillsValidation = validateSkillsArray(body.niceToHaveSkills, "niceToHaveSkills");
    if (!niceToHaveSkillsValidation.valid) {
      return res.status(400).json({ error: "Nice-to-have Skills input is invalid." });
    }
    const requiredSkillsOtherValidation = validateSkillsOther(body.requiredSkillsOther, "requiredSkillsOther");
    if (!requiredSkillsOtherValidation.valid) {
      return res.status(400).json({ error: "Required Skills input is invalid." });
    }
    const niceToHaveSkillsOtherValidation = validateSkillsOther(body.niceToHaveSkillsOther, "niceToHaveSkillsOther");
    if (!niceToHaveSkillsOtherValidation.valid) {
      return res.status(400).json({ error: "Nice-to-have Skills input is invalid." });
    }

    const requiredSkills = requiredSkillsValidation.data;
    const requiredSkillsOther = requiredSkillsOtherValidation.data;
    const niceToHaveSkills = niceToHaveSkillsValidation.data;
    const niceToHaveSkillsOther = niceToHaveSkillsOtherValidation.data;

    if (resumeText.length < MIN_TEXT_LENGTH) {
      return res.status(400).json({ error: "Please upload a resume before analyzing this job." });
    }
    if (resumeText.length > MAX_RESUME_TEXT_LENGTH) {
      return res.status(413).json({ error: "Resume text is too long to analyze." });
    }

    // The job description is no longer mandatory on its own — Required
    // Skills / Nice-to-have Skills can supply the job-side substance
    // instead (e.g. a one-word JD like "JIRA" plus a populated Required
    // Skills list is a perfectly analyzable combination). What's actually
    // required is that AT LEAST ONE job-side input has something in it.
    const hasAnyJobSideInput =
      jobDescription.length > 0 ||
      requiredSkills.length > 0 ||
      requiredSkillsOther.length > 0 ||
      niceToHaveSkills.length > 0 ||
      niceToHaveSkillsOther.length > 0;
    if (!hasAnyJobSideInput) {
      return res.status(400).json({ error: "This application doesn't have a job description or any listed skills to analyze yet." });
    }
    if (jobDescription.length > MAX_JOB_DESCRIPTION_LENGTH) {
      return res.status(413).json({ error: "Job description is too long to analyze." });
    }

    // --- Decide whether frontend-cached canonical requirements can be reused ---
    // canonicalRequirements/canonicalRequirementsFingerprint are both
    // untrusted, optional client input. The fingerprint is a hash of all
    // FIVE job-side inputs as they were WHEN those requirements were
    // generated (sent by the frontend, originally computed and stored by
    // us in an earlier response). We independently recompute the
    // fingerprint from the job-side inputs actually in THIS request and
    // compare — this is the binding check that stops a stale or
    // mismatched cache from being silently reused, and it now covers
    // Required/Nice-to-have Skills changes, not just job description
    // text changes. Any failure below (missing, fingerprint mismatch, or
    // failed shape validation) is NOT a hard error — canonicalRequirements
    // just stays null and Stage A runs fresh, self-healing the cache.
    let canonicalRequirements = null;
    const clientCanonical = body.canonicalRequirements;
    const clientFingerprint = typeof body.canonicalRequirementsFingerprint === "string" ? body.canonicalRequirementsFingerprint : null;

    if (clientCanonical && clientFingerprint) {
      const expectedFingerprint = computeJobSideInputFingerprint(
        jobDescription,
        requiredSkills,
        requiredSkillsOther,
        niceToHaveSkills,
        niceToHaveSkillsOther
      );
      if (clientFingerprint === expectedFingerprint) {
        const cachedValidation = validateCachedCanonicalRequirements(clientCanonical);
        if (cachedValidation.valid) {
          canonicalRequirements = cachedValidation.data;
        } else {
          console.error("Rejected cached canonicalRequirements, falling back to Stage A:", cachedValidation.reason);
        }
      }
    }

    // --- Stage A: canonicalize the job-side requirements (skipped if a valid cache was found) ---
    if (!canonicalRequirements) {
      let freshRaw;
      try {
        freshRaw = await canonicalizeRequirements(jobDescription, requiredSkills, requiredSkillsOther, niceToHaveSkills, niceToHaveSkillsOther);
      } catch (err) {
        const mapped = mapProviderError(err);
        return res.status(mapped.status).json(mapped.body);
      }

      const freshValidation = validateFreshCanonicalRequirements(freshRaw);
      if (!freshValidation.valid) {
        console.error("Invalid Stage A response shape:", freshValidation.reason);
        return res.status(502).json({ error: "The analysis returned an invalid response." });
      }

      canonicalRequirements = assignCanonicalRequirementIds(freshValidation.data);
    }

    // --- Stage B: evaluate resume support for each predefined component ---
    let rawEvaluation;
    try {
      rawEvaluation = await evaluateComponents(resumeText, canonicalRequirements);
    } catch (err) {
      const mapped = mapProviderError(err);
      return res.status(mapped.status).json(mapped.body);
    }

    const evaluationValidation = validateComponentEvaluationResponse(rawEvaluation);
    if (!evaluationValidation.valid) {
      console.error("Invalid Stage B response shape:", evaluationValidation.reason);
      return res.status(502).json({ error: "The analysis returned an invalid response." });
    }

    const coverage = validateComponentCoverage(canonicalRequirements, evaluationValidation.data.componentEvaluations);
    if (!coverage.valid) {
      console.error("Stage B component coverage mismatch:", coverage.reason);
      return res.status(502).json({ error: "The analysis returned an invalid response." });
    }

    // --- Deterministic server-side rollup + scoring (no AI involved) ---
    const { requirementsMet, partialMatches, missingRequirements } = rollupRequirements(
      canonicalRequirements,
      evaluationValidation.data.componentEvaluations
    );
    const scoreResult = calculateMatchScore(requirementsMet, partialMatches, missingRequirements);

    if (scoreResult.matchScore === null) {
      // Not reachable through this route in practice — Stage A validation
      // already requires at least one canonical requirement before this
      // point — but scoring.js refuses to manufacture a score when it
      // genuinely has nothing to evaluate, so this mirrors that here
      // rather than silently returning a fabricated 0%.
      console.error("Scoring returned no evaluable requirements despite validated canonical requirements.");
      return res.status(502).json({ error: "The analysis returned no evaluable requirements." });
    }

    return res.status(200).json({
      matchScore: scoreResult.matchScore,
      core: scoreResult.core,
      nth: scoreResult.nth,
      requirementsMet,
      partialMatches,
      missingRequirements,
      summary: evaluationValidation.data.summary,
      canonicalRequirements,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
