#!/usr/bin/env node
/**
 * DEVELOPMENT-ONLY TOOL — not part of the production request path.
 *
 * Calls Stage A (canonicalizeRequirements) directly, repeatedly, against
 * the exact same job-side input, completely bypassing:
 *   - the canonical-requirements cache/fingerprint check
 *   - the Express route (server/routes/analyzeJobMatch.js)
 *   - Stage B
 *   - the frontend
 *
 * This exists because normal Re-analyze clicks reuse a cached canonical
 * requirement list whenever the job-side fingerprint matches, which
 * hides Stage A's own run-to-run variability. This script is the only
 * way to actually observe several FRESH Stage A generations side by
 * side for identical input.
 *
 * It does not touch localStorage, application data, or anything the
 * running app depends on — it's a standalone script you run from a
 * terminal, in the server/ directory.
 *
 * USAGE (from inside the server/ directory):
 *   node dev/stage-a-consistency-check.js
 *   node dev/stage-a-consistency-check.js --runs=10
 *
 * REQUIRES: a real OPENAI_API_KEY already configured in server/.env —
 * the same .env the running app already uses. This script never prints
 * the key or any other secret.
 *
 * BEFORE RUNNING: edit the FIXTURE object below to the job description /
 * Required Skills / Nice-to-have Skills combination you want to test.
 */

require("dotenv").config();
const { canonicalizeRequirements } = require("../providers/openaiProvider");

// ---------------------------------------------------------------------
// FIXTURE — identical job-side input used for every run. Edit this block
// only; nothing else in this file needs to change to test a different
// job posting.
// ---------------------------------------------------------------------
const FIXTURE = {
  jobDescription: `Job Responsibilities

Test Planning and Strategy

Develop comprehensive test strategies and test plans to ensure maximum functional coverage
Act as a quality gatekeeper to maintain high standards prior to all software releases
Analyse business requirements and user stories to ensure they are complete and testable
Provide accurate testing estimations and align activities with delivery schedules
Test Execution and Defect Management

Execute manual tests and perform thorough functional, integration, and regression testing
Identify, log, and track software defects with clear reproducible steps and supporting evidence
Verify defect fixes prior to production release and perform thorough retesting
Proactively manage testing risks and escalate critical issues in a timely manner
Collaboration and Agile Delivery

Collaborate closely with developers, business analysts, and project managers
Participate in daily stand-up meetings to report progress, blockers, and testing status
Maintain clear and accurate test documentation, test cases, and regression suites
Support user acceptance testing activities and assist stakeholders as required
Requirements

Minimum 3 years of commercial experience as a Software Test Analyst or QA Analyst
Strong understanding of software testing methodologies, processes, and best practices
Proven ability to analyse business requirements and translate them into test scenarios
Solid experience with defect identification, documentation, tracking, and retesting
Practical experience working within Agile software development environments
Intermediate experience using JIRA or an equivalent defect management system
Excellent analytical, problem-solving, and detailed documentation skills
Nice-to-Have Skills

Prior experience testing financial services, banking, lending, or FinTech applications
Experience with API testing using tools like Postman
Exposure to test automation frameworks or automated testing tools
Basic to intermediate SQL querying skills for data validation
ISTQB Foundation Certificate or an equivalent testing qualification
Familiarity with security testing concepts, data privacy, or AI tools`,
  requiredSkills: [],
  requiredSkillsOther: "",
  niceToHaveSkills: [],
  niceToHaveSkillsOther: "",
};
// ---------------------------------------------------------------------

function parseRunCount() {
  const arg = process.argv.find((a) => a.startsWith("--runs="));
  const n = arg ? parseInt(arg.split("=")[1], 10) : 5;
  return Number.isInteger(n) && n > 0 ? n : 5;
}

function formatRequirement(req, index) {
  const lines = [];
  lines.push(`  ${index + 1}. ${req.requirement}`);
  lines.push(`     priority: ${req.priority}    sources: [${(req.sources || []).join(", ")}]`);
  (req.components || []).forEach((c, i) => {
    lines.push(`       - component ${i + 1}: ${c}`);
  });
  return lines.join("\n");
}

async function runOnce(runNumber) {
  console.log(`\n=========================== Run ${runNumber} ===========================`);
  const start = Date.now();
  const result = await canonicalizeRequirements(
    FIXTURE.jobDescription,
    FIXTURE.requiredSkills,
    FIXTURE.requiredSkillsOther,
    FIXTURE.niceToHaveSkills,
    FIXTURE.niceToHaveSkillsOther
  );
  const elapsedMs = Date.now() - start;

  const requirements = (result && result.requirements) || [];
  console.log(`Requirements: ${requirements.length}   (${elapsedMs}ms)`);
  requirements.forEach((req, i) => console.log(formatRequirement(req, i)));

  return { requirementCount: requirements.length, requirements };
}

async function main() {
  const runs = parseRunCount();

  if (!FIXTURE.jobDescription || FIXTURE.jobDescription.includes("<PASTE THE JOB DESCRIPTION")) {
    console.error("Edit the FIXTURE object at the top of this file (job description and/or skills fields) before running.");
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is not set. Add it to server/.env before running this script.");
    process.exit(1);
  }

  console.log(`Running Stage A (canonicalizeRequirements) FRESH, ${runs} time(s), against identical input.`);
  console.log("No cache, no HTTP server, no Stage B, no frontend involved — this is Stage A in isolation.");

  const summaries = [];
  for (let i = 1; i <= runs; i++) {
    try {
      const summary = await runOnce(i);
      summaries.push(summary);
    } catch (err) {
      console.error(`Run ${i} FAILED:`, err.message);
      summaries.push({ requirementCount: null, requirements: [], failed: true });
    }
  }

  console.log("\n=========================== Summary ===========================");
  summaries.forEach((s, i) => {
    console.log(`Run ${i + 1}: ${s.failed ? "FAILED" : s.requirementCount + " requirements"}`);
  });

  const counts = summaries.filter((s) => !s.failed).map((s) => s.requirementCount);
  if (counts.length > 1) {
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    console.log(`\nRequirement count range across successful runs: ${min}-${max}`);
    console.log(
      min === max
        ? "Count is stable across all runs. Still compare the requirement text/components above for semantic (not just numeric) consistency."
        : "Counts differ across runs — compare the requirement text/components above to judge whether this reflects a genuinely different (but still reasonable) decomposition, or real drift."
    );
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
