import type { Terminal } from "xterm";

type GLContext = WebGLRenderingContext | WebGL2RenderingContext;
type Disposable = { dispose(): void };

const VERTEX_SHADER_SOURCE = `
attribute vec2 a_position;
varying vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SOURCE = `
precision mediump float;

varying vec2 v_uv;

uniform sampler2D u_source;
uniform vec2 u_texel;
uniform float u_boost;
uniform float u_focus;

vec4 sampleSource(vec2 uv) {
  return texture2D(u_source, clamp(uv, vec2(0.0), vec2(1.0)));
}

vec4 sampleBright(vec2 uv) {
  vec4 source = sampleSource(uv);
  float luma = dot(source.rgb, vec3(0.2126, 0.7152, 0.0722));
  float threshold = mix(0.28, 0.16, u_focus);
  float gate = smoothstep(threshold - 0.1, threshold + 0.14, max(luma, source.a));
  return vec4(source.rgb * gate, source.a * gate);
}

vec4 blurSource(vec2 uv, vec2 radius) {
  vec4 sum = sampleSource(uv) * 0.16;
  sum += sampleSource(uv + vec2(radius.x, 0.0)) * 0.12;
  sum += sampleSource(uv - vec2(radius.x, 0.0)) * 0.12;
  sum += sampleSource(uv + vec2(0.0, radius.y)) * 0.12;
  sum += sampleSource(uv - vec2(0.0, radius.y)) * 0.12;
  sum += sampleSource(uv + vec2(radius.x, radius.y)) * 0.09;
  sum += sampleSource(uv + vec2(-radius.x, radius.y)) * 0.09;
  sum += sampleSource(uv + vec2(radius.x, -radius.y)) * 0.09;
  sum += sampleSource(uv + vec2(-radius.x, -radius.y)) * 0.09;
  return sum;
}

vec4 blurBright(vec2 uv, vec2 radius) {
  vec4 sum = sampleBright(uv) * 0.16;
  sum += sampleBright(uv + vec2(radius.x, 0.0)) * 0.12;
  sum += sampleBright(uv - vec2(radius.x, 0.0)) * 0.12;
  sum += sampleBright(uv + vec2(0.0, radius.y)) * 0.12;
  sum += sampleBright(uv - vec2(0.0, radius.y)) * 0.12;
  sum += sampleBright(uv + vec2(radius.x, radius.y)) * 0.09;
  sum += sampleBright(uv + vec2(-radius.x, radius.y)) * 0.09;
  sum += sampleBright(uv + vec2(radius.x, -radius.y)) * 0.09;
  sum += sampleBright(uv + vec2(-radius.x, -radius.y)) * 0.09;
  return sum;
}

void main() {
  vec2 glowRadius = u_texel * (3.4 + u_focus * 1.1 + u_boost * 0.6);
  vec2 bloomRadius = u_texel * (11.0 + u_focus * 2.5 + u_boost * 1.8);

  vec4 base = sampleSource(v_uv);
  vec4 glow = blurSource(v_uv, glowRadius);
  vec4 bloom = blurBright(v_uv, bloomRadius);

  float glowStrength = 1.45 + u_boost * 0.65 + u_focus * 0.3;
  float bloomStrength = 2.35 + u_boost * 0.95 + u_focus * 0.45;
  float directStrength = 0.18 + u_focus * 0.08;

  vec3 color =
    glow.rgb * glow.a * glowStrength +
    bloom.rgb * bloom.a * bloomStrength +
    base.rgb * base.a * directStrength;

  float alpha = clamp(
    glow.a * (0.48 + u_focus * 0.08) +
    bloom.a * (0.92 + u_boost * 0.16) +
    base.a * 0.14,
    0.0,
    0.98
  );

  gl_FragColor = vec4(color, alpha);
}
`;

export class TerminalEffects {
  private readonly canvas: HTMLCanvasElement;
  private readonly sourceCanvas: HTMLCanvasElement;
  private readonly sourceCtx: CanvasRenderingContext2D;
  private readonly resizeObserver: ResizeObserver;
  private readonly subscriptions: Disposable[] = [];

  private gl: GLContext | null = null;
  private program: WebGLProgram | null = null;
  private positionBuffer: WebGLBuffer | null = null;
  private sourceTexture: WebGLTexture | null = null;

  private positionLocation = -1;
  private texelLocation: WebGLUniformLocation | null = null;
  private boostLocation: WebGLUniformLocation | null = null;
  private focusLocation: WebGLUniformLocation | null = null;
  private sourceLocation: WebGLUniformLocation | null = null;

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
  private sourceWidth = 1;
  private sourceHeight = 1;

  constructor(
    private host: HTMLElement,
    private term: Terminal,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "terminal-effects-layer";
    this.canvas.setAttribute("aria-hidden", "true");

    this.sourceCanvas = document.createElement("canvas");
    const sourceCtx = this.sourceCanvas.getContext("2d", {
      alpha: true,
      desynchronized: true,
    });
    if (!sourceCtx) {
      this.available = false;
      this.active = false;
      this.canvas.style.display = "none";
      host.appendChild(this.canvas);
      this.sourceCtx = document.createElement("canvas").getContext("2d")!;
      this.resizeObserver = new ResizeObserver(() => {});
      return;
    }
    this.sourceCtx = sourceCtx;

    host.appendChild(this.canvas);

    this.gl =
      (this.canvas.getContext("webgl2", {
        alpha: true,
        antialias: true,
        premultipliedAlpha: true,
      }) as GLContext | null) ??
      (this.canvas.getContext("webgl", {
        alpha: true,
        antialias: true,
        premultipliedAlpha: true,
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
      console.warn("[terminal-effects] WebGL bloom disabled:", error);
      this.available = false;
      this.active = false;
      this.canvas.style.display = "none";
      return;
    }

    this.subscriptions.push(
      term.onRender(() => this.markDirty()),
      term.onCursorMove(() => {
        this.outputBoost = Math.max(this.outputBoost, 0.08);
        this.schedule();
      }),
      term.onWriteParsed(() => this.markDirty()),
    );

    this.resize();
    this.markDirty();
  }

  setFocused(focused: boolean): void {
    if (!this.available) return;
    this.focused = focused;
    if (focused) {
      this.outputBoost = Math.max(this.outputBoost, 0.18);
    }
    this.schedule();
  }

  pulseOutput(size = 0): void {
    if (!this.available || !this.active) return;
    const boost = Math.min(1.6, 0.16 + size / 180);
    this.outputBoost = Math.min(2.8, this.outputBoost + boost);
    this.markDirty();
  }

  pulseInput(size = 0): void {
    if (!this.available || !this.active) return;
    const boost = Math.min(1.1, 0.1 + size / 240);
    this.inputBoost = Math.min(1.8, this.inputBoost + boost);
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
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }

    this.resizeObserver.disconnect();

    if (this.available && this.gl) {
      if (this.positionBuffer) this.gl.deleteBuffer(this.positionBuffer);
      if (this.sourceTexture) this.gl.deleteTexture(this.sourceTexture);
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
    ) {
      return;
    }
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.render();
    });
  }

  private render(): void {
    if (
      !this.available ||
      !this.active ||
      this.destroyed ||
      !this.gl ||
      !this.program ||
      !this.sourceTexture
    ) {
      return;
    }

    if (this.dirty) {
      this.captureTerminal();
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

    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;

    this.sourceWidth = Math.max(1, Math.round(this.width * 0.5));
    this.sourceHeight = Math.max(1, Math.round(this.height * 0.5));
    this.sourceCanvas.width = this.sourceWidth;
    this.sourceCanvas.height = this.sourceHeight;

    this.gl?.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  private captureTerminal(): void {
    if (!this.available || !this.active) return;
    this.sourceCtx.clearRect(0, 0, this.sourceWidth, this.sourceHeight);
    this.sourceCtx.globalCompositeOperation = "source-over";

    const canvases = this.collectTerminalCanvases();
    for (const canvas of canvases) {
      this.sourceCtx.drawImage(canvas, 0, 0, this.sourceWidth, this.sourceHeight);
    }

    this.sourceCtx.globalCompositeOperation = "lighter";
    this.sourceCtx.globalAlpha = 0.62 + (this.focused ? 0.08 : 0);
    this.sourceCtx.filter = `blur(${this.focused ? 1.4 : 1.1}px) brightness(1.18) saturate(1.22)`;

    for (const canvas of canvases) {
      this.sourceCtx.drawImage(canvas, 0, 0, this.sourceWidth, this.sourceHeight);
    }

    this.sourceCtx.filter = "none";
    this.sourceCtx.globalAlpha = 1;
    this.sourceCtx.globalCompositeOperation = "source-over";
  }

  private collectTerminalCanvases(): HTMLCanvasElement[] {
    const root = this.term.element;
    if (!root) return [];

    return Array.from(root.querySelectorAll("canvas")).filter((canvas) => {
      return (
        canvas.width > 0 &&
        canvas.height > 0 &&
        canvas.getClientRects().length > 0
      );
    });
  }

  private draw(): void {
    if (!this.available || !this.active) return;
    const gl = this.gl;
    if (!gl || !this.program || !this.sourceTexture || !this.positionBuffer) return;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(this.positionLocation);
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this.sourceCanvas,
    );

    gl.uniform1i(this.sourceLocation, 0);
    gl.uniform2f(this.texelLocation, 1 / this.sourceWidth, 1 / this.sourceHeight);
    gl.uniform1f(
      this.boostLocation,
      Math.min(1.6, this.outputBoost * 0.7 + this.inputBoost * 0.45),
    );
    gl.uniform1f(this.focusLocation, this.focused ? 1 : 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private initGl(): void {
    const gl = this.gl;
    if (!gl) return;

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
    const fragmentShader = createShader(
      gl,
      gl.FRAGMENT_SHADER,
      FRAGMENT_SHADER_SOURCE,
    );

    this.program = createProgram(gl, vertexShader, fragmentShader);
    this.positionLocation = gl.getAttribLocation(this.program, "a_position");
    this.texelLocation = gl.getUniformLocation(this.program, "u_texel");
    this.boostLocation = gl.getUniformLocation(this.program, "u_boost");
    this.focusLocation = gl.getUniformLocation(this.program, "u_focus");
    this.sourceLocation = gl.getUniformLocation(this.program, "u_source");

    this.positionBuffer = gl.createBuffer();
    if (!this.positionBuffer) {
      throw new Error("Failed to allocate terminal effect vertex buffer.");
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1,
        1, -1,
        -1, 1,
        1, 1,
      ]),
      gl.STATIC_DRAW,
    );

    this.sourceTexture = gl.createTexture();
    if (!this.sourceTexture) {
      throw new Error("Failed to allocate terminal effect texture.");
    }

    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }
}

function createShader(
  gl: GLContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("Failed to allocate WebGL shader.");
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) || "Unknown shader compile error";
    gl.deleteShader(shader);
    throw new Error(info);
  }

  return shader;
}

function createProgram(
  gl: GLContext,
  vertexShader: WebGLShader,
  fragmentShader: WebGLShader,
): WebGLProgram {
  const program = gl.createProgram();
  if (!program) {
    throw new Error("Failed to allocate WebGL program.");
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) || "Unknown program link error";
    gl.deleteProgram(program);
    throw new Error(info);
  }

  return program;
}
