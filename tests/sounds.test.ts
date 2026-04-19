import { afterEach, describe, expect, test } from "bun:test";
import { __setAudioFactory, playNotificationSound } from "../src/shared/sounds";

// Minimal fake HTMLAudioElement. The helper only touches `preload`,
// `play()`, and `cloneNode()` — enough to assert behaviour without
// dragging in happy-dom.
class FakeAudio {
  public src: string;
  public preload: string = "";
  public playCalls = 0;
  public playMode: "promise-resolve" | "promise-reject" | "sync-throw" =
    "promise-resolve";

  constructor(src?: string) {
    this.src = src ?? "";
  }
  play(): Promise<void> {
    this.playCalls += 1;
    if (this.playMode === "sync-throw") throw new Error("sync throw");
    if (this.playMode === "promise-reject")
      return Promise.reject(new Error("autoplay blocked"));
    return Promise.resolve();
  }
  cloneNode(_deep?: boolean): FakeAudio {
    // Hit the Stub constructor so each clone also lands in `instances`.
    // The Stub inherits from this class; `this.constructor` resolves to
    // Stub at runtime.
    const Ctor = this.constructor as new (src?: string) => FakeAudio;
    const c = new Ctor(this.src);
    c.preload = this.preload;
    return c;
  }
}

const instances: FakeAudio[] = [];

function installFactory() {
  instances.length = 0;
  __setAudioFactory(
    class Stub extends FakeAudio {
      constructor(src?: string) {
        super(src);
        instances.push(this);
      }
    } as unknown as new (src?: string) => HTMLAudioElement,
  );
}

describe("playNotificationSound", () => {
  afterEach(() => {
    __setAudioFactory(null);
    instances.length = 0;
  });

  test("constructs a template + a played clone on first call", () => {
    installFactory();
    playNotificationSound("audio/finish.mp3");

    // 1 template (preloaded, never played) + 1 clone (played once).
    expect(instances.length).toBe(2);
    expect(instances[0]!.src).toBe("audio/finish.mp3");
    expect(instances[0]!.preload).toBe("auto");
    expect(instances[0]!.playCalls).toBe(0);
    expect(instances[1]!.playCalls).toBe(1);
  });

  test("caches the template but plays a fresh clone per call", () => {
    installFactory();
    playNotificationSound("audio/finish.mp3");
    playNotificationSound("audio/finish.mp3");
    playNotificationSound("audio/finish.mp3");

    // 1 template + 3 clones. Reusing one element would have made the
    // 2nd and 3rd plays silent on WebKit.
    expect(instances.length).toBe(4);
    expect(instances[0]!.playCalls).toBe(0); // template: never played
    expect(instances.slice(1).map((i) => i.playCalls)).toEqual([1, 1, 1]);
    // Each clone is a distinct object — that's the whole point.
    expect(new Set(instances.slice(1)).size).toBe(3);
  });

  test("swallows rejected play() promises (autoplay policy)", async () => {
    installFactory();
    instances.length = 0;
    __setAudioFactory(
      class Stub extends FakeAudio {
        constructor(src?: string) {
          super(src);
          this.playMode = "promise-reject";
          instances.push(this);
        }
      } as unknown as new (src?: string) => HTMLAudioElement,
    );

    expect(() => playNotificationSound("audio/finish.mp3")).not.toThrow();
    // Let the unhandled-rejection guard run.
    await new Promise((r) => setTimeout(r, 0));
  });

  test("swallows synchronous play() exceptions", () => {
    installFactory();
    instances.length = 0;
    __setAudioFactory(
      class Stub extends FakeAudio {
        constructor(src?: string) {
          super(src);
          this.playMode = "sync-throw";
          instances.push(this);
        }
      } as unknown as new (src?: string) => HTMLAudioElement,
    );

    expect(() => playNotificationSound("audio/finish.mp3")).not.toThrow();
  });

  test("separate sources get separate templates (+ a clone each)", () => {
    installFactory();
    playNotificationSound("audio/one.mp3");
    playNotificationSound("audio/two.mp3");

    // 2 templates + 2 clones = 4 instances.
    expect(instances.length).toBe(4);
    expect(instances.map((i) => i.src)).toEqual([
      "audio/one.mp3",
      "audio/one.mp3",
      "audio/two.mp3",
      "audio/two.mp3",
    ]);
  });

  test("enabled=false short-circuits before touching Audio", () => {
    installFactory();
    playNotificationSound("audio/finish.mp3", { enabled: false });

    // No template, no clone, no play call — the cue is fully silent.
    expect(instances.length).toBe(0);
  });

  test("volume is applied to the played clone, not the template", () => {
    installFactory();
    playNotificationSound("audio/finish.mp3", { volume: 0.25 });

    expect(instances.length).toBe(2);
    // Template stays at the default; only the clone carries the volume.
    expect((instances[0] as unknown as { volume: number }).volume).not.toBe(
      0.25,
    );
    expect((instances[1] as unknown as { volume: number }).volume).toBe(0.25);
    expect(instances[1]!.playCalls).toBe(1);
  });

  test("volume clamps out-of-range values", () => {
    installFactory();
    playNotificationSound("audio/finish.mp3", { volume: 2.5 });
    playNotificationSound("audio/finish.mp3", { volume: -0.5 });

    // Two clones — indexes 1 and 2.
    expect((instances[1] as unknown as { volume: number }).volume).toBe(1);
    expect((instances[2] as unknown as { volume: number }).volume).toBe(0);
  });
});
