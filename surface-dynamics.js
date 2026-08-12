// ============================================================================
// surface-dynamics.js — canvas engine for the Surface Dynamics entry.
//
// Everything here draws inside the Poincaré disk using the toolkit in
// hyperbolic.js (Möbius isometries + geodesic arcs + the genus-2 octagon
// tiling). There's no rendering library: it's 2D canvas, because circular
// arcs and exact Möbius maps are simpler to get right directly than to
// fake with a mesh-based renderer.
//
// Structure:
//   1. Canvas + coordinate setup (disk <-> pixel space).
//   2. Theme-aware palette.
//   3. Four draw functions, one per section, sharing the disk toolkit.
//   4. Scroll wiring (via scroll.js) + render loop.
// ============================================================================

import { initTheme, cssVar } from "./theme.js";
import { createSectionTracker, sectionScrollProgress } from "./scroll.js";
import {
  translation,
  geodesicPoints,
  geodesicLineThrough,
  octagonVertices,
  generateTiling,
  len,
  polar,
} from "./hyperbolic.js";

// ----------------------------------------------------------------------------
// 1. Canvas + coordinate setup
// ----------------------------------------------------------------------------

const canvas = document.getElementById("scene-canvas");
const ctx = canvas.getContext("2d");
const sceneContainer = canvas.parentElement;

let cx = 0, cy = 0, scale = 1; // disk (unit circle) -> canvas pixels

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = sceneContainer.clientWidth;
  const h = sceneContainer.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  cx = w / 2;
  cy = h / 2;
  scale = Math.min(w, h) * 0.46; // leaves a small margin around the disk
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

function toCanvas(p) {
  return { x: cx + p.x * scale, y: cy - p.y * scale };
}

function strokePath(points, color, lineWidth, opacity = 1) {
  if (points.length < 2) return;
  ctx.beginPath();
  const p0 = toCanvas(points[0]);
  ctx.moveTo(p0.x, p0.y);
  for (let i = 1; i < points.length; i++) {
    const p = toCanvas(points[i]);
    ctx.lineTo(p.x, p.y);
  }
  ctx.strokeStyle = color;
  ctx.globalAlpha = opacity;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawBoundaryCircle(color, opacity = 1) {
  const c = toCanvas({ x: 0, y: 0 });
  ctx.beginPath();
  ctx.arc(c.x, c.y, scale, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.globalAlpha = opacity;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function fillDot(p, radius, color, opacity = 1) {
  const c = toCanvas(p);
  ctx.beginPath();
  ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.globalAlpha = opacity;
  ctx.fill();
  ctx.globalAlpha = 1;
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
    accent: cssVar("--scene-point-a"),
    accent2: cssVar("--scene-point-b"),
    text: cssVar("--text-secondary"),
    qual: QUALITATIVE[theme === "dark" ? "dark" : "light"],
  };
  canvas.style.background = "transparent";
}

initTheme(readPalette);

// ----------------------------------------------------------------------------
// 3. Four visuals, one per section
// ----------------------------------------------------------------------------

// -- Visual 1: distortion grid — equal hyperbolic steps, unequal Euclidean
// spacing, growing with scroll progress to make the crowding legible. -------

const GRID_RINGS_MAX = 11;
const GRID_SPOKES = 16;
const RING_STEP = 0.55; // hyperbolic distance between rings

function drawDistortionGrid(progress, t) {
  const spin = t * 0.00002;
  for (let i = 0; i < GRID_SPOKES; i++) {
    const angle = (i / GRID_SPOKES) * Math.PI * 2 + spin;
    const p1 = polar(0.999, angle);
    const p2 = polar(0.999, angle + Math.PI);
    strokePath([p1, { x: 0, y: 0 }, p2], palette.grid, 1, 0.22);
  }

  const visibleRings = Math.max(2, Math.ceil(2 + progress * (GRID_RINGS_MAX - 2)));
  for (let k = 1; k <= visibleRings; k++) {
    const hyperbolicR = k * RING_STEP;
    const euclideanR = Math.tanh(hyperbolicR / 2);
    if (euclideanR > 0.999) continue;
    const c = toCanvas({ x: 0, y: 0 });
    const fade = 1 - (k / GRID_RINGS_MAX) * 0.35;
    ctx.beginPath();
    ctx.arc(c.x, c.y, euclideanR * scale, 0, Math.PI * 2);
    ctx.strokeStyle = palette.accent;
    ctx.globalAlpha = 0.55 * fade;
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  drawBoundaryCircle(palette.boundary, 0.7);
}

// -- Visual 2: a pencil of geodesics through a single, slowly drifting
// point — every "straight line" through one point in the hyperbolic plane. -

function drawGeodesicPencil(progress, t) {
  const orbitAngle = t * 0.00018;
  const p = polar(0.42, orbitAngle);

  const rayCount = Math.max(6, Math.round(4 + progress * 14));
  for (let i = 0; i < rayCount; i++) {
    const theta = (i / rayCount) * Math.PI;
    const line = geodesicLineThrough(p, theta, 40);
    strokePath(line, palette.accent, 1.2, 0.4);
  }

  drawBoundaryCircle(palette.boundary, 0.7);
  fillDot(p, 4.5, palette.accent2, 0.95);
}

// -- Visual 3 & 4 share a precomputed tiling of the genus-2 octagon --------

const TILING = generateTiling(3, 0.9995); // ~70 tiles, computed once
const BASE_OCTAGON = octagonVertices();

// Precompute each tile's 8 edges as sampled geodesic arcs, once.
const TILE_EDGES = TILING.map((tile) => {
  const edges = [];
  for (let k = 0; k < 8; k++) {
    edges.push(geodesicPoints(tile.verts[k], tile.verts[(k + 1) % 8], 14));
  }
  return { edges, depth: tile.depth, verts: tile.verts };
});

function drawOctagonGluing(progress, t) {
  const spin = t * 0.00001;
  const maxDepth = progress > 0.7 ? 2 : progress > 0.3 ? 1 : 0;

  for (const tile of TILE_EDGES) {
    if (tile.depth > maxDepth) continue;
    const isBase = tile.depth === 0;
    for (let k = 0; k < 8; k++) {
      const rotated = tile.edges[k].map((pt) => {
        const c = Math.cos(spin), s = Math.sin(spin);
        return { x: pt.x * c - pt.y * s, y: pt.x * s + pt.y * c };
      });
      const color = isBase ? palette.qual[k % 4] : palette.grid;
      const opacity = isBase ? 0.9 : 0.28;
      const width = isBase ? 2.2 : 1;
      strokePath(rotated, color, width, opacity);
    }
  }

  // All eight vertices of the base octagon become a single point on the
  // surface — mark them to make that collapse visible.
  const c2 = Math.cos(spin), s2 = Math.sin(spin);
  for (const v of BASE_OCTAGON) {
    const rv = { x: v.x * c2 - v.y * s2, y: v.x * s2 + v.y * c2 };
    fillDot(rv, 3.5, palette.accent2, 0.85);
  }

  drawBoundaryCircle(palette.boundary, 0.7);
}

// -- Visual 4: two nearly-parallel geodesics, diverging across the tiling. -

function drawDivergingGeodesics(progress, t) {
  for (const tile of TILE_EDGES) {
    for (let k = 0; k < 8; k++) {
      strokePath(tile.edges[k], palette.grid, 1, tile.depth === 0 ? 0.3 : 0.14);
    }
  }
  drawBoundaryCircle(palette.boundary, 0.6);

  const drift = t * 0.00003;
  const baseAngle = 0.5 + Math.sin(drift) * 0.3;
  const splitAngle = 0.012 + progress * 0.01; // starts a fraction of a degree apart

  const rayA = geodesicLineThrough({ x: 0, y: 0 }, baseAngle, 60);
  const rayB = geodesicLineThrough({ x: 0, y: 0 }, baseAngle + splitAngle, 60);

  strokePath(rayA, palette.accent, 1.8, 0.9);
  strokePath(rayB, palette.accent2, 1.8, 0.9);
}

// ----------------------------------------------------------------------------
// updateScene(sectionIndex, progress) — the single dispatch point.
// ----------------------------------------------------------------------------

const VISUALS = [drawDistortionGrid, drawGeodesicPencil, drawOctagonGluing, drawDivergingGeodesics];

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
  "01 — Constant Curvature",
  "02 — The Poincaré Disk",
  "03 — Octagon to Surface",
  "04 — Geodesic Flow",
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
