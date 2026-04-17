/** Polling primitives used throughout the native e2e suite. */

export interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
  message?: string;
}

/** Poll `fn` until it returns a truthy value or times out. Returns the first
 *  truthy value. Throws with `opts.message` (or a default) on timeout. */
export async function waitFor<T>(
  fn: () => Promise<T | undefined | null> | T | undefined | null,
  opts: WaitOptions = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const intervalMs = opts.intervalMs ?? 100;
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (err) {
      lastErr = err;
    }
    await sleep(intervalMs);
  }
  const msg = opts.message ?? "waitFor timed out";
  throw new Error(lastErr ? `${msg}: ${stringifyError(lastErr)}` : msg);
}

/** Repeatedly run `predicate` until it returns true. Throws on timeout. */
export async function waitUntil(
  predicate: () => Promise<boolean> | boolean,
  opts: WaitOptions = {},
): Promise<void> {
  await waitFor(async () => ((await predicate()) ? true : undefined), opts);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
