/* =========================================================
   JobTrack AI — script.js
   Everything the app does lives in this one file:
   - reading/writing applications to localStorage
   - rendering the dashboard, list, and panels
   - handling the add/edit form and validation
   - search, filter, sort
   - export to JSON
   ========================================================= */

/* ---------------------------------------------------------
   1. CONSTANTS & "DATABASE" (localStorage)
   --------------------------------------------------------- */

// The key we use to store everything in the browser's localStorage.
const STORAGE_KEY = "jobtrackai_applications";

// Current app version, included in JSON exports to prepare for a future import feature.
const APP_VERSION = "0.3.0";

// The full list of statuses, in the order they should progress.
const STATUSES = [
  "To Apply",
  "Applied",
  "For Initial Interview",
  "For Technical Interview",
  "For Final Interview",
  "Offered",
  "Ghosted",
  "Rejected",
  "Withdrawn",
  "Failed",
];

// The statuses that trigger the conditional "Date of Interview" field.
const INTERVIEW_STATUSES = ["For Initial Interview", "For Technical Interview", "For Final Interview"];

const SOURCES = [
  "LinkedIn", "Indeed", "JobStreet", "OnlineJobsPH", "Kalibrr",
  "Wellfound", "FoundIt", "Company Website", "Referral", "Other",
];

// Shown as checkboxes for both "Required skills" and "Nice to have skills".
const SKILLS = [
  "Postman", "API testing", "SQL", "JIRA", "Testrail", "Zephyr",
  "Automation", "Playwright", "JavaScript", "Selenium", "Cypress",
  "Agile", "Scrum", "CI/CD pipeline", "Jenkins", "Azure DevOps",
  "Git/GitHub", "Jmeter", "LoadRunner", "ISTQB", "UAT", "UI testing",
  "Mobile testing", "SDLC/STLC", "Linux", "Python", "Docker",
];

// Maps a status to the CSS class used for its colored pill,
// and to which summary-card bucket it counts toward.
const STATUS_META = {
  "To Apply":           { pill: "toapply",   bucket: "toapply" },
  "Applied":             { pill: "applied",   bucket: "applied" },
  "For Initial Interview":   { pill: "interview", bucket: "interview" },
  "For Technical Interview": { pill: "interview", bucket: "interview" },
  "For Final Interview":     { pill: "interview", bucket: "interview" },
  // Legacy values, kept so applications saved before the interview-status
  // rename still display and count correctly even if migration hasn't run.
  "Initial Interview":   { pill: "interview", bucket: "interview" },
  "Technical Interview": { pill: "interview", bucket: "interview" },
  "Final Interview":     { pill: "interview", bucket: "interview" },
  "Offered":              { pill: "offer",     bucket: "offer" },
  "Offer":                { pill: "offer",     bucket: "offer" }, // legacy value, kept so applications saved before the "Offered" rename still display and count correctly
  "Ghosted":              { pill: "withdrawn", bucket: "ghosted" },
  "Rejected":             { pill: "rejected",  bucket: "rejected" },
  "Withdrawn":            { pill: "withdrawn", bucket: "withdrawn" },
  "Failed":               { pill: "rejected",  bucket: "failed" },
};

/**
 * Reads all saved applications from localStorage.
 * Returns an empty array if nothing has been saved yet,
 * or if the saved data is somehow broken.
 */
function loadApplications() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("Could not read saved applications:", err);
    return [];
  }
}

/**
 * Saves the full list of applications to localStorage.
 * This overwrites whatever was there before, so we always
 * pass in the complete, up-to-date array.
 * Returns true if the save succeeded, false if it didn't
 * (e.g. storage is full or unavailable) so callers can avoid
 * telling the user something was saved when it wasn't.
 */
function saveApplications(applications) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(applications));
    return true;
  } catch (err) {
    console.error("Could not save applications:", err);
    return false;
  }
}

// Key used to persist the running counter behind auto-generated Application IDs.
const APP_NUMBER_KEY = "jobtrackai_next_app_number";

/** Reads the next Application ID number to use, without consuming it. */
function peekNextAppNumber() {
  const raw = localStorage.getItem(APP_NUMBER_KEY);
  const n = parseInt(raw, 10);
  if (Number.isInteger(n) && n > 0) return n;
  // Counter missing or corrupted — fall back to one past the highest
  // Application ID actually present in the data, so we never hand out
  // a number that collides with an existing record.
  return getHighestAppNumber() + 1;
}

/** Finds the highest numeric suffix among existing "APP-000N" IDs currently saved. */
function getHighestAppNumber() {
  let highest = 0;
  applications.forEach((app) => {
    const match = /^APP-(\d+)$/.exec(app.appNumber || "");
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > highest) highest = n;
    }
  });
  return highest;
}

/** Formats a number as "APP-0001". */
function formatAppNumber(n) {
  return "APP-" + String(n).padStart(4, "0");
}

/**
 * Records that the given Application ID number has now been used, so the
 * next application gets the next number — even after this one is later
 * deleted. Only call this after a create has actually been saved
 * successfully; a failed save should never consume a number.
 */
function commitAppNumber(n) {
  try {
    localStorage.setItem(APP_NUMBER_KEY, String(n + 1));
  } catch (err) {
    console.error("Could not persist the next Application ID counter:", err);
  }
}

/**
 * Maps every old status value that's been renamed to its current value.
 * One-time data migration (below) uses this so each renamed status is
 * handled the same way, and so adding a future rename only means adding
 * one line here rather than writing a new migration function.
 */
const LEGACY_STATUS_MIGRATIONS = {
  "Offer": "Offered",
  "Initial Interview": "For Initial Interview",
  "Technical Interview": "For Technical Interview",
  "Final Interview": "For Final Interview",
};

/**
 * One-time data migration: any application still saved with an old status
 * value (from before a rename) gets updated in localStorage itself, not
 * just displayed correctly at runtime. Safe to run on every load — only
 * old values are keys in LEGACY_STATUS_MIGRATIONS, so already-migrated
 * applications are left untouched and nothing is written unnecessarily.
 */
function migrateLegacyStatuses(apps) {
  let didMigrate = false;
  const migrated = apps.map((app) => {
    const newStatus = LEGACY_STATUS_MIGRATIONS[app.status];
    if (newStatus) {
      didMigrate = true;
      return { ...app, status: newStatus };
    }
    return app;
  });
  if (didMigrate) saveApplications(migrated);
  return migrated;
}

// In-memory copy of the applications, kept in sync with localStorage.
let applications = migrateLegacyStatuses(loadApplications());

/* ---------------------------------------------------------
   2. DOM REFERENCES
   --------------------------------------------------------- */

const els = {
  // header
  addBtn: document.getElementById("addBtn"),
  exportBtn: document.getElementById("exportBtn"),

  // summary
  statTotal: document.getElementById("statTotal"),
  statApplied: document.getElementById("statApplied"),
  statInterview: document.getElementById("statInterview"),
  statOffer: document.getElementById("statOffer"),
  statRejected: document.getElementById("statRejected"),

  // toolbar
  searchInput: document.getElementById("searchInput"),
  clearSearchBtn: document.getElementById("clearSearchBtn"),
  filterStatus: document.getElementById("filterStatus"),
  filterSource: document.getElementById("filterSource"),
  sortBy: document.getElementById("sortBy"),
  resetFiltersBtn: document.getElementById("resetFiltersBtn"),

  // list
  emptyState: document.getElementById("emptyState"),
  emptyStateTitle: document.getElementById("emptyStateTitle"),
  emptyStateBody: document.getElementById("emptyStateBody"),
  emptyStateBtn: document.getElementById("emptyStateBtn"),
  tableWrap: document.getElementById("tableWrap"),
  ledgerBody: document.getElementById("ledgerBody"),
  cardList: document.getElementById("cardList"),

  // form panel
  formOverlay: document.getElementById("formOverlay"),
  formPanelTitle: document.getElementById("formPanelTitle"),
  appForm: document.getElementById("appForm"),
  closeFormBtn: document.getElementById("closeFormBtn"),
  cancelFormBtn: document.getElementById("cancelFormBtn"),
  formMsg: document.getElementById("formMsg"),

  // details panel
  detailsOverlay: document.getElementById("detailsOverlay"),
  detailsScrollArea: document.getElementById("detailsScrollArea"),
  detailsGoToTopBtn: document.getElementById("detailsGoToTopBtn"),
  detailsBody: document.getElementById("detailsBody"),
  detailsEditBtn: document.getElementById("detailsEditBtn"),
  closeDetailsBtn: document.getElementById("closeDetailsBtn"),
  detailsCloseBtn: document.getElementById("detailsCloseBtn"),

  // delete confirm
  deleteOverlay: document.getElementById("deleteOverlay"),
  cancelDeleteBtn: document.getElementById("cancelDeleteBtn"),
  confirmDeleteBtn: document.getElementById("confirmDeleteBtn"),

  // toast
  toast: document.getElementById("toast"),
};

// Tracks which application is currently open in the details panel
// or queued for deletion, so the button handlers know what to act on.
let currentDetailsId = null;
let pendingDeleteId = null;

/* ---------------------------------------------------------
   3. INITIAL SETUP (runs once on page load)
   --------------------------------------------------------- */

function init() {
  populateSelect(els.filterStatus, STATUSES, "All statuses");
  populateSelect(els.filterSource, SOURCES, "All sources");
  populateSkillsGrid(document.getElementById("requiredSkillsGrid"), "reqSkill");
  populateSkillsGrid(document.getElementById("niceToHaveSkillsGrid"), "niceSkill");
  renderAll();
  attachEventListeners();
}

/** Fills a skills grid container with one checkbox per skill in SKILLS. */
function populateSkillsGrid(gridEl, idPrefix) {
  SKILLS.forEach((skill, index) => {
    const id = `${idPrefix}-${index}`;
    const wrapper = document.createElement("label");
    wrapper.className = "skills-grid__item";
    wrapper.setAttribute("for", id);
    wrapper.innerHTML = `<input type="checkbox" id="${id}" value="${escapeHtml(skill)}"> ${escapeHtml(skill)}`;
    gridEl.appendChild(wrapper);
  });
}

/** Reads the checked skill checkboxes inside a grid container. */
function getCheckedSkills(gridEl) {
  return Array.from(gridEl.querySelectorAll("input[type=checkbox]:checked")).map((cb) => cb.value);
}

/** Checks the boxes in a grid container that match the given skill list. */
function setCheckedSkills(gridEl, skills) {
  const selected = new Set(skills || []);
  gridEl.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.checked = selected.has(cb.value);
  });
}

/** Finds a skill checkbox in a grid by its underlying value (the skill string), not by position/index. */
function findSkillCheckboxByValue(gridEl, value) {
  return Array.from(gridEl.querySelectorAll('input[type="checkbox"]')).find((cb) => cb.value === value) || null;
}

/**
 * Finds a skill checkbox's counterpart in the OTHER grid (Required <->
 * Nice-to-Have) — same skill value, opposite list. Matching is always
 * by value, never by DOM position, so this stays correct even if the
 * two grids were ever populated in a different order from each other.
 */
function findCounterpartSkillCheckbox(checkboxEl) {
  const requiredGrid = document.getElementById("requiredSkillsGrid");
  const niceGrid = document.getElementById("niceToHaveSkillsGrid");
  const sourceGrid = checkboxEl.closest(".skills-grid");
  const otherGrid = sourceGrid === requiredGrid ? niceGrid : requiredGrid;
  if (!otherGrid) return null;
  return findSkillCheckboxByValue(otherGrid, checkboxEl.value);
}

/**
 * Enforces mutual exclusion for one skill checkbox: its counterpart in
 * the other grid becomes disabled exactly when this one is checked, and
 * re-enabled when it's unchecked. Only ever touches the ONE matching
 * counterpart — unrelated skills are never affected.
 */
function syncSkillMutualExclusion(checkboxEl) {
  const counterpart = findCounterpartSkillCheckbox(checkboxEl);
  if (!counterpart) return;
  counterpart.disabled = checkboxEl.checked;
}

/** Delegated change handler for both skill grids — keeps the counterpart's disabled state in sync the instant a checkbox is toggled. */
function handleSkillCheckboxChange(event) {
  if (!event.target.matches('input[type="checkbox"]')) return;
  syncSkillMutualExclusion(event.target);
}

/**
 * Recomputes disabled state for every checkbox in both skill grids from
 * their current checked state. Order-independent — call this any time
 * both grids' checked states may have changed out from under the live
 * change-listener (populating the Edit form, or resetting for a new
 * application, since form.reset() clears checked state but not
 * dynamically-set `disabled` attributes left over from a prior session).
 */
function reconcileSkillMutualExclusion() {
  const requiredGrid = document.getElementById("requiredSkillsGrid");
  const niceGrid = document.getElementById("niceToHaveSkillsGrid");
  if (!requiredGrid || !niceGrid) return;
  requiredGrid.querySelectorAll('input[type="checkbox"]').forEach(syncSkillMutualExclusion);
  niceGrid.querySelectorAll('input[type="checkbox"]').forEach(syncSkillMutualExclusion);
}

/**
 * Legacy-data safety net: an application saved before this mutual-
 * exclusion UI existed could have the same skill checked under both
 * Required and Nice-to-Have. Required wins in the UI — this unchecks
 * the Nice-to-Have duplicate in the FORM only (a DOM change to the
 * checkboxes). The saved application itself is untouched; the cleanup
 * only becomes real if the user goes on to explicitly save the form.
 */
function resolveSkillConflicts() {
  const requiredGrid = document.getElementById("requiredSkillsGrid");
  const niceGrid = document.getElementById("niceToHaveSkillsGrid");
  if (!requiredGrid || !niceGrid) return;

  requiredGrid.querySelectorAll('input[type="checkbox"]:checked').forEach((requiredCb) => {
    const niceCb = findSkillCheckboxByValue(niceGrid, requiredCb.value);
    if (niceCb && niceCb.checked) {
      niceCb.checked = false;
    }
  });
}

/**
 * Fills a <select> with <option> elements from a list of strings,
 * keeping whatever "All ___" default option is already first.
 */
function populateSelect(selectEl, values, placeholderText) {
  values.forEach((value) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = value;
    selectEl.appendChild(opt);
  });
}

/* ---------------------------------------------------------
   4. RENDERING
   --------------------------------------------------------- */

/** Re-renders the summary cards, the list, and the empty state. */
function renderAll() {
  renderSummary();
  renderList();
}

function renderSummary() {
  const counts = { toapply: 0, applied: 0, interview: 0, offer: 0, rejected: 0, withdrawn: 0, ghosted: 0, failed: 0 };

  applications.forEach((app) => {
    const meta = STATUS_META[app.status];
    if (meta) counts[meta.bucket]++;
  });

  els.statTotal.textContent = applications.length;
  els.statApplied.textContent = counts.applied;
  els.statInterview.textContent = counts.interview;
  els.statOffer.textContent = counts.offer;
  els.statRejected.textContent = counts.rejected;
}

/** Applies search + filters + sort, then draws the table and card list. */
function renderList() {
  const visible = getFilteredAndSortedApplications();

  const hasAnyApplications = applications.length > 0;
  const hasVisibleApplications = visible.length > 0;

  // Empty state: different message depending on *why* the list is empty.
  els.emptyState.hidden = hasVisibleApplications;
  if (!hasVisibleApplications) {
    if (hasAnyApplications) {
      els.emptyStateTitle.textContent = "No applications match your search";
      els.emptyStateBody.textContent = "Try a different search term or reset your filters.";
      els.emptyStateBtn.hidden = true;
    } else {
      els.emptyStateTitle.textContent = "No applications yet";
      els.emptyStateBody.textContent = "Add your first job application to start tracking your search.";
      els.emptyStateBtn.hidden = false;
    }
  }

  els.tableWrap.hidden = !hasVisibleApplications;
  els.cardList.hidden = !hasVisibleApplications;

  renderTableRows(visible);
  renderCardItems(visible);
}

function getFilteredAndSortedApplications() {
  const query = els.searchInput.value.trim().toLowerCase();
  const statusFilter = els.filterStatus.value;
  const sourceFilter = els.filterSource.value;
  const sortValue = els.sortBy.value;

  let result = applications.filter((app) => {
    const matchesQuery =
      !query ||
      (app.jobTitle || "").toLowerCase().includes(query) ||
      (app.company || "").toLowerCase().includes(query);
    const matchesStatus = !statusFilter || app.status === statusFilter;
    const matchesSource = !sourceFilter || app.source === sourceFilter;
    return matchesQuery && matchesStatus && matchesSource;
  });

  result.sort((a, b) => {
    const diff = new Date(a.dateApplied) - new Date(b.dateApplied);
    return sortValue === "date-asc" ? diff : -diff;
  });

  return result;
}

function renderTableRows(list) {
  els.ledgerBody.innerHTML = "";

  list.forEach((app) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="cell-muted">${escapeHtml(app.appNumber || "—")}</td>
      <td class="cell-title">${escapeHtml(app.jobTitle)}</td>
      <td>${escapeHtml(app.company)}</td>
      <td class="cell-muted">${escapeHtml(app.source)}</td>
      <td class="cell-muted">${formatDate(app.dateApplied)}</td>
      <td>${statusPillHtml(app.status)}</td>
      <td class="cell-muted">${escapeHtml(app.workArrangement || "Not specified")}</td>
      <td class="cell-actions"></td>
    `;
    const actionsCell = tr.querySelector(".cell-actions");
    actionsCell.appendChild(makeRowActionButton("Analyze", () => openDetails(app.id, { scrollToAnalysis: true })));
    actionsCell.appendChild(makeRowActionButton("Edit", () => openForm(app.id)));
    actionsCell.appendChild(makeRowActionButton("Delete", () => openDeleteConfirm(app.id), true));
    els.ledgerBody.appendChild(tr);
  });
}

function renderCardItems(list) {
  els.cardList.innerHTML = "";

  list.forEach((app) => {
    const card = document.createElement("div");
    card.className = "app-card";
    card.innerHTML = `
      <div class="app-card__top">
        <div>
          <div class="app-card__id">${escapeHtml(app.appNumber || "—")}</div>
          <div class="app-card__title">${escapeHtml(app.jobTitle)}</div>
          <div class="app-card__company">${escapeHtml(app.company)}</div>
        </div>
        ${statusPillHtml(app.status)}
      </div>
      <div class="app-card__meta">
        <span>${escapeHtml(app.source)}</span>
        <span>${formatDate(app.dateApplied)}</span>
        <span>${escapeHtml(app.workArrangement || "Not specified")}</span>
      </div>
      <div class="app-card__actions"></div>
    `;
    const actionsCell = card.querySelector(".app-card__actions");
    actionsCell.appendChild(makeRowActionButton("Analyze", () => openDetails(app.id, { scrollToAnalysis: true })));
    actionsCell.appendChild(makeRowActionButton("Edit", () => openForm(app.id)));
    actionsCell.appendChild(makeRowActionButton("Delete", () => openDeleteConfirm(app.id), true));
    els.cardList.appendChild(card);
  });
}

function makeRowActionButton(label, onClick, isDanger) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "row-action" + (isDanger ? " row-action--danger" : "");
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

function statusPillHtml(status) {
  const meta = STATUS_META[status] || { pill: "toapply" };
  return `<span class="status-pill status-pill--${meta.pill}">${escapeHtml(status)}</span>`;
}

/* ---------------------------------------------------------
   5. FORM (ADD / EDIT)
   --------------------------------------------------------- */

const formFieldIds = [
  "jobTitle", "company", "source", "sourceOther", "dateApplied", "status", "interviewDate",
  "jobUrl", "companyBackground", "jobDescription",
  "requiredSkillsOther", "niceToHaveSkillsOther", "companyBenefits",
  "clientBased", "clientBasedOther", "workArrangement",
  "employmentType", "employmentTypeMonths", "salaryOfferCurrency", "salaryOffer",
  "salaryAskedCurrency", "salaryAsked", "actualSalaryOfferCurrency", "actualSalaryOffer", "notes",
];

function openForm(editId) {
  els.appForm.reset();
  clearAllFieldErrors();
  els.formMsg.textContent = "";
  els.formMsg.classList.remove("form-msg--error");

  if (editId) {
    const app = applications.find((a) => a.id === editId);
    if (!app) return;
    els.formPanelTitle.textContent = "Edit application";
    document.getElementById("appId").value = app.id;
    document.getElementById("appNumberDisplay").value = app.appNumber || "—";
    formFieldIds.forEach((field) => {
      const el = document.getElementById(field);
      if (el) el.value = app[field] || "";
    });
    // Older records saved before the currency dropdown existed won't have
    // a currency value — default those to Peso rather than leaving the
    // select with nothing chosen.
    document.getElementById("salaryOfferCurrency").value = app.salaryOfferCurrency || "₱";
    document.getElementById("salaryAskedCurrency").value = app.salaryAskedCurrency || "₱";
    document.getElementById("actualSalaryOfferCurrency").value = app.actualSalaryOfferCurrency || "₱";
    setCheckedSkills(document.getElementById("requiredSkillsGrid"), app.requiredSkills);
    setCheckedSkills(document.getElementById("niceToHaveSkillsGrid"), app.niceToHaveSkills);
    resolveSkillConflicts();
  } else {
    els.formPanelTitle.textContent = "Add application";
    document.getElementById("appId").value = "";
    document.getElementById("appNumberDisplay").value = "";
  }

  // Recomputes each grid's disabled state from current checked state —
  // needed for the Edit case (fresh selections just populated above) and
  // the Add case too, since form.reset() at the top of this function
  // clears checked state but not any `disabled` attribute a previous
  // form session left set.
  reconcileSkillMutualExclusion();

  syncOtherField(document.getElementById("source"), document.getElementById("sourceOtherWrap"));
  syncOtherField(document.getElementById("clientBased"), document.getElementById("clientBasedOtherWrap"));
  syncEmploymentTypeMonthsField();
  syncInterviewDateField();
  syncActualSalaryOfferField();

  els.formOverlay.hidden = false;
  document.getElementById("jobTitle").focus();
}

/** Shows/hides an "Other — please specify" field group based on its select's current value. */
function syncOtherField(selectEl, wrapperEl) {
  wrapperEl.hidden = selectEl.value !== "Other";
}

/** Shows/hides the "number of months" field group based on whether Employment type is Project-based. */
function syncEmploymentTypeMonthsField() {
  document.getElementById("employmentTypeMonthsWrap").hidden =
    document.getElementById("employmentType").value !== "Project-based";
}

/** Shows/hides the "Date of Interview" field based on whether the status is one of the interview statuses. */
function syncInterviewDateField() {
  document.getElementById("interviewDateWrap").hidden =
    !INTERVIEW_STATUSES.includes(document.getElementById("status").value);
}

/** Shows/hides the "Actual Salary Offer" field group based on whether the status is Offered. */
function syncActualSalaryOfferField() {
  document.getElementById("actualSalaryOfferWrap").hidden =
    document.getElementById("status").value !== "Offered";
}

function closeForm() {
  els.formOverlay.hidden = true;
}

function clearAllFieldErrors() {
  document.querySelectorAll(".field__error").forEach((el) => (el.textContent = ""));
  document.querySelectorAll(".has-error").forEach((el) => el.classList.remove("has-error"));
}

// Per-field validity rules, shared by full-form validation (validateForm)
// and by live error-clearing as the user types/selects (clearFieldErrorIfNowValid).
// Each rule receives the full form data object so a conditional field
// (e.g. sourceOther) can check its parent select's current value.
// Key order matches the form's visual top-to-bottom layout, so "first
// invalid field" focus always lands on whichever error appears first on screen.
const FIELD_RULES = {
  jobTitle: {
    isValid: (data) => data.jobTitle.trim().length > 0,
    message: "Job title is required.",
  },
  company: {
    isValid: (data) => data.company.trim().length > 0,
    message: "Company name is required.",
  },
  source: {
    isValid: (data) => !!data.source,
    message: "Please select where you applied.",
  },
  sourceOther: {
    isValid: (data) => data.source !== "Other" || !!(data.sourceOther || "").trim(),
    message: "Please specify the source.",
  },
  dateApplied: {
    isValid: (data) => !!data.dateApplied,
    message: "Please select the date you applied.",
  },
  status: {
    isValid: (data) => !!data.status,
    message: "Please select a status.",
  },
  jobUrl: {
    isValid: (data) => !data.jobUrl || isLikelyValidUrl(data.jobUrl),
    message: "That doesn't look like a valid URL (include https://).",
  },
  clientBasedOther: {
    isValid: (data) => data.clientBased !== "Other" || !!(data.clientBasedOther || "").trim(),
    message: "Please specify the client location.",
  },
  employmentTypeMonths: {
    isValid: (data) => data.employmentType !== "Project-based" || !!(data.employmentTypeMonths || "").trim(),
    message: "Please enter the number of months.",
  },
};

/**
 * Validates the required fields (including conditionally-required ones)
 * and a couple of format checks. Returns an object of
 * { fieldId: errorMessage } — empty object means valid.
 */
function validateForm(data) {
  const errors = {};
  Object.keys(FIELD_RULES).forEach((field) => {
    if (!FIELD_RULES[field].isValid(data)) {
      errors[field] = FIELD_RULES[field].message;
    }
  });
  return errors;
}

function isLikelyValidUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function showFieldErrors(errors) {
  clearAllFieldErrors();
  Object.entries(errors).forEach(([field, message]) => {
    const input = document.getElementById(field);
    const errorEl = document.getElementById("err-" + field);
    if (input) input.classList.add("has-error");
    if (errorEl) errorEl.textContent = message;
  });
}

/** Reads the current live value of every form field, keyed by field id. */
function getCurrentFieldValues() {
  const data = {};
  formFieldIds.forEach((field) => {
    const el = document.getElementById(field);
    if (el) data[field] = el.value;
  });
  return data;
}

/** Clears a single field's inline error the moment it becomes valid, without waiting for another Save click. */
function clearFieldErrorIfNowValid(field) {
  const el = document.getElementById(field);
  if (!el || !el.classList.contains("has-error")) return;
  const rule = FIELD_RULES[field];
  if (rule && !rule.isValid(getCurrentFieldValues())) return;
  el.classList.remove("has-error");
  const errorEl = document.getElementById("err-" + field);
  if (errorEl) errorEl.textContent = "";
}

function handleFormSubmit(event) {
  event.preventDefault();

  const data = {};
  formFieldIds.forEach((field) => {
    data[field] = document.getElementById(field).value;
  });
  data.requiredSkills = getCheckedSkills(document.getElementById("requiredSkillsGrid"));
  data.niceToHaveSkills = getCheckedSkills(document.getElementById("niceToHaveSkillsGrid"));

  // A conditional field only makes sense while its parent select is still
  // on the triggering value — if the user changed their mind, blank it out
  // rather than silently saving stale, hidden data.
  if (data.source !== "Other") data.sourceOther = "";
  if (data.clientBased !== "Other") data.clientBasedOther = "";
  if (data.employmentType !== "Project-based") data.employmentTypeMonths = "";
  if (!INTERVIEW_STATUSES.includes(data.status)) data.interviewDate = "";
  if (data.status !== "Offered") {
    data.actualSalaryOffer = "";
    data.actualSalaryOfferCurrency = "";
  }

  const errors = validateForm(data);
  if (Object.keys(errors).length > 0) {
    showFieldErrors(errors);
    els.formMsg.textContent = "";
    els.formMsg.classList.remove("form-msg--error");
    // Object key order matches the order fields are checked in validateForm(),
    // which matches the visual top-to-bottom order of the form.
    const firstInvalidField = document.getElementById(Object.keys(errors)[0]);
    if (firstInvalidField) firstInvalidField.focus();
    return;
  }

  const existingId = document.getElementById("appId").value;
  const now = new Date().toISOString();

  // For a brand-new application, reserve the next Application ID number now,
  // but don't persist the counter yet — that only happens after a
  // confirmed successful save, so a failed save never burns a number.
  const newAppNumber = existingId ? null : peekNextAppNumber();

  // Build the updated list first, without touching the real `applications`
  // array yet — that way, if saving fails, the in-memory list and
  // localStorage never fall out of sync with each other or with what
  // the user is shown.
  let updatedApplications;
  if (existingId) {
    updatedApplications = applications.map((a) =>
      a.id === existingId ? { ...a, ...data, updatedAt: now } : a
    );
  } else {
    updatedApplications = [
      ...applications,
      { id: generateId(), appNumber: formatAppNumber(newAppNumber), ...data, createdAt: now, updatedAt: now },
    ];
  }

  const saved = saveApplications(updatedApplications);
  if (!saved) {
    els.formMsg.textContent = "Couldn't save — your browser's storage may be full or unavailable. Your entries are still in this form.";
    els.formMsg.classList.add("form-msg--error");
    return;
  }

  if (newAppNumber !== null) commitAppNumber(newAppNumber);

  applications = updatedApplications;
  renderAll();
  closeForm();
  showToast(existingId ? "Application updated." : "Application saved.", true);
}

function generateId() {
  return "app_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

/* ---------------------------------------------------------
   6. DETAILS PANEL
   --------------------------------------------------------- */

function openDetails(id, options) {
  const app = applications.find((a) => a.id === id);
  if (!app) return;

  const scrollToAnalysis = !!(options && options.scrollToAnalysis);

  currentDetailsId = id;

  els.detailsBody.innerHTML = `
    <div class="detail-grid">
      ${detailField("Application ID", app.appNumber || "—")}
      ${detailField("Job title", app.jobTitle)}
      ${detailField("Company", app.company)}
      ${detailField("Source", formatSourceDisplay(app.source, app.sourceOther))}
      ${detailField("Date applied", formatDate(app.dateApplied))}
      ${detailField("Status", statusPillHtml(app.status), true)}
      ${app.interviewDate ? detailField("Date of Interview", formatDate(app.interviewDate)) : ""}
      ${detailField("Client based", formatClientBasedDisplay(app.clientBased, app.clientBasedOther))}
      ${detailField("Work arrangement", app.workArrangement)}
      ${detailField("Employment type", formatEmploymentTypeDisplay(app.employmentType, app.employmentTypeMonths))}
      ${detailField("Salary offer", formatSalaryDisplay(app.salaryOfferCurrency, app.salaryOffer))}
      ${detailField("Salary asked", formatSalaryDisplay(app.salaryAskedCurrency, app.salaryAsked))}
      ${app.actualSalaryOffer ? detailField("Actual Salary Offer", formatSalaryDisplay(app.actualSalaryOfferCurrency, app.actualSalaryOffer)) : ""}
    </div>
    ${detailBlock("Job posting URL", app.jobUrl ? linkHtml(app.jobUrl) : "", true)}
    ${detailBlock("Company background", app.companyBackground)}
    ${detailBlock("Job description", app.jobDescription)}
    ${detailBlock("Required skills", combineSkillsText(app.requiredSkills, app.requiredSkillsOther))}
    ${detailBlock("Nice to have skills", combineSkillsText(app.niceToHaveSkills, app.niceToHaveSkillsOther))}
    ${detailBlock("Company benefits", app.companyBenefits)}
    ${detailBlock("Notes", app.notes)}
  `;

  els.detailsOverlay.hidden = false;

  // Phase 2 hook: renders the AI Job Match section for this application.
  // Guarded so Phase 1 keeps working unchanged if js/resume.js isn't loaded.
  if (typeof renderAiJobMatchSection === "function") {
    renderAiJobMatchSection(app);
  }

  if (scrollToAnalysis) scrollDetailsToAiSection();
  updateGoToTopVisibility();
}

/**
 * Scrolls the details panel's own scroll container (never the underlying
 * page) down to the AI Job Match section, used when the user enters
 * through the "Analyze" action specifically. Deferred a frame so layout
 * has settled after unhiding the overlay and rendering fresh content —
 * measuring immediately after `hidden = false` can read stale (zero)
 * geometry in some browsers. Re-checks both elements still exist inside
 * the deferred callback, since the user could close the panel before it
 * runs.
 */
function scrollDetailsToAiSection() {
  requestAnimationFrame(() => {
    const scrollArea = els.detailsScrollArea;
    const target = document.getElementById("aiMatchBody");
    if (!scrollArea || !target) return;

    const scrollAreaRect = scrollArea.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const relativeTop = targetRect.top - scrollAreaRect.top + scrollArea.scrollTop;

    scrollArea.scrollTo({ top: Math.max(0, relativeTop), behavior: "smooth" });
  });
}

// How far down the panel the user must scroll before the "go to top"
// control appears — keeps it from showing for a trivial amount of overflow.
const GO_TO_TOP_SHOW_THRESHOLD_PX = 200;

/**
 * Shows/hides the go-to-top control based on whether the details panel's
 * content actually overflows AND whether the user has scrolled down far
 * enough to make it useful. Called after any render that could change
 * the panel's content height (open, resume changes, AI results
 * appearing/updating, loading-state swaps) and on scroll/resize.
 */
function updateGoToTopVisibility() {
  const scrollArea = els.detailsScrollArea;
  const btn = els.detailsGoToTopBtn;
  if (!scrollArea || !btn) return;

  const isScrollable = scrollArea.scrollHeight > scrollArea.clientHeight;
  const scrolledDown = scrollArea.scrollTop > GO_TO_TOP_SHOW_THRESHOLD_PX;
  btn.hidden = !(isScrollable && scrolledDown);
}

function detailField(label, value, isHtml) {
  const displayValue = value
    ? (isHtml ? value : escapeHtml(value))
    : `<span class="detail-group__value--empty">Not specified</span>`;
  return `
    <div class="detail-group">
      <div class="detail-group__label">${label}</div>
      <div class="detail-group__value">${displayValue}</div>
    </div>
  `;
}

function detailBlock(label, value, isHtml) {
  const displayValue = value
    ? (isHtml ? value : escapeHtml(value).replace(/\n/g, "<br>"))
    : `<span class="detail-group__value--empty">Not provided</span>`;
  return `
    <div class="detail-group">
      <div class="detail-group__label">${label}</div>
      <div class="detail-group__value">${displayValue}</div>
    </div>
  `;
}

/** Joins the checked skills with the free-text "Other" entry, for display. */
function combineSkillsText(skillsArray, otherText) {
  const parts = Array.isArray(skillsArray) ? [...skillsArray] : [];
  if (otherText && otherText.trim()) parts.push(otherText.trim());
  return parts.join(", ");
}

/** Combines a currency symbol with a salary amount for display, e.g. "₱ 60,000/mo". */
function formatSalaryDisplay(currency, amount) {
  if (!amount) return "";
  return `${currency || "₱"} ${amount}`;
}

/** Shows the entered detail when Client based is "Other", e.g. "Other: Japan". */
function formatClientBasedDisplay(clientBased, otherText) {
  if (clientBased === "Other" && otherText && otherText.trim()) {
    return `Other: ${otherText.trim()}`;
  }
  return clientBased;
}

/** Shows the entered detail when Source is "Other", e.g. "Other: Friend referral". */
function formatSourceDisplay(source, otherText) {
  if (source === "Other" && otherText && otherText.trim()) {
    return `Other: ${otherText.trim()}`;
  }
  return source;
}

/** Shows the entered month count when Employment type is "Project-based", e.g. "Project-based: 6 months". */
function formatEmploymentTypeDisplay(employmentType, months) {
  if (employmentType === "Project-based" && months && String(months).trim()) {
    return `Project-based: ${String(months).trim()} months`;
  }
  return employmentType;
}

function linkHtml(url) {
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
}

function closeDetails() {
  els.detailsOverlay.hidden = true;
  currentDetailsId = null;
}

/* ---------------------------------------------------------
   7. DELETE CONFIRMATION
   --------------------------------------------------------- */

function openDeleteConfirm(id) {
  pendingDeleteId = id;
  els.deleteOverlay.hidden = false;
}

function closeDeleteConfirm() {
  pendingDeleteId = null;
  els.deleteOverlay.hidden = true;
}

function confirmDelete() {
  if (!pendingDeleteId) return;
  const updatedApplications = applications.filter((a) => a.id !== pendingDeleteId);
  const saved = saveApplications(updatedApplications);
  if (!saved) {
    showToast("Couldn't delete — your browser's storage may be full or unavailable.");
    closeDeleteConfirm();
    return;
  }
  applications = updatedApplications;
  renderAll();
  closeDeleteConfirm();
  closeDetails();
  showToast("Application deleted.", true);
}

/* ---------------------------------------------------------
   8. EXPORT TO JSON
   --------------------------------------------------------- */

function exportToJson() {
  if (applications.length === 0) {
    showToast("Nothing to export yet.");
    return;
  }

  const exportPayload = { version: APP_VERSION, applications };
  const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const dateStamp = new Date().toISOString().slice(0, 10);

  a.href = url;
  a.download = `jobtrack-ai-backup-${dateStamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast("Backup file downloaded.");
}

/* ---------------------------------------------------------
   9. SMALL HELPERS
   --------------------------------------------------------- */

function formatDate(isoDate) {
  if (!isoDate) return "—";
  const date = new Date(isoDate + "T00:00:00");
  if (isNaN(date)) return isoDate;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// Prevents any saved text (job titles, notes, etc.) from being treated
// as HTML when we insert it into the page — keeps the app safe from
// broken markup, and from HTML/attribute injection via saved values
// like the Job URL (which gets interpolated inside an href="...").
function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

let toastTimeout;
function showToast(message, isSuccess) {
  els.toast.textContent = message;
  els.toast.classList.toggle("toast--success", !!isSuccess);
  els.toast.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    els.toast.hidden = true;
  }, 2800);
}

/* ---------------------------------------------------------
   10. EVENT LISTENERS
   --------------------------------------------------------- */

function attachEventListeners() {
  // Open add form
  els.addBtn.addEventListener("click", () => openForm(null));
  els.emptyStateBtn.addEventListener("click", () => openForm(null));

  // Close/cancel form
  els.closeFormBtn.addEventListener("click", closeForm);
  els.cancelFormBtn.addEventListener("click", closeForm);
  els.appForm.addEventListener("submit", handleFormSubmit);

  // Required/Nice-to-Have skill checkboxes: checking one disables its
  // matching counterpart in the other grid, live, per-skill (delegated
  // so this covers every checkbox without one listener each).
  document.getElementById("requiredSkillsGrid").addEventListener("change", handleSkillCheckboxChange);
  document.getElementById("niceToHaveSkillsGrid").addEventListener("change", handleSkillCheckboxChange);

  Object.keys(FIELD_RULES).forEach((field) => {
    const el = document.getElementById(field);
    if (!el) return;
    const eventName = el.tagName === "SELECT" || el.type === "date" ? "change" : "input";
    el.addEventListener(eventName, () => clearFieldErrorIfNowValid(field));
  });

  document.getElementById("source").addEventListener("change", () => {
    syncOtherField(document.getElementById("source"), document.getElementById("sourceOtherWrap"));
    clearFieldErrorIfNowValid("sourceOther");
  });
  document.getElementById("clientBased").addEventListener("change", () => {
    syncOtherField(document.getElementById("clientBased"), document.getElementById("clientBasedOtherWrap"));
    clearFieldErrorIfNowValid("clientBasedOther");
  });
  document.getElementById("employmentType").addEventListener("change", () => {
    syncEmploymentTypeMonthsField();
    clearFieldErrorIfNowValid("employmentTypeMonths");
  });
  document.getElementById("status").addEventListener("change", () => {
    syncInterviewDateField();
    syncActualSalaryOfferField();
  });

  // Details panel
  els.closeDetailsBtn.addEventListener("click", closeDetails);
  els.detailsCloseBtn.addEventListener("click", closeDetails);
  els.detailsEditBtn.addEventListener("click", () => {
    const id = currentDetailsId;
    closeDetails();
    openForm(id);
  });

  // Go-to-top control: scrolls the PANEL's own scroll container, never
  // the underlying page, and stays in sync with actual overflow/scroll
  // position rather than a fixed open/close toggle.
  els.detailsGoToTopBtn.addEventListener("click", () => {
    els.detailsScrollArea.scrollTo({ top: 0, behavior: "smooth" });
  });
  els.detailsScrollArea.addEventListener("scroll", updateGoToTopVisibility);
  window.addEventListener("resize", updateGoToTopVisibility);

  // Delete confirmation
  els.cancelDeleteBtn.addEventListener("click", closeDeleteConfirm);
  els.confirmDeleteBtn.addEventListener("click", confirmDelete);

  // Export
  els.exportBtn.addEventListener("click", exportToJson);

  // Search / filter / sort — re-render as the user types or picks options
  els.searchInput.addEventListener("input", () => {
    els.clearSearchBtn.hidden = els.searchInput.value.length === 0;
    renderList();
  });
  els.clearSearchBtn.addEventListener("click", () => {
    els.searchInput.value = "";
    els.clearSearchBtn.hidden = true;
    els.searchInput.focus();
    renderList();
  });
  els.filterStatus.addEventListener("change", renderList);
  els.filterSource.addEventListener("change", renderList);
  els.sortBy.addEventListener("change", renderList);

  els.resetFiltersBtn.addEventListener("click", () => {
    els.searchInput.value = "";
    els.clearSearchBtn.hidden = true;
    els.filterStatus.value = "";
    els.filterSource.value = "";
    els.sortBy.value = "date-desc";
    renderList();
  });

  // Clicking the dark overlay background (not the panel itself) closes it.
  // The add/edit form is deliberately excluded: accidentally clicking outside
  // it should never wipe out details you've already typed in. The close
  // button (or Cancel) is the only way to dismiss that one.
  [els.detailsOverlay, els.deleteOverlay].forEach((overlay) => {
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        overlay.hidden = true;
        if (overlay === els.deleteOverlay) pendingDeleteId = null;
        if (overlay === els.detailsOverlay) currentDetailsId = null;
      }
    });
  });

  // Escape key closes whichever panel is open. The add/edit form is
  // excluded, same as the outside-click behavior above — Cancel or the
  // close button are the only way to dismiss it, so a stray Escape
  // press can't quietly discard what's been typed.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!els.detailsOverlay.hidden) closeDetails();
    else if (!els.deleteOverlay.hidden) closeDeleteConfirm();
  });
}

/* ---------------------------------------------------------
   Run it
   --------------------------------------------------------- */
init();
