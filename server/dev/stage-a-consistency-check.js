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

// Optional. When set, each run's priority distribution (counts of
// required/unspecified/preferred requirements, plus total) is checked
// against this and reported PASS/FAIL, in addition to the existing
// requirement-count comparison. Leave this `null` when testing a
// different fixture you don't have a known-correct distribution for
// yet — the harness still reports each run's actual distribution
// either way, it just skips the pass/fail judgment against an
// expectation that doesn't apply.
const EXPECTED_DISTRIBUTION = {
  required: 7,
  unspecified: 12,
  preferred: 6,
  total: 25,
};

// ---------------------------------------------------------------------
// Optional diagnostic. Distinctive keywords for each source
// Responsibilities bullet in THIS fixture, used to check per-run
// coverage — was this bullet's content found anywhere in the run's
// output, and in how many separate top-level requirements. Diagnostic
// only: it never affects PASS/FAIL against EXPECTED_DISTRIBUTION, and
// it deliberately is NOT a semantic-equivalence checker (that would
// need its own model call, disproportionate for a dev script). It's a
// keyword tripwire — zero matches is worth a look (possibly
// dropped/absorbed), matches in 2+ different top-level requirements is
// worth a look (possibly split) — neither is proof on its own, just a
// pointer to where to look in the full per-run listing already printed
// above it. Leave this an empty array when testing a different
// fixture; it's specific to the Responsibilities bullets in FIXTURE.
//
// Keep each bullet's keywords SHORT and genuinely distinctive within
// this fixture. A keyword that legitimately also belongs to a
// different, unrelated requirement (shared vocabulary, not duplication)
// will produce an expected multi-match here that isn't actually a
// split — for example "retesting" is deliberately excluded below
// because it correctly appears in both the Required-section defect
// bullet and this Responsibilities bullet even in fully correct output.
// ---------------------------------------------------------------------
const SOURCE_BULLET_KEYWORDS = [
  { label: "Develop test strategies/plans for functional coverage", keywords: ["test strategies", "test plans", "functional coverage"] },
  { label: "Act as quality gatekeeper", keywords: ["quality gatekeeper", "high standards"] },
  { label: "Analyse business requirements/user stories (completeness/testability)", keywords: ["user stories", "complete and testable"] },
  { label: "Provide testing estimations, align with delivery schedules", keywords: ["testing estimations", "delivery schedules"] },
  { label: "Execute manual/functional/integration/regression testing", keywords: ["manual test", "integration testing"] },
  { label: "Identify/log/track defects with reproducible steps/evidence", keywords: ["reproducible steps", "supporting evidence"] },
  { label: "Verify defect fixes prior to production release, retest", keywords: ["production release"] },
  { label: "Manage testing risks, escalate issues", keywords: ["testing risks", "escalate"] },
  { label: "Collaborate with developers/BAs/PMs", keywords: ["business analysts", "project managers"] },
  { label: "Participate in daily stand-ups (progress/blockers/status)", keywords: ["stand-up", "blockers"] },
  { label: "Maintain test documentation/cases/regression suites", keywords: ["regression suites", "test cases"] },
  { label: "Support UAT, assist stakeholders", keywords: ["user acceptance", "stakeholders"] },
];

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

/** Tallies required/unspecified/preferred counts from a run's requirements. Anything else (missing/unexpected priority value) is tallied separately as "other" rather than silently miscounted — this harness calls Stage A directly, bypassing the production validator, so a malformed value is possible here in a way it wouldn't be through the real API. */
function computeDistribution(requirements) {
  const distribution = { required: 0, unspecified: 0, preferred: 0, other: 0, total: requirements.length };
  requirements.forEach((req) => {
    if (req.priority === "required") distribution.required += 1;
    else if (req.priority === "unspecified") distribution.unspecified += 1;
    else if (req.priority === "preferred") distribution.preferred += 1;
    else distribution.other += 1;
  });
  return distribution;
}

/** Compares an actual distribution against EXPECTED_DISTRIBUTION on required/unspecified/preferred/total ("other" isn't part of the expectation shape — any nonzero "other" is surfaced separately as a data-quality flag, not folded into this pass/fail). */
function distributionMatchesExpected(actual, expected) {
  return (
    actual.required === expected.required &&
    actual.unspecified === expected.unspecified &&
    actual.preferred === expected.preferred &&
    actual.total === expected.total
  );
}

function formatDistribution(d) {
  const base = `required=${d.required} unspecified=${d.unspecified} preferred=${d.preferred} (total=${d.total})`;
  return d.other > 0 ? `${base} — ${d.other} with an unexpected/missing priority value` : base;
}

/**
 * Diagnostic only — see SOURCE_BULLET_KEYWORDS above for why this is a
 * keyword tripwire, not a semantic-equivalence check, and never affects
 * PASS/FAIL. For each entry, finds every top-level requirement in this
 * run whose title or any component text contains at least one of that
 * entry's keywords (case-insensitive substring match).
 */
function checkBulletCoverage(requirements) {
  if (!SOURCE_BULLET_KEYWORDS || SOURCE_BULLET_KEYWORDS.length === 0) return null;

  return SOURCE_BULLET_KEYWORDS.map((bullet) => {
    const matchedIndexes = [];
    requirements.forEach((req, i) => {
      const haystack = [req.requirement, ...(req.components || [])].join(" ").toLowerCase();
      const hasMatch = bullet.keywords.some((kw) => haystack.includes(kw.toLowerCase()));
      if (hasMatch) matchedIndexes.push(i + 1); // 1-based, matches the printed requirement numbering
    });
    return { label: bullet.label, matchedIndexes };
  });
}

function formatBulletCoverage(coverageResults) {
  if (!coverageResults) return "";
  const lines = ["Source-bullet coverage (diagnostic only — does not affect PASS/FAIL):"];
  coverageResults.forEach((c) => {
    if (c.matchedIndexes.length === 0) {
      lines.push(`  [possibly dropped/absorbed] "${c.label}" — no match in any requirement.`);
    } else if (c.matchedIndexes.length > 1) {
      lines.push(`  [possibly split] "${c.label}" — matched requirements #${c.matchedIndexes.join(", #")}.`);
    } else {
      lines.push(`  [ok] "${c.label}" — matched requirement #${c.matchedIndexes[0]}.`);
    }
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
  const distribution = computeDistribution(requirements);
  console.log(`Requirements: ${requirements.length}   (${elapsedMs}ms)`);
  console.log(`Distribution: ${formatDistribution(distribution)}`);
  if (EXPECTED_DISTRIBUTION) {
    const matches = distributionMatchesExpected(distribution, EXPECTED_DISTRIBUTION);
    console.log(`Distribution check: ${matches ? "PASS" : "FAIL"} (expected ${formatDistribution({ ...EXPECTED_DISTRIBUTION, other: 0 })})`);
  }
  const bulletCoverage = checkBulletCoverage(requirements);
  if (bulletCoverage) {
    console.log(formatBulletCoverage(bulletCoverage));
  }
  requirements.forEach((req, i) => console.log(formatRequirement(req, i)));

  return { requirementCount: requirements.length, requirements, distribution, bulletCoverage };
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
      summaries.push({ requirementCount: null, requirements: [], distribution: null, bulletCoverage: null, failed: true });
    }
  }

  console.log("\n=========================== Summary ===========================");
  summaries.forEach((s, i) => {
    console.log(`Run ${i + 1}: ${s.failed ? "FAILED" : s.requirementCount + " requirements"}`);
  });

  const successful = summaries.filter((s) => !s.failed);
  const counts = successful.map((s) => s.requirementCount);
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

  // Two distinct questions, reported separately: did every run produce
  // the SAME distribution as every other run (stability — a property of
  // the runs relative to each other, meaningful with or without a known
  // correct answer), and did each run's distribution match the KNOWN
  // correct one for this fixture (correctness — only checkable when
  // EXPECTED_DISTRIBUTION is set). A stable-but-wrong result and an
  // unstable-but-sometimes-right result are both real, different
  // failure modes; collapsing them into one pass/fail would hide which
  // one you're looking at.
  if (successful.length > 0) {
    console.log("\n--- Distribution stability (relative to each other) ---");
    const first = successful[0].distribution;
    const allSameDistribution = successful.every(
      (s) =>
        s.distribution.required === first.required &&
        s.distribution.unspecified === first.unspecified &&
        s.distribution.preferred === first.preferred &&
        s.distribution.total === first.total
    );
    successful.forEach((s, i) => console.log(`Run ${i + 1}: ${formatDistribution(s.distribution)}`));
    console.log(allSameDistribution ? "STABLE — identical distribution on every successful run." : "UNSTABLE — distribution differs across runs.");

    if (EXPECTED_DISTRIBUTION) {
      console.log(`\n--- Distribution correctness (vs. expected ${formatDistribution({ ...EXPECTED_DISTRIBUTION, other: 0 })}) ---`);
      const correctCount = successful.filter((s) => distributionMatchesExpected(s.distribution, EXPECTED_DISTRIBUTION)).length;
      successful.forEach((s, i) => {
        const matches = distributionMatchesExpected(s.distribution, EXPECTED_DISTRIBUTION);
        console.log(`Run ${i + 1}: ${matches ? "PASS" : "FAIL"}`);
      });
      console.log(`${correctCount} / ${successful.length} runs matched the expected distribution.`);
      console.log(
        correctCount === successful.length
          ? "CORRECT — every successful run matched the expected distribution."
          : "INCORRECT on at least one run — see the FAIL lines above and the full per-run requirement listings for what differed."
      );
    } else {
      console.log("\n(EXPECTED_DISTRIBUTION is not set for this fixture — reporting stability only, no correctness judgment to make.)");
    }

    if (SOURCE_BULLET_KEYWORDS && SOURCE_BULLET_KEYWORDS.length > 0) {
      console.log("\n--- Source-bullet coverage across runs (diagnostic only) ---");
      SOURCE_BULLET_KEYWORDS.forEach((bullet, bulletIndex) => {
        const perRunMatchCounts = successful.map((s) => (s.bulletCoverage ? s.bulletCoverage[bulletIndex].matchedIndexes.length : null));
        const flagged = perRunMatchCounts.some((n) => n === 0 || n > 1);
        const summaryLine = perRunMatchCounts.map((n, i) => `Run ${i + 1}: ${n}`).join("   ");
        console.log(`${flagged ? "[flagged in at least one run]" : "[consistent every run]"} "${bullet.label}"`);
        console.log(`  match count per run — ${summaryLine}`);
      });
    }
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
