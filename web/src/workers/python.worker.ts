import type { PyodideInterface } from "pyodide";

type LoadPyodide = typeof import("pyodide").loadPyodide;
type RuntimeGlobal = typeof globalThis & { loadPyodide?: LoadPyodide; importScripts?: (...urls: string[]) => void };
const runtimeGlobal = globalThis as RuntimeGlobal;
let runtime: Promise<PyodideInterface> | undefined;
let runtimeLoaded = false;

self.onmessage = async (event: MessageEvent<{ id: string; code: string }>) => {
  const { id, code } = event.data;
  try {
    if (typeof code !== "string" || code.length > 20_000) throw new Error("Python code must be 20 KB or less.");
    if (!runtimeLoaded) {
      runtimeGlobal.importScripts?.(new URL("/pyodide/pyodide.js", self.location.origin).href);
      runtimeLoaded = true;
    }
    if (!runtimeGlobal.loadPyodide) throw new Error("The local Python runtime could not be loaded.");
    runtime ??= runtimeGlobal.loadPyodide({ indexURL: new URL("/pyodide/", self.location.origin).href });
    const py = await runtime;
    // The isolated worker has no DOM, app token, or filesystem. Disable all network transports.
    Object.defineProperty(self, "fetch", { configurable: false, value: () => Promise.reject(new Error("Network access is disabled in the code interpreter.")) });
    const blocked = class { constructor() { throw new Error("Network access is disabled in the code interpreter."); } };
    for (const api of ["XMLHttpRequest", "WebSocket", "EventSource", "WebTransport", "Worker", "SharedWorker"]) {
      if (api in self) Object.defineProperty(self, api, { configurable: false, writable: false, value: blocked });
    }
    Object.defineProperty(self, "importScripts", { configurable: false, writable: false, value: () => { throw new Error("Dynamic script loading is disabled in the code interpreter."); } });
    py.setStdout({ batched: (text) => self.postMessage({ id, type: "stdout", text }) });
    py.setStderr({ batched: (text) => self.postMessage({ id, type: "stderr", text }) });
    py.globals.set("__wakeel_code", code);
    const result = await py.runPythonAsync(`exec(compile(__wakeel_code, "<user-code>", "exec"), {})`);
    self.postMessage({ id, type: "done", result: result === undefined ? "Python completed." : String(result) });
  } catch (error) {
    self.postMessage({ id, type: "error", error: error instanceof Error ? error.message : String(error) });
  }
};
export {};
