/**
 * Lightweight, dependency-free tests for Model D scoring
 * (server/utils/scoring.js). Uses only Node's built-in `assert` — no new
 * testing framework was introduced for this.
 *
 * Run from the server/ directory:
 *   node utils/scoring.test.js
 */

const assert = require("assert");
const { calculateMatchScore } = require("./scoring");

/** Builds n synthetic requirement-result items of a given priority (only .priority is read by scoring.js). */
function items(n, priority) {
  return Array.from({ length: n }, () => ({ priority }));
}

let passCount = 0;
let failCount = 0;

function check(name, actual, expected) {
  try {
    assert.ok(Math.abs(actual - expected) < 0.005, `expected ${expected}, got ${actual}`);
    console.log(`PASS - ${name}`);
    passCount += 1;
  } catch (err) {
    console.error(`FAIL - ${name}: ${err.message}`);
    failCount += 1;
  }
}

function score(requirementsMet, partialMatches, missingRequirements) {
  return calculateMatchScore(requirementsMet, partialMatches, missingRequirements).matchScore;
}

// --- Tests 1-10: normal mode (Core requirements exist) ---
check("TEST 1: Core 10/10, NTH 0/5", score([...items(10, "required")], [], [...items(5, "preferred")]), 100);
check("TEST 2: Core 10/10, NTH 5/5", score([...items(10, "required"), ...items(5, "preferred")], [], []), 100);
check(
  "TEST 3: Core 9/10, NTH 0/5",
  score([...items(9, "required")], [], [items(1, "required")[0], ...items(5, "preferred")]),
  90
);
check(
  "TEST 4: Core 9/10, NTH 5/5",
  score([...items(9, "required"), ...items(5, "preferred")], [], [...items(1, "required")]),
  99
);
check(
  "TEST 5: Core 8/10, NTH 4/5",
  score([...items(8, "required"), ...items(4, "preferred")], [], [...items(2, "required"), ...items(1, "preferred")]),
  92.8
);
check(
  "TEST 6: Core 8/10, NTH 5/5",
  score([...items(8, "required"), ...items(5, "preferred")], [], [...items(2, "required")]),
  96
);
check("TEST 7: Core 5/10, NTH 5/5", score([...items(5, "required"), ...items(5, "preferred")], [], [...items(5, "required")]), 75);
check("TEST 8: Core 0/10, NTH 5/5", score([...items(5, "preferred")], [], [...items(10, "required")]), 0);
check(
  "TEST 9: Core 19/20, NTH 5/5",
  score([...items(19, "required"), ...items(5, "preferred")], [], [...items(1, "required")]),
  99.75
);
check(
  "TEST 10: Core 8 Met/1 Partial/1 Missing, NTH 5/5",
  score([...items(8, "required"), ...items(5, "preferred")], [...items(1, "required")], [...items(1, "required")]),
  97.75
);

// --- Tests 11-12: NTH-only fallback (zero Core requirements) ---
check("TEST 11: Core 0 requirements, NTH 5/5", score([...items(5, "preferred")], [], []), 100);
check(
  "TEST 12: Core 0 requirements, NTH 3 Met/1 Partial/1 Missing",
  score([...items(3, "preferred")], [...items(1, "preferred")], [...items(1, "preferred")]),
  70
);

// --- Test 13: no NTH requirements ---
check("TEST 13: Core 4 Met/1 Partial of 5, NTH 0", score([...items(4, "required")], [...items(1, "required")], []), 90);

// --- Tests 14A/14B: quantity independence ---
check(
  "TEST 14A: Core 8/10, NTH 1/1",
  score([...items(8, "required"), ...items(1, "preferred")], [], [...items(2, "required")]),
  96
);
check(
  "TEST 14B: Core 8/10, NTH 50/50 (must equal 14A)",
  score([...items(8, "required"), ...items(50, "preferred")], [], [...items(2, "required")]),
  96
);

// --- Required invariants A-J ---
check("Invariant A: Core=100% -> 100% regardless of NTH=0%", score([...items(10, "required")], [], [...items(50, "preferred")]), 100);
check(
  "Invariant B: Core<100% -> strictly below 100% even with huge perfect NTH",
  calculateMatchScore([...items(9, "required"), ...items(100, "preferred")], [], [...items(1, "required")]).matchScore < 100 ? 1 : 0,
  1
);
check("Invariant C: Core=0% -> 0% regardless of NTH", score([...items(100, "preferred")], [], [...items(5, "required")]), 0);
check(
  "Invariant D: missing NTH never reduces Core-alone base",
  score([...items(8, "required")], [], [...items(2, "required"), ...items(5, "preferred")]),
  80
);
check(
  "Invariant G: no NTH requirements -> Final = Core coverage exactly",
  score([...items(7, "required")], [], [...items(3, "required")]),
  70
);
check("Invariant H: zero-Core case uses raw NTH coverage directly", score([...items(3, "preferred")], [], [...items(2, "preferred")]), 60);

// --- Edge case: nothing to score at all ---
check("Edge case: 0 Core + 0 NTH -> null, not a manufactured score", calculateMatchScore([], [], []).matchScore === null ? 1 : 0, 1);

console.log(`\n${passCount} passed, ${failCount} failed.`);
if (failCount > 0) process.exit(1);
