import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/types";
import type { PlanStep } from "../src/agent/types";

const routeCompletionMock = vi.hoisted(() => vi.fn());
vi.mock("../src/providers/router", () => ({ routeCompletion: routeCompletionMock }));
import { replanAfterFailure } from "../src/agent/replanner";

describe("bounded evidence-aware re-planning", () => {
  beforeEach(() => routeCompletionMock.mockReset());

  it("drops unknown/invalid tools and the identical failed action even with reordered JSON keys", async () => {
    routeCompletionMock.mockResolvedValue({
      text: JSON.stringify({ steps: [
        { phase: "reading", title: "Repeat failed", tool: "browser_browse", toolInput: { actions: [{ type: "wait", milliseconds: 500 }], url: "https://example.com" } },
        { phase: "reading", title: "Try a different public page", tool: "browser_browse", toolInput: { url: "https://example.org" } },
        { phase: "reading", title: "Unknown", tool: "run_shell", toolInput: {} },
        { phase: "reading", title: "Bad Python", tool: "code_interpreter", toolInput: { code: "x".repeat(20_001) } },
        { phase: "not-a-phase", title: "Bad phase", tool: "calculator", toolInput: { expression: "1+1" } },
      ] }),
    });
    const failed: PlanStep = { phase: "reading", title: "Read page", description: "Read it", tool: "browser_browse", toolInput: { url: "https://example.com", actions: [{ type: "wait", milliseconds: 500 }] } };

    const result = await replanAfterFailure({} as Env, "user-1", "Summarize this site", failed, "timeout", ["Page was slow"], []);
    expect(result).toHaveLength(1);
    expect(result[0]!.toolInput).toEqual({ url: "https://example.org" });
    const request = routeCompletionMock.mock.calls[0]?.[2] as { messages: { content: string }[] };
    const prompt = String(request.messages[1]?.content);
    expect(prompt).toContain("Page was slow");
    expect(prompt).toContain("timeout");
  });

  it("allows a new reasoning step after a failed tool-less synthesis step", async () => {
    routeCompletionMock.mockResolvedValue({
      text: JSON.stringify({ steps: [{ phase: "analyzing", title: "Synthesize using new evidence", tool: null }] }),
    });
    const failed: PlanStep = { phase: "analyzing", title: "Draft", description: "Synthesize", tool: null };
    const result = await replanAfterFailure({} as Env, "user-1", "Explain", failed, "temporary model error", ["Evidence"], []);
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("Synthesize using new evidence");
  });

});

describe("adaptive plan review", () => {
  beforeEach(() => routeCompletionMock.mockReset());

  it("keeps the remaining plan when the controller chooses continue", async () => {
    routeCompletionMock.mockResolvedValue({ text: JSON.stringify({ decision: "continue", reason: "Evidence is sufficient", steps: [] }) });
    const result = await (await import("../src/agent/replanner")).adaptPlanAfterObservation(
      {} as Env,
      "user-1",
      "Compare two browsers",
      ["Search returned three relevant pages"],
      [{ phase: "searching", title: "Search", description: "Find sources", tool: "web_search", toolInput: { query: "browsers" } }],
      [{ phase: "reading", title: "Read source", description: "Read the article", tool: "web_read", toolInput: { url: "https://example.com" } }],
      3,
    );
    expect(result?.decision).toBe("continue");
    expect(result?.steps).toEqual([]);
  });

  it("filters completed duplicate actions and ensures a final synthesis step", async () => {
    routeCompletionMock.mockResolvedValue({
      text: JSON.stringify({
        decision: "replace",
        reason: "Read a primary source instead",
        steps: [
          { phase: "searching", title: "Repeat completed search", description: "Same work", tool: "web_search", toolInput: { query: "browsers" } },
          { phase: "reading", title: "Read primary source", description: "Collect details", tool: "web_read", toolInput: { url: "https://example.org/research" } },
        ],
      }),
    });
    const result = await (await import("../src/agent/replanner")).adaptPlanAfterObservation(
      {} as Env,
      "user-1",
      "Compare two browsers",
      ["Search result page points to a primary source"],
      [{ phase: "searching", title: "Search", description: "Find sources", tool: "web_search", toolInput: { query: "browsers" } }],
      [{ phase: "analyzing", title: "Old plan", description: "Analyze", tool: null }],
      3,
    );
    expect(result?.decision).toBe("replace");
    expect(result?.steps.map((step) => step.tool)).toEqual(["web_read", null]);
    expect(result?.steps.at(-1)?.title).toContain("Synthesize");
  });
});
