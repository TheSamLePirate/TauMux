import { afterEach, describe, expect, test } from "bun:test";
import { __setAudioFactory, playNotificationSound } from "../src/shared/sounds";

// Minimal fake HTMLAudioElement. The helper only touches `preload`,
// `currentTime`, and `play()` — enough to assert behaviour without
// dragging in happy-dom.
class FakeAudio {
  public src: string;
  public preload: string = "";
  public currentTime: number = 0;
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

  test("constructs an Audio for the given src and plays it", () => {
    installFactory();
    playNotificationSound("audio/finish.mp3");

    expect(instances.length).toBe(1);
    expect(instances[0]!.src).toBe("audio/finish.mp3");
    expect(instances[0]!.preload).toBe("auto");
    expect(instances[0]!.playCalls).toBe(1);
  });

  test("caches the Audio element across calls with the same src", () => {
    installFactory();
    playNotificationSound("audio/finish.mp3");
    playNotificationSound("audio/finish.mp3");
    playNotificationSound("audio/finish.mp3");

    expect(instances.length).toBe(1);
    expect(instances[0]!.playCalls).toBe(3);
  });

  test("resets currentTime before each replay so the cue doesn't drift", () => {
    installFactory();
    playNotificationSound("audio/finish.mp3");
    instances[0]!.currentTime = 2.5; // simulate playback progress

    playNotificationSound("audio/finish.mp3");

    expect(instances[0]!.currentTime).toBe(0);
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

  test("separate sources get separate Audio elements", () => {
    installFactory();
    playNotificationSound("audio/one.mp3");
    playNotificationSound("audio/two.mp3");

    expect(instances.length).toBe(2);
    expect(instances.map((i) => i.src)).toEqual([
      "audio/one.mp3",
      "audio/two.mp3",
    ]);
  });
});
