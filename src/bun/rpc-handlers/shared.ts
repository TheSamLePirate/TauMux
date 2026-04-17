import type { PaneNode, PaneRect } from "../../shared/types";

/** Compute normalized rects (0-1) from a PaneNode tree. */
export function computeNormalizedRects(node: PaneNode): Map<string, PaneRect> {
  const result = new Map<string, PaneRect>();
  const GAP = 0.002; // small normalized gap
  computeNode(node, { x: 0, y: 0, w: 1, h: 1 }, result, GAP);
  return result;
}

function computeNode(
  node: PaneNode,
  bounds: PaneRect,
  result: Map<string, PaneRect>,
  gap: number,
): void {
  if (node.type === "leaf") {
    result.set(node.surfaceId, bounds);
    return;
  }
  const { direction, ratio, children } = node;
  const half = gap / 2;
  if (direction === "horizontal") {
    const splitX = bounds.x + bounds.w * ratio;
    computeNode(
      children[0],
      { x: bounds.x, y: bounds.y, w: splitX - bounds.x - half, h: bounds.h },
      result,
      gap,
    );
    computeNode(
      children[1],
      {
        x: splitX + half,
        y: bounds.y,
        w: bounds.x + bounds.w - splitX - half,
        h: bounds.h,
      },
      result,
      gap,
    );
  } else {
    const splitY = bounds.y + bounds.h * ratio;
    computeNode(
      children[0],
      { x: bounds.x, y: bounds.y, w: bounds.w, h: splitY - bounds.y - half },
      result,
      gap,
    );
    computeNode(
      children[1],
      {
        x: bounds.x,
        y: splitY + half,
        w: bounds.w,
        h: bounds.y + bounds.h - splitY - half,
      },
      result,
      gap,
    );
  }
}

/** Browser DOM snapshot script — reused by `browser.click` when
 *  `snapshot_after` is set and by `browser.snapshot`. */
export const SNAPSHOT_SCRIPT = `
(function(){
  var counter=0;
  function snap(node,depth,max){
    if(depth>max||!node)return null;
    var tag=node.tagName?node.tagName.toLowerCase():null;
    var role=(node.getAttribute&&node.getAttribute('role'))||tag;
    var name=(node.getAttribute&&(node.getAttribute('aria-label')||node.getAttribute('alt')||node.getAttribute('title')||node.getAttribute('placeholder')))||'';
    var text=node.nodeType===3?(node.textContent||'').trim():'';
    var interactive=['a','button','input','select','textarea'].indexOf(tag)>=0;
    var children=[];
    var cn=node.childNodes||[];
    for(var i=0;i<cn.length;i++){var c=snap(cn[i],depth+1,max);if(c)children.push(c);}
    if(!role&&!text&&children.length===0)return null;
    var entry={role:role};
    if(name)entry.name=name;
    if(text)entry.text=text;
    if(interactive)entry.ref='e'+(++counter);
    if(children.length)entry.children=children;
    return entry;
  }
  return JSON.stringify(snap(document.body,0,8));
})()
`;

/** Named key → terminal input sequence. Used by `surface.send_key`. */
export const KEY_MAP: Record<string, string> = {
  enter: "\r",
  tab: "\t",
  escape: "\x1b",
  backspace: "\x7f",
  delete: "\x1b[3~",
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
};

// --- Schema validation ----------------------------------------------------

type ParamSpec =
  | { type: "string"; required?: boolean; maxLength?: number }
  | {
      type: "number";
      required?: boolean;
      min?: number;
      max?: number;
      integer?: boolean;
    }
  | { type: "boolean"; required?: boolean }
  | { type: "array"; required?: boolean; maxLength?: number };

type MethodSchema = Record<string, ParamSpec>;

export const METHOD_SCHEMAS: Record<string, MethodSchema> = {
  // PID ancestry + signal whitelist already enforced in the handler;
  // this catches garbage inputs earlier with clearer errors.
  "surface.kill_pid": {
    pid: { type: "number", required: true, integer: true, min: 1 },
    signal: { type: "string", maxLength: 16 },
  },
  "surface.kill_port": {
    surface_id: { type: "string", maxLength: 128 },
    surface: { type: "string", maxLength: 128 },
    port: { type: "number", required: true, integer: true, min: 1, max: 65535 },
  },
  "workspace.create": {
    cwd: { type: "string", maxLength: 4096 },
    name: { type: "string", maxLength: 256 },
  },
  // Script size cap. Anything bigger than 256 KiB is almost certainly
  // a misuse of eval; legitimate automation code fits easily.
  "browser.eval": {
    surface_id: { type: "string", maxLength: 128 },
    surface: { type: "string", maxLength: 128 },
    script: { type: "string", required: true, maxLength: 256 * 1024 },
  },
  "browser.click": {
    surface_id: { type: "string", maxLength: 128 },
    surface: { type: "string", maxLength: 128 },
    selector: { type: "string", required: true, maxLength: 2048 },
  },
};

export function validateParams(
  method: string,
  schema: MethodSchema,
  params: Record<string, unknown>,
): void {
  const p = params ?? {};
  for (const [key, spec] of Object.entries(schema)) {
    const v = p[key];
    if (v === undefined || v === null) {
      if (spec.required) {
        throw new Error(`${method}: missing required param "${key}"`);
      }
      continue;
    }
    switch (spec.type) {
      case "string":
        if (typeof v !== "string") {
          throw new Error(`${method}: "${key}" must be a string`);
        }
        if (spec.maxLength !== undefined && v.length > spec.maxLength) {
          throw new Error(
            `${method}: "${key}" exceeds maxLength ${spec.maxLength}`,
          );
        }
        break;
      case "number": {
        const n = typeof v === "number" ? v : Number(v);
        if (!Number.isFinite(n)) {
          throw new Error(`${method}: "${key}" must be a finite number`);
        }
        if (spec.integer && !Number.isInteger(n)) {
          throw new Error(`${method}: "${key}" must be an integer`);
        }
        if (spec.min !== undefined && n < spec.min) {
          throw new Error(`${method}: "${key}" below min ${spec.min}`);
        }
        if (spec.max !== undefined && n > spec.max) {
          throw new Error(`${method}: "${key}" above max ${spec.max}`);
        }
        break;
      }
      case "boolean":
        if (typeof v !== "boolean") {
          throw new Error(`${method}: "${key}" must be a boolean`);
        }
        break;
      case "array":
        if (!Array.isArray(v)) {
          throw new Error(`${method}: "${key}" must be an array`);
        }
        if (spec.maxLength !== undefined && v.length > spec.maxLength) {
          throw new Error(
            `${method}: "${key}" exceeds maxLength ${spec.maxLength}`,
          );
        }
        break;
    }
  }
}

/** Resolve the surface id for a handler invocation: explicit
 *  `surface_id` / `surface` param wins, falling back to the focused
 *  surface. Returns null if no candidate exists. Centralises the
 *  "surface_id | surface | focused" lookup every handler used to inline. */
export function resolveSurfaceId(
  params: Record<string, unknown>,
  focusedId: string | null,
): string | null {
  const explicit =
    (params["surface_id"] as string | undefined) ??
    (params["surface"] as string | undefined);
  return explicit ?? focusedId;
}
