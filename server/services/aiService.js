/**
 * AI provider abstraction. The route only ever calls
 * canonicalizeRequirements()/evaluateComponents() here — which provider
 * actually handles them is decided by the AI_PROVIDER environment
 * variable. This is what lets Anthropic or Gemini be added later as a
 * sibling provider module without touching the route, the frontend, or
 * the API contract.
 */

function loadProvider() {
  const provider = process.env.AI_PROVIDER || "openai";
  switch (provider) {
    case "openai":
      return require("../providers/openaiProvider");
    // Future providers plug in here, e.g.:
    // case "anthropic": return require("../providers/anthropicProvider");
    // case "gemini": return require("../providers/geminiProvider");
    default:
      throw new Error(`Unsupported AI_PROVIDER: "${provider}"`);
  }
}

async function canonicalizeRequirements(jobDescription, requiredSkills, requiredSkillsOther, niceToHaveSkills, niceToHaveSkillsOther) {
  const provider = loadProvider();
  return provider.canonicalizeRequirements(jobDescription, requiredSkills, requiredSkillsOther, niceToHaveSkills, niceToHaveSkillsOther);
}

async function evaluateComponents(resumeText, canonicalRequirements) {
  const provider = loadProvider();
  return provider.evaluateComponents(resumeText, canonicalRequirements);
}

module.exports = { canonicalizeRequirements, evaluateComponents };
