// ============================================================================
// dynamics.js — shared math for the Structural Stability & Chaos entry.
//
// Three self-contained pieces, one per flagship visual:
//   1. Linear flows — closed-form solutions used for the stability and
//      hyperbolic-fixed-point phase portraits (centers/spirals, saddles).
//   2. The Smale horseshoe skeleton — a fixed hairpin outline standing in
//      for f(Q), plus a Cantor-interval generator for the nested strips
//      that survive every iterate.
//   3. The solenoid attractor — the actual solenoid map iterated on a
//      representative fiber curve, embedded in R^3 and projected to 2D.
// ============================================================================

// ---- 1. Linear flows --------------------------------------------------------

// Closed-form solution of dx/dt = lambda1 x, dy/dt = lambda2 y — the
// canonical sink/saddle/source picture depending on the signs of lambda1/2.
export function diagonalFlow(lambda1, lambda2, x0, y0, t) {
  return { x: x0 * Math.exp(lambda1 * t), y: y0 * Math.exp(lambda2 * t) };
}

// A rotating flow with growth/decay rate `decay` and angular speed `omega`.
// decay = 0 is a center (closed circular orbits, NOT hyperbolic); decay
// != 0 turns it into an inward/outward spiral.
export function spiralFlow(decay, omega, x0, y0, t) {
  const r = Math.exp(decay * t);
  const c = Math.cos(omega * t), s = Math.sin(omega * t);
  return { x: r * (x0 * c - y0 * s), y: r * (x0 * s + y0 * c) };
}

// Samples a streamline through (x0,y0) for t in [tMin,tMax] under flowFn,
// stopping early once the trajectory leaves [-bound,bound]^2 — avoids
// wasting samples chasing runaway blow-up along unstable directions.
export function streamline(flowFn, x0, y0, tMin, tMax, steps, bound = 3) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = tMin + ((tMax - tMin) * i) / steps;
    const p = flowFn(x0, y0, t);
    pts.push(p);
    if (Math.abs(p.x) > bound || Math.abs(p.y) > bound) break;
  }
  return pts;
}

// ---- 2. Smale horseshoe skeleton -------------------------------------------

// Boundary outline of a hairpin/horseshoe ribbon: two straight legs joined
// by a semicircular cap — standing in for f(Q), the image of the unit
// square under one iterate of the horseshoe map (stretch, fold, place back
// across itself). A fixed static shape; no animation parameter needed.
export function horseshoeOutline(steps = 60) {
  const legX = 0.55; // leg centerline distance from the vertical axis
  const halfW = 0.16; // leg half-thickness
  const legTop = 0.85;
  const legBottom = -1.65;
  const capR = legX; // cap radius matches leg spacing so it meets both tops

  const rightOuterTop = { x: legX + halfW, y: legTop };
  const rightOuterBottom = { x: legX + halfW, y: legBottom };
  const rightInnerBottom = { x: legX - halfW, y: legBottom };
  const rightInnerTop = { x: legX - halfW, y: legTop };
  const leftInnerTop = { x: -legX + halfW, y: legTop };
  const leftInnerBottom = { x: -legX + halfW, y: legBottom };
  const leftOuterBottom = { x: -legX - halfW, y: legBottom };
  const leftOuterTop = { x: -legX - halfW, y: legTop };

  const pts = [rightOuterBottom, rightOuterTop];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI; // right (a=0) to left (a=PI), outer arc
    pts.push({ x: (capR + halfW) * Math.cos(a), y: legTop + (capR + halfW) * Math.sin(a) });
  }
  pts.push(leftOuterTop, leftOuterBottom, leftInnerBottom, leftInnerTop);
  for (let i = steps; i >= 0; i--) {
    const a = (i / steps) * Math.PI;
    pts.push({ x: (capR - halfW) * Math.cos(a), y: legTop + (capR - halfW) * Math.sin(a) });
  }
  pts.push(rightInnerTop, rightInnerBottom);
  return pts;
}

// Recursively bisects [-1, 1] into 2^depth sub-intervals, keeping a
// `keepFraction` of each interval's width at each end and discarding a gap
// in the middle — the Cantor-set skeleton of surviving points.
export function cantorIntervals(depth, keepFraction = 0.42) {
  let intervals = [[-1, 1]];
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (const [a, b] of intervals) {
      const w = (b - a) * keepFraction;
      next.push([a, a + w], [b - w, b]);
    }
    intervals = next;
  }
  return intervals;
}

// ---- 3. Solenoid attractor --------------------------------------------------

// One application of the solenoid map in "abstract" (angle, fiber-point)
// coordinates: winds twice around the core circle while contracting and
// re-centering the disk fiber. `contraction` < 0.5 keeps every image
// embedded strictly inside the previous one.
export function solenoidStep(theta, z, contraction, offset) {
  return {
    theta: 2 * theta,
    z: {
      x: contraction * z.x + offset * Math.cos(theta),
      y: contraction * z.y + offset * Math.sin(theta),
    },
  };
}

// Generation-k fiber curve: iterates solenoidStep k times starting from the
// generation-0 core circle (theta0, z=0), for theta0 in [0, 2*PI). Winds
// 2^k times around the core as theta0 sweeps once around.
export function solenoidGeneration(k, samples, contraction, offset) {
  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const theta0 = (i / samples) * Math.PI * 2;
    let theta = theta0;
    let z = { x: 0, y: 0 };
    for (let s = 0; s < k; s++) {
      const next = solenoidStep(theta, z, contraction, offset);
      theta = next.theta;
      z = next.z;
    }
    pts.push({ theta, z });
  }
  return pts;
}

// Embeds abstract (theta, z) into R^3 as a point on a tube wound around a
// circle of radius R in the xy-plane: z.x is the radial offset, z.y the
// vertical offset.
export function embedTorus(theta, z, R) {
  const rad = R + z.x;
  return { x: rad * Math.cos(theta), y: rad * Math.sin(theta), z: z.y };
}

// Rotates a 3D point around the Y axis then the X axis, and drops the
// resulting depth (z) for an orthographic 2D projection — a simple, exact
// rotate-then-project pipeline. `depth` is returned for opacity/occlusion
// cues since there's no real depth buffer here.
export function project3D(p, rotY, rotX) {
  const cy = Math.cos(rotY), sy = Math.sin(rotY);
  const x1 = p.x * cy + p.z * sy;
  const z1 = -p.x * sy + p.z * cy;
  const cx = Math.cos(rotX), sx = Math.sin(rotX);
  const y2 = p.y * cx - z1 * sx;
  const depth = p.y * sx + z1 * cx;
  return { x: x1, y: y2, depth };
}
