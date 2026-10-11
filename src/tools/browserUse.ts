import puppeteer from "@cloudflare/puppeteer";
import type { Tool, ToolContext, ToolResult } from "./types";
import { Db } from "../lib/db";
import { reserveBrowserRun, settleBrowserRun } from "../lib/browserBudget";

type BrowserAction =
  | { type: "follow_link"; selector: string }
  | { type: "scroll"; direction: "up" | "down"; pixels?: number }
  | { type: "wait"; milliseconds?: number }
  | { type: "read"; selector?: string };
const MAX_BROWSER_MS = 25_000;
const MAX_TEXT = 15_000;

function publicUrl(raw: string): URL {
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  const ipLiteral = /^[\d.]+$/.test(host) || host.includes(":");
  const blocked = host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
    host.endsWith(".internal") || host === "metadata.google.internal" || host === "169.254.169.254" ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === "[::1]" || ipLiteral;
  if (!/^https?:$/.test(url.protocol) || blocked) throw new Error("Only public http(s) URLs are allowed");
  return url;
}

async function runBrowser(input: { url: string; actions?: BrowserAction[] }, ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.env.BROWSER) {
    return { ok: false, output: null, summary: "Cloudflare Browser Run is not configured", error: "browser_binding_missing" };
  }
  const start = Date.now();
  let leaseId: string | null = null;
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  try {
    const firstUrl = publicUrl(input.url);
    const cap = Math.min(20, Number(ctx.env.MAX_BROWSER_TASKS_PER_DAY) || 20);
    leaseId = await reserveBrowserRun(new Db(ctx.env.DB), cap);
    if (!leaseId) {
      return { ok: false, output: null, summary: "The free browser daily budget is exhausted", error: "browser_daily_limit" };
    }
    browser = await puppeteer.launch(ctx.env.BROWSER as never);
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(12_000);
    page.setDefaultTimeout(4_000);
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      try { publicUrl(request.url()); void request.continue().catch(() => undefined); }
      catch { void request.abort("blockedbyclient").catch(() => undefined); }
    });
    await page.goto(firstUrl.toString(), { waitUntil: "domcontentloaded", timeout: 12_000 });
    for (const action of (input.actions ?? []).slice(0, 4)) {
      if (Date.now() - start > MAX_BROWSER_MS) throw new Error("Browser task exceeded its 25-second safety budget");
      if (action.type === "read") continue;
      if (action.type === "wait") await new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, Math.min(action.milliseconds ?? 500, 2_000))));
      if (action.type === "scroll") await page.evaluate((pixels) => (globalThis as unknown as { scrollBy(x: number, y: number): void }).scrollBy(0, pixels), action.direction === "down" ? Math.min(action.pixels ?? 600, 1200) : -Math.min(action.pixels ?? 600, 1200));
      if (action.type === "follow_link") {
        const rawTarget = await page.$eval(action.selector, (el) => {
          if (el.tagName.toLowerCase() !== "a") throw new Error("Only anchor links can be followed.");
          return el.getAttribute("href") ?? "";
        });
        const target = publicUrl(new URL(rawTarget, page.url()).toString());
        await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: 12_000 });
      }
    }
    const selector = input.actions?.find((a): a is Extract<BrowserAction, { type: "read" }> => a.type === "read")?.selector;
    const text = await page.$eval(selector ?? "body", (el) => el.textContent ?? "");
    const title = await page.title();
    const finalUrl = page.url();
    const rawLinks = await page.$$eval("a[href]", (anchors) => anchors.map((a) => ({
      title: (a.textContent ?? "").trim().slice(0, 200), href: a.getAttribute("href") ?? "",
    })).filter((a) => a.href && a.title).slice(0, 30));
    const links = rawLinks.flatMap((link) => {
      try { const url = new URL(link.href, finalUrl).toString(); return /^https?:/.test(url) ? [{ title: link.title, url }] : []; }
      catch { return []; }
    });
    return {
      ok: true,
      output: { title, url: finalUrl, text: text.slice(0, MAX_TEXT), links },
      summary: `Browser read ${text.slice(0, MAX_TEXT).length.toLocaleString()} characters from ${new URL(finalUrl).hostname}`,
      sources: [{ title, url: finalUrl, retrievedAt: Date.now(), excerpt: text.slice(0, 500) }],
    };
  } catch (e) {
    return { ok: false, output: null, summary: "Browser task failed", error: String(e).slice(0, 300) };
  } finally {
    await browser?.close().catch(() => undefined);
    if (leaseId) await settleBrowserRun(new Db(ctx.env.DB), leaseId, Math.min(Date.now() - start, MAX_BROWSER_MS)).catch(() => undefined);
  }
}

export const browserBrowseTool: Tool<{ url: string; actions?: BrowserAction[] }> = {
  name: "browser_browse",
  description: "Use a real headless browser to navigate a public website, wait/scroll, and read dynamically rendered page text. Do not submit forms or perform external actions.",
  permission: "READ",
  inputSchema: { url: "public http(s) URL", actions: "array of read/scroll/wait actions" },
  execute: runBrowser,
};

export const browserInteractTool: Tool<{ url: string; actions: BrowserAction[] }> = {
  name: "browser_interact",
  description: "Use a real browser to follow a selected public-page anchor link; form submissions, clicks, typing and keypresses are deliberately unavailable.",
  permission: "READ",
  inputSchema: { url: "public http(s) URL", actions: "array of follow_link/scroll/wait/read actions only" },
  execute: runBrowser,
};
