export interface PythonResult { ok: boolean; output: string; error?: string }

/** Worker termination is the hard stop: runaway Python cannot keep executing on the page. */
export async function executePython(code: string, timeoutMs = 8_000): Promise<PythonResult> {
  if (code.length > 20_000) return { ok: false, output: "", error: "Python code must be 20 KB or less." };
  const worker = new Worker(new URL("../workers/python.worker.ts", import.meta.url), { type: "classic" });
  const id = crypto.randomUUID();
  const output: string[] = [];
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      worker.terminate();
      resolve({ ok: false, output: output.join("").slice(0, 12_000), error: "Execution timed out after 8 seconds; the worker was terminated." });
    }, timeoutMs);
    worker.onmessage = (event: MessageEvent<{ id: string; type: string; text?: string; result?: string; error?: string }>) => {
      const message = event.data;
      if (message.id !== id) return;
      if (message.type === "stdout" || message.type === "stderr") {
        output.push(message.text ?? "");
        if (output.join("").length > 12_000) {
          clearTimeout(timer);
          worker.terminate();
          resolve({ ok: false, output: output.join("").slice(0, 12_000), error: "Output exceeded the 12 KB limit; the worker was terminated." });
        }
        return;
      }
      clearTimeout(timer);
      worker.terminate();
      if (message.type === "done") resolve({ ok: true, output: `${output.join("")}${message.result ?? ""}`.slice(0, 12_000) });
      else resolve({ ok: false, output: output.join("").slice(0, 12_000), error: message.error ?? "Python execution failed." });
    };
    worker.onerror = (event) => {
      clearTimeout(timer);
      worker.terminate();
      resolve({ ok: false, output: output.join("").slice(0, 12_000), error: event.message || "Python worker failed." });
    };
    worker.postMessage({ id, code });
  });
}
