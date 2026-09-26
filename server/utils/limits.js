/**
 * Centralized input-size limits for the AI Job Match feature.
 * Keeping these in one place makes them easy to tune, and documents why
 * each number was chosen (also explained in README.md under "Input limits").
 */
module.exports = {
  // Resumes are typically 1-2 pages of plain text. ~15,000 characters
  // comfortably covers a long two-page resume with margin to spare,
  // while keeping AI request size (and cost) bounded.
  MAX_RESUME_TEXT_LENGTH: 15000,

  // Job descriptions are sometimes pasted with extra boilerplate.
  // 10,000 characters covers a long posting without allowing unbounded input.
  MAX_JOB_DESCRIPTION_LENGTH: 10000,

  // Below this length, extracted resume text almost certainly failed
  // (e.g. an image-only/scanned PDF) — better to reject early with a
  // clear message. This applies to resumeText only; jobDescription has
  // no minimum length of its own (see server/routes/analyzeJobMatch.js —
  // job-side validity is judged across jobDescription + Required Skills +
  // Nice-to-have Skills combined, not the JD text alone).
  MIN_TEXT_LENGTH: 20,

  // Required Skills / Nice-to-have Skills (frontend-controlled, untrusted):
  // generous above the fixed ~27-item checklist plus free "Other" text,
  // while still bounding request size before it reaches the AI call.
  MAX_SKILLS_COUNT: 30,
  MAX_SKILL_ITEM_LENGTH: 100,
  MAX_SKILLS_OTHER_LENGTH: 500,

  // Canonical requirements (two-stage architecture): these bound both a
  // fresh Stage A response AND a frontend-resent cached payload, since
  // the latter is untrusted client input and must never be allowed an
  // unbounded shape/size before it reaches the AI call or the rollup.
  MAX_CANONICAL_REQUIREMENTS: 40,
  MAX_COMPONENTS_PER_REQUIREMENT: 10,
  MAX_REQUIREMENT_TEXT_LENGTH: 300,
  MAX_COMPONENT_TEXT_LENGTH: 200,
  MAX_CANONICAL_REQUIREMENTS_PAYLOAD_BYTES: 50 * 1024,
};
