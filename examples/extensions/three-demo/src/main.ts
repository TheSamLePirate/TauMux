// Frontend entry — runs inside the extension's Vite app (the τ-mux iframe).
// Renders a spinning three.js scene and drives a few τ-mux control surfaces
// (sidebar status, a notification) via the @tau-mux/sdk frontend bridge.

import * as THREE from "three";
import { createFrontendSdk } from "@tau-mux/sdk/frontend";

// The host bridge. All sdk calls are postMessage round-trips to τ-mux, so we
// always guard them: a failed control-surface call must never break rendering.
const sdk = createFrontendSdk();

const mount = document.getElementById("app");
if (!mount) {
  throw new Error("#app mount element not found");
}

// ---------------------------------------------------------------------------
// Scene setup
// ---------------------------------------------------------------------------

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d12);

// Perspective camera — aspect is corrected on every resize below.
const camera = new THREE.PerspectiveCamera(
  60,
  mount.clientWidth / Math.max(1, mount.clientHeight),
  0.1,
  100,
);
camera.position.set(0, 0, 4);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
mount.appendChild(renderer.domElement);

// A faceted icosahedron with a glossy standard material — reads nicely as a 3D
// "object" while staying cheap to render.
const geometry = new THREE.IcosahedronGeometry(1, 0);
const material = new THREE.MeshStandardMaterial({
  color: 0x4f9dff,
  metalness: 0.35,
  roughness: 0.25,
  flatShading: true,
});
const mesh = new THREE.Mesh(geometry, material);
scene.add(mesh);

// A thin wireframe overlay to accent the facet edges.
const wire = new THREE.LineSegments(
  new THREE.WireframeGeometry(geometry),
  new THREE.LineBasicMaterial({
    color: 0x9ec5ff,
    transparent: true,
    opacity: 0.35,
  }),
);
mesh.add(wire);

// Lighting: soft ambient fill + a warm point light for highlights.
scene.add(new THREE.AmbientLight(0xffffff, 0.45));
const pointLight = new THREE.PointLight(0xfff0d8, 35, 50);
pointLight.position.set(3, 4, 5);
scene.add(pointLight);

// ---------------------------------------------------------------------------
// Resize handling — keep the renderer + camera in sync with the pane.
// ---------------------------------------------------------------------------

function resize(width: number, height: number): void {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// Initial sizing from the actual mount box.
resize(mount.clientWidth, mount.clientHeight);

// τ-mux tells us when the *pane* resizes (the iframe may not get a window
// 'resize' for host-driven layout changes), so we listen to both.
sdk.onResize(({ width, height }) => resize(width, height));
window.addEventListener("resize", () =>
  resize(mount.clientWidth, mount.clientHeight),
);

// ---------------------------------------------------------------------------
// Animation loop
// ---------------------------------------------------------------------------

// Base spin speed (radians/sec). A backend "pulse" temporarily boosts it.
const BASE_SPEED = 0.6;
let speedBoost = 0;
let lastTime = performance.now();

function animate(now: number): void {
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;

  // Decay any transient speed boost back toward zero.
  speedBoost *= Math.pow(0.5, dt / 0.4);
  const speed = BASE_SPEED + speedBoost;

  mesh.rotation.x += speed * dt;
  mesh.rotation.y += speed * 1.3 * dt;

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

// ---------------------------------------------------------------------------
// τ-mux control surfaces — fire-and-forget, never throw on mount.
// ---------------------------------------------------------------------------

async function announce(): Promise<void> {
  try {
    await sdk.sidebar.setStatus({ key: "three-demo", value: "🧊 3D running" });
  } catch {
    /* sidebar status is best-effort */
  }
  try {
    await sdk.notification.create({
      title: "Three.js extension",
      body: "Scene loaded",
    });
  } catch {
    /* notifications are best-effort */
  }
}
void announce();

// When the backend pushes a message (e.g. its 5s heartbeat), pulse the spin so
// the demo visibly reacts to its own Bun process.
sdk.onBackendMessage((data) => {
  speedBoost = 6;
  try {
    void sdk.sidebar.log({
      message: `three-demo: backend → ${JSON.stringify(data)}`,
    });
  } catch {
    /* logging is best-effort */
  }
});

// React to backend lifecycle transitions for a little extra status feedback.
sdk.onLifecycle((state) => {
  try {
    void sdk.sidebar.setStatus({
      key: "three-demo",
      value: state === "exited" ? "⏹ backend exited" : "🧊 3D running",
    });
  } catch {
    /* best-effort */
  }
});
