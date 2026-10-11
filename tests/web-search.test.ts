import { describe, expect, it } from "vitest";
import { parseDuckDuckGoResults } from "../src/tools/webSearch";

describe("public HTML search parser", () => {
  it("extracts and unwraps DuckDuckGo result links, decodes titles, and de-duplicates", () => {
    const html = `
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fguide&amp;rut=abc">A &amp; B &lt;Guide&gt;</a>
      <a class="result__a" href="https://example.org/start"><b>Second</b> source</a>
      <a class="result__a" href="https://example.org/start">Duplicate link</a>
      <a class="other-link" href="https://ignored.example">Ignore navigation</a>`;

    expect(parseDuckDuckGoResults(html)).toEqual([
      { title: "A & B <Guide>", url: "https://example.com/guide", description: "DuckDuckGo public search result" },
      { title: "Second source", url: "https://example.org/start", description: "DuckDuckGo public search result" },
    ]);
  });

  it("does not return DuckDuckGo navigation links or unsafe schemes", () => {
    const html = `
      <a class="result__a" href="javascript:alert(1)">unsafe</a>
      <a class="result__a" href="https://duckduckgo.com/settings">settings</a>`;
    expect(parseDuckDuckGoResults(html)).toEqual([]);
  });
});
