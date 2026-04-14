/**
 * BrowserSurfaceManager — lightweight state tracker for browser-type surfaces.
 *
 * Unlike terminal surfaces managed by SessionManager (PTY + sideband),
 * browser surfaces have no process, no stdin/stdout, no sideband channels.
 * This manager only tracks URL, title, zoom, partition, and navigation history
 * so the socket API, CLI, web mirror, and layout persistence can reference them.
 *
 * The actual <electrobun-webview> DOM element lives in the webview process;
 * we communicate with it via RPC messages.
 */

export interface BrowserSurface {
  id: string;
  url: string;
  title: string;
  zoom: number;
  partition: string;
}

export class BrowserSurfaceManager {
  private surfaces = new Map<string, BrowserSurface>();
  private counter = 0;

  onSurfaceClosed: ((surfaceId: string) => void) | null = null;

  createSurface(url?: string, partition?: string): string {
    const id = `browser:${++this.counter}`;
    this.surfaces.set(id, {
      id,
      url: url || "about:blank",
      title: "New Tab",
      zoom: 1.0,
      partition: partition || "persist:browser-shared",
    });
    console.log(`[browser] created ${id} → ${url || "about:blank"}`);
    return id;
  }

  /** Update state after the webview reports a navigation. */
  updateNavigation(id: string, url: string, title: string): void {
    const surface = this.surfaces.get(id);
    if (!surface) return;
    surface.url = url;
    if (title) surface.title = title;
  }

  /** Update the page title independently of navigation. */
  setTitle(id: string, title: string): void {
    const surface = this.surfaces.get(id);
    if (surface && title) surface.title = title;
  }

  setZoom(id: string, zoom: number): void {
    const surface = this.surfaces.get(id);
    if (surface) surface.zoom = Math.max(0.25, Math.min(5.0, zoom));
  }

  getSurface(id: string): BrowserSurface | undefined {
    return this.surfaces.get(id);
  }

  getAllSurfaces(): BrowserSurface[] {
    return [...this.surfaces.values()];
  }

  closeSurface(id: string): void {
    if (!this.surfaces.has(id)) return;
    this.surfaces.delete(id);
    console.log(`[browser] closed ${id}`);
    this.onSurfaceClosed?.(id);
  }

  get surfaceCount(): number {
    return this.surfaces.size;
  }

  /** Check whether a surface id belongs to this manager. */
  isBrowserSurface(id: string): boolean {
    return this.surfaces.has(id);
  }

  destroy(): void {
    this.surfaces.clear();
  }
}
