import { getAccessToken } from "./supabase";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

async function authHeader(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function toError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  return new ApiError(res.status, body.error ?? `Request failed (${res.status})`, body.code);
}

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; form?: FormData } = {},
): Promise<T> {
  const headers: Record<string, string> = { ...(await authHeader()) };
  let body: BodyInit | undefined;
  if (opts.form) {
    body = opts.form;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, { method: opts.method ?? (body ? "POST" : "GET"), headers, body });
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
}

export async function apiBlob(path: string): Promise<Blob> {
  const res = await fetch(path, { headers: await authHeader() });
  if (!res.ok) throw await toError(res);
  return res.blob();
}

export async function downloadFile(fileId: string, filename: string): Promise<void> {
  const blob = await apiBlob(`/api/files/${fileId}/download`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export interface SSEEvent {
  event: string;
  data: string;
}

/** POST + Server-Sent Events (EventSource can't POST, so we parse the stream manually). */
export async function streamSSE(
  path: string,
  body: unknown,
  onEvent: (e: SSEEvent) => void,
): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw await toError(res);
  if (!res.body) throw new Error("No response stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = "message";
      const dataLines: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
      onEvent({ event, data: dataLines.join("\n") });
    }
  }
}

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
