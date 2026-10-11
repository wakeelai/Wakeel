import { now } from "./db";

const CHUNK_BYTES = 64 * 1024;
const CHUNKS_PER_QUERY = 25; // 25 * 3 bind parameters stays below D1's 100-parameter limit.
export const MAX_OBJECT_BYTES = 20 * 1024 * 1024;
export const MAX_TOTAL_OBJECT_BYTES = 200 * 1024 * 1024; // reserve most of D1 Free's 500 MB/database for relational data.

export class ObjectStorageQuotaError extends Error {
  constructor(message = "The D1 Free storage budget is full. Delete old files or raise the account plan deliberately.") {
    super(message);
    this.name = "ObjectStorageQuotaError";
  }
}

export interface StoredObject {
  body: ReadableStream<Uint8Array>;
  size: number;
  httpMetadata: { contentType: string };
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** D1-backed, cardless object storage. Each row stays far below D1's 2 MB BLOB limit. */
export class D1ObjectStore {
  constructor(private readonly db: D1Database) {}

  async put(key: string, value: string | ArrayBuffer | ArrayBufferView, options?: { httpMetadata?: { contentType?: string } }): Promise<void> {
    const bytes = toBytes(value);
    if (bytes.byteLength > MAX_OBJECT_BYTES) throw new ObjectStorageQuotaError("A single stored object is limited to 20 MB.");
    const chunks: Uint8Array[] = [];
    for (let offset = 0; offset < bytes.byteLength; offset += CHUNK_BYTES) {
      chunks.push(bytes.subarray(offset, Math.min(offset + CHUNK_BYTES, bytes.byteLength)));
    }
    const statements: D1PreparedStatement[] = [
      this.db.prepare(`UPDATE object_blob_usage SET used_bytes = used_bytes + ?
        WHERE singleton_id = 1 AND used_bytes + ? <= ? RETURNING used_bytes`)
        .bind(bytes.byteLength, bytes.byteLength, MAX_TOTAL_OBJECT_BYTES),
      this.db.prepare(`INSERT INTO object_blobs (object_key, size_bytes, content_type, created_at, complete)
        SELECT ?, ?, ?, ?, 0 WHERE changes() = 1`)
        .bind(key, bytes.byteLength, options?.httpMetadata?.contentType ?? "application/octet-stream", now()),
    ];

    for (let start = 0; start < chunks.length; start += CHUNKS_PER_QUERY) {
      const part = chunks.slice(start, start + CHUNKS_PER_QUERY);
      const values = part.map(() => "(?, ?, ?)").join(", ");
      const params: (string | number | Uint8Array)[] = [];
      part.forEach((chunk, offset) => params.push(key, start + offset, chunk));
      params.push(key);
      statements.push(this.db.prepare(`WITH payload(object_key, chunk_index, chunk_data) AS (VALUES ${values})
        INSERT INTO object_blob_chunks (object_key, chunk_index, chunk_data)
        SELECT object_key, chunk_index, chunk_data FROM payload
        WHERE EXISTS (SELECT 1 FROM object_blobs WHERE object_key = ? AND complete = 0)`)
        .bind(...params));
    }
    statements.push(this.db.prepare(`UPDATE object_blobs SET complete = 1 WHERE object_key = ?
      AND (SELECT COUNT(*) FROM object_blob_chunks WHERE object_key = ?) = ?`)
      .bind(key, key, chunks.length));

    const results = await this.db.batch(statements);
    if ((results[0]?.meta?.changes ?? 0) !== 1) throw new ObjectStorageQuotaError();
    if ((results.at(-1)?.meta?.changes ?? 0) !== 1) {
      await this.db.batch([
        this.db.prepare("DELETE FROM object_blob_chunks WHERE object_key = ?").bind(key),
        this.db.prepare("DELETE FROM object_blobs WHERE object_key = ?").bind(key),
        this.db.prepare("UPDATE object_blob_usage SET used_bytes = MAX(0, used_bytes - ?) WHERE singleton_id = 1").bind(bytes.byteLength),
      ]);
      throw new Error("D1 object could not be finalized; the incomplete write was rolled back.");
    }
  }

  async get(key: string): Promise<StoredObject | null> {
    const meta = await this.db.prepare("SELECT size_bytes, content_type FROM object_blobs WHERE object_key = ? AND complete = 1")
      .bind(key).first<{ size_bytes: number; content_type: string }>();
    if (!meta) return null;
    const body = this.stream(key, meta.size_bytes);
    return {
      body,
      size: meta.size_bytes,
      httpMetadata: { contentType: meta.content_type },
      text: async () => new TextDecoder().decode(await collect(body)),
      arrayBuffer: async () => toArrayBuffer(await collect(body)),
    };
  }

  async delete(key: string): Promise<void> {
    await this.db.batch([
      this.db.prepare(`UPDATE object_blob_usage SET used_bytes = MAX(0, used_bytes -
        COALESCE((SELECT size_bytes FROM object_blobs WHERE object_key = ?), 0)) WHERE singleton_id = 1`).bind(key),
      this.db.prepare("DELETE FROM object_blob_chunks WHERE object_key = ?").bind(key),
      this.db.prepare("DELETE FROM object_blobs WHERE object_key = ?").bind(key),
    ]);
  }

  private stream(key: string, expectedBytes: number): ReadableStream<Uint8Array> {
    let nextIndex = 0;
    let emittedBytes = 0;
    return new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        const result = await this.db.prepare(`SELECT chunk_index, chunk_data FROM object_blob_chunks
          WHERE object_key = ? AND chunk_index >= ? ORDER BY chunk_index LIMIT ?`)
          .bind(key, nextIndex, CHUNKS_PER_QUERY).all<{ chunk_index: number; chunk_data: ArrayBuffer | Uint8Array }>();
        const rows = result.results ?? [];
        if (!rows.length) {
          if (emittedBytes !== expectedBytes) controller.error(new Error("Stored object is incomplete."));
          else controller.close();
          return;
        }
        for (const row of rows) {
          const chunk = row.chunk_data instanceof Uint8Array ? row.chunk_data : new Uint8Array(row.chunk_data);
          controller.enqueue(chunk);
          emittedBytes += chunk.byteLength;
          nextIndex = row.chunk_index + 1;
        }
      },
    });
  }
}

function toBytes(value: string | ArrayBuffer | ArrayBufferView): Uint8Array {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    total += value.byteLength;
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.byteLength; }
  return output;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
