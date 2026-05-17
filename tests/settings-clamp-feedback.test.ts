// P7 S21 / Cluster B — aria-invalid feedback on number inputs that
// silently clamp.
//
// `validateSettings()` clamps out-of-range numeric input — fontSize
// > 32, paneGap < 0, scrollbackLines = 99 — without any user feedback.
// The user's typed value just doesn't survive a refresh. This test
// pins the new `bindClampFeedback()` helper which flags the input via
// `aria-invalid` + stamps an `aria-live="polite"` message so screen
// readers announce the clamp and sighted users see a red border.
//
// happy-dom drives the test; no real settings-panel render needed —
// we test the helper in isolation against a synthetic <input>.

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

beforeAll(() => GlobalRegistrator.register());
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

async function loadHelper() {
  return (await import("../src/views/terminal/settings-panel"))
    .bindClampFeedback;
}

function setup() {
  document.body.innerHTML = "";
  const row = document.createElement("div");
  const input = document.createElement("input");
  input.type = "number";
  row.appendChild(input);
  document.body.appendChild(row);
  return { row, input };
}

function fireInput(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("bindClampFeedback — aria-invalid + aria-live announcement", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("flags aria-invalid + announces when input is below min", async () => {
    const bind = await loadHelper();
    const { row, input } = setup();
    bind(input, 100, 100000, row);

    fireInput(input, "5");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const msg = row.querySelector(".settings-input-error");
    expect(msg).not.toBeNull();
    expect(msg!.getAttribute("aria-live")).toBe("polite");
    expect(msg!.textContent).toContain("below minimum");
    expect(msg!.textContent).toContain("100");
  });

  test("flags aria-invalid + announces when input is above max", async () => {
    const bind = await loadHelper();
    const { row, input } = setup();
    bind(input, 8, 32, row);

    fireInput(input, "999");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const msg = row.querySelector(".settings-input-error");
    expect(msg!.textContent).toContain("above maximum");
    expect(msg!.textContent).toContain("32");
  });

  test("clears aria-invalid + clears message when input returns to range", async () => {
    const bind = await loadHelper();
    const { row, input } = setup();
    bind(input, 0, 100, row);

    fireInput(input, "9999");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    fireInput(input, "50");
    expect(input.getAttribute("aria-invalid")).toBe(null);
    expect(row.querySelector(".settings-input-error")!.textContent).toBe("");
  });

  test("treats empty / NaN input as not-yet-typed (no aria-invalid)", async () => {
    const bind = await loadHelper();
    const { row, input } = setup();
    bind(input, 0, 100, row);

    fireInput(input, "");
    expect(input.getAttribute("aria-invalid")).toBe(null);
    expect(row.querySelector(".settings-input-error")!.textContent).toBe("");
  });

  test("each binding stamps a unique aria-errormessage id", async () => {
    const bind = await loadHelper();
    document.body.innerHTML = "";
    const rowA = document.createElement("div");
    const inputA = document.createElement("input");
    inputA.type = "number";
    rowA.appendChild(inputA);
    document.body.appendChild(rowA);
    const rowB = document.createElement("div");
    const inputB = document.createElement("input");
    inputB.type = "number";
    rowB.appendChild(inputB);
    document.body.appendChild(rowB);
    bind(inputA, 0, 10, rowA);
    bind(inputB, 0, 10, rowB);

    const idA = inputA.getAttribute("aria-errormessage");
    const idB = inputB.getAttribute("aria-errormessage");
    expect(idA).not.toBeNull();
    expect(idB).not.toBeNull();
    expect(idA).not.toBe(idB);
    expect(document.getElementById(idA!)).not.toBeNull();
    expect(document.getElementById(idB!)).not.toBeNull();
  });

  test("flags an initial out-of-range value at bind time (no input event needed)", async () => {
    const bind = await loadHelper();
    const { row, input } = setup();
    input.value = "200"; // out of range before bind
    bind(input, 0, 100, row);
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });
});
