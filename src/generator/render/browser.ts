/**
 * src/generator/render/browser.ts — one shared headless Chrome for a render.
 *
 * Every selectComposition / renderMedia call gets this browser as its
 * puppeteerInstance, so Chrome starts once instead of once per chunk. With a
 * shared browser renderMedia ignores its own chromiumOptions, so the GL
 * backend is set here: "angle" is required for the post-processing look.
 * The browser is recycled every RECYCLE_EVERY uses (ANGLE leaks GPU memory
 * over long sessions).
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { ensureBrowser, openBrowser, type HeadlessBrowser } from "@remotion/renderer";

export const GL = "angle" as const;
const RECYCLE_EVERY = 4;

let ensured: Promise<unknown> | null = null;

/** The Chrome build Remotion downloaded (part of the cache key). */
export function chromeVersion(root = process.cwd()): string {
  const file = join(root, "node_modules", ".remotion", "chrome-headless-shell", "VERSION");
  try {
    return existsSync(file) ? readFileSync(file, "utf8").trim() : "unknown";
  } catch {
    return "unknown";
  }
}

export class BrowserPool {
  private browser: HeadlessBrowser | null = null;
  private uses = 0;

  /** The browser for the next call; reopened after RECYCLE_EVERY uses. */
  async get(): Promise<HeadlessBrowser> {
    if (this.browser && this.uses >= RECYCLE_EVERY) await this.close();
    if (!this.browser) {
      ensured ??= ensureBrowser();
      await ensured;
      this.browser = await openBrowser("chrome", { chromiumOptions: { gl: GL }, logLevel: "warn" });
      this.uses = 0;
    }
    this.uses++;
    return this.browser;
  }

  async close(): Promise<void> {
    const b = this.browser;
    this.browser = null;
    this.uses = 0;
    if (b) {
      try {
        await b.close({ silent: true });
      } catch {
        /* already gone */
      }
    }
  }
}
