import type { Tool, ToolResult } from "./types";

/** Tiny safe arithmetic evaluator: numbers, + - * / % ^ ( ) only. No eval(). */
function safeEval(expr: string): number {
  const cleaned = expr.replace(/\s+/g, "");
  if (!/^[0-9+\-*/%^().]+$/.test(cleaned)) {
    throw new Error("Expression contains disallowed characters");
  }

  const tokens = cleaned.match(/(\d+\.?\d*|[+\-*/%^()])/g);
  if (!tokens) throw new Error("Could not parse expression");

  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpr(): number {
    let value = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const rhs = parseTerm();
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  }
  function parseTerm(): number {
    let value = parseFactor();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = next();
      const rhs = parseFactor();
      value = op === "*" ? value * rhs : op === "/" ? value / rhs : value % rhs;
    }
    return value;
  }
  function parseFactor(): number {
    let value = parseAtom();
    while (peek() === "^") {
      next();
      value = Math.pow(value, parseAtom());
    }
    return value;
  }
  function parseAtom(): number {
    if (peek() === "(") {
      next();
      const value = parseExpr();
      if (peek() !== ")") throw new Error("Mismatched parentheses");
      next();
      return value;
    }
    if (peek() === "-") {
      next();
      return -parseAtom();
    }
    const tok = next();
    const n = Number(tok);
    if (Number.isNaN(n)) throw new Error(`Unexpected token: ${tok}`);
    return n;
  }

  const result = parseExpr();
  if (pos !== tokens.length) throw new Error("Unexpected trailing input");
  return result;
}

export const calculatorTool = {
  name: "calculator",
  description: "Evaluate a plain arithmetic expression (+, -, *, /, %, ^, parentheses).",
  permission: "READ",
  inputSchema: { expression: "string" },
  async execute(input: { expression: string }): Promise<ToolResult> {
    try {
      const value = safeEval(input.expression);
      return { ok: true, output: value, summary: `${input.expression} = ${value}` };
    } catch (e) {
      return { ok: false, output: null, summary: "Could not evaluate expression", error: String(e) };
    }
  },
} satisfies Tool<{ expression: string }>;
