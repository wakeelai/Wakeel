export function fmtDuration(ms?: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s`;
}
export const fmtTime = (ts?: number | null) => (ts ? new Date(ts).toLocaleTimeString() : "—");
export const fmtDateTime = (ts?: number | null) => (ts ? new Date(ts).toLocaleString() : "—");
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
