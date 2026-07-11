import { chromium, type Browser, type Page } from "playwright-core";

/**
 * Connects to the USER'S OWN running Chrome via CDP. This server never
 * launches a hidden browser, never bypasses bot protection, and never runs
 * without the user having started Chrome themselves:
 *
 *   chrome --remote-debugging-port=9222
 *
 * That is the entire trust model: real browser, real session, user's IP.
 */
const CDP_URL = process.env.COUPANG_CDP_URL ?? "http://localhost:9222";

let browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    try {
      browser = await chromium.connectOverCDP(CDP_URL, { timeout: 10_000 });
    } catch (e) {
      throw new Error(
        `Chrome CDP(${CDP_URL})에 연결할 수 없습니다. 크롬을 디버그 모드로 실행하세요:\n` +
          `  macOS: /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222\n` +
          `(기존 크롬을 완전히 종료한 뒤 실행해야 합니다)\n` +
          `원인: ${(e as Error).message.split("\n")[0]}`,
        { cause: e },
      );
    }
  }
  return browser;
}

let worker: Page | null = null;
let queue: Promise<unknown> = Promise.resolve();

/**
 * Reuses ONE long-lived tab for every call instead of opening a new one.
 *
 * Opening a tab makes macOS un-hide Chrome, so a hidden helper browser would
 * pop a window on every tool call; navigating an existing tab does not. The
 * tab is therefore kept and reused, and calls are serialized so they never
 * fight over it.
 */
async function acquirePage(): Promise<Page> {
  const b = await getBrowser();
  const ctx = b.contexts()[0] ?? (await b.newContext());
  if (!worker || worker.isClosed()) {
    worker = ctx.pages().find((p) => !p.isClosed()) ?? (await ctx.newPage());
    // tsx/esbuild "keepNames" injects a __name helper into serialized
    // page.evaluate callbacks; define it so dev-mode (tsx) evaluate works.
    await worker.addInitScript("window.__name = window.__name || ((f) => f);").catch(() => {});
  }
  await worker.evaluate("window.__name = window.__name || ((f) => f);").catch(() => {});
  return worker;
}

export async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const page = await acquirePage();
    try {
      return await fn(page);
    } finally {
      // Drop the heavy page but keep the tab (and the hidden window) alive.
      await page.goto("about:blank").catch(() => {});
    }
  });
  queue = run.catch(() => {});
  return run;
}
