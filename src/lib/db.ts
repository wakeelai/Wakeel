import type { Env } from "../types";

export function newId(prefix = ""): string {
  const uuid = crypto.randomUUID();
  return prefix ? `${prefix}_${uuid}` : uuid;
}

export function now(): number {
  return Date.now();
}

export function today(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

/** Thin convenience wrapper around D1 for common patterns used across routes. */
export class Db {
  constructor(private d1: D1Database) {}

  get raw() {
    return this.d1;
  }

  async first<T = Record<string, unknown>>(
    sql: string,
    ...params: unknown[]
  ): Promise<T | null> {
    const res = await this.d1
      .prepare(sql)
      .bind(...params)
      .first<T>();
    return res ?? null;
  }

  async all<T = Record<string, unknown>>(
    sql: string,
    ...params: unknown[]
  ): Promise<T[]> {
    const res = await this.d1
      .prepare(sql)
      .bind(...params)
      .all<T>();
    return res.results ?? [];
  }

  async run(sql: string, ...params: unknown[]): Promise<D1Result> {
    return this.d1
      .prepare(sql)
      .bind(...params)
      .run();
  }

  /** A bound prepared statement, for use with batch() (an atomic transaction in D1). */
  stmt(sql: string, ...params: unknown[]): D1PreparedStatement {
    return this.d1.prepare(sql).bind(...params);
  }

  batch(statements: D1PreparedStatement[]) {
    return this.d1.batch(statements);
  }
}

export function dbFrom(env: Env): Db {
  return new Db(env.DB);
}
