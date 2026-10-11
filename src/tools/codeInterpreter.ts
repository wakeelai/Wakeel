import type { Tool, ToolResult } from "./types";

export interface PythonInterpreterInput {
  code: string;
  language?: "python";
}

/** Execution is handled by the authenticated user's dedicated browser Web Worker, never by the Worker server. */
export const codeInterpreterTool: Tool<PythonInterpreterInput> = {
  name: "code_interpreter",
  description: "Run Python 3 code in a disposable, isolated Pyodide Web Worker in the user's browser. Use for data analysis, calculations, tables, and charts (matplotlib is not preinstalled). Return concise stdout and variables/results.",
  permission: "READ",
  clientOnly: true,
  inputSchema: { language: "python", code: "Python 3 source code (max 20 KB)" },
  async execute(): Promise<ToolResult> {
    return { ok: false, output: null, summary: "Python runs in the browser interpreter", error: "client_only_tool" };
  },
};
