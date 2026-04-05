#!/usr/bin/env bun
/**
 * HyperTerm Canvas — 3D Wireframe Viewer
 *
 * Real-time rotating 3D objects rendered as SVG lines via the sideband
 * protocol. Supports mouse rotation, zoom, auto-rotation, back-face
 * culling, and depth-based edge coloring.
 *
 * Objects: Cube, Icosphere, Torus, Cylinder — switch with keys 1-4
 * or by clicking the toolbar buttons.
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
  mauve: "#cba6f7",
  peach: "#fab387",
  teal: "#94e2d5",
  red: "#f38ba8",
} as const;

// Depth coloring endpoints
const DEPTH_NEAR_R = 0xcd,
  DEPTH_NEAR_G = 0xd6,
  DEPTH_NEAR_B = 0xf4; // #cdd6f4
const DEPTH_FAR_R = 0x45,
  DEPTH_FAR_G = 0x47,
  DEPTH_FAR_B = 0x5a; // #45475a

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
// 3D Math — 4x4 Matrix (column-major float array)
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
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[i * 4 + k] * b[k * 4 + j];
      }
      out[i * 4 + j] = sum;
    }
  }
  return out;
}

function mat4RotateX(angle: number): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const m = mat4Identity();
  m[5] = c;
  m[6] = -s;
  m[9] = s;
  m[10] = c;
  return m;
}

function mat4RotateY(angle: number): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const m = mat4Identity();
  m[0] = c;
  m[2] = s;
  m[8] = -s;
  m[10] = c;
  return m;
}

function mat4LookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const f = v3normalize(v3sub(target, eye));
  const r = v3normalize(v3cross(f, up));
  const u = v3cross(r, f);

  const m = mat4Identity();
  m[0] = r.x;
  m[1] = u.x;
  m[2] = -f.x;
  m[4] = r.y;
  m[5] = u.y;
  m[6] = -f.y;
  m[8] = r.z;
  m[9] = u.z;
  m[10] = -f.z;
  m[12] = -v3dot(r, eye);
  m[13] = -v3dot(u, eye);
  m[14] = v3dot(f, eye);
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
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

function mat4TransformPoint(m: Mat4, p: Vec3): Vec3 {
  const x = m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12];
  const y = m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13];
  const z = m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14];
  return { x, y, z };
}

function mat4Project(m: Mat4, p: Vec3): { x: number; y: number; z: number } {
  const x = m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12];
  const y = m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13];
  const z = m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14];
  const w = m[3] * p.x + m[7] * p.y + m[11] * p.z + m[15];
  if (Math.abs(w) < 1e-10) return { x: 0, y: 0, z: 0 };
  return { x: x / w, y: y / w, z: z / w };
}

// ---------------------------------------------------------------------------
// 3D Object definitions
// ---------------------------------------------------------------------------

interface Mesh {
  vertices: Vec3[];
  edges: [number, number][];
  faces: [number, number, number][];
}

function createCube(): Mesh {
  const s = 1;
  const vertices: Vec3[] = [
    vec3(-s, -s, -s),
    vec3(s, -s, -s),
    vec3(s, s, -s),
    vec3(-s, s, -s),
    vec3(-s, -s, s),
    vec3(s, -s, s),
    vec3(s, s, s),
    vec3(-s, s, s),
  ];
  const edges: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  const faces: [number, number, number][] = [
    [0, 1, 2],
    [0, 2, 3], // front
    [4, 6, 5],
    [4, 7, 6], // back
    [0, 4, 5],
    [0, 5, 1], // bottom
    [2, 6, 7],
    [2, 7, 3], // top
    [0, 3, 7],
    [0, 7, 4], // left
    [1, 5, 6],
    [1, 6, 2], // right
  ];
  return { vertices, edges, faces };
}

function createIcosphere(): Mesh {
  // Start with an icosahedron
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

  let baseFaces: [number, number, number][] = [
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

  // Subdivide once
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

  const newFaces: [number, number, number][] = [];
  for (const [a, b, c] of baseFaces) {
    const ab = getMidpoint(a, b);
    const bc = getMidpoint(b, c);
    const ca = getMidpoint(c, a);
    newFaces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
  }
  baseFaces = newFaces;

  // Build edge set from faces
  const edgeSet = new Set<string>();
  const edges: [number, number][] = [];
  for (const [a, b, c] of baseFaces) {
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ] as [number, number][]) {
      const key = u < v ? `${u}_${v}` : `${v}_${u}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push([u, v]);
      }
    }
  }

  // Scale to radius ~1.2 for visual balance
  const scaled = vertices.map((v) => v3scale(v, 1.2));

  return { vertices: scaled, edges, faces: baseFaces };
}

function createTorus(): Mesh {
  const R = 1.0; // major radius
  const r = 0.4; // minor radius
  const rings = 20;
  const segments = 12;

  const vertices: Vec3[] = [];
  const edges: [number, number][] = [];
  const faces: [number, number, number][] = [];

  // Generate vertices
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

  // Generate edges and faces
  for (let i = 0; i < rings; i++) {
    const ni = (i + 1) % rings;
    for (let j = 0; j < segments; j++) {
      const nj = (j + 1) % segments;
      const a = i * segments + j;
      const b = ni * segments + j;
      const c = ni * segments + nj;
      const d = i * segments + nj;
      // Ring edge
      edges.push([a, d]);
      // Segment edge
      edges.push([a, b]);
      // Faces for culling
      faces.push([a, b, c]);
      faces.push([a, c, d]);
    }
  }

  return { vertices, edges, faces };
}

function createCylinder(): Mesh {
  const segments = 20;
  const h = 1.4;
  const r = 0.8;

  const vertices: Vec3[] = [];
  const edges: [number, number][] = [];
  const faces: [number, number, number][] = [];

  // Top circle vertices (0..segments-1)
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    vertices.push(vec3(r * Math.cos(angle), h / 2, r * Math.sin(angle)));
  }
  // Bottom circle vertices (segments..2*segments-1)
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    vertices.push(vec3(r * Math.cos(angle), -h / 2, r * Math.sin(angle)));
  }
  // Top center
  const topCenter = vertices.length;
  vertices.push(vec3(0, h / 2, 0));
  // Bottom center
  const botCenter = vertices.length;
  vertices.push(vec3(0, -h / 2, 0));

  // Top circle edges + faces
  for (let i = 0; i < segments; i++) {
    const ni = (i + 1) % segments;
    edges.push([i, ni]);
    faces.push([topCenter, i, ni]);
  }
  // Bottom circle edges + faces
  for (let i = 0; i < segments; i++) {
    const ni = (i + 1) % segments;
    edges.push([segments + i, segments + ni]);
    faces.push([botCenter, segments + ni, segments + i]);
  }
  // Vertical edges + side faces
  for (let i = 0; i < segments; i++) {
    edges.push([i, segments + i]);
    const ni = (i + 1) % segments;
    faces.push([i, segments + i, segments + ni]);
    faces.push([i, segments + ni, ni]);
  }

  return { vertices, edges, faces };
}

// ---------------------------------------------------------------------------
// Object registry
// ---------------------------------------------------------------------------

interface ObjectDef {
  name: string;
  shortcut: string;
  color: string;
  mesh: Mesh;
}

const OBJECTS: ObjectDef[] = [
  { name: "Cube", shortcut: "1", color: C.blue, mesh: createCube() },
  { name: "Sphere", shortcut: "2", color: C.green, mesh: createIcosphere() },
  { name: "Torus", shortcut: "3", color: C.mauve, mesh: createTorus() },
  { name: "Cyl", shortcut: "4", color: C.peach, mesh: createCylinder() },
];

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const PANEL_W = 500;
const PANEL_H = 520;
const TOOLBAR_H = 20;
const VIEWPORT_W = 500;
const VIEWPORT_H = 480;
const VIEWPORT_Y = TOOLBAR_H;

// Toolbar button layout
const BTN_W = 56;
const BTN_H = 16;
const BTN_GAP = 4;
const BTN_Y = 2;
const BTN_START_X = 6;

// Auto-rotate toggle button
const AUTO_BTN_X = PANEL_W - BTN_W - 6;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let rotX = 0.3;
let rotY = 0.4;
let dragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragRotX = 0;
let dragRotY = 0;
let zoom = 5;
let autoRotate = true;
let currentObject = 0;

// FPS tracking
let frameCount = 0;
let fpsTime = Date.now();
let currentFps = 0;

// ---------------------------------------------------------------------------
// Depth color interpolation
// ---------------------------------------------------------------------------

function depthColor(t: number): string {
  // t: 0 = near (bright), 1 = far (dim)
  const clamped = Math.max(0, Math.min(1, t));
  const r = Math.round(DEPTH_NEAR_R + (DEPTH_FAR_R - DEPTH_NEAR_R) * clamped);
  const g = Math.round(DEPTH_NEAR_G + (DEPTH_FAR_G - DEPTH_NEAR_G) * clamped);
  const b = Math.round(DEPTH_NEAR_B + (DEPTH_FAR_B - DEPTH_NEAR_B) * clamped);
  const toHex = (v: number) => v.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// ---------------------------------------------------------------------------
// Rendering pipeline
// ---------------------------------------------------------------------------

interface ScreenEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  avgZ: number;
  color: string;
}

function renderScene(): string {
  const mesh = OBJECTS[currentObject].mesh;
  const { vertices, edges, faces } = mesh;

  // Model rotation
  const modelMat = mat4Multiply(mat4RotateX(rotX), mat4RotateY(rotY));

  // Camera
  const eye = vec3(0, 0, zoom);
  const viewMat = mat4LookAt(eye, vec3(0, 0, 0), vec3(0, 1, 0));
  const aspect = VIEWPORT_W / VIEWPORT_H;
  const projMat = mat4Perspective(Math.PI / 4, aspect, 0.1, 100);

  // Combined model-view-projection
  const mvMat = mat4Multiply(viewMat, modelMat);
  const mvpMat = mat4Multiply(projMat, mvMat);

  // Transform all vertices to world space (for culling normals)
  const worldVerts = vertices.map((v) => mat4TransformPoint(modelMat, v));

  // Project all vertices to screen
  const projected = vertices.map((v) => {
    const clip = mat4Project(mvpMat, v);
    return {
      x: (clip.x * 0.5 + 0.5) * VIEWPORT_W,
      y: (1 - (clip.y * 0.5 + 0.5)) * VIEWPORT_H,
      z: clip.z,
    };
  });

  // Back-face culling: determine which faces are visible
  const visibleFaces = new Set<number>();
  for (let fi = 0; fi < faces.length; fi++) {
    const [a, b, c] = faces[fi];
    const wa = worldVerts[a];
    const wb = worldVerts[b];
    const wc = worldVerts[c];
    const e1 = v3sub(wb, wa);
    const e2 = v3sub(wc, wa);
    const normal = v3normalize(v3cross(e1, e2));
    // Face center for view direction
    const center = v3scale(v3add(v3add(wa, wb), wc), 1 / 3);
    const viewDir = v3normalize(v3sub(eye, center));
    if (v3dot(normal, viewDir) > -0.05) {
      visibleFaces.add(fi);
    }
  }

  // Build set of edges that belong to at least one visible face
  const visibleEdgeSet = new Set<string>();
  for (let fi = 0; fi < faces.length; fi++) {
    if (!visibleFaces.has(fi)) continue;
    const [a, b, c] = faces[fi];
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ] as [number, number][]) {
      const key = u < v ? `${u}_${v}` : `${v}_${u}`;
      visibleEdgeSet.add(key);
    }
  }

  // Find min/max Z for depth coloring normalization
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of projected) {
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  const zRange = maxZ - minZ;

  // Build screen edges
  const screenEdges: ScreenEdge[] = [];
  for (const [a, b] of edges) {
    // Check culling
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    if (!visibleEdgeSet.has(key)) continue;

    const pa = projected[a];
    const pb = projected[b];

    // Clip: skip edges behind camera
    if (pa.z < -1 || pb.z < -1 || pa.z > 1 || pb.z > 1) continue;

    const avgZ = (pa.z + pb.z) / 2;
    const depthT = zRange > 1e-6 ? (avgZ - minZ) / zRange : 0.5;

    screenEdges.push({
      x1: pa.x,
      y1: pa.y,
      x2: pb.x,
      y2: pb.y,
      avgZ,
      color: depthColor(depthT),
    });
  }

  // Sort by Z (far first so closer edges draw on top)
  screenEdges.sort((a, b) => b.avgZ - a.avgZ);

  // Generate SVG lines
  const lines = screenEdges
    .map(
      (e) =>
        `<line x1="${e.x1.toFixed(1)}" y1="${e.y1.toFixed(1)}" x2="${e.x2.toFixed(1)}" y2="${e.y2.toFixed(1)}" stroke="${e.color}" stroke-width="1.5" stroke-linecap="round"/>`,
    )
    .join("\n    ");

  return lines;
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
    const bg = active ? obj.color : C.surface1;
    const fg = active ? C.base : C.text;
    return `<rect x="${x}" y="${BTN_Y}" width="${BTN_W}" height="${BTN_H}" rx="3" fill="${bg}"/>
    <text x="${x + BTN_W / 2}" y="${BTN_Y + BTN_H / 2 + 4}" text-anchor="middle" fill="${fg}" font-size="10" font-family="monospace" font-weight="${active ? 700 : 400}">${obj.name}</text>`;
  }).join("\n    ");

  // Auto-rotate toggle
  const autoBg = autoRotate ? C.teal : C.surface1;
  const autoFg = autoRotate ? C.base : C.text;
  const autoBtn = `<rect x="${AUTO_BTN_X}" y="${BTN_Y}" width="${BTN_W}" height="${BTN_H}" rx="3" fill="${autoBg}"/>
    <text x="${AUTO_BTN_X + BTN_W / 2}" y="${BTN_Y + BTN_H / 2 + 4}" text-anchor="middle" fill="${autoFg}" font-size="11" font-family="monospace" font-weight="${autoRotate ? 700 : 400}">\u27F3 Auto</text>`;

  // FPS overlay
  const fpsText = `<text x="${VIEWPORT_W - 10}" y="${VIEWPORT_H - 10}" text-anchor="end" fill="${C.overlay0}" font-size="11" font-family="monospace">FPS: ${currentFps}</text>`;

  // Object label
  const objLabel = `<text x="10" y="${VIEWPORT_H - 10}" fill="${objDef.color}" font-size="11" font-family="monospace" opacity="0.7">${objDef.name}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PANEL_W}" height="${PANEL_H}" viewBox="0 0 ${PANEL_W} ${PANEL_H}">
  <!-- Background -->
  <rect width="${PANEL_W}" height="${PANEL_H}" fill="${C.base}"/>

  <!-- Toolbar -->
  <rect x="0" y="0" width="${PANEL_W}" height="${TOOLBAR_H}" fill="${C.surface0}"/>
  <line x1="0" y1="${TOOLBAR_H}" x2="${PANEL_W}" y2="${TOOLBAR_H}" stroke="${C.surface1}" stroke-width="1"/>
  ${toolbarButtons}
  ${autoBtn}

  <!-- Viewport -->
  <g transform="translate(0,${VIEWPORT_Y})">
    ${scene}
    ${fpsText}
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
      x: 50,
      y: 20,
      width: PANEL_W,
      height: PANEL_H,
      interactive: true,
      draggable: true,
      resizable: true,
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
// Animation loop
// ---------------------------------------------------------------------------

const FRAME_INTERVAL = 50; // ~20fps target

const timer = setInterval(() => {
  if (autoRotate && !dragging) {
    rotY += 0.02;
    rotX += 0.005;
  }
  render();
}, FRAME_INTERVAL);

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

type HitArea =
  | { area: "toolbar"; objectIndex: number }
  | { area: "auto" }
  | { area: "viewport" }
  | { area: "none" };

function hitTest(x: number, y: number): HitArea {
  if (y < TOOLBAR_H) {
    // Object buttons
    for (let i = 0; i < OBJECTS.length; i++) {
      const bx = BTN_START_X + i * (BTN_W + BTN_GAP);
      if (x >= bx && x < bx + BTN_W && y >= BTN_Y && y < BTN_Y + BTN_H) {
        return { area: "toolbar", objectIndex: i };
      }
    }
    // Auto-rotate button
    if (
      x >= AUTO_BTN_X &&
      x < AUTO_BTN_X + BTN_W &&
      y >= BTN_Y &&
      y < BTN_Y + BTN_H
    ) {
      return { area: "auto" };
    }
    return { area: "none" };
  }

  return { area: "viewport" };
}

// ---------------------------------------------------------------------------
// Event handling (fd 5)
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
          console.log(`Switched to: ${OBJECTS[currentObject].name}`);
          render();
        }
        return;
      }

      if (hit.area === "auto") {
        autoRotate = !autoRotate;
        console.log(`Auto-rotate: ${autoRotate ? "ON" : "OFF"}`);
        render();
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
        // Button released
        dragging = false;
        return;
      }

      const dx = ex - dragStartX;
      const dy = ey - dragStartY;
      rotY = dragRotY + dx * 0.01;
      rotX = dragRotX + dy * 0.01;
      // Clamp rotX to avoid flipping
      rotX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, rotX));
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
      zoom = Math.max(2, Math.min(20, zoom));
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
          // invalid JSON — skip
        }
      }
    }
  } catch {
    // fd closed
  }
}

// ---------------------------------------------------------------------------
// Keyboard input from stdin (for object switching)
// ---------------------------------------------------------------------------

async function readStdin(): Promise<void> {
  process.stdin.setRawMode(true);
  const reader = Bun.stdin.stream().getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const str = decoder.decode(value, { stream: true });
      for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);

        // Ctrl+C
        if (ch === 3) {
          cleanup();
          return;
        }

        const char = str[i];
        // Number keys 1-4 switch objects
        if (char >= "1" && char <= "4") {
          const idx = parseInt(char) - 1;
          if (idx < OBJECTS.length && idx !== currentObject) {
            currentObject = idx;
            console.log(`\rSwitched to: ${OBJECTS[currentObject].name}`);
          }
        }

        // 'a' toggles auto-rotate
        if (char === "a" || char === "A") {
          autoRotate = !autoRotate;
          console.log(`\rAuto-rotate: ${autoRotate ? "ON" : "OFF"}`);
        }

        // 'r' resets view
        if (char === "r" || char === "R") {
          rotX = 0.3;
          rotY = 0.4;
          zoom = 5;
          console.log("\rView reset");
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
  console.log("\n3D Wireframe Viewer closed.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

console.log("HyperTerm 3D Wireframe Viewer started.");
console.log("Controls:");
console.log("  Mouse drag  — rotate");
console.log("  Scroll      — zoom in/out");
console.log("  1-4 keys    — switch object (Cube, Sphere, Torus, Cylinder)");
console.log("  A           — toggle auto-rotate");
console.log("  R           — reset view");
console.log("  Ctrl+C      — exit");
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
