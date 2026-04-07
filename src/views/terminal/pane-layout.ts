export interface PaneSplit {
  type: "split";
  direction: "horizontal" | "vertical";
  ratio: number;
  children: [PaneNode, PaneNode];
}

export interface PaneLeaf {
  type: "leaf";
  surfaceId: string;
}

export type PaneNode = PaneSplit | PaneLeaf;

export interface PaneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type PaneDropPosition = "swap" | "left" | "right" | "top" | "bottom";

const GAP = 2; // pixels between panes

export class PaneLayout {
  root: PaneNode;

  constructor(surfaceId: string) {
    this.root = { type: "leaf", surfaceId };
  }

  /** Split the pane containing surfaceId. Original stays first, new surface second. */
  splitSurface(
    surfaceId: string,
    direction: "horizontal" | "vertical",
    newSurfaceId: string,
  ): void {
    this.root = this.splitNode(this.root, surfaceId, direction, newSurfaceId);
  }

  /** Move an existing surface relative to another surface, or swap their positions. */
  moveSurface(
    surfaceId: string,
    targetSurfaceId: string,
    position: PaneDropPosition,
  ): boolean {
    if (
      surfaceId === targetSurfaceId ||
      !this.hasSurface(this.root, surfaceId) ||
      !this.hasSurface(this.root, targetSurfaceId)
    ) {
      return false;
    }

    if (position === "swap") {
      const [nextRoot, swapped] = this.swapLeaves(
        this.root,
        surfaceId,
        targetSurfaceId,
      );
      if (!swapped) return false;
      this.root = nextRoot;
      return true;
    }

    const prunedRoot = this.removeNode(this.root, surfaceId);
    if (!prunedRoot) return false;

    const [nextRoot, inserted] = this.insertRelative(
      prunedRoot,
      targetSurfaceId,
      position,
      surfaceId,
    );

    if (!inserted) return false;

    this.root = nextRoot;
    return true;
  }

  /** Remove a surface. Its parent split collapses to the sibling. */
  removeSurface(surfaceId: string): void {
    if (this.root.type === "leaf" && this.root.surfaceId === surfaceId) {
      // Can't remove the last surface
      return;
    }
    this.root = this.removeNode(this.root, surfaceId) ?? this.root;
  }

  /** Compute pixel rects for all leaves given a bounding rect. */
  computeRects(bounds: PaneRect): Map<string, PaneRect> {
    const result = new Map<string, PaneRect>();
    this.computeNode(this.root, bounds, result);
    return result;
  }

  /** Get all surface IDs in tree order (left-to-right, top-to-bottom). */
  getAllSurfaceIds(): string[] {
    const ids: string[] = [];
    this.collectIds(this.root, ids);
    return ids;
  }

  /** Find the neighboring surface in a direction from the given surface. */
  findNeighbor(
    surfaceId: string,
    dir: "left" | "right" | "up" | "down",
  ): string | null {
    // Compute rects to find positions
    const rects = this.computeRects({ x: 0, y: 0, w: 1000, h: 1000 });
    const current = rects.get(surfaceId);
    if (!current) return null;

    const cx = current.x + current.w / 2;
    const cy = current.y + current.h / 2;

    let bestId: string | null = null;
    let bestDist = Infinity;

    for (const [id, rect] of rects) {
      if (id === surfaceId) continue;

      const rx = rect.x + rect.w / 2;
      const ry = rect.y + rect.h / 2;

      let valid = false;
      if (dir === "left" && rx < cx) valid = true;
      if (dir === "right" && rx > cx) valid = true;
      if (dir === "up" && ry < cy) valid = true;
      if (dir === "down" && ry > cy) valid = true;

      if (valid) {
        const dist = Math.abs(rx - cx) + Math.abs(ry - cy);
        if (dist < bestDist) {
          bestDist = dist;
          bestId = id;
        }
      }
    }

    return bestId;
  }

  /** Get divider positions for rendering draggable dividers. */
  getDividers(
    bounds: PaneRect,
  ): {
    x: number;
    y: number;
    w: number;
    h: number;
    direction: "horizontal" | "vertical";
    node: PaneSplit;
  }[] {
    const dividers: {
      x: number;
      y: number;
      w: number;
      h: number;
      direction: "horizontal" | "vertical";
      node: PaneSplit;
    }[] = [];
    this.collectDividers(this.root, bounds, dividers);
    return dividers;
  }

  // --- Private ---

  private splitNode(
    node: PaneNode,
    surfaceId: string,
    direction: "horizontal" | "vertical",
    newSurfaceId: string,
  ): PaneNode {
    if (node.type === "leaf") {
      if (node.surfaceId === surfaceId) {
        return {
          type: "split",
          direction,
          ratio: 0.5,
          children: [
            { type: "leaf", surfaceId: node.surfaceId },
            { type: "leaf", surfaceId: newSurfaceId },
          ],
        };
      }
      return node;
    }

    return {
      ...node,
      children: [
        this.splitNode(node.children[0], surfaceId, direction, newSurfaceId),
        this.splitNode(node.children[1], surfaceId, direction, newSurfaceId),
      ],
    };
  }

  private insertRelative(
    node: PaneNode,
    targetSurfaceId: string,
    position: Exclude<PaneDropPosition, "swap">,
    surfaceId: string,
  ): [PaneNode, boolean] {
    if (node.type === "leaf") {
      if (node.surfaceId !== targetSurfaceId) {
        return [node, false];
      }

      const direction =
        position === "left" || position === "right" ? "horizontal" : "vertical";
      const placeDraggedFirst =
        position === "left" || position === "top";
      const draggedLeaf: PaneLeaf = { type: "leaf", surfaceId };
      const targetLeaf: PaneLeaf = {
        type: "leaf",
        surfaceId: targetSurfaceId,
      };

      return [
        {
          type: "split",
          direction,
          ratio: 0.5,
          children: placeDraggedFirst
            ? [draggedLeaf, targetLeaf]
            : [targetLeaf, draggedLeaf],
        },
        true,
      ];
    }

    const [left, leftInserted] = this.insertRelative(
      node.children[0],
      targetSurfaceId,
      position,
      surfaceId,
    );
    if (leftInserted) {
      return [{ ...node, children: [left, node.children[1]] }, true];
    }

    const [right, rightInserted] = this.insertRelative(
      node.children[1],
      targetSurfaceId,
      position,
      surfaceId,
    );
    if (rightInserted) {
      return [{ ...node, children: [node.children[0], right] }, true];
    }

    return [node, false];
  }

  private removeNode(node: PaneNode, surfaceId: string): PaneNode | null {
    if (node.type === "leaf") {
      return node.surfaceId === surfaceId ? null : node;
    }

    const left = this.removeNode(node.children[0], surfaceId);
    const right = this.removeNode(node.children[1], surfaceId);

    if (left === null) return right;
    if (right === null) return left;

    return { ...node, children: [left, right] };
  }

  private swapLeaves(
    node: PaneNode,
    firstSurfaceId: string,
    secondSurfaceId: string,
  ): [PaneNode, boolean] {
    if (node.type === "leaf") {
      if (node.surfaceId === firstSurfaceId) {
        return [{ ...node, surfaceId: secondSurfaceId }, true];
      }
      if (node.surfaceId === secondSurfaceId) {
        return [{ ...node, surfaceId: firstSurfaceId }, true];
      }
      return [node, false];
    }

    const [left, leftChanged] = this.swapLeaves(
      node.children[0],
      firstSurfaceId,
      secondSurfaceId,
    );
    const [right, rightChanged] = this.swapLeaves(
      node.children[1],
      firstSurfaceId,
      secondSurfaceId,
    );

    if (!leftChanged && !rightChanged) {
      return [node, false];
    }

    return [{ ...node, children: [left, right] }, true];
  }

  private computeNode(
    node: PaneNode,
    bounds: PaneRect,
    result: Map<string, PaneRect>,
  ): void {
    if (node.type === "leaf") {
      result.set(node.surfaceId, bounds);
      return;
    }

    const { direction, ratio, children } = node;
    const half = GAP / 2;

    if (direction === "horizontal") {
      const splitX = bounds.x + bounds.w * ratio;
      this.computeNode(
        children[0],
        { x: bounds.x, y: bounds.y, w: splitX - bounds.x - half, h: bounds.h },
        result,
      );
      this.computeNode(
        children[1],
        {
          x: splitX + half,
          y: bounds.y,
          w: bounds.x + bounds.w - splitX - half,
          h: bounds.h,
        },
        result,
      );
    } else {
      const splitY = bounds.y + bounds.h * ratio;
      this.computeNode(
        children[0],
        { x: bounds.x, y: bounds.y, w: bounds.w, h: splitY - bounds.y - half },
        result,
      );
      this.computeNode(
        children[1],
        {
          x: bounds.x,
          y: splitY + half,
          w: bounds.w,
          h: bounds.y + bounds.h - splitY - half,
        },
        result,
      );
    }
  }

  private collectIds(node: PaneNode, ids: string[]): void {
    if (node.type === "leaf") {
      ids.push(node.surfaceId);
    } else {
      this.collectIds(node.children[0], ids);
      this.collectIds(node.children[1], ids);
    }
  }

  private hasSurface(node: PaneNode, surfaceId: string): boolean {
    if (node.type === "leaf") {
      return node.surfaceId === surfaceId;
    }

    return (
      this.hasSurface(node.children[0], surfaceId) ||
      this.hasSurface(node.children[1], surfaceId)
    );
  }

  private collectDividers(
    node: PaneNode,
    bounds: PaneRect,
    dividers: {
      x: number;
      y: number;
      w: number;
      h: number;
      direction: "horizontal" | "vertical";
      node: PaneSplit;
    }[],
  ): void {
    if (node.type === "leaf") return;

    const { direction, ratio, children } = node;
    const half = GAP / 2;

    if (direction === "horizontal") {
      const splitX = bounds.x + bounds.w * ratio;
      dividers.push({
        x: splitX - half,
        y: bounds.y,
        w: GAP,
        h: bounds.h,
        direction,
        node,
      });
      this.collectDividers(
        children[0],
        { x: bounds.x, y: bounds.y, w: splitX - bounds.x - half, h: bounds.h },
        dividers,
      );
      this.collectDividers(
        children[1],
        {
          x: splitX + half,
          y: bounds.y,
          w: bounds.x + bounds.w - splitX - half,
          h: bounds.h,
        },
        dividers,
      );
    } else {
      const splitY = bounds.y + bounds.h * ratio;
      dividers.push({
        x: bounds.x,
        y: splitY - half,
        w: bounds.w,
        h: GAP,
        direction,
        node,
      });
      this.collectDividers(
        children[0],
        { x: bounds.x, y: bounds.y, w: bounds.w, h: splitY - bounds.y - half },
        dividers,
      );
      this.collectDividers(
        children[1],
        {
          x: bounds.x,
          y: splitY + half,
          w: bounds.w,
          h: bounds.y + bounds.h - splitY - half,
        },
        dividers,
      );
    }
  }
}
