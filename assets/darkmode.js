/* assets/darkmode.js — site-wide dark mode.
 *
 * Loaded synchronously in <head> (CSP-safe: same-origin file, no inline
 * script) so the theme attribute is applied before first paint — no
 * light-mode flash for dark-mode users.
 *
 * Behavior:
 *   1. Persisted choice wins (localStorage "cleardoc-theme").
 *   2. Otherwise follow the OS `prefers-color-scheme` and keep following
 *      live changes until the user makes an explicit choice.
 *   3. The nav #themeToggle button toggles + persists, and the
 *      theme-color meta is kept in sync so browser chrome matches.
 *   4. No-ops gracefully when localStorage / matchMedia are unavailable.
 */
(function () {
  "use strict";

  var KEY = "cleardoc-theme";
  var root = document.documentElement;
  var darkQuery =
    window.matchMedia
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;

  function savedChoice() {
    var saved = null;
    try { saved = window.localStorage.getItem(KEY); } catch (_) { /* ignore */ }
    return saved === "dark" || saved === "light" ? saved : null;
  }

  function currentTheme() {
    return savedChoice() || (darkQuery && darkQuery.matches ? "dark" : "light");
  }

  function apply(theme, persist) {
    root.setAttribute("data-theme", theme);
    if (persist) {
      try { window.localStorage.setItem(KEY, theme); } catch (_) { /* ignore */ }
    }
    var btn = document.getElementById("themeToggle");
    if (btn) {
      var dark = theme === "dark";
      btn.textContent = dark ? "☀️ light" : "🌙 dark";
      btn.setAttribute("aria-pressed", dark ? "true" : "false");
      btn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
      btn.title = dark ? "Switch to light mode" : "Switch to dark mode";
    }
    var meta = document.querySelector('meta[name="theme-color"]:not([media])');
    if (meta) meta.content = dark ? "#14120E" : "#fbf7ee";
  }

  apply(currentTheme(), false);

  function wire() {
    var btn = document.getElementById("themeToggle");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      apply(next, true);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }

  // Follow OS preference changes only until the user picks an explicit theme.
  if (darkQuery && darkQuery.addEventListener) {
    darkQuery.addEventListener("change", function (e) {
      if (savedChoice()) return;
      apply(e.matches ? "dark" : "light", false);
    });
  }
})();
