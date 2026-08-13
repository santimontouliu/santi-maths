// ============================================================================
// chaos.js — canvas engine for the Structural Stability & Chaos entry.
//
// Four visuals, one per section, all sharing the closed-form math in
// dynamics.js. Structure mirrors surface-dynamics.js: canvas + coordinate
// setup, a theme-aware palette, one draw function per section, and the
// scroll-driven render loop.
// ============================================================================

import { initTheme, cssVar } from "./theme.js";
import { createSectionTracker, sectionScrollProgress } from "./scroll.js";
import {
  diagonalFlow,
  streamline,
  horseshoeOutline,
  cantorIntervals,
  solenoidGeneration,
  embedTorus,
  project3D,
} from "./dynamics.js";

// ----------------------------------------------------------------------------
// 1. Canvas + coordinate setup
// ----------------------------------------------------------------------------

const canvas = document.getElementById("scene-canvas");
const ctx = canvas.getContext("2d");
const sceneContainer = canvas.parentElement;

let w = 0, h = 0, cx = 0, cy = 0;

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  w = sceneContainer.clientWidth;
  h = sceneContainer.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cx = w / 2;
  cy = h / 2;
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// A mapper turns local plane coordinates into canvas pixels, centered at
// (originX, originY) with `extent` local units filling the shorter side.
// `widthBudget` caps how much horizontal room the mapper is allowed to use
// (default: the full canvas) — pass a fraction of `w` when several panels
// share the canvas side by side, so their content can't bleed into a
// neighboring panel.
function mapper(extent, originX = cx, originY = cy, widthBudget = w) {
  const s = (Math.min(widthBudget, h) * 0.46) / extent;
  return (p) => ({ x: originX + p.x * s, y: originY - p.y * s });
}

function strokePath(points, map, color, lineWidth, opacity = 1) {
  if (points.length < 2) return;
  ctx.beginPath();
  const p0 = map(points[0]);
  ctx.moveTo(p0.x, p0.y);
  for (let i = 1; i < points.length; i++) {
    const p = map(points[i]);
    ctx.lineTo(p.x, p.y);
  }
  ctx.strokeStyle = color;
  ctx.globalAlpha = opacity;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function fillPolygon(points, map, color, opacity = 1) {
  if (points.length < 3) return;
  ctx.beginPath();
  const p0 = map(points[0]);
  ctx.moveTo(p0.x, p0.y);
  for (let i = 1; i < points.length; i++) {
    const p = map(points[i]);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.globalAlpha = opacity;
  ctx.fill();
  ctx.globalAlpha = 1;
}

function dot(p, map, radius, color, opacity = 1) {
  const c = map(p);
  ctx.beginPath();
  ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.globalAlpha = opacity;
  ctx.fill();
  ctx.globalAlpha = 1;
}

// Runs drawFn with drawing clipped to a circle — a uniform, clean crop for
// a panel's content, instead of every curve individually deciding where to
// stop (which produces a jagged, inconsistent-looking edge).
function clipCircle(centerX, centerY, radiusPx, drawFn) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(centerX, centerY, radiusPx, 0, Math.PI * 2);
  ctx.clip();
  drawFn();
  ctx.restore();
}

// A dot with a soft halo, for particles that need to read clearly as
// moving sparks against thin static line art.
function glowDot(p, map, radius, color, opacity = 1) {
  const c = map(p);
  ctx.globalAlpha = opacity * 0.3;
  ctx.beginPath();
  ctx.arc(c.x, c.y, radius * 2.6, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = opacity;
  ctx.beginPath();
  ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

// Fade envelope for a particle looping through a cycle of length 1: ramps
// in, holds, ramps out, so it never just pops in/out of existence.
function loopFade(phase, sharpness = 5) {
  return Math.min(1, phase * sharpness) * Math.min(1, (1 - phase) * sharpness);
}

function label(text, x, y, color, opacity = 1, size = 11) {
  ctx.font = `${size}px "JetBrains Mono", monospace`;
  ctx.fillStyle = color;
  ctx.globalAlpha = opacity;
  ctx.textAlign = "center";
  ctx.fillText(text, x, y);
  ctx.globalAlpha = 1;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}
function smoothstep(x, a, b) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

// ----------------------------------------------------------------------------
// 2. Theme-aware palette
// ----------------------------------------------------------------------------

const QUALITATIVE = {
  light: ["#3a5a8c", "#c98a4b", "#6b8f71", "#a15c7a"],
  dark: ["#8fb3e8", "#e0a868", "#8fc49a", "#c98fb0"],
};

let palette = {};

function readPalette(theme) {
  palette = {
    theme,
    boundary: cssVar("--border"),
    grid: cssVar("--text-tertiary"),
    text: cssVar("--text-secondary"),
    accent: cssVar("--scene-point-a"),
    accent2: cssVar("--scene-point-b"),
    qual: QUALITATIVE[theme === "dark" ? "dark" : "light"],
  };
}

initTheme(readPalette);

// ----------------------------------------------------------------------------
// 3. Four visuals, one per section
// ----------------------------------------------------------------------------

// -- Visual 1: a fragile homoclinic loop (unstable) beside a saddle that
// stays a saddle (stable). -----------------------------------------------
//
// The loop is a real example, not a decorative curve: dx/dt = y,
// dy/dt = x - x^2 (Strogatz's standard saddle-connection system) has
// Hamiltonian H(x,y) = y^2/2 - x^2/2 + x^3/3, a saddle at (0,0), and a
// center at (1,0). The level set H=0 through the saddle is a closed loop
// enclosing the center, for x in [0, 1.5] — the trajectory leaves the
// saddle and arrives back at itself.

const LOOP_SHIFT = 0.75; // recenters the loop (x in [0, 1.5]) around x=0

function loopHalfY(x) {
  return Math.sqrt(Math.max(0, x * x - (2 / 3) * x * x * x));
}

// The outer loop itself (H=0), sampled explicitly since it passes exactly
// through the saddle at x=0, where the generic level-set walk below
// wouldn't stay put.
function homoclinicLoopPoints(steps = 140) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const x = (1.5 * i) / steps;
    pts.push({ x: x - LOOP_SHIFT, y: loopHalfY(x) });
  }
  for (let i = steps; i >= 0; i--) {
    const x = (1.5 * i) / steps;
    pts.push({ x: x - LOOP_SHIFT, y: -loopHalfY(x) });
  }
  return pts;
}

// An inner closed orbit at Hamiltonian level H=c, -1/6 < c < 0 (the center
// itself is at H=-1/6; the outer loop is H=0) — found by walking outward
// from x=1 until the level set closes on itself.
function innerOrbitPoints(c, steps = 90) {
  const f = (x) => 2 * c + x * x - (2 / 3) * x * x * x;
  let lo = 1, hi = 1;
  const step = 0.001;
  while (f(lo - step) >= 0 && lo > -1) lo -= step;
  while (f(hi + step) >= 0 && hi < 2) hi += step;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const x = lo + (hi - lo) * (i / steps);
    pts.push({ x: x - LOOP_SHIFT, y: Math.sqrt(Math.max(0, f(x))) });
  }
  for (let i = steps; i >= 0; i--) {
    const x = lo + (hi - lo) * (i / steps);
    pts.push({ x: x - LOOP_SHIFT, y: -Math.sqrt(Math.max(0, f(x))) });
  }
  return pts;
}

const HOMOCLINIC_LOOP = homoclinicLoopPoints();
const INNER_ORBITS = [-0.14, -0.09, -0.05, -0.02].map((c) => innerOrbitPoints(c));
const SADDLE_P = { x: -LOOP_SHIFT, y: 0 };
const CENTER_O = { x: 1 - LOOP_SHIFT, y: 0 };
const POINT_Q = { x: 0.4 - LOOP_SHIFT, y: loopHalfY(0.4) };

// Position on the outer loop at a looping phase in [0,1) — eased to slow
// down near the saddle (phase 0≡1), the way a real trajectory asymptotic
// to a fixed point would.
function homoclinicPosition(phase) {
  const eased = phase - Math.sin(2 * Math.PI * phase) / (2 * Math.PI);
  const x = eased < 0.5 ? 3 * eased : 3 * (1 - eased);
  const y = eased < 0.5 ? loopHalfY(x) : -loopHalfY(x);
  return { x: x - LOOP_SHIFT, y };
}

// Position at fraction `phase` (wraps mod 1) along a sampled closed path —
// used to animate a particle orbiting one of the inner curves.
function pointAlongPath(points, phase) {
  const frac = ((phase % 1) + 1) % 1;
  const idx = frac * (points.length - 1);
  const i0 = Math.floor(idx);
  const i1 = Math.min(points.length - 1, i0 + 1);
  const f = idx - i0;
  const a = points[i0], b = points[i1];
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

function drawStability(progress, t) {
  const loopExtent = 1.05;
  // The saddle's four arms read as sparser than a filled shape at the
  // same scale, so its panel is zoomed in further to make it equally
  // prominent (see the offsets below, sized to match this tighter extent).
  const saddleExtent = 1.35;
  const panelWidthBudget = w * 0.42; // keeps each panel's content off its neighbor
  const leftX = cx - w * 0.26;
  const rightX = cx + w * 0.26;
  const mapL = mapper(loopExtent, leftX, cy, panelWidthBudget);
  const mapR = mapper(saddleExtent, rightX, cy, panelWidthBudget);
  // Both mappers scale their own extent to this same pixel radius, so one
  // clip radius crops either panel cleanly, instead of every curve
  // individually deciding (at a different point) where to stop.
  const panelRadiusPx = Math.min(panelWidthBudget, h) * 0.46;

  // Left panel: the homoclinic loop. It's an exact fixed curve — scroll
  // progress only reveals q's label, tying the marker to the paragraph
  // that introduces it, rather than distorting the geometry itself.
  clipCircle(leftX, cy, panelRadiusPx, () => {
    strokePath([...HOMOCLINIC_LOOP, HOMOCLINIC_LOOP[0]], mapL, palette.accent, 1.8, 0.85);
    INNER_ORBITS.forEach((orbit, i) => {
      strokePath([...orbit, orbit[0]], mapL, palette.accent, 1, 0.32 - i * 0.03);
    });

    dot(SADDLE_P, mapL, 3.5, palette.accent2, 0.95);
    dot(CENTER_O, mapL, 3, palette.accent2, 0.75);
    const pPx = mapL(SADDLE_P), oPx = mapL(CENTER_O);
    label("p", pPx.x, pPx.y - 11, palette.text, 0.85, 12);
    label("o", oPx.x, oPx.y - 10, palette.text, 0.85, 12);

    const qOpacity = Math.min(1, progress / 0.5);
    if (qOpacity > 0.01) {
      dot(POINT_Q, mapL, 2.6, palette.qual[2], 0.9 * qOpacity);
      const qPx = mapL(POINT_Q);
      label("q", qPx.x + 12, qPx.y - 4, palette.text, 0.85 * qOpacity, 12);
    }

    // A particle slowly tracing the loop, real time, easing to a crawl
    // near the saddle — visibly the same "leaves p, returns to p" story
    // the text describes, not just a static picture of it.
    glowDot(homoclinicPosition((t * 0.00006) % 1), mapL, 3.2, palette.accent2, 0.9);

    // A couple of particles orbiting an inner closed curve near o.
    const orbitPath = INNER_ORBITS[2];
    for (let i = 0; i < 2; i++) {
      const phase = (t * 0.00045 + i * 0.5) % 1;
      glowDot(pointAlongPath(orbitPath, phase), mapL, 2.4, palette.accent2, 0.8);
    }
  });

  // Right panel: saddle -> saddle. Eigenvalues change magnitude but never
  // sign, so the qualitative picture never changes.
  const l1 = 1 + progress * 0.4;
  const l2 = -1 - progress * 0.4;
  const flow = (x0, y0, tt) => diagonalFlow(l1, l2, x0, y0, tt);

  clipCircle(rightX, cy, panelRadiusPx, () => {
    // Particles genuinely flowing along the saddle: two start near the
    // origin and ride the unstable direction outward, two start near the
    // panel edge and ride the stable direction inward — both directions
    // of the actual dynamics, moving continuously regardless of scroll.
    const T = saddleExtent * 1.6;
    const edge = saddleExtent * 0.92;
    const particleDefs = [
      { x0: 0.04, y0: 0 }, { x0: -0.04, y0: 0 },
      { x0: 0, y0: edge }, { x0: 0, y0: -edge },
    ];
    particleDefs.forEach((seed, i) => {
      const tLocal = (t * 0.00042 + i * (T / 4)) % T;
      const phase = tLocal / T;
      const p = flow(seed.x0, seed.y0, tLocal);
      glowDot(p, mapR, 3.6, palette.accent2, 0.95 * loopFade(phase));
    });

    // Seeds sit ON THE DIAGONAL (comparable x0, y0), not hugging an axis —
    // a seed like (0.01, off) stays glued to the y-axis for almost its
    // entire length, with the actual hyperbola curvature squeezed into a
    // sliver near the origin, which read as dense straight spokes rather
    // than a family of curves. Starting at (d, d) puts the seed at the
    // curve's own vertex, so it bows visibly across its whole length.
    const diagonals = [0.12, 0.25, 0.42, 0.62, 0.85];
    const seeds = [];
    for (const d of diagonals) {
      seeds.push([d, d], [d, -d], [-d, d], [-d, -d]);
    }
    for (const [x0, y0] of seeds) {
      const fwd = streamline(flow, x0, y0, 0, 3, 40, saddleExtent * 4);
      const bwd = streamline(flow, x0, y0, 0, -3, 40, saddleExtent * 4);
      strokePath(bwd.reverse().concat(fwd), mapR, palette.accent, 1.6, 0.6);
    }
    dot({ x: 0, y: 0 }, mapR, 3.5, palette.accent2, 0.95);
  });

  label("homoclinic loop (fragile)", leftX, cy + h * 0.36, palette.text, 0.8);
  label("saddle stays a saddle (stable)", rightX, cy + h * 0.36, palette.text, 0.8);

  const divider = mapper(1);
  ctx.beginPath();
  ctx.moveTo(cx, cy - h * 0.4);
  ctx.lineTo(cx, cy + h * 0.4);
  ctx.strokeStyle = palette.boundary;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// -- Visual 2: hyperbolic fixed points — sink -> saddle -> source. ---------

function eigenvaluesForProgress(p) {
  const sink = [-1, -1], saddle = [1, -1], source = [1, 1];
  if (p < 0.5) {
    const u = p / 0.5;
    return [lerp(sink[0], saddle[0], u), lerp(sink[1], saddle[1], u)];
  }
  const u = (p - 0.5) / 0.5;
  return [lerp(saddle[0], source[0], u), lerp(saddle[1], source[1], u)];
}

function drawHyperbolicPoint(progress, t) {
  const extent = 2.3;
  const map = mapper(extent);
  const [l1, l2] = eigenvaluesForProgress(progress);
  const flow = (x0, y0, tt) => diagonalFlow(l1, l2, x0, y0, tt);

  const ringRadii = [0.12, 0.3, 0.55, 0.9];
  const dirsPerRing = 10;
  for (const r0 of ringRadii) {
    for (let i = 0; i < dirsPerRing; i++) {
      const a = (i / dirsPerRing) * Math.PI * 2 + (r0 === ringRadii[0] ? 0 : 0.15);
      const x0 = r0 * Math.cos(a), y0 = r0 * Math.sin(a);
      const fwd = streamline(flow, x0, y0, 0, 2.4, 36, extent * 0.98);
      const bwd = streamline(flow, x0, y0, 0, -2.4, 36, extent * 0.98);
      strokePath(bwd.reverse().concat(fwd), map, palette.accent, 1, 0.32);
    }
  }

  // Eigen-directions: color by contracting (stable) vs expanding (unstable).
  const axisColor = (lambda) => (lambda < 0 ? palette.grid : palette.accent2);
  strokePath([{ x: -extent, y: 0 }, { x: extent, y: 0 }], map, axisColor(l1), 1.6, 0.7);
  strokePath([{ x: 0, y: -extent }, { x: 0, y: extent }], map, axisColor(l2), 1.6, 0.7);
  dot({ x: 0, y: 0 }, map, 4, palette.accent2, 0.95);

  const kind = l1 < 0 && l2 < 0 ? "sink" : l1 > 0 && l2 > 0 ? "source" : "saddle";
  label(kind, cx, cy + h * 0.4, palette.text, 0.85, 13);
}

// -- Visual 3: the Smale horseshoe — stretch, fold, and the Cantor skeleton
// of points that survive every iterate. -------------------------------------

const HORSESHOE_OUTLINE = horseshoeOutline(50);

function drawHorseshoe(progress, t) {
  const extent = 1.9;
  const map = mapper(extent);

  // The unit square Q is always visible as the reference frame.
  strokePath(
    [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }, { x: -1, y: -1 }],
    map,
    palette.grid,
    1.4,
    0.7
  );

  const foldIn = smoothstep(progress, 0, 0.4);
  const foldOut = 1 - smoothstep(progress, 0.4, 0.75) * 0.85;
  if (foldIn > 0) {
    fillPolygon(HORSESHOE_OUTLINE, map, palette.accent, 0.16 * foldIn * foldOut);
    strokePath([...HORSESHOE_OUTLINE, HORSESHOE_OUTLINE[0]], map, palette.accent, 1.6, foldIn * foldOut);
  }

  const cantorDepth = 1 + Math.floor(smoothstep(progress, 0.15, 1) * 5);
  const intervals = cantorIntervals(cantorDepth, 0.42);
  const stripAlpha = smoothstep(progress, 0.1, 0.35);
  for (const [a, b] of intervals) {
    fillPolygon(
      [{ x: a, y: -1 }, { x: b, y: -1 }, { x: b, y: 1 }, { x: a, y: 1 }],
      map,
      palette.accent2,
      0.5 * stripAlpha
    );
  }

  label(`level ${cantorDepth} — ${2 ** cantorDepth} strips`, cx, cy + h * 0.4, palette.text, 0.85);
}

// -- Visual 4: the solenoid attractor — nested, doubly-winding tubes. ------

const SOLENOID_R = 1.4;
const SOLENOID_CONTRACTION = 0.42;
const SOLENOID_OFFSET = 0.5;
const SOLENOID_GENERATIONS = [0, 1, 2, 3].map((k) =>
  solenoidGeneration(k, 320, SOLENOID_CONTRACTION, SOLENOID_OFFSET)
);

function drawSolenoid(progress, t) {
  const extent = 2.3;
  const map = mapper(extent);
  const spin = t * 0.00006;
  const rotX = 0.42;

  const maxGen = Math.min(3, Math.floor(smoothstep(progress, 0, 1) * 4));
  for (let k = 0; k <= maxGen; k++) {
    const gen = SOLENOID_GENERATIONS[k];
    const projected = gen.map((pt) => {
      const world = embedTorus(pt.theta, pt.z, SOLENOID_R);
      return project3D(world, spin, rotX);
    });

    const isNewest = k === maxGen;
    const baseOpacity = isNewest ? 0.95 : 0.28;
    const color = palette.qual[k % palette.qual.length];
    const width = isNewest ? 1.8 : 1;

    // Draw as short segments so depth (projected.depth) can fade the far
    // side of the loop, a cheap stand-in for real occlusion.
    for (let i = 0; i < projected.length - 1; i++) {
      const p0 = projected[i], p1 = projected[i + 1];
      const depthFade = 0.55 + 0.45 * (1 - clamp01((p0.depth + 2.2) / 4.4));
      strokePath([p0, p1], map, color, width, baseOpacity * depthFade);
    }
  }

  label(`generation ${maxGen} — winds ${2 ** maxGen}×`, cx, cy + h * 0.4, palette.text, 0.85);
}

// ----------------------------------------------------------------------------
// updateScene(sectionIndex, progress) — the single dispatch point.
// ----------------------------------------------------------------------------

const VISUALS = [drawStability, drawHyperbolicPoint, drawHorseshoe, drawSolenoid];

function updateScene(sectionIndex, progress, t) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const draw = VISUALS[sectionIndex] ?? VISUALS[0];
  draw(progress, t);
}

// ----------------------------------------------------------------------------
// 4. Scroll wiring + render loop
// ----------------------------------------------------------------------------

const sections = Array.from(document.querySelectorAll(".story-section"));
const stageLabel = document.getElementById("scene-stage-label");

const STAGE_LABELS = [
  "01 — Stability",
  "02 — Hyperbolic Points",
  "03 — Smale Horseshoe",
  "04 — Solenoid Attractor",
];

const tracker = createSectionTracker(sections, (index) => {
  stageLabel.textContent = STAGE_LABELS[index] ?? "";
});

function animate(t) {
  requestAnimationFrame(animate);
  const section = sections[tracker.active];
  const progress = section ? sectionScrollProgress(section) : 0;
  updateScene(tracker.active, progress, t);
}

requestAnimationFrame(animate);
