/**
 * MUST stay byte-for-byte identical to simpleHash() in js/resume.js.
 *
 * Both sides need to compute the exact same hash for the exact same
 * string: the frontend stores this hash alongside cached canonical
 * requirements when an analysis succeeds, then resends it on the next
 * analyze/re-analyze call. The backend independently recomputes this
 * same hash from the jobDescription it received in that same request
 * and compares the two (see server/routes/analyzeJobMatch.js) — that
 * comparison is only meaningful if both sides use the identical
 * algorithm. If you ever change this function, change js/resume.js's
 * simpleHash() to match, exactly, in the same change.
 *
 * Not cryptographic — this is a change-detection fingerprint, not a
 * security boundary. (The actual untrusted-input handling for a
 * mismatched/tampered payload is the validation in
 * server/utils/canonicalRequirementsValidator.js, not this hash.)
 */
function simpleHash(str) {
  let hash = 0;
  const text = str || "";
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(36);
}

/**
 * MUST stay byte-for-byte identical to computeJobSideInputFingerprint()
 * in js/resume.js — same reasoning as simpleHash() above: the frontend
 * computes and stores this when an analysis succeeds, resends it as
 * canonicalRequirementsFingerprint next time, and the backend
 * independently recomputes it from the job-side inputs actually in that
 * request to decide whether cached canonical requirements may be reused
 * (see server/routes/analyzeJobMatch.js). If you change this, change the
 * frontend copy to match, exactly, in the same change.
 *
 * Fingerprints the STRUCTURED underlying fields, not a pre-combined
 * display string — combining Required Skills' checked list with its
 * free-text "Other" value into one comma-joined string before hashing
 * would let a comma inside the "Other" text be silently reinterpreted
 * as a skill boundary, which is not what this fingerprint is supposed
 * to represent.
 *
 * requiredSkills/niceToHaveSkills are sorted + lowercased before joining
 * so that harmless differences (checkbox click order, casing) don't
 * invalidate the cache — they're logically a set, not a sequence. The
 * "Other" free-text fields and the job description itself are NOT
 * treated as sets — they're free text where content and, for the
 * job description, exact wording genuinely matter.
 */
function computeJobSideInputFingerprint(jobDescription, requiredSkills, requiredSkillsOther, niceToHaveSkills, niceToHaveSkillsOther) {
  const normalizeSkillArray = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .map((s) => String(s == null ? "" : s).trim().toLowerCase())
      .filter(Boolean)
      .sort()
      .join(",");

  const normalizeOther = (s) => (typeof s === "string" ? s.trim().toLowerCase() : "");

  const SEP = "\u241F";

  const canonicalForm = [
    jobDescription || "",
    normalizeSkillArray(requiredSkills),
    normalizeOther(requiredSkillsOther),
    normalizeSkillArray(niceToHaveSkills),
    normalizeOther(niceToHaveSkillsOther),
  ].join(SEP);

  return simpleHash(canonicalForm);
}

module.exports = { simpleHash, computeJobSideInputFingerprint };
