#!/usr/bin/env bun
/**
 * HyperTerm Canvas — 3D Solid Renderer
 *
 * Real-time 3D objects with flat shading, Phong lighting, and painter's
 * algorithm sorting. Renders filled SVG polygons via the sideband protocol
 * so each shape looks like a polished solid floating over the terminal.
 *
 * Meshes: Torus, Sphere, Icosahedron, Trefoil Knot, Diamond
 * Switch with keys 1-5 or toolbar buttons.
 *
 * Usage:
 *   bun scripts/demo_3d.ts
 */

// ---------------------------------------------------------------------------
// Environment / fd setup
// ---------------------------------------------------------------------------

const META_FD = process.env["HYPERTERM_META_FD"]
  ? parseInt(process.env["HYPERTERM_META_FD"])
  : null;
const DATA_FD = process.env["HYPERTERM_DATA_FD"]
  ? parseInt(process.env["HYPERTERM_DATA_FD"])
  : null;
const EVENT_FD = process.env["HYPERTERM_EVENT_FD"]
  ? parseInt(process.env["HYPERTERM_EVENT_FD"])
  : null;

const hasHyperTerm = META_FD !== null && DATA_FD !== null;

if (!hasHyperTerm) {
  console.log(
    "This script requires HyperTerm Canvas.\n" +
      "Run it inside the HyperTerm terminal emulator.",
  );
  process.exit(0);
}

const PANEL_ID = "3d";

// ---------------------------------------------------------------------------
// Low-level fd helpers
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

function writeMeta(meta: Record<string, unknown>): void {
  try {
    Bun.write(Bun.file(META_FD!), encoder.encode(JSON.stringify(meta) + "\n"));
  } catch {
    /* fd write failed */
  }
}

function writeData(str: string): void {
  try {
    Bun.write(Bun.file(DATA_FD!), encoder.encode(str));
  } catch {
    /* fd write failed */
  }
}

// ---------------------------------------------------------------------------
// Catppuccin Mocha palette
// ---------------------------------------------------------------------------

const C = {
  base: "#1e1e2e",
  surface0: "#313244",
  surface1: "#45475a",
  overlay0: "#6c7086",
  text: "#cdd6f4",
  subtext0: "#a6adc8",
  blue: "#89b4fa",
  green: "#a6e3a1",
  yellow: "#f9e2af",
  pink: "#f5c2e7",
  teal: "#94e2d5",
  red: "#f38ba8",
  mauve: "#cba6f7",
  peach: "#fab387",
} as const;

// ---------------------------------------------------------------------------
// 3D Math — Vec3
// ---------------------------------------------------------------------------

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

function v3add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function v3sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function v3scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function v3dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function v3cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function v3len(a: Vec3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

function v3normalize(a: Vec3): Vec3 {
  const len = v3len(a);
  if (len < 1e-10) return { x: 0, y: 0, z: 0 };
  return { x: a.x / len, y: a.y / len, z: a.z / len };
}

// ---------------------------------------------------------------------------
// 3D Math — 4x4 Matrix (COLUMN-MAJOR, OpenGL convention)
// Index: m[col*4 + row], so m[0..3] = column 0, m[4..7] = column 1, etc.
// ---------------------------------------------------------------------------

type Mat4 = Float64Array;

function mat4Identity(): Mat4 {
  const m = new Float64Array(16);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;
  return m;
}

function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + row] * b[col * 4 + k];
      }
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

function mat4RotateX(angle: number): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const m = mat4Identity();
  // Column 1: (0, c, s, 0)  Column 2: (0, -s, c, 0)
  m[5] = c;
  m[6] = s;
  m[9] = -s;
  m[10] = c;
  return m;
}

function mat4RotateY(angle: number): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const m = mat4Identity();
  // Column 0: (c, 0, -s, 0)  Column 2: (s, 0, c, 0)
  m[0] = c;
  m[2] = -s;
  m[8] = s;
  m[10] = c;
  return m;
}

function mat4LookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const f = v3normalize(v3sub(target, eye));
  const r = v3normalize(v3cross(f, up));
  const u = v3cross(r, f);

  // Column-major: each column is 4 consecutive elements
  // Row 0: r.x, r.y, r.z, -dot(r,eye)
  // Row 1: u.x, u.y, u.z, -dot(u,eye)
  // Row 2: -f.x, -f.y, -f.z, dot(f,eye)
  // Row 3: 0, 0, 0, 1
  const m = new Float64Array(16);
  // Column 0
  m[0] = r.x;
  m[1] = u.x;
  m[2] = -f.x;
  m[3] = 0;
  // Column 1
  m[4] = r.y;
  m[5] = u.y;
  m[6] = -f.y;
  m[7] = 0;
  // Column 2
  m[8] = r.z;
  m[9] = u.z;
  m[10] = -f.z;
  m[11] = 0;
  // Column 3 (translation)
  m[12] = -v3dot(r, eye);
  m[13] = -v3dot(u, eye);
  m[14] = v3dot(f, eye);
  m[15] = 1;
  return m;
}

function mat4Perspective(
  fovY: number,
  aspect: number,
  near: number,
  far: number,
): Mat4 {
  const f = 1.0 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  const m = new Float64Array(16);
  // Column-major OpenGL perspective
  m[0] = f / aspect; // col 0, row 0
  m[5] = f; // col 1, row 1
  m[10] = (far + near) * nf; // col 2, row 2
  m[11] = -1; // col 2, row 3 (perspective divide)
  m[14] = 2 * far * near * nf; // col 3, row 2
  // m[15] = 0 (already zero, perspective projection)
  return m;
}

function mat4TransformPoint(m: Mat4, p: Vec3): Vec3 {
  const x = m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12];
  const y = m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13];
  const z = m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14];
  return { x, y, z };
}

function mat4Project(m: Mat4, p: Vec3): Vec3 {
  const x = m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12];
  const y = m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13];
  const z = m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14];
  const w = m[3] * p.x + m[7] * p.y + m[11] * p.z + m[15];
  if (Math.abs(w) < 1e-10) return { x: 0, y: 0, z: 0 };
  return { x: x / w, y: y / w, z: z / w };
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

interface RGB {
  r: number;
  g: number;
  b: number;
}

function hexToRgb(hex: string): RGB {
  const v = parseInt(hex.slice(1), 16);
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}

function rgbStr(r: number, g: number, b: number): string {
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ---------------------------------------------------------------------------
// Mesh types and generation
// ---------------------------------------------------------------------------

interface Mesh {
  vertices: Vec3[];
  faces: [number, number, number][];
}

// --- Torus: 24 rings x 16 segments ---
function createTorus(): Mesh {
  const R = 1.0;
  const r = 0.4;
  const rings = 24;
  const segments = 16;

  const vertices: Vec3[] = [];
  const faces: [number, number, number][] = [];

  for (let i = 0; i < rings; i++) {
    const theta = (i / rings) * Math.PI * 2;
    const ct = Math.cos(theta);
    const st = Math.sin(theta);
    for (let j = 0; j < segments; j++) {
      const phi = (j / segments) * Math.PI * 2;
      const cp = Math.cos(phi);
      const sp = Math.sin(phi);
      vertices.push(vec3((R + r * cp) * ct, r * sp, (R + r * cp) * st));
    }
  }

  for (let i = 0; i < rings; i++) {
    const ni = (i + 1) % rings;
    for (let j = 0; j < segments; j++) {
      const nj = (j + 1) % segments;
      const a = i * segments + j;
      const b = ni * segments + j;
      const c = ni * segments + nj;
      const d = i * segments + nj;
      faces.push([a, b, c]);
      faces.push([a, c, d]);
    }
  }

  return { vertices, faces };
}

// --- UV Sphere: 20 longitude x 12 latitude ---
function createSphere(): Mesh {
  const lonSteps = 20;
  const latSteps = 12;
  const radius = 1.2;

  const vertices: Vec3[] = [];
  const faces: [number, number, number][] = [];

  // Top pole
  vertices.push(vec3(0, radius, 0));

  // Middle rings
  for (let lat = 1; lat < latSteps; lat++) {
    const phi = (lat / latSteps) * Math.PI;
    const sp = Math.sin(phi);
    const cp = Math.cos(phi);
    for (let lon = 0; lon < lonSteps; lon++) {
      const theta = (lon / lonSteps) * Math.PI * 2;
      vertices.push(
        vec3(
          radius * sp * Math.cos(theta),
          radius * cp,
          radius * sp * Math.sin(theta),
        ),
      );
    }
  }

  // Bottom pole
  const bottomPole = vertices.length;
  vertices.push(vec3(0, -radius, 0));

  // Top cap faces
  for (let lon = 0; lon < lonSteps; lon++) {
    const nlon = (lon + 1) % lonSteps;
    faces.push([0, 1 + lon, 1 + nlon]);
  }

  // Middle faces
  for (let lat = 0; lat < latSteps - 2; lat++) {
    for (let lon = 0; lon < lonSteps; lon++) {
      const nlon = (lon + 1) % lonSteps;
      const a = 1 + lat * lonSteps + lon;
      const b = 1 + lat * lonSteps + nlon;
      const c = 1 + (lat + 1) * lonSteps + nlon;
      const d = 1 + (lat + 1) * lonSteps + lon;
      faces.push([a, d, c]);
      faces.push([a, c, b]);
    }
  }

  // Bottom cap faces
  const lastRingStart = 1 + (latSteps - 2) * lonSteps;
  for (let lon = 0; lon < lonSteps; lon++) {
    const nlon = (lon + 1) % lonSteps;
    faces.push([bottomPole, lastRingStart + nlon, lastRingStart + lon]);
  }

  return { vertices, faces };
}

// --- Icosahedron (subdivided twice for geodesic look) ---
function createIcosahedron(): Mesh {
  const t = (1 + Math.sqrt(5)) / 2;

  const baseVerts: Vec3[] = [
    v3normalize(vec3(-1, t, 0)),
    v3normalize(vec3(1, t, 0)),
    v3normalize(vec3(-1, -t, 0)),
    v3normalize(vec3(1, -t, 0)),
    v3normalize(vec3(0, -1, t)),
    v3normalize(vec3(0, 1, t)),
    v3normalize(vec3(0, -1, -t)),
    v3normalize(vec3(0, 1, -t)),
    v3normalize(vec3(t, 0, -1)),
    v3normalize(vec3(t, 0, 1)),
    v3normalize(vec3(-t, 0, -1)),
    v3normalize(vec3(-t, 0, 1)),
  ];

  let faces: [number, number, number][] = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];

  const vertices = [...baseVerts];
  const midpointCache = new Map<string, number>();

  function getMidpoint(a: number, b: number): number {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    const cached = midpointCache.get(key);
    if (cached !== undefined) return cached;
    const mid = v3normalize(v3scale(v3add(vertices[a], vertices[b]), 0.5));
    const idx = vertices.length;
    vertices.push(mid);
    midpointCache.set(key, idx);
    return idx;
  }

  // Subdivide twice
  for (let sub = 0; sub < 2; sub++) {
    const newFaces: [number, number, number][] = [];
    midpointCache.clear();
    for (const [a, b, c] of faces) {
      const ab = getMidpoint(a, b);
      const bc = getMidpoint(b, c);
      const ca = getMidpoint(c, a);
      newFaces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = newFaces;
  }

  // Scale to radius 1.2
  const scaled = vertices.map((v) => v3scale(v, 1.2));

  return { vertices: scaled, faces };
}

// --- Trefoil Knot as tube surface ---
function createKnot(): Mesh {
  const curveSteps = 80;
  const tubeSegments = 10;
  const tubeRadius = 0.18;

  // Trefoil knot parametric curve
  function knotPoint(t: number): Vec3 {
    return vec3(
      Math.sin(t) + 2 * Math.sin(2 * t),
      Math.cos(t) - 2 * Math.cos(2 * t),
      -Math.sin(3 * t),
    );
  }

  // Compute Frenet frame along curve
  const curvePoints: Vec3[] = [];
  const tangents: Vec3[] = [];
  const normals: Vec3[] = [];
  const binormals: Vec3[] = [];

  const dt = 0.001;
  for (let i = 0; i < curveSteps; i++) {
    const t = (i / curveSteps) * Math.PI * 2;
    const p = knotPoint(t);
    const pNext = knotPoint(t + dt);
    const tangent = v3normalize(v3sub(pNext, p));
    curvePoints.push(p);
    tangents.push(tangent);
  }

  // Compute normals via finite differences
  for (let i = 0; i < curveSteps; i++) {
    const t = (i / curveSteps) * Math.PI * 2;
    const p0 = knotPoint(t - dt);
    const p1 = knotPoint(t);
    const p2 = knotPoint(t + dt);
    const t1 = v3normalize(v3sub(p1, p0));
    const t2 = v3normalize(v3sub(p2, p1));
    let n = v3normalize(v3cross(t1, t2));
    if (v3len(n) < 1e-6) {
      // Fallback: pick an arbitrary perpendicular
      const tang = tangents[i];
      const up = Math.abs(tang.y) < 0.9 ? vec3(0, 1, 0) : vec3(1, 0, 0);
      n = v3normalize(v3cross(tang, up));
    }
    normals.push(n);
    binormals.push(v3normalize(v3cross(tangents[i], n)));
  }

  // Generate tube vertices
  const vertices: Vec3[] = [];
  const faces: [number, number, number][] = [];

  // Scale the knot to fit nicely
  const knotScale = 0.32;

  for (let i = 0; i < curveSteps; i++) {
    const center = v3scale(curvePoints[i], knotScale);
    const N = normals[i];
    const B = binormals[i];
    for (let j = 0; j < tubeSegments; j++) {
      const angle = (j / tubeSegments) * Math.PI * 2;
      const ca = Math.cos(angle);
      const sa = Math.sin(angle);
      const offset = v3add(
        v3scale(N, ca * tubeRadius),
        v3scale(B, sa * tubeRadius),
      );
      vertices.push(v3add(center, offset));
    }
  }

  // Generate faces
  for (let i = 0; i < curveSteps; i++) {
    const ni = (i + 1) % curveSteps;
    for (let j = 0; j < tubeSegments; j++) {
      const nj = (j + 1) % tubeSegments;
      const a = i * tubeSegments + j;
      const b = ni * tubeSegments + j;
      const c = ni * tubeSegments + nj;
      const d = i * tubeSegments + nj;
      faces.push([a, b, c]);
      faces.push([a, c, d]);
    }
  }

  return { vertices, faces };
}

// --- Diamond: two cones joined at a circular base ---
function createDiamond(): Mesh {
  const segments = 24;
  const topHeight = 1.4;
  const bottomHeight = 0.6;
  const radius = 0.8;

  const vertices: Vec3[] = [];
  const faces: [number, number, number][] = [];

  // Top apex
  const topApex = 0;
  vertices.push(vec3(0, topHeight, 0));

  // Ring vertices (indices 1..segments)
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    vertices.push(vec3(radius * Math.cos(angle), 0, radius * Math.sin(angle)));
  }

  // Bottom apex
  const bottomApex = vertices.length;
  vertices.push(vec3(0, -bottomHeight, 0));

  // Top cone faces
  for (let i = 0; i < segments; i++) {
    const ni = (i + 1) % segments;
    faces.push([topApex, 1 + i, 1 + ni]);
  }

  // Bottom cone faces (reversed winding)
  for (let i = 0; i < segments; i++) {
    const ni = (i + 1) % segments;
    faces.push([bottomApex, 1 + ni, 1 + i]);
  }

  return { vertices, faces };
}

// ---------------------------------------------------------------------------
// Object registry
// ---------------------------------------------------------------------------

interface ObjectDef {
  name: string;
  shortcut: string;
  baseColor: RGB;
  mesh: Mesh;
}

const OBJECTS: ObjectDef[] = [
  {
    name: "Torus",
    shortcut: "1",
    baseColor: hexToRgb(C.blue),
    mesh: createTorus(),
  },
  {
    name: "Sphere",
    shortcut: "2",
    baseColor: hexToRgb(C.green),
    mesh: createSphere(),
  },
  {
    name: "Icosa",
    shortcut: "3",
    baseColor: hexToRgb(C.yellow),
    mesh: createIcosahedron(),
  },
  {
    name: "Knot",
    shortcut: "4",
    baseColor: hexToRgb(C.pink),
    mesh: createKnot(),
  },
  {
    name: "Diamond",
    shortcut: "5",
    baseColor: hexToRgb(C.teal),
    mesh: createDiamond(),
  },
];

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const PANEL_W = 500;
const PANEL_H = 540;
const TOOLBAR_H = 22;
const VIEWPORT_W = 500;
const VIEWPORT_H = PANEL_H - TOOLBAR_H;
const VIEWPORT_CX = VIEWPORT_W / 2;
const VIEWPORT_CY = VIEWPORT_H / 2;

// Toolbar button layout
const BTN_W = 58;
const BTN_H = 16;
const BTN_GAP = 4;
const BTN_Y = 3;
const BTN_START_X = 6;

// ---------------------------------------------------------------------------
// Lighting presets
// ---------------------------------------------------------------------------

const LIGHT_DIRS: Vec3[] = [
  v3normalize(vec3(0.5, 0.8, 1.0)), // front-top-right
  v3normalize(vec3(0.0, 1.0, 0.3)), // top
  v3normalize(vec3(1.0, 0.3, 0.0)), // side
];

const LIGHT_NAMES = ["Front", "Top", "Side"];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let rotX = 0.35;
let rotY = 0.5;
let dragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragRotX = 0;
let dragRotY = 0;
let zoom = 4.5;
let autoRotate = true;
let currentObject = 0;
let wireframeOverlay = false;
let lightIndex = 0;
let dirty = true;

// FPS tracking
let frameCount = 0;
let fpsTime = Date.now();
let currentFps = 0;

// ---------------------------------------------------------------------------
// Lighting computation
// ---------------------------------------------------------------------------

const AMBIENT = 0.15;
const DIFFUSE_STRENGTH = 0.65;
const SPECULAR_STRENGTH = 0.4;
const SHININESS = 32;

function computeFaceColor(normal: Vec3, viewDir: Vec3, base: RGB): string {
  const lightDir = LIGHT_DIRS[lightIndex];

  // Diffuse
  const ndotl = Math.max(0, v3dot(normal, lightDir));
  const diffuse = ndotl * DIFFUSE_STRENGTH;

  // Specular (Blinn-Phong: halfway vector)
  const halfway = v3normalize(v3add(lightDir, viewDir));
  const ndoth = Math.max(0, v3dot(normal, halfway));
  const specular = Math.pow(ndoth, SHININESS) * SPECULAR_STRENGTH;

  const intensity = AMBIENT + diffuse;

  const r = clamp(base.r * intensity + 255 * specular, 0, 255);
  const g = clamp(base.g * intensity + 255 * specular, 0, 255);
  const b = clamp(base.b * intensity + 255 * specular, 0, 255);

  return rgbStr(r, g, b);
}

// ---------------------------------------------------------------------------
// Rendering pipeline
// ---------------------------------------------------------------------------

interface ScreenFace {
  points: string; // "x1,y1 x2,y2 x3,y3"
  avgZ: number;
  fill: string;
}

function renderScene(): string {
  const objDef = OBJECTS[currentObject];
  const mesh = objDef.mesh;
  const { vertices, faces } = mesh;
  const baseColor = objDef.baseColor;

  // Model rotation
  const modelMat = mat4Multiply(mat4RotateX(rotX), mat4RotateY(rotY));

  // Camera
  const eye = vec3(0, 0, zoom);
  const viewMat = mat4LookAt(eye, vec3(0, 0, 0), vec3(0, 1, 0));
  const aspect = VIEWPORT_W / VIEWPORT_H;
  const projMat = mat4Perspective(Math.PI / 4, aspect, 0.1, 100);

  // Combined
  const mvMat = mat4Multiply(viewMat, modelMat);
  const mvpMat = mat4Multiply(projMat, mvMat);

  // Transform all vertices to world space (for normals and lighting)
  const worldVerts = vertices.map((v) => mat4TransformPoint(modelMat, v));

  // Project all vertices to screen
  const projected = vertices.map((v) => {
    const clip = mat4Project(mvpMat, v);
    return {
      x: VIEWPORT_CX + clip.x * VIEWPORT_CX,
      y: VIEWPORT_CY - clip.y * VIEWPORT_CY,
      z: clip.z,
    };
  });

  // Build visible faces with lighting
  const screenFaces: ScreenFace[] = [];

  for (let fi = 0; fi < faces.length; fi++) {
    const [ai, bi, ci] = faces[fi];
    const wa = worldVerts[ai];
    const wb = worldVerts[bi];
    const wc = worldVerts[ci];

    // Face normal (world space)
    const e1 = v3sub(wb, wa);
    const e2 = v3sub(wc, wa);
    const normal = v3normalize(v3cross(e1, e2));

    // Face center (world space)
    const center = v3scale(v3add(v3add(wa, wb), wc), 1 / 3);

    // View direction from face center to eye
    const viewDir = v3normalize(v3sub(eye, center));

    // Back-face culling
    if (v3dot(normal, viewDir) <= 0) continue;

    // Screen coordinates
    const pa = projected[ai];
    const pb = projected[bi];
    const pc = projected[ci];

    // Clip faces behind camera
    if (pa.z < -1 || pb.z < -1 || pc.z < -1) continue;
    if (pa.z > 1 || pb.z > 1 || pc.z > 1) continue;

    const avgZ = (pa.z + pb.z + pc.z) / 3;

    // Compute face color with lighting
    const fill = computeFaceColor(normal, viewDir, baseColor);

    const points =
      `${pa.x.toFixed(1)},${pa.y.toFixed(1)} ` +
      `${pb.x.toFixed(1)},${pb.y.toFixed(1)} ` +
      `${pc.x.toFixed(1)},${pc.y.toFixed(1)}`;

    screenFaces.push({ points, avgZ, fill });
  }

  // Painter's algorithm: sort far to near
  screenFaces.sort((a, b) => b.avgZ - a.avgZ);

  // Generate SVG polygons
  const parts: string[] = [];
  if (wireframeOverlay) {
    for (const f of screenFaces) {
      parts.push(
        `<polygon points="${f.points}" fill="${f.fill}" stroke="rgba(0,0,0,0.3)" stroke-width="0.5"/>`,
      );
    }
  } else {
    for (const f of screenFaces) {
      parts.push(
        `<polygon points="${f.points}" fill="${f.fill}" stroke="${f.fill}" stroke-width="0.3"/>`,
      );
    }
  }

  return parts.join("\n    ");
}

// ---------------------------------------------------------------------------
// Full SVG rendering
// ---------------------------------------------------------------------------

function renderSvg(): string {
  const scene = renderScene();
  const objDef = OBJECTS[currentObject];

  // Toolbar buttons
  const toolbarButtons = OBJECTS.map((obj, i) => {
    const x = BTN_START_X + i * (BTN_W + BTN_GAP);
    const active = i === currentObject;
    const hexColor = [C.blue, C.green, C.yellow, C.pink, C.teal][i];
    const bg = active ? hexColor : C.surface1;
    const fg = active ? C.base : C.text;
    return `<rect x="${x}" y="${BTN_Y}" width="${BTN_W}" height="${BTN_H}" rx="3" fill="${bg}"/>
    <text x="${x + BTN_W / 2}" y="${BTN_Y + BTN_H / 2 + 4}" text-anchor="middle" fill="${fg}" font-size="10" font-family="monospace" font-weight="${active ? 700 : 400}">${obj.shortcut}:${obj.name}</text>`;
  }).join("\n    ");

  // Status indicators (right side of toolbar)
  const statusX = PANEL_W - 140;
  const autoColor = autoRotate ? C.green : C.overlay0;
  const wireColor = wireframeOverlay ? C.peach : C.overlay0;
  const lightColor = C.yellow;

  const statusText = `<text x="${statusX}" y="${BTN_Y + BTN_H / 2 + 4}" fill="${autoColor}" font-size="9" font-family="monospace">${autoRotate ? "AUTO" : "auto"}</text>
    <text x="${statusX + 35}" y="${BTN_Y + BTN_H / 2 + 4}" fill="${wireColor}" font-size="9" font-family="monospace">${wireframeOverlay ? "WIRE" : "wire"}</text>
    <text x="${statusX + 70}" y="${BTN_Y + BTN_H / 2 + 4}" fill="${lightColor}" font-size="9" font-family="monospace">${LIGHT_NAMES[lightIndex]}</text>
    <text x="${statusX + 105}" y="${BTN_Y + BTN_H / 2 + 4}" fill="${C.overlay0}" font-size="9" font-family="monospace">${currentFps}fps</text>`;

  // Light direction indicator (small filled circle showing light position)
  const lightDir = LIGHT_DIRS[lightIndex];
  const indicatorX = VIEWPORT_W - 25;
  const indicatorY = VIEWPORT_H - 25;
  const lx = indicatorX + lightDir.x * 10;
  const ly = indicatorY - lightDir.y * 10;

  const lightIndicator = `<circle cx="${indicatorX}" cy="${indicatorY}" r="12" fill="none" stroke="${C.surface1}" stroke-width="1"/>
    <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="3" fill="${C.yellow}"/>`;

  // Object label at bottom-left
  const objLabel = `<text x="10" y="${VIEWPORT_H - 12}" fill="${[C.blue, C.green, C.yellow, C.pink, C.teal][currentObject]}" font-size="11" font-family="monospace" opacity="0.6">${objDef.name} | ${objDef.mesh.faces.length} faces</text>`;

  // NO background rect - transparent SVG
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PANEL_W}" height="${PANEL_H}" viewBox="0 0 ${PANEL_W} ${PANEL_H}">
  <!-- Toolbar -->
  <rect x="0" y="0" width="${PANEL_W}" height="${TOOLBAR_H}" fill="${C.surface0}" opacity="0.85"/>
  <line x1="0" y1="${TOOLBAR_H}" x2="${PANEL_W}" y2="${TOOLBAR_H}" stroke="${C.surface1}" stroke-width="1"/>
  ${toolbarButtons}
  ${statusText}

  <!-- Viewport (transparent background, just 3D geometry) -->
  <g transform="translate(0,${TOOLBAR_H})">
    ${scene}
    ${lightIndicator}
    ${objLabel}
  </g>
</svg>`;
}

// ---------------------------------------------------------------------------
// Panel update
// ---------------------------------------------------------------------------

let firstRender = true;

function render(): void {
  const svg = renderSvg();
  const bytes = encoder.encode(svg);

  if (firstRender) {
    writeMeta({
      id: PANEL_ID,
      type: "svg",
      position: "float",
      x: 100,
      y: 50,
      width: PANEL_W,
      height: PANEL_H,
      interactive: true,
      draggable: true,
      resizable: true,
      borderRadius: 0,
      opacity: 1,
      byteLength: bytes.byteLength,
    });
    firstRender = false;
  } else {
    writeMeta({
      id: PANEL_ID,
      type: "update",
      byteLength: bytes.byteLength,
    });
  }

  writeData(svg);

  // FPS counting
  frameCount++;
  const now = Date.now();
  if (now - fpsTime >= 1000) {
    currentFps = frameCount;
    frameCount = 0;
    fpsTime = now;
  }
}

// ---------------------------------------------------------------------------
// Animation loop — only re-renders when dirty
// ---------------------------------------------------------------------------

const FRAME_INTERVAL = 50; // ~20fps

const timer = setInterval(() => {
  if (autoRotate && !dragging) {
    rotY += 0.025;
    rotX += 0.006;
    dirty = true;
  }
  if (dirty) {
    render();
    dirty = false;
  }
}, FRAME_INTERVAL);

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

type HitArea =
  | { area: "toolbar"; objectIndex: number }
  | { area: "viewport" }
  | { area: "none" };

function hitTest(x: number, y: number): HitArea {
  if (y < TOOLBAR_H) {
    for (let i = 0; i < OBJECTS.length; i++) {
      const bx = BTN_START_X + i * (BTN_W + BTN_GAP);
      if (x >= bx && x < bx + BTN_W && y >= BTN_Y && y < BTN_Y + BTN_H) {
        return { area: "toolbar", objectIndex: i };
      }
    }
    return { area: "none" };
  }
  return { area: "viewport" };
}

// ---------------------------------------------------------------------------
// Event handling (fd 5 — mouse events)
// ---------------------------------------------------------------------------

function handleEvent(event: Record<string, unknown>): void {
  const evtId = event["id"] as string;
  const evtType = event["event"] as string;

  if (evtId !== PANEL_ID) return;

  const ex = (event["x"] as number) ?? 0;
  const ey = (event["y"] as number) ?? 0;
  const buttons = (event["buttons"] as number) ?? 0;

  switch (evtType) {
    case "close": {
      cleanup();
      break;
    }

    case "mousedown": {
      const hit = hitTest(ex, ey);

      if (hit.area === "toolbar") {
        if (hit.objectIndex !== currentObject) {
          currentObject = hit.objectIndex;
          dirty = true;
          console.log(`\rSwitched to: ${OBJECTS[currentObject].name}`);
        }
        return;
      }

      if (hit.area === "viewport") {
        dragging = true;
        dragStartX = ex;
        dragStartY = ey;
        dragRotX = rotX;
        dragRotY = rotY;
      }
      break;
    }

    case "mousemove": {
      if (!dragging) return;
      if (buttons !== 1) {
        dragging = false;
        return;
      }

      const dx = ex - dragStartX;
      const dy = ey - dragStartY;
      rotY = dragRotY + dx * 0.01;
      rotX = dragRotX + dy * 0.01;
      rotX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, rotX));
      dirty = true;
      break;
    }

    case "mouseup": {
      dragging = false;
      break;
    }

    case "mouseleave": {
      dragging = false;
      break;
    }

    case "wheel": {
      const deltaY = (event["deltaY"] as number) ?? 0;
      zoom += deltaY * 0.01;
      zoom = Math.max(2, Math.min(15, zoom));
      dirty = true;
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Event loop (fd 5)
// ---------------------------------------------------------------------------

async function readEvents(): Promise<void> {
  if (EVENT_FD === null) return;

  try {
    const stream = Bun.file(EVENT_FD).stream();
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          handleEvent(JSON.parse(line));
        } catch {
          // invalid JSON
        }
      }
    }
  } catch {
    // fd closed
  }
}

// ---------------------------------------------------------------------------
// Keyboard input (stdin raw mode)
// ---------------------------------------------------------------------------

// Arrow key escape sequences
const ESC_UP = "\x1b[A";
const ESC_DOWN = "\x1b[B";
const ESC_RIGHT = "\x1b[C";
const ESC_LEFT = "\x1b[D";

async function readStdin(): Promise<void> {
  process.stdin.setRawMode(true);
  const reader = Bun.stdin.stream().getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const str = decoder.decode(value, { stream: true });

      // Check for escape sequences (arrow keys)
      if (str === ESC_LEFT) {
        rotY -= 0.15;
        dirty = true;
        continue;
      }
      if (str === ESC_RIGHT) {
        rotY += 0.15;
        dirty = true;
        continue;
      }
      if (str === ESC_UP) {
        rotX -= 0.15;
        rotX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, rotX));
        dirty = true;
        continue;
      }
      if (str === ESC_DOWN) {
        rotX += 0.15;
        rotX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, rotX));
        dirty = true;
        continue;
      }

      for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        const char = str[i];

        // Ctrl+C or q/Q to quit
        if (ch === 3 || char === "q" || char === "Q") {
          cleanup();
          return;
        }

        // Number keys 1-5 switch mesh
        if (char >= "1" && char <= "5") {
          const idx = parseInt(char) - 1;
          if (idx < OBJECTS.length && idx !== currentObject) {
            currentObject = idx;
            dirty = true;
            console.log(`\rSwitched to: ${OBJECTS[currentObject].name}`);
          }
          continue;
        }

        // + or z: zoom in
        if (char === "+" || char === "z" || char === "Z") {
          zoom = Math.max(2, zoom - 0.4);
          dirty = true;
          continue;
        }

        // - or x: zoom out
        if (char === "-" || char === "x" || char === "X") {
          zoom = Math.min(15, zoom + 0.4);
          dirty = true;
          continue;
        }

        // a: toggle auto-rotate
        if (char === "a" || char === "A") {
          autoRotate = !autoRotate;
          dirty = true;
          console.log(`\rAuto-rotate: ${autoRotate ? "ON" : "OFF"}`);
          continue;
        }

        // l: cycle lighting mode
        if (char === "l" || char === "L") {
          lightIndex = (lightIndex + 1) % LIGHT_DIRS.length;
          dirty = true;
          console.log(`\rLight: ${LIGHT_NAMES[lightIndex]}`);
          continue;
        }

        // w: toggle wireframe overlay
        if (char === "w" || char === "W") {
          wireframeOverlay = !wireframeOverlay;
          dirty = true;
          console.log(`\rWireframe: ${wireframeOverlay ? "ON" : "OFF"}`);
          continue;
        }

        // r: reset view
        if (char === "r" || char === "R") {
          rotX = 0.35;
          rotY = 0.5;
          zoom = 4.5;
          autoRotate = true;
          wireframeOverlay = false;
          lightIndex = 0;
          dirty = true;
          console.log("\rView reset");
          continue;
        }
      }
    }
  } catch {
    // stdin closed
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

function cleanup(): void {
  clearInterval(timer);
  try {
    process.stdin.setRawMode(false);
  } catch {
    /* may fail if already closed */
  }
  writeMeta({ id: PANEL_ID, type: "clear" });
  console.log("\n3D Renderer closed.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

console.log("HyperTerm 3D Solid Renderer");
console.log("Controls:");
console.log("  1-5         Switch mesh (Torus, Sphere, Icosa, Knot, Diamond)");
console.log("  Arrow keys  Rotate (left/right = Y, up/down = X)");
console.log("  +/- or z/x  Zoom in/out");
console.log("  a           Toggle auto-rotation");
console.log("  l           Cycle lighting (Front, Top, Side)");
console.log("  w           Toggle wireframe overlay");
console.log("  r           Reset view");
console.log("  q / Ctrl+C  Quit");
console.log("  Mouse drag  Rotate | Scroll  Zoom | Click toolbar buttons");
console.log("");

// Initial render
render();

// Start event loop and stdin reader
readEvents();
readStdin();

// Cleanup on SIGINT
process.on("SIGINT", () => {
  cleanup();
});
