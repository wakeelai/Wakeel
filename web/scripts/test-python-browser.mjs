import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dist = resolve(root, "dist");
const chromium = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
const workerName = (await readdir(resolve(dist, "assets"))).find((name) => /^python\.worker-.*\.js$/.test(name));
if (!workerName) throw new Error("Built Python worker missing. Run `npm run build` first.");
for (const name of ["pyodide.js", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"]) {
  try { await readFile(resolve(dist, "pyodide", name)); }
  catch { throw new Error(`Built Pyodide asset missing: dist/pyodide/${name}`); }
}

const html = `<!doctype html><meta charset="utf-8"><body><pre id="result">RUNNING</pre><script>
const worker = new Worker("/assets/${workerName}");
const result = document.querySelector("#result");
const messages = [];
const timer = setTimeout(() => { result.textContent = "FAIL: timed out; " + messages.join(" | "); worker.terminate(); }, 30000);
worker.onerror = (e) => { clearTimeout(timer); result.textContent = "FAIL: worker error " + e.message; };
worker.onmessage = (e) => {
  if (e.data.type === "stdout" || e.data.type === "stderr") messages.push(e.data.text || "");
  if (e.data.type === "error") { clearTimeout(timer); result.textContent = "FAIL: " + e.data.error; worker.terminate(); }
  if (e.data.type === "done") { clearTimeout(timer); result.textContent = messages.join("").includes("42") ? "PASS:42" : "FAIL: output=" + messages.join("") + " result=" + e.data.result; worker.terminate(); }
};
worker.postMessage({ id: "acceptance-1", code: "print(sum([10, 20, 12]))" });
</script>`;

const mime = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".zip": "application/zip", ".json": "application/json" };
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url ?? "/", `http://${req.headers.host}`).pathname;
    if (pathname === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(html); return; }
    const file = resolve(dist, `.${decodeURIComponent(pathname)}`);
    if (!file.startsWith(`${dist}/`)) { res.writeHead(403); res.end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(data);
  } catch { res.writeHead(404); res.end("Not found"); }
});

await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const address = server.address();
const url = `http://127.0.0.1:${address.port}/`;
const child = spawn(chromium, ["--headless", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-background-networking", "--no-first-run", "--no-default-browser-check", "--virtual-time-budget=40000", "--dump-dom", url], { stdio: ["ignore", "pipe", "pipe"] });
let stdout = "";
let stderr = "";
child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
const timeout = setTimeout(() => child.kill("SIGKILL"), 55_000);
const code = await new Promise((done) => child.on("close", done));
clearTimeout(timeout);
await new Promise((resolveClose) => server.close(resolveClose));
if (code !== 0 || !stdout.includes("PASS:42")) {
  console.error(stderr.slice(-5000));
  console.error(stdout.slice(-5000));
  throw new Error(`Pyodide browser acceptance failed (Chromium exit ${code}).`);
}
console.log("Headless Chromium acceptance passed: the bundled Worker loaded local Pyodide and Python printed 42.");
