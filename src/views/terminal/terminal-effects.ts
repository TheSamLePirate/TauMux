import type { Terminal } from "xterm";

type GLContext = WebGLRenderingContext | WebGL2RenderingContext;
type Disposable = { dispose(): void };

const MAX_LIGHTS = 48;
const SHADOW_STEPS = 32;

const VERTEX_SHADER_SOURCE = `
attribute vec2 a_position;
varying vec2 v_uv;

void main() {
  v_uv = vec2(a_position.x, -a_position.y) * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

// Per-light illumination with shadow tracing through occluder texture.
// Much cheaper than omnidirectional ray marching: only traces toward
// actual light sources, and produces smooth uniform illumination.
const FRAGMENT_SHADER_SOURCE = `
precision mediump float;

#define MAX_LIGHTS ${MAX_LIGHTS}
#define SHADOW_STEPS ${SHADOW_STEPS}

varying vec2 v_uv;

uniform vec2 u_resolution;
uniform int u_lightCount;
uniform vec3 u_lightPosRadius[MAX_LIGHTS];   // xy = center (px), z = radius (px)
uniform vec4 u_lightColorIntensity[MAX_LIGHTS]; // rgb = color, a = intensity
uniform sampler2D u_occluderTex;
uniform float u_boost;

float hash12(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

float occluderAt(vec2 posPx) {
  return texture2D(u_occluderTex, posPx / u_resolution).a;
}

// 5-tap cross — good quality, cheap
float occluderSmooth(vec2 p, float spread) {
  float c = occluderAt(p) * 0.4;
  c += occluderAt(p + vec2(spread, 0.0)) * 0.15;
  c += occluderAt(p - vec2(spread, 0.0)) * 0.15;
  c += occluderAt(p + vec2(0.0, spread)) * 0.15;
  c += occluderAt(p - vec2(0.0, spread)) * 0.15;
  return c;
}

float traceVisibility(vec2 lightPos, vec2 fragPos, float dist, float jitter) {
  if (dist < 1.0) return 1.0;

  vec2 dir = (fragPos - lightPos) / dist;
  float stepSize = max(2.0, dist / float(SHADOW_STEPS));
  float travel = stepSize * (0.4 + jitter * 0.6);
  float visibility = 1.0;

  for (int i = 0; i < SHADOW_STEPS; i++) {
    if (travel >= dist - stepSize) break;
    vec2 p = lightPos + dir * travel;

    float spread = 1.0 + travel * 0.012;
    float occ = occluderSmooth(p, spread);

    float t = travel / dist;
    float harshness = mix(0.95, 0.45, t * t);
    visibility *= 1.0 - occ * harshness;

    if (visibility < 0.005) return 0.0;
    travel += stepSize;
  }

  return visibility;
}

void main() {
  vec2 fragPos = v_uv * u_resolution;
  vec3 color = vec3(0.0);
  float jitter = hash12(gl_FragCoord.xy);

  for (int i = 0; i < MAX_LIGHTS; i++) {
    if (i >= u_lightCount) break;

    vec3 posRadius = u_lightPosRadius[i];
    vec2 lightPos = posRadius.xy;
    float radius = posRadius.z;

    float dist = length(lightPos - fragPos);
    if (dist >= radius) continue;

    float visibility = traceVisibility(lightPos, fragPos, dist, jitter);
    if (visibility <= 0.0) continue;

    float normalized = 1.0 - dist / radius;
    float falloff = normalized * normalized * normalized;
    float edgeSoft = smoothstep(0.0, 0.1, normalized);
    float intensity = u_lightColorIntensity[i].a;
    vec3 lightColor = u_lightColorIntensity[i].rgb;

    color += lightColor * falloff * edgeSoft * intensity * visibility;
  }

  color *= 0.6 + u_boost * 0.12;
  float a = clamp(max(max(color.r, color.g), color.b), 0.0, 1.0);
  gl_FragColor = vec4(color, a);
}
`;

interface LightRect {
  cx: number; // center x in canvas px
  cy: number; // center y in canvas px
  radius: number; // light reach in canvas px
  r: number;
  g: number;
  b: number;
  intensity: number;
}

export class TerminalEffects {
  private readonly canvas: HTMLCanvasElement;
  private readonly occluderCanvas: HTMLCanvasElement;
  private readonly occluderCtx: CanvasRenderingContext2D;
  private readonly resizeObserver: ResizeObserver;
  private readonly subscriptions: Disposable[] = [];

  private gl: GLContext | null = null;
  private program: WebGLProgram | null = null;
  private positionBuffer: WebGLBuffer | null = null;
  private occluderTexture: WebGLTexture | null = null;

  private positionLocation = -1;
  private resolutionLocation: WebGLUniformLocation | null = null;
  private lightCountLocation: WebGLUniformLocation | null = null;
  private lightPosRadiusLocation: WebGLUniformLocation | null = null;
  private lightColorIntensityLocation: WebGLUniformLocation | null = null;
  private occluderTexLocation: WebGLUniformLocation | null = null;
  private boostLocation: WebGLUniformLocation | null = null;

  private lights: LightRect[] = [];

  private rafId: number | null = null;
  private destroyed = false;
  private available = true;
  private active = true;
  private dirty = true;
  private focused = false;
  private outputBoost = 0;
  private inputBoost = 0;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private canvasW = 1;
  private canvasH = 1;
  private mouseX = -1; // CSS px relative to host, -1 = offscreen
  private mouseY = -1;

  constructor(
    private host: HTMLElement,
    private term: Terminal,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "terminal-effects-layer";
    this.canvas.setAttribute("aria-hidden", "true");

    this.occluderCanvas = document.createElement("canvas");
    const occluderCtx = this.occluderCanvas.getContext("2d", { alpha: true });

    if (!occluderCtx) {
      this.available = false;
      this.active = false;
      this.canvas.style.display = "none";
      host.appendChild(this.canvas);
      this.occluderCtx = document.createElement("canvas").getContext("2d")!;
      this.resizeObserver = new ResizeObserver(() => {});
      return;
    }
    this.occluderCtx = occluderCtx;

    host.appendChild(this.canvas);

    this.gl =
      (this.canvas.getContext("webgl2", {
        alpha: true,
        antialias: false,
        premultipliedAlpha: false,
      }) as GLContext | null) ??
      (this.canvas.getContext("webgl", {
        alpha: true,
        antialias: false,
        premultipliedAlpha: false,
      }) as GLContext | null);

    if (!this.gl) {
      this.available = false;
      this.active = false;
      this.canvas.style.display = "none";
      this.resizeObserver = new ResizeObserver(() => {});
      return;
    }

    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
      this.markDirty();
    });
    this.resizeObserver.observe(host);

    try {
      this.initGl();
    } catch (error) {
      console.warn("[terminal-effects] WebGL disabled:", error);
      this.available = false;
      this.active = false;
      this.canvas.style.display = "none";
      return;
    }

    this.subscriptions.push(
      term.onRender(() => this.markDirty()),
      term.onScroll(() => this.markDirty()),
      term.onCursorMove(() => {
        this.outputBoost = Math.max(this.outputBoost, 0.08);
        this.schedule();
      }),
      term.onWriteParsed(() => this.markDirty()),
    );

    const onMouseMove = (e: MouseEvent): void => {
      const rect = this.host.getBoundingClientRect();
      this.mouseX = e.clientX - rect.left;
      this.mouseY = e.clientY - rect.top;
      this.markDirty();
    };
    const onMouseLeave = (): void => {
      this.mouseX = -1;
      this.mouseY = -1;
      this.markDirty();
    };
    host.addEventListener("mousemove", onMouseMove);
    host.addEventListener("mouseleave", onMouseLeave);

    this.resize();
    this.markDirty();
  }

  setFocused(focused: boolean): void {
    if (!this.available) return;
    this.focused = focused;
    if (focused) this.outputBoost = Math.max(this.outputBoost, 0.18);
    this.schedule();
  }

  pulseOutput(size = 0): void {
    if (!this.available || !this.active) return;
    this.outputBoost = Math.min(
      2.8,
      this.outputBoost + Math.min(1.6, 0.16 + size / 180),
    );
    this.markDirty();
  }

  pulseInput(size = 0): void {
    if (!this.available || !this.active) return;
    this.inputBoost = Math.min(
      1.8,
      this.inputBoost + Math.min(1.1, 0.1 + size / 240),
    );
    this.schedule();
  }

  setEnabled(enabled: boolean): void {
    if (!this.available) return;
    this.active = enabled;
    this.canvas.style.display = enabled ? "block" : "none";
    if (enabled) {
      this.markDirty();
    } else if (this.gl) {
      this.gl.clearColor(0, 0, 0, 0);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    }
  }

  isEnabled(): boolean {
    return this.available && this.active;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    for (const sub of this.subscriptions) sub.dispose();
    this.resizeObserver.disconnect();
    if (this.available && this.gl) {
      if (this.positionBuffer) this.gl.deleteBuffer(this.positionBuffer);
      if (this.occluderTexture) this.gl.deleteTexture(this.occluderTexture);
      if (this.program) this.gl.deleteProgram(this.program);
    }
    this.canvas.remove();
  }

  private markDirty(): void {
    if (!this.available || !this.active) return;
    this.dirty = true;
    this.schedule();
  }

  private schedule(): void {
    if (
      !this.available ||
      !this.active ||
      this.destroyed ||
      !this.gl ||
      this.rafId !== null
    )
      return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.render();
    });
  }

  private render(): void {
    if (!this.available || !this.active || this.destroyed || !this.gl) return;

    if (this.dirty) {
      this.rasterise();
      this.dirty = false;
    }

    this.outputBoost *= this.focused ? 0.93 : 0.87;
    this.inputBoost *= 0.84;

    this.draw();

    if (
      this.focused ||
      this.dirty ||
      this.outputBoost > 0.012 ||
      this.inputBoost > 0.02
    ) {
      this.schedule();
    }
  }

  private resize(): void {
    if (!this.available) return;
    const rect = this.host.getBoundingClientRect();
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

    this.canvasW = Math.round(this.width * this.dpr);
    this.canvasH = Math.round(this.height * this.dpr);
    this.canvas.width = this.canvasW;
    this.canvas.height = this.canvasH;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;

    this.occluderCanvas.width = this.canvasW;
    this.occluderCanvas.height = this.canvasH;

    this.gl?.viewport(0, 0, this.canvasW, this.canvasH);
  }

  // ── Rasterise: collect light rects + draw occluder blocks ───────────
  // Lights → grouped into rectangles (uniform array for GPU).
  // Occluders → per-cell blocks slightly narrower than cell width,
  //   giving character-level shadow definition without fillText cost.

  private rasterise(): void {
    const oc = this.occluderCtx;
    const w = this.canvasW;
    const h = this.canvasH;
    oc.clearRect(0, 0, w, h);
    this.lights = [];

    const buffer = this.term.buffer.active;
    const cols = this.term.cols;
    const rows = this.term.rows;
    if (cols <= 0 || rows <= 0) return;

    const hostRect = this.host.getBoundingClientRect();
    const screen = this.host.querySelector(".xterm-screen") as HTMLElement;
    const screenRect = screen ? screen.getBoundingClientRect() : hostRect;

    const offsetX = (screenRect.left - hostRect.left) * this.dpr;
    const offsetY = (screenRect.top - hostRect.top) * this.dpr;
    const cellW = (screenRect.width * this.dpr) / cols;
    const cellH = (screenRect.height * this.dpr) / rows;
    const padY = cellH * 0.12;

    const scrollTop = buffer.viewportY;

    const EMPTY = 0;
    const LIGHT = 1;
    const OCCLUDER = 2;

    for (let y = 0; y < rows; y++) {
      const line = buffer.getLine(scrollTop + y);
      if (!line) continue;

      let runStart = -1;
      let runLen = 0;
      let runType = EMPTY;
      let runColor = "";
      let runR = 0;
      let runG = 0;
      let runB = 0;

      let lastOccColor = "";

      const flushLightRun = (endX: number): void => {
        if (runStart < 0) return;
        const rx = offsetX + runStart * cellW;
        const ry = offsetY + y * cellH + padY;
        const rw = (endX - runStart) * cellW;
        const rh = cellH - padY * 2;
        if (this.lights.length < MAX_LIGHTS) {
          this.lights.push({
            cx: rx + rw * 0.5,
            cy: ry + rh * 0.5,
            radius: Math.max(cellH * 12, Math.sqrt(rw * rw + rh * rh) * 7),
            r: runR / 255,
            g: runG / 255,
            b: runB / 255,
            intensity: 1 / Math.sqrt(runLen),
          });
        }
      };

      const drawOccluder = (x: number, char: string, color: string): void => {
        if (color !== lastOccColor) {
          oc.fillStyle = color;
          lastOccColor = color;
        }
        const cx = offsetX + x * cellW + cellW * 0.5;
        const cy = offsetY + y * cellH + cellH * 0.5;
        const shape = charShape(char);
        switch (shape) {
          case Shape.CIRCLE: {
            const r = Math.min(cellW, cellH) * 0.38;
            oc.beginPath();
            oc.arc(cx, cy, r, 0, 6.2832);
            oc.fill();
            break;
          }
          case Shape.THIN: {
            const tw = cellW * 0.2;
            oc.fillRect(cx - tw * 0.5, cy - cellH * 0.4, tw, cellH * 0.8);
            break;
          }
          case Shape.NARROW: {
            const nw = cellW * 0.45;
            oc.fillRect(cx - nw * 0.5, cy - cellH * 0.38, nw, cellH * 0.76);
            break;
          }
          case Shape.WIDE: {
            oc.fillRect(
              offsetX + x * cellW,
              cy - cellH * 0.4,
              cellW,
              cellH * 0.8,
            );
            break;
          }
          default: {
            // MEDIUM — default block
            const mw = cellW * 0.7;
            oc.fillRect(cx - mw * 0.5, cy - cellH * 0.38, mw, cellH * 0.76);
          }
        }
      };

      for (let x = 0; x < cols; x++) {
        const cell = line.getCell(x);
        if (!cell) continue;
        const char = cell.getChars();

        let cellType = EMPTY;
        let cellColor = "";
        let cr = 0;
        let cg = 0;
        let cb = 0;

        if (char && char !== " ") {
          if (cell.isFgDefault()) {
            cellType = OCCLUDER;
            cellColor = this.term.options.theme?.foreground ?? "#cdd6f4";
          } else {
            const fg = cell.getFgColor();
            const isRgb = cell.isFgRGB();
            const colored = isRgb ? isRGBColored(fg) : isPaletteColored(fg);

            if (colored) {
              cellType = LIGHT;
              if (isRgb) {
                cr = (fg >> 16) & 0xff;
                cg = (fg >> 8) & 0xff;
                cb = fg & 0xff;
              } else {
                const rgb = XTERM_PALETTE_RGB[fg];
                if (rgb) {
                  cr = rgb[0];
                  cg = rgb[1];
                  cb = rgb[2];
                }
              }
              cellColor = `rgb(${cr},${cg},${cb})`;
            } else {
              cellType = OCCLUDER;
              cellColor = xtermColorToCSS(fg, isRgb);
            }
          }
        }

        // Draw occluder shape immediately per character
        if (cellType === OCCLUDER) {
          drawOccluder(x, char!, cellColor);
        }

        // Light run tracking
        if (cellType === LIGHT && runType === LIGHT && cellColor === runColor) {
          runLen++;
          continue;
        }
        if (runType === LIGHT) flushLightRun(x);
        if (cellType === LIGHT) {
          runStart = x;
          runLen = 1;
          runType = LIGHT;
          runColor = cellColor;
          runR = cr;
          runG = cg;
          runB = cb;
        } else {
          runStart = -1;
          runLen = 0;
          runType = EMPTY;
          runColor = "";
        }
      }
      if (runType === LIGHT) flushLightRun(cols);
    }

    // Draw mouse cursor as an occluder box
    if (this.mouseX >= 0 && this.mouseY >= 0) {
      const mx = this.mouseX * this.dpr;
      const my = this.mouseY * this.dpr;
      const boxSize = cellH * 1.2;
      oc.fillStyle = "#ffffff";
      oc.fillRect(mx - boxSize * 0.5, my - boxSize * 0.5, boxSize, boxSize);
    }
  }

  // ── GPU draw ────────────────────────────────────────────────────────

  private draw(): void {
    if (!this.available || !this.active) return;
    const gl = this.gl;
    if (!gl || !this.program || !this.occluderTexture || !this.positionBuffer)
      return;

    gl.viewport(0, 0, this.canvasW, this.canvasH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(this.positionLocation);
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);

    // Upload occluder texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.occluderTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this.occluderCanvas,
    );
    gl.uniform1i(this.occluderTexLocation, 0);

    // Upload light uniforms
    gl.uniform2f(this.resolutionLocation, this.canvasW, this.canvasH);
    gl.uniform1i(this.lightCountLocation, this.lights.length);

    const posRadiusData = new Float32Array(MAX_LIGHTS * 3);
    const colorIntData = new Float32Array(MAX_LIGHTS * 4);
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i];
      posRadiusData[i * 3] = l.cx;
      posRadiusData[i * 3 + 1] = l.cy;
      posRadiusData[i * 3 + 2] = l.radius;
      colorIntData[i * 4] = l.r;
      colorIntData[i * 4 + 1] = l.g;
      colorIntData[i * 4 + 2] = l.b;
      colorIntData[i * 4 + 3] = l.intensity;
    }
    gl.uniform3fv(this.lightPosRadiusLocation, posRadiusData);
    gl.uniform4fv(this.lightColorIntensityLocation, colorIntData);

    gl.uniform1f(
      this.boostLocation,
      Math.min(1.6, this.outputBoost * 0.7 + this.inputBoost * 0.45),
    );

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // ── WebGL setup ─────────────────────────────────────────────────────

  private initGl(): void {
    const gl = this.gl;
    if (!gl) return;

    const vs = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
    const fs = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);

    this.program = createProgram(gl, vs, fs);
    this.positionLocation = gl.getAttribLocation(this.program, "a_position");
    this.resolutionLocation = gl.getUniformLocation(
      this.program,
      "u_resolution",
    );
    this.lightCountLocation = gl.getUniformLocation(
      this.program,
      "u_lightCount",
    );
    this.lightPosRadiusLocation = gl.getUniformLocation(
      this.program,
      "u_lightPosRadius",
    );
    this.lightColorIntensityLocation = gl.getUniformLocation(
      this.program,
      "u_lightColorIntensity",
    );
    this.occluderTexLocation = gl.getUniformLocation(
      this.program,
      "u_occluderTex",
    );
    this.boostLocation = gl.getUniformLocation(this.program, "u_boost");

    this.positionBuffer = gl.createBuffer();
    if (!this.positionBuffer)
      throw new Error("Failed to allocate vertex buffer.");
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );

    this.occluderTexture = gl.createTexture();
    if (!this.occluderTexture)
      throw new Error("Failed to allocate occluder texture.");
    gl.bindTexture(gl.TEXTURE_2D, this.occluderTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function createShader(
  gl: GLContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Failed to allocate WebGL shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) || "Unknown shader error";
    gl.deleteShader(shader);
    throw new Error(info);
  }
  return shader;
}

function createProgram(
  gl: GLContext,
  vs: WebGLShader,
  fs: WebGLShader,
): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error("Failed to allocate WebGL program.");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) || "Unknown link error";
    gl.deleteProgram(program);
    throw new Error(info);
  }
  return program;
}

// ── Color classification ────────────────────────────────────────────

function isRGBColored(packed: number): boolean {
  const r = (packed >> 16) & 0xff;
  const g = (packed >> 8) & 0xff;
  const b = packed & 0xff;
  return Math.max(r, g, b) - Math.min(r, g, b) > 30;
}

function isPaletteColored(idx: number): boolean {
  if (idx === 0 || idx === 7 || idx === 8 || idx === 15) return false;
  if (idx >= 232) return false;
  return true;
}

// xterm 256-color palette as RGB triples
const XTERM_PALETTE_RGB: [number, number, number][] = (() => {
  const base16: [number, number, number][] = [
    [0, 0, 0],
    [205, 0, 0],
    [0, 205, 0],
    [205, 205, 0],
    [0, 0, 238],
    [205, 0, 205],
    [0, 205, 205],
    [229, 229, 229],
    [127, 127, 127],
    [255, 0, 0],
    [0, 255, 0],
    [255, 255, 0],
    [92, 92, 255],
    [255, 0, 255],
    [0, 255, 255],
    [255, 255, 255],
  ];
  const palette = [...base16];
  const vals = [0, 95, 135, 175, 215, 255];
  for (let r = 0; r < 6; r++)
    for (let g = 0; g < 6; g++)
      for (let b = 0; b < 6; b++) palette.push([vals[r], vals[g], vals[b]]);
  for (let i = 0; i < 24; i++) {
    const v = 8 + i * 10;
    palette.push([v, v, v]);
  }
  return palette;
})();

function xtermColorToCSS(color: number, isRgb: boolean): string {
  if (isRgb) {
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    return `rgb(${r},${g},${b})`;
  }
  const rgb = XTERM_PALETTE_RGB[color];
  return rgb ? `rgb(${rgb[0]},${rgb[1]},${rgb[2]})` : "#cdd6f4";
}

// ── Character shape classification ──────────────────────────────────

const enum Shape {
  MEDIUM, // default block ~70% width
  CIRCLE, // round letters
  THIN, // narrow vertical strokes
  NARROW, // half-width chars
  WIDE, // full-width chars
}

const SHAPE_MAP: Record<string, Shape> = {};

// Round letters → circle
for (const c of "oOcCaAeEdDbBpPqQgG09@°") SHAPE_MAP[c] = Shape.CIRCLE;

// Thin strokes → narrow vertical line
for (const c of "lLiIjJ|!1:;.,'`\"") SHAPE_MAP[c] = Shape.THIN;

// Narrow chars → half-width block
for (const c of "rRtTfF()[]{}/<>\\^") SHAPE_MAP[c] = Shape.NARROW;

// Wide/full chars → full cell width
for (const c of "mMwWHNUK#=_~—─━▪■□%&+*") SHAPE_MAP[c] = Shape.WIDE;

function charShape(ch: string): Shape {
  return SHAPE_MAP[ch.charAt(0)] ?? Shape.MEDIUM;
}
