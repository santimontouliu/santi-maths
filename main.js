// ============================================================================
// main.js — Scrollytelling engine for the Persistent Homology walkthrough.
//
// Structure:
//   1. Three.js boilerplate — scene, camera, renderer, lighting.
//   2. The dense "messy data" point cloud — section 1 only.
//   3. The sparse point cloud + its Vietoris-Rips complex — sections 2-5.
//   4. Scroll wiring (via scroll.js) drives updateScene() as sections change.
//   5. Render loop.
//
// Theme toggling and scroll/section tracking live in theme.js and scroll.js,
// shared with every other entry page.
//
// Sections 2-5 all share one real epsilon value and one precomputed
// distance-based complex on a 112-point sample — see epsilonForSection()
// and the complex-building block below. Nothing here is faked: edges and
// triangles appear exactly when two/three points are within epsilon of
// each other, the real Vietoris-Rips rule. The two highlighted loops in
// section 4, however, are hand-picked from the known (u,v) parametrization
// rather than computed by an actual persistent-homology reduction — that's
// called out in the section's own text, not hidden.
// ============================================================================

import * as THREE from "three";
import { initTheme, cssVar } from "./theme.js";
import { createSectionTracker, sectionScrollProgress } from "./scroll.js";

// ----------------------------------------------------------------------------
// 1. Three.js boilerplate
// ----------------------------------------------------------------------------

const canvas = document.getElementById("scene-canvas");
const sceneContainer = canvas.parentElement; // .scene-sticky

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  50,
  sceneContainer.clientWidth / sceneContainer.clientHeight,
  0.1,
  100
);
camera.position.set(0, 0, 9);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(sceneContainer.clientWidth, sceneContainer.clientHeight);

function cssVarColor(name) {
  return new THREE.Color(cssVar(name) || "#ffffff");
}

// Fog ties the point cloud softly into the background instead of a hard edge.
scene.fog = new THREE.Fog(cssVarColor("--scene-fog").getHex(), 8, 16);

const ambientLight = new THREE.AmbientLight(cssVarColor("--scene-ambient").getHex(), 1.0);
const keyLight = new THREE.DirectionalLight(0xffffff, 0.4);
keyLight.position.set(4, 6, 5);
scene.add(ambientLight, keyLight);

// A small qualitative palette shared in spirit with the other two entries
// (surface-dynamics.js / chaos.js use the same four hues) — index 2 marks
// the second highlighted loop, index 3 marks the boundary triangle.
const QUALITATIVE = {
  light: ["#3a5a8c", "#c98a4b", "#6b8f71", "#a15c7a"],
  dark: ["#8fb3e8", "#e0a868", "#8fc49a", "#c98fb0"],
};
let qualitative = QUALITATIVE.light;
// initTheme() is called further down, after every material that
// syncMaterialColors() touches has been constructed — see the end of
// section 3 below. Calling it here would reference those consts before
// their `const` declarations run.

// ----------------------------------------------------------------------------
// 2. The dense "messy data" point cloud — section 1 only
// ----------------------------------------------------------------------------

const TORUS_RADIUS = 2.2;
const TUBE_RADIUS = 0.85;
const NOISE_AMOUNT = 0.16;

function torusPoint(theta, phi, noise) {
  const x = (TORUS_RADIUS + TUBE_RADIUS * Math.cos(phi)) * Math.cos(theta);
  const y = (TORUS_RADIUS + TUBE_RADIUS * Math.cos(phi)) * Math.sin(theta);
  const z = TUBE_RADIUS * Math.sin(phi);
  const nx = Math.cos(phi) * Math.cos(theta);
  const ny = Math.cos(phi) * Math.sin(theta);
  const nz = Math.sin(phi);
  return { x: x + nx * noise, y: y + ny * noise, z: z + nz * noise };
}

const DENSE_U = 140;
const DENSE_V = 40;

function buildDensePositions() {
  const positions = new Float32Array(DENSE_U * DENSE_V * 3);
  let i = 0;
  for (let u = 0; u < DENSE_U; u++) {
    const theta = (u / DENSE_U) * Math.PI * 2;
    for (let v = 0; v < DENSE_V; v++) {
      const phi = (v / DENSE_V) * Math.PI * 2;
      const noise = (Math.random() - 0.5) * 2 * NOISE_AMOUNT;
      const p = torusPoint(theta, phi, noise);
      positions[i++] = p.x;
      positions[i++] = p.y;
      positions[i++] = p.z;
    }
  }
  return positions;
}

const densePointsGeometry = new THREE.BufferGeometry();
densePointsGeometry.setAttribute("position", new THREE.BufferAttribute(buildDensePositions(), 3));

const densePointsMaterial = new THREE.PointsMaterial({
  color: cssVarColor("--scene-point-a"),
  size: 0.06,
  sizeAttenuation: true,
  transparent: true,
  opacity: 0.9,
});

const denseCloud = new THREE.Points(densePointsGeometry, densePointsMaterial);
scene.add(denseCloud);

// ----------------------------------------------------------------------------
// 3. The sparse point cloud + its Vietoris-Rips complex — sections 2-5
// ----------------------------------------------------------------------------

const SPARSE_U = 14; // longitude samples (theta)
const SPARSE_V = 8; // meridian samples (phi)
const EPSILON_TARGET = 0.95; // reached at the end of section 2
const EPSILON_MAX = 1.2; // reached at the end of section 3, held after

function buildSparsePoints() {
  const pts = [];
  for (let ui = 0; ui < SPARSE_U; ui++) {
    const theta = (ui / SPARSE_U) * Math.PI * 2;
    for (let vi = 0; vi < SPARSE_V; vi++) {
      const phi = (vi / SPARSE_V) * Math.PI * 2;
      const noise = (Math.random() - 0.5) * 2 * NOISE_AMOUNT;
      const p = torusPoint(theta, phi, noise);
      pts.push({ ...p, ui, vi });
    }
  }
  return pts;
}

const sparsePoints = buildSparsePoints();
const sparseIndexOf = new Map(sparsePoints.map((p, i) => [`${p.ui},${p.vi}`, i]));

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// Every edge, sorted by birth distance ascending — this sorted-prefix
// structure is what lets a single geometry.setDrawRange() call per frame
// stand in for "recompute the graph at the current epsilon."
const allEdges = [];
for (let i = 0; i < sparsePoints.length; i++) {
  for (let j = i + 1; j < sparsePoints.length; j++) {
    const d = dist(sparsePoints[i], sparsePoints[j]);
    if (d <= EPSILON_MAX) allEdges.push({ i, j, d });
  }
}
allEdges.sort((a, b) => a.d - b.d);

// Every triangle (2-simplex) whose three edges are all within EPSILON_MAX,
// sorted by birth distance (the max of its three edge lengths) ascending.
const allTriangles = [];
for (let i = 0; i < sparsePoints.length; i++) {
  for (let j = i + 1; j < sparsePoints.length; j++) {
    const dij = dist(sparsePoints[i], sparsePoints[j]);
    if (dij > EPSILON_MAX) continue;
    for (let k = j + 1; k < sparsePoints.length; k++) {
      const dik = dist(sparsePoints[i], sparsePoints[k]);
      const djk = dist(sparsePoints[j], sparsePoints[k]);
      const birth = Math.max(dij, dik, djk);
      if (birth <= EPSILON_MAX) allTriangles.push({ i, j, k, birth });
    }
  }
}
allTriangles.sort((a, b) => a.birth - b.birth);

// The two hand-picked generators of H1 (see the module comment above): a
// meridian loop (fixed longitude) and a longitude loop along the inner
// equator (smallest circumference, so it's safely connected well before
// EPSILON_MAX — see the plan's margin analysis).
function loopIndices(fixedKey, fixedValue, otherCount, orderKey) {
  const pts = sparsePoints
    .map((p, i) => ({ ...p, i }))
    .filter((p) => p[fixedKey] === fixedValue)
    .sort((a, b) => a[orderKey] - b[orderKey]);
  return pts.map((p) => p.i);
}
const meridianLoopIdx = loopIndices("ui", 0, SPARSE_V, "vi");
const longitudeLoopIdx = loopIndices("vi", Math.floor(SPARSE_V / 2), SPARSE_U, "ui");

// A single representative "this bounds a face" triangle for section 5 —
// the earliest (smallest, most local) triangle in the complex.
const boundaryTriangle = allTriangles[0];

// -- Three.js objects --------------------------------------------------------

const sparsePositions = new Float32Array(sparsePoints.length * 3);
sparsePoints.forEach((p, i) => {
  sparsePositions[i * 3 + 0] = p.x;
  sparsePositions[i * 3 + 1] = p.y;
  sparsePositions[i * 3 + 2] = p.z;
});
const sparsePointsGeometry = new THREE.BufferGeometry();
sparsePointsGeometry.setAttribute("position", new THREE.BufferAttribute(sparsePositions, 3));
const sparsePointsMaterial = new THREE.PointsMaterial({
  color: cssVarColor("--scene-point-a"),
  size: 0.09,
  sizeAttenuation: true,
  transparent: true,
  opacity: 0,
});
const sparseCloud = new THREE.Points(sparsePointsGeometry, sparsePointsMaterial);
scene.add(sparseCloud);

// Epsilon balls: one shared low-poly sphere, instanced per sparse point.
// Radius is animated by uniformly scaling each instance's matrix.
const ballGeometry = new THREE.IcosahedronGeometry(1, 1);
const ballMaterial = new THREE.MeshStandardMaterial({
  color: cssVarColor("--scene-point-a"),
  transparent: true,
  opacity: 0,
  roughness: 0.9,
  depthWrite: false,
});
const epsilonBalls = new THREE.InstancedMesh(ballGeometry, ballMaterial, sparsePoints.length);
const ballDummy = new THREE.Object3D();
scene.add(epsilonBalls);

function setBallRadius(radius) {
  const r = Math.max(radius, 0.001);
  for (let i = 0; i < sparsePoints.length; i++) {
    const p = sparsePoints[i];
    ballDummy.position.set(p.x, p.y, p.z);
    ballDummy.scale.setScalar(r);
    ballDummy.updateMatrix();
    epsilonBalls.setMatrixAt(i, ballDummy.matrix);
  }
  epsilonBalls.instanceMatrix.needsUpdate = true;
}
setBallRadius(0.001);

// Edges — one static buffer holding every edge sorted by birth distance;
// setDrawRange reveals the current epsilon's prefix without touching the
// buffer itself.
const edgePositions = new Float32Array(allEdges.length * 2 * 3);
allEdges.forEach((e, idx) => {
  const a = sparsePoints[e.i], b = sparsePoints[e.j];
  edgePositions.set([a.x, a.y, a.z, b.x, b.y, b.z], idx * 6);
});
const edgesGeometry = new THREE.BufferGeometry();
edgesGeometry.setAttribute("position", new THREE.BufferAttribute(edgePositions, 3));
edgesGeometry.setDrawRange(0, 0);
const edgesMaterial = new THREE.LineBasicMaterial({
  color: cssVarColor("--scene-point-a"),
  transparent: true,
  opacity: 0,
});
const edgesLines = new THREE.LineSegments(edgesGeometry, edgesMaterial);
scene.add(edgesLines);

// Triangles (2-simplices) — same sorted-prefix trick as edges.
const trianglePositions = new Float32Array(allTriangles.length * 3 * 3);
allTriangles.forEach((tri, idx) => {
  const a = sparsePoints[tri.i], b = sparsePoints[tri.j], c = sparsePoints[tri.k];
  trianglePositions.set([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z], idx * 9);
});
const trianglesGeometry = new THREE.BufferGeometry();
trianglesGeometry.setAttribute("position", new THREE.BufferAttribute(trianglePositions, 3));
trianglesGeometry.computeVertexNormals();
trianglesGeometry.setDrawRange(0, 0);
const trianglesMaterial = new THREE.MeshBasicMaterial({
  color: cssVarColor("--scene-point-a"),
  transparent: true,
  opacity: 0,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const trianglesMesh = new THREE.Mesh(trianglesGeometry, trianglesMaterial);
scene.add(trianglesMesh);

// The two highlighted H1 generators — always full geometry, just faded
// in/out by opacity so they can reappear instantly if the reader scrolls
// back up.
//
// A plain THREE.Line renders at 1 device pixel in WebGL regardless of
// `linewidth` (a long-standing platform limitation), and would also
// z-fight against the mesh/edges sharing the exact same vertices. Both
// problems disappear by building a real tube along the loop, nudged
// outward along the torus's local normal so it sits visibly proud of the
// surface instead of coincident with it.
function buildLoopTube(indices, colorHex) {
  const lift = 0.05;
  const curvePoints = indices.map((idx) => {
    const p = sparsePoints[idx];
    const theta = (p.ui / SPARSE_U) * Math.PI * 2;
    const phi = (p.vi / SPARSE_V) * Math.PI * 2;
    const nx = Math.cos(phi) * Math.cos(theta);
    const ny = Math.cos(phi) * Math.sin(theta);
    const nz = Math.sin(phi);
    return new THREE.Vector3(p.x + nx * lift, p.y + ny * lift, p.z + nz * lift);
  });
  const curve = new THREE.CatmullRomCurve3(curvePoints, true);
  const geometry = new THREE.TubeGeometry(curve, indices.length * 6, 0.035, 8, true);
  const material = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0, depthTest: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 10; // draw after the mesh/edges so depthTest:false doesn't get overpainted
  return mesh;
}
const meridianLine = buildLoopTube(meridianLoopIdx, qualitative[1]);
const longitudeLine = buildLoopTube(longitudeLoopIdx, qualitative[2]);
scene.add(meridianLine, longitudeLine);

// The single "this bounds a face" triangle for section 5.
const boundaryGeometry = new THREE.BufferGeometry();
{
  const a = sparsePoints[boundaryTriangle.i], b = sparsePoints[boundaryTriangle.j], c = sparsePoints[boundaryTriangle.k];
  boundaryGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z]), 3)
  );
}
const boundaryMaterial = new THREE.MeshBasicMaterial({
  color: qualitative[3],
  transparent: true,
  opacity: 0,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const boundaryMesh = new THREE.Mesh(boundaryGeometry, boundaryMaterial);
scene.add(boundaryMesh);

function syncMaterialColors() {
  const a = cssVarColor("--scene-point-a");
  densePointsMaterial.color.copy(a);
  sparsePointsMaterial.color.copy(a);
  ballMaterial.color.copy(a);
  edgesMaterial.color.copy(a);
  trianglesMaterial.color.copy(a);
  meridianLine.material.color.set(qualitative[1]);
  longitudeLine.material.color.set(qualitative[2]);
  boundaryMesh.material.color.set(qualitative[3]);
}

// Now that every material above exists, wire up the theme toggle (this
// also runs syncMaterialColors() once immediately for the initial theme).
initTheme((theme) => {
  scene.fog.color.set(cssVarColor("--scene-fog").getHex());
  ambientLight.color.set(cssVarColor("--scene-ambient").getHex());
  qualitative = QUALITATIVE[theme === "dark" ? "dark" : "light"];
  syncMaterialColors();
});

// ----------------------------------------------------------------------------
// 4. Scroll wiring — section tracker drives updateScene()
// ----------------------------------------------------------------------------

const sections = Array.from(document.querySelectorAll(".story-section"));
const stageLabel = document.getElementById("scene-stage-label");
const bettiRows = Array.from(document.querySelectorAll(".betti-counter .betti-row"));

const STAGE_LABELS = [
  "01 — Point Cloud",
  "02 — Epsilon Balls",
  "03 — Simplicial Complex",
  "04 — Betti Numbers",
  "05 — Homology Groups",
];

const tracker = createSectionTracker(sections, (index) => {
  stageLabel.textContent = STAGE_LABELS[index] ?? "";
});

// ----------------------------------------------------------------------------
// updateScene(sectionIndex, scrollProgress)
// ----------------------------------------------------------------------------

const CAMERA_TARGETS = [
  new THREE.Vector3(0, 0, 9),
  new THREE.Vector3(3.5, 1.5, 7.5),
  new THREE.Vector3(-4, 2.5, 6.5),
  new THREE.Vector3(0, 5.5, 5),
  new THREE.Vector3(4.5, -1.5, 6.5),
];
const cameraLookTarget = new THREE.Vector3(0, 0, 0);
const currentCameraPos = camera.position.clone();

// A tiny smoothed-lerp helper, used for every opacity/epsilon value below so
// nothing snaps instantly even if the reader scrolls very fast.
const smoothed = {
  dense: 1, sparse: 0, balls: 0, edges: 0, triangles: 0,
  meridian: 0, longitude: 0, boundary: 0, epsilon: 0,
};
function approach(key, target, rate) {
  smoothed[key] += (target - smoothed[key]) * rate;
  return smoothed[key];
}

function epsilonForSection(sectionIndex, progress) {
  if (sectionIndex <= 0) return 0;
  if (sectionIndex === 1) return progress * EPSILON_TARGET;
  if (sectionIndex === 2) return EPSILON_TARGET + progress * (EPSILON_MAX - EPSILON_TARGET);
  return EPSILON_MAX;
}

function countBelow(sortedArr, key, threshold) {
  // Binary search for the number of entries with value <= threshold.
  let lo = 0, hi = sortedArr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedArr[mid][key] <= threshold) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function updateScene(sectionIndex, progress) {
  // Camera.
  const target = CAMERA_TARGETS[sectionIndex] ?? CAMERA_TARGETS[0];
  const orbitNudge = (progress - 0.5) * 0.6;
  const nudgedTarget = target.clone();
  nudgedTarget.x += Math.sin(orbitNudge) * 1.2;
  currentCameraPos.lerp(nudgedTarget, 0.04);
  camera.position.copy(currentCameraPos);
  camera.lookAt(cameraLookTarget);

  // Dense <-> sparse crossfade.
  const denseOpacity = approach("dense", sectionIndex === 0 ? 0.9 : 0, 0.08);
  const sparseOpacity = approach("sparse", sectionIndex >= 1 ? 0.95 : 0, 0.08);
  densePointsMaterial.opacity = denseOpacity;
  sparsePointsMaterial.opacity = sparseOpacity;

  // Epsilon balls — visible mainly in section 2, fading out after.
  const ballsTarget = sectionIndex === 1 ? 0.22 : 0;
  const ballsOpacity = approach("balls", ballsTarget, 0.08);
  ballMaterial.opacity = ballsOpacity;
  const epsilon = approach("epsilon", epsilonForSection(sectionIndex, progress), 0.15);
  if (ballsOpacity > 0.005) setBallRadius(epsilon);

  // Edges + triangles — appear from section 3 onward, dimmed in section 5
  // so the highlighted loops and boundary triangle read clearly.
  const complexTarget = sectionIndex >= 2 ? (sectionIndex === 4 ? 0.4 : 0.85) : 0;
  const edgesOpacity = approach("edges", complexTarget, 0.08);
  const trianglesOpacity = approach("triangles", complexTarget * 0.5, 0.08);
  edgesMaterial.opacity = edgesOpacity;
  trianglesMaterial.opacity = trianglesOpacity;
  const edgeCount = countBelow(allEdges, "d", epsilon);
  const triCount = countBelow(allTriangles, "birth", epsilon);
  edgesGeometry.setDrawRange(0, edgeCount * 2);
  trianglesGeometry.setDrawRange(0, triCount * 3);

  // Section 4: reveal the two generating loops one at a time, then the
  // Betti counter rows in step; both stay visible (loops dimmed) in §5.
  const inBettiOrLater = sectionIndex >= 3;
  const loopProgress = sectionIndex === 3 ? progress : sectionIndex > 3 ? 1 : 0;
  const meridianTarget = inBettiOrLater ? (sectionIndex === 4 ? 0.55 : 1) * Math.min(1, loopProgress / 0.35) : 0;
  const longitudeTarget = inBettiOrLater
    ? (sectionIndex === 4 ? 0.55 : 1) * Math.max(0, Math.min(1, (loopProgress - 0.4) / 0.35))
    : 0;
  meridianLine.material.opacity = approach("meridian", meridianTarget, 0.08);
  longitudeLine.material.opacity = approach("longitude", longitudeTarget, 0.08);

  bettiRows.forEach((row, k) => {
    const thresholds = [0.1, 0.45, 0.75];
    const on = inBettiOrLater && loopProgress >= thresholds[k];
    row.style.opacity = on ? 1 : 0;
  });

  // Section 5: the boundary-vs-cycle contrast.
  const boundaryTarget = sectionIndex === 4 ? Math.min(1, progress / 0.5) * 0.85 : 0;
  boundaryMesh.material.opacity = approach("boundary", boundaryTarget, 0.08);

  // Gentle constant rotation so both clouds feel alive between transitions.
  denseCloud.rotation.y += 0.0009;
  denseCloud.rotation.x = Math.sin(Date.now() * 0.00012) * 0.08;
  [sparseCloud, epsilonBalls, edgesLines, trianglesMesh, meridianLine, longitudeLine, boundaryMesh].forEach((obj) => {
    obj.rotation.y = denseCloud.rotation.y;
    obj.rotation.x = denseCloud.rotation.x;
  });
}

// ----------------------------------------------------------------------------
// 5. Render loop + resize handling
// ----------------------------------------------------------------------------

function onResize() {
  const width = sceneContainer.clientWidth;
  const height = sceneContainer.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}
window.addEventListener("resize", onResize);

function animate() {
  requestAnimationFrame(animate);
  const section = sections[tracker.active];
  const progress = section ? sectionScrollProgress(section) : 0;
  updateScene(tracker.active, progress);
  renderer.render(scene, camera);
}

animate();
