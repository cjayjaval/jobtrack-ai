/* =========================================================
   JobTrack AI — js/resume.js (Phase 2: AI Job Match)
   Handles:
   - Resume upload / replace / remove, with client-side PDF text
     extraction via pdf.js (the raw PDF file itself is never sent
     anywhere — only the extracted text, and only when the user
     clicks Analyze).
   - Rendering the "AI Job Match" section inside Application Details.
   - Calling the backend to analyze / re-analyze a job match.
   - Persisting analysis results into the relevant application record.

   This file is loaded AFTER script.js and deliberately reuses its
   top-level bindings (applications, saveApplications, escapeHtml,
   STORAGE_KEY) rather than duplicating them — classic <script> tags
   share one global scope, so this works as long as load order is
   preserved in index.html.
   ========================================================= */

/* ---------------------------------------------------------
   1. CONFIG
   --------------------------------------------------------- */

// Points at the local dev backend by default. For a deployed Render URL,
// set window.JOBTRACK_AI_BACKEND_URL before this script runs (e.g. in a
// small inline <script> in index.html) rather than editing this file —
// keeps the backend URL configurable instead of hard-coded.
const AI_BACKEND_URL = window.JOBTRACK_AI_BACKEND_URL || "http://localhost:3000";

const RESUME_STORAGE_KEY = "jobtrackai_resume";

// Represents JobTrack AI's own analysis pipeline (Stage A/B/rollup/Model D
// wiring) — NOT the OpenAI model version, which is configured server-side.
// Bump this if the analysis pipeline itself changes in a way that means
// an old saved result should no longer be treated as current.
const ANALYSIS_VERSION = "0.3.0";

const MAX_RESUME_FILE_SIZE = 5 * 1024 * 1024; // 5 MB — generous for a text-based PDF resume
// Keep in sync with server/utils/limits.js — enforced again server-side regardless.
const MAX_RESUME_TEXT_LENGTH = 15000;
const MIN_RESUME_TEXT_LENGTH = 20;

if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

/* ---------------------------------------------------------
   2. RESUME STORAGE (separate from application data — a resume is a
      reusable asset, not tied to one specific application)
   --------------------------------------------------------- */

function loadResume() {
  try {
    const raw = localStorage.getItem(RESUME_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error("Could not read saved resume:", err);
    return null;
  }
}

function saveResume(resume) {
  try {
    localStorage.setItem(RESUME_STORAGE_KEY, JSON.stringify(resume));
    return true;
  } catch (err) {
    console.error("Could not save resume:", err);
    return false;
  }
}

function removeResume() {
  try {
    localStorage.removeItem(RESUME_STORAGE_KEY);
    return true;
  } catch (err) {
    console.error("Could not remove resume:", err);
    return false;
  }
}

/* ---------------------------------------------------------
   3. PDF TEXT EXTRACTION (client-side, via pdf.js)
   --------------------------------------------------------- */

async function extractTextFromPdf(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let text = "";
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => item.str).join(" ");
    text += pageText + "\n";
  }
  return text.trim();
}

/* ---------------------------------------------------------
   4. RESUME UPLOAD HANDLING
   --------------------------------------------------------- */

async function handleResumeFileSelected(file) {
  if (!file) return;

  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    showResumeError("Only PDF resume files are supported.");
    return;
  }
  if (file.size === 0) {
    showResumeError("That file appears to be empty.");
    return;
  }
  if (file.size > MAX_RESUME_FILE_SIZE) {
    showResumeError("That PDF is too large (max 5 MB). Please upload a smaller file.");
    return;
  }

  setResumeStatus("Reading resume…", false);

  let text;
  try {
    text = await extractTextFromPdf(file);
  } catch (err) {
    console.error("PDF extraction failed:", err);
    showResumeError("This PDF couldn't be read. It may be corrupted.");
    return;
  }

  if (!text || text.trim().length < MIN_RESUME_TEXT_LENGTH) {
    showResumeError("No readable text was found in this PDF. Scanned/image-only PDFs aren't supported yet.");
    return;
  }

  if (text.length > MAX_RESUME_TEXT_LENGTH) {
    showResumeError(
      `This resume's text is too long (${text.length.toLocaleString()} characters, max ${MAX_RESUME_TEXT_LENGTH.toLocaleString()}). Truncating it could cut off real experience/skills, so please shorten the PDF and try again.`
    );
    return;
  }

  const resume = {
    filename: file.name,
    text: text,
    textLength: text.length,
    uploadedAt: new Date().toISOString(),
  };

  const saved = saveResume(resume);
  if (!saved) {
    showResumeError("Couldn't save the resume — your browser's storage may be full or unavailable.");
    return;
  }

  setResumeStatus("", false);
}

function setResumeStatus(message, isError) {
  const statusEl = document.getElementById("resumeUploadStatus");
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.toggle("form-msg--error", !!isError);
}

function showResumeError(message) {
  setResumeStatus(message, true);
}

/* ---------------------------------------------------------
   5. LIGHTWEIGHT CHANGE-DETECTION (for "may be outdated" notices)
   --------------------------------------------------------- */

// Not cryptographic — just enough to notice "this text changed" without
// storing/comparing full text twice. Used internally by
// computeJobSideInputFingerprint() below, which is what actually drives
// both the staleness notice and cache binding now — see that function's
// comment for why a JD-only hash isn't used on its own anymore.
//
// MUST stay byte-for-byte identical to simpleHash() in server/utils/hash.js.
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
 * in server/utils/hash.js — the backend independently recomputes this
 * same fingerprint from the job-side inputs actually in a request to
 * verify that cached canonicalRequirements we resend correspond to the
 * current job description + Required Skills + Nice-to-have Skills, not
 * a stale combination (the two-stage AI Job Match cache-binding check).
 * If you change this, change the server copy to match, exactly, in the
 * same change.
 *
 * Fingerprints the STRUCTURED underlying fields (the skills arrays and
 * their separate "Other" free-text values) rather than a pre-combined
 * display string, so a comma inside an "Other" value is never
 * reinterpreted as a skill boundary.
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

/**
 * Fingerprints the extracted resume TEXT actually sent for analysis —
 * never the raw PDF bytes (those never leave the browser at all, and
 * this file never sees them either; extraction already happened by the
 * time this runs). Re-uploading a resume whose extracted text comes out
 * identical produces the identical fingerprint, even though its
 * `uploadedAt` timestamp changed — that distinction is the whole point:
 * this is what lets "analysis is current" mean "the actual text is
 * unchanged," not "you haven't touched the upload button since."
 */
function computeResumeFingerprint(resumeText) {
  return simpleHash((resumeText || "").trim());
}

/* ---------------------------------------------------------
   6. PERSISTING ANALYSIS RESULTS ONTO AN APPLICATION
   --------------------------------------------------------- */

function persistAiAnalysis(appId, aiAnalysis) {
  const updated = applications.map((a) => (a.id === appId ? { ...a, aiAnalysis } : a));
  const saved = saveApplications(updated);
  if (saved) applications = updated;
  return saved;
}

/* ---------------------------------------------------------
   7. RENDERING — AI Job Match section in Application Details
   --------------------------------------------------------- */

let isAnalyzing = false;

/**
 * A job description is no longer required on its own — Required Skills
 * or Nice-to-have Skills can supply the job-side substance instead (a
 * one-word JD like "JIRA" plus a populated Required Skills list is a
 * perfectly analyzable combination). This checks whether ANY job-side
 * input has something in it, matching the backend's own combined check.
 */
function hasJobSideInput(app) {
  return !!(
    (app.jobDescription && app.jobDescription.trim()) ||
    (app.requiredSkills && app.requiredSkills.length) ||
    (app.requiredSkillsOther && app.requiredSkillsOther.trim()) ||
    (app.niceToHaveSkills && app.niceToHaveSkills.length) ||
    (app.niceToHaveSkillsOther && app.niceToHaveSkillsOther.trim())
  );
}

function renderAiJobMatchSection(app) {
  const container = document.getElementById("aiMatchBody");
  if (!container) return;

  const resume = loadResume();
  const hasJobSide = hasJobSideInput(app);

  container.innerHTML = `
    <h3 class="ai-match__title">AI Job Match</h3>

    <div class="ai-match__resume-row">
      <div class="ai-match__resume-info">
        <span class="ai-match__resume-label">Resume:</span>
        <span id="resumeFilenameDisplay">${resume ? escapeHtml(resume.filename) : "No resume uploaded"}</span>
      </div>
      <div class="ai-match__resume-actions">
        <button type="button" class="btn btn--ghost btn--small" id="resumeUploadBtn">${resume ? "Replace" : "Upload"}</button>
        <input type="file" id="resumeFileInput" accept="application/pdf,.pdf" hidden>
        ${resume ? `<button type="button" class="btn btn--text btn--small" id="removeResumeBtn">Remove</button>` : ""}
      </div>
    </div>
    <p class="ai-match__resume-hint">PDF files only.</p>
    <p class="form-msg" id="resumeUploadStatus" role="status"></p>

    ${hasJobSide
      ? `<p class="form-msg" id="aiMatchStatus" role="status"></p><div id="aiMatchResultsWrap"></div>`
      : `<p class="ai-match__notice">This application doesn't have a job description or any listed skills to analyze yet — add one by editing the application.</p>`
    }
  `;

  // Resume upload/replace — a real <button> triggers the hidden file
  // input, so this control is reachable and operable by keyboard (a
  // bare <label> is not focusable on its own).
  document.getElementById("resumeUploadBtn").addEventListener("click", () => {
    document.getElementById("resumeFileInput").click();
  });
  document.getElementById("resumeFileInput").addEventListener("change", async (event) => {
    await handleResumeFileSelected(event.target.files[0]);
    const latestApp = applications.find((a) => a.id === app.id) || app;
    renderAiJobMatchSection(latestApp);
  });

  // Resume removal
  const removeBtn = document.getElementById("removeResumeBtn");
  if (removeBtn) {
    removeBtn.addEventListener("click", () => {
      removeResume();
      renderAiJobMatchSection(app);
    });
  }

  if (hasJobSide) {
    renderAnalyzeControlsAndResults(document.getElementById("aiMatchResultsWrap"), app);
  }

  // Content height may have just changed (results appeared/changed, or
  // this section collapsed to just the "no job-side input" notice) —
  // re-check whether the go-to-top control should show. Guarded since
  // this function is defined in script.js, loaded before this file.
  if (typeof updateGoToTopVisibility === "function") updateGoToTopVisibility();
}

/**
 * The single source of truth for whether a saved analysis is current.
 * An analysis is current only when ALL three saved fingerprints/version
 * still match the application's current state:
 *   - the job-side fingerprint (JD + Required/Nice-to-have Skills + Other)
 *   - the resume-content fingerprint (extracted text, not upload time)
 *   - the analysis pipeline version (ANALYSIS_VERSION)
 *
 * An analysis saved before these three fields existed is treated as
 * "legacy," not "stale for a specific reason" — we genuinely don't know
 * whether the resume or job requirements changed, only that this result
 * predates the metadata that would let us tell. Claiming a specific
 * cause (e.g. "resume changed") for a legacy analysis would be a claim
 * we can't actually back up, so it gets its own honest message instead.
 */
function computeAnalysisStatus(app, resume) {
  const analysis = app.aiAnalysis;
  if (!analysis) {
    return { hasAnalysis: false, isCurrent: false, isLegacy: false, staleReasons: [] };
  }

  const isLegacy =
    analysis.analyzedCanonicalRequirementsFingerprint === undefined ||
    analysis.analyzedResumeFingerprint === undefined ||
    analysis.analysisVersion === undefined;

  if (isLegacy) {
    return {
      hasAnalysis: true,
      isCurrent: false,
      isLegacy: true,
      staleReasons: ["This analysis was generated using an earlier version of JobTrack AI. Re-analysis recommended."],
    };
  }

  const currentJobSideFingerprint = computeJobSideInputFingerprint(
    app.jobDescription,
    app.requiredSkills,
    app.requiredSkillsOther,
    app.niceToHaveSkills,
    app.niceToHaveSkillsOther
  );
  const currentResumeFingerprint = resume ? computeResumeFingerprint(resume.text) : null;

  const jobSideChanged = analysis.analyzedCanonicalRequirementsFingerprint !== currentJobSideFingerprint;
  const resumeChanged = analysis.analyzedResumeFingerprint !== currentResumeFingerprint;
  const versionChanged = analysis.analysisVersion !== ANALYSIS_VERSION;
  const isCurrent = !jobSideChanged && !resumeChanged && !versionChanged;

  // One combined message rather than one per cause — with real,
  // current-format data we know something changed, but stacking
  // separate sentences ("...recommended. ...recommended.") reads as
  // repetitive without adding useful information over this single line.
  const staleReasons = isCurrent
    ? []
    : ["Job requirements or resume have changed since the last analysis. Re-analysis recommended."];

  return { hasAnalysis: true, isCurrent, isLegacy: false, staleReasons };
}

function renderAnalyzeControlsAndResults(container, app) {
  const resume = loadResume();
  const analysis = app.aiAnalysis;
  const status = computeAnalysisStatus(app, resume);

  let noticeHtml = "";
  if (status.isCurrent) {
    noticeHtml = `<p class="ai-match__current-notice">Analysis is up to date. No changes to the resume or job requirements since the last analysis.</p>`;
  } else if (status.staleReasons.length) {
    noticeHtml = `<p class="ai-match__stale-notice">${status.staleReasons.map(escapeHtml).join(" ")}</p>`;
  }

  container.innerHTML = `
    <div id="aiMatchContentArea">
      ${analysis ? renderAnalysisResultsHtml(analysis) : ""}
      ${noticeHtml}
    </div>
    <button type="button" class="btn btn--primary${status.isCurrent ? " btn--current-disabled" : ""}" id="analyzeActionBtn"${status.isCurrent ? " disabled" : ""}>
      <span class="ai-match__btn-icon" id="analyzeActionIcon" aria-hidden="true"></span>
      <span id="analyzeActionText">${analysis ? "Re-analyze Job Match" : "Analyze Job Match"}</span>
    </button>
  `;

  // A genuinely `disabled` button never dispatches click events from user
  // interaction — that's what actually prevents an API request while the
  // analysis is current, not extra guard logic in the handler.
  document.getElementById("analyzeActionBtn").addEventListener("click", () => {
    handleAnalyzeClick(app);
  });
}

/** Builds the results markup as a string — every AI-generated field is escaped. */
/**
 * Renders a small Required/Optional badge next to a requirement's title,
 * based on the priority metadata already carried on each rollup result
 * item (see server/utils/rollup.js). The badge communicates which
 * Model D scoring pool a requirement falls into, not the raw Stage A
 * label — "unspecified" is pooled with "required" as Core for scoring
 * (see server/utils/scoring.js), so it displays as "Required" here too,
 * for consistency with what the score actually reflects. This is a
 * presentation-layer mapping only; it does not change Stage A's
 * priority assignment or Model D's scoring itself. A legacy analysis
 * saved before priority was included at all (item.priority undefined)
 * renders no badge — we don't guess a priority the source data doesn't
 * actually establish.
 */
function priorityBadgeHtml(priority) {
  if (priority === "required" || priority === "unspecified") {
    return `<span class="priority-badge priority-badge--required">Required</span>`;
  }
  if (priority === "preferred") return `<span class="priority-badge priority-badge--optional">Optional</span>`;
  return "";
}

function renderAnalysisResultsHtml(analysis) {
  const metItems = analysis.requirementsMet
    .map(
      (item) =>
        `<li><div class="ai-match__req-header"><strong>${escapeHtml(item.requirement)}</strong>${priorityBadgeHtml(item.priority)}</div><span class="ai-match__evidence">${escapeHtml(item.evidence)}</span></li>`
    )
    .join("");

  const partialItems = analysis.partialMatches
    .map(
      (item) =>
        `<li><div class="ai-match__req-header"><strong>${escapeHtml(item.requirement)}</strong>${priorityBadgeHtml(item.priority)}</div><span class="ai-match__evidence">${escapeHtml(item.evidence)}</span><span class="ai-match__gap">Gap: ${escapeHtml(item.gap)}</span></li>`
    )
    .join("");

  const missingItems = analysis.missingRequirements
    .map(
      (item) =>
        `<li><div class="ai-match__req-header"><strong>${escapeHtml(item.requirement)}</strong>${priorityBadgeHtml(item.priority)}</div><span class="ai-match__evidence">${escapeHtml(item.reason)}</span></li>`
    )
    .join("");

  // Old saved analyses predate the Core/Nice-to-Have breakdown and won't
  // have these fields — render nothing for them rather than crashing.
  const core = analysis.core && typeof analysis.core.count === "number" ? analysis.core : null;
  const nth = analysis.nth && typeof analysis.nth.count === "number" ? analysis.nth : null;

  const breakdownItems = [];
  if (core && core.count > 0) {
    breakdownItems.push(
      `<div class="ai-match__breakdown-item">
        <span class="ai-match__breakdown-label">Core Qualifications</span>
        <span class="ai-match__breakdown-points">${escapeHtml(String(core.earnedPoints))} / ${escapeHtml(String(core.count))} points</span>
        <span class="ai-match__breakdown-pct">${core.coveragePercent.toFixed(2)}%</span>
      </div>`
    );
  }
  if (nth && nth.count > 0) {
    breakdownItems.push(
      `<div class="ai-match__breakdown-item">
        <span class="ai-match__breakdown-label">Nice-to-Have</span>
        <span class="ai-match__breakdown-points">${escapeHtml(String(nth.earnedPoints))} / ${escapeHtml(String(nth.count))} points</span>
        <span class="ai-match__breakdown-pct">${nth.coveragePercent.toFixed(2)}%</span>
      </div>`
    );
  }

  return `
    <div class="ai-match__score">
      <div class="ai-match__score-value">${escapeHtml(Number(analysis.matchScore).toFixed(2))}%</div>
      <p class="ai-match__score-note">This percentage reflects how closely the resume's stated experience aligns with this job's stated requirements. It is not a prediction of whether you'll be hired.</p>
      ${breakdownItems.length ? `<div class="ai-match__breakdown">${breakdownItems.join("")}</div>` : ""}
    </div>

    <div class="ai-match__group">
      <h4>Requirements Met</h4>
      ${metItems ? `<ul class="ai-match__list ai-match__list--met">${metItems}</ul>` : `<p class="ai-match__empty">None identified.</p>`}
    </div>

    <div class="ai-match__group">
      <h4>Partial Matches</h4>
      ${partialItems ? `<ul class="ai-match__list ai-match__list--partial">${partialItems}</ul>` : `<p class="ai-match__empty">None identified.</p>`}
    </div>

    <div class="ai-match__group">
      <h4>Missing / Not Evident</h4>
      ${missingItems ? `<ul class="ai-match__list ai-match__list--missing">${missingItems}</ul>` : `<p class="ai-match__empty">None identified.</p>`}
    </div>

    <div class="ai-match__group">
      <h4>Overall Analysis</h4>
      <p>${escapeHtml(analysis.summary)}</p>
    </div>

    <div class="ai-match__meta">
      <span>Resume used: ${escapeHtml(analysis.resumeName || "Unknown")}</span>
      <span>Analyzed: ${escapeHtml(formatDateTime(analysis.analyzedAt))}</span>
    </div>
  `;
}

function formatDateTime(isoString) {
  if (!isoString) return "—";
  const date = new Date(isoString);
  if (isNaN(date)) return isoString;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/* ---------------------------------------------------------
   8. ANALYZE / RE-ANALYZE
   --------------------------------------------------------- */

// How long the brief "✓ Analysis complete" confirmation stays visible
// before the section re-renders with the new results. Short and
// non-blocking — nothing else in the app waits on this timer.
const ANALYZE_SUCCESS_DISPLAY_MS = 700;

/**
 * Swaps the Analyze/Re-analyze button between its loading, success, and
 * idle appearances. Text always stays visible alongside the icon (never
 * relies on the checkmark alone to communicate state), and aria-busy is
 * set only while actually loading. The small icon slot only shows the
 * brief success checkmark now — during loading, the big circular
 * progress card (see startEstimatedProgress) is the primary visual
 * indicator, so this button intentionally stays icon-free rather than
 * showing a second, redundant spinner alongside it.
 */
function setAnalyzeButtonState(state, isReanalyzeHint) {
  const btn = document.getElementById("analyzeActionBtn");
  const iconEl = document.getElementById("analyzeActionIcon");
  const textEl = document.getElementById("analyzeActionText");
  if (!btn || !iconEl || !textEl) return;

  if (state === "loading") {
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    iconEl.innerHTML = "";
    textEl.textContent = "Analyzing…";
  } else if (state === "success") {
    btn.disabled = true;
    btn.removeAttribute("aria-busy");
    iconEl.innerHTML = '<span class="ai-match__check">✓</span>';
    textEl.textContent = "Analysis complete";
  } else {
    btn.disabled = false;
    btn.removeAttribute("aria-busy");
    iconEl.innerHTML = "";
    textEl.textContent = isReanalyzeHint ? "Re-analyze Job Match" : "Analyze Job Match";
  }
}

// Status text rotated through while the estimated progress ring runs.
// UX indicators only — the backend never reports a real "stage."
const PROGRESS_STATUS_MESSAGES = [
  "Analyzing your resume…",
  "Evaluating job requirements…",
  "Comparing supporting evidence…",
  "Calculating match score…",
];

// Estimated UI progress only — the API gives no real completion percentage.
// Never allowed to reach 100% before a real response arrives; a long wait
// creeps toward this cap and stays there rather than faking completion.
const PROGRESS_MAX_WAITING_PERCENT = 90;
const PROGRESS_TICK_MS = 250;
const PROGRESS_MESSAGE_ROTATE_MS = 2200;
const PROGRESS_RING_RADIUS = 45;
const PROGRESS_RING_CIRCUMFERENCE = 2 * Math.PI * PROGRESS_RING_RADIUS;

/**
 * Renders the circular estimated-progress card into `contentArea` and
 * starts advancing it. Returns { finishSuccess, stop } to control it —
 * the caller decides whether the request succeeded or failed; this
 * function only ever knows about elapsed time, never the real backend
 * state.
 *
 * Movement is quick at first and progressively slows as it nears the
 * cap (each tick's step shrinks as the remaining distance to the cap
 * shrinks), and creeps indefinitely near — never at — the cap on a long
 * wait, satisfying "must not reach 100% before a successful response."
 */
function startEstimatedProgress(contentArea) {
  if (!contentArea) return null;

  contentArea.innerHTML = `
    <div class="ai-match__progress" id="aiMatchProgress">
      <p class="ai-match__progress-title">Analyzing Job Match</p>
      <div class="ai-match__progress-ring-wrap">
        <svg class="ai-match__progress-ring" viewBox="0 0 100 100" aria-hidden="true">
          <circle class="ai-match__progress-ring-track" cx="50" cy="50" r="${PROGRESS_RING_RADIUS}"></circle>
          <circle class="ai-match__progress-ring-fill" id="aiMatchProgressRingFill" cx="50" cy="50" r="${PROGRESS_RING_RADIUS}"
            style="stroke-dasharray:${PROGRESS_RING_CIRCUMFERENCE};stroke-dashoffset:${PROGRESS_RING_CIRCUMFERENCE};"></circle>
        </svg>
        <span class="ai-match__progress-pct" id="aiMatchProgressPct">0%</span>
      </div>
      <p class="ai-match__progress-status" id="aiMatchProgressStatus" role="status">${escapeHtml(PROGRESS_STATUS_MESSAGES[0])}</p>
      <p class="ai-match__progress-note">Estimated progress — not a measured backend completion percentage. This may take a few moments.</p>
    </div>
  `;

  const ringEl = document.getElementById("aiMatchProgressRingFill");
  const pctEl = document.getElementById("aiMatchProgressPct");

  function setDisplay(percent) {
    if (pctEl) pctEl.textContent = `${Math.round(percent)}%`;
    if (ringEl) ringEl.style.strokeDashoffset = String(PROGRESS_RING_CIRCUMFERENCE * (1 - percent / 100));
  }

  let percent = 0;
  let messageIndex = 0;

  const tickInterval = setInterval(() => {
    const remaining = PROGRESS_MAX_WAITING_PERCENT - percent;
    if (remaining <= 0.5) {
      percent = PROGRESS_MAX_WAITING_PERCENT; // creep-cap: stay here, never advance past it on our own
    } else {
      const step = Math.max(0.3, remaining * 0.1);
      percent = Math.min(PROGRESS_MAX_WAITING_PERCENT, percent + step);
    }
    setDisplay(percent);
  }, PROGRESS_TICK_MS);

  const messageInterval = setInterval(() => {
    messageIndex = (messageIndex + 1) % PROGRESS_STATUS_MESSAGES.length;
    const statusEl = document.getElementById("aiMatchProgressStatus");
    if (statusEl) statusEl.textContent = PROGRESS_STATUS_MESSAGES[messageIndex];
  }, PROGRESS_MESSAGE_ROTATE_MS);

  return {
    /** Call only after a genuinely successful response — advances to 100% and shows the completion message. */
    finishSuccess() {
      clearInterval(tickInterval);
      clearInterval(messageInterval);
      setDisplay(100);
      const statusEl = document.getElementById("aiMatchProgressStatus");
      if (statusEl) statusEl.textContent = "Analysis complete";
    },
    /** Call on any failure — just stops the animation; never advances toward 100%. */
    stop() {
      clearInterval(tickInterval);
      clearInterval(messageInterval);
    },
  };
}

async function handleAnalyzeClick(app) {
  if (isAnalyzing) return; // guards against duplicate rapid clicks

  const resume = loadResume();
  const isReanalyze = !!app.aiAnalysis;

  if (!resume || !resume.text) {
    showAiMatchError("Please upload a resume before analyzing this job.");
    return;
  }
  if (!hasJobSideInput(app)) {
    showAiMatchError("This application doesn't have a job description or any listed skills to analyze yet.");
    return;
  }

  isAnalyzing = true;
  clearAiMatchError();

  // Snapshot the current content area (old results + notice) before the
  // progress card overwrites it — a failure restores this verbatim
  // rather than recomputing anything, since nothing about the saved
  // application data actually changed on a failed attempt.
  const contentArea = document.getElementById("aiMatchContentArea");
  const savedContentHtml = contentArea ? contentArea.innerHTML : "";

  setAnalyzeButtonState("loading", isReanalyze);
  const progress = startEstimatedProgress(contentArea);
  if (typeof updateGoToTopVisibility === "function") updateGoToTopVisibility();

  try {
    // If we have a canonical requirement list from a previous successful
    // analysis, send it back along with the job-side fingerprint it was
    // generated against — NOT a freshly-computed fingerprint of the
    // current inputs. The backend independently recomputes the
    // fingerprint from the job description + Required/Nice-to-have
    // Skills actually in this same request and compares; if ANY of
    // those changed since this was cached, the fingerprints won't match
    // and the backend transparently re-runs Stage A instead of trusting
    // a stale list.
    const cachedCanonicalRequirements = app.aiAnalysis && app.aiAnalysis.canonicalRequirements ? app.aiAnalysis.canonicalRequirements : null;
    const cachedFingerprint = app.aiAnalysis && app.aiAnalysis.analyzedCanonicalRequirementsFingerprint ? app.aiAnalysis.analyzedCanonicalRequirementsFingerprint : null;

    const requestBody = {
      resumeText: resume.text,
      jobDescription: app.jobDescription || "",
      requiredSkills: app.requiredSkills || [],
      requiredSkillsOther: app.requiredSkillsOther || "",
      niceToHaveSkills: app.niceToHaveSkills || [],
      niceToHaveSkillsOther: app.niceToHaveSkillsOther || "",
    };
    if (cachedCanonicalRequirements && cachedFingerprint) {
      requestBody.canonicalRequirements = cachedCanonicalRequirements;
      requestBody.canonicalRequirementsFingerprint = cachedFingerprint;
    }

    const response = await fetch(`${AI_BACKEND_URL}/api/analyze-job-match`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      // Important: on failure we do NOT touch app.aiAnalysis — any
      // previously successful analysis stays exactly as it was, only
      // the error message changes. No success check is ever shown on
      // this path, and progress never advances toward 100%.
      const message = (payload && payload.error) || "AI analysis is temporarily unavailable. Please try again.";
      showAiMatchError(message);
      if (progress) progress.stop();
      if (contentArea) contentArea.innerHTML = savedContentHtml;
      if (typeof updateGoToTopVisibility === "function") updateGoToTopVisibility();
      isAnalyzing = false;
      setAnalyzeButtonState("idle", isReanalyze);
      return;
    }

    // payload already includes canonicalRequirements (either the reused
    // cache or a freshly Stage-A-generated list) — spread first so the
    // fields below always reflect the job-side inputs and resume this
    // result is now bound to, for next time. analyzedCanonicalRequirementsFingerprint,
    // analyzedResumeFingerprint, and analysisVersion together are what
    // computeAnalysisStatus() compares against to decide current vs.
    // stale — analyzedResumeUploadedAt is kept only as a historical
    // record (when this was uploaded), not part of that comparison
    // anymore, since re-uploading identical text must not itself count
    // as a change.
    const aiAnalysis = {
      ...payload,
      resumeName: resume.filename,
      analyzedAt: new Date().toISOString(),
      analysisVersion: ANALYSIS_VERSION,
      analyzedCanonicalRequirementsFingerprint: computeJobSideInputFingerprint(
        app.jobDescription,
        app.requiredSkills,
        app.requiredSkillsOther,
        app.niceToHaveSkills,
        app.niceToHaveSkillsOther
      ),
      analyzedResumeFingerprint: computeResumeFingerprint(resume.text),
      analyzedResumeUploadedAt: resume.uploadedAt,
    };

    const persisted = persistAiAnalysis(app.id, aiAnalysis);
    if (!persisted) {
      showAiMatchError("Analysis succeeded, but couldn't be saved — your browser's storage may be full.");
      if (progress) progress.stop();
      if (contentArea) contentArea.innerHTML = savedContentHtml;
      if (typeof updateGoToTopVisibility === "function") updateGoToTopVisibility();
      isAnalyzing = false;
      setAnalyzeButtonState("idle", isReanalyze);
      return;
    }

    // Advance the progress ring to 100% and show the completion message
    // now that we have a genuinely successful, saved result — then
    // briefly confirm on the button before the section re-renders with
    // the new results. isAnalyzing stays true through this short window
    // (button stays disabled) so a rapid second click still can't start
    // a duplicate request while the confirmation shows.
    if (progress) progress.finishSuccess();
    setAnalyzeButtonState("success");
    setTimeout(() => {
      isAnalyzing = false;
      const updatedApp = applications.find((a) => a.id === app.id) || { ...app, aiAnalysis };
      renderAiJobMatchSection(updatedApp);
    }, ANALYZE_SUCCESS_DISPLAY_MS);
  } catch (err) {
    console.error("Analyze request failed:", err);
    showAiMatchError("AI analysis is temporarily unavailable. Please try again.");
    if (progress) progress.stop();
    if (contentArea) contentArea.innerHTML = savedContentHtml;
    if (typeof updateGoToTopVisibility === "function") updateGoToTopVisibility();
    isAnalyzing = false;
    setAnalyzeButtonState("idle", isReanalyze);
  }
}

function showAiMatchError(message) {
  const statusEl = document.getElementById("aiMatchStatus");
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.add("form-msg--error");
}

function clearAiMatchError() {
  const statusEl = document.getElementById("aiMatchStatus");
  if (!statusEl) return;
  statusEl.textContent = "";
  statusEl.classList.remove("form-msg--error");
}
