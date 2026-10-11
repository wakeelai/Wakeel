import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "node_modules/pyodide");
const target = resolve(root, "dist/pyodide");
await mkdir(target, { recursive: true });
for (const file of ["pyodide.js", "pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"]) {
  await cp(resolve(source, file), resolve(target, file));
}
console.log("Bundled local Pyodide runtime into web/dist/pyodide");
