import { describe, test, expect } from "bun:test";
import { BrowserSurfaceManager } from "../src/bun/browser-surface-manager";

describe("BrowserSurfaceManager", () => {
  test("createSurface returns a unique id with browser: prefix", () => {
    const mgr = new BrowserSurfaceManager();
    const id1 = mgr.createSurface("https://example.com");
    const id2 = mgr.createSurface("https://example.org");
    expect(id1).toStartWith("browser:");
    expect(id2).toStartWith("browser:");
    expect(id1).not.toBe(id2);
  });

  test("createSurface defaults to about:blank", () => {
    const mgr = new BrowserSurfaceManager();
    const id = mgr.createSurface();
    expect(mgr.getSurface(id)!.url).toBe("about:blank");
  });

  test("updateNavigation changes url and title", () => {
    const mgr = new BrowserSurfaceManager();
    const id = mgr.createSurface("https://a.com");
    mgr.updateNavigation(id, "https://b.com", "Page B");
    const s = mgr.getSurface(id)!;
    expect(s.url).toBe("https://b.com");
    expect(s.title).toBe("Page B");
  });

  test("setTitle updates title only", () => {
    const mgr = new BrowserSurfaceManager();
    const id = mgr.createSurface("https://a.com");
    mgr.setTitle(id, "My Title");
    expect(mgr.getSurface(id)!.title).toBe("My Title");
    expect(mgr.getSurface(id)!.url).toBe("https://a.com");
  });

  test("setZoom clamps between 0.25 and 5.0", () => {
    const mgr = new BrowserSurfaceManager();
    const id = mgr.createSurface();
    mgr.setZoom(id, 2.0);
    expect(mgr.getSurface(id)!.zoom).toBe(2.0);
    mgr.setZoom(id, 0.1);
    expect(mgr.getSurface(id)!.zoom).toBe(0.25);
    mgr.setZoom(id, 10);
    expect(mgr.getSurface(id)!.zoom).toBe(5.0);
  });

  test("closeSurface removes it and fires callback", () => {
    const mgr = new BrowserSurfaceManager();
    const id = mgr.createSurface();
    let closedId = "";
    mgr.onSurfaceClosed = (sid) => { closedId = sid; };
    expect(mgr.surfaceCount).toBe(1);
    mgr.closeSurface(id);
    expect(mgr.surfaceCount).toBe(0);
    expect(closedId).toBe(id);
    expect(mgr.getSurface(id)).toBeUndefined();
  });

  test("closeSurface is a no-op for unknown id", () => {
    const mgr = new BrowserSurfaceManager();
    let called = false;
    mgr.onSurfaceClosed = () => { called = true; };
    mgr.closeSurface("nonexistent");
    expect(called).toBe(false);
  });

  test("isBrowserSurface returns true for managed ids", () => {
    const mgr = new BrowserSurfaceManager();
    const id = mgr.createSurface();
    expect(mgr.isBrowserSurface(id)).toBe(true);
    expect(mgr.isBrowserSurface("surface:1")).toBe(false);
  });

  test("getAllSurfaces returns all managed surfaces", () => {
    const mgr = new BrowserSurfaceManager();
    mgr.createSurface("https://a.com");
    mgr.createSurface("https://b.com");
    mgr.createSurface("https://c.com");
    expect(mgr.getAllSurfaces()).toHaveLength(3);
  });

  test("destroy clears all surfaces", () => {
    const mgr = new BrowserSurfaceManager();
    mgr.createSurface();
    mgr.createSurface();
    mgr.destroy();
    expect(mgr.surfaceCount).toBe(0);
  });

  test("default partition is persist:browser-shared", () => {
    const mgr = new BrowserSurfaceManager();
    const id = mgr.createSurface();
    expect(mgr.getSurface(id)!.partition).toBe("persist:browser-shared");
  });

  test("custom partition is preserved", () => {
    const mgr = new BrowserSurfaceManager();
    const id = mgr.createSurface("https://a.com", "persist:custom");
    expect(mgr.getSurface(id)!.partition).toBe("persist:custom");
  });
});
