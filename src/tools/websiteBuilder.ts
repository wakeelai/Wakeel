import type { Tool, ToolResult } from "./types";
import { newId } from "../lib/db";
import { D1ObjectStore } from "../lib/objectStore";
import { ObjectStorageQuotaError } from "../lib/objectStore";
import { routeCompletion, AllProvidersExhaustedError } from "../providers/router";

const SYSTEM =
  "You are a senior front-end engineer. Output ONE complete, self-contained HTML document: inline CSS, optional inline JS, " +
  "no external network resources and no external images (use CSS gradients / inline SVG). Responsive, accessible, modern design. " +
  "Respond with ONLY the HTML — no markdown fences, no commentary.";

/** Pulls the HTML document out of a model reply that may include fences or chatter. */
export function extractHtml(text: string): string | null {
  const cleaned = text.replace(/```(?:html)?/gi, "");
  const start = cleaned.search(/<!doctype html|<html[\s>]/i);
  if (start === -1) return null;
  const end = cleaned.toLowerCase().lastIndexOf("</html>");
  return (end === -1 ? cleaned.slice(start) : cleaned.slice(start, end + 7)).trim();
}

export const websiteBuilderTool: Tool<{ brief: string; previousHtml?: string }> = {
  name: "website_builder",
  description:
    "Generate (or revise) a complete single-file HTML website from a brief. The result is previewable live in the workspace.",
  permission: "WRITE",
  inputSchema: { brief: "string", previousHtml: "string?" },
  async execute(input, ctx): Promise<ToolResult> {
    const user = input.previousHtml
      ? `Revise this website according to the request.\n\nRequest: ${input.brief}\n\nCurrent HTML:\n${input.previousHtml.slice(0, 12000)}`
      : `Build a website: ${input.brief}`;

    let text: string;
    try {
      ({ text } = await routeCompletion(ctx.env, ctx.userId, {
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }],
        maxTokens: 3500,
        temperature: 0.5,
      }));
    } catch (e) {
      if (e instanceof AllProvidersExhaustedError) {
        return { ok: false, output: null, summary: "Free AI quota exhausted", error: "providers_exhausted" };
      }
      throw e;
    }

    const html = extractHtml(text);
    if (!html) return { ok: false, output: null, summary: "Model did not return a valid HTML page", error: "no_html" };

    const key = `users/${ctx.userId}/tasks/${ctx.taskId}/${newId()}-index.html`;
    try {
      await new D1ObjectStore(ctx.env.DB).put(key, html, { httpMetadata: { contentType: "text/html" } });
    } catch (error) {
      if (error instanceof ObjectStorageQuotaError) return { ok: false, output: null, summary: error.message, error: "storage_quota" };
      throw error;
    }
    return {
      ok: true,
      output: { key },
      summary: `Built a website (${Math.round(html.length / 1024)} KB)`,
      artifact: { type: "website", title: "index.html", content: html, mime: "text/html" },
    };
  },
};
