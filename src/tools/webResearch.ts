import type { Tool, ToolContext, ToolResult } from "./types";
import { webSearchTool, webReadTool } from "./webSearch";

type SearchHit = { title: string; url: string; description?: string };

/** Search then read independent public sources as a single evidence-producing action. */
export const webResearchTool: Tool<{ query: string; maxSources?: number }> = {
  name: "web_research",
  description:
    "Perform multi-source public-web research without a search API key: find candidate pages, read up to three public sources through anonymous Jina Reader, and return evidence with source URLs. Prefer this for factual, current, comparative, or research-heavy tasks.",
  permission: "READ",
  inputSchema: { query: "string", maxSources: "number? (1-3, default 2)" },
  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const query = typeof input?.query === "string" ? input.query.trim().slice(0, 600) : "";
    if (!query) return { ok: false, output: null, summary: "Research query is empty", error: "invalid_query" };

    const searched = await webSearchTool.execute({ query }, ctx);
    if (!searched.ok) return searched;

    const hits = Array.isArray(searched.output) ? searched.output as SearchHit[] : [];
    const maxSources = Math.max(1, Math.min(3, Math.floor(Number(input.maxSources) || 2)));
    // Skip duplicate hosts where possible so the evidence is more independent.
    const selected: SearchHit[] = [];
    const hosts = new Set<string>();
    for (const hit of hits) {
      try {
        const host = new URL(hit.url).hostname.replace(/^www\./, "");
        if (hosts.has(host)) continue;
        hosts.add(host);
        selected.push(hit);
      } catch { /* ignore malformed search candidate */ }
      if (selected.length >= maxSources) break;
    }

    const pages = await Promise.all(selected.map(async (hit) => {
      const result = await webReadTool.execute({ url: hit.url }, ctx);
      if (!result.ok) return {
        title: hit.title,
        url: hit.url,
        ok: false,
        error: result.error ?? result.summary,
      };
      return {
        title: hit.title,
        url: hit.url,
        ok: true,
        text: String(result.output ?? "").slice(0, 7_000),
      };
    }));

    const readSources = pages.filter((page) => page.ok).map((page) => ({
      title: page.title,
      url: page.url,
      retrievedAt: Date.now(),
      excerpt: (typeof page.text === "string" ? page.text : "").slice(0, 500),
    }));
    const searchSources = Array.isArray(searched.sources) ? searched.sources.slice(0, maxSources) : [];
    // Prefer pages whose contents were actually read. Only fall back to
    // search-result links when every source reader was blocked/unavailable.
    const sources = readSources.length ? readSources : searchSources;
    const successfulReads = pages.filter((page) => page.ok).length;
    return {
      ok: true,
      output: { query, searchResults: hits.slice(0, 8), pages },
      summary: `Researched ${query.slice(0, 80)}; read ${successfulReads} of ${selected.length} independent sources`,
      sources,
    };
  },
};
