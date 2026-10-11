import type { Tool, ToolContext, ToolResult } from "./types";
import { REQUIRES_CONFIRMATION } from "./types";
import { webSearchTool, webReadTool } from "./webSearch";
import { webResearchTool } from "./webResearch";
import { calculatorTool } from "./calculator";
import { fileWriteTool, fileReadTool } from "./fileTools";
import { websiteBuilderTool } from "./websiteBuilder";
import { browserBrowseTool, browserInteractTool } from "./browserUse";
import { codeInterpreterTool } from "./codeInterpreter";

const TOOLS: Tool<any>[] = [webResearchTool, webSearchTool, webReadTool, calculatorTool, fileWriteTool, fileReadTool, websiteBuilderTool, browserBrowseTool, browserInteractTool, codeInterpreterTool];

/** Plugin entry point: register an additional tool (e.g. the Browser Use adapter). */
export function registerTool(tool: Tool<any>): void {
  if (!TOOLS.some((t) => t.name === tool.name)) TOOLS.push(tool);
}

export function getTool(name: string): Tool<any> | undefined {
  return TOOLS.find((t) => t.name === name);
}

export function listTools(): Tool<any>[] {
  return TOOLS;
}

export class ConfirmationRequiredError extends Error {
  constructor(public toolName: string, public permission: string) {
    super(`Tool "${toolName}" (${permission}) requires user confirmation before running.`);
  }
}

/** Central choke point: every tool call in the app goes through here. */
export async function runTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tool = getTool(name);
  if (!tool) {
    return { ok: false, output: null, summary: `Unknown tool: ${name}`, error: "unknown_tool" };
  }

  if (REQUIRES_CONFIRMATION.includes(tool.permission) && !ctx.confirmed) {
    throw new ConfirmationRequiredError(name, tool.permission);
  }

  try {
    return await tool.execute(input, ctx);
  } catch (e) {
    return { ok: false, output: null, summary: `${name} failed`, error: String(e) };
  }
}
