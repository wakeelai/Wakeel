import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Loaded via process.getBuiltinModule (a plain runtime call, not a static `import`) because
// Vite/Vitest's module resolver doesn't yet recognize the still-experimental "node:sqlite"
// as a passthrough Node builtin and otherwise fails trying to bundle it.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as {
  DatabaseSync: new (path: string, options?: { enableForeignKeyConstraints?: boolean }) => {
    exec(sql: string): void;
    prepare(sql: string): {
      get(...params: unknown[]): Record<string, unknown> | undefined;
      all(...params: unknown[]): Record<string, unknown>[];
      run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    };
  };
};

const migrationRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");
const migrationPaths = ["0001_init.sql", "0002_atomic_controls.sql", "0003_supabase_auth.sql", "0004_usdt_auto_payments.sql", "0005_bsc_payment_scan_cursor.sql"].map((file) => resolve(migrationRoot, file));
const migrationSql = migrationPaths.map((path) => readFileSync(path, "utf8"));

/**
 * A faithful D1Database stand-in backed by real SQLite (Node's built-in
 * node:sqlite), loaded with the actual migration file. Unlike a hand-rolled
 * mock, this correctly executes joins, subqueries, UNIQUE constraints and
 * transactions exactly like production D1 would.
 */
export function createTestD1() {
  // D1 (like vanilla SQLite) leaves foreign-key enforcement OFF unless a migration opts in with
  // `PRAGMA foreign_keys = ON`; node:sqlite defaults it ON, so match D1's real behavior explicitly.
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
  for (const sql of migrationSql) db.exec(sql);
  let batchQueue = Promise.resolve();

  function wrap(sql: string, bound: unknown[]) {
    return {
      async first<T>(): Promise<T | null> {
        const row = db.prepare(sql).get(...(bound as never[]));
        return (row as T) ?? null;
      },
      async all<T>(): Promise<{ results: T[] }> {
        const rows = db.prepare(sql).all(...(bound as never[]));
        return { results: rows as T[] };
      },
      async run() {
        const info = db.prepare(sql).run(...(bound as never[]));
        return { success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
      },
    };
  }

  function prepare(sql: string) {
    let bound: unknown[] = [];
    const stmt = {
      bind(...params: unknown[]) {
        bound = params;
        return stmt;
      },
      first: <T>() => wrap(sql, bound).first<T>(),
      all: <T>() => wrap(sql, bound).all<T>(),
      run: () => wrap(sql, bound).run(),
    };
    return stmt;
  }

  const d1 = {
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      let release!: () => void;
      const previous = batchQueue;
      batchQueue = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        db.exec("BEGIN");
        const results = [];
        for (const s of statements) results.push(await s.run());
        db.exec("COMMIT");
        return results;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      } finally {
        release();
      }
    },
    /** Test-only helper: seed a row directly for setup (bypasses the app's own INSERT statements). */
    _seed(table: string, row: Record<string, unknown>) {
      const cols = Object.keys(row);
      const placeholders = cols.map(() => "?").join(", ");
      db.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`).run(
        ...(cols.map((c) => row[c]) as never[]),
      );
    },
    _get(table: string, where: Record<string, unknown>) {
      const keys = Object.keys(where);
      const clause = keys.map((k) => `${k} = ?`).join(" AND ");
      return db.prepare(`SELECT * FROM ${table} WHERE ${clause}`).get(...(keys.map((k) => where[k]) as never[]));
    },
  };

  return d1 as unknown as D1Database & { _seed: typeof d1._seed; _get: typeof d1._get };
}
