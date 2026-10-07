/* =========================================================
   JobTrack AI — Appearance (v0.4)

   Two presets: "light-glass" (the default) and "dark-glass".

   How it works:
     - The whole look is a set of CSS variables. Light Glass is the :root
       default in style.css; Dark Glass is ONE override block,
       :root[data-theme="dark-glass"]. This file only sets that attribute.
     - It is loaded in the <head>, BEFORE the stylesheet, and applies the
       saved theme immediately, so the first paint is already the right
       theme (no light-to-dark flash). If this file fails to load, or the
       saved value is missing/unknown/corrupt, the page simply stays Light
       Glass.
     - The preference lives in its own small versioned object, separate
       from the profile:
           localStorage "jobtrackai_preferences" =
             { "schemaVersion": 1, "theme": "light-glass" | "dark-glass" }
       Nothing is written until the person actually picks a theme.

   Classic script on purpose: no framework, no build step.
   ========================================================= */
(function () {
  "use strict";

  var STORAGE_KEY = "jobtrackai_preferences";
  var SCHEMA_VERSION = 1;
  var THEMES = ["light-glass", "dark-glass"];
  var DEFAULT_THEME = "light-glass";

  /** The stored preferences object, or {} if absent / unreadable / not an object. Never throws. */
  function readPreferences() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (err) {
      return {}; // blocked storage or corrupt JSON: behave as a first visit
    }
  }

  /** The saved theme if it is one we know; otherwise Light Glass. */
  function savedTheme() {
    var theme = readPreferences().theme;
    return THEMES.indexOf(theme) !== -1 ? theme : DEFAULT_THEME;
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
  }

  /** Persist without disturbing any other keys a future version may add. */
  function saveTheme(theme) {
    try {
      var prefs = readPreferences();
      prefs.schemaVersion = SCHEMA_VERSION;
      prefs.theme = theme;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
      return true;
    } catch (err) {
      return false; // e.g. private mode: the theme still applies for this visit
    }
  }

  function currentTheme() {
    var applied = document.documentElement.getAttribute("data-theme");
    return THEMES.indexOf(applied) !== -1 ? applied : DEFAULT_THEME;
  }

  /** Apply immediately, then remember. Unknown values are ignored. */
  function setTheme(theme) {
    if (THEMES.indexOf(theme) === -1) return false;
    applyTheme(theme);
    saveTheme(theme);
    syncRadios();
    return true;
  }

  // 1. Before anything paints.
  applyTheme(savedTheme());

  // 2. The Settings > Appearance radio cards, once the page exists.
  function syncRadios() {
    var radios = document.querySelectorAll('input[name="appearance"]');
    var active = currentTheme();
    for (var i = 0; i < radios.length; i++) radios[i].checked = radios[i].value === active;
  }

  function wireSettings() {
    syncRadios();
    var radios = document.querySelectorAll('input[name="appearance"]');
    for (var i = 0; i < radios.length; i++) {
      radios[i].addEventListener("change", function (event) {
        if (event.target.checked) setTheme(event.target.value);
      });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wireSettings);
  else wireSettings();

  // 3. Another tab changed the preference: follow it.
  window.addEventListener("storage", function (event) {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    applyTheme(savedTheme());
    syncRadios();
  });

  window.JobTrackTheme = { THEMES: THEMES.slice(), DEFAULT_THEME: DEFAULT_THEME, get: currentTheme, set: setTheme };
})();
