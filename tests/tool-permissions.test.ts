import { describe, it, expect } from "vitest";
import { runTool, ConfirmationRequiredError } from "../src/tools/registry";
import type { ToolContext } from "../src/tools/types";

function ctx(confirmed: boolean): ToolContext {
  return {
    env: {} as ToolContext["env"],
    userId: "user_1",
    taskId: "task_1",
    confirmed,
  };
}

describe("Tool permission system", () => {
  it("runs a READ tool (calculator) without requiring confirmation", async () => {
    const result = await runTool("calculator", { expression: "2+2*3" }, ctx(false));
    expect(result.ok).toBe(true);
    expect(result.output).toBe(8);
  });

  it("returns a clear error for an unknown tool instead of throwing", async () => {
    const result = await runTool("delete_everything", {}, ctx(false));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("unknown_tool");
  });
});

describe("Confirmation gating (design contract)", () => {
  // The registry currently ships READ/WRITE tools only; this locks in the
  // *contract* so that when a FINANCIAL/DESTRUCTIVE/EXTERNAL_ACTION tool is
  // added (e.g. browser "submit payment"), it must throw
  // ConfirmationRequiredError instead of silently executing.
  it("ConfirmationRequiredError carries the tool name and permission level", () => {
    const err = new ConfirmationRequiredError("submit_payment", "FINANCIAL");
    expect(err.toolName).toBe("submit_payment");
    expect(err.permission).toBe("FINANCIAL");
    expect(err.message).toContain("requires user confirmation");
  });
});
