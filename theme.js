// theme.js — shared light/dark toggle, used by every entry page.
// Storage key is intentionally shared across entries so a visitor's choice
// on one page carries over to the next.

const STORAGE_KEY = "site-theme";

function preferredTheme() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// Wires the #theme-toggle button and applies [data-theme] to <html>.
// onChange(theme) fires once immediately and again on every switch, so
// callers can resync theme-dependent canvas colors.
export function initTheme(onChange) {
  const root = document.documentElement;
  const btn = document.getElementById("theme-toggle");
  let theme = preferredTheme();

  function apply(next) {
    theme = next;
    root.setAttribute("data-theme", theme);
    btn.setAttribute("aria-pressed", String(theme === "dark"));
    if (onChange) onChange(theme);
  }

  btn.addEventListener("click", () => {
    localStorage.setItem(STORAGE_KEY, theme === "dark" ? "light" : "dark");
    apply(theme === "dark" ? "light" : "dark");
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    if (localStorage.getItem(STORAGE_KEY)) return; // explicit choice wins
    apply(e.matches ? "dark" : "light");
  });

  apply(theme);
}

export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
