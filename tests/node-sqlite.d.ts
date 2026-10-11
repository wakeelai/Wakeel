// Minimal ambient typings for the handful of Node builtins the test double needs —
// avoids pulling in the full @types/node package, which would clash with
// @cloudflare/workers-types (both declare fetch/Response/etc. differently).
declare module "node:fs" {
  export function readFileSync(path: string, encoding: string): string;
}
declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}
interface Process {
  getBuiltinModule(id: string): unknown;
}
declare var process: Process;
interface ImportMeta {
  url: string;
}
