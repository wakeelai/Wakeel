import type { Tool, ToolContext, ToolResult } from "./types";
import { browserBrowseTool } from "./browserUse";

type SearchResult = { title: string; url: string; description: string };
const SEARCH_TIMEOUT_MS = 8_000;

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_match, number: string) => {
      const codePoint = Number(number);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint) : "";
    })
    .replace(/&#x([\da-f]+);/gi, (_match, number: string) => {
      const codePoint = parseInt(number, 16);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint) : "";
    });
}

function stripMarkup(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).trim();
}

function unwrapSearchUrl(raw: string): string | null {
  try {
    const candidate = new URL(decodeEntities(raw), "https://html.duckduckgo.com");
    if (candidate.hostname === "html.duckduckgo.com" || candidate.hostname === "duckduckgo.com") {
      const target = candidate.searchParams.get("uddg");
      if (target) return new URL(target).toString();
      return null;
    }
    if (candidate.protocol !== "https:" && candidate.protocol !== "http:") return null;
    if (candidate.username || candidate.password) return null;
    return candidate.toString();
  } catch {
    return null;
  }
}

/** Parse only the result-anchor elements, never arbitrary links on the page. */
export function parseDuckDuckGoResults(html: string, limit = 8): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  const boundedHtml = html.slice(0, 1_200_000);
  const anchorRe = /<a\b[^>]*>[\s\S]*?<\/a>/gi;
  for (const match of boundedHtml.matchAll(anchorRe)) {
    const anchor = match[0];
    const openEnd = anchor.indexOf(">");
    if (openEnd < 0) continue;
    const openTag = anchor.slice(0, openEnd + 1);
    if (!/class\s*=\s*["'][^"']*\bresult__a\b/i.test(openTag)) continue;
    const href = openTag.match(/href\s*=\s*(["'])(.*?)\1/i)?.[2];
    const title = stripMarkup(anchor.slice(openEnd + 1, anchor.toLowerCase().lastIndexOf("</a>")));
    const url = href ? unwrapSearchUrl(href) : null;
    if (!url || !title || seen.has(url)) continue;
    seen.add(url);
    results.push({ title: title.slice(0, 200), url, description: "DuckDuckGo public search result" });
    if (results.length >= limit) break;
  }
  return results;
}

function asSearchToolResult(results: SearchResult[], method: string): ToolResult {
  return {
    ok: true,
    output: results,
    summary: `Found ${results.length} candidate sources via ${method}`,
    sources: results.map((result) => ({
      title: result.title,
      url: result.url,
      retrievedAt: Date.now(),
      excerpt: result.description,
    })),
  };
}

async function searchWithoutBrowser(query: string): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: { Accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!response.ok) return [];
  return parseDuckDuckGoResults(await response.text());
}

export const webSearchTool: Tool<{ query: string }> = {
  name: "web_search",
  description:
    "Search the public web without an API key. First parses DuckDuckGo's public HTML page (no browser minutes); falls back to the capped Cloudflare Browser Run binding if HTML results are unavailable.",
  permission: "READ",
  inputSchema: { query: "string" },
  async execute(input, ctx): Promise<ToolResult> {
    const query = typeof input?.query === "string" ? input.query.trim().slice(0, 600) : "";
    if (!query) return { ok: false, output: null, summary: "Search query is empty", error: "invalid_query" };

    try {
      const directResults = await searchWithoutBrowser(query);
      if (directResults.length) return asSearchToolResult(directResults, "public HTML");
    } catch {
      // DuckDuckGo sometimes challenges non-browser clients. Try the same
      // public results page with the configured browser; don't bypass CAPTCHA.
    }

    const page = await browserBrowseTool.execute(
      { url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}` },
      ctx,
    );
    if (!page.ok) {
      return {
        ...page,
        summary: page.error === "browser_binding_missing"
          ? "Direct public search was unavailable and Cloudflare Browser Run is not configured"
          : page.summary,
      };
    }
    const links = ((page.output as { links?: { title: string; url: string }[] }).links ?? []);
    const results = links.flatMap((link) => {
      const url = unwrapSearchUrl(link.url);
      return url && link.title.trim()
        ? [{ title: link.title.trim().slice(0, 200), url, description: "DuckDuckGo public browser result" }]
        : [];
    }).filter((item, index, all) => all.findIndex((candidate) => candidate.url === item.url) === index).slice(0, 8);
    return asSearchToolResult(results, "browser fallback");
  },
};

function safePublicUrl(raw: string): URL {
  const url = new URL(raw);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
    throw new Error("Only public http(s) URLs without embedded credentials are allowed");
  }
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
      host.endsWith(".internal") || host === "metadata.google.internal") {
    throw new Error("Private or local URLs are not allowed");
  }
  // Block direct IP literals. The Reader is a remote service, but rejecting
  // literals and private ranges avoids forwarding sensitive local targets.
  if (host.includes(":") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    const octets = host.split(".").map(Number);
    if (octets.length === 4 && octets.every((part) => part >= 0 && part <= 255)) {
      const [a, b] = octets as [number, number, number, number];
      if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
          (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
          (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19))) {
        throw new Error("Private or reserved IP URLs are not allowed");
      }
    }
    throw new Error("IP-literal URLs are not allowed");
  }
  return url;
}

export const webReadTool: Tool<{ url: string }> = {
  name: "web_read",
  description:
    "Fetch a specific public URL and convert it into clean, LLM-friendly text via anonymous Jina Reader. Respects blocked/rate-limited sites and rejects local/private URLs.",
  permission: "READ",
  inputSchema: { url: "public http(s) URL" },
  async execute(input, _ctx): Promise<ToolResult> {
    let target: URL;
    try {
      target = safePublicUrl(input.url);
    } catch (error) {
      return { ok: false, output: null, summary: "Only public URLs can be read", error: String(error) };
    }

    let res: Response;
    try {
      res = await fetch(`https://r.jina.ai/${target.toString()}`, { signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      return { ok: false, output: null, summary: "Could not reach source", error: String(e) };
    }

    if (res.status === 403 || res.status === 451 || res.status === 429) {
      // Site blocks access / rate-limits us — respect it, do not bypass it.
      return { ok: false, output: null, summary: "Source blocks automated access — skipping", error: `blocked_${res.status}` };
    }
    if (!res.ok) {
      return { ok: false, output: null, summary: `Read failed (HTTP ${res.status})`, error: `http_${res.status}` };
    }

    const trimmed = (await res.text()).slice(0, 20_000);
    return {
      ok: true,
      output: trimmed,
      summary: `Read ${trimmed.length.toLocaleString()} chars from ${target.hostname}`,
      sources: [{ url: target.toString(), retrievedAt: Date.now(), excerpt: trimmed.slice(0, 500) }],
    };
  },
};
