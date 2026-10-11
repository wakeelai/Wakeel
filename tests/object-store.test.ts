import { describe, expect, it } from "vitest";
import { D1ObjectStore, MAX_TOTAL_OBJECT_BYTES, ObjectStorageQuotaError } from "../src/lib/objectStore";
import { createTestD1 } from "./testDb";

describe("D1-backed object store", () => {
  it("round-trips binary objects split into multiple sub-2MB rows and streams text", async () => {
    const db = createTestD1();
    const store = new D1ObjectStore(db);
    const bytes = Uint8Array.from({ length: 160_000 }, (_, i) => (i * 37) % 256);
    await store.put("uploads/binary", bytes, { httpMetadata: { contentType: "application/octet-stream" } });
    const obj = await store.get("uploads/binary");
    expect(obj?.size).toBe(bytes.byteLength);
    expect(obj?.httpMetadata.contentType).toBe("application/octet-stream");
    expect(new Uint8Array(await obj!.arrayBuffer())).toEqual(bytes);
    const storedBytes = db._get("object_blob_usage", { singleton_id: 1 }) as { used_bytes: number };
    expect(storedBytes.used_bytes).toBe(bytes.byteLength);
  });

  it("enforces the aggregate free storage ceiling atomically under concurrent uploads", async () => {
    const db = createTestD1();
    const store = new D1ObjectStore(db);
    db.prepare("UPDATE object_blob_usage SET used_bytes = ? WHERE singleton_id = 1")
      .bind(MAX_TOTAL_OBJECT_BYTES - 5).run();
    const outcomes = await Promise.allSettled([
      store.put("uploads/one", new Uint8Array([1, 2, 3, 4])),
      store.put("uploads/two", new Uint8Array([5, 6, 7, 8])),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ObjectStorageQuotaError);
    const usage = db._get("object_blob_usage", { singleton_id: 1 }) as { used_bytes: number };
    expect(usage.used_bytes).toBe(MAX_TOTAL_OBJECT_BYTES - 1);
  });

  it("releases storage quota when an object is deleted and hides incomplete objects", async () => {
    const db = createTestD1();
    const store = new D1ObjectStore(db);
    await store.put("uploads/one", "arabic مرحبا");
    expect(await (await store.get("uploads/one"))?.text()).toBe("arabic مرحبا");
    await store.delete("uploads/one");
    expect(await store.get("uploads/one")).toBeNull();
    const usage = db._get("object_blob_usage", { singleton_id: 1 }) as { used_bytes: number };
    expect(usage.used_bytes).toBe(0);
  });
});
