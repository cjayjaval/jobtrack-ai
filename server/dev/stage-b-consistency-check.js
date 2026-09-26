#!/usr/bin/env node
/**
 * DEVELOPMENT-ONLY TOOL — not part of the production request path.
 *
 * Measures Stage B (resume-evidence classification) consistency in
 * isolation: fixed resume + fixed canonical requirements (from
 * server/dev/stage-b-fixture.js), run through Stage B repeatedly. Stage
 * A is never involved — this file does not import canonicalizeRequirements
 * anywhere, so there is no code path here that could regenerate
 * canonical requirements even by mistake. Any variation this harness
 * observes can only come from Stage B itself.
 *
 * It calls the exact same production functions the real API route
 * (server/routes/analyzeJobMatch.js) uses, in the same order, with none
 * of them reimplemented here:
 *   aiService.evaluateComponents()
 *   schemaValidator.validateComponentEvaluationResponse()
 *   rollup.validateComponentCoverage()
 *   rollup.rollupRequirements()
 *   scoring.calculateMatchScore()
 *
 * USAGE (from inside the server/ directory):
 *   node dev/stage-b-consistency-check.js
 *   node dev/stage-b-consistency-check.js --runs=10
 *
 * REQUIRES: server/dev/stage-b-fixture.js filled in with a real resume
 * and real canonical requirements (see that file's instructions), and a
 * real OPENAI_API_KEY already configured in server/.env. Makes REAL
 * Stage B API calls — one per run.
 */

require("dotenv").config();
const { evaluateComponents } = require("../services/aiService");
const { validateComponentEvaluationResponse } = require("../utils/schemaValidator");
const { rollupRequirements, validateComponentCoverage } = require("../utils/rollup");
const { calculateMatchScore } = require("../utils/scoring");
const fixture = require("./stage-b-fixture");

function parseRunCount() {
  const arg = process.argv.find((a) => a.startsWith("--runs="));
  if (!arg) return 5;
  const raw = arg.split("=")[1];
  const n = parseInt(raw, 10);
  if (!Number.isInteger(n) || n <= 0 || String(n) !== raw.trim()) {
    console.error(`Invalid --runs value: "${raw}". It must be a positive integer (e.g. --runs=10).`);
    process.exit(1);
  }
  return n;
}

function assertFixtureIsFilledIn() {
  if (typeof fixture.resumeText !== "string" || fixture.resumeText.includes("<PASTE") || fixture.resumeText.trim().length === 0) {
    console.error("server/dev/stage-b-fixture.js: resumeText is still a placeholder. Fill it in (see that file's instructions) before running this harness.");
    process.exit(1);
  }
  if (
    typeof fixture.canonicalRequirements !== "object" ||
    fixture.canonicalRequirements === null ||
    !Array.isArray(fixture.canonicalRequirements.requirements) ||
    fixture.canonicalRequirements.requirements.length === 0
  ) {
    console.error("server/dev/stage-b-fixture.js: canonicalRequirements is still a placeholder (or malformed). Fill it in (see that file's instructions) before running this harness.");
    process.exit(1);
  }
}

/**
 * Builds requirement-text -> id and componentId -> requirementId lookup
 * maps from the fixed canonical requirements. rollup.js's own output
 * (requirementsMet/partialMatches/missingRequirements) only carries
 * requirement TEXT, not id — this harness reattaches the id itself,
 * without touching rollup.js, by matching on that text.
 *
 * SAFETY CHECK: if two requirements share identical text, that matching
 * would be ambiguous and could silently misattribute a classification
 * to the wrong requirement. This fails loudly instead, before any API
 * call is made.
 */
function buildLookupMaps(canonicalRequirements) {
  const textToId = new Map();
  const componentIdToReqId = new Map();
  const duplicates = [];

  canonicalRequirements.requirements.forEach((req) => {
    if (textToId.has(req.requirement)) {
      duplicates.push({ text: req.requirement, firstId: textToId.get(req.requirement), secondId: req.id });
    } else {
      textToId.set(req.requirement, req.id);
    }
    (req.components || []).forEach((c) => componentIdToReqId.set(c.id, req.id));
  });

  if (duplicates.length > 0) {
    console.error("\nFATAL: duplicate requirement text found in the fixed canonical requirements.");
    console.error("This harness identifies requirements by matching rollup's output (text-only) back to");
    console.error("their canonical ID. Duplicate requirement text makes that matching ambiguous, which");
    console.error("could silently misattribute a classification to the wrong requirement. Refusing to run.\n");
    duplicates.forEach((d) => {
      console.error(`  "${d.text}"  ->  ${d.firstId}  AND  ${d.secondId}`);
    });
    process.exit(1);
  }

  return { textToId, componentIdToReqId };
}

async function runOnce(runNumber, canonicalRequirements, resumeText, lookup) {
  console.log(`\n=========================== Run ${runNumber} ===========================`);

  let rawEvaluation;
  try {
    rawEvaluation = await evaluateComponents(resumeText, canonicalRequirements);
  } catch (err) {
    console.error(`Run ${runNumber} FAILED (Stage B call error): ${err.message}`);
    return { runNumber, failed: true, reason: `call error: ${err.message}` };
  }

  const evaluationValidation = validateComponentEvaluationResponse(rawEvaluation);
  if (!evaluationValidation.valid) {
    console.error(`Run ${runNumber} FAILED (invalid Stage B response shape): ${evaluationValidation.reason}`);
    return { runNumber, failed: true, reason: `invalid response shape: ${evaluationValidation.reason}` };
  }

  const coverage = validateComponentCoverage(canonicalRequirements, evaluationValidation.data.componentEvaluations);
  if (!coverage.valid) {
    console.error(`Run ${runNumber} FAILED (component coverage mismatch): ${coverage.reason}`);
    return { runNumber, failed: true, reason: `coverage mismatch: ${coverage.reason}` };
  }

  const { requirementsMet, partialMatches, missingRequirements } = rollupRequirements(
    canonicalRequirements,
    evaluationValidation.data.componentEvaluations
  );
  const scoreResult = calculateMatchScore(requirementsMet, partialMatches, missingRequirements);

  // Per-requirement-id status for this run (see buildLookupMaps above).
  const statusById = new Map();
  requirementsMet.forEach((item) => statusById.set(lookup.textToId.get(item.requirement), "Met"));
  partialMatches.forEach((item) => statusById.set(lookup.textToId.get(item.requirement), "Partial"));
  missingRequirements.forEach((item) => statusById.set(lookup.textToId.get(item.requirement), "Missing"));

  // Per-component support for this run, straight from the validated raw response.
  const componentSupportById = new Map();
  evaluationValidation.data.componentEvaluations.forEach((ev) => {
    componentSupportById.set(ev.componentId, { supported: ev.supported, evidence: ev.evidence });
  });

  console.log(`Total canonical requirements: ${canonicalRequirements.requirements.length}`);
  console.log(`Met: ${requirementsMet.length}   Partial: ${partialMatches.length}   Missing: ${missingRequirements.length}`);
  console.log(
    `Core: ${scoreResult.core.earnedPoints} / ${scoreResult.core.count}  ` +
      `(${scoreResult.core.coveragePercent === null ? "N/A" : scoreResult.core.coveragePercent.toFixed(2) + "%"})`
  );
  console.log(
    `NTH:  ${scoreResult.nth.earnedPoints} / ${scoreResult.nth.count}  ` +
      `(${scoreResult.nth.coveragePercent === null ? "N/A" : scoreResult.nth.coveragePercent.toFixed(2) + "%"})`
  );
  console.log(`Model D score: ${scoreResult.matchScore === null ? "N/A" : scoreResult.matchScore.toFixed(2) + "%"}`);

  return {
    runNumber,
    failed: false,
    requirementsMet,
    partialMatches,
    missingRequirements,
    statusById,
    componentSupportById,
    scoreResult,
  };
}

function printRequirementComparison(canonicalRequirements, allResults) {
  console.log("\n=========================== Requirement-by-Requirement Comparison ===========================");

  const successful = allResults.filter((r) => !r.failed);
  const unstable = [];

  canonicalRequirements.requirements.forEach((req) => {
    const statuses = successful.map((r) => ({ runNumber: r.runNumber, status: r.statusById.get(req.id) || "MISSING" }));
    const isStable = statuses.every((s) => s.status === statuses[0].status);

    console.log(`\n${req.id}`);
    console.log(`"${req.requirement}"`);
    statuses.forEach((s) => console.log(`Run ${s.runNumber}: ${s.status}`));
    console.log(`Status: ${isStable ? "STABLE" : "UNSTABLE"}`);

    if (!isStable) {
      unstable.push({ id: req.id, text: req.requirement });

      console.log(`\n${req.id} — component-level detail:`);
      (req.components || []).forEach((c) => {
        const perRun = successful.map((r) => ({ runNumber: r.runNumber, entry: r.componentSupportById.get(c.id) }));
        const supportedValues = perRun.map((p) => (p.entry ? p.entry.supported : null));
        const allSame = supportedValues.every((v) => v === supportedValues[0]);

        console.log(`\n  ${c.id}: "${c.text}"`);
        perRun.forEach((p) => {
          console.log(p.entry ? `    Run ${p.runNumber}: supported=${p.entry.supported}` : `    Run ${p.runNumber}: MISSING`);
        });

        if (!allSame) {
          console.log("    -> support flipped across runs (this is the component driving the instability above)");
          perRun.forEach((p) => {
            if (p.entry && p.entry.evidence) console.log(`       Run ${p.runNumber} evidence: ${p.entry.evidence}`);
          });
        } else {
          console.log("    -> support unchanged across runs for this component");
        }
      });
    }
  });

  return unstable;
}

function printSummary(canonicalRequirements, allResults, unstable) {
  const successful = allResults.filter((r) => !r.failed);
  const failedCount = allResults.length - successful.length;

  console.log("\n=========================== STAGE B CONSISTENCY SUMMARY ===========================\n");
  console.log(`Runs: ${allResults.length} (${successful.length} successful, ${failedCount} failed)`);
  console.log(`Canonical requirements: ${canonicalRequirements.requirements.length}`);

  const stableCount = canonicalRequirements.requirements.length - unstable.length;
  const stablePct = (stableCount / canonicalRequirements.requirements.length) * 100;

  console.log(`\nStable requirements: ${stableCount}`);
  console.log(`Unstable requirements: ${unstable.length}`);
  console.log(`Stable percentage: ${stablePct.toFixed(2)}%`);

  console.log("\nClassification distributions:");
  successful.forEach((r) => {
    console.log(`Run ${r.runNumber}: ${r.requirementsMet.length} Met / ${r.partialMatches.length} Partial / ${r.missingRequirements.length} Missing`);
  });

  console.log("\nCore points:");
  successful.forEach((r) => console.log(`Run ${r.runNumber}: ${r.scoreResult.core.earnedPoints} / ${r.scoreResult.core.count}`));

  console.log("\nNTH points:");
  successful.forEach((r) => console.log(`Run ${r.runNumber}: ${r.scoreResult.nth.earnedPoints} / ${r.scoreResult.nth.count}`));

  console.log("\nModel D scores:");
  successful.forEach((r) =>
    console.log(`Run ${r.runNumber}: ${r.scoreResult.matchScore === null ? "N/A" : r.scoreResult.matchScore.toFixed(2) + "%"}`)
  );

  const validScores = successful.map((r) => r.scoreResult.matchScore).filter((s) => s !== null);
  if (validScores.length > 1) {
    const min = Math.min(...validScores);
    const max = Math.max(...validScores);
    console.log(`\nScore range: ${min.toFixed(2)}% -> ${max.toFixed(2)}%`);
    console.log(`Difference: ${(max - min).toFixed(2)} percentage points`);
  }

  if (unstable.length > 0) {
    console.log("\nUnstable requirements:");
    unstable.forEach((u) => console.log(`  ${u.id}: "${u.text}"`));
  } else if (successful.length > 1) {
    console.log("\nNo unstable requirements detected across successful runs.");
  }
}

async function main() {
  const runCount = parseRunCount();

  assertFixtureIsFilledIn();

  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is not set. Add it to server/.env before running this script.");
    process.exit(1);
  }

  const { canonicalRequirements, resumeText } = fixture;
  const lookup = buildLookupMaps(canonicalRequirements);

  console.log(`Stage B consistency check will perform ${runCount} real AI evaluation calls.`);
  console.log(`Canonical requirements are FIXED (${canonicalRequirements.requirements.length} total) — Stage A will NOT be called.`);

  const allResults = [];
  for (let i = 1; i <= runCount; i++) {
    // Sequential on purpose — easier to read, avoids rate-limit complications.
    const result = await runOnce(i, canonicalRequirements, resumeText, lookup);
    allResults.push(result);
  }

  const successfulCount = allResults.filter((r) => !r.failed).length;
  if (successfulCount === 0) {
    console.error("\nAll runs failed — nothing to compare.");
    process.exit(1);
  }

  const unstable = printRequirementComparison(canonicalRequirements, allResults);
  printSummary(canonicalRequirements, allResults, unstable);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
