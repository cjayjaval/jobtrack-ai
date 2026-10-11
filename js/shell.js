/* =========================================================
   JobTrack AI — app shell (v0.4, Stage 1)

   Everything about the shell lives here so script.js / resume.js stay
   untouched:
     1. Hash router  (#dashboard, #applications, #analytics, #resumes, #settings)
     2. Navigation drawer (the sidebar below the drawer breakpoint)
     3. Local profile (preferred name) — NOT an account, NOT authentication
     4. Optional welcome prompt

   Loaded AFTER script.js and resume.js. It only reads their globals
   defensively (hidePopover, lockBodyScroll, unlockBodyScroll, showToast),
   so a missing helper can never stop the shell from working.

   Ground rules that keep the existing app safe:
     - Views are hidden/shown, never removed: script.js caches every element
       by id at load, so they must all stay in the DOM.
     - Navigation never makes a network request, and never touches the
       application data, the filters, or any saved state.
   ========================================================= */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const el = {
    sidebar: $("sidebar"),
    scrim: $("navScrim"),
    toggle: $("navToggleBtn"),
    topbarTitle: $("topbarTitle"),
    main: $("main-content"),
    skip: $("skipLink"),
    greeting: $("greetingText"),
    chip: $("profileChip"),
    chipAvatar: $("profileChipAvatar"),
    chipName: $("profileChipName"),
    profileForm: $("profileForm"),
    profileInput: $("profileNameInput"),
    profileStatus: $("profileStatus"),
    profileClear: $("profileClearBtn"),
    welcome: $("welcomeOverlay"),
    welcomeForm: $("welcomeForm"),
    welcomeInput: $("welcomeNameInput"),
    welcomeError: $("welcomeError"),
    welcomeSkip: $("welcomeSkipBtn"),
    backToTop: $("backToTopBtn"),
  };

  if (!el.sidebar || !el.main) {
    console.error("shell.js: the shell markup was not found in index.html; navigation is disabled.");
    return;
  }

  /* ---------------------------------------------------------
     1. ROUTES
     --------------------------------------------------------- */

  const ROUTES = {
    dashboard: { viewId: "view-dashboard", title: "Dashboard" },
    applications: { viewId: "view-applications", title: "Applications" },
    analytics: { viewId: "view-analytics", title: "Analytics" },
    resumes: { viewId: "view-resumes", title: "Resume Library" },
    settings: { viewId: "view-settings", title: "Settings" },
  };
  const DEFAULT_ROUTE = "dashboard";
  const APP_NAME = "JobTrack AI";

  /** The route named by the current URL hash, or null if it isn't a known one. */
  function routeFromHash() {
    const name = (window.location.hash || "").replace(/^#\/?/, "").split(/[?/]/)[0].toLowerCase();
    // hasOwnProperty: "#constructor" or "#__proto__" must not match Object.prototype.
    return Object.prototype.hasOwnProperty.call(ROUTES, name) ? name : null;
  }

  function showRoute(route, options) {
    const opts = options || {};

    Object.keys(ROUTES).forEach((key) => {
      const view = $(ROUTES[key].viewId);
      if (view) view.hidden = key !== route;
    });

    document.querySelectorAll(".nav-item[data-route]").forEach((link) => {
      const active = link.getAttribute("data-route") === route;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });

    const title = ROUTES[route].title;
    document.title = title + " · " + APP_NAME;
    if (el.topbarTitle) el.topbarTitle.textContent = title;

    if (route === "dashboard") renderGreeting();
    if (route === "settings") {
      el.profileInput.value = loadProfile().preferredName;
      setProfileStatus("", false);
    }

    closeDrawer(false);
    if (typeof hidePopover === "function") hidePopover();

    // v0.4.1: Dashboard/Applications can each scroll inside their own box on
    // desktop (see style.css, "Desktop scroll containment") — reset that
    // along with the page scroll, so switching views never lands mid-scroll
    // on a list left over from a previous visit.
    resetViewScroll($(ROUTES[route].viewId));
    updateBackToTopVisibility();

    if (opts.moveFocus) {
      window.scrollTo(0, 0);
      const heading = $(ROUTES[route].viewId).querySelector(".view__title");
      if (heading) heading.focus({ preventScroll: true });
    }
  }

  /** Resets a view's own scroll container(s) to the top — see showRoute() above. */
  function resetViewScroll(view) {
    if (!view) return;
    view.scrollTop = 0;
    view.querySelectorAll(".dash-scroll, .view__frame, .table-wrap").forEach((node) => {
      node.scrollTop = 0;
    });
  }

  /** Shows the view for the current hash; an empty/unknown hash becomes #dashboard without adding a history entry. */
  function applyCurrentRoute(isInitialLoad) {
    let route = routeFromHash();
    if (!route) {
      route = DEFAULT_ROUTE;
      try {
        window.history.replaceState(null, "", window.location.pathname + window.location.search + "#" + route);
      } catch (err) {
        /* Some environments (e.g. restricted file:// pages) refuse this; the default view still shows. */
      }
    }
    // On first load leave focus and scroll alone (the browser restores them on refresh).
    showRoute(route, { moveFocus: !isInitialLoad });
  }

  /* ---------------------------------------------------------
     2. NAVIGATION DRAWER (sidebar below the drawer breakpoint)
     --------------------------------------------------------- */

  // Keep in sync with the "Tier 3: drawer" media query in style.css.
  const DRAWER_QUERY = "(max-width: 1099px)";

  function isDrawerOpen() {
    return el.sidebar.classList.contains("is-open");
  }

  function openDrawer() {
    if (isDrawerOpen()) return;
    el.sidebar.classList.add("is-open");
    el.scrim.hidden = false;
    el.toggle.setAttribute("aria-expanded", "true");
    el.toggle.setAttribute("aria-label", "Close navigation menu");
    // Its own class, not script.js's scroll-locked: a utility button in the
    // drawer opens a modal that sets scroll-locked, and closing the drawer
    // must not undo that.
    document.body.classList.add("nav-open");
    const first = el.sidebar.querySelector(".nav-item.is-active") || el.sidebar.querySelector(".nav-item");
    if (first) first.focus();
  }

  /** No-op when the drawer is already closed (it is called on every route change). */
  function closeDrawer(returnFocus) {
    if (!isDrawerOpen()) return;
    el.sidebar.classList.remove("is-open");
    el.scrim.hidden = true;
    el.toggle.setAttribute("aria-expanded", "false");
    el.toggle.setAttribute("aria-label", "Open navigation menu");
    document.body.classList.remove("nav-open");
    if (returnFocus) el.toggle.focus();
  }

  /** Keeps Tab inside a small set of focusable elements (drawer, welcome prompt). */
  function trapTab(event, container) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(container.querySelectorAll("a[href], button:not([disabled]), input:not([disabled])"))
      .filter((node) => !node.hidden && node.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function wireNavigation() {
    window.addEventListener("hashchange", () => applyCurrentRoute(false));

    // A click on the link for the page you're already on doesn't change the
    // hash, so no hashchange fires — still close the drawer.
    el.sidebar.addEventListener("click", (event) => {
      if (event.target.closest(".nav-item[data-route], #howToUseBtn, #exportBtn, #profileChip")) closeDrawer(false);
    });

    el.toggle.addEventListener("click", () => (isDrawerOpen() ? closeDrawer(true) : openDrawer()));
    el.scrim.addEventListener("click", () => closeDrawer(true));

    document.addEventListener("keydown", (event) => {
      if (!isDrawerOpen()) return;
      if (event.key === "Escape") closeDrawer(true);
      else trapTab(event, el.sidebar);
    });

    // Growing the window past the drawer breakpoint must not leave the page scroll-locked.
    if (typeof window.matchMedia === "function") {
      const mq = window.matchMedia(DRAWER_QUERY);
      const onChange = (e) => {
        if (!e.matches) closeDrawer(false);
      };
      if (typeof mq.addEventListener === "function") mq.addEventListener("change", onChange);
      else if (typeof mq.addListener === "function") mq.addListener(onChange);
    }

    // The skip link points at #main-content, which isn't a route — handle it
    // here so it moves focus without touching the URL hash.
    el.skip.addEventListener("click", (event) => {
      event.preventDefault();
      el.main.focus();
    });
  }

  /* ---------------------------------------------------------
     v0.4.1. BACK TO TOP (mobile)

     Floating button shown only on Dashboard/Applications, only after
     scrolling the PAGE some meaningful distance, and only below the
     min-width:1100px tier (style.css hard-hides it on desktop too, as a
     safety net in case a resize is missed). Mirrors the existing
     "go to top" control in script.js (updateGoToTopVisibility), but for
     the page itself rather than the Application Details panel.
     --------------------------------------------------------- */

  const BACK_TO_TOP_SHOW_THRESHOLD_PX = 400;
  const BACK_TO_TOP_ROUTES = { dashboard: true, applications: true };

  function updateBackToTopVisibility() {
    if (!el.backToTop) return;
    const route = routeFromHash() || DEFAULT_ROUTE;
    const relevant = !!BACK_TO_TOP_ROUTES[route];
    const scrolledDown = window.scrollY > BACK_TO_TOP_SHOW_THRESHOLD_PX;
    el.backToTop.hidden = !(relevant && scrolledDown);
  }

  function wireBackToTop() {
    if (!el.backToTop) return;
    el.backToTop.addEventListener("click", () => {
      const reduceMotion = typeof window.matchMedia === "function"
        && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    });
    window.addEventListener("scroll", updateBackToTopVisibility, { passive: true });
    window.addEventListener("resize", updateBackToTopVisibility);
  }

  /* ---------------------------------------------------------
     3. LOCAL PROFILE (preferred name)

     jobtrackai_profile = { schemaVersion: 1, preferredName: "Jay" }

     A lightweight, browser-local preference — not an account, and not
     part of Export backup. Everything else in the UI goes through
     loadProfile() / saveProfile(); a future signed-in profile only has
     to replace these two functions.
     --------------------------------------------------------- */

  const PROFILE_KEY = "jobtrackai_profile";
  const PROFILE_SCHEMA_VERSION = 1;
  const NAME_MAX_LENGTH = 40;

  /** Trims, collapses whitespace, drops control characters and caps the length (by characters, not UTF-16 units). */
  function sanitizeName(value) {
    if (typeof value !== "string") return "";
    const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
    return Array.from(cleaned).slice(0, NAME_MAX_LENGTH).join("").trim();
  }

  function readStoredProfile() {
    try {
      const raw = localStorage.getItem(PROFILE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch (err) {
      // Corrupt JSON or storage blocked: behave as "no profile yet"; never break the app.
      console.error("Could not read the saved profile:", err);
      return null;
    }
  }

  function loadProfile() {
    const stored = readStoredProfile();
    return {
      schemaVersion: PROFILE_SCHEMA_VERSION,
      preferredName: stored ? sanitizeName(stored.preferredName) : "",
    };
  }

  /** Saves the preferred name ("" clears it). Fields this version doesn't know about are preserved. Returns true on success. */
  function saveProfile(preferredName) {
    const next = Object.assign({}, readStoredProfile() || {}, {
      schemaVersion: PROFILE_SCHEMA_VERSION,
      preferredName: sanitizeName(preferredName),
    });
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
      return true;
    } catch (err) {
      console.error("Could not save the profile:", err);
      return false;
    }
  }

  const USER_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="8" r="3.6"/><path d="M5 20c.8-3.6 3.6-5.4 7-5.4s6.2 1.8 7 5.4"/></svg>';

  function greetingPart(date) {
    const hour = date.getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }

  function renderGreeting() {
    const name = loadProfile().preferredName;
    const part = greetingPart(new Date());
    // textContent, never innerHTML: the name is user-entered text.
    el.greeting.textContent = name ? part + ", " + name : part;
  }

  /** Reflects the saved name everywhere it appears: greeting, sidebar chip, avatar. */
  function applyProfileToUI() {
    const name = loadProfile().preferredName;
    renderGreeting();
    if (name) el.chipAvatar.textContent = Array.from(name)[0].toUpperCase();
    else el.chipAvatar.innerHTML = USER_ICON; // static, trusted markup
    el.chipName.textContent = name || "Set your name";
    el.chip.setAttribute("aria-label", name ? name + " — profile settings" : "Set your name in profile settings");
  }

  function setProfileStatus(message, isError) {
    el.profileStatus.textContent = message;
    el.profileStatus.classList.toggle("form-msg--error", !!isError);
  }

  /** Settings → Profile: saving an empty value clears the name. */
  function commitProfileName(rawValue) {
    const name = sanitizeName(rawValue);
    if (!saveProfile(name)) {
      setProfileStatus("Couldn't save — your browser's storage may be full or unavailable.", true);
      return false;
    }
    el.profileInput.value = name;
    applyProfileToUI();
    setProfileStatus(name ? "Saved." : "Name cleared.", false);
    return true;
  }

  function wireProfile() {
    el.profileForm.addEventListener("submit", (event) => {
      event.preventDefault();
      commitProfileName(el.profileInput.value);
    });
    el.profileClear.addEventListener("click", () => {
      commitProfileName("");
      el.profileInput.focus();
    });
    el.profileInput.addEventListener("input", () => setProfileStatus("", false));
  }

  /* ---------------------------------------------------------
     4. WELCOME PROMPT (optional — never blocks use)

     Shown when there is no saved preferred name, unless it was already
     dismissed in THIS browser session. The dismissal lives in
     sessionStorage (gone when the session ends), deliberately NOT in the
     persistent profile — so a later visit asks again until a name is
     saved. Once a name exists it never shows.
     --------------------------------------------------------- */

  const WELCOME_SESSION_KEY = "jobtrackai_welcome_dismissed";
  let welcomeDismissedInMemory = false; // fallback if sessionStorage is unavailable
  let welcomeReturnFocus = null;

  function isWelcomeDismissed() {
    try {
      return sessionStorage.getItem(WELCOME_SESSION_KEY) === "1";
    } catch (err) {
      return welcomeDismissedInMemory;
    }
  }

  function markWelcomeDismissed() {
    welcomeDismissedInMemory = true;
    try {
      sessionStorage.setItem(WELCOME_SESSION_KEY, "1");
    } catch (err) {
      /* in-memory flag still covers this page load */
    }
  }

  function isWelcomeOpen() {
    return !el.welcome.hidden;
  }

  function openWelcome() {
    welcomeReturnFocus = document.activeElement;
    el.welcomeInput.value = "";
    el.welcomeError.textContent = "";
    el.welcome.hidden = false;
    if (typeof lockBodyScroll === "function") lockBodyScroll();
    el.welcomeInput.focus();
  }

  function closeWelcome() {
    el.welcome.hidden = true;
    if (typeof unlockBodyScroll === "function") unlockBodyScroll();
    if (welcomeReturnFocus && welcomeReturnFocus !== document.body && document.contains(welcomeReturnFocus)) {
      welcomeReturnFocus.focus();
    }
    welcomeReturnFocus = null;
  }

  /** Skip / Escape / clicking outside: don't ask again this session, save nothing. */
  function dismissWelcome() {
    markWelcomeDismissed();
    closeWelcome();
  }

  function maybeShowWelcome() {
    if (loadProfile().preferredName) return;
    if (isWelcomeDismissed()) return;
    openWelcome();
  }

  function wireWelcome() {
    el.welcomeForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = sanitizeName(el.welcomeInput.value);
      if (!name) {
        el.welcomeError.textContent = "Enter a name, or choose Skip for now.";
        el.welcomeInput.focus();
        return;
      }
      if (!saveProfile(name)) {
        el.welcomeError.textContent = "Couldn't save — browser storage may be unavailable. You can skip for now.";
        return;
      }
      closeWelcome();
      applyProfileToUI();
      if (typeof showToast === "function") showToast("Preferred name saved.", true);
    });

    el.welcomeInput.addEventListener("input", () => {
      el.welcomeError.textContent = "";
    });

    el.welcomeSkip.addEventListener("click", dismissWelcome);

    el.welcome.addEventListener("click", (event) => {
      if (event.target === el.welcome) dismissWelcome();
    });

    document.addEventListener("keydown", (event) => {
      if (!isWelcomeOpen()) return;
      if (event.key === "Escape") dismissWelcome();
      else trapTab(event, el.welcome);
    });
  }

  /* ---------------------------------------------------------
     Run it
     --------------------------------------------------------- */

  wireNavigation();
  wireBackToTop();
  wireProfile();
  wireWelcome();
  applyProfileToUI();
  applyCurrentRoute(true);
  maybeShowWelcome();
})();
