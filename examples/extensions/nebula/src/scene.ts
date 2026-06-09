// ============================================================================
// scene.ts — Nebula's three.js deep-space scene.
//
// A central glowing "core" (this machine) sits in a drifting starfield. Each
// discovered Endpoint becomes a small glowing node orbiting the core. Firing a
// request animates a bright packet along an arc to the target and back; the
// response spawns an expanding status-colored ring and pulses the node.
//
// Design notes
//  • All textures are generated procedurally from a <canvas> — no external assets.
//  • Glows use AdditiveBlending sprites so they bloom against the dark backdrop.
//  • The render loop is a single rAF; everything eases via lerp for smoothness.
//  • Endpoint nodes are diffed on setEndpoints() so orbits persist across rescans.
// ============================================================================

import * as THREE from "three";
import type { Endpoint, HttpResult } from "./protocol";

// Palette (kept in sync with styles.css).
const COL = {
  cyan: 0x5fe9ff,
  violet: 0xb06bff,
  magenta: 0xff6bd6,
  green: 0x4fe39b,
  amber: 0xffc24b,
  red: 0xff5b6e,
  deep: 0x04060f,
};

type StatusKind = "info" | "ok" | "redirect" | "client" | "server" | "error";

/** A single orbiting endpoint node + its derived bookkeeping. */
interface Node {
  url: string;
  endpoint: Endpoint;
  group: THREE.Group; // holds the sphere + glow + label, positioned on the orbit
  core: THREE.Mesh; // the solid sphere (raycast target)
  glow: THREE.Sprite;
  label: THREE.Sprite;
  radius: number; // orbit radius
  speed: number; // angular velocity (rad/s)
  phase: number; // current orbital angle
  tilt: number; // orbit plane tilt
  baseColor: THREE.Color;
  pulse: number; // 0..1 transient highlight on response
}

/** A transient packet flying along an arc between two points. */
interface Packet {
  curve: THREE.QuadraticBezierCurve3;
  mesh: THREE.Sprite;
  trail: THREE.Line;
  t: number; // 0..1 progress
  speed: number;
  color: THREE.Color;
  onArrive?: () => void;
  arrived: boolean;
  returning: boolean;
}

/** An expanding status ring spawned on a response. */
interface Ring {
  mesh: THREE.Mesh;
  age: number;
  life: number;
  maxScale: number;
}

export interface SceneCallbacks {
  /** Fired when the user clicks an endpoint node; passes its url. */
  onNodeClick?: (endpoint: Endpoint) => void;
}

export class NebulaScene {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private raf = 0;
  private container: HTMLElement | null = null;
  private callbacks: SceneCallbacks;

  private core!: THREE.Mesh;
  private coreGlow!: THREE.Sprite;
  private coreHalo!: THREE.Mesh;
  private starfields: THREE.Points[] = [];

  private nodes = new Map<string, Node>();
  private packets: Packet[] = [];
  private rings: Ring[] = [];

  // Shared procedural textures (built once).
  private texGlow!: THREE.Texture;
  private texStar!: THREE.Texture;

  // Pending request animations keyed by request id, so onResponse can resolve
  // the matching target node (pulse + ring) even for ad-hoc URLs.
  private pending = new Map<string, { url: string }>();

  // Camera auto-orbit state + gentle pointer parallax.
  private orbitAngle = 0;
  private pointer = new THREE.Vector2(0, 0);
  private pointerTarget = new THREE.Vector2(0, 0);

  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private hovered: Node | null = null;
  private disposed = false;

  constructor(callbacks: SceneCallbacks = {}) {
    this.callbacks = callbacks;
  }

  // -- lifecycle ------------------------------------------------------------

  mount(container: HTMLElement): void {
    this.container = container;
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height);
    this.renderer.domElement.className = "nebula-canvas";
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(COL.deep, 0.0085);

    this.camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 600);
    this.camera.position.set(0, 6, 46);
    this.camera.lookAt(0, 0, 0);

    // Procedural textures.
    this.texGlow = this.makeRadialTexture([
      "rgba(255,255,255,1)",
      "rgba(255,255,255,0)",
    ]);
    this.texStar = this.makeRadialTexture([
      "rgba(255,255,255,1)",
      "rgba(190,220,255,0.5)",
      "rgba(255,255,255,0)",
    ]);

    this.buildLights();
    this.buildBackdrop();
    this.buildStarfields(width, height);
    this.buildCore();

    // Interaction.
    const el = this.renderer.domElement;
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerleave", this.onPointerLeave);
    el.addEventListener("click", this.onClick);

    this.clock.start();
    this.loop();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    const el = this.renderer?.domElement;
    if (el) {
      el.removeEventListener("pointermove", this.onPointerMove);
      el.removeEventListener("pointerleave", this.onPointerLeave);
      el.removeEventListener("click", this.onClick);
    }
    // Free GPU resources.
    this.scene?.traverse((obj) => {
      const anyObj = obj as unknown as {
        geometry?: THREE.BufferGeometry;
        material?: THREE.Material | THREE.Material[];
      };
      anyObj.geometry?.dispose?.();
      const mat = anyObj.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose?.();
    });
    this.texGlow?.dispose();
    this.texStar?.dispose();
    this.nodes.forEach((n) =>
      (n.label.material.map as THREE.Texture)?.dispose(),
    );
    this.renderer?.dispose();
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  resize(width: number, height: number): void {
    if (!this.renderer || !this.camera) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height || 1;
    this.camera.updateProjectionMatrix();
  }

  // -- scene construction ---------------------------------------------------

  private buildLights(): void {
    this.scene.add(new THREE.AmbientLight(0x223055, 0.9));
    const key = new THREE.PointLight(COL.cyan, 2.2, 200, 1.6);
    key.position.set(18, 22, 26);
    this.scene.add(key);
    const fill = new THREE.PointLight(COL.violet, 1.6, 200, 1.6);
    fill.position.set(-24, -10, -10);
    this.scene.add(fill);
  }

  /** A big inward-facing sphere with a vertical indigo→black gradient: the
   *  "nebula" backdrop that the starfield floats in front of. */
  private buildBackdrop(): void {
    const c = document.createElement("canvas");
    c.width = 16;
    c.height = 256;
    const ctx = c.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "#0a1140");
    g.addColorStop(0.4, "#070a24");
    g.addColorStop(0.7, "#05060f");
    g.addColorStop(1, "#020308");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 16, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.SphereGeometry(280, 32, 32);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.scene.add(new THREE.Mesh(geo, mat));

    // Two faint colored nebula "clouds" — large additive sprites far back.
    const cloud = (hex: number, x: number, y: number, z: number, s: number) => {
      const m = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.makeRadialTexture([
            `rgba(${this.rgb(hex)},0.5)`,
            `rgba(${this.rgb(hex)},0)`,
          ]),
          color: hex,
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
          opacity: 0.35,
          fog: false,
        }),
      );
      m.position.set(x, y, z);
      m.scale.setScalar(s);
      this.scene.add(m);
    };
    cloud(COL.violet, -90, 30, -160, 220);
    cloud(COL.cyan, 110, -40, -180, 240);
    cloud(COL.magenta, 20, 70, -200, 160);
  }

  /** Two layered starfields (near + far) drifting at different rates for a
   *  parallax depth cue. A few hundred points total — cheap. */
  private buildStarfields(_w: number, _h: number): void {
    const layer = (
      count: number,
      spread: number,
      size: number,
      opacity: number,
    ) => {
      const pos = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);
      const palette = [
        new THREE.Color(0xffffff),
        new THREE.Color(0xbfe6ff),
        new THREE.Color(0xd9c4ff),
        new THREE.Color(COL.cyan),
      ];
      for (let i = 0; i < count; i++) {
        // Distribute in a spherical shell so the camera is "inside" the field.
        const r = spread * (0.55 + Math.random() * 0.45);
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        pos[i * 3 + 2] = r * Math.cos(phi);
        const col = palette[(Math.random() * palette.length) | 0];
        colors[i * 3] = col.r;
        colors[i * 3 + 1] = col.g;
        colors[i * 3 + 2] = col.b;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      const mat = new THREE.PointsMaterial({
        size,
        map: this.texStar,
        vertexColors: true,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
        fog: false,
      });
      const pts = new THREE.Points(geo, mat);
      this.scene.add(pts);
      this.starfields.push(pts);
    };
    layer(900, 240, 1.1, 0.9); // far
    layer(420, 120, 1.9, 0.95); // near, brighter
  }

  /** The central core: an emissive icosahedron + a wireframe shell + an
   *  additive glow sprite + a faint halo ring. */
  private buildCore(): void {
    const geo = new THREE.IcosahedronGeometry(4.4, 1);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x0a2740,
      emissive: COL.cyan,
      emissiveIntensity: 0.55,
      metalness: 0.4,
      roughness: 0.25,
      flatShading: true,
    });
    this.core = new THREE.Mesh(geo, mat);
    this.scene.add(this.core);

    // A slightly larger wireframe shell rotating the other way.
    const shell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(5.4, 1),
      new THREE.MeshBasicMaterial({
        color: COL.cyan,
        wireframe: true,
        transparent: true,
        opacity: 0.16,
        fog: false,
      }),
    );
    this.core.add(shell);
    (this.core.userData as { shell: THREE.Mesh }).shell = shell;

    // Soft additive glow behind the core.
    this.coreGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.texGlow,
        color: COL.cyan,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        opacity: 0.85,
        fog: false,
      }),
    );
    this.coreGlow.scale.setScalar(26);
    this.scene.add(this.coreGlow);

    // A faint equatorial halo ring for a touch of structure.
    this.coreHalo = new THREE.Mesh(
      new THREE.RingGeometry(7.2, 7.5, 96),
      new THREE.MeshBasicMaterial({
        color: COL.violet,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    this.coreHalo.rotation.x = Math.PI / 2.4;
    this.scene.add(this.coreHalo);
  }

  // -- public data API ------------------------------------------------------

  /** Diff the endpoint set against existing nodes: keep matching orbits,
   *  spawn new nodes, gracefully remove gone ones. */
  setEndpoints(items: Endpoint[]): void {
    if (this.disposed) return;
    const next = new Set(items.map((e) => e.url));

    // Remove nodes that disappeared.
    for (const [url, node] of this.nodes) {
      if (!next.has(url)) {
        this.scene.remove(node.group);
        // The label sprite owns a unique CanvasTexture — dispose it. The glow
        // sprite shares texGlow (freed once in dispose()), so DON'T touch its map.
        (node.label.material.map as THREE.Texture | null)?.dispose();
        node.group.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.Material | undefined;
          m?.dispose?.();
          (o as THREE.Mesh).geometry?.dispose?.();
        });
        this.nodes.delete(url);
      }
    }

    // Add / update. `index` seeds each new node's orbit radius/phase/speed.
    let index = 0;
    for (const ep of items) {
      const existing = this.nodes.get(ep.url);
      if (existing) {
        existing.endpoint = ep; // refresh metadata (label/command may change)
        index++;
        continue;
      }
      this.nodes.set(ep.url, this.makeNode(ep, index));
      index++;
    }
  }

  /** Begin the outbound packet animation toward the endpoint matching `url`
   *  (or out into space for an ad-hoc URL). Returns immediately. */
  fireRequest(id: string, url: string): void {
    if (this.disposed) return;
    this.pending.set(id, { url });
    const target = this.nodes.get(url);
    const from = this.core.position.clone();
    const to = target ? target.group.position.clone() : this.adHocTarget();
    this.spawnPacket(from, to, new THREE.Color(COL.cyan), false);
  }

  /** Resolve a completed request: pulse the node + spawn a status ring, and
   *  send a return packet home. */
  onResponse(res: HttpResult): void {
    if (this.disposed) return;
    const pend = this.pending.get(res.id);
    this.pending.delete(res.id);
    const kind = this.statusKind(res);
    const color = new THREE.Color(this.statusColor(kind));

    const node = pend ? (this.nodes.get(pend.url) ?? null) : null;
    const at = node ? node.group.position.clone() : this.adHocTarget();

    // Latency → ring size/speed. Slow responses bloom bigger + slower.
    const latency = Math.max(0, Math.min(res.timeMs, 4000));
    const maxScale = 6 + (latency / 4000) * 10;
    const life = 0.9 + (latency / 4000) * 1.1;
    this.spawnRing(at, color, maxScale, life);

    if (node) {
      node.pulse = 1;
      (node.glow.material as THREE.SpriteMaterial).color.copy(color);
      (node.core.material as THREE.MeshStandardMaterial).emissive.copy(color);
    }

    // Return packet, colored by status, flying back to the core.
    this.spawnPacket(at.clone(), this.core.position.clone(), color, true);
  }

  // -- node / packet / ring factories --------------------------------------

  private makeNode(ep: Endpoint, index: number): Node {
    const group = new THREE.Group();

    // Distribute orbits across a few radii + golden-angle phases so nodes
    // don't bunch up; vary speed + tilt for life.
    const tier = index % 3;
    const radius = 14 + tier * 6 + (index % 5) * 0.7;
    const phase = index * 2.39996; // golden angle (rad)
    const speed = (0.12 + (index % 4) * 0.03) * (index % 2 === 0 ? 1 : -1);
    const tilt = ((index % 5) - 2) * 0.22;

    // Color: alternate cyan / violet / magenta for variety.
    const palette = [COL.cyan, COL.violet, COL.magenta];
    const baseColor = new THREE.Color(palette[index % palette.length]);

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.95, 20, 20),
      new THREE.MeshStandardMaterial({
        color: 0x0a1830,
        emissive: baseColor,
        emissiveIntensity: 0.9,
        metalness: 0.3,
        roughness: 0.3,
      }),
    );
    (core.userData as { nodeUrl: string }).nodeUrl = ep.url;
    group.add(core);

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.texGlow,
        color: baseColor,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        opacity: 0.85,
        fog: false,
      }),
    );
    glow.scale.setScalar(5);
    group.add(glow);

    const label = this.makeLabel(this.labelText(ep), baseColor);
    label.position.set(0, 2.2, 0);
    group.add(label);

    return {
      url: ep.url,
      endpoint: ep,
      group,
      core,
      glow,
      label,
      radius,
      speed,
      phase,
      tilt,
      baseColor,
      pulse: 0,
    };
  }

  private labelText(ep: Endpoint): string {
    const cmd = (ep.command || ep.label || "").trim();
    const short = cmd.length > 22 ? cmd.slice(0, 21) + "…" : cmd;
    return short ? `${short}  :${ep.port}` : `:${ep.port}`;
  }

  private spawnPacket(
    from: THREE.Vector3,
    to: THREE.Vector3,
    color: THREE.Color,
    returning: boolean,
  ): void {
    // Lift the control point above the chord for a graceful arc.
    const mid = from.clone().add(to).multiplyScalar(0.5);
    const lift = from.distanceTo(to) * 0.32 + 4;
    mid.add(new THREE.Vector3(0, lift, 0));
    const curve = new THREE.QuadraticBezierCurve3(
      from.clone(),
      mid,
      to.clone(),
    );

    const mesh = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.texGlow,
        color,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        opacity: 1,
        fog: false,
      }),
    );
    mesh.scale.setScalar(2.4);
    mesh.position.copy(from);
    this.scene.add(mesh);

    // A faint trail line tracing the arc.
    const pts = curve.getPoints(40);
    const trailGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const trail = new THREE.Line(
      trailGeo,
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    this.scene.add(trail);

    this.packets.push({
      curve,
      mesh,
      trail,
      t: 0,
      speed: 0.9 + Math.random() * 0.25,
      color,
      arrived: false,
      returning,
    });
  }

  private spawnRing(
    at: THREE.Vector3,
    color: THREE.Color,
    maxScale: number,
    life: number,
  ): void {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1, 64),
      new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    mesh.position.copy(at);
    // Face the camera roughly so the ring reads as a circle.
    mesh.lookAt(this.camera.position);
    this.scene.add(mesh);
    this.rings.push({ mesh, age: 0, life, maxScale });
  }

  /** A point off in space for ad-hoc (non-discovered) URLs. */
  private adHocTarget(): THREE.Vector3 {
    const a = Math.random() * Math.PI * 2;
    return new THREE.Vector3(
      Math.cos(a) * 26,
      (Math.random() - 0.5) * 14,
      Math.sin(a) * 26 - 6,
    );
  }

  // -- status mapping -------------------------------------------------------

  private statusKind(res: HttpResult): StatusKind {
    if (res.error || res.status === 0) return "error";
    const s = res.status;
    if (s >= 100 && s < 200) return "info";
    if (s >= 200 && s < 300) return "ok";
    if (s >= 300 && s < 400) return "redirect";
    if (s >= 400 && s < 500) return "client";
    return "server";
  }

  private statusColor(kind: StatusKind): number {
    switch (kind) {
      case "ok":
        return COL.green;
      case "redirect":
      case "client":
        return COL.amber;
      case "server":
      case "error":
        return COL.red;
      case "info":
      default:
        return COL.cyan;
    }
  }

  // -- the render loop ------------------------------------------------------

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05); // clamp tab-switch spikes
    const t = this.clock.elapsedTime;

    this.updateCore(dt, t);
    this.updateNodes(dt, t);
    this.updatePackets(dt);
    this.updateRings(dt);
    this.updateStars(dt, t);
    this.updateCamera(dt, t);
    this.updateHover();

    this.renderer.render(this.scene, this.camera);
  };

  private updateCore(dt: number, t: number): void {
    this.core.rotation.y += dt * 0.25;
    this.core.rotation.x += dt * 0.07;
    const shell = (this.core.userData as { shell?: THREE.Mesh }).shell;
    if (shell) {
      shell.rotation.y -= dt * 0.4;
      shell.rotation.z += dt * 0.12;
    }
    // Breathing pulse on the glow + emissive.
    const breathe = 0.5 + 0.5 * Math.sin(t * 1.1);
    this.coreGlow.scale.setScalar(24 + breathe * 4);
    (this.coreGlow.material as THREE.SpriteMaterial).opacity =
      0.7 + breathe * 0.25;
    (this.core.material as THREE.MeshStandardMaterial).emissiveIntensity =
      0.45 + breathe * 0.35;
    this.coreHalo.rotation.z += dt * 0.08;
  }

  private updateNodes(dt: number, t: number): void {
    for (const n of this.nodes.values()) {
      n.phase += n.speed * dt;
      const x = Math.cos(n.phase) * n.radius;
      const z = Math.sin(n.phase) * n.radius;
      const y =
        Math.sin(n.phase * 1.3 + n.tilt * 4) * (n.radius * 0.18) + n.tilt * 6;
      n.group.position.set(x, y, z);

      // Idle twinkle + decaying response pulse.
      const twinkle = 0.8 + 0.2 * Math.sin(t * 2 + n.phase * 3);
      if (n.pulse > 0) {
        n.pulse = Math.max(0, n.pulse - dt * 1.4);
        // Ease the emissive/glow color back toward the node's base color.
        const k = n.pulse;
        (n.core.material as THREE.MeshStandardMaterial).emissive.lerp(
          n.baseColor,
          1 - k,
        );
        (n.glow.material as THREE.SpriteMaterial).color.lerp(
          n.baseColor,
          1 - k,
        );
      }
      const scale = (1 + n.pulse * 0.9) * twinkle;
      n.core.scale.setScalar(scale);
      n.glow.scale.setScalar(5 * (1 + n.pulse * 0.7));
      (n.glow.material as THREE.SpriteMaterial).opacity = 0.7 + n.pulse * 0.3;
      // Hover highlight.
      if (this.hovered === n) {
        n.glow.scale.multiplyScalar(1.25);
      }
    }
  }

  private updatePackets(dt: number): void {
    for (let i = this.packets.length - 1; i >= 0; i--) {
      const p = this.packets[i];
      p.t += dt * p.speed;
      const trailMat = p.trail.material as THREE.LineBasicMaterial;
      if (p.t >= 1) {
        // Fade out trail then remove.
        trailMat.opacity = Math.max(0, trailMat.opacity - dt * 2);
        (p.mesh.material as THREE.SpriteMaterial).opacity = Math.max(
          0,
          (p.mesh.material as THREE.SpriteMaterial).opacity - dt * 3,
        );
        if (trailMat.opacity <= 0.02) {
          this.scene.remove(p.mesh, p.trail);
          // Dispose only per-packet resources. The glow texture (texGlow) is
          // shared across all sprites and is freed once in dispose().
          (p.mesh.material as THREE.Material).dispose();
          p.trail.geometry.dispose();
          (p.trail.material as THREE.Material).dispose();
          this.packets.splice(i, 1);
        }
        continue;
      }
      const pos = p.curve.getPoint(p.t);
      p.mesh.position.copy(pos);
      // Trail brightens as the packet flies, dims toward the end.
      trailMat.opacity = Math.min(0.5, p.t < 0.5 ? p.t : 1 - p.t) * 0.9 + 0.05;
      // Slight pulse on the head.
      p.mesh.scale.setScalar(2.2 + Math.sin(p.t * Math.PI) * 1.0);
    }
  }

  private updateRings(dt: number): void {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.age += dt;
      const k = r.age / r.life;
      if (k >= 1) {
        this.scene.remove(r.mesh);
        r.mesh.geometry.dispose();
        (r.mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
        continue;
      }
      // Ease-out expansion, fade opacity.
      const eased = 1 - Math.pow(1 - k, 2.2);
      r.mesh.scale.setScalar(1 + eased * r.maxScale);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.9;
      r.mesh.lookAt(this.camera.position);
    }
  }

  private updateStars(dt: number, t: number): void {
    // Slow differential drift; subtle shimmer via opacity.
    if (this.starfields[0]) this.starfields[0].rotation.y += dt * 0.006;
    if (this.starfields[1]) {
      this.starfields[1].rotation.y -= dt * 0.012;
      const mat = this.starfields[1].material as THREE.PointsMaterial;
      mat.opacity = 0.85 + 0.1 * Math.sin(t * 0.6);
    }
  }

  private updateCamera(dt: number, _t: number): void {
    // Gentle auto-orbit + pointer parallax, eased.
    this.orbitAngle += dt * 0.045;
    this.pointer.lerp(this.pointerTarget, Math.min(1, dt * 3));
    const radius = 46;
    const px = this.pointer.x * 6;
    const py = this.pointer.y * 4;
    this.camera.position.x = Math.sin(this.orbitAngle) * radius + px;
    this.camera.position.z = Math.cos(this.orbitAngle) * radius;
    this.camera.position.y = 6 + py + Math.sin(this.orbitAngle * 0.7) * 2;
    this.camera.lookAt(0, 0, 0);
  }

  private updateHover(): void {
    if (!this.container) return;
    this.raycaster.setFromCamera(this.ndc, this.camera);
    let best: Node | null = null;
    let bestDist = Infinity;
    for (const n of this.nodes.values()) {
      const hit = this.raycaster.intersectObject(n.core, false);
      if (hit.length && hit[0].distance < bestDist) {
        bestDist = hit[0].distance;
        best = n;
      }
    }
    this.hovered = best;
    this.renderer.domElement.style.cursor = best ? "pointer" : "default";
  }

  // -- pointer handlers -----------------------------------------------------

  private onPointerMove = (e: PointerEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    this.ndc.set(x * 2 - 1, -(y * 2 - 1));
    // Parallax target in [-1,1].
    this.pointerTarget.set(x * 2 - 1, -(y * 2 - 1));
  };

  private onPointerLeave = (): void => {
    this.pointerTarget.set(0, 0);
    this.ndc.set(2, 2); // off-screen → no hover
    this.hovered = null;
  };

  private onClick = (): void => {
    if (this.hovered && this.callbacks.onNodeClick) {
      // Click feedback: a quick self-pulse.
      this.hovered.pulse = 1;
      this.callbacks.onNodeClick(this.hovered.endpoint);
    }
  };

  // -- procedural texture / label helpers -----------------------------------

  /** Radial-gradient sprite texture from a list of CSS color stops. */
  private makeRadialTexture(stops: string[]): THREE.Texture {
    const size = 128;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2,
    );
    const n = stops.length;
    stops.forEach((s, i) => g.addColorStop(n === 1 ? 1 : i / (n - 1), s));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  /** A crisp DPR-aware text label rendered to a canvas sprite. */
  private makeLabel(text: string, color: THREE.Color): THREE.Sprite {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pad = 14;
    const fontPx = 30;
    const font = `600 ${fontPx}px ui-monospace, "SF Mono", Menlo, monospace`;
    const measure = document.createElement("canvas").getContext("2d")!;
    measure.font = font;
    const tw = Math.ceil(measure.measureText(text).width);
    const w = tw + pad * 2;
    const h = fontPx + pad * 1.4;

    const c = document.createElement("canvas");
    c.width = Math.ceil(w * dpr);
    c.height = Math.ceil(h * dpr);
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);

    // Glassy pill background.
    const r = h / 2;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(w, 0, w, h, r);
    ctx.arcTo(w, h, 0, h, r);
    ctx.arcTo(0, h, 0, 0, r);
    ctx.arcTo(0, 0, w, 0, r);
    ctx.closePath();
    ctx.fillStyle = "rgba(8, 13, 32, 0.72)";
    ctx.fill();
    ctx.lineWidth = 1.2;
    const cssCol = `#${color.getHexString()}`;
    ctx.strokeStyle = this.withAlpha(cssCol, 0.55);
    ctx.stroke();

    // Text.
    ctx.font = font;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.shadowColor = cssCol;
    ctx.shadowBlur = 8;
    ctx.fillStyle = "#eaf2ff";
    ctx.fillText(text, w / 2, h / 2 + 1);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;

    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        fog: false,
      }),
    );
    // World-units scale derived from aspect; keeps text legible.
    const scale = 0.06;
    sprite.scale.set(w * scale, h * scale, 1);
    return sprite;
  }

  private rgb(hex: number): string {
    const c = new THREE.Color(hex);
    return `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(
      c.b * 255,
    )}`;
  }

  private withAlpha(hex: string, a: number): string {
    const c = new THREE.Color(hex);
    return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(
      c.b * 255,
    )},${a})`;
  }
}

export function createScene(callbacks?: SceneCallbacks): NebulaScene {
  return new NebulaScene(callbacks);
}
