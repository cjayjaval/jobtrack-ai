/* =========================================================
   JobTrack AI — Dashboard (v0.4, Stage 2)

   Fills the Dashboard view from the applications that are ALREADY saved:
     1. Six summary cards (counts + "% of total")
     2. Recent Applications (the newest few, with Overall Match when known)
     3. Quick Actions

   Read-only by design: it never writes application data, never calls the
   API, and never changes how anything else works. It reuses script.js's own
   helpers instead of copying their logic:
     - STATUS_META ........... which status belongs to which summary bucket
                               (including legacy values like "Offer")
     - compareByDateApplied .. the same newest-first ordering the Applications
                               list uses, hidden-seconds tiebreaks included
     - statusPillHtml / formatDateAppliedHtml / overallMatchHtml / escapeHtml

   Loaded AFTER script.js, resume.js and shell.js. No file outside this one
   (and the Dashboard markup/CSS) needed to change.
   ========================================================= */
(function () {
  "use strict";

  const RECENT_LIMIT = 5;

  const view = document.getElementById("view-dashboard");
  const recentBody = document.getElementById("recentBody");
  const viewAllLink = document.getElementById("recentViewAll");

  if (
    !view || !recentBody || !viewAllLink ||
    typeof applications === "undefined" || typeof STATUS_META === "undefined" ||
    typeof compareByDateApplied !== "function" || typeof overallMatchHtml !== "function"
  ) {
    console.error("dashboard.js: the Dashboard markup or a script.js helper it relies on was not found; the Dashboard will stay empty.");
    return;
  }

  /* ---------------------------------------------------------
     1. Summary cards
     --------------------------------------------------------- */

  // The status-specific cards, in the order they appear. Each key is a
  // STATUS_META bucket. Rejected and Failed are separate buckets and stay
  // separate cards.
  const CARD_BUCKETS = ["applied", "interview", "offer", "rejected", "failed"];

  /**
   * Counts applications per summary bucket (via STATUS_META, so legacy status
   * values still land in the right card) and works out each bucket's share of
   * the total. A status that isn't in STATUS_META counts toward the total only.
   * With no applications every percentage is 0 — never NaN.
   */
  function summarize(apps) {
    const counts = {};
    CARD_BUCKETS.forEach((bucket) => { counts[bucket] = 0; });
    apps.forEach((app) => {
      const meta = STATUS_META[app.status];
      if (meta && Object.prototype.hasOwnProperty.call(counts, meta.bucket)) counts[meta.bucket] += 1;
    });
    const total = apps.length;
    const percent = {};
    CARD_BUCKETS.forEach((bucket) => { percent[bucket] = total > 0 ? (counts[bucket] / total) * 100 : 0; });
    return { total, counts, percent };
  }

  /** One decimal place, with a trailing ".0" dropped: 40 -> "40", 33.333 -> "33.3". */
  function formatPercent(value) {
    return String(Math.round(value * 10) / 10);
  }

  function renderCards(summary) {
    const total = document.getElementById("statTotal");
    if (total) total.textContent = String(summary.total);

    CARD_BUCKETS.forEach((bucket) => {
      const card = view.querySelector('.summary-card[data-stat="' + bucket + '"]');
      if (!card) return;
      const value = card.querySelector(".summary-card__value");
      const pctText = card.querySelector(".summary-card__pct");
      if (value) value.textContent = String(summary.counts[bucket]);
      if (pctText) pctText.textContent = formatPercent(summary.percent[bucket]) + "% of total";
      // The thin bar under the percentage is the same number, drawn: CSS reads --pct.
      card.style.setProperty("--pct", summary.percent[bucket].toFixed(2) + "%");
    });
  }

  /* ---------------------------------------------------------
     2. Recent Applications
     --------------------------------------------------------- */

  /**
   * The newest `limit` applications by Date applied. This is the Applications
   * list's own "newest" ordering (compareByDateApplied, reversed) — same
   * date-then-timestamp-then-creation-order tiebreaks — so the two can never
   * disagree about which application is more recent.
   */
  function recentApplications(apps, limit) {
    const originalIndex = new Map(apps.map((app, index) => [app, index]));
    return apps
      .slice()
      .sort((a, b) => -compareByDateApplied(a, b, originalIndex))
      .slice(0, limit);
  }

  const ICON_CLIPBOARD =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 3h6v3H9z"/><path d="M9 11h6M9 15h6"/></svg>';

  const EMPTY_STATE_HTML =
    '<div class="dash-empty">' +
    '<span class="dash-empty__icon" aria-hidden="true">' + ICON_CLIPBOARD + "</span>" +
    '<p class="dash-empty__title">No applications yet</p>' +
    '<p class="dash-empty__text">Add your first job application to start tracking your search.</p>' +
    '<button type="button" class="btn btn--primary" data-dash-action="add">+ Add application</button>' +
    "</div>";

  function recentRowHtml(app) {
    // Overall Match comes from script.js's own helper: a number only when a
    // saved analysis really has one, otherwise a neutral "not analyzed" state.
    const match = overallMatchHtml(app, "Not analyzed");
    // The hover/tap trigger already announces "Overall Match 44.44%"; only the
    // plain-text states need a spoken label.
    const matchLabel = match.indexOf("match-trigger") === -1 ? '<span class="sr-only">Overall match: </span>' : "";
    return (
      '<li class="recent-row">' +
      '<span class="recent-row__title">' + escapeHtml(app.jobTitle) + "</span>" +
      '<span class="recent-row__company"><span class="sr-only">Company: </span>' + escapeHtml(app.company) + "</span>" +
      // The compact (phone) layout reads "Applied Sep 20, 2026" with the date only; the wide
      // layout has a "Date applied" column header instead and still shows the time. Both
      // are done in CSS: the data and the time element are the same either way.
      '<span class="recent-row__date"><span class="sr-only">Applied: </span><span class="recent-row__applied" aria-hidden="true">Applied </span>' + formatDateAppliedHtml(app) + "</span>" +
      '<span class="recent-row__status"><span class="sr-only">Status: </span>' + statusPillHtml(app.status) + "</span>" +
      '<span class="recent-row__match">' + matchLabel + match + "</span>" +
      "</li>"
    );
  }

  function renderRecent(apps) {
    if (apps.length === 0) {
      recentBody.innerHTML = EMPTY_STATE_HTML;
      viewAllLink.hidden = true; // nothing to view yet
      return;
    }
    viewAllLink.hidden = false;
    recentBody.innerHTML =
      // Visual column labels only; each cell carries its own spoken label.
      '<div class="recent-head" aria-hidden="true">' +
      "<span>Job title</span><span>Company</span><span>Date applied</span><span>Status</span><span>Overall match</span>" +
      "</div>" +
      '<ol class="recent-list" aria-label="Most recently applied, newest first">' +
      recentApplications(apps, RECENT_LIMIT).map(recentRowHtml).join("") +
      "</ol>";
  }

  /* ---------------------------------------------------------
     3. Quick Actions

     Each one forwards to a control that already exists, so the real
     handler runs and nothing is duplicated:  Add Application -> #addBtn,
     How to Use -> #howToUseBtn. "View Applications" and "View all
     applications" are plain #applications links; the router does the rest.
     --------------------------------------------------------- */

  const ACTION_TARGETS = { add: "addBtn", howto: "howToUseBtn" };

  view.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-dash-action]");
    if (!trigger) return;
    const action = trigger.getAttribute("data-dash-action");
    if (!Object.prototype.hasOwnProperty.call(ACTION_TARGETS, action)) return;
    const target = document.getElementById(ACTION_TARGETS[action]);
    if (target) target.click();
  });

  /* ---------------------------------------------------------
     Rendering + when to refresh

     Nothing in script.js announces "the data changed", and this file must
     not change script.js. So it OBSERVES instead of intercepting:
       - the Add/Edit form, the delete confirmation and the details panel
         all close right AFTER the data is saved, so their `hidden`
         attribute flipping is the signal to refresh
       - every route change (back/forward included) refreshes too, which
         also covers an analysis finished while the Dashboard was hidden
     Rendering is a few rows, so refreshing a little often costs nothing.
     --------------------------------------------------------- */

  function render() {
    try {
      const apps = applications;
      renderCards(summarize(apps));
      renderRecent(apps);
    } catch (err) {
      // A Dashboard problem must never take the rest of the app down.
      console.error("Could not render the dashboard:", err);
    }
  }

  if (typeof MutationObserver === "function") {
    const observer = new MutationObserver(render);
    ["formOverlay", "deleteOverlay", "detailsOverlay"].forEach((id) => {
      const overlay = document.getElementById(id);
      if (overlay) observer.observe(overlay, { attributes: true, attributeFilter: ["hidden"] });
    });
  }
  window.addEventListener("hashchange", render);

  // Read-only helpers, exposed so they can be tested in isolation.
  window.JobTrackDashboard = { summarize, formatPercent, recentApplications, render };

  render();
})();
