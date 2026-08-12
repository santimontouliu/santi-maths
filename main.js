// ============================================================================
// main.js — Scrollytelling engine for the Persistent Homology walkthrough.
//
// Structure:
//   1. Three.js boilerplate — scene, camera, renderer, lighting.
//   2. The "messy data" point cloud — a noisy torus, one point per vertex.
//   3. Scroll wiring (via scroll.js) drives updateScene() as sections change.
//   4. Render loop.
//
// Theme toggling and scroll/section tracking live in theme.js and scroll.js,
// shared with every other entry page.
//
// This file is intentionally scaffolded: updateScene() currently only
// animates camera angle + point color/size per section. Swap in real
// epsilon-ball growth, simplicial complex construction, etc. inside it
// as the project grows — the wiring around it (observer, resize, loop)
// should not need to change.
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

// Lighting — subtle, theme-aware. Mostly ambient since points render as
// unlit sprites; the directional light is a hook for later mesh-based
// simplicial complex geometry (edges/faces) which WILL need real shading.
const ambientLight = new THREE.AmbientLight(cssVarColor("--scene-ambient").getHex(), 1.0);
const keyLight = new THREE.DirectionalLight(0xffffff, 0.4);
keyLight.position.set(4, 6, 5);
scene.add(ambientLight, keyLight);

initTheme((theme) => {
  scene.fog.color.set(cssVarColor("--scene-fog").getHex());
  ambientLight.color.set(cssVarColor("--scene-ambient").getHex());
  // Point colors are re-derived from theme vars each frame in updateScene(),
  // so no extra work is needed here beyond fog/ambient.
});

// ----------------------------------------------------------------------------
// 2. The "messy data" point cloud — a noisy torus
// ----------------------------------------------------------------------------
//
// We build the torus manually (rather than via TorusGeometry) so each point
// is a genuine sample with independent random noise applied along its local
// normal — this is meant to visually read as "data sampled near a shape",
// not a smooth mathematical surface.

const TORUS_RADIUS = 2.2; // distance from center of tube to center of torus
const TUBE_RADIUS = 0.85; // radius of the tube itself
const POINTS_U = 140; // samples around the main ring
const POINTS_V = 40; // samples around the tube
const NOISE_AMOUNT = 0.16; // magnitude of random displacement, in world units

function buildNoisyTorusPositions() {
  const count = POINTS_U * POINTS_V;
  const positions = new Float32Array(count * 3);
  let i = 0;

  for (let u = 0; u < POINTS_U; u++) {
    const theta = (u / POINTS_U) * Math.PI * 2; // angle around the main ring

    for (let v = 0; v < POINTS_V; v++) {
      const phi = (v / POINTS_V) * Math.PI * 2; // angle around the tube

      // Clean torus parametrization.
      const x = (TORUS_RADIUS + TUBE_RADIUS * Math.cos(phi)) * Math.cos(theta);
      const y = (TORUS_RADIUS + TUBE_RADIUS * Math.cos(phi)) * Math.sin(theta);
      const z = TUBE_RADIUS * Math.sin(phi);

      // Local normal direction at this point on the tube surface, used so
      // noise pushes points "in and out" rather than sliding along the tube.
      const nx = Math.cos(phi) * Math.cos(theta);
      const ny = Math.cos(phi) * Math.sin(theta);
      const nz = Math.sin(phi);

      const noise = (Math.random() - 0.5) * 2 * NOISE_AMOUNT;

      positions[i * 3 + 0] = x + nx * noise;
      positions[i * 3 + 1] = y + ny * noise;
      positions[i * 3 + 2] = z + nz * noise;
      i++;
    }
  }

  return positions;
}

const pointsGeometry = new THREE.BufferGeometry();
pointsGeometry.setAttribute("position", new THREE.BufferAttribute(buildNoisyTorusPositions(), 3));

const pointsMaterial = new THREE.PointsMaterial({
  color: cssVarColor("--scene-point-a"),
  size: 0.06,
  sizeAttenuation: true,
  transparent: true,
  opacity: 0.9,
});

const pointCloud = new THREE.Points(pointsGeometry, pointsMaterial);
scene.add(pointCloud);

// ----------------------------------------------------------------------------
// 3. Scroll wiring — section tracker drives updateScene()
// ----------------------------------------------------------------------------

const sections = Array.from(document.querySelectorAll(".story-section"));
const stageLabel = document.getElementById("scene-stage-label");

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
//
// The single hook the rest of the app calls into. Right now it:
//   - eases the camera to a per-section angle/distance around the torus
//   - blends the point cloud color between two theme-aware accent colors
//   - gently scales point size for a bit of per-section emphasis
//
// Later, per-section behavior specific to TDA can be layered in here, e.g.:
//   section 1 -> just the raw noisy point cloud (current default)
//   section 2 -> grow transparent epsilon-spheres around each point
//   section 3 -> fade in edges/faces of the Vietoris-Rips complex
//   section 4 -> highlight loops/voids and animate a Betti-number counter
//   section 5 -> visualize a cycle that is/isn't a boundary
// ----------------------------------------------------------------------------

// Target camera positions per section: [x, y, z] orbiting around the torus,
// pulling back slightly on later sections to "reveal" more structure.
const CAMERA_TARGETS = [
  new THREE.Vector3(0, 0, 9),
  new THREE.Vector3(3.5, 1.5, 7.5),
  new THREE.Vector3(-4, 2.5, 6.5),
  new THREE.Vector3(0, 5.5, 5),
  new THREE.Vector3(4.5, -1.5, 6.5),
];

const cameraLookTarget = new THREE.Vector3(0, 0, 0);
const currentCameraPos = camera.position.clone();

function updateScene(sectionIndex, progress) {
  const target = CAMERA_TARGETS[sectionIndex] ?? CAMERA_TARGETS[0];

  // Smoothly interpolate camera position toward the target for this
  // section; progress nudges it further along an orbit so movement still
  // reads within a single long section, not just at section boundaries.
  const orbitNudge = (progress - 0.5) * 0.6;
  const nudgedTarget = target.clone();
  nudgedTarget.x += Math.sin(orbitNudge) * 1.2;

  currentCameraPos.lerp(nudgedTarget, 0.04);
  camera.position.copy(currentCameraPos);
  camera.lookAt(cameraLookTarget);

  // Blend point color between two theme-aware accents across the five
  // sections, so the cloud visibly shifts character as the story advances.
  const colorA = cssVarColor("--scene-point-a");
  const colorB = cssVarColor("--scene-point-b");
  const colorMix = sectionIndex / (STAGE_LABELS.length - 1);
  pointsMaterial.color.copy(colorA).lerp(colorB, colorMix);

  // Slight size pulse tied to scroll progress within the section.
  pointsMaterial.size = 0.06 + Math.sin(progress * Math.PI) * 0.015;

  // Gentle constant rotation so the "messy data" always feels alive, even
  // between section transitions.
  pointCloud.rotation.y += 0.0009;
  pointCloud.rotation.x = Math.sin(Date.now() * 0.00012) * 0.08;
}

// ----------------------------------------------------------------------------
// 4. Render loop + resize handling
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
