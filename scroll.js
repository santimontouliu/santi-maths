// scroll.js — shared scrollytelling wiring: which <section> is active, and
// how far the reader has scrolled through it. Used by every entry page.

// Tracks which of `sections` is centered in the viewport. Each section
// must carry data-index. onActivate(index) fires whenever the active
// section changes.
export function createSectionTracker(sections, onActivate) {
  let active = 0;
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          active = Number(entry.target.dataset.index);
          onActivate(active);
        }
      });
    },
    { root: null, rootMargin: "-45% 0px -45% 0px", threshold: 0 }
  );
  sections.forEach((s) => observer.observe(s));
  return { get active() { return active; } };
}

// 0..1 progress through `section`, based on its position in the viewport.
export function sectionScrollProgress(section) {
  const rect = section.getBoundingClientRect();
  const viewportH = window.innerHeight;
  const raw = (viewportH - rect.top) / (viewportH + rect.height);
  return Math.min(1, Math.max(0, raw));
}
