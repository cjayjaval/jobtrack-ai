const {
  MAX_CANONICAL_REQUIREMENTS,
  MAX_COMPONENTS_PER_REQUIREMENT,
  MAX_REQUIREMENT_TEXT_LENGTH,
  MAX_COMPONENT_TEXT_LENGTH,
  MAX_CANONICAL_REQUIREMENTS_PAYLOAD_BYTES,
} = require("./limits");

// priority/sources are metadata only for this version — nothing in
// rollup.js or scoring.js reads them yet (see server/utils/rollup.js).
const PRIORITY_VALUES = ["required", "preferred", "unspecified"];
const SOURCE_VALUES = ["job_description", "required_skills", "nice_to_have_skills"];

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** priority is optional (absent is fine, for backward compatibility with older shapes) but if present must be one of the three known values. */
function isValidPriority(priority) {
  return priority === undefined || PRIORITY_VALUES.includes(priority);
}

/** sources is optional, but if present must be a non-empty array of known, non-duplicate values. */
function isValidSources(sources) {
  if (sources === undefined) return true;
  if (!Array.isArray(sources) || sources.length === 0) return false;
  if (!sources.every((s) => SOURCE_VALUES.includes(s))) return false;
  return new Set(sources).size === sources.length; // no duplicates
}

/**
 * Validates Stage A's raw model output, before server-assigned IDs are
 * attached:
 * { requirements: [{ requirement, priority?, sources?, components: string[] }] }
 *
 * The same count/length limits used for untrusted client input (below)
 * are applied here too — a freshly-generated model response isn't
 * implicitly trusted just because it's "ours"; it gets the same scrutiny.
 */
function validateFreshCanonicalRequirements(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.requirements)) {
    return { valid: false, reason: "requirements is missing or not an array." };
  }
  const { requirements } = raw;
  if (requirements.length === 0) {
    return { valid: false, reason: "No requirements were identified." };
  }
  if (requirements.length > MAX_CANONICAL_REQUIREMENTS) {
    return { valid: false, reason: `Too many requirements (max ${MAX_CANONICAL_REQUIREMENTS}).` };
  }

  for (const req of requirements) {
    if (!req || typeof req !== "object") {
      return { valid: false, reason: "A requirement entry is malformed." };
    }
    if (!isNonEmptyString(req.requirement) || req.requirement.length > MAX_REQUIREMENT_TEXT_LENGTH) {
      return { valid: false, reason: "A requirement's text is missing, empty, or too long." };
    }
    if (!isValidPriority(req.priority)) {
      return { valid: false, reason: "A requirement's priority is invalid." };
    }
    if (!isValidSources(req.sources)) {
      return { valid: false, reason: "A requirement's sources are missing, invalid, or contain duplicates." };
    }
    if (!Array.isArray(req.components) || req.components.length === 0) {
      return { valid: false, reason: "A requirement has no components." };
    }
    if (req.components.length > MAX_COMPONENTS_PER_REQUIREMENT) {
      return { valid: false, reason: `A requirement has too many components (max ${MAX_COMPONENTS_PER_REQUIREMENT}).` };
    }
    for (const c of req.components) {
      if (!isNonEmptyString(c) || c.length > MAX_COMPONENT_TEXT_LENGTH) {
        return { valid: false, reason: "A component's text is missing, empty, or too long." };
      }
    }
  }

  return { valid: true, data: requirements };
}

/**
 * Assigns stable server-side IDs to a validated fresh requirement list,
 * producing the shape that's cached by the frontend and sent to Stage B:
 * { requirements: [{ id, requirement, priority?, sources?, components: [{ id, text }] }] }
 * IDs are assigned here, not by the model, so they're guaranteed unique
 * and well-formed. priority/sources pass through unchanged (already
 * validated) — normalized to absent-if-not-provided.
 */
function assignCanonicalRequirementIds(requirements) {
  return {
    requirements: requirements.map((req, i) => {
      const reqId = `REQ-${i + 1}`;
      const withIds = {
        id: reqId,
        requirement: req.requirement.trim(),
        components: req.components.map((text, j) => ({
          id: `${reqId}-C${j + 1}`,
          text: text.trim(),
        })),
      };
      if (req.priority !== undefined) withIds.priority = req.priority;
      if (req.sources !== undefined) withIds.sources = req.sources;
      return withIds;
    }),
  };
}

/**
 * Validates canonical requirements RESENT BY THE FRONTEND — untrusted
 * client input, already in the ID-bearing shape from a previous
 * response. Layered on top of the same content limits as the fresh
 * path: payload size, ID format, ID uniqueness, and no unexpected
 * properties, since this data did not just come from our own model call
 * and could have been edited/corrupted/tampered with client-side.
 *
 * This does NOT check whether the requirements correspond to the
 * current job-side inputs — that's the separate fingerprint-binding
 * check in the route, done before this function is ever called.
 */
function validateCachedCanonicalRequirements(raw) {
  let serializedSize;
  try {
    serializedSize = Buffer.byteLength(JSON.stringify(raw), "utf8");
  } catch {
    return { valid: false, reason: "canonicalRequirements is not serializable." };
  }
  if (serializedSize > MAX_CANONICAL_REQUIREMENTS_PAYLOAD_BYTES) {
    return { valid: false, reason: "canonicalRequirements payload is too large." };
  }

  if (!raw || typeof raw !== "object" || !Array.isArray(raw.requirements)) {
    return { valid: false, reason: "requirements is missing or not an array." };
  }
  const { requirements } = raw;
  if (requirements.length === 0 || requirements.length > MAX_CANONICAL_REQUIREMENTS) {
    return { valid: false, reason: "requirements length is out of bounds." };
  }
  const extraTopKeys = Object.keys(raw).filter((k) => k !== "requirements");
  if (extraTopKeys.length) {
    return { valid: false, reason: "Unexpected top-level properties." };
  }

  const reqIdPattern = /^REQ-\d+$/;
  const compIdPattern = /^REQ-\d+-C\d+$/;
  const seenReqIds = new Set();
  const seenCompIds = new Set();
  const allowedReqKeys = new Set(["id", "requirement", "components", "priority", "sources"]);
  const allowedCompKeys = new Set(["id", "text"]);

  for (const req of requirements) {
    if (!req || typeof req !== "object") {
      return { valid: false, reason: "A requirement entry is malformed." };
    }
    if (typeof req.id !== "string" || !reqIdPattern.test(req.id)) {
      return { valid: false, reason: "A requirement id is missing or malformed." };
    }
    if (seenReqIds.has(req.id)) {
      return { valid: false, reason: "Duplicate requirement id." };
    }
    seenReqIds.add(req.id);

    if (!isNonEmptyString(req.requirement) || req.requirement.length > MAX_REQUIREMENT_TEXT_LENGTH) {
      return { valid: false, reason: "A requirement's text is missing, empty, or too long." };
    }
    if (!isValidPriority(req.priority)) {
      return { valid: false, reason: "A requirement's priority is invalid." };
    }
    if (!isValidSources(req.sources)) {
      return { valid: false, reason: "A requirement's sources are missing, invalid, or contain duplicates." };
    }
    if (!Array.isArray(req.components) || req.components.length === 0 || req.components.length > MAX_COMPONENTS_PER_REQUIREMENT) {
      return { valid: false, reason: "A requirement's components are missing or out of bounds." };
    }

    for (const c of req.components) {
      if (!c || typeof c !== "object") {
        return { valid: false, reason: "A component entry is malformed." };
      }
      if (typeof c.id !== "string" || !compIdPattern.test(c.id)) {
        return { valid: false, reason: "A component id is missing or malformed." };
      }
      if (seenCompIds.has(c.id)) {
        return { valid: false, reason: "Duplicate component id." };
      }
      seenCompIds.add(c.id);
      if (!isNonEmptyString(c.text) || c.text.length > MAX_COMPONENT_TEXT_LENGTH) {
        return { valid: false, reason: "A component's text is missing, empty, or too long." };
      }
      const extraCompKeys = Object.keys(c).filter((k) => !allowedCompKeys.has(k));
      if (extraCompKeys.length) {
        return { valid: false, reason: "A component has unexpected properties." };
      }
    }

    const extraReqKeys = Object.keys(req).filter((k) => !allowedReqKeys.has(k));
    if (extraReqKeys.length) {
      return { valid: false, reason: "A requirement has unexpected properties." };
    }
  }

  return { valid: true, data: { requirements } };
}

module.exports = {
  validateFreshCanonicalRequirements,
  assignCanonicalRequirementIds,
  validateCachedCanonicalRequirements,
};
